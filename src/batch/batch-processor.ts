import { Notice, TFile } from 'obsidian';
import type { AnalysisOrchestrator } from '../operations/analysis-orchestrator';
import type { RateLimiter } from '../ai/rate-limiter';
import type { BatchStateManager } from './batch-state-manager';
import type { VaultScanner } from './vault-scanner';
import type { OperationLock } from '../operation-lock';
import type { TootSettings, ScanFilter, BatchProgressEvent } from '../types';

/**
 * 简单信号量，控制并发度。
 * 零 npm 依赖，基于计数器 + resolve 队列实现。
 */
class Semaphore {
  private count: number;
  private readonly waiters: Array<() => void> = [];

  constructor(concurrency: number) {
    this.count = concurrency;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise<void>(resolve => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.count++;
    }
  }
}

type BatchProcessorEvent = 'progress' | 'noteCompleted';

/**
 * 核心批量处理引擎。
 * 后台异步运行（主线程 async/await，足够多 await 点不阻塞 UI）。
 * 支持暂停/恢复/终止、并发控制、错误隔离。
 */
export class BatchProcessor {
  private _state: 'idle' | 'running' | 'paused' = 'idle';
  private readonly listeners = new Map<BatchProcessorEvent, Function[]>();
  private vaultScanner: VaultScanner | null = null;

  constructor(
    private orchestrator: AnalysisOrchestrator,
    private rateLimiter: RateLimiter,
    private stateManager: BatchStateManager,
    private operationLock: OperationLock,
    private settings: TootSettings,
  ) {}

  /** 注入 VaultScanner（避免循环依赖，在 main.ts 中注入） */
  setVaultScanner(scanner: VaultScanner): void {
    this.vaultScanner = scanner;
  }

  /**
   * 启动批量处理。
   * 1. acquire OperationLock
   * 2. 截取前 max_batch_size 个文件
   * 3. 按 batch_concurrency 并发处理
   * 4. 到达上限自动暂停
   */
  async start(files: TFile[], filter: ScanFilter): Promise<void> {
    // 获取操作锁
    if (!this.operationLock.acquire('批量打标')) {
      new Notice(`当前有操作正在执行：${this.operationLock.getCurrentOp()}`);
      return;
    }

    this._state = 'running';

    // 截取前 max_batch_size 个文件
    const maxSize = this.settings.max_batch_size;
    const batch = files.slice(0, maxSize);
    const reachedLimit = files.length > maxSize;

    // 初始化状态（记录 total_files 供 Modal 使用）
    const taskId = `batch_${Date.now()}`;
    await this.stateManager.init(taskId, filter, batch.length);

    await this.processBatch(batch, reachedLimit);
  }

  /** 暂停当前批次（等待正在处理的文件完成后暂停） */
  pause(): void {
    if (this._state === 'running') {
      this._state = 'paused';
    }
  }

  /**
   * 恢复已暂停的批次。
   * 自包含：内部调用 stateManager.getRecoveryFiles() 获取剩余文件并继续处理。
   */
  async resume(): Promise<void> {
    if (this._state !== 'paused' && this._state !== 'idle') return;

    if (!this.vaultScanner) {
      console.error('[TOOT] BatchProcessor.resume: VaultScanner not injected');
      return;
    }

    // 获取锁
    if (!this.operationLock.acquire('批量打标')) {
      new Notice(`当前有操作正在执行：${this.operationLock.getCurrentOp()}`);
      return;
    }

    this._state = 'running';
    await this.stateManager.setStatus('running');

    // 获取剩余文件
    const recoveryFiles = await this.stateManager.getRecoveryFiles(this.vaultScanner);

    if (recoveryFiles.length === 0) {
      await this.stateManager.setStatus('completed');
      this._state = 'idle';
      this.operationLock.release();
      new Notice('没有需要恢复处理的笔记');
      return;
    }

    await this.processBatch(recoveryFiles, false);
  }

  /** 终止批次（等待正在处理的文件完成后终止） */
  terminate(): void {
    if (this._state === 'running' || this._state === 'paused') {
      this._state = 'idle';
    }
  }

  /** 订阅事件 */
  on(event: 'progress', callback: (data: BatchProgressEvent) => void): void;
  on(event: 'noteCompleted', callback: (notePath: string) => void): void;
  on(event: BatchProcessorEvent, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  /** 获取当前状态 */
  getState(): 'idle' | 'running' | 'paused' {
    return this._state;
  }

  // ── internal ──

  private emit(event: BatchProcessorEvent, data: any): void {
    const cbs = this.listeners.get(event);
    if (cbs) {
      for (const cb of cbs) {
        try { cb(data); } catch (e) {
          console.error(`[TOOT] BatchProcessor event handler error (${event})`, e);
        }
      }
    }
  }

  /**
   * 核心处理循环。
   * 使用 Promise.all + Semaphore 实现真正的并发控制。
   * RateLimiter 在 semaphore 之后（获得并发槽位后才去消耗 API 令牌）。
   * 每个文件的 analyzeNote() 在 try-catch 中执行，失败不中断批次。
   */
  private async processBatch(files: TFile[], reachedLimit: boolean): Promise<void> {
    const semaphore = new Semaphore(this.settings.batch_concurrency);
    const total = files.length;
    let processed = 0;
    let failedCount = 0;
    const baseUrl = this.settings.generation_base_url;

    const processFile = async (file: TFile): Promise<void> => {
      // 获取并发槽位
      await semaphore.acquire();

      try {
        // 获得槽位后检查是否被暂停或终止
        if (this._state !== 'running') return;

        // 获得槽位后再消耗 API 令牌（避免 rate limiter 占用无法释放的令牌）
        await this.rateLimiter.acquire(baseUrl);

        await this.orchestrator.analyzeNote(file);
        processed++;
        await this.stateManager.recordSuccess(file.path);
        this.emit('noteCompleted', file.path);
      } catch (e: any) {
        failedCount++;
        const errMsg = e?.message ?? String(e);
        await this.stateManager.recordFailure(file.path, errMsg);
        console.error(`[TOOT] Batch processing failed for ${file.path}`, e);
      } finally {
        semaphore.release();
      }

      this.emit('progress', {
        processed: processed + failedCount,
        total,
        current_file: file.path,
        failed_count: failedCount,
      } as BatchProgressEvent);
    };

    // 真正并发：所有文件同时启动，由 semaphore 控制实际并发数
    const promises = files.map(f => processFile(f));
    await Promise.all(promises);

    // 检查最终状态（pause/terminate 可能在并发中被触发）
    if (this._state === 'paused') {
      await this.stateManager.setStatus('paused');
      this.operationLock.release();
      new Notice('批量打标已暂停');
      return;
    }

    if (this._state === 'idle') {
      // 终止
      await this.stateManager.setStatus('terminated');
      this.operationLock.release();
      new Notice('批量打标已终止');
      return;
    }

    // 全部完成
    if (reachedLimit) {
      // 到达上限 → 自动暂停
      await this.stateManager.setStatus('paused');
      this._state = 'paused';
      this.operationLock.release();
      new Notice(`本批次 ${total} 篇已完成，请审核后再启动下一批`);
    } else {
      await this.stateManager.setStatus('completed');
      this._state = 'idle';
      this.operationLock.release();
      new Notice(`批量打标完成：${processed} 篇（失败 ${failedCount} 篇）`);
    }
  }
}
