import type {
  Schema,
  FacetDefinition,
  ResolvedSchema,
  TypeSummary,
} from '../types';

/**
 * Runtime query interface for the type→facet decision tree.
 * Given a note type name, resolves the full set of facet definitions.
 *
 * Accepts a pre-loaded Schema object (from SchemaStore.load()).
 * All methods are synchronous — no I/O at query time.
 */
export class SchemaResolver {
  constructor(private schema: Schema) {}

  /**
   * Resolve a note type to its full facet definitions.
   * Throws if the type does not exist in the schema.
   */
  resolve(type: string): ResolvedSchema {
    const noteType = this.schema.note_types[type];
    if (!noteType) {
      throw new Error(`Unknown note type: ${type}`);
    }

    const requiredFacets: Record<string, FacetDefinition> = {};
    for (const facetName of noteType.required_facets) {
      const def = this.schema.facet_definitions[facetName];
      if (!def) {
        console.warn(`Facet definition not found: ${facetName}`);
        continue;
      }
      requiredFacets[facetName] = def;
    }

    const optionalFacets: Record<string, FacetDefinition> = {};
    for (const facetName of noteType.optional_facets) {
      const def = this.schema.facet_definitions[facetName];
      if (!def) {
        console.warn(`Facet definition not found: ${facetName}`);
        continue;
      }
      optionalFacets[facetName] = def;
    }

    return {
      typeName: type,
      label: noteType.label,
      description: noteType.description,
      requiredFacets,
      optionalFacets,
    };
  }

  /** Return summaries of all note types (for AI type-detection prompt). */
  getAllTypes(): TypeSummary[] {
    return Object.entries(this.schema.note_types).map(([name, nt]) => ({
      name,
      label: nt.label,
      description: nt.description,
    }));
  }

  /** Return all taxonomy-type facet names for a given note type. */
  getTaxonomyFacets(type: string): string[] {
    const resolved = this.resolve(type);
    const result: string[] = [];

    for (const [name, def] of Object.entries(resolved.requiredFacets)) {
      if (def.value_type === 'taxonomy') {
        result.push(name);
      }
    }
    for (const [name, def] of Object.entries(resolved.optionalFacets)) {
      if (def.value_type === 'taxonomy') {
        result.push(name);
      }
    }

    return result;
  }
}
