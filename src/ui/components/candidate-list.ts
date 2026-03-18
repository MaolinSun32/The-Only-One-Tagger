/**
 * Regenerate 候选浮层。
 * 内存暂存，不持久化。关闭侧边栏后列表丢失。
 * 每次点击 ↻ 追加更多候选（不替换已有列表）。
 */
export class CandidateList {
  private containerEl: HTMLElement;
  private listEl!: HTMLElement;
  private outsideClickHandler: (e: MouseEvent) => void;
  private escapeHandler: (e: KeyboardEvent) => void;
  private allCandidates: string[] = [];

  constructor(
    anchorEl: HTMLElement,
    private readonly onSelect: (candidate: string) => void,
    private readonly onDismiss: () => void,
  ) {
    this.containerEl = createDiv({ cls: 'toot-candidate-list' });

    // Position relative to anchor
    const rect = anchorEl.getBoundingClientRect();
    this.containerEl.style.position = 'absolute';
    this.containerEl.style.top = `${rect.bottom + 4}px`;
    this.containerEl.style.left = `${rect.left}px`;

    this.listEl = this.containerEl.createDiv({ cls: 'toot-candidate-items' });
    document.body.appendChild(this.containerEl);

    // Click outside to dismiss
    this.outsideClickHandler = (e: MouseEvent) => {
      if (!this.containerEl.contains(e.target as Node) && !anchorEl.contains(e.target as Node)) {
        this.dismiss();
      }
    };
    setTimeout(() => document.addEventListener('click', this.outsideClickHandler), 0);

    // Escape to dismiss
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.dismiss();
    };
    document.addEventListener('keydown', this.escapeHandler);
  }

  /** 显示加载状态 */
  showLoading(): void {
    const loader = this.listEl.createDiv({ cls: 'toot-candidate-loading' });
    loader.setText('生成中…');
  }

  /** 追加候选项（不替换已有列表） */
  appendCandidates(candidates: string[]): void {
    // Remove loading indicator
    const loader = this.listEl.querySelector('.toot-candidate-loading');
    if (loader) loader.remove();

    for (const candidate of candidates) {
      if (this.allCandidates.includes(candidate)) continue;
      this.allCandidates.push(candidate);

      const item = this.listEl.createDiv({ cls: 'toot-candidate-item' });
      item.createSpan({ cls: 'toot-candidate-radio' });
      item.createSpan({ cls: 'toot-candidate-label', text: candidate });

      item.addEventListener('click', () => {
        this.onSelect(candidate);
        this.dismiss();
      });
    }
  }

  /** 获取所有候选（供 confirmRegenerate 使用） */
  getAllCandidates(): string[] {
    return [...this.allCandidates];
  }

  private dismiss(): void {
    document.removeEventListener('click', this.outsideClickHandler);
    document.removeEventListener('keydown', this.escapeHandler);
    this.onDismiss();
    this.containerEl.remove();
  }

  destroy(): void {
    document.removeEventListener('click', this.outsideClickHandler);
    document.removeEventListener('keydown', this.escapeHandler);
    this.containerEl.remove();
  }
}
