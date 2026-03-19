import { Notice } from 'obsidian';
import type { TFile } from 'obsidian';
import type TheOnlyOneTagger from '../main';
import type { StagingTagItem, TaggedNote, FacetDefinition, BadgeType } from '../types';
import { TagNormalizer } from '../engine/tag-normalizer';
import { NetworkIndicator } from './components/network-indicator';
import { FacetSection, type FacetSectionCallbacks } from './components/facet-section';
import { TypeSelector } from './components/type-selector';

/**
 * 手动模式渲染器。
 * 无 staging 数据时的默认视图。
 * - 从 YAML 读取现有标签展示
 * - 提供"分析"按钮（🔴 时禁用）
 * - 支持手动添加标签（触发 staging 初始化 §8.2）
 */
export class ManualModeRenderer {
  private containerEl: HTMLElement;
  private networkIndicator: NetworkIndicator | null = null;
  private facetSections: FacetSection[] = [];
  private typeSelector: TypeSelector | null = null;
  private analyzing = false;

  constructor(
    parentEl: HTMLElement,
    private readonly plugin: TheOnlyOneTagger,
    private readonly notePath: string,
    private readonly file: TFile,
  ) {
    this.containerEl = parentEl.createDiv({ cls: 'toot-manual-mode' });
    this.build();
  }

  private async build(): Promise<void> {
    // Header row: network indicator + analyze button
    const header = this.containerEl.createDiv({ cls: 'toot-manual-header' });
    this.networkIndicator = new NetworkIndicator(header, this.plugin.networkAggregator);

    const analyzeBtn = header.createEl('button', {
      cls: 'toot-analyze-btn',
      text: '分析',
    });

    const isOnline = this.plugin.networkAggregator.isFullyOnline();
    if (!isOnline) {
      analyzeBtn.disabled = true;
      analyzeBtn.setAttribute('title', 'AI 服务不可用，请检查网络连接和 API 配置');
    }

    analyzeBtn.addEventListener('click', async () => {
      if (this.analyzing) return;
      this.analyzing = true;
      analyzeBtn.disabled = true;
      analyzeBtn.setText('分析中…');
      try {
        await this.plugin.analysisOrchestrator.analyzeNote(this.file);
        // staging change event will trigger view refresh → switch to AI mode
      } catch (e) {
        new Notice('分析失败，请检查日志');
        console.error('[TOOT] Analysis failed', e);
        analyzeBtn.disabled = false;
        analyzeBtn.setText('分析');
      } finally {
        this.analyzing = false;
      }
    });

    // Read existing YAML tags
    let taggedNote: TaggedNote;
    try {
      taggedNote = await this.plugin.frontmatterService.read(this.file);
    } catch {
      taggedNote = { types: [], typeData: {}, tagVersion: 0, taggedAt: '' };
    }

    // Type selector
    const allTypes = this.plugin.schemaResolver.getAllTypes();
    const body = this.containerEl.createDiv({ cls: 'toot-manual-body' });

    this.typeSelector = new TypeSelector(body, taggedNote.types, allTypes, {
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

    // Render facet sections per type from YAML data
    for (const typeName of taggedNote.types) {
      let resolved;
      try {
        resolved = this.plugin.schemaResolver.resolve(typeName);
      } catch { continue; }

      const typeBlock = body.createDiv({ cls: 'toot-type-block' });
      typeBlock.createDiv({ cls: 'toot-type-block-title', text: resolved.label });

      const allFacets = { ...resolved.requiredFacets, ...resolved.optionalFacets };
      const typeData = taggedNote.typeData[typeName] ?? {};

      for (const [facetName, facetDef] of Object.entries(allFacets)) {
        const rawValues = typeData[facetName];
        const values: string[] = rawValues == null ? []
          : Array.isArray(rawValues) ? rawValues
          : [String(rawValues)];

        // Build display-only StagingTagItem array from YAML values
        const displayItems: StagingTagItem[] = [];
        for (const label of values) {
          displayItems.push({
            label,
            badge: await this.determineBadgeForExisting(label, facetDef) as BadgeType,
            user_status: 'accepted' as const,
            ai_recommended: true,
          });
        }

        const isRequired = facetName in resolved.requiredFacets;
        const callbacks = this.buildFacetCallbacks(typeName);

        const section = new FacetSection(
          typeBlock, facetName, facetDef, displayItems, isRequired,
          callbacks, this.plugin.app,
        );
        this.facetSections.push(section);
      }
    }

    // Apply button
    const footer = this.containerEl.createDiv({ cls: 'toot-manual-footer' });
    const applyBtn = footer.createEl('button', {
      cls: 'toot-apply-btn',
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
   * 手动模式添加标签时的 staging 初始化（§8.2）。
   * 确保 staging 持有该 type 的完整标签集合。
   */
  private async initializeStagingForType(typeName: string): Promise<void> {
    const staging = await this.plugin.stagingStore.getNoteStaging(this.notePath);
    if (staging?.types[typeName]) return; // 已初始化

    // Step 1: 读取 YAML 现有标签
    let taggedNote: TaggedNote;
    try {
      taggedNote = await this.plugin.frontmatterService.read(this.file);
    } catch {
      taggedNote = { types: [], typeData: {}, tagVersion: 0, taggedAt: '' };
    }

    const typeData = taggedNote.typeData[typeName] ?? {};
    let resolved;
    try {
      resolved = this.plugin.schemaResolver.resolve(typeName);
    } catch { return; }

    const allFacets = { ...resolved.requiredFacets, ...resolved.optionalFacets };

    // Step 2: 构建 staging 数据
    const stagingTypeData: Record<string, StagingTagItem[]> = {};

    for (const [facetName, facetDef] of Object.entries(allFacets)) {
      const rawValues = typeData[facetName];
      const values: string[] = rawValues == null ? []
        : Array.isArray(rawValues) ? rawValues
        : [String(rawValues)];

      const items: StagingTagItem[] = [];
      for (const label of values) {
        items.push({
          label,
          badge: await this.determineBadgeForExisting(label, facetDef) as BadgeType,
          user_status: 'accepted' as const,
          ai_recommended: true,
        });
      }
      stagingTypeData[facetName] = items;
    }

    // Step 3: 写入 staging
    const contentHash = await this.plugin.contentHasher.hash(this.file);
    await this.plugin.stagingStore.writeNoteResult(
      this.notePath,
      { [typeName]: stagingTypeData },
      new Date().toISOString(),
      contentHash,
    );
  }

  private async determineBadgeForExisting(label: string, facetDef: FacetDefinition): Promise<string> {
    if (facetDef.value_type !== 'taxonomy') {
      return facetDef.value_type.replace('-', '_'); // enum, wikilink, free_text, date
    }
    const entry = await this.plugin.registryStore.getTag(label);
    return entry ? 'registry' : 'needs_review';
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
        // §8.2: 确保 staging 已初始化
        await this.initializeStagingForType(typeName);

        // 对 taxonomy 标签进行 normalize + match
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
    this.networkIndicator?.destroy();
    this.typeSelector?.destroy();
    for (const section of this.facetSections) section.destroy();
    this.containerEl.remove();
  }
}
