import { Notice } from 'obsidian';
import type { TFile } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { StagingNote, StagingTagItem, BadgeType } from '../types';
import { NetworkIndicator } from './components/network-indicator';
import { FacetSection, type FacetSectionCallbacks } from './components/facet-section';
import { TypeSelector } from './components/type-selector';

/**
 * AI 模式 / 审核模式渲染器。
 * staging 有数据时展示（无论来自 AI 分析、批量处理、还是手动添加）。
 * 按 type → facet → tag 三级结构渲染。
 */
export class AIModeRenderer {
  private containerEl: HTMLElement;
  private bodyEl!: HTMLElement;
  private networkIndicator: NetworkIndicator | null = null;
  private typeSelector: TypeSelector | null = null;
  private facetSections: FacetSection[] = [];

  // Event handlers for cleanup
  private stagingChangeHandler: (() => void) | null = null;
  private tagVerifiedHandler: ((data: { label: string; badge: BadgeType; notePath: string; type: string; facet: string }) => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    parentEl: HTMLElement,
    private readonly plugin: TheOnlyOneTagger,
    private readonly notePath: string,
    private readonly file: TFile,
    private stagingNote: StagingNote,
  ) {
    this.containerEl = parentEl.createDiv({ cls: 'toot-ai-mode' });

    this.subscribeEvents();
    this.build();
  }

  private subscribeEvents(): void {
    // Debounced staging change (200ms)
    this.stagingChangeHandler = () => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.refreshFromStaging(), 200);
    };
    this.plugin.stagingStore.on('change', this.stagingChangeHandler);

    // Targeted badge update on verification complete
    this.tagVerifiedHandler = (data) => {
      if (data.notePath !== this.notePath) return;
      this.updateTagBadge(data.type, data.facet, data.label, data.badge);
    };
    this.plugin.verificationPipeline.on('tagVerified', this.tagVerifiedHandler);
  }

  private async build(): Promise<void> {
    // Header
    const header = this.containerEl.createDiv({ cls: 'toot-ai-header' });
    this.networkIndicator = new NetworkIndicator(header, this.plugin.networkAggregator);

    // Content hash mismatch banner
    await this.checkContentHash(header);

    // Analyze button
    const analyzeBtn = header.createEl('button', {
      cls: 'toot-analyze-btn',
      text: '重新分析',
    });
    analyzeBtn.addEventListener('click', async () => {
      analyzeBtn.disabled = true;
      analyzeBtn.setText('分析中…');
      try {
        await this.plugin.analysisOrchestrator.analyzeNote(this.file);
      } catch (e) {
        new Notice('分析失败');
        console.error('[TOOT] Re-analysis failed', e);
      } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.setText('重新分析');
      }
    });

    // Body: type blocks
    this.bodyEl = this.containerEl.createDiv({ cls: 'toot-ai-body' });
    this.renderTypeBlocks();

    // Footer: bulk actions + apply
    this.buildFooter();
  }

  private renderTypeBlocks(): void {
    // Clear existing
    for (const s of this.facetSections) s.destroy();
    this.facetSections = [];
    this.typeSelector?.destroy();
    this.bodyEl.empty();

    const typeNames = Object.keys(this.stagingNote.types);
    const allTypes = this.plugin.schemaResolver.getAllTypes();

    // Type selector
    this.typeSelector = new TypeSelector(this.bodyEl, typeNames, allTypes, {
      onChangeType: async (oldType, newType) => {
        await this.plugin.typeOperationExecutor.changeType(this.notePath, this.file, oldType, newType);
      },
      onAddType: async (newType) => {
        await this.plugin.typeOperationExecutor.addType(this.notePath, this.file, newType);
      },
      onDeleteType: async (type) => {
        await this.plugin.typeOperationExecutor.deleteType(this.notePath, this.file, type);
      },
    });

    // Render each type block
    for (const [typeName, facets] of Object.entries(this.stagingNote.types)) {
      let resolved;
      try {
        resolved = this.plugin.schemaResolver.resolve(typeName);
      } catch { continue; }

      const typeBlock = this.bodyEl.createDiv({ cls: 'toot-type-block' });
      typeBlock.createDiv({ cls: 'toot-type-block-title', text: resolved.label });

      const allFacetDefs = { ...resolved.requiredFacets, ...resolved.optionalFacets };

      // Render facets in schema order (required first, then optional)
      const orderedFacets = [
        ...Object.keys(resolved.requiredFacets),
        ...Object.keys(resolved.optionalFacets),
      ];

      for (const facetName of orderedFacets) {
        const items = facets[facetName];
        if (!items) continue;

        const facetDef = allFacetDefs[facetName];
        if (!facetDef) continue;

        const isRequired = facetName in resolved.requiredFacets;
        const callbacks = this.buildFacetCallbacks(typeName);

        const section = new FacetSection(
          typeBlock, facetName, facetDef, items, isRequired,
          callbacks, this.plugin.app,
        );
        this.facetSections.push(section);
      }
    }
  }

  private buildFooter(): void {
    const footer = this.containerEl.createDiv({ cls: 'toot-ai-footer' });

    // Accept all
    const acceptAllBtn = footer.createEl('button', {
      cls: 'toot-bulk-btn toot-bulk-btn--accept',
      text: '✅ 全部接受',
    });
    acceptAllBtn.addEventListener('click', () => this.bulkAction('accepted'));

    // Delete all
    const deleteAllBtn = footer.createEl('button', {
      cls: 'toot-bulk-btn toot-bulk-btn--delete',
      text: '❌ 全部删除',
    });
    deleteAllBtn.addEventListener('click', () => this.bulkAction('deleted'));

    // Apply
    const applyBtn = footer.createEl('button', {
      cls: 'toot-apply-btn mod-cta',
      text: '应用',
    });
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.setText('写入中…');
      try {
        await this.plugin.tagOperationExecutor.applyAll(this.notePath, this.file);
        new Notice('标签已写入');
      } catch (e) {
        new Notice('写入失败');
        console.error('[TOOT] Apply failed', e);
      } finally {
        applyBtn.disabled = false;
        applyBtn.setText('应用');
      }
    });
  }

  /**
   * 全部接受 / 全部删除。
   * 仅影响 pending 标签，不翻转已有决策。
   * 不影响 ⚪ verifying 标签。
   */
  private async bulkAction(targetStatus: 'accepted' | 'deleted'): Promise<void> {
    for (const [typeName, facets] of Object.entries(this.stagingNote.types)) {
      for (const [facetName, items] of Object.entries(facets)) {
        for (const item of items) {
          if (item.user_status !== 'pending') continue;
          if (item.badge === 'verifying') continue;

          if (targetStatus === 'accepted') {
            await this.plugin.tagOperationExecutor.toggleAccept(this.notePath, typeName, facetName, item.label);
          } else {
            await this.plugin.tagOperationExecutor.toggleDelete(this.notePath, typeName, facetName, item.label);
          }
        }
      }
    }
  }

  private async checkContentHash(header: HTMLElement): Promise<void> {
    if (!this.stagingNote.content_hash) return;
    try {
      const currentHash = await this.plugin.contentHasher.hash(this.file);
      if (currentHash !== this.stagingNote.content_hash) {
        const banner = header.createDiv({ cls: 'toot-content-changed-banner' });
        banner.createSpan({ text: '⚠️ 此笔记在分析后已被修改，标签建议可能不准确。' });
        const reanalyzeLink = banner.createEl('a', { text: '重新分析', href: '#' });
        reanalyzeLink.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.plugin.analysisOrchestrator.analyzeNote(this.file);
        });
      }
    } catch {
      // hash failure is non-critical
    }
  }

  /** 精准更新单个标签的 badge（无需全量重渲染） */
  private updateTagBadge(typeName: string, facetName: string, tagLabel: string, newBadge: BadgeType): void {
    for (const section of this.facetSections) {
      section.updateTagBadge(tagLabel, newBadge);
    }
  }

  /** 从 staging 重新加载并渲染 */
  private async refreshFromStaging(): Promise<void> {
    const fresh = await this.plugin.stagingStore.getNoteStaging(this.notePath);
    if (!fresh || Object.keys(fresh.types).length === 0) {
      // Staging cleared — parent view will detect and switch mode
      return;
    }
    this.stagingNote = fresh;
    this.renderTypeBlocks();
  }

  private buildFacetCallbacks(typeName: string): FacetSectionCallbacks {
    return {
      onAcceptTag: async (facet, tag) => {
        await this.plugin.tagOperationExecutor.toggleAccept(this.notePath, typeName, facet, tag);
      },
      onDeleteTag: async (facet, tag) => {
        await this.plugin.tagOperationExecutor.toggleDelete(this.notePath, typeName, facet, tag);
      },
      onEditTag: async (facet, oldTag, newTag) => {
        await this.plugin.tagOperationExecutor.edit(this.notePath, typeName, facet, oldTag, newTag);
      },
      onRegenerateTag: async (facet, tag) => {
        const content = await this.plugin.app.vault.read(this.file);
        return this.plugin.tagOperationExecutor.regenerate(this.notePath, typeName, facet, tag, content);
      },
      onConfirmRegenerate: async (facet, oldTag, candidate, allCandidates) => {
        await this.plugin.tagOperationExecutor.confirmRegenerate(this.notePath, typeName, facet, oldTag, candidate, allCandidates);
      },
      onAddTag: async (facet, value) => {
        // In AI mode, staging already exists. Just add the tag.
        let resolved;
        try {
          resolved = this.plugin.schemaResolver.resolve(typeName);
        } catch { return; }

        const allFacets = { ...resolved.requiredFacets, ...resolved.optionalFacets };
        const facetDef = allFacets[facet];
        if (!facetDef) return;

        let finalLabel = value;
        let badge: BadgeType;

        if (facetDef.value_type === 'taxonomy') {
          const { TagNormalizer } = await import('../engine/tag-normalizer');
          const normalized = TagNormalizer.normalize(value);
          const matchResult = await this.plugin.tagMatcher.match(normalized);

          if (matchResult.matched && matchResult.entry) {
            if (matchResult.entry.status === 'rejected' && matchResult.entry.rejected_in_favor_of) {
              finalLabel = matchResult.entry.rejected_in_favor_of;
            } else {
              finalLabel = matchResult.entry.label;
            }
            badge = 'registry';
          } else {
            finalLabel = normalized;
            const isOnline = this.plugin.networkAggregator.isFullyOnline();
            badge = isOnline ? 'verifying' : 'needs_review';

            // 触发验证
            if (isOnline) {
              this.plugin.verificationPipeline
                .verifyTags([{ label: finalLabel, facet, notePath: this.notePath, type: typeName }])
                .catch(e => console.error('[TOOT] Add tag verification failed', e));
            } else {
              await this.plugin.verificationQueueManager.enqueue({
                tag_label: finalLabel,
                facet,
                suggested_by: 'user',
                source_note: this.notePath,
              });
            }
          }
        } else {
          badge = facetDef.value_type.replace('-', '_') as BadgeType;
        }

        const newEntry: StagingTagItem = {
          label: finalLabel,
          badge,
          user_status: 'pending',
          ai_recommended: true,
        };

        await this.plugin.stagingStore.addTagToFacet(this.notePath, typeName, facet, newEntry);
      },
    };
  }

  destroy(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    if (this.stagingChangeHandler) {
      this.plugin.stagingStore.off('change', this.stagingChangeHandler);
    }
    if (this.tagVerifiedHandler) {
      this.plugin.verificationPipeline.off('tagVerified', this.tagVerifiedHandler);
    }

    this.networkIndicator?.destroy();
    this.typeSelector?.destroy();
    for (const s of this.facetSections) s.destroy();
    this.containerEl.remove();
  }
}
