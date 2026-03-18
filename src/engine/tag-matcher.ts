import type { TagMatchResult } from '../types';
import type { RegistryStore } from '../storage/registry-store';
import { TagNormalizer } from './tag-normalizer';

/**
 * Orchestrates tag matching against the registry.
 * Two-step flow: normalize input → exact label lookup → alias lookup.
 *
 * RegistryStore handles data access; TagMatcher owns the matching strategy.
 */
export class TagMatcher {
  constructor(private registryStore: RegistryStore) {}

  /**
   * Match an input string against the registry.
   *
   * 1. Normalize input via TagNormalizer
   * 2. Exact label lookup via RegistryStore.getTag()
   * 3. Alias lookup via RegistryStore.findByAlias()
   * 4. Return result with matched entry (includes status for caller to distinguish verified/rejected)
   *
   * Returns { matched: false } on miss.
   * Caller checks entry.status to handle verified vs rejected tags.
   */
  async match(input: string): Promise<TagMatchResult> {
    const normalized = TagNormalizer.normalize(input);

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
