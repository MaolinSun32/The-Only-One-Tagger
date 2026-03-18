/**
 * Converts arbitrary-format strings to lowercase-hyphenated canonical form.
 * Pure static utility — no dependencies on stores or Obsidian API.
 */
export class TagNormalizer {
  /**
   * Normalize any tag string to lowercase-hyphenated form.
   *
   * Rules applied in order:
   * 1. Trim whitespace
   * 2. CamelCase split (insert hyphens at case boundaries)
   * 3. Spaces → hyphens
   * 4. Underscores → hyphens
   * 5. Lowercase Latin characters only (CJK preserved)
   * 6. Collapse duplicate hyphens
   * 7. Strip leading/trailing hyphens
   */
  static normalize(input: string): string {
    let result = input.trim();

    if (result.length === 0) return '';

    // CamelCase split: lowercase/digit followed by uppercase
    result = result.replace(/([a-z0-9])([A-Z])/g, '$1-$2');
    // CamelCase split: consecutive uppercase followed by uppercase+lowercase
    result = result.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');

    // Spaces → hyphens
    result = result.replace(/\s+/g, '-');
    // Underscores → hyphens
    result = result.replace(/_/g, '-');

    // Lowercase only ASCII uppercase (preserves CJK)
    result = result.replace(/[A-Z]/g, c => c.toLowerCase());

    // Collapse duplicate hyphens
    result = result.replace(/-{2,}/g, '-');
    // Strip leading/trailing hyphens
    result = result.replace(/^-+|-+$/g, '');

    return result;
  }
}
