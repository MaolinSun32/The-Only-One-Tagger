// ============================================================
// types.ts — The Only One Tagger 全项目类型契约
// ============================================================

import type { TFile } from 'obsidian';

// ────────────────────────────────────────────
// 基础联合类型
// ────────────────────────────────────────────

/** 标签验证来源 */
export type VerifiedBy = 'seed' | 'wikipedia' | 'ai_search' | 'manual';

/** 标签状态（registry 中） */
export type TagStatus = 'verified' | 'rejected';

/** Staging 中标签的验证 badge（信心级别） */
export type BadgeType =
  | 'verifying'
  | 'registry'
  | 'wiki_verified'
  | 'search_verified'
  | 'needs_review'
  | 'enum'
  | 'wikilink'
  | 'free_text'
  | 'date';

/** Staging 中标签的用户操作状态 */
export type UserStatus = 'pending' | 'accepted' | 'deleted';

/** Facet 值类型 */
export type ValueType = 'taxonomy' | 'enum' | 'wikilink' | 'free-text' | 'date';

/** 搜索 API 类型 */
export type SearchType = 'brave' | 'tavily';

/** 健康检查状态 */
export type HealthStatus = 'online' | 'offline' | 'not_configured';

/** 批量处理状态 */
export type BatchStatus = 'running' | 'paused' | 'completed' | 'terminated';

// ────────────────────────────────────────────
// tag-schema.json（决策树 Schema）
// ────────────────────────────────────────────

/** 单个 facet 定义 */
export interface FacetDefinition {
  description: string;
  value_type: ValueType;
  allow_multiple: boolean;
  verification_required: boolean;
  values?: string[];
  blacklist?: Record<string, string>;
}

/** 单个笔记类型定义 */
export interface NoteTypeSchema {
  label: string;
  description: string;
  required_facets: string[];
  optional_facets: string[];
}

/** tag-schema.json 顶层结构 */
export interface Schema {
  version: number;
  note_types: Record<string, NoteTypeSchema>;
  facet_definitions: Record<string, FacetDefinition>;
}

// ────────────────────────────────────────────
// tag-registry.json（标签库）
// ────────────────────────────────────────────

/** 标签关系（SKOS 风格） */
export interface TagRelations {
  broader: string[];
  narrower: string[];
  related: string[];
}

/** 标签来源信息 */
export interface TagSource {
  verified_by: VerifiedBy;
  url?: string;
  verified_at: string;
}

/** 单个标签条目 */
export interface TagEntry {
  label: string;
  aliases: string[];
  facets: string[];
  status: TagStatus;
  flagged?: boolean;
  rejected_in_favor_of?: string;
  relations: TagRelations;
  source: TagSource;
}

/** tag-registry.json 元信息 */
export interface RegistryMeta {
  version: number;
  last_updated: string;
  total_tags: number;
}

/** tag-registry.json 顶层结构 */
export interface Registry {
  meta: RegistryMeta;
  tags: Record<string, TagEntry>;
}

// ────────────────────────────────────────────
// tag-staging.json（暂存区）
// ────────────────────────────────────────────

/** 暂存区中单个标签条目 */
export interface StagingTagItem {
  label: string;
  badge: BadgeType;
  user_status: UserStatus;
  ai_recommended?: boolean;
  replaces?: string[];
}

/** 暂存区中单篇笔记条目 */
export interface StagingNote {
  analyzed_at: string;
  content_hash: string;
  types: Record<string, Record<string, StagingTagItem[]>>;
}

/** tag-staging.json 顶层结构 */
export interface Staging {
  notes: Record<string, StagingNote>;
}

// ────────────────────────────────────────────
// verification-queue.json（离线验证队列）
// ────────────────────────────────────────────

/** 离线验证队列条目 */
export interface VerificationQueueItem {
  id: string;
  tag_label: string;
  facet: string;
  suggested_by: 'ai' | 'user';
  source_notes: string[];
  queued_at: string;
  attempts: number;
}

/** verification-queue.json 顶层结构 */
export interface VerificationQueue {
  queue: VerificationQueueItem[];
}

// ────────────────────────────────────────────
// batch-state.json（批量处理进度）
// ────────────────────────────────────────────

/** 批量处理过滤条件 */
export interface BatchFilter {
  folders: string[];
  skip_tagged: boolean;
}

/** batch-state.json 顶层结构 */
export interface BatchState {
  task_id: string;
  started_at: string;
  status: BatchStatus;
  total_files: number;
  filter: BatchFilter;
  processed_files: string[];
  failed_files: Record<string, string>;
}

// ────────────────────────────────────────────
// data.json（用户设置）
// ────────────────────────────────────────────

/** 插件设置 */
export interface TootSettings {
  // Generation AI
  generation_api_key: string;
  generation_base_url: string;
  generation_model: string;
  generation_temperature: number;
  generation_max_tokens: number;

  // Verification AI
  verification_api_key: string;
  verification_base_url: string;
  verification_model: string;
  verification_temperature: number;

  // Search API
  search_type: SearchType;
  search_api_key: string;
  search_base_url: string;

  // Knowledge Base
  knowledge_base_source: string;
  knowledge_base_lang: string;
  use_knowledge_base: boolean;

  // 标签行为
  max_tags_per_facet: number;
  regenerate_count: number;
  max_wikilink_candidates: number;

  // 批量处理 & 网络
  batch_concurrency: number;
  max_batch_size: number;
  request_timeout_ms: number;
  ping_interval_ms: number;
}

// ────────────────────────────────────────────
// FrontmatterService 写入参数（M3 使用）
// ────────────────────────────────────────────

export interface TagWriteData {
  types: string[];
  typeData: Record<string, Record<string, any>>;
}

// ────────────────────────────────────────────
// 验证管线相关（M4 使用）
// ────────────────────────────────────────────

/** 搜索结果条目 */
export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/** 验证结果 */
export interface VerificationResult {
  verified: boolean;
  badge: BadgeType;
  url?: string;
  source: VerifiedBy;
}

// ────────────────────────────────────────────
// SchemaResolver 输出（M3 使用）
// ────────────────────────────────────────────

/** resolve() 返回的单个 type 的完整 facet 定义集合 */
export interface ResolvedSchema {
  typeName: string;
  label: string;
  description: string;
  requiredFacets: Record<string, FacetDefinition>;
  optionalFacets: Record<string, FacetDefinition>;
}

/** getAllTypes() 返回的 type 摘要 */
export interface TypeSummary {
  name: string;
  label: string;
  description: string;
}

// ────────────────────────────────────────────
// TagMatcher 输出（M3 使用）
// ────────────────────────────────────────────

/** 标签匹配类型 */
export type MatchType = 'exact' | 'alias';

/** TagMatcher.match() 的返回值 */
export interface TagMatchResult {
  matched: boolean;
  matchType?: MatchType;
  entry?: TagEntry;
}

// ────────────────────────────────────────────
// FrontmatterService 读取输出（M3 使用）
// ────────────────────────────────────────────

/** 从 YAML 读取的已标记笔记结构 */
export interface TaggedNote {
  types: string[];
  typeData: Record<string, Record<string, any>>;
  tagVersion: number;
  taggedAt: string;
}

// ────────────────────────────────────────────
// 合并/同步状态文件（M8/M6 使用）
// ────────────────────────────────────────────

/** merge-state.json / schema-sync-state.json 状态 */
export type BulkOpStatus = 'running' | 'completed';

/** merge-state.json 结构 */
export interface MergeState {
  source_tag: string;
  target_tag: string | null;
  pending_files: string[];
  completed_files: string[];
  status: BulkOpStatus;
}

/** schema-sync-state.json 结构 */
export interface SchemaSyncState {
  operation: string;
  pending_files: string[];
  completed_files: string[];
  status: BulkOpStatus;
}

// ────────────────────────────────────────────
// AI Prompt 相关（M4 使用）
// ────────────────────────────────────────────

/** 步骤 2 AI 调用上下文 */
export interface TagGenContext {
  type: string;
  facetDefinitions: Record<string, FacetDefinition>;
  candidatesByFacet: Map<string, TagEntry[]>;
  existingTags: Record<string, any>;
  wikilinkCandidates: string[];
  noteContent: string;
  maxTagsPerFacet: number;
}

/** facet → tags 映射（AI 输出原始格式） */
export type FacetTagMap = Record<string, string | string[]>;

// ────────────────────────────────────────────
// M7 批量处理相关
// ────────────────────────────────────────────

/** VaultScanner 扫描过滤条件 */
export interface ScanFilter {
  folders: string[];
  excludeFolders?: string[];
  skip_tagged: boolean;
}

/** BatchProcessor 进度事件数据 */
export interface BatchProgressEvent {
  processed: number;
  total: number;
  current_file: string;
  failed_count: number;
}

// ────────────────────────────────────────────
// M8 批量 YAML 修改相关
// ────────────────────────────────────────────

/** BulkYamlModifier 执行结果 */
export interface BulkModifyResult {
  total: number;
  completed: number;
  failed: number;
  failedFiles: Record<string, string>;
}

/** BulkYamlModifier 中断恢复信息 */
export interface IncompleteState {
  pendingFiles: string[];
  completedFiles: string[];
  context: any;
}

// ────────────────────────────────────────────
// M8 标签合并相关
// ────────────────────────────────────────────

/** TagMerger 合并/删除选项 */
export interface MergeOptions {
  sourceTag: string;
  targetTag: string | null;
}

/** TagMerger dry-run 预览结果 */
export interface DryRunResult {
  affectedFiles: Array<{ path: string; changes: string }>;
  totalAffected: number;
}

// ────────────────────────────────────────────
// M8 导入导出相关
// ────────────────────────────────────────────

/** 导入冲突条目 */
export interface ImportConflict {
  label: string;
  existing: TagEntry;
  incoming: TagEntry;
}

/** 导入冲突处理策略 */
export type ImportStrategy = 'overwrite' | 'skip' | 'manual';

// ────────────────────────────────────────────
// M8 统计相关
// ────────────────────────────────────────────

/** 标签库统计数据 */
export interface TagStatistics {
  totalTags: number;
  verifiedCount: number;
  rejectedCount: number;
  flaggedCount: number;
  usageFrequency: Array<{ label: string; count: number }>;
  orphanTags: string[];
  facetDistribution: Record<string, number>;
}

// ────────────────────────────────────────────
// M8 关系发现相关
// ────────────────────────────────────────────

/** RelationDiscoverer 关系 diff */
export interface RelationDiff {
  label: string;
  current: TagRelations;
  suggested: TagRelations;
  added: {
    broader: string[];
    narrower: string[];
    related: string[];
  };
}
