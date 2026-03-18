import { describe, it, expect } from 'vitest';
import type { TagEntry } from '../../src/types';
import type { RegistryStore } from '../../src/storage/registry-store';
import { TagMatcher } from '../../src/engine/tag-matcher';

function makeTag(label: string, overrides: Partial<TagEntry> = {}): TagEntry {
  return {
    label,
    aliases: [],
    facets: ['domain'],
    status: 'verified',
    relations: { broader: [], narrower: [], related: [] },
    source: { verified_by: 'seed', verified_at: '' },
    ...overrides,
  };
}

function createMockRegistryStore(tags: Record<string, TagEntry>): RegistryStore {
  return {
    async getTag(label: string): Promise<TagEntry | null> {
      return tags[label] ?? null;
    },
    async findByAlias(alias: string): Promise<TagEntry | null> {
      for (const entry of Object.values(tags)) {
        if (entry.aliases.includes(alias)) {
          return entry;
        }
      }
      return null;
    },
    async getTagsByFacets(): Promise<TagEntry[]> {
      return [];
    },
  } as unknown as RegistryStore;
}

describe('TagMatcher', () => {
  const tags: Record<string, TagEntry> = {
    transformer: makeTag('transformer', {
      facets: ['method'],
      aliases: ['Transformer模型'],
    }),
    'deep-learning': makeTag('deep-learning', {
      facets: ['domain', 'method'],
      aliases: ['深度学习', 'DL', 'dl'],
    }),
    ml: makeTag('ml', {
      facets: ['domain'],
      status: 'rejected',
      rejected_in_favor_of: 'machine-learning',
    }),
  };

  const matcher = new TagMatcher(createMockRegistryStore(tags));

  it('exact match on normalized label', async () => {
    const result = await matcher.match('transformer');
    expect(result.matched).toBe(true);
    expect(result.matchType).toBe('exact');
    expect(result.entry?.label).toBe('transformer');
  });

  it('normalizes before matching: "Transformer" → exact match', async () => {
    const result = await matcher.match('Transformer');
    expect(result.matched).toBe(true);
    expect(result.matchType).toBe('exact');
    expect(result.entry?.label).toBe('transformer');
  });

  it('alias match: "深度学习" → deep-learning', async () => {
    const result = await matcher.match('深度学习');
    expect(result.matched).toBe(true);
    expect(result.matchType).toBe('alias');
    expect(result.entry?.label).toBe('deep-learning');
  });

  it('alias match: "DL" normalized to "dl" → deep-learning', async () => {
    const result = await matcher.match('DL');
    expect(result.matched).toBe(true);
    expect(result.matchType).toBe('alias');
    expect(result.entry?.label).toBe('deep-learning');
  });

  it('normalizes "deep learning" to "deep-learning" → exact match', async () => {
    const result = await matcher.match('deep learning');
    expect(result.matched).toBe(true);
    expect(result.matchType).toBe('exact');
    expect(result.entry?.label).toBe('deep-learning');
  });

  it('matches rejected tags: "ML" → ml (rejected)', async () => {
    const result = await matcher.match('ML');
    expect(result.matched).toBe(true);
    expect(result.entry?.status).toBe('rejected');
    expect(result.entry?.rejected_in_favor_of).toBe('machine-learning');
  });

  it('returns { matched: false } for unknown tag', async () => {
    const result = await matcher.match('nonexistent');
    expect(result.matched).toBe(false);
    expect(result.entry).toBeUndefined();
  });

  it('returns { matched: false } for empty string', async () => {
    const result = await matcher.match('');
    expect(result.matched).toBe(false);
  });

  it('returns { matched: false } for whitespace-only', async () => {
    const result = await matcher.match('   ');
    expect(result.matched).toBe(false);
  });
});
