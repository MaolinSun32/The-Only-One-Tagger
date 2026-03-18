import { describe, it, expect } from 'vitest';
import type { App, TFile } from 'obsidian';
import { ContentHasher } from '../../src/engine/content-hasher';

function createMockApp(content: string): App {
  return {
    vault: {
      read: async () => content,
    },
  } as unknown as App;
}

const mockFile = { path: 'test/note.md', basename: 'note' } as TFile;

describe('ContentHasher', () => {
  it('hashes body only (excludes frontmatter)', async () => {
    const content = '---\ntype: [academic]\n---\nBody content here';
    const hasher = new ContentHasher(createMockApp(content));
    const hash = await hasher.hash(mockFile);
    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('changing frontmatter does not change hash', async () => {
    const body = 'Body content here';
    const content1 = '---\ntype: [academic]\n---\n' + body;
    const content2 = '---\ntype: [academic]\ndomain: [nlp]\n---\n' + body;

    const hash1 = await new ContentHasher(createMockApp(content1)).hash(mockFile);
    const hash2 = await new ContentHasher(createMockApp(content2)).hash(mockFile);

    expect(hash1).toBe(hash2);
  });

  it('changing body changes the hash', async () => {
    const hash1 = await new ContentHasher(
      createMockApp('---\ntype: [academic]\n---\nBody A')
    ).hash(mockFile);

    const hash2 = await new ContentHasher(
      createMockApp('---\ntype: [academic]\n---\nBody B')
    ).hash(mockFile);

    expect(hash1).not.toBe(hash2);
  });

  it('hashes full content when no frontmatter', async () => {
    const content = 'No frontmatter here, just content.';
    const hasher = new ContentHasher(createMockApp(content));
    const hash = await hasher.hash(mockFile);
    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns hash of empty string for empty body', async () => {
    const content = '---\ntype: [academic]\n---\n';
    const hasher = new ContentHasher(createMockApp(content));
    const hash = await hasher.hash(mockFile);
    // SHA-256 of empty string starts with "e3b0c442"
    expect(hash).toBe('e3b0c442');
  });

  it('returns hash of empty string for unclosed frontmatter', async () => {
    const content = '---\ntype: [academic]';
    const hasher = new ContentHasher(createMockApp(content));
    const hash = await hasher.hash(mockFile);
    expect(hash).toBe('e3b0c442');
  });

  it('always returns 8 hex characters', async () => {
    const hasher = new ContentHasher(createMockApp('Some content'));
    const hash = await hasher.hash(mockFile);
    expect(hash).toHaveLength(8);
  });

  it('handles CRLF line endings in frontmatter', async () => {
    const body = 'Body content';
    const content = '---\r\ntype: [academic]\r\n---\r\n' + body;
    const hasher = new ContentHasher(createMockApp(content));
    const hash = await hasher.hash(mockFile);

    // Should match hash of body only (without frontmatter)
    const bodyOnlyHash = await new ContentHasher(createMockApp(body)).hash(mockFile);
    expect(hash).toBe(bodyOnlyHash);
  });

  it('handles frontmatter with no content after closing ---', async () => {
    const content = '---\ntype: [academic]\n---';
    const hasher = new ContentHasher(createMockApp(content));
    const hash = await hasher.hash(mockFile);
    // Empty body
    expect(hash).toBe('e3b0c442');
  });
});
