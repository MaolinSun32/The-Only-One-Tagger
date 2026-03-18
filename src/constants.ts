import type { TootSettings } from './types';

export const TOOT_VIEW_TYPE = 'toot-tag-review';

// 数据文件名
export const TAG_SCHEMA_FILE = 'tag-schema.json';
export const TAG_REGISTRY_FILE = 'tag-registry.json';
export const TAG_STAGING_FILE = 'tag-staging.json';
export const VERIFICATION_QUEUE_FILE = 'verification-queue.json';
export const BATCH_STATE_FILE = 'batch-state.json';
export const MERGE_STATE_FILE = 'merge-state.json';
export const SCHEMA_SYNC_STATE_FILE = 'schema-sync-state.json';
export const BACKUPS_DIR = 'backups';

// 12 种笔记类型名称
export const NOTE_TYPES = [
  'academic', 'project', 'course', 'journal', 'growth',
  'relationship', 'meeting', 'finance', 'health', 'career',
  'creative', 'admin'
] as const;

// 插件生成的 YAML 字段名列表
export const PLUGIN_YAML_FIELDS: string[] = [
  'type',
  ...NOTE_TYPES,
  '_tag_version',
  '_tagged_at'
];

// 默认设置值
export const DEFAULT_SETTINGS: TootSettings = {
  generation_api_key: '',
  generation_base_url: '',
  generation_model: '',
  generation_temperature: 0.7,
  generation_max_tokens: 2048,

  verification_api_key: '',
  verification_base_url: '',
  verification_model: '',
  verification_temperature: 0.3,

  search_type: 'brave',
  search_api_key: '',
  search_base_url: '',

  knowledge_base_source: 'wikipedia',
  knowledge_base_lang: 'en',
  use_knowledge_base: true,

  max_tags_per_facet: 5,
  regenerate_count: 5,
  max_wikilink_candidates: 100,

  batch_concurrency: 1,
  max_batch_size: 50,
  request_timeout_ms: 30000,
  ping_interval_ms: 60000,
};
