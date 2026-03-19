import { App, TFile } from 'obsidian';
import type { BulkModifyResult, IncompleteState, BulkOpStatus } from '../types';

/**
 * 全库 YAML 批量修改的抽象基类。
 * 提供：逐文件追踪、状态持久化（pending_files / completed_files）、崩溃恢复。
 *
 * 子类实现 modifyFile() 定义具体的单文件修改逻辑。
 *
 * 消费者：
 * - TagMerger（M8）：标签合并/删除时的 YAML 批量修改
 * - Schema Editor sync（M6）：schema 变更时的 YAML 同步更新
 *
 * 注意：此文件替换了 Group 5 创建的 stub 实现。
 *
 * 状态文件使用 adapter.read/write 操作（不走 DataStore），
 * 因为这是临时状态文件，由 OperationLock 保护无并发写入。
 */
export abstract class BulkYamlModifier {
  protected app: App;
  protected stateFilePath: string;

  constructor(app: App, stateFilePath: string) {
    this.app = app;
    this.stateFilePath = stateFilePath;
  }

  /**
   * 子类必须实现：对单个文件执行 YAML 修改。
   * @param file 要修改的笔记文件
   * @param context 子类自定义的上下文数据
   * @returns 修改是否成功（false 时记为失败但不中断批次）
   */
  protected abstract modifyFile(file: TFile, context: any): Promise<boolean>;

  /**
   * 执行批量修改。
   * 1. 创建状态文件（pending_files + completed_files）
   * 2. 逐文件调用 modifyFile()
   * 3. 每成功一个文件，将其从 pending 移到 completed 并持久化
   * 4. 全部完成后标记 status: "completed"
   */
  async execute(
    files: TFile[],
    context: any,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<BulkModifyResult> {
    const state: Record<string, any> = {
      ...context,
      pending_files: files.map(f => f.path),
      completed_files: [] as string[],
      status: 'running' as BulkOpStatus,
    };
    await this.writeState(state);

    const result: BulkModifyResult = {
      total: files.length,
      completed: 0,
      failed: 0,
      failedFiles: {},
    };

    for (const file of files) {
      try {
        const success = await this.modifyFile(file, context);
        if (success) {
          result.completed++;
        } else {
          result.failed++;
          result.failedFiles[file.path] = 'modifyFile returned false';
        }
      } catch (e: any) {
        result.failed++;
        result.failedFiles[file.path] = e?.message ?? String(e);
        console.error(`[TOOT] BulkYamlModifier failed on ${file.path}`, e);
      }

      // 每完成一个文件立即持久化状态，确保崩溃后能精确恢复
      // 只有成功的文件移到 completed；失败的保留在 pending 以便恢复时重试
      if (!result.failedFiles[file.path]) {
        state.pending_files = state.pending_files.filter((p: string) => p !== file.path);
        state.completed_files.push(file.path);
      }
      await this.writeState(state);

      onProgress?.(result.completed + result.failed, files.length);
    }

    // 有失败文件时保持 running 状态，让 detectIncomplete() 能在下次启动时触发恢复重试
    state.status = result.failed > 0 ? 'running' : 'completed';
    await this.writeState(state);

    return result;
  }

  /**
   * 检测是否有未完成的操作（启动时调用）。
   * 读取状态文件，status 为 "running" 时返回恢复信息。
   */
  async detectIncomplete(): Promise<IncompleteState | null> {
    const state = await this.readState();
    if (!state || state.status !== 'running') return null;

    const { pending_files, completed_files, status, ...context } = state;
    return {
      pendingFiles: pending_files ?? [],
      completedFiles: completed_files ?? [],
      context,
    };
  }

  /**
   * 从上次中断处恢复执行。
   * 读取 pending_files，过滤仍存在的文件，继续处理。
   */
  async resume(context: any): Promise<BulkModifyResult> {
    const state = await this.readState();
    if (!state) throw new Error('[TOOT] No state file found for resume');

    // 过滤出仍然存在的待处理文件
    const pendingFiles: TFile[] = [];
    for (const path of state.pending_files ?? []) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        pendingFiles.push(file);
      }
    }

    return this.execute(pendingFiles, context);
  }

  /** 清理状态文件（操作完成后调用） */
  protected async cleanupState(): Promise<void> {
    try {
      if (await this.app.vault.adapter.exists(this.stateFilePath)) {
        await this.app.vault.adapter.remove(this.stateFilePath);
      }
    } catch (e) {
      console.error('[TOOT] Failed to cleanup state file', e);
    }
  }

  private async writeState(state: any): Promise<void> {
    await this.app.vault.adapter.write(
      this.stateFilePath,
      JSON.stringify(state, null, 2),
    );
  }

  private async readState(): Promise<any | null> {
    try {
      const content = await this.app.vault.adapter.read(this.stateFilePath);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
