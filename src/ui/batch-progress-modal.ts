import { App, Modal, Notice } from 'obsidian';
import type { BatchProcessor } from '../batch/batch-processor';
import type { BatchStateManager } from '../batch/batch-state-manager';
import type { StagingStore } from '../storage/staging-store';
import type { AnalysisOrchestrator } from '../operations/analysis-orchestrator';
import type { BatchProgressEvent } from '../types';

/**
 * 批量处理的进度查看窗口。
 * 显示进度条、控制按钮（暂停/恢复/终止）和分组笔记列表（待审核/已完成/失败）。
 * 非审核界面 — 审核在侧边栏完成。
 */
export class BatchProgressModal extends Modal {
  private progressBarEl: HTMLProgressElement | null = null;
  private progressTextEl: HTMLElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private resumeBtn: HTMLButtonElement | null = null;
  private terminateBtn: HTMLButtonElement | null = null;
  private listContainer: HTMLElement | null = null;

  constructor(
    app: App,
    private processor: BatchProcessor,
    private stateManager: BatchStateManager,
    private stagingStore: StagingStore,
    private orchestrator?: AnalysisOrchestrator,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('toot-batch-progress-modal');

    // 标题
    contentEl.createEl('h2', { text: '批量打标进度' });

    // 进度条
    const progressSection = contentEl.createDiv({ cls: 'toot-batch-progress-section' });
    this.progressBarEl = progressSection.createEl('progress', {
      cls: 'toot-batch-progress-bar',
    });
    this.progressBarEl.max = 100;
    this.progressBarEl.value = 0;
    this.progressTextEl = progressSection.createDiv({ cls: 'toot-batch-progress-text' });

    // 操作按钮
    const controls = contentEl.createDiv({ cls: 'toot-batch-controls' });

    this.pauseBtn = controls.createEl('button', { text: '暂停', cls: 'toot-batch-btn' });
    this.pauseBtn.addEventListener('click', () => {
      this.processor.pause();
      this.updateButtons();
    });

    this.resumeBtn = controls.createEl('button', { text: '恢复', cls: 'toot-batch-btn' });
    this.resumeBtn.addEventListener('click', async () => {
      await this.processor.resume();
      this.updateButtons();
    });

    this.terminateBtn = controls.createEl('button', { text: '终止', cls: 'toot-batch-btn toot-batch-btn-danger' });
    this.terminateBtn.addEventListener('click', () => {
      if (confirm('确定要终止批量处理？已处理的笔记不受影响。')) {
        this.processor.terminate();
        this.updateButtons();
      }
    });

    this.updateButtons();

    // 笔记列表容器
    this.listContainer = contentEl.createDiv({ cls: 'toot-batch-list-container' });

    // 渲染初始列表
    await this.renderNoteList();

    // 订阅进度事件
    this.processor.on('progress', (data: BatchProgressEvent) => {
      this.updateProgress(data);
    });

    // 每次笔记完成时刷新列表
    this.processor.on('noteCompleted', () => {
      this.renderNoteList();
    });

    // 加载初始进度（total 从 state.total_files 读取，而非从 processed 推算）
    const state = await this.stateManager.getState();
    const processedCount = state.processed_files.length;
    const failedCount = Object.keys(state.failed_files).length;
    const total = state.total_files || processedCount; // 兼容旧数据
    if (total > 0) {
      this.updateProgress({
        processed: processedCount,
        total,
        current_file: '',
        failed_count: failedCount,
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ── internal ──

  private updateProgress(data: BatchProgressEvent): void {
    if (this.progressBarEl && data.total > 0) {
      this.progressBarEl.max = data.total;
      this.progressBarEl.value = data.processed;
    }
    if (this.progressTextEl) {
      this.progressTextEl.textContent = `${data.processed}/${data.total}` +
        (data.failed_count > 0 ? ` （失败 ${data.failed_count}）` : '');
    }
  }

  private updateButtons(): void {
    const state = this.processor.getState();
    if (this.pauseBtn) this.pauseBtn.disabled = state !== 'running';
    if (this.resumeBtn) this.resumeBtn.disabled = state !== 'paused';
    if (this.terminateBtn) this.terminateBtn.disabled = state === 'idle';
  }

  private async renderNoteList(): Promise<void> {
    if (!this.listContainer) return;
    this.listContainer.empty();

    const batchState = await this.stateManager.getState();
    const processedPaths = batchState.processed_files;
    const failedFiles = batchState.failed_files;

    // 分类笔记
    const pendingReview: Array<{ path: string; pendingCount: number }> = [];
    const completed: string[] = [];

    for (const path of processedPaths) {
      if (failedFiles[path]) continue; // 失败的在另一组

      const staging = await this.stagingStore.getNoteStaging(path);
      if (staging) {
        // 检查是否有 pending 标签
        let pendingCount = 0;
        for (const facets of Object.values(staging.types)) {
          for (const items of Object.values(facets)) {
            for (const item of items) {
              if (item.user_status === 'pending') pendingCount++;
            }
          }
        }
        if (pendingCount > 0) {
          pendingReview.push({ path, pendingCount });
        } else {
          completed.push(path);
        }
      } else {
        completed.push(path);
      }
    }

    // 待审核组
    this.renderGroup(
      '待审核',
      pendingReview.length,
      (groupEl) => {
        for (const { path, pendingCount } of pendingReview) {
          const row = groupEl.createDiv({ cls: 'toot-batch-note-row' });
          row.createSpan({ text: `📄 ${this.getFileName(path)}`, cls: 'toot-batch-note-name' });
          row.createSpan({ text: `[${pendingCount} 标签]`, cls: 'toot-batch-note-count' });
          const jumpBtn = row.createEl('button', { text: '跳转', cls: 'toot-batch-btn-small' });
          jumpBtn.addEventListener('click', () => {
            this.close();
            this.app.workspace.openLinkText(path, '', false);
          });
        }
      },
    );

    // 已完成组
    this.renderGroup(
      '已完成',
      completed.length,
      (groupEl) => {
        for (const path of completed) {
          groupEl.createDiv({
            text: `✅ ${this.getFileName(path)}`,
            cls: 'toot-batch-note-row',
          });
        }
      },
    );

    // 失败组
    const failedEntries = Object.entries(failedFiles);
    this.renderGroup(
      '失败',
      failedEntries.length,
      (groupEl) => {
        for (const [path, error] of failedEntries) {
          const row = groupEl.createDiv({ cls: 'toot-batch-note-row toot-batch-note-failed' });
          row.createSpan({ text: `❌ ${this.getFileName(path)}: ${error}` });
          if (this.orchestrator) {
            const retryBtn = row.createEl('button', { text: '重试', cls: 'toot-batch-btn-small' });
            retryBtn.addEventListener('click', async () => {
              const file = this.app.vault.getAbstractFileByPath(path);
              if (!file) {
                new Notice(`文件不存在: ${path}`);
                return;
              }
              try {
                await this.orchestrator!.analyzeNote(file as any);
                new Notice(`重试成功: ${this.getFileName(path)}`);
                await this.renderNoteList();
              } catch (e: any) {
                new Notice(`重试失败: ${e?.message}`);
              }
            });
          }
        }
      },
    );
  }

  private renderGroup(
    title: string,
    count: number,
    renderContent: (el: HTMLElement) => void,
  ): void {
    if (!this.listContainer) return;
    const group = this.listContainer.createDiv({ cls: 'toot-batch-group' });
    const header = group.createDiv({ cls: 'toot-batch-group-header' });
    header.textContent = `▼ ${title}（${count}）`;

    const content = group.createDiv({ cls: 'toot-batch-group-content' });
    renderContent(content);

    // 可折叠
    let collapsed = false;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      content.style.display = collapsed ? 'none' : '';
      header.textContent = `${collapsed ? '▶' : '▼'} ${title}（${count}）`;
    });
  }

  private getFileName(path: string): string {
    return path.split('/').pop()?.replace('.md', '') ?? path;
  }
}
