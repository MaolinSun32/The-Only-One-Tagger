import type { SearchResult } from '../types';
import type { HttpClient } from '../network/http-client';

/** Brave Search API web result */
interface BraveWebResult {
  title?: string;
  description?: string;
  url?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

/**
 * Brave Search API 适配器。
 * GET + X-Subscription-Token header 认证。
 */
export class BraveSearchAdapter {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async search(query: string): Promise<SearchResult[]> {
    const encoded = encodeURIComponent(query);
    const url = `${this.baseUrl}/res/v1/web/search?q=${encoded}&count=5`;

    const data = await this.httpClient.get<BraveSearchResponse>(url, {
      'Accept': 'application/json',
      'X-Subscription-Token': this.apiKey,
    });

    const results = data.web?.results;
    if (!results) return [];

    return results
      .filter((r): r is Required<Pick<BraveWebResult, 'title' | 'url'>> & BraveWebResult =>
        !!r.title && !!r.url)
      .map(r => ({
        title: r.title,
        snippet: r.description ?? '',
        url: r.url,
      }));
  }
}
