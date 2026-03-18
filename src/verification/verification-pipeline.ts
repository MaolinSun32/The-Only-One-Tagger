import type { BadgeType } from '../types';
import type { WikipediaClient } from './wikipedia-client';
import type { AIVerifier } from './ai-verifier';
import type { HealthChecker } from '../network/health-checker';
import type { StagingStore } from '../storage/staging-store';

interface VerifyTagInput {
  label: string;
  facet: string;
  notePath: string;
  type: string;
}

interface TagVerifiedEvent {
  label: string;
  badge: BadgeType;
  notePath: string;
  type: string;
  facet: string;
}

/**
 * 两级验证编排器。
 *
 * Level 1: Wikipedia 验证（可跳过）
 * Level 2: Search API + AI 判定
 *
 * 每个标签独立并发走管线，完成后立即 emit 事件。
 * ⚪ 终态保证：默认 badge = needs_review，所有异常路径均到达 finalize。
 */
export class VerificationPipeline {
  private listeners: Array<(data: TagVerifiedEvent) => void> = [];

  constructor(private readonly deps: {
    wikipediaClient: WikipediaClient;
    aiVerifier: AIVerifier;
    wikipediaChecker: HealthChecker;
    searchChecker: HealthChecker;
    stagingStore: StagingStore;
    settings: { use_knowledge_base: boolean; request_timeout_ms: number };
  }) {}

  /** 对新词列表并发执行两级验证 */
  async verifyTags(tags: VerifyTagInput[]): Promise<void> {
    await Promise.allSettled(
      tags.map(tag => this.verifySingleTag(tag)),
    );
  }

  on(_event: 'tagVerified', callback: (data: TagVerifiedEvent) => void): void {
    this.listeners.push(callback);
  }

  off(_event: 'tagVerified', callback: (data: TagVerifiedEvent) => void): void {
    const idx = this.listeners.indexOf(callback);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  // ── internal ──

  private async verifySingleTag(tag: VerifyTagInput): Promise<void> {
    let badge: BadgeType = 'needs_review'; // 默认终态

    try {
      // Level 1: Wikipedia 验证
      if (
        this.deps.settings.use_knowledge_base &&
        this.deps.wikipediaChecker.getStatus() === 'online'
      ) {
        try {
          const result = await this.deps.wikipediaClient.lookup(tag.label);
          if (result.verified) {
            badge = 'wiki_verified';
            await this.finalize(tag, badge);
            return;
          }
        } catch (e) {
          // Wikipedia 请求失败 → 跳到 Level 2
          console.warn('[TOOT] Wikipedia lookup failed, falling through', e);
        }
      }

      // Level 2: Search API + AI 判定
      const searchStatus = this.deps.searchChecker.getStatus();
      if (searchStatus === 'not_configured' || searchStatus === 'offline') {
        badge = 'needs_review';
      } else {
        try {
          const result = await this.deps.aiVerifier.verify(tag.label, tag.facet);
          badge = result.verified ? 'search_verified' : 'needs_review';
        } catch (e) {
          console.warn('[TOOT] AI verification failed, marking as needs_review', e);
          badge = 'needs_review';
        }
      }
    } catch (e) {
      // catch-all：未预期异常
      console.error('[TOOT] Unexpected error in verification pipeline', e);
      badge = 'needs_review';
    }

    await this.finalize(tag, badge);
  }

  private async finalize(tag: VerifyTagInput, badge: BadgeType): Promise<void> {
    // 队列重试时 type 为空（队列按 tag_label 去重，不含 type 信息），
    // 此时跳过 per-note 更新——由 VerificationQueueManager.broadcastResult()
    // 通过 findAndUpdateTagGlobally 全局更新所有 staging 条目
    if (tag.type) {
      await this.deps.stagingStore.updateTagBadge(
        tag.notePath, tag.type, tag.facet, tag.label, badge,
      );
    }

    const event: TagVerifiedEvent = {
      label: tag.label,
      badge,
      notePath: tag.notePath,
      type: tag.type,
      facet: tag.facet,
    };

    for (const cb of this.listeners) {
      try { cb(event); } catch (e) { console.error('[TOOT] VerificationPipeline listener error', e); }
    }
  }
}
