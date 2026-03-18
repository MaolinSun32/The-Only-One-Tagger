import type { NetworkStatusAggregator } from '../../network/network-status-aggregator';

/**
 * 红绿灯网络状态指示器。
 * 🟢 = generation + verification 均在线，🔴 = 任一不可用。
 * 点击手动刷新，悬停 tooltip 显示具体原因。
 */
export class NetworkIndicator {
  private containerEl: HTMLElement;
  private dotEl!: HTMLElement;
  private statusChangeHandler: () => void;

  constructor(
    parentEl: HTMLElement,
    private readonly networkAggregator: NetworkStatusAggregator,
  ) {
    this.containerEl = parentEl.createDiv({ cls: 'toot-network-indicator' });

    this.statusChangeHandler = () => this.refresh();
    this.networkAggregator.on('statusChange', this.statusChangeHandler);

    this.build();
    this.refresh();
  }

  private build(): void {
    this.dotEl = this.containerEl.createSpan({ cls: 'toot-network-dot' });

    this.containerEl.addEventListener('click', () => {
      this.dotEl.addClass('toot-network-dot--refreshing');
      this.networkAggregator.refreshAll().finally(() => {
        this.dotEl.removeClass('toot-network-dot--refreshing');
      });
    });
  }

  private refresh(): void {
    const online = this.networkAggregator.isFullyOnline();

    this.dotEl.removeClass('toot-network-dot--online', 'toot-network-dot--offline');
    this.dotEl.addClass(online ? 'toot-network-dot--online' : 'toot-network-dot--offline');

    const tooltip = this.networkAggregator.getStatusTooltip();
    this.containerEl.setAttribute('aria-label', tooltip);
    this.containerEl.setAttribute('title', tooltip);

    const label = this.containerEl.querySelector('.toot-network-label');
    if (label) label.setText(online ? '在线' : '不可用');
  }

  /** 当前是否完全在线 */
  isOnline(): boolean {
    return this.networkAggregator.isFullyOnline();
  }

  destroy(): void {
    this.networkAggregator.off('statusChange', this.statusChangeHandler);
    this.containerEl.remove();
  }
}
