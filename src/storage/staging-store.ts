import type { App, PluginManifest } from 'obsidian';
import type { Staging, StagingNote, StagingTagItem, BadgeType, UserStatus } from '../types';
import { TAG_STAGING_FILE } from '../constants';
import { DataStore } from './data-store';

const DEFAULT_STAGING: Staging = {
  notes: {},
};

export class StagingStore extends DataStore<Staging> {
  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest, TAG_STAGING_FILE, DEFAULT_STAGING);
  }

  /**
   * 写入/覆盖整个笔记的分析结果。
   * 按 type 粒度覆盖：传入的 type 覆盖旧数据，其他 type 不受影响。
   */
  async writeNoteResult(
    notePath: string,
    typeData: Record<string, Record<string, StagingTagItem[]>>,
    analyzedAt: string,
    contentHash: string,
  ): Promise<void> {
    await this.update(data => {
      const existing = data.notes[notePath];
      if (existing) {
        existing.analyzed_at = analyzedAt;
        existing.content_hash = contentHash;
        for (const [typeName, facets] of Object.entries(typeData)) {
          existing.types[typeName] = facets;
        }
      } else {
        data.notes[notePath] = {
          analyzed_at: analyzedAt,
          content_hash: contentHash,
          types: typeData,
        };
      }
    });
  }

  /** 更新单个标签的 user_status。路径中任何层级不存在则跳过（幂等）。 */
  async updateTagStatus(
    notePath: string,
    type: string,
    facet: string,
    label: string,
    newStatus: UserStatus,
  ): Promise<void> {
    await this.update(data => {
      const entry = this.findEntry(data, notePath, type, facet, label);
      if (entry) {
        entry.user_status = newStatus;
      }
    });
  }

  /** 更新单个标签的 badge。路径中任何层级不存在则跳过（幂等）。 */
  async updateTagBadge(
    notePath: string,
    type: string,
    facet: string,
    label: string,
    newBadge: BadgeType,
  ): Promise<void> {
    await this.update(data => {
      const entry = this.findEntry(data, notePath, type, facet, label);
      if (entry) {
        entry.badge = newBadge;
      }
    });
  }

  /** Edit 替换操作：移除旧标签，在同一位置插入新标签。 */
  async replaceTag(
    notePath: string,
    type: string,
    facet: string,
    oldLabel: string,
    newEntry: StagingTagItem,
  ): Promise<void> {
    await this.update(data => {
      const items = data.notes[notePath]?.types[type]?.[facet];
      if (!items) {
        // facet 不存在，直接创建并插入
        const note = data.notes[notePath];
        if (note) {
          if (!note.types[type]) note.types[type] = {};
          note.types[type][facet] = [newEntry];
        }
        return;
      }
      const idx = items.findIndex(item => item.label === oldLabel);
      if (idx >= 0) {
        items.splice(idx, 1, newEntry);
      } else {
        items.push(newEntry);
      }
    });
  }

  /** 读取单笔记的完整 staging 数据。不在 staging 中返回 null。 */
  async getNoteStaging(notePath: string): Promise<StagingNote | null> {
    const data = await this.load();
    return data.notes[notePath] ?? null;
  }

  /**
   * applyAll 后增量清理。
   * 移除 accepted/deleted 条目，保留 pending。
   * 清空的 type 块和笔记条目自动移除。
   */
  async cleanupProcessedTags(notePath: string, typesToClean: string[]): Promise<void> {
    await this.update(data => {
      const note = data.notes[notePath];
      if (!note) return;

      for (const typeName of typesToClean) {
        const facets = note.types[typeName];
        if (!facets) continue;

        for (const [facetName, items] of Object.entries(facets)) {
          facets[facetName] = items.filter(item => item.user_status === 'pending');
          if (facets[facetName].length === 0) {
            delete facets[facetName];
          }
        }

        if (Object.keys(facets).length === 0) {
          delete note.types[typeName];
        }
      }

      if (Object.keys(note.types).length === 0) {
        delete data.notes[notePath];
      }
    });
  }

  /**
   * 全局标签操作：遍历所有笔记的所有 type/facet。
   * updater 返回新条目 → 替换；返回 null → 移除。
   */
  async findAndUpdateTagGlobally(
    label: string,
    updater: (entry: StagingTagItem) => StagingTagItem | null,
  ): Promise<void> {
    await this.update(data => {
      for (const [notePath, note] of Object.entries(data.notes)) {
        for (const [typeName, facets] of Object.entries(note.types)) {
          for (const [facetName, items] of Object.entries(facets)) {
            for (let i = items.length - 1; i >= 0; i--) {
              const item = items[i];
              if (item && item.label === label) {
                const result = updater(item);
                if (result === null) {
                  items.splice(i, 1);
                } else {
                  items[i] = result;
                }
              }
            }
            // 清理空 facet
            if (items.length === 0) {
              delete facets[facetName];
            }
          }
          // 清理空 type
          if (Object.keys(facets).length === 0) {
            delete note.types[typeName];
          }
        }
        // 清理空笔记
        if (Object.keys(note.types).length === 0) {
          delete data.notes[notePath];
        }
      }
    });
  }

  /** 向指定 facet 追加一个标签条目。 */
  async addTagToFacet(
    notePath: string,
    type: string,
    facet: string,
    newEntry: StagingTagItem,
  ): Promise<void> {
    await this.update(data => {
      const note = data.notes[notePath];
      if (!note) return;
      if (!note.types[type]) {
        note.types[type] = {};
      }
      if (!note.types[type][facet]) {
        note.types[type][facet] = [];
      }
      note.types[type][facet].push(newEntry);
    });
  }

  /** 内部辅助：沿 notePath → type → facet → label 路径查找条目 */
  private findEntry(
    data: Staging,
    notePath: string,
    type: string,
    facet: string,
    label: string,
  ): StagingTagItem | undefined {
    const items = data.notes[notePath]?.types[type]?.[facet];
    return items?.find(item => item.label === label);
  }
}
