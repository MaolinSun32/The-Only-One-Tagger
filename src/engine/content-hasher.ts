import type { App, TFile } from 'obsidian';

/**
 * Computes SHA-256 hash of note body content (excluding frontmatter).
 * Ensures that writing tags to YAML frontmatter does not change the hash.
 */
export class ContentHasher {
  constructor(private app: App) {}

  /**
   * Compute the first 8 hex characters of SHA-256 of the note's body.
   * Body = everything after the YAML frontmatter block.
   */
  async hash(file: TFile): Promise<string> {
    const content = await this.app.vault.read(file);
    const body = this.extractBody(content);

    const encoded = new TextEncoder().encode(body);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return hashHex.substring(0, 8);
  }

  /**
   * Extract body content after frontmatter.
   * - No frontmatter (doesn't start with ---): return full content
   * - Unclosed frontmatter: return empty string
   * - Normal: return everything after the closing --- line
   */
  private extractBody(content: string): string {
    if (!content.startsWith('---')) {
      return content;
    }

    // Find closing --- (search for \n--- starting after the opening ---)
    const secondDashIndex = content.indexOf('\n---', 3);
    if (secondDashIndex === -1) {
      // Frontmatter not closed — treat as all frontmatter, empty body
      return '';
    }

    // Skip past \n--- and the line break that follows it
    const afterClosing = content.indexOf('\n', secondDashIndex + 4);
    if (afterClosing === -1) {
      // Nothing after the closing --- line
      return '';
    }

    return content.substring(afterClosing + 1);
  }
}
