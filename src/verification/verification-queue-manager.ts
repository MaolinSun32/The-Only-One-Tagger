import type { BadgeType, StagingTagItem, VerificationQueueItem } from '../types';
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

  /**
   * 手动触发队列处理。
   *
   * Bug 1 fix: 全部逻辑在单次 update() 中完成，避免 load()/save() 覆盖竞争。
   * 先快照待处理列表，执行验证（async），最后在同步 update() 中统一修改队列。
   */
  async processQueue(): Promise<void> {
    // 快照当前队列（只读用途）
    const snapshot = await this.deps.queueStore.load();
    const items = [...snapshot.queue];

    // 收集处理结果（在 update 外完成 async 工作）
    const results: Array<{
      tag_label: string;
      success: boolean;
      badge: BadgeType;
      remove: boolean;
      newAttempts: number;
    }> = [];

    for (const item of items) {
      const newAttempts = item.attempts + 1;

      try {
        await this.deps.verificationPipeline.verifyTags([{
          label: item.tag_label,
          facet: item.facet,
          notePath: item.source_notes[0] ?? '',
          type: '',
        }]);

        results.push({
          tag_label: item.tag_label,
          success: true,
          badge: 'search_verified', // pipeline 内部已确定实际 badge
          remove: true,
          newAttempts,
        });
      } catch (e) {
        console.warn(`[TOOT] Queue verification failed for "${item.tag_label}"`, e);

        results.push({
          tag_label: item.tag_label,
          success: false,
          badge: 'needs_review',
          remove: newAttempts >= MAX_ATTEMPTS,
          newAttempts,
        });
      }
    }

    // 广播更新 staging（async，在 update 之外完成）
    for (const r of results) {
      await this.broadcastResult(r.tag_label, r.success, r.badge);
    }

    // 同步 update：原子性地更新 attempts + 移除已完成条目
    const toRemoveSet = new Set(results.filter(r => r.remove).map(r => r.tag_label));
    const attemptsMap = new Map(results.map(r => [r.tag_label, r.newAttempts]));

    if (results.length > 0) {
      await this.deps.queueStore.update(data => {
        // 更新 attempts
        for (const item of data.queue) {
          const newAttempts = attemptsMap.get(item.tag_label);
          if (newAttempts !== undefined) {
            item.attempts = newAttempts;
          }
        }
        // 移除已完成条目
        data.queue = data.queue.filter(q => !toRemoveSet.has(q.tag_label));
      });
    }
  }

  /**
   * 清理已入 registry 的条目（applyAll 后调用）。
   *
   * Bug 2 fix: 不传 async mutator 给 update()。
   * 先 load() + async 循环过滤，再用同步 update() 写入结果。
   */
  async cleanupRegistered(): Promise<void> {
    const data = await this.deps.queueStore.load();
    const toKeep: string[] = [];

    for (const item of data.queue) {
      const tag = await this.deps.registryStore.getTag(item.tag_label);
      if (tag && tag.status === 'verified') continue; // 已在 registry，移除
      toKeep.push(item.tag_label);
    }

    const keepSet = new Set(toKeep);
    await this.deps.queueStore.update(d => {
      d.queue = d.queue.filter(q => keepSet.has(q.tag_label));
    });
  }

  /** 启动时清理：移除所有 tag_label 已在 registry 中的条目 */
  async cleanupOnStartup(): Promise<void> {
    await this.cleanupRegistered();
  }

  // ── internal ──

  /**
   * 广播更新 staging 中所有包含该标签的条目。
   *
   * Bug 3 fix: 成功路径也调用 findAndUpdateTagGlobally，
   * 将其他笔记中 badge 为 verifying 的条目更新为实际验证结果 badge。
   */
  private async broadcastResult(
    tagLabel: string,
    verified: boolean,
    badge: BadgeType,
  ): Promise<void> {
    // 无论成功或失败，都广播更新所有 staging 中 badge 为 verifying 的条目
    const targetBadge: BadgeType = verified ? badge : 'needs_review';
    await this.deps.stagingStore.findAndUpdateTagGlobally(
      tagLabel,
      (entry: StagingTagItem): StagingTagItem => {
        if (entry.badge === 'verifying') {
          return { ...entry, badge: targetBadge };
        }
        return entry;
      },
    );

    // Registry flagging/unflagging
    const regTag = await this.deps.registryStore.getTag(tagLabel);
    if (!verified) {
      // 验证失败：检查是否已在 registry 中（之前 applyAll 过）→ flag
      if (regTag && regTag.status === 'verified') {
        await this.deps.registryStore.flagTag(tagLabel);
      }
    } else {
      // 验证成功：检查是否 flagged → unflag
      if (regTag && regTag.flagged) {
        await this.deps.registryStore.unflagTag(tagLabel);
      }
    }
  }
}
