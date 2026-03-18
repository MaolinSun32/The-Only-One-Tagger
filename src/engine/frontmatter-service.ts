import type { App, TFile } from 'obsidian';
import type { TaggedNote, TagWriteData } from '../types';

/**
 * Structured YAML frontmatter read/write via Obsidian's processFrontMatter API.
 * Never directly manipulates YAML strings — always goes through the official API.
 *
 * Caller is responsible for providing correctly-formatted values in TagWriteData:
 * - allow_multiple: true  → string[]
 * - allow_multiple: false → string
 */
export class FrontmatterService {
  constructor(private app: App) {}

  /**
   * Read current YAML frontmatter into a structured TaggedNote.
   * Returns empty structure if no frontmatter or no type field.
   */
  async read(file: TFile): Promise<TaggedNote> {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    if (!fm) {
      return { types: [], typeData: {}, tagVersion: 0, taggedAt: '' };
    }

    // Extract type field (ensure array)
    let types: string[];
    if (Array.isArray(fm.type)) {
      types = fm.type as string[];
    } else if (typeof fm.type === 'string') {
      types = [fm.type];
    } else {
      types = [];
    }

    // Extract type blocks
    const typeData: Record<string, Record<string, unknown>> = {};
    for (const typeName of types) {
      const block = fm[typeName];
      if (block && typeof block === 'object' && !Array.isArray(block)) {
        typeData[typeName] = { ...(block as Record<string, unknown>) };
      }
    }

    const tagVersion = typeof fm._tag_version === 'number' ? fm._tag_version : 0;
    const taggedAt = typeof fm._tagged_at === 'string' ? fm._tagged_at : '';

    return { types, typeData, tagVersion, taggedAt };
  }

  /**
   * Full-replacement write. Merges type array (dedup), replaces type blocks,
   * increments _tag_version, updates _tagged_at.
   *
   * Type blocks not mentioned in data.typeData are preserved unchanged.
   * Deleted tags are excluded from typeData by the caller → removed from YAML.
   */
  async write(file: TFile, data: TagWriteData): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      // 1. Merge type array (dedup)
      const existingTypes: string[] = Array.isArray(frontmatter.type)
        ? [...frontmatter.type]
        : frontmatter.type ? [frontmatter.type] : [];

      for (const t of data.types) {
        if (!existingTypes.includes(t)) {
          existingTypes.push(t);
        }
      }
      frontmatter.type = existingTypes;

      // 2. Replace type blocks (full overwrite per type)
      for (const [typeName, facetMap] of Object.entries(data.typeData)) {
        frontmatter[typeName] = {};
        for (const [facetName, value] of Object.entries(facetMap)) {
          frontmatter[typeName][facetName] = value;
        }
      }

      // 3. Unmentioned existing type blocks are untouched

      // 4. Increment _tag_version
      const currentVersion = typeof frontmatter._tag_version === 'number'
        ? frontmatter._tag_version : 0;
      frontmatter._tag_version = currentVersion + 1;

      // 5. Update _tagged_at
      frontmatter._tagged_at = new Date().toISOString().split('T')[0];
    });
  }

  /**
   * Remove a type and its entire facet block from frontmatter.
   * Does NOT modify _tag_version or _tagged_at.
   */
  async removeTypeBlock(file: TFile, type: string): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      // Remove from type array
      if (Array.isArray(frontmatter.type)) {
        frontmatter.type = frontmatter.type.filter((t: string) => t !== type);
      }

      // Delete the type block
      delete frontmatter[type];
    });
  }
}
