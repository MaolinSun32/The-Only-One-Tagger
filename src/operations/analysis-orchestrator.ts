import type { App, TFile } from 'obsidian';
import type { BadgeType, StagingTagItem, ResolvedSchema, TagGenContext } from '../types';
import type { GenerationProvider } from '../ai/generation-provider';
import type { AIResponseValidator } from '../ai/ai-response-validator';
import type { PromptFilterBuilder } from '../engine/prompt-filter-builder';
import type { FrontmatterService } from '../engine/frontmatter-service';
import type { StagingStore } from '../storage/staging-store';
import type { RegistryStore } from '../storage/registry-store';
import type { ContentHasher } from '../engine/content-hasher';
import type { VerificationPipeline } from '../verification/verification-pipeline';
import type { WikilinkCandidateCollector } from '../ai/wikilink-candidate-collector';
import type { SchemaResolver } from '../engine/schema-resolver';

/**
 * 9 步分析管线编排器。
 *
 * 负责：类型检测 → 候选构建 → AI 生成 → 校验 → 三方比较 → staging 写入 → 异步验证。
 */
export class AnalysisOrchestrator {
  constructor(private readonly deps: {
    app: App;
    schemaResolver: SchemaResolver;
    generationProvider: GenerationProvider;
    promptFilterBuilder: PromptFilterBuilder;
    frontmatterService: FrontmatterService;
    aiResponseValidator: AIResponseValidator;
    stagingStore: StagingStore;
    registryStore: RegistryStore;
    contentHasher: ContentHasher;
    verificationPipeline: VerificationPipeline;
    wikilinkCandidateCollector: WikilinkCandidateCollector;
    settings: {
      max_tags_per_facet: number;
      max_wikilink_candidates: number;
    };
  }) {}

  /** 自动检测类型 + 分析 */
  async analyzeNote(file: TFile): Promise<void> {
    const content = await this.deps.app.vault.read(file);

    // Step 1: 类型检测
    const detectedType = await this.deps.generationProvider.detectType(
      content,
      this.deps.schemaResolver.getAllTypes(),
      file.path,
    );

    // Guard: 校验 type 存在于 schema
    try {
      this.deps.schemaResolver.resolve(detectedType);
    } catch {
      console.warn(`[TOOT] Detected type "${detectedType}" not found in schema`);
      return;
    }

    await this.runPipeline(file, detectedType, content);
  }

  /** 指定类型分析（跳过检测） */
  async analyzeWithType(file: TFile, type: string): Promise<void> {
    const content = await this.deps.app.vault.read(file);
    await this.runPipeline(file, type, content);
  }

  // ── internal ──

  private async runPipeline(file: TFile, type: string, noteContent: string): Promise<void> {
    // Step 0: Deep clone schema（防止 AI context 意外修改共享对象）
    const schema = JSON.parse(JSON.stringify(
      this.deps.schemaResolver.resolve(type),
    )) as ResolvedSchema;
    const allFacets = { ...schema.requiredFacets, ...schema.optionalFacets };

    // Step 2: 构建候选标签
    const filtered = await this.deps.promptFilterBuilder.build(type);

    // Step 3: 读取现有 YAML 标签
    const taggedNote = await this.deps.frontmatterService.read(file);
    const existingTypeBlock = taggedNote.typeData[type] ?? {};
    const existingTagsForType: Record<string, string[]> = {};
    for (const [facetName, value] of Object.entries(existingTypeBlock)) {
      existingTagsForType[facetName] = Array.isArray(value)
        ? value.map(String)
        : [String(value)];
    }

    // Step 4: AI 生成
    const context: TagGenContext = {
      type,
      facetDefinitions: allFacets,
      candidatesByFacet: filtered.candidatesByFacet,
      existingTags: existingTypeBlock,
      wikilinkCandidates: this.deps.wikilinkCandidateCollector.collect(
        this.deps.settings.max_wikilink_candidates,
      ),
      noteContent,
      maxTagsPerFacet: this.deps.settings.max_tags_per_facet,
      sourcePath: file.path,
    };
    const rawOutput = await this.deps.generationProvider.generateTags(context);

    // Step 5: 校验
    const { facetTags } = await this.deps.aiResponseValidator.validate(rawOutput, type);

    // Steps 6+7: 三方比较
    const typeBlock: Record<string, StagingTagItem[]> = {};
    const newTagsForVerification: Array<{
      label: string; facet: string; notePath: string; type: string;
    }> = [];

    // 处理 AI 输出中包含的 facet
    for (const [facet, validatedTags] of Object.entries(facetTags)) {
      const items: StagingTagItem[] = [];
      const existingLabels = new Set(existingTagsForType[facet] ?? []);
      const aiLabels = new Set<string>();
      const seen = new Set<string>();

      for (const vTag of validatedTags) {
        if (seen.has(vTag.label)) continue; // 去重
        seen.add(vTag.label);
        aiLabels.add(vTag.label);

        if (existingLabels.has(vTag.label)) {
          // A ∩ Y: AI 推荐 + YAML 已有 → 接受
          items.push({
            label: vTag.label,
            badge: vTag.badge,
            user_status: 'accepted',
            ai_recommended: true,
          });
        } else {
          // A - Y: AI 推荐 + 新标签 → 待定
          items.push({
            label: vTag.label,
            badge: vTag.badge,
            user_status: 'pending',
            ai_recommended: true,
          });
          if (vTag.isNew) {
            newTagsForVerification.push({
              label: vTag.label,
              facet,
              notePath: file.path,
              type,
            });
          }
        }
      }

      // Y - A: YAML 已有 + AI 未推荐 → 保留接受
      for (const existingLabel of existingLabels) {
        if (aiLabels.has(existingLabel) || seen.has(existingLabel)) continue;
        seen.add(existingLabel);

        const regEntry = await this.deps.registryStore.getTag(existingLabel);
        const badge: BadgeType = regEntry && regEntry.status === 'verified'
          ? 'registry'
          : 'needs_review';

        items.push({
          label: existingLabel,
          badge,
          user_status: 'accepted',
          ai_recommended: false,
        });
      }

      if (items.length > 0) {
        typeBlock[facet] = items;
      }
    }

    // Case 3: schema 中有 facet + YAML 已有数据，但 AI 输出中无此 facet
    for (const facetName of Object.keys(allFacets)) {
      if (facetName in facetTags) continue;
      const existingValues = existingTagsForType[facetName];
      if (!existingValues || existingValues.length === 0) continue;

      const items: StagingTagItem[] = [];
      const seen = new Set<string>();

      for (const existingLabel of existingValues) {
        if (seen.has(existingLabel)) continue;
        seen.add(existingLabel);

        const regEntry = await this.deps.registryStore.getTag(existingLabel);
        const badge: BadgeType = regEntry && regEntry.status === 'verified'
          ? 'registry'
          : 'needs_review';

        items.push({
          label: existingLabel,
          badge,
          user_status: 'accepted',
          ai_recommended: false,
        });
      }

      if (items.length > 0) {
        typeBlock[facetName] = items;
      }
    }

    // Step 8: 写入 staging
    const analyzedAt = new Date().toISOString();
    const contentHash = await this.deps.contentHasher.hash(file);
    await this.deps.stagingStore.writeNoteResult(
      file.path,
      { [type]: typeBlock },
      analyzedAt,
      contentHash,
    );

    // Step 9: Fire-and-forget 异步验证新词
    if (newTagsForVerification.length > 0) {
      this.deps.verificationPipeline
        .verifyTags(newTagsForVerification)
        .catch(e => console.error('[TOOT] Background verification failed', e));
    }
  }
}
