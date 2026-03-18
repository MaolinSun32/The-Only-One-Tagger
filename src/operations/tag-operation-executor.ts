import { Notice } from 'obsidian';
import type { TFile } from 'obsidian';
import type { StagingTagItem, BadgeType, VerifiedBy, UserStatus, TagWriteData } from '../types';
import type { StagingStore } from '../storage/staging-store';
import type { RegistryStore } from '../storage/registry-store';
import type { FrontmatterService } from '../engine/frontmatter-service';
import type { SchemaResolver } from '../engine/schema-resolver';
import type { TagMatcher } from '../engine/tag-matcher';
import type { GenerationProvider } from '../ai/generation-provider';
import type { VerificationPipeline } from '../verification/verification-pipeline';
import type { VerificationQueueManager } from '../verification/verification-queue-manager';
import type { NetworkStatusAggregator } from '../network/network-status-aggregator';
import type { OperationLock } from '../operation-lock';
import { TagNormalizer } from '../engine/tag-normalizer';

/**
 * 标签 CRUD 操作执行器。
 *
 * Accept/Delete/Edit/Regenerate/ApplyAll 五大操作。
 * applyAll 是写入管线核心：staging → YAML + registry + 清理。
 */
export class TagOperationExecutor {
  constructor(private readonly deps: {
    stagingStore: StagingStore;
    registryStore: RegistryStore;
    frontmatterService: FrontmatterService;
    schemaResolver: SchemaResolver;
    tagMatcher: TagMatcher;
    generationProvider: GenerationProvider;
    verificationPipeline: VerificationPipeline;
    verificationQueueManager: VerificationQueueManager;
    networkStatusAggregator: NetworkStatusAggregator;
    operationLock: OperationLock;
  }) {}

  /** 切换接受状态：pending→accepted, accepted→pending, deleted→accepted */
  async toggleAccept(
    notePath: string,
    type: string,
    facet: string,
    tagLabel: string,
  ): Promise<void> {
    const staging = await this.deps.stagingStore.getNoteStaging(notePath);
    const item = staging?.types[type]?.[facet]?.find(i => i.label === tagLabel);
    if (!item) return;

    let newStatus: UserStatus;
    switch (item.user_status) {
      case 'pending':  newStatus = 'accepted'; break;
      case 'accepted': newStatus = 'pending';  break;
      case 'deleted':  newStatus = 'accepted'; break;
      default: return;
    }

    await this.deps.stagingStore.updateTagStatus(notePath, type, facet, tagLabel, newStatus);
  }

  /** 切换删除状态：pending→deleted, deleted→pending, accepted→deleted */
  async toggleDelete(
    notePath: string,
    type: string,
    facet: string,
    tagLabel: string,
  ): Promise<void> {
    const staging = await this.deps.stagingStore.getNoteStaging(notePath);
    const item = staging?.types[type]?.[facet]?.find(i => i.label === tagLabel);
    if (!item) return;

    let newStatus: UserStatus;
    switch (item.user_status) {
      case 'pending':  newStatus = 'deleted'; break;
      case 'deleted':  newStatus = 'pending'; break;
      case 'accepted': newStatus = 'deleted'; break;
      default: return;
    }

    await this.deps.stagingStore.updateTagStatus(notePath, type, facet, tagLabel, newStatus);
  }

  /** 编辑标签（替换为新标签，含匹配/验证/replaces 链） */
  async edit(
    notePath: string,
    type: string,
    facet: string,
    oldTag: string,
    newTag: string,
  ): Promise<void> {
    // 1. 正规化
    const normalizedNew = TagNormalizer.normalize(newTag);

    // 2. 匹配库
    const matchResult = await this.deps.tagMatcher.match(normalizedNew);

    // 3. 确定 finalLabel + badge
    let finalLabel: string;
    let badge: BadgeType;
    let needsVerification = false;

    if (matchResult.matched && matchResult.entry) {
      if (matchResult.entry.status === 'rejected' && matchResult.entry.rejected_in_favor_of) {
        finalLabel = matchResult.entry.rejected_in_favor_of;
      } else {
        finalLabel = matchResult.entry.label;
      }
      badge = 'registry';
    } else {
      finalLabel = normalizedNew;
      const isOnline = this.deps.networkStatusAggregator.isFullyOnline();
      badge = isOnline ? 'verifying' : 'needs_review';
      needsVerification = true;
    }

    // 4. 构建 replaces 链
    const staging = await this.deps.stagingStore.getNoteStaging(notePath);
    const oldEntry = staging?.types[type]?.[facet]?.find(i => i.label === oldTag);
    const replaces = [...(oldEntry?.replaces ?? []), oldTag];

    // 5. 构建新条目
    const newEntry: StagingTagItem = {
      label: finalLabel,
      badge,
      user_status: 'accepted',
      ai_recommended: true, // edit 是用户主动操作，始终标记为 true
      replaces,
    };

    // 6. 替换
    await this.deps.stagingStore.replaceTag(notePath, type, facet, oldTag, newEntry);

    // 7. 验证新词
    if (needsVerification) {
      if (this.deps.networkStatusAggregator.isFullyOnline()) {
        this.deps.verificationPipeline
          .verifyTags([{ label: finalLabel, facet, notePath, type }])
          .catch(e => console.error('[TOOT] Edit verification failed', e));
      } else {
        await this.deps.verificationQueueManager.enqueue({
          tag_label: finalLabel,
          facet,
          suggested_by: 'user',
          source_note: notePath,
        });
      }
    }
  }

  /** 生成同义候选（不持久化） */
  async regenerate(
    _notePath: string,
    _type: string,
    facet: string,
    tag: string,
    noteContext: string,
  ): Promise<string[]> {
    return this.deps.generationProvider.generateSynonyms(tag, facet, noteContext);
  }

  /**
   * 写入 YAML + 更新 Registry + 清理。
   * 6 步流程：筛选 → 格式化 → 写入 → 注册 → 队列清理 → staging 清理。
   */
  async applyAll(notePath: string, file: TFile): Promise<void> {
    // Pre-check: 操作锁
    if (this.deps.operationLock.isLocked()) {
      new Notice(`当前有操作正在执行（${this.deps.operationLock.getCurrentOp() ?? '未知操作'}），请等待完成后再应用`);
      return;
    }

    const staging = await this.deps.stagingStore.getNoteStaging(notePath);
    if (!staging) return;

    // ── Step 1+2: 确定写入内容 ──
    const typesToWrite: string[] = [];
    const writeData: TagWriteData = { types: [], typeData: {} };

    interface RegistryAction {
      label: string;
      badge: BadgeType;
      facet: string;
      replaces?: string[];
    }
    const registryActions: RegistryAction[] = [];

    for (const [typeName, facets] of Object.entries(staging.types)) {
      // 仅处理有用户决策（accepted 或 deleted）的 type
      let hasDecision = false;
      for (const items of Object.values(facets)) {
        if (items.some(item => item.user_status !== 'pending')) {
          hasDecision = true;
          break;
        }
      }
      if (!hasDecision) continue;

      // 校验 type 仍在 schema 中
      let resolved;
      try {
        resolved = this.deps.schemaResolver.resolve(typeName);
      } catch {
        continue;
      }

      typesToWrite.push(typeName);
      const allFacetDefs = { ...resolved.requiredFacets, ...resolved.optionalFacets };
      const facetWriteData: Record<string, unknown> = {};

      for (const [facetName, items] of Object.entries(facets)) {
        const facetDef = allFacetDefs[facetName];
        if (!facetDef) continue; // facet 已从 schema 移除

        const writableLabels: string[] = [];

        for (const item of items) {
          if (item.user_status === 'accepted') {
            writableLabels.push(item.label);
            registryActions.push({
              label: item.label,
              badge: item.badge,
              facet: facetName,
              replaces: item.replaces,
            });
          } else if (item.user_status === 'pending' && !item.ai_recommended) {
            // YAML 已有标签：保留写入，但不操作 registry
            writableLabels.push(item.label);
          }
          // deleted → 排除
          // pending + ai_recommended → 排除（留在 staging 待决策）
        }

        if (writableLabels.length > 0) {
          facetWriteData[facetName] = facetDef.allow_multiple
            ? writableLabels
            : writableLabels[0];
        }
      }

      writeData.types.push(typeName);
      writeData.typeData[typeName] = facetWriteData;
    }

    if (typesToWrite.length === 0) return;

    // ── Step 3: 写入 YAML（失败中断，可安全重试） ──
    await this.deps.frontmatterService.write(file, writeData);

    // ── Step 4: Registry 操作 ──
    for (const action of registryActions) {
      const isRegistryEligible =
        action.badge === 'registry' ||
        action.badge === 'wiki_verified' ||
        action.badge === 'search_verified' ||
        action.badge === 'needs_review' ||
        action.badge === 'verifying';

      if (action.badge === 'registry') {
        // 已在 registry → 仅扩展 facet
        await this.deps.registryStore.expandFacets(action.label, action.facet);
      } else if (isRegistryEligible) {
        // 新入 registry
        await this.deps.registryStore.addTag({
          label: action.label,
          aliases: [],
          facets: [action.facet],
          status: 'verified',
          relations: { broader: [], narrower: [], related: [] },
          source: {
            verified_by: this.badgeToVerifiedBy(action.badge),
            verified_at: new Date().toISOString(),
          },
        });
      }
      // enum, wikilink, free_text, date → 跳过 registry

      // 处理 replaces 链
      if (isRegistryEligible && action.replaces) {
        for (const oldLabel of action.replaces) {
          await this.deps.registryStore.rejectTag(oldLabel, action.label);
        }
      }
    }

    // ── Step 5: 队列清理 ──
    await this.deps.verificationQueueManager.cleanupRegistered();

    // ── Step 6: Staging 清理 ──
    await this.deps.stagingStore.cleanupProcessedTags(notePath, typesToWrite);
  }

  private badgeToVerifiedBy(badge: BadgeType): VerifiedBy {
    switch (badge) {
      case 'wiki_verified':   return 'wikipedia';
      case 'search_verified': return 'ai_search';
      case 'needs_review':    return 'manual';
      case 'verifying':       return 'manual';
      default:                return 'manual';
    }
  }
}
