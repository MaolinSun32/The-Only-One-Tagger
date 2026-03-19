import type { App } from 'obsidian';
import type { TagEntry, FacetDefinition } from '../types';
import type { SchemaResolver } from '../engine/schema-resolver';
import type { PromptFilterBuilder } from '../engine/prompt-filter-builder';
import type { WikilinkCandidateCollector } from './wikilink-candidate-collector';
import type { ChatMessage, ContentPart } from './generation-provider';
import { PLUGIN_YAML_FIELDS } from '../constants';
import { ImageExtractor } from './image-extractor';

/**
 * 组装两步 AI 调用和 Regenerate 的 prompt 文本。
 * 不含黑名单标签（黑名单在 AIResponseValidator 中处理）。
 */
export class PromptAssembler {
  private readonly imageExtractor: ImageExtractor;

  constructor(private readonly deps: {
    app: App;
    schemaResolver: SchemaResolver;
    promptFilterBuilder: PromptFilterBuilder;
    wikilinkCandidateCollector: WikilinkCandidateCollector;
  }) {
    this.imageExtractor = new ImageExtractor(deps.app);
  }

  /** 构建步骤 1 的 prompt messages（type 识别） */
  async buildStep1Prompt(noteContent: string, sourcePath: string): Promise<ChatMessage[]> {
    const types = this.deps.schemaResolver.getAllTypes();
    const typeList = types
      .map(t => `- ${t.name}: ${t.label} — ${t.description}`)
      .join('\n');

    return [
      {
        role: 'system',
        content:
          '你是一位专业的图书馆分类员和知识管理专家。\n' +
          '根据笔记内容，从以下笔记类型中选择最匹配的一种。\n' +
          '只返回类型名称，不要返回其他内容。\n\n' +
          '类型列表：\n' + typeList,
      },
      {
        role: 'user',
        content: await this.buildUserContent(noteContent, sourcePath),
      },
    ];
  }

  /** 构建步骤 2 的 prompt messages（tag 生成） */
  async buildStep2Prompt(
    type: string,
    candidatesByFacet: Map<string, TagEntry[]>,
    existingTags: Record<string, unknown>,
    noteContent: string,
    wikilinkCandidates: string[],
    sourcePath: string,
  ): Promise<ChatMessage[]> {
    const schema = this.deps.schemaResolver.resolve(type);
    const allFacets = { ...schema.requiredFacets, ...schema.optionalFacets };

    let facetSection = '';
    for (const [facetName, def] of Object.entries(allFacets)) {
      facetSection += this.formatFacetBlock(
        facetName, def, candidatesByFacet, wikilinkCandidates,
      );
    }

    // 已有标签部分
    let existingSection = '';
    if (Object.keys(existingTags).length > 0) {
      existingSection = '\n=== 已有标签（请审查） ===\n';
      for (const [facet, value] of Object.entries(existingTags)) {
        const display = Array.isArray(value) ? value.join(', ') : String(value);
        existingSection += `${facet}: [${display}]\n`;
      }
    }

    return [
      {
        role: 'system',
        content:
          '你是一位专业的图书馆分类员和知识管理专家。\n' +
          '为以下笔记标注标签。对每个 facet，严格审查已有标签，确保标签完整覆盖内容。\n' +
          '保留准确的，移除不准确的，补充遗漏的。\n' +
          '返回你认为该笔记应拥有的完整标签集合。\n' +
          '以 JSON 格式返回：{ "facet_name": ["tag1", "tag2"], ... }\n\n' +
          `当前笔记类型：${type}（${schema.label} — ${schema.description}）\n\n` +
          '=== Facet 定义 ===\n' + facetSection +
          existingSection,
      },
      {
        role: 'user',
        content: await this.buildUserContent(noteContent, sourcePath),
      },
    ];
  }

  /** 构建多模态 user content（文本 + 图片） */
  private async buildUserContent(
    noteContent: string,
    sourcePath: string,
  ): Promise<string | ContentPart[]> {
    const strippedText = this.stripPluginFields(noteContent);
    const images = await this.imageExtractor.extractImages(noteContent, sourcePath);
    if (images.length === 0) return strippedText;
    return [{ type: 'text', text: strippedText }, ...images];
  }

  /** 构建 Regenerate 的 prompt messages */
  buildRegeneratePrompt(
    tag: string,
    facet: string,
    noteContext: string,
    count: number,
  ): ChatMessage[] {
    return [
      {
        role: 'system',
        content:
          '你是一位专业的图书馆分类员。\n' +
          `为以下标签生成 ${count} 个同义词或近义词。\n` +
          '要求：\n' +
          '- 必须是同义或近义概念，不能是不同概念\n' +
          '- 使用 lowercase-hyphenated 格式\n' +
          '- 以 JSON 数组格式返回：["synonym-1", "synonym-2", ...]\n\n' +
          `标签：${tag}\n` +
          `所属 facet：${facet}`,
      },
      {
        role: 'user',
        content: `笔记上下文（用于参考）：\n${noteContext}`,
      },
    ];
  }

  /**
   * 剥离插件生成的 YAML 字段。
   * 保留用户手写字段（如 title、author 等）。
   */
  stripPluginFields(noteContent: string): string {
    const fmMatch = noteContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return noteContent;

    const fmBlock = fmMatch[1]!;
    const body = noteContent.slice(fmMatch[0].length);

    // 按行过滤 YAML 字段（顶层 key: value）
    const kept: string[] = [];
    let skipIndented = false;

    for (const line of fmBlock.split(/\r?\n/)) {
      // 检查是否为顶层 key（非缩进行）
      const keyMatch = line.match(/^(\w[\w_-]*):/);
      if (keyMatch) {
        const key = keyMatch[1]!;
        if (PLUGIN_YAML_FIELDS.includes(key)) {
          skipIndented = true; // 跳过该 key 及其缩进子行
          continue;
        }
        skipIndented = false;
        kept.push(line);
      } else if (skipIndented) {
        // 跳过被移除的 key 的缩进子行
        continue;
      } else {
        kept.push(line);
      }
    }

    if (kept.length === 0) return body.trimStart();
    return `---\n${kept.join('\n')}\n---${body}`;
  }

  // ── internal ──

  private formatFacetBlock(
    facetName: string,
    def: FacetDefinition,
    candidatesByFacet: Map<string, TagEntry[]>,
    wikilinkCandidates: string[],
  ): string {
    let block = `\n【${facetName}】(${def.description})\n`;

    if (def.value_type === 'taxonomy') {
      block += `类型：taxonomy，可多选：${def.allow_multiple}\n`;
      const candidates = candidatesByFacet.get(facetName);
      if (candidates && candidates.length > 0) {
        block += '候选标签（可从中选择或建议新词）：\n';
        for (const c of candidates) {
          block += `- ${c.label}\n`;
        }
      }
    } else if (def.value_type === 'enum') {
      block += `类型：enum，可多选：${def.allow_multiple}\n`;
      if (def.values && def.values.length > 0) {
        block += '可选值（只能从中选择，不可自创）：\n';
        for (const v of def.values) {
          block += `- ${v}\n`;
        }
      }
    } else if (def.value_type === 'wikilink') {
      block += `类型：wikilink，可多选：${def.allow_multiple}\n`;
      if (wikilinkCandidates.length > 0) {
        block += '已有人名列表（可使用已有名称或创建新名称，格式 [[Name]]）：\n';
        for (const name of wikilinkCandidates) {
          block += `- [[${name}]]\n`;
        }
      }
    } else if (def.value_type === 'free-text') {
      block += `类型：free-text\n格式要求：${def.description}\n`;
    } else if (def.value_type === 'date') {
      block += '类型：date\n格式要求：YYYY-MM-DD\n';
    }

    return block;
  }
}
