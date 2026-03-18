import type { App } from 'obsidian';

/** wikilink 类型 facet 名称列表 */
const WIKILINK_FACETS = [
  'scholar', 'people', 'person', 'participants',
  'collaborator', 'instructor', 'provider', 'company',
] as const;

/** 正则：提取 [[Name]] 中的 Name */
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * 从 vault 中收集所有 wikilink facet 的值，合并为去重池。
 * 通过 metadataCache 扫描，不额外缓存。
 */
export class WikilinkCandidateCollector {
  constructor(private app: App) {}

  /** 返回去重后的 wikilink 候选数组，最大长度 maxCandidates */
  collect(maxCandidates: number): string[] {
    const pool = new Set<string>();

    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;

      for (const facet of WIKILINK_FACETS) {
        const raw = fm[facet];
        if (raw == null) continue;

        const values = Array.isArray(raw) ? raw : [raw];
        for (const v of values) {
          if (typeof v !== 'string') continue;
          // 提取 [[Name]] 形式
          let m: RegExpExecArray | null;
          WIKILINK_RE.lastIndex = 0;
          while ((m = WIKILINK_RE.exec(v)) !== null) {
            const name = m[1]!.trim();
            if (name) pool.add(name);
          }
          // 也支持纯字符串（无双括号），视为已知名称
          if (!v.includes('[[')) {
            const trimmed = v.trim();
            if (trimmed) pool.add(trimmed);
          }
        }
      }
    }

    return Array.from(pool).slice(0, maxCandidates);
  }
}
