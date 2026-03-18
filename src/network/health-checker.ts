import type { HealthStatus } from '../types';
import type { HttpClient } from './http-client';

export interface HealthCheckerConfig {
  name: string;
  getEndpoint: () => string;
  getApiKey: () => string;
  pingIntervalMs: number;
  httpClient: HttpClient;
}

/**
 * 通用外部服务健康检查器。
 * 插件为 generation / verification / search / wikipedia 各创建一个实例。
 * 事件机制使用简单回调数组，不引入第三方 EventEmitter。
 */
export class HealthChecker {
  private status: HealthStatus;
  private intervalId: number | null = null;
  private listeners: Array<(status: HealthStatus) => void> = [];

  private readonly name: string;
  private readonly getEndpoint: () => string;
  private readonly getApiKey: () => string;
  private readonly pingIntervalMs: number;
  private readonly httpClient: HttpClient;

  constructor(config: HealthCheckerConfig) {
    this.name = config.name;
    this.getEndpoint = config.getEndpoint;
    this.getApiKey = config.getApiKey;
    this.pingIntervalMs = config.pingIntervalMs;
    this.httpClient = config.httpClient;

    // 初始状态
    this.status = this.getApiKey() ? 'offline' : 'not_configured';
  }

  getStatus(): HealthStatus {
    return this.status;
  }

  /** 手动触发 ping */
  async refresh(): Promise<void> {
    if (!this.getApiKey()) {
      this.setStatus('not_configured');
      return;
    }
    await this.ping();
  }

  /** 启动定时 ping */
  start(): void {
    if (!this.getApiKey()) {
      this.setStatus('not_configured');
      return;
    }
    // 立即执行一次
    this.ping();
    // 定时执行
    this.intervalId = window.setInterval(() => this.ping(), this.pingIntervalMs);
  }

  /** 停止定时 ping，防止内存泄漏 */
  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  on(_event: 'statusChange', callback: (status: HealthStatus) => void): void {
    this.listeners.push(callback);
  }

  off(_event: 'statusChange', callback: (status: HealthStatus) => void): void {
    const idx = this.listeners.indexOf(callback);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  // ── internal ──

  private async ping(): Promise<void> {
    try {
      const endpoint = this.getEndpoint();
      const apiKey = this.getApiKey();
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      await this.httpClient.get(endpoint, headers);
      this.setStatus('online');
    } catch {
      this.setStatus('offline');
    }
  }

  private setStatus(next: HealthStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const cb of this.listeners) {
      try { cb(next); } catch (e) { console.error(`[TOOT] HealthChecker(${this.name}) listener error`, e); }
    }
  }
}
