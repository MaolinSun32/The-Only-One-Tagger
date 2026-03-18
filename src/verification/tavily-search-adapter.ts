import type { SearchResult } from '../types';
import type { HttpClient } from '../network/http-client';

/** Tavily Search API result */
interface TavilyResult {
  title?: string;
  content?: string;
  url?: string;
}

interface TavilySearchResponse {
  results?: TavilyResult[];
}

/**
 * Tavily Search API 适配器。
 * POST + body 内 api_key 认证。
 */
export class TavilySearchAdapter {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async search(query: string): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/search`;

    const data = await this.httpClient.post<TavilySearchResponse>(url, {
      api_key: this.apiKey,
      query,
      max_results: 5,
    });

    const results = data.results;
    if (!results) return [];

    return results
      .filter((r): r is Required<Pick<TavilyResult, 'title' | 'url'>> & TavilyResult =>
        !!r.title && !!r.url)
      .map(r => ({
        title: r.title,
        snippet: r.content ?? '',
        url: r.url,
      }));
  }
}
