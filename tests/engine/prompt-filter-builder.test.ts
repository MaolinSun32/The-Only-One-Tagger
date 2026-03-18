import { describe, it, expect } from 'vitest';
import type { Schema, TagEntry } from '../../src/types';
import type { RegistryStore } from '../../src/storage/registry-store';
import { SchemaResolver } from '../../src/engine/schema-resolver';
import { PromptFilterBuilder } from '../../src/engine/prompt-filter-builder';

function makeTag(label: string, facets: string[], status: 'verified' | 'rejected' = 'verified'): TagEntry {
  return {
    label,
    aliases: [],
    facets,
    status,
    relations: { broader: [], narrower: [], related: [] },
    source: { verified_by: 'seed', verified_at: '' },
  };
}

function createMockRegistryStore(tags: TagEntry[]): RegistryStore {
  return {
    async getTag(): Promise<TagEntry | null> {
      return null;
    },
    async findByAlias(): Promise<TagEntry | null> {
      return null;
    },
    async getTagsByFacets(facets: string[]): Promise<TagEntry[]> {
      return tags.filter(
        t => t.status === 'verified' && t.facets.some(f => facets.includes(f)),
      );
    },
  } as unknown as RegistryStore;
}

const TEST_SCHEMA: Schema = {
  version: 1,
  note_types: {
    academic: {
      label: '学术研究',
      description: 'Academic',
      required_facets: ['domain', 'genre', 'lang'],
      optional_facets: ['method', 'algorithm', 'software'],
    },
    project: {
      label: '项目',
      description: 'Project',
      required_facets: ['domain', 'status', 'tech-stack'],
      optional_facets: ['software'],
    },
    finance: {
      label: '财务',
      description: 'Finance',
      required_facets: ['finance-type', 'amount-range'],
      optional_facets: ['category'],
    },
  },
  facet_definitions: {
    domain: { description: '领域', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    method: { description: '方法', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    algorithm: { description: '算法', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    software: { description: '软件', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    'tech-stack': { description: '技术栈', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    genre: { description: '体裁', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['paper'] },
    lang: { description: '语言', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['en'] },
    status: { description: '状态', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['in-progress'] },
    'finance-type': { description: '财务类型', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['income'] },
    'amount-range': { description: '金额', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['<100'] },
    category: { description: '分类', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['food'] },
  },
};

describe('PromptFilterBuilder', () => {
  const schemaResolver = new SchemaResolver(TEST_SCHEMA);

  it('returns empty Map for empty registry', async () => {
    const builder = new PromptFilterBuilder(schemaResolver, createMockRegistryStore([]));
    const result = await builder.build('academic');
    expect(result.candidatesByFacet.size).toBe(0);
  });

  it('groups single-facet tag under its facet', async () => {
    const tags = [makeTag('transformer', ['method'])];
    const builder = new PromptFilterBuilder(schemaResolver, createMockRegistryStore(tags));
    const result = await builder.build('academic');

    expect(result.candidatesByFacet.get('method')).toHaveLength(1);
    expect(result.candidatesByFacet.get('method')![0].label).toBe('transformer');
  });

  it('multi-facet tag appears in multiple facet groups', async () => {
    const tags = [makeTag('deep-learning', ['domain', 'method'])];
    const builder = new PromptFilterBuilder(schemaResolver, createMockRegistryStore(tags));
    const result = await builder.build('academic');

    expect(result.candidatesByFacet.get('domain')).toHaveLength(1);
    expect(result.candidatesByFacet.get('method')).toHaveLength(1);
    expect(result.candidatesByFacet.get('domain')![0].label).toBe('deep-learning');
    expect(result.candidatesByFacet.get('method')![0].label).toBe('deep-learning');
  });

  it('excludes rejected tags', async () => {
    const tags = [
      makeTag('transformer', ['method']),
      makeTag('ml', ['domain'], 'rejected'),
    ];
    const builder = new PromptFilterBuilder(schemaResolver, createMockRegistryStore(tags));
    const result = await builder.build('academic');

    const domainTags = result.candidatesByFacet.get('domain');
    expect(domainTags).toBeUndefined(); // ml is rejected, no verified domain tags
    expect(result.candidatesByFacet.get('method')).toHaveLength(1);
  });

  it('filters by type-specific facets (project has no method)', async () => {
    const tags = [makeTag('deep-learning', ['domain', 'method'])];
    const builder = new PromptFilterBuilder(schemaResolver, createMockRegistryStore(tags));
    const result = await builder.build('project');

    // project has domain (taxonomy) but not method (academic only)
    expect(result.candidatesByFacet.get('domain')).toHaveLength(1);
    expect(result.candidatesByFacet.has('method')).toBe(false);
  });

  it('returns empty Map for finance type (no taxonomy facets)', async () => {
    const tags = [makeTag('deep-learning', ['domain'])];
    const builder = new PromptFilterBuilder(schemaResolver, createMockRegistryStore(tags));
    const result = await builder.build('finance');

    expect(result.candidatesByFacet.size).toBe(0);
  });

  it('returns all tags without truncation', async () => {
    const manyTags = Array.from({ length: 200 }, (_, i) => makeTag(`tag-${i}`, ['domain']));
    const builder = new PromptFilterBuilder(schemaResolver, createMockRegistryStore(manyTags));
    const result = await builder.build('academic');

    expect(result.candidatesByFacet.get('domain')).toHaveLength(200);
  });
});
