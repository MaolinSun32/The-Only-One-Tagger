import type { SearchResult, SearchType } from '../types';
import type { HttpClient } from '../network/http-client';
import { BraveSearchAdapter } from './brave-search-adapter';
import { TavilySearchAdapter } from './tavily-search-adapter';

/**
 * 统一搜索 API 抽象层。
 * 根据 searchType 委派给 Brave 或 Tavily 适配器。
 */
export class SearchClient {
  private readonly adapter: BraveSearchAdapter | TavilySearchAdapter;

  constructor(deps: {
    httpClient: HttpClient;
    searchType: SearchType;
    apiKey: string;
    baseUrl: string;
  }) {
    if (deps.searchType === 'tavily') {
      this.adapter = new TavilySearchAdapter(deps.httpClient, deps.apiKey, deps.baseUrl);
    } else {
      this.adapter = new BraveSearchAdapter(deps.httpClient, deps.apiKey, deps.baseUrl);
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    return this.adapter.search(query);
  }
}
