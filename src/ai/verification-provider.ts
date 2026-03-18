import type { SearchResult, VerificationResult } from '../types';

/** 验证 AI 接口 — 基于搜索结果判定标签真实性 */
export interface VerificationProvider {
  verifyTag(
    tag: string,
    facet: string,
    searchResults: SearchResult[],
  ): Promise<VerificationResult>;
}
