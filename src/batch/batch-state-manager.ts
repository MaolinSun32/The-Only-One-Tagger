import type { TFile } from 'obsidian';
import type { BatchStateStore } from '../storage/batch-state-store';
import type { BatchState, ScanFilter } from '../types';
import type { VaultScanner } from './vault-scanner';

/**
 * 批量处理进度管理器。
 * 封装 BatchStateStore，提供语义化的进度追踪和跨重启恢复功能。
 * 使用路径集合（而非位置索引）记录进度，确保文件系统变更后恢复不出错。
 */
export class BatchStateManager {
  private processedSet: Set<string> | null = null;

  constructor(private store: BatchStateStore) {}

  /** 初始化新的批量任务 */
  async init(taskId: string, filter: ScanFilter, totalFiles: number): Promise<void> {
    const state: BatchState = {
      task_id: taskId,
      started_at: new Date().toISOString(),
      status: 'running',
      total_files: totalFiles,
      filter: {
        folders: filter.folders,
        skip_tagged: filter.skip_tagged,
      },
      processed_files: [],
      failed_files: {},
    };
    await this.store.save(state);
    this.processedSet = new Set();
  }

  /** 记录一个文件处理成功 */
  async recordSuccess(filePath: string): Promise<void> {
    this.processedSet?.add(filePath);
    await this.store.update(data => {
      data.processed_files.push(filePath);
    });
  }

  /** 记录一个文件处理失败 */
  async recordFailure(filePath: string, error: string): Promise<void> {
    this.processedSet?.add(filePath);
    await this.store.update(data => {
      data.processed_files.push(filePath);
      data.failed_files[filePath] = error;
    });
  }

  /** 重试成功后：从 failed_files 移除，确保已在 processed_files 中 */
  async clearFailure(filePath: string): Promise<void> {
    await this.store.update(data => {
      delete data.failed_files[filePath];
      if (!data.processed_files.includes(filePath)) {
        data.processed_files.push(filePath);
      }
    });
  }

  /** 更新状态（running / paused / completed / terminated） */
  async setStatus(status: BatchState['status']): Promise<void> {
    await this.store.update(data => {
      data.status = status;
    });
  }

  /** 获取当前 batch state */
  async getState(): Promise<BatchState> {
    return this.store.load();
  }

  /**
   * 检测是否有未完成的批次。
   * 启动时调用。status 为 "running" 或 "paused" 时返回 true。
   */
  async hasIncomplete(): Promise<boolean> {
    const state = await this.store.load();
    return state.status === 'running' || state.status === 'paused';
  }

  /**
   * 获取恢复文件列表：重新扫描 → 过滤 processed_files → 返回剩余文件。
   * 路径集合恢复语义：
   * - 删除已处理文件 → 重新扫描时不在列表中，自然跳过
   * - 新建文件 → 不在 processed_files 中，会被处理
   * - 重命名文件 → 旧路径不影响，新路径会被重新处理
   */
  async getRecoveryFiles(scanner: VaultScanner): Promise<TFile[]> {
    const state = await this.store.load();
    const processed = new Set(state.processed_files);
    const files = scanner.scan(state.filter);
    return files.filter(f => !processed.has(f.path));
  }
}
