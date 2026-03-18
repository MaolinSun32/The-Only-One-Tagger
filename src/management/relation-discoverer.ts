import type { RegistryStore } from '../storage/registry-store';
import type { HttpClient } from '../network/http-client';
import type { RateLimiter } from '../ai/rate-limiter';
import type { RelationDiff, TagRelations } from '../types';

/**
 * AI 返回的关系建议格式。
 * 与 OpenAICompatibleProvider.chat() 内部逻辑重复（构建 chat completion 请求体、解析响应）。
 * 这是"不修改上游代码"约束下的合理 tradeoff。
 * 如果 AI 请求格式变更，需同步更新此处和 OpenAICompatibleProvider。
 */
interface AIRelationResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

interface RelationSuggestion {
  broader?: string[];
  narrower?: string[];
  related?: string[];
}

/**
 * AI 批量补全标签关系。
 * 将全部标签（或指定子集）发送给 AI，利用全局标签视野发现 broader/narrower/related 关系。
 */
export class RelationDiscoverer {
  constructor(
    private registryStore: RegistryStore,
    private httpClient: HttpClient,
    private rateLimiter: RateLimiter,
    private settings: {
      apiKey: string;
      baseUrl: string;
      model: string;
      temperature: number;
    },
  ) {}

  /**
   * 批量发现标签关系。
   * @param subset 可选，指定要处理的标签列表。为空时处理全部缺少 relations 的 verified 标签。
   * @returns RelationDiff[] — 仅包含新增的关系建议
   */
  async discover(subset?: string[]): Promise<RelationDiff[]> {
    const registry = await this.registryStore.load();
    const allTags = Object.values(registry.tags).filter(t => t.status === 'verified');

    // 确定要处理的标签
    let targetLabels: string[];
    if (subset && subset.length > 0) {
      targetLabels = subset;
    } else {
      // 筛选 relations 为空（broader/narrower/related 均为空数组）的标签
      targetLabels = allTags
        .filter(t =>
          t.relations.broader.length === 0 &&
          t.relations.narrower.length === 0 &&
          t.relations.related.length === 0,
        )
        .map(t => t.label);
    }

    if (targetLabels.length === 0) return [];

    // 构建 AI prompt
    const allLabelsInfo = allTags.map(t => ({
      label: t.label,
      facets: t.facets,
      aliases: t.aliases,
    }));

    const targetLabelsStr = targetLabels.join(', ');

    const messages = [
      {
        role: 'system' as const,
        content:
          '你是一个知识图谱专家，负责为标签库建立语义关系。\n' +
          '使用 SKOS 风格的关系类型：broader（上位概念）、narrower（下位概念）、related（相关概念）。\n\n' +
          '规则：\n' +
          '1. 只使用已有标签列表中的 label 值，不可创造新标签\n' +
          '2. 关系必须双向一致（如果 A broader B，则 B narrower A）\n' +
          '3. 返回 JSON 格式：{ "tag_label": { "broader": [...], "narrower": [...], "related": [...] } }\n' +
          '4. 只返回有意义的关系，不要强行关联\n' +
          '5. 如果某标签无法发现有效关系，跳过该标签',
      },
      {
        role: 'user' as const,
        content:
          `以下是完整标签库（共 ${allTags.length} 个已验证标签）：\n\n` +
          '```json\n' +
          JSON.stringify(allLabelsInfo, null, 2) +
          '\n```\n\n' +
          `请为以下标签补全关系：${targetLabelsStr}\n\n` +
          '返回 JSON，只包含需要补全的标签。',
      },
    ];

    // 发送 AI 请求
    const suggestions = await this.callAI(messages);
    if (!suggestions) return [];

    // 构建 RelationDiff[]
    const diffs: RelationDiff[] = [];

    for (const label of targetLabels) {
      const suggestion = suggestions[label];
      if (!suggestion) continue;

      const tag = registry.tags[label];
      if (!tag) continue;

      const current = tag.relations;
      const suggested: TagRelations = {
        broader: [...current.broader, ...(suggestion.broader ?? [])],
        narrower: [...current.narrower, ...(suggestion.narrower ?? [])],
        related: [...current.related, ...(suggestion.related ?? [])],
      };

      // 只保留新增的关系
      const added = {
        broader: (suggestion.broader ?? []).filter(l => !current.broader.includes(l)),
        narrower: (suggestion.narrower ?? []).filter(l => !current.narrower.includes(l)),
        related: (suggestion.related ?? []).filter(l => !current.related.includes(l)),
      };

      // 只有新增内容才加入 diff
      if (added.broader.length > 0 || added.narrower.length > 0 || added.related.length > 0) {
        diffs.push({ label, current, suggested, added });
      }
    }

    return diffs;
  }

  /**
   * 应用 diff 到 registry。
   * 只追加新关系，不覆盖已有关系。
   */
  async apply(diffs: RelationDiff[]): Promise<void> {
    for (const diff of diffs) {
      await this.registryStore.update(data => {
        const tag = data.tags[diff.label];
        if (!tag) return;

        // 追加新关系（concat + dedup）
        for (const rel of ['broader', 'narrower', 'related'] as const) {
          const merged = new Set([...tag.relations[rel], ...diff.added[rel]]);
          tag.relations[rel] = Array.from(merged);
        }

        data.meta.last_updated = new Date().toISOString();
      });
    }
  }

  // ── AI 请求（与 OpenAICompatibleProvider.chat() 相同模式） ──

  private async callAI(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
  ): Promise<Record<string, RelationSuggestion> | null> {
    await this.rateLimiter.acquire(this.settings.baseUrl);

    const url = `${this.settings.baseUrl}/chat/completions`;
    const body = {
      model: this.settings.model,
      messages,
      temperature: this.settings.temperature,
    };

    try {
      const data = await this.httpClient.post<AIRelationResponse>(url, body, {
        'Authorization': `Bearer ${this.settings.apiKey}`,
      });

      const content = data.choices?.[0]?.message?.content ?? '';
      return this.parseJson(content);
    } catch (e) {
      console.error('[TOOT] RelationDiscoverer AI call failed', e);
      return null;
    }
  }

  private parseJson(content: string): Record<string, RelationSuggestion> | null {
    // 直接解析
    try {
      return JSON.parse(content);
    } catch { /* continue */ }

    // 提取 code block
    const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (match?.[1]) {
      try {
        return JSON.parse(match[1]);
      } catch { /* continue */ }
    }

    return null;
  }
}
