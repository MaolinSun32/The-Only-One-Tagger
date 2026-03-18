import { App, TFile } from 'obsidian';
import type { ScanFilter } from '../types';

/**
 * 枚举 vault 中的 markdown 文件，按过滤条件筛选并按路径字母序排序。
 * 返回的有序列表保证路径集合恢复（batch-state.json）的确定性。
 */
export class VaultScanner {
  constructor(private app: App) {}

  /**
   * 扫描符合条件的 markdown 文件。
   * @returns 按 file.path 字母序升序排列的 TFile[]
   */
  scan(filter: ScanFilter): TFile[] {
    let files = this.app.vault.getMarkdownFiles();

    // 文件夹包含过滤：folders 非空时只保留路径以指定文件夹开头的文件
    if (filter.folders.length > 0) {
      files = files.filter(file =>
        filter.folders.some(folder => file.path.startsWith(folder)),
      );
    }

    // 文件夹排除过滤
    if (filter.excludeFolders && filter.excludeFolders.length > 0) {
      files = files.filter(file =>
        !filter.excludeFolders!.some(folder => file.path.startsWith(folder)),
      );
    }

    // 跳过已打标笔记：检测 _tagged_at 字段
    if (filter.skip_tagged) {
      files = files.filter(file => {
        const cache = this.app.metadataCache.getFileCache(file);
        return !cache?.frontmatter?._tagged_at;
      });
    }

    // 按路径字母序排序，确保恢复时顺序一致
    files.sort((a, b) => a.path.localeCompare(b.path));

    return files;
  }
}
