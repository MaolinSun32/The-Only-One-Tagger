import type { BadgeType, StagingTagItem } from '../types';
import type { QueueStore } from '../storage/queue-store';
import type { VerificationPipeline } from './verification-pipeline';
import type { StagingStore } from '../storage/staging-store';
import type { RegistryStore } from '../storage/registry-store';
import type { NetworkStatusAggregator } from '../network/network-status-aggregator';

const MAX_ATTEMPTS = 3;

/**
 * 离线验证队列管理器。
 *
 * - 入队按 tag_label 去重
 * - 网络恢复自动重试（监听 NetworkStatusAggregator）
 * - 验证完成后广播更新整个 staging
 * - 三层清理机制
 */
export class VerificationQueueManager {
  private statusChangeHandler: (() => void) | null = null;

  constructor(private readonly deps: {
    queueStore: QueueStore;
    verificationPipeline: VerificationPipeline;
    stagingStore: StagingStore;
    registryStore: RegistryStore;
    networkAggregator: NetworkStatusAggregator;
  }) {}

  /** 入队（按 tag_label 去重） */
  async enqueue(item: {
    tag_label: string;
    facet: string;
    suggested_by: 'ai' | 'user';
    source_note: string;
  }): Promise<void> {
    await this.deps.queueStore.update(data => {
      const existing = data.queue.find(q => q.tag_label === item.tag_label);
      if (existing) {
        if (!existing.source_notes.includes(item.source_note)) {
          existing.source_notes.push(item.source_note);
        }
      } else {
        data.queue.push({
          id: `q_${Date.now()}`,
          tag_label: item.tag_label,
          facet: item.facet,
          suggested_by: item.suggested_by,
          source_notes: [item.source_note],
          queued_at: new Date().toISOString(),
          attempts: 0,
        });
      }
    });
  }

  /** 启动监听（网络恢复自动重试） */
  start(): void {
    this.statusChangeHandler = () => {
      if (this.deps.networkAggregator.isFullyOnline()) {
        this.processQueue();
      }
    };
    this.deps.networkAggregator.on('statusChange', this.statusChangeHandler);
  }

  /** 停止监听 */
  stop(): void {
    if (this.statusChangeHandler) {
      this.deps.networkAggregator.off('statusChange', this.statusChangeHandler);
      this.statusChangeHandler = null;
    }
  }

  /** 手动触发队列处理 */
  async processQueue(): Promise<void> {
    const data = await this.deps.queueStore.load();
    const toRemove: string[] = [];

    for (const item of data.queue) {
      item.attempts++;

      try {
        // 使用 VerificationPipeline 验证
        // 取第一个 source_note 作为上下文（队列验证不绑定特定笔记）
        await this.deps.verificationPipeline.verifyTags([{
          label: item.tag_label,
          facet: item.facet,
          notePath: item.source_notes[0] ?? '',
          type: '', // 队列重试不需要 type（已在 staging 中）
        }]);

        // 广播更新 staging 中所有包含该标签的条目
        await this.broadcastResult(item.tag_label, true);
        toRemove.push(item.tag_label);
      } catch (e) {
        console.warn(`[TOOT] Queue verification failed for "${item.tag_label}"`, e);

        if (item.attempts >= MAX_ATTEMPTS) {
          // 超过重试上限 → 标为 needs_review 并移除
          await this.broadcastResult(item.tag_label, false);
          toRemove.push(item.tag_label);
        }
        // 未超过上限 → 保留在队列中，下次重试
      }
    }

    // 批量移除已处理的条目
    if (toRemove.length > 0) {
      await this.deps.queueStore.update(d => {
        d.queue = d.queue.filter(q => !toRemove.includes(q.tag_label));
      });
    }

    // 保存 attempts 更新
    await this.deps.queueStore.save(data);
  }

  /** 清理已入 registry 的条目（applyAll 后调用） */
  async cleanupRegistered(): Promise<void> {
    await this.deps.queueStore.update(async data => {
      const kept = [];
      for (const item of data.queue) {
        const tag = await this.deps.registryStore.getTag(item.tag_label);
        if (tag && tag.status === 'verified') continue; // 已在 registry，移除
        kept.push(item);
      }
      data.queue = kept;
    });
  }

  /** 启动时清理：移除所有 tag_label 已在 registry 中的条目 */
  async cleanupOnStartup(): Promise<void> {
    await this.cleanupRegistered();
  }

  // ── internal ──

  /**
   * 广播更新 staging 中所有包含该标签的条目。
   * verified=true → 由 VerificationPipeline 已更新了具体 badge
   * verified=false → 标为 needs_review
   */
  private async broadcastResult(tagLabel: string, verified: boolean): Promise<void> {
    if (!verified) {
      // 验证失败：更新所有 staging 中 badge 为 verifying 的条目
      await this.deps.stagingStore.findAndUpdateTagGlobally(
        tagLabel,
        (entry: StagingTagItem): StagingTagItem => {
          if (entry.badge === 'verifying') {
            return { ...entry, badge: 'needs_review' as BadgeType };
          }
          return entry;
        },
      );

      // 检查是否已在 registry 中（之前 applyAll 过）→ flag
      const regTag = await this.deps.registryStore.getTag(tagLabel);
      if (regTag && regTag.status === 'verified') {
        await this.deps.registryStore.flagTag(tagLabel);
      }
    } else {
      // 验证成功：检查是否 flagged → unflag
      const regTag = await this.deps.registryStore.getTag(tagLabel);
      if (regTag && regTag.flagged) {
        await this.deps.registryStore.unflagTag(tagLabel);
      }
    }
  }
}
