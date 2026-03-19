import { arrayBufferToBase64, type App, type TFile } from 'obsidian';
import type { ContentPart } from './generation-provider';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const IMAGE_EMBED_RE = /!\[\[([^\]]+)\]\]/g;

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * 从笔记内容中提取嵌入图片，转为 base64 ContentPart[]。
 * 跳过非图片嵌入和找不到的文件，不会中断流程。
 */
export class ImageExtractor {
  constructor(private readonly app: App) {}

  async extractImages(noteContent: string, sourcePath: string): Promise<ContentPart[]> {
    const parts: ContentPart[] = [];
    const seen = new Set<string>();

    let match: RegExpExecArray | null;
    const regex = new RegExp(IMAGE_EMBED_RE.source, IMAGE_EMBED_RE.flags);

    while ((match = regex.exec(noteContent)) !== null) {
      // Strip |size suffix: ![[image.png|300]] → image.png
      const linkText = match[1]!.split('|')[0]!.trim();
      if (seen.has(linkText)) continue;
      seen.add(linkText);

      // Check extension
      const ext = linkText.split('.').pop()?.toLowerCase() ?? '';
      if (!IMAGE_EXTENSIONS.has(ext)) continue;

      try {
        const file = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
        if (!file) continue;

        const buffer = await this.app.vault.readBinary(file as TFile);
        const base64 = arrayBufferToBase64(buffer);
        const mime = MIME_MAP[ext] ?? 'image/png';

        parts.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${base64}` },
        });
      } catch {
        // Skip failed images silently
      }
    }

    return parts;
  }
}
