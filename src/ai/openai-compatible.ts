import type {
  TypeSummary, TagGenContext, FacetTagMap,
  SearchResult, VerificationResult,
} from '../types';
import type { GenerationProvider, ChatMessage } from './generation-provider';
import type { VerificationProvider } from './verification-provider';
import type { HttpClient } from '../network/http-client';
import type { RateLimiter } from './rate-limiter';
import type { PromptAssembler } from './prompt-assembler';

interface OpenAIResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

/**
 * 单一 OpenAI-compatible 实现类。
 * 同时实现 GenerationProvider 和 VerificationProvider。
 * 通过配置（apiKey、baseUrl、model、temperature）区分角色。
 */
export class OpenAICompatibleProvider implements GenerationProvider, VerificationProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number | undefined;
  private readonly enableThinking: boolean;
  private readonly httpClient: HttpClient;
  private readonly rateLimiter: RateLimiter;
  private promptAssembler: PromptAssembler | null = null;

  constructor(config: {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens?: number;
    enableThinking?: boolean;
    httpClient: HttpClient;
    rateLimiter: RateLimiter;
  }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
    this.enableThinking = config.enableThinking ?? true;
    this.httpClient = config.httpClient;
    this.rateLimiter = config.rateLimiter;
  }

  /** 注入 PromptAssembler（避免循环依赖，在 main.ts 中注入） */
  setPromptAssembler(pa: PromptAssembler): void {
    this.promptAssembler = pa;
  }

  // ── GenerationProvider ──

  async detectType(noteContent: string, _typeDescriptions: TypeSummary[], sourcePath: string): Promise<string> {
    const pa = this.requirePromptAssembler();
    const messages = await pa.buildStep1Prompt(noteContent, sourcePath);
    const content = await this.chat(messages);
    // 步骤 1 返回纯字符串（type 名称）
    return content.trim().replace(/['"]/g, '');
  }

  async generateTags(context: TagGenContext): Promise<FacetTagMap> {
    const pa = this.requirePromptAssembler();
    const messages = await pa.buildStep2Prompt(
      context.type,
      context.candidatesByFacet,
      context.existingTags,
      context.noteContent,
      context.wikilinkCandidates,
      context.sourcePath,
    );
    const content = await this.chat(messages);
    return this.parseJson<FacetTagMap>(content) ?? {};
  }

  async generateSynonyms(tag: string, facet: string, noteContext: string): Promise<string[]> {
    const pa = this.requirePromptAssembler();
    // regenerate_count 由调用方传入 noteContext 前已截断
    const messages = pa.buildRegeneratePrompt(tag, facet, noteContext, 5);
    const content = await this.chat(messages);
    return this.parseJson<string[]>(content) ?? [];
  }

  // ── VerificationProvider ──

  async verifyTag(
    tag: string,
    facet: string,
    searchResults: SearchResult[],
  ): Promise<VerificationResult> {
    const resultsText = searchResults
      .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
      .join('\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是一个术语验证专家。\n' +
          '根据以下搜索结果，判断给定标签是否为真实存在的学术/技术术语。\n' +
          '返回 JSON：{ "verified": true/false, "url": "最相关的来源 URL" }\n' +
          '如果搜索结果中没有足够证据确认该术语存在，返回 { "verified": false }',
      },
      {
        role: 'user',
        content: `标签：${tag}\n所属类别：${facet}\n\n搜索结果：\n${resultsText}`,
      },
    ];

    const content = await this.chat(messages);
    const parsed = this.parseJson<{ verified?: boolean; url?: string }>(content);

    if (parsed?.verified) {
      return {
        verified: true,
        badge: 'search_verified',
        source: 'ai_search',
        url: parsed.url,
      };
    }
    return { verified: false, badge: 'needs_review', source: 'ai_search' };
  }

  // ── internal ──

  private requirePromptAssembler(): PromptAssembler {
    if (!this.promptAssembler) {
      throw new Error('[TOOT] PromptAssembler not injected. Call setPromptAssembler() first.');
    }
    return this.promptAssembler;
  }

  private async chat(messages: ChatMessage[]): Promise<string> {
    await this.rateLimiter.acquire(this.baseUrl);

    const url = `${this.baseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: this.temperature,
    };
    if (this.maxTokens !== undefined) {
      body['max_tokens'] = this.maxTokens;
    }
    if (!this.enableThinking) {
      body['enable_thinking'] = false;
    }

    const data = await this.httpClient.post<OpenAIResponse>(url, body, {
      'Authorization': `Bearer ${this.apiKey}`,
    });

    return data.choices?.[0]?.message?.content ?? '';
  }

  /**
   * 尝试从 AI 返回内容中解析 JSON。
   * 1. 直接 JSON.parse
   * 2. 提取 markdown code block 中的 JSON
   * 3. 返回 null
   */
  private parseJson<T>(content: string): T | null {
    // 尝试直接解析
    try {
      return JSON.parse(content) as T;
    } catch { /* continue */ }

    // 尝试提取 code block
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch?.[1]) {
      try {
        return JSON.parse(codeBlockMatch[1]) as T;
      } catch { /* continue */ }
    }

    return null;
  }
}
