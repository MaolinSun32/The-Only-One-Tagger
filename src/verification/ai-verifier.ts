import type { VerificationResult } from '../types';
import type { SearchClient } from './search-client';
import type { VerificationProvider } from '../ai/verification-provider';

/**
 * 组合搜索 + AI 判定的两步验证流程。
 * 1. 搜索标签 → 2. 将搜索结果发给 Verification AI 判定
 */
export class AIVerifier {
  constructor(private readonly deps: {
    searchClient: SearchClient;
    verificationProvider: VerificationProvider;
  }) {}

  async verify(tag: string, facet: string): Promise<VerificationResult> {
    const searchResults = await this.deps.searchClient.search(tag);

    if (searchResults.length === 0) {
      return { verified: false, badge: 'needs_review', source: 'ai_search' };
    }

    return this.deps.verificationProvider.verifyTag(tag, facet, searchResults);
  }
}
