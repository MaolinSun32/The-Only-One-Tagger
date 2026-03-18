import type { SchemaStore } from '../storage/schema-store';
import type { RegistryStore } from '../storage/registry-store';
import { DEFAULT_SCHEMA } from './seed-schema';
import { SEED_TAGS } from './seed-registry';
import type { Registry, TagEntry } from '../types';

export class SeedInitializer {
  private schemaStore: SchemaStore;
  private registryStore: RegistryStore;

  constructor(schemaStore: SchemaStore, registryStore: RegistryStore) {
    this.schemaStore = schemaStore;
    this.registryStore = registryStore;
  }

  /**
   * 首次启动检测与初始化（幂等）。
   * - schema: note_types 为空 → 写入 DEFAULT_SCHEMA
   * - registry: tags 为空 → 写入种子标签
   */
  async initialize(): Promise<void> {
    await this.initializeSchema();
    await this.initializeRegistry();
  }

  private async initializeSchema(): Promise<void> {
    const schema = await this.schemaStore.load();
    if (!schema.note_types || Object.keys(schema.note_types).length === 0) {
      await this.schemaStore.save(DEFAULT_SCHEMA);
    }
  }

  private async initializeRegistry(): Promise<void> {
    const registry = await this.registryStore.load();
    if (registry.tags && Object.keys(registry.tags).length > 0) return; // 已有数据，保护用户增加的标签

    const now = new Date().toISOString();
    const tags: Record<string, TagEntry> = {};
    for (const seed of SEED_TAGS) {
      tags[seed.label] = {
        ...seed,
        source: { ...seed.source, verified_at: now },
      };
    }

    const seededRegistry: Registry = {
      meta: {
        version: 1,
        last_updated: now,
        total_tags: SEED_TAGS.length,
      },
      tags,
    };
    await this.registryStore.save(seededRegistry);
  }
}
