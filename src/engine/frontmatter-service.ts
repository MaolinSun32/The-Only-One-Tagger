import type { App, TFile } from 'obsidian';
import type { TaggedNote, TagWriteData } from '../types';
import type { SchemaResolver } from './schema-resolver';

/**
 * Structured YAML frontmatter read/write via Obsidian's processFrontMatter API.
 * Never directly manipulates YAML strings — always goes through the official API.
 *
 * **扁平格式**：facet 直接作为顶层 key，不再嵌套在 type block 下。
 * 旧嵌套格式（`course: { domain: [...] }`）会在 read/write 时自动迁移为
 * 扁平格式（`domain: [...]`），保证 Obsidian Properties 视图正确渲染。
 *
 * Caller is responsible for providing correctly-formatted values in TagWriteData:
 * - allow_multiple: true  → string[]
 * - allow_multiple: false → string
 */
export class FrontmatterService {
  constructor(
    private app: App,
    private schemaResolver?: SchemaResolver,
  ) {}

  /**
   * Read current YAML frontmatter into a structured TaggedNote.
   * Supports both flat (new) and nested (legacy) formats.
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

    // Extract type data — try nested first (legacy), then flat (new)
    const typeData: Record<string, Record<string, unknown>> = {};
    for (const typeName of types) {
      const maybeNested = fm[typeName];
      if (maybeNested && typeof maybeNested === 'object' && !Array.isArray(maybeNested)) {
        // Legacy nested format: fm[typeName] = { facetName: value, ... }
        const cleaned: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(maybeNested as Record<string, unknown>)) {
          cleaned[key] = this.stripWikilinkBrackets(val);
        }
        typeData[typeName] = cleaned;
      } else if (this.schemaResolver) {
        // New flat format: read facets from top-level keys via schema
        try {
          const resolved = this.schemaResolver.resolve(typeName);
          const allFacetNames = [
            ...Object.keys(resolved.requiredFacets),
            ...Object.keys(resolved.optionalFacets),
          ];
          const facetData: Record<string, unknown> = {};
          for (const facetName of allFacetNames) {
            if (fm[facetName] !== undefined) {
              facetData[facetName] = this.stripWikilinkBrackets(fm[facetName]);
            }
          }
          if (Object.keys(facetData).length > 0) {
            typeData[typeName] = facetData;
          }
        } catch {
          // Type not in schema — skip
        }
      }
    }

    const tagVersion = typeof fm._tag_version === 'number' ? fm._tag_version : 0;
    const taggedAt = typeof fm._tagged_at === 'string' ? fm._tagged_at : '';

    return { types, typeData, tagVersion, taggedAt };
  }

  /**
   * Full-replacement write in **flat format**.
   * Merges type array (dedup), writes facets as top-level keys,
   * migrates any old nested blocks, increments _tag_version, updates _tagged_at.
   *
   * Type facets not mentioned in data.typeData are preserved unchanged.
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

      // 2. Migrate old nested blocks to flat for types NOT being overwritten,
      //    then delete all nested blocks
      for (const typeName of existingTypes) {
        const nested = frontmatter[typeName];
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          if (!(typeName in data.typeData)) {
            // Preserve existing facets at top level
            for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
              if (frontmatter[k] === undefined) {
                frontmatter[k] = v;
              }
            }
          }
          delete frontmatter[typeName];
        }
      }

      // 3. Clear old flat facets for types being written (full overwrite semantics)
      if (this.schemaResolver) {
        for (const typeName of data.types) {
          try {
            const resolved = this.schemaResolver.resolve(typeName);
            const allFacetNames = [
              ...Object.keys(resolved.requiredFacets),
              ...Object.keys(resolved.optionalFacets),
            ];
            for (const facetName of allFacetNames) {
              // Don't delete if shared with a non-written type that still needs it
              const isSharedWithNonWritten = existingTypes.some(t =>
                t !== typeName &&
                !(t in data.typeData) &&
                this.typeHasFacet(t, facetName),
              );
              if (!isSharedWithNonWritten) {
                delete frontmatter[facetName];
              }
            }
          } catch { /* type not in schema */ }
        }
      }

      // 4. Write new facet values at top level (merge for multi-type shared facets)
      for (const facetMap of Object.values(data.typeData)) {
        for (const [facetName, value] of Object.entries(facetMap)) {
          if (frontmatter[facetName] !== undefined) {
            frontmatter[facetName] = this.mergeValues(frontmatter[facetName], value);
          } else {
            frontmatter[facetName] = value;
          }
        }
      }

      // 5. Increment _tag_version
      const currentVersion = typeof frontmatter._tag_version === 'number'
        ? frontmatter._tag_version : 0;
      frontmatter._tag_version = currentVersion + 1;

      // 6. Update _tagged_at
      frontmatter._tagged_at = new Date().toISOString().split('T')[0];
    });
  }

  /**
   * Remove a type and its facets from frontmatter.
   * Handles both nested (legacy) and flat (new) formats.
   * Does NOT modify _tag_version or _tagged_at.
   */
  async removeTypeBlock(file: TFile, type: string): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      // Remove from type array
      if (Array.isArray(frontmatter.type)) {
        frontmatter.type = frontmatter.type.filter((t: string) => t !== type);
      }

      // Delete old nested block (if exists)
      delete frontmatter[type];

      // Delete flat facets belonging to this type (if not shared with remaining types)
      if (this.schemaResolver) {
        const remainingTypes: string[] = Array.isArray(frontmatter.type) ? frontmatter.type : [];
        try {
          const resolved = this.schemaResolver.resolve(type);
          const allFacetNames = [
            ...Object.keys(resolved.requiredFacets),
            ...Object.keys(resolved.optionalFacets),
          ];
          for (const facetName of allFacetNames) {
            const isSharedWithRemaining = remainingTypes.some(t => this.typeHasFacet(t, facetName));
            if (!isSharedWithRemaining) {
              delete frontmatter[facetName];
            }
          }
        } catch { /* type not in schema */ }
      }
    });
  }

  /** Check if a type has a specific facet in the schema */
  private typeHasFacet(typeName: string, facetName: string): boolean {
    if (!this.schemaResolver) return false;
    try {
      const resolved = this.schemaResolver.resolve(typeName);
      return facetName in resolved.requiredFacets || facetName in resolved.optionalFacets;
    } catch { return false; }
  }

  /** Merge two values — dedup arrays, prefer incoming for scalars */
  private mergeValues(existing: unknown, incoming: unknown): unknown {
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      const merged = [...existing];
      for (const v of incoming) {
        if (!merged.includes(v)) merged.push(v);
      }
      return merged;
    }
    return incoming;
  }

  /** Strip [[]] brackets from wikilink values (string or string[]) */
  private stripWikilinkBrackets(val: unknown): unknown {
    const strip = (s: string) => s.replace(/^\[\[/, '').replace(/\]\]$/, '');
    if (typeof val === 'string') return strip(val);
    if (Array.isArray(val)) return val.map(v => typeof v === 'string' ? strip(v) : v);
    return val;
  }
}
