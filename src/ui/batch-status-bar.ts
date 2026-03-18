import type { BatchProcessor } from '../batch/batch-processor';

/**
 * Obsidian 右下角状态栏进度项。
 * 批量处理运行时显示进度（如 "批量打标 127/400"），未运行时隐藏。
 * 点击状态栏项打开 BatchProgressModal。
 */
export class BatchStatusBarItem {
  constructor(
    private statusBarEl: HTMLElement,
    private processor: BatchProcessor,
    private openModal: () => void,
  ) {
    this.statusBarEl.addClass('toot-batch-status');
    this.statusBarEl.style.display = 'none';
    this.statusBarEl.style.cursor = 'pointer';

    // 点击打开进度窗口
    this.statusBarEl.addEventListener('click', () => {
      this.openModal();
    });

    // 订阅进度事件自动更新
    this.processor.on('progress', (data) => {
      this.show();
      this.update(data.processed, data.total);
    });
  }

  /** 显示状态栏项 */
  show(): void {
    this.statusBarEl.style.display = '';
  }

  /** 隐藏状态栏项 */
  hide(): void {
    this.statusBarEl.style.display = 'none';
  }

  /** 更新进度文本 */
  update(processed: number, total: number): void {
    this.statusBarEl.textContent = `批量打标 ${processed}/${total}`;
  }
}
