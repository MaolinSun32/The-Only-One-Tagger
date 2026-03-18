import type { HealthChecker } from './health-checker';
import type { HealthStatus } from '../types';

interface Checkers {
  generation: HealthChecker;
  verification: HealthChecker;
  search: HealthChecker;
  wikipedia: HealthChecker;
}

const STATUS_LABELS: Record<string, string> = {
  generation: '生成服务',
  verification: '验证服务',
};

function formatOne(status: HealthStatus): string {
  switch (status) {
    case 'online': return '✓';
    case 'offline': return '✗ 无法连接';
    case 'not_configured': return '✗ 未配置 API Key';
  }
}

/**
 * 组合 4 个 HealthChecker，提供聚合接口。
 * isFullyOnline() 仅看 generation + verification。
 */
export class NetworkStatusAggregator {
  private readonly checkers: Checkers;
  private listeners: Array<() => void> = [];

  constructor(checkers: Checkers) {
    this.checkers = checkers;

    // 订阅所有 4 个 checker，任一变更时 re-emit
    const handler = () => this.emit();
    checkers.generation.on('statusChange', handler);
    checkers.verification.on('statusChange', handler);
    checkers.search.on('statusChange', handler);
    checkers.wikipedia.on('statusChange', handler);
  }

  /** generation 和 verification 均 online */
  isFullyOnline(): boolean {
    return (
      this.checkers.generation.getStatus() === 'online' &&
      this.checkers.verification.getStatus() === 'online'
    );
  }

  /** 人类可读状态描述 */
  getStatusTooltip(): string {
    const parts: string[] = [];
    for (const [key, label] of Object.entries(STATUS_LABELS)) {
      const checker = this.checkers[key as keyof Checkers];
      parts.push(`${label}: ${formatOne(checker.getStatus())}`);
    }
    return parts.join(' · ');
  }

  /** 手动刷新全部 checker */
  async refreshAll(): Promise<void> {
    await Promise.all([
      this.checkers.generation.refresh(),
      this.checkers.verification.refresh(),
      this.checkers.search.refresh(),
      this.checkers.wikipedia.refresh(),
    ]);
  }

  on(_event: 'statusChange', callback: () => void): void {
    this.listeners.push(callback);
  }

  off(_event: 'statusChange', callback: () => void): void {
    const idx = this.listeners.indexOf(callback);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  // ── internal ──

  private emit(): void {
    for (const cb of this.listeners) {
      try { cb(); } catch (e) { console.error('[TOOT] NetworkStatusAggregator listener error', e); }
    }
  }
}
