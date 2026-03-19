import type { VerificationResult } from '../types';
import type { HttpClient } from '../network/http-client';

/** Wikipedia query API 响应片段 */
interface WikiQueryResponse {
  query?: {
    pages?: Record<string, {
      pageid?: number;
      title?: string;
      pageprops?: Record<string, string>;
      missing?: string;
    }>;
  };
}

/**
 * Wikipedia REST API 查询。
 * 处理重定向（redirects=1）和消歧义页面。
 * 网络不可达时返回 { verified: false }（不抛异常）。
 */
export class WikipediaClient {
  private readonly httpClient: HttpClient;
  private readonly lang: string;

  constructor(deps: { httpClient: HttpClient; lang: string }) {
    this.httpClient = deps.httpClient;
    this.lang = deps.lang;
  }

  async lookup(label: string): Promise<VerificationResult> {
    try {
      // 标签格式为 lowercase-hyphenated，Wikipedia 标题使用空格
      const searchTerm = label.replace(/-/g, ' ');
      const encoded = encodeURIComponent(searchTerm);
      const url =
        `https://${this.lang}.wikipedia.org/w/api.php` +
        `?action=query&titles=${encoded}&format=json&redirects=1&prop=pageprops`;

      const data = await this.httpClient.get<WikiQueryResponse>(url);

      const pages = data.query?.pages;
      if (!pages) return { verified: false, badge: 'needs_review', source: 'wikipedia' };

      // 检查是否存在有效页面（非 -1 键）
      for (const [id, page] of Object.entries(pages)) {
        if (id === '-1' || page.missing !== undefined) continue;

        // 排除消歧义页面
        if (page.pageprops && 'disambiguation' in page.pageprops) continue;

        // 命中
        const title = page.title ?? label;
        const wikiUrl = `https://${this.lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        return {
          verified: true,
          badge: 'wiki_verified',
          source: 'wikipedia',
          url: wikiUrl,
        };
      }

      return { verified: false, badge: 'needs_review', source: 'wikipedia' };
    } catch (e) {
      console.warn('[TOOT] Wikipedia lookup failed', e);
      return { verified: false, badge: 'needs_review', source: 'wikipedia' };
    }
  }
}
