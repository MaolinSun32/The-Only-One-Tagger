import { describe, it, expect, vi } from 'vitest';
import type { Schema } from '../../src/types';
import { SchemaResolver } from '../../src/engine/schema-resolver';

// Minimal schema for testing
const TEST_SCHEMA: Schema = {
  version: 1,
  note_types: {
    academic: {
      label: '学术研究',
      description: '学术论文精读、文献综述、研究方法论笔记',
      required_facets: ['domain', 'genre', 'lang'],
      optional_facets: ['method', 'algorithm', 'concept', 'dataset', 'problem', 'software', 'programming-language', 'scholar', 'venue'],
    },
    journal: {
      label: '日记',
      description: '每日日记、情绪记录',
      required_facets: ['mood'],
      optional_facets: ['people', 'location', 'event-type', 'reflection-topic'],
    },
    finance: {
      label: '财务',
      description: '收支记录、投资分析',
      required_facets: ['finance-type', 'amount-range'],
      optional_facets: ['category', 'recurring'],
    },
    project: {
      label: '项目/复现',
      description: '编程项目、论文复现',
      required_facets: ['domain', 'status', 'tech-stack'],
      optional_facets: ['programming-language', 'software', 'collaborator', 'source-repo'],
    },
  },
  facet_definitions: {
    domain: { description: '所属知识/研究领域', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    method: { description: '方法论/技术方法', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    algorithm: { description: '具体算法', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    concept: { description: '核心概念/术语', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    dataset: { description: '数据集', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    problem: { description: '研究问题/任务', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    software: { description: '软件工具', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    'tech-stack': { description: '技术栈', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    'reflection-topic': { description: '反思主题', value_type: 'taxonomy', allow_multiple: true, verification_required: true },
    genre: { description: '内容体裁', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['paper', 'textbook', 'tutorial'], blacklist: { article: 'paper' } },
    lang: { description: '语言', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['en', 'zh', 'ja'] },
    mood: { description: '情绪状态', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['great', 'good', 'neutral', 'low', 'bad'] },
    status: { description: '进度状态', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['not-started', 'in-progress', 'completed'] },
    'programming-language': { description: '编程语言', value_type: 'enum', allow_multiple: true, verification_required: false, values: ['python', 'javascript', 'typescript'] },
    'event-type': { description: '事件类型', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['social', 'academic'] },
    'finance-type': { description: '财务类型', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['income', 'expense'] },
    'amount-range': { description: '金额区间', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['<100', '100-500'] },
    category: { description: '消费/财务分类', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['food', 'transport'] },
    recurring: { description: '是否周期性', value_type: 'enum', allow_multiple: false, verification_required: false, values: ['daily', 'monthly'] },
    scholar: { description: '学者/研究者', value_type: 'wikilink', allow_multiple: true, verification_required: false },
    people: { description: '相关人物', value_type: 'wikilink', allow_multiple: true, verification_required: false },
    collaborator: { description: '协作者', value_type: 'wikilink', allow_multiple: true, verification_required: false },
    venue: { description: '会议/期刊名称', value_type: 'free-text', allow_multiple: false, verification_required: false },
    location: { description: '地点', value_type: 'free-text', allow_multiple: false, verification_required: false },
    'source-repo': { description: '源代码仓库 URL', value_type: 'free-text', allow_multiple: false, verification_required: false },
  },
};

describe('SchemaResolver', () => {
  const resolver = new SchemaResolver(TEST_SCHEMA);

  describe('resolve()', () => {
    it('resolves academic type with correct required/optional facets', () => {
      const result = resolver.resolve('academic');
      expect(result.typeName).toBe('academic');
      expect(result.label).toBe('学术研究');
      expect(Object.keys(result.requiredFacets)).toEqual(['domain', 'genre', 'lang']);
      expect(Object.keys(result.optionalFacets)).toContain('method');
      expect(Object.keys(result.optionalFacets)).toContain('algorithm');
      expect(Object.keys(result.optionalFacets)).toContain('scholar');
      expect(Object.keys(result.optionalFacets)).toContain('venue');
    });

    it('resolves journal type with required mood + optional facets', () => {
      const result = resolver.resolve('journal');
      expect(result.typeName).toBe('journal');
      expect(Object.keys(result.requiredFacets)).toEqual(['mood']);
      expect(Object.keys(result.optionalFacets)).toContain('people');
      expect(Object.keys(result.optionalFacets)).toContain('reflection-topic');
    });

    it('includes enum values and blacklist in facet definitions', () => {
      const result = resolver.resolve('academic');
      const genre = result.requiredFacets['genre'];
      expect(genre).toBeDefined();
      expect(genre!.value_type).toBe('enum');
      expect(genre!.values).toContain('paper');
      expect(genre!.blacklist).toEqual({ article: 'paper' });
    });

    it('throws on unknown type', () => {
      expect(() => resolver.resolve('nonexistent')).toThrow('Unknown note type: nonexistent');
    });

    it('warns and skips missing facet definitions', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const badSchema: Schema = {
        version: 1,
        note_types: {
          test: {
            label: 'Test',
            description: 'Test type',
            required_facets: ['missing-facet'],
            optional_facets: [],
          },
        },
        facet_definitions: {},
      };
      const badResolver = new SchemaResolver(badSchema);
      const result = badResolver.resolve('test');
      expect(Object.keys(result.requiredFacets)).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith('Facet definition not found: missing-facet');
      warnSpy.mockRestore();
    });
  });

  describe('getAllTypes()', () => {
    it('returns summaries for all note types', () => {
      const types = resolver.getAllTypes();
      expect(types).toHaveLength(4); // 4 types in test schema
      const names = types.map(t => t.name);
      expect(names).toContain('academic');
      expect(names).toContain('journal');
      expect(names).toContain('finance');
      expect(names).toContain('project');
    });

    it('each summary has name, label, description', () => {
      const types = resolver.getAllTypes();
      const academic = types.find(t => t.name === 'academic');
      expect(academic).toBeDefined();
      expect(academic!.label).toBe('学术研究');
      expect(academic!.description).toContain('学术论文');
    });
  });

  describe('getTaxonomyFacets()', () => {
    it('returns taxonomy facets for academic', () => {
      const facets = resolver.getTaxonomyFacets('academic');
      expect(facets).toContain('domain');
      expect(facets).toContain('method');
      expect(facets).toContain('algorithm');
      expect(facets).toContain('concept');
      expect(facets).toContain('software');
      // Should NOT contain enum/wikilink/free-text facets
      expect(facets).not.toContain('genre');
      expect(facets).not.toContain('lang');
      expect(facets).not.toContain('scholar');
      expect(facets).not.toContain('venue');
    });

    it('returns only reflection-topic for journal', () => {
      const facets = resolver.getTaxonomyFacets('journal');
      expect(facets).toEqual(['reflection-topic']);
    });

    it('returns empty array for finance (no taxonomy facets)', () => {
      const facets = resolver.getTaxonomyFacets('finance');
      expect(facets).toEqual([]);
    });

    it('returns taxonomy facets for project including tech-stack', () => {
      const facets = resolver.getTaxonomyFacets('project');
      expect(facets).toContain('domain');
      expect(facets).toContain('tech-stack');
      expect(facets).toContain('software');
    });

    it('throws on unknown type', () => {
      expect(() => resolver.getTaxonomyFacets('nonexistent')).toThrow('Unknown note type: nonexistent');
    });
  });
});
