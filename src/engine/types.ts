import type { TagEntry } from '../types';

/** PromptFilterBuilder.build() return type */
export interface FilteredCandidates {
  candidatesByFacet: Map<string, TagEntry[]>;
}
