import { App } from 'obsidian';
import type { RegistryStore } from '../storage/registry-store';
import type { SchemaResolver } from '../engine/schema-resolver';
import type { TagStatistics } from '../types';
import { NOTE_TYPES } from '../constants';

/**
 * 实时统计面板。
 * 每次打开时扫描 registry + vault frontmatter 计算统计数据，不产生持久化文件。
 */
export class StatisticsPanel {
  constructor(
    private app: App,
    private registryStore: RegistryStore,
    private schemaResolver?: SchemaResolver,
  ) {}

  /** 计算完整统计数据（实时扫描，不缓存） */
  async compute(): Promise<TagStatistics> {
    const registry = await this.registryStore.load();
    const tags = Object.values(registry.tags);

    // 基础计数
    let verifiedCount = 0;
    let rejectedCount = 0;
    let flaggedCount = 0;
    const facetDistribution: Record<string, number> = {};

    for (const tag of tags) {
      if (tag.status === 'verified') {
        verifiedCount++;
        if (tag.flagged) flaggedCount++;
      } else {
        rejectedCount++;
      }

      for (const facet of tag.facets) {
        facetDistribution[facet] = (facetDistribution[facet] ?? 0) + 1;
      }
    }

    // 使用频率：扫描 vault 全部 markdown 文件的 frontmatter
    const usageMap = new Map<string, number>();
    const mdFiles = this.app.vault.getMarkdownFiles();

    for (const file of mdFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const types: string[] = Array.isArray(fm.type) ? fm.type : [];
      const countedFacets = new Set<string>(); // avoid double-counting shared facets

      for (const typeName of types) {
        if (!NOTE_TYPES.includes(typeName as any)) continue;

        // Collect facet values — support both nested (legacy) and flat (new) formats
        const facetEntries: Array<[string, unknown]> = [];
        const typeBlock = fm[typeName];
        if (typeBlock && typeof typeBlock === 'object' && !Array.isArray(typeBlock)) {
          // Legacy nested format
          facetEntries.push(...Object.entries(typeBlock));
        } else if (this.schemaResolver) {
          // New flat format
          try {
            const resolved = this.schemaResolver.resolve(typeName);
            const allFacetNames = [
              ...Object.keys(resolved.requiredFacets),
              ...Object.keys(resolved.optionalFacets),
            ];
            for (const facetName of allFacetNames) {
              if (fm[facetName] !== undefined && !countedFacets.has(facetName)) {
                facetEntries.push([facetName, fm[facetName]]);
                countedFacets.add(facetName);
              }
            }
          } catch { continue; }
        }

        for (const [, facetValue] of facetEntries) {
          if (Array.isArray(facetValue)) {
            for (const v of facetValue) {
              if (typeof v === 'string') {
                usageMap.set(v, (usageMap.get(v) ?? 0) + 1);
              }
            }
          } else if (typeof facetValue === 'string') {
            usageMap.set(facetValue, (usageMap.get(facetValue) ?? 0) + 1);
          }
        }
      }
    }

    // 按使用次数降序排列
    const usageFrequency = Array.from(usageMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    // 孤立标签：registry 中 verified 且使用次数为 0
    const orphanTags = tags
      .filter(t => t.status === 'verified' && (usageMap.get(t.label) ?? 0) === 0)
      .map(t => t.label);

    return {
      totalTags: tags.length,
      verifiedCount,
      rejectedCount,
      flaggedCount,
      usageFrequency,
      orphanTags,
      facetDistribution,
    };
  }

  /** 渲染统计面板到指定容器 */
  async render(containerEl: HTMLElement): Promise<void> {
    containerEl.empty();
    containerEl.addClass('toot-statistics-panel');

    const stats = await this.compute();

    // 标题
    containerEl.createEl('h3', { text: '标签库统计' });

    // 基础计数
    const summaryEl = containerEl.createDiv({ cls: 'toot-statistics-summary' });
    summaryEl.createSpan({ text: `总标签: ${stats.totalTags}  ` });
    summaryEl.createSpan({ text: `已验证: ${stats.verifiedCount}  ` });
    summaryEl.createSpan({ text: `黑名单: ${stats.rejectedCount}  ` });
    summaryEl.createSpan({ text: `待复核: ${stats.flaggedCount}` });

    // 使用频率 Top 10
    const topSection = containerEl.createDiv({ cls: 'toot-statistics-section' });
    topSection.createEl('h4', { text: '使用频率 Top 10' });
    const topItems = stats.usageFrequency.slice(0, 10);
    const maxCount = topItems[0]?.count ?? 1;

    for (const item of topItems) {
      const row = topSection.createDiv({ cls: 'toot-statistics-bar-row' });
      row.createSpan({ text: item.label, cls: 'toot-statistics-bar-label' });
      const barContainer = row.createDiv({ cls: 'toot-statistics-bar-container' });
      const bar = barContainer.createDiv({ cls: 'toot-statistics-bar' });
      bar.style.width = `${(item.count / maxCount) * 100}%`;
      row.createSpan({ text: String(item.count), cls: 'toot-statistics-bar-count' });
    }

    // 孤立标签
    if (stats.orphanTags.length > 0) {
      const orphanSection = containerEl.createDiv({ cls: 'toot-statistics-section' });
      orphanSection.createEl('h4', { text: `孤立标签（${stats.orphanTags.length}）` });
      orphanSection.createEl('p', {
        text: stats.orphanTags.join(', '),
        cls: 'toot-statistics-orphan-list',
      });
    }

    // Facet 分布
    const facetSection = containerEl.createDiv({ cls: 'toot-statistics-section' });
    facetSection.createEl('h4', { text: 'Facet 分布' });
    const facetItems = Object.entries(stats.facetDistribution)
      .sort(([, a], [, b]) => b - a);
    const facetText = facetItems.map(([f, c]) => `${f}: ${c}`).join(' | ');
    facetSection.createEl('p', { text: facetText });
  }
}
