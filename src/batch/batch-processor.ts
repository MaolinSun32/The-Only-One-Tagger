import { Notice, TFile } from 'obsidian';
import type { AnalysisOrchestrator } from '../operations/analysis-orchestrator';
import type { RateLimiter } from '../ai/rate-limiter';
import type { BatchStateManager } from './batch-state-manager';
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

  constructor(
    private orchestrator: AnalysisOrchestrator,
    private rateLimiter: RateLimiter,
    private stateManager: BatchStateManager,
    private operationLock: OperationLock,
    private settings: TootSettings,
  ) {}

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

    // 初始化状态
    const taskId = `batch_${Date.now()}`;
    await this.stateManager.init(taskId, filter);

    await this.processBatch(batch, reachedLimit);
  }

  /** 暂停当前批次（等待正在处理的文件完成后暂停） */
  pause(): void {
    if (this._state === 'running') {
      this._state = 'paused';
    }
  }

  /** 恢复已暂停的批次 */
  async resume(): Promise<void> {
    if (this._state !== 'paused') return;

    // 重新获取锁
    if (!this.operationLock.acquire('批量打标')) {
      new Notice(`当前有操作正在执行：${this.operationLock.getCurrentOp()}`);
      return;
    }

    this._state = 'running';
    await this.stateManager.setStatus('running');

    // 从 stateManager 获取剩余文件 — 需要 VaultScanner
    // resume 由外层（main.ts 或 BatchProgressModal）负责调用 getRecoveryFiles 后传入
    // 这里简化：由调用方传入剩余文件
  }

  /**
   * 恢复已暂停的批次（带文件列表）。
   * 由外层获取 recovery files 后调用。
   */
  async resumeWithFiles(files: TFile[]): Promise<void> {
    if (!this.operationLock.acquire('批量打标')) {
      new Notice(`当前有操作正在执行：${this.operationLock.getCurrentOp()}`);
      return;
    }

    this._state = 'running';
    await this.stateManager.setStatus('running');
    await this.processBatch(files, false);
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
   * 使用 Semaphore 控制并发度，RateLimiter 控制 API 调用频率。
   * 每个文件的 analyzeNote() 在 try-catch 中执行，失败不中断批次。
   */
  private async processBatch(files: TFile[], reachedLimit: boolean): Promise<void> {
    const semaphore = new Semaphore(this.settings.batch_concurrency);
    const total = files.length;
    let processed = 0;
    let failedCount = 0;
    const baseUrl = this.settings.generation_base_url;

    const processFile = async (file: TFile): Promise<void> => {
      await this.rateLimiter.acquire(baseUrl);
      await semaphore.acquire();

      try {
        // 检查是否被暂停或终止
        if (this._state !== 'running') return;

        await this.orchestrator.analyzeNote(file);
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

      processed++;
      this.emit('progress', {
        processed,
        total,
        current_file: file.path,
        failed_count: failedCount,
      } as BatchProgressEvent);
    };

    // 逐文件处理（并发由 semaphore 控制）
    for (const file of files) {
      // 检查暂停/终止标志
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

      await processFile(file);
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
