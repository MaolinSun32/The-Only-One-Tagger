import type { TagEntry } from '../types';
import type { FilteredCandidates } from './types';
import type { SchemaResolver } from './schema-resolver';
import type { RegistryStore } from '../storage/registry-store';

/**
 * Builds candidate tag sets for AI prompt assembly.
 * Given a note type, returns all verified taxonomy tags grouped by facet.
 *
 * - Full set returned (no truncation) — registry is ~100s of tags
 * - No rejected tags included — blacklist handled by AIResponseValidator
 */
export class PromptFilterBuilder {
  constructor(
    private schemaResolver: SchemaResolver,
    private registryStore: RegistryStore,
  ) {}

  /**
   * Build filtered candidate tags for a note type.
   *
   * 1. Get taxonomy facet names for the type
   * 2. Fetch all verified tags with matching facets
   * 3. Group tags by facet (a tag may appear in multiple facets)
   */
  async build(type: string): Promise<FilteredCandidates> {
    const taxonomyFacets = this.schemaResolver.getTaxonomyFacets(type);

    if (taxonomyFacets.length === 0) {
      return { candidatesByFacet: new Map() };
    }

    const allTags = await this.registryStore.getTagsByFacets(taxonomyFacets);
    const facetSet = new Set(taxonomyFacets);
    const candidatesByFacet = new Map<string, TagEntry[]>();

    for (const tag of allTags) {
      for (const facet of tag.facets) {
        if (facetSet.has(facet)) {
          const list = candidatesByFacet.get(facet);
          if (list) {
            list.push(tag);
          } else {
            candidatesByFacet.set(facet, [tag]);
          }
        }
      }
    }

    return { candidatesByFacet };
  }
}
