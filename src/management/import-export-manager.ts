import type { RegistryStore } from '../storage/registry-store';
import type { Registry, TagEntry, ImportConflict, ImportStrategy } from '../types';

/**
 * Registry 的导入导出管理器。
 * 导出全量 JSON，导入时检测冲突并按策略处理。
 */
export class ImportExportManager {
  constructor(private registryStore: RegistryStore) {}

  /**
   * 导出 registry 全量 JSON 字符串。
   * 调用方负责处理文件保存对话框。
   */
  async exportJSON(): Promise<string> {
    const data = await this.registryStore.load();
    return JSON.stringify(data, null, 2);
  }

  /**
   * 检测导入冲突。
   * 1. 格式校验（合法 Registry 结构）
   * 2. 冲突检测（已有同名标签）
   * @returns 冲突列表
   * @throws 格式不合法时抛出错误
   */
  async detectConflicts(jsonData: string): Promise<ImportConflict[]> {
    const incoming = this.parseAndValidate(jsonData);
    const conflicts: ImportConflict[] = [];

    for (const [label, incomingTag] of Object.entries(incoming.tags)) {
      const existing = await this.registryStore.getTag(label);
      if (existing) {
        conflicts.push({ label, existing, incoming: incomingTag });
      }
    }

    return conflicts;
  }

  /**
   * 执行导入。
   * @param jsonData 导入的 JSON 数据
   * @param strategy 冲突处理策略
   * @param manualResolutions 手动选择结果（strategy 为 manual 时）
   */
  async import(
    jsonData: string,
    strategy: ImportStrategy,
    manualResolutions?: Record<string, 'keep' | 'replace'>,
  ): Promise<{ imported: number; skipped: number }> {
    const incoming = this.parseAndValidate(jsonData);
    let imported = 0;
    let skipped = 0;

    for (const [label, incomingTag] of Object.entries(incoming.tags)) {
      const existing = await this.registryStore.getTag(label);

      if (existing) {
        // 有冲突 — 按策略处理
        if (strategy === 'skip') {
          skipped++;
          continue;
        }

        if (strategy === 'manual') {
          const resolution = manualResolutions?.[label];
          if (!resolution || resolution === 'keep') {
            skipped++;
            continue;
          }
          // resolution === 'replace' → 继续写入
        }

        // strategy === 'overwrite' 或 manual resolution === 'replace'
      }

      await this.registryStore.addTag(incomingTag);
      imported++;
    }

    return { imported, skipped };
  }

  /**
   * 解析并校验 JSON 数据是否为合法 Registry 结构。
   * @throws 格式不合法时抛出描述性错误
   */
  private parseAndValidate(jsonData: string): Registry {
    let data: any;
    try {
      data = JSON.parse(jsonData);
    } catch {
      throw new Error('无效的 JSON 格式');
    }

    if (!data || typeof data !== 'object') {
      throw new Error('数据必须是 JSON 对象');
    }

    if (!data.meta || typeof data.meta !== 'object') {
      throw new Error('缺少 meta 字段');
    }

    if (!data.tags || typeof data.tags !== 'object') {
      throw new Error('缺少 tags 字段');
    }

    // 校验每个标签的必要字段
    for (const [label, tag] of Object.entries(data.tags)) {
      const t = tag as any;
      if (!t.label || typeof t.label !== 'string') {
        throw new Error(`标签 "${label}" 缺少有效的 label 字段`);
      }
      if (!t.status || (t.status !== 'verified' && t.status !== 'rejected')) {
        throw new Error(`标签 "${label}" 的 status 必须为 "verified" 或 "rejected"`);
      }
      // 确保必要的结构存在
      if (!Array.isArray(t.aliases)) t.aliases = [];
      if (!Array.isArray(t.facets)) t.facets = [];
      if (!t.relations || typeof t.relations !== 'object') {
        t.relations = { broader: [], narrower: [], related: [] };
      }
      if (!t.source || typeof t.source !== 'object') {
        t.source = { verified_by: 'manual', verified_at: new Date().toISOString() };
      }
    }

    return data as Registry;
  }
}
