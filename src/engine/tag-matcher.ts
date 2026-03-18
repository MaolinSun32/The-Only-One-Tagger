import type { TagMatchResult } from '../types';
import type { RegistryStore } from '../storage/registry-store';

/**
 * Orchestrates tag matching against the registry.
 * Two-step flow: exact label lookup → alias lookup.
 *
 * Caller is responsible for normalizing input before calling match()
 * (via TagNormalizer). This avoids double-normalization when the caller
 * (e.g., AIResponseValidator) already normalizes as part of its pipeline.
 *
 * RegistryStore handles data access; TagMatcher owns the matching strategy.
 */
export class TagMatcher {
  constructor(private registryStore: RegistryStore) {}

  /**
   * Match a pre-normalized label against the registry.
   *
   * 1. Exact label lookup via RegistryStore.getTag()
   * 2. Alias lookup via RegistryStore.findByAlias()
   * 3. Return result with matched entry (includes status for caller to distinguish verified/rejected)
   *
   * Input MUST be pre-normalized by the caller (TagNormalizer.normalize()).
   * Returns { matched: false } on miss.
   */
  async match(input: string): Promise<TagMatchResult> {
    const normalized = input;

    if (normalized === '') {
      return { matched: false };
    }

    // Step 1: Exact label match
    const exactHit = await this.registryStore.getTag(normalized);
    if (exactHit) {
      return { matched: true, matchType: 'exact', entry: exactHit };
    }

    // Step 2: Alias match
    const aliasHit = await this.registryStore.findByAlias(normalized);
    if (aliasHit) {
      return { matched: true, matchType: 'alias', entry: aliasHit };
    }

    // No match
    return { matched: false };
  }
}
