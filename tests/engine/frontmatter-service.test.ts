import { describe, it, expect } from 'vitest';
import type { App, TFile } from 'obsidian';
import { FrontmatterService } from '../../src/engine/frontmatter-service';

const mockFile = { path: 'test/note.md', basename: 'note' } as TFile;

// Helper: create mock App with controllable frontmatter cache and processFrontMatter
function createMockApp(
  cachedFrontmatter?: Record<string, unknown>,
): { app: App; lastFrontmatter: () => Record<string, unknown> } {
  let capturedFm: Record<string, unknown> = {};

  const app = {
    metadataCache: {
      getFileCache: () =>
        cachedFrontmatter ? { frontmatter: cachedFrontmatter } : null,
    },
    fileManager: {
      processFrontMatter: async (
        _file: TFile,
        fn: (fm: Record<string, unknown>) => void,
      ) => {
        // Start from cached state or empty
        capturedFm = cachedFrontmatter ? { ...cachedFrontmatter } : {};
        fn(capturedFm);
      },
    },
  } as unknown as App;

  return { app, lastFrontmatter: () => capturedFm };
}

describe('FrontmatterService', () => {
  describe('read()', () => {
    it('returns empty structure for no frontmatter', async () => {
      const { app } = createMockApp(undefined);
      const service = new FrontmatterService(app);
      const result = await service.read(mockFile);

      expect(result.types).toEqual([]);
      expect(result.typeData).toEqual({});
      expect(result.tagVersion).toBe(0);
      expect(result.taggedAt).toBe('');
    });

    it('reads single type with facet data', async () => {
      const { app } = createMockApp({
        type: ['academic'],
        academic: { domain: ['nlp', 'ml'], genre: 'paper' },
        _tag_version: 1,
        _tagged_at: '2026-03-11',
      });
      const service = new FrontmatterService(app);
      const result = await service.read(mockFile);

      expect(result.types).toEqual(['academic']);
      expect(result.typeData['academic']).toBeDefined();
      expect(result.typeData['academic']['domain']).toEqual(['nlp', 'ml']);
      expect(result.typeData['academic']['genre']).toBe('paper');
      expect(result.tagVersion).toBe(1);
      expect(result.taggedAt).toBe('2026-03-11');
    });

    it('handles string type (wraps in array)', async () => {
      const { app } = createMockApp({
        type: 'academic',
        academic: { domain: ['nlp'] },
      });
      const service = new FrontmatterService(app);
      const result = await service.read(mockFile);

      expect(result.types).toEqual(['academic']);
    });

    it('handles missing type field', async () => {
      const { app } = createMockApp({ _tag_version: 2 });
      const service = new FrontmatterService(app);
      const result = await service.read(mockFile);

      expect(result.types).toEqual([]);
      expect(result.tagVersion).toBe(2);
    });

    it('preserves wikilink format', async () => {
      const { app } = createMockApp({
        type: ['academic'],
        academic: { scholar: ['[[Vaswani-A]]', '[[Shazeer-N]]'] },
      });
      const service = new FrontmatterService(app);
      const result = await service.read(mockFile);

      expect(result.typeData['academic']['scholar']).toEqual(['[[Vaswani-A]]', '[[Shazeer-N]]']);
    });
  });

  describe('write()', () => {
    it('writes single type with facets', async () => {
      const { app, lastFrontmatter } = createMockApp({});
      const service = new FrontmatterService(app);

      await service.write(mockFile, {
        types: ['academic'],
        typeData: {
          academic: { domain: ['nlp'], genre: 'paper' },
        },
      });

      const fm = lastFrontmatter();
      expect(fm.type).toEqual(['academic']);
      expect(fm['academic']).toEqual({ domain: ['nlp'], genre: 'paper' });
      expect(fm._tag_version).toBe(1);
      expect(fm._tagged_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('merges type array (dedup)', async () => {
      const { app, lastFrontmatter } = createMockApp({
        type: ['academic'],
        academic: { domain: ['nlp'] },
      });
      const service = new FrontmatterService(app);

      await service.write(mockFile, {
        types: ['academic', 'project'],
        typeData: {
          project: { domain: ['web'], status: 'in-progress' },
        },
      });

      const fm = lastFrontmatter();
      expect(fm.type).toEqual(['academic', 'project']);
    });

    it('full replacement: old facet values are overwritten', async () => {
      const { app, lastFrontmatter } = createMockApp({
        type: ['academic'],
        academic: { domain: ['nlp', 'ml'], genre: 'paper' },
      });
      const service = new FrontmatterService(app);

      await service.write(mockFile, {
        types: ['academic'],
        typeData: {
          academic: { domain: ['nlp', 'attention'], genre: 'tutorial' },
        },
      });

      const fm = lastFrontmatter();
      // Full replacement — old values gone
      expect(fm['academic']).toEqual({ domain: ['nlp', 'attention'], genre: 'tutorial' });
    });

    it('preserves unmentioned type blocks', async () => {
      const { app, lastFrontmatter } = createMockApp({
        type: ['academic', 'project'],
        academic: { domain: ['nlp'] },
        project: { domain: ['web'], status: 'in-progress' },
      });
      const service = new FrontmatterService(app);

      // Only update academic
      await service.write(mockFile, {
        types: ['academic'],
        typeData: {
          academic: { domain: ['attention'] },
        },
      });

      const fm = lastFrontmatter();
      // project block should be untouched
      expect(fm['project']).toEqual({ domain: ['web'], status: 'in-progress' });
    });

    it('increments _tag_version', async () => {
      const { app, lastFrontmatter } = createMockApp({
        _tag_version: 3,
      });
      const service = new FrontmatterService(app);

      await service.write(mockFile, { types: ['academic'], typeData: { academic: {} } });
      expect(lastFrontmatter()._tag_version).toBe(4);
    });

    it('starts _tag_version at 1 when missing', async () => {
      const { app, lastFrontmatter } = createMockApp({});
      const service = new FrontmatterService(app);

      await service.write(mockFile, { types: ['academic'], typeData: { academic: {} } });
      expect(lastFrontmatter()._tag_version).toBe(1);
    });
  });

  describe('removeTypeBlock()', () => {
    it('removes type from array and deletes block', async () => {
      const { app, lastFrontmatter } = createMockApp({
        type: ['academic', 'project'],
        academic: { domain: ['nlp'] },
        project: { domain: ['web'] },
        _tag_version: 2,
        _tagged_at: '2026-03-11',
      });
      const service = new FrontmatterService(app);

      await service.removeTypeBlock(mockFile, 'academic');

      const fm = lastFrontmatter();
      expect(fm.type).toEqual(['project']);
      expect(fm['academic']).toBeUndefined();
      expect(fm['project']).toEqual({ domain: ['web'] });
      // Version and date unchanged
      expect(fm._tag_version).toBe(2);
      expect(fm._tagged_at).toBe('2026-03-11');
    });

    it('handles removing the only type', async () => {
      const { app, lastFrontmatter } = createMockApp({
        type: ['academic'],
        academic: { domain: ['nlp'] },
      });
      const service = new FrontmatterService(app);

      await service.removeTypeBlock(mockFile, 'academic');

      const fm = lastFrontmatter();
      expect(fm.type).toEqual([]);
      expect(fm['academic']).toBeUndefined();
    });
  });
});
