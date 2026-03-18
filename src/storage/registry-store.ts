import type { App, PluginManifest } from 'obsidian';
import type { Registry, TagEntry } from '../types';
import { TAG_REGISTRY_FILE } from '../constants';
import { DataStore } from './data-store';

const DEFAULT_REGISTRY: Registry = {
  meta: { version: 1, last_updated: '', total_tags: 0 },
  tags: {},
};

export class RegistryStore extends DataStore<Registry> {
  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest, TAG_REGISTRY_FILE, DEFAULT_REGISTRY);
  }

  /** 新增/更新 verified 标签。幂等：已存在时更新字段，不重复计数。 */
  async addTag(entry: TagEntry): Promise<void> {
    await this.update(data => {
      const existing = data.tags[entry.label];
      if (existing) {
        // 更新字段（如 verified_by 升级），不递增 total_tags
        Object.assign(existing, entry);
      } else {
        data.tags[entry.label] = entry;
        data.meta.total_tags++;
      }
      data.meta.last_updated = new Date().toISOString();
    });
  }

  /** 将标签标记为黑名单。幂等：已在黑名单中时跳过。 */
  async rejectTag(label: string, rejectedInFavorOf: string): Promise<void> {
    await this.update(data => {
      const tag = data.tags[label];
      if (tag && tag.status === 'rejected') return; // 已 rejected，跳过

      if (tag) {
        // 已有标签（可能是 verified）→ 改为 rejected
        tag.status = 'rejected';
        tag.rejected_in_favor_of = rejectedInFavorOf;
      } else {
        // 新增 rejected 条目
        data.tags[label] = {
          label,
          aliases: [],
          facets: [],
          status: 'rejected',
          rejected_in_favor_of: rejectedInFavorOf,
          relations: { broader: [], narrower: [], related: [] },
          source: { verified_by: 'manual', verified_at: new Date().toISOString() },
        };
        data.meta.total_tags++;
      }
      data.meta.last_updated = new Date().toISOString();
    });
  }

  /** 按 label 精确查找标签条目，未找到返回 null。 */
  async getTag(label: string): Promise<TagEntry | null> {
    const data = await this.load();
    return data.tags[label] ?? null;
  }

  /** 返回 facets 与给定参数有交集的所有 verified 标签。 */
  async getTagsByFacets(facets: string[]): Promise<TagEntry[]> {
    const data = await this.load();
    const result: TagEntry[] = [];
    for (const tag of Object.values(data.tags)) {
      if (tag.status === 'verified' && tag.facets.some(f => facets.includes(f))) {
        result.push(tag);
      }
    }
    return result;
  }

  /** 返回指定 facets 下的黑名单映射：{ rejectedLabel: rejected_in_favor_of }。 */
  async getBlacklistMap(facets: string[]): Promise<Record<string, string>> {
    const data = await this.load();
    const result: Record<string, string> = {};
    for (const tag of Object.values(data.tags)) {
      if (
        tag.status === 'rejected' &&
        tag.rejected_in_favor_of &&
        tag.facets.some(f => facets.includes(f))
      ) {
        result[tag.label] = tag.rejected_in_favor_of;
      }
    }
    return result;
  }

  /** 标记标签为 flagged（验证失败的已入库标签）。幂等。 */
  async flagTag(label: string): Promise<void> {
    await this.update(data => {
      const tag = data.tags[label];
      if (tag && tag.status === 'verified') {
        tag.flagged = true;
      }
    });
  }

  /** 取消标签的 flagged 标记。幂等。 */
  async unflagTag(label: string): Promise<void> {
    await this.update(data => {
      const tag = data.tags[label];
      if (tag) {
        tag.flagged = false;
      }
    });
  }

  /** 自动追加 facet 到已有标签的 facets 数组。去重，幂等。 */
  async expandFacets(label: string, newFacet: string): Promise<void> {
    await this.update(data => {
      const tag = data.tags[label];
      if (tag && !tag.facets.includes(newFacet)) {
        tag.facets.push(newFacet);
        data.meta.last_updated = new Date().toISOString();
      }
    });
  }

  /** 从 registry 中彻底移除标签条目。幂等：不存在时跳过。 */
  async deleteTag(label: string): Promise<void> {
    await this.update(data => {
      if (data.tags[label]) {
        delete data.tags[label];
        data.meta.total_tags--;
        data.meta.last_updated = new Date().toISOString();
      }
    });
  }

  /** 遍历所有标签的 aliases 数组查找匹配项。未命中返回 null。 */
  async findByAlias(alias: string): Promise<TagEntry | null> {
    const data = await this.load();
    for (const tag of Object.values(data.tags)) {
      if (tag.aliases.includes(alias)) {
        return tag;
      }
    }
    return null;
  }
}
