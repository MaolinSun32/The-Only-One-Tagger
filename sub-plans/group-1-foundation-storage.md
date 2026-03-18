# Sub-Plan: Group 1 — 基础设施 + 数据持久化（M1 + M2）

---

## 1. 开发目标

构建 Obsidian 插件 **The Only One Tagger** 的底层基础：可编译的插件骨架、覆盖全项目的 TypeScript 类型定义、完整设置面板、全局互斥锁，以及所有 JSON 数据文件的可靠读写（含种子数据初始化和备份管理）。本组产出是整个项目的"地基"——所有上层模块（M3–M8）直接依赖此处定义的类型接口和存储 API。

---

## 2. 开发范围

### 插件元信息

| 字段 | 值 |
|------|-----|
| 插件 ID | `the-only-one-tagger` |
| 插件名称 | The Only One Tagger |
| 最低 Obsidian 版本 | 0.15.0 |
| 桌面端专属 | 是（`isDesktopOnly: true`） |

### 你需要创建的全部文件

```
项目根目录（构建配置）:
  manifest.json                        插件元数据
  package.json                         依赖与构建脚本
  tsconfig.json                        TypeScript 配置
  esbuild.config.mjs                   esbuild 构建配置

src/
├── main.ts                            M1  插件主类（依赖注入根节点）
├── types.ts                           M1  全项目类型契约（最核心文件）
├── constants.ts                       M1  常量（视图 ID、文件名、默认值）
├── settings.ts                        M1  设置面板
├── operation-lock.ts                  M1  全局互斥锁
│
├── storage/                           M2  数据持久化
│   ├── data-store.ts                      泛型存储基类（含写入队列）
│   ├── schema-store.ts                    tag-schema.json 存储
│   ├── registry-store.ts                  tag-registry.json 存储 + 10 个业务方法
│   ├── staging-store.ts                   tag-staging.json 存储 + 8 个业务方法
│   ├── queue-store.ts                     verification-queue.json 存储
│   ├── batch-state-store.ts               batch-state.json 存储
│   └── backup-manager.ts                  备份管理
│
├── seed/                              M2  种子数据
│   ├── seed-schema.ts                     12 type 默认 schema（完整内容）
│   ├── seed-registry.ts                   ~80 个 ACM CCS 种子标签
│   └── initializer.ts                     首次启动初始化（幂等）

styles.css                             全局样式占位（.toot- 前缀）
```

### 运行时数据文件（由代码自动生成，不需要手动创建）

```
.obsidian/plugins/the-only-one-tagger/
  ├── data.json                  用户设置（Obsidian saveData() 管理）
  ├── tag-schema.json            标签决策树 schema
  ├── tag-registry.json          标签库（verified + rejected）
  ├── tag-staging.json           暂存区
  ├── verification-queue.json    离线验证队列
  ├── batch-state.json           批量处理进度
  └── backups/                   自动备份目录
```

---

## 3. 绝对约束

### DO（必须遵守）

1. **本组独占 `types.ts`、`constants.ts`、`settings.ts`** —— 其他开发组不得修改这三个文件，它们是全项目的"契约层"
2. **零运行时依赖** —— `package.json` 的 `dependencies` 仅允许 `obsidian`；网络请求用 Obsidian 的 `requestUrl`，不用 `fetch`/`axios`
3. **所有插件数据文件路径**使用 `this.manifest.dir` + `normalizePath()` 计算，保证跨平台兼容
4. **`data.json`（用户设置）使用 Obsidian 的 `loadData()`/`saveData()` 管理**，不使用 DataStore 基类
5. **DataStore 写入队列必须串行化并发 `update()` 调用**，防止交叉读写导致数据丢失（Promise 链实现）
6. **DataStore 写入队列必须实现错误隔离** —— 单次 `update()` 失败不得中断后续排队操作
7. **SeedInitializer 必须幂等** —— 已有数据时不覆盖；用户手动增加的标签在重启后不被种子覆盖
8. **RegistryStore 和 StagingStore 的所有业务方法必须幂等** —— 重复调用不产生副作用
9. **所有 CSS 类名使用 `.toot-` 前缀**（the-only-one-tagger 缩写），避免与其他插件冲突
10. **使用 `adapter.read/write` 操作插件数据文件**（非 data.json），不让插件数据文件出现在用户笔记列表中
11. 文件损坏（非法 JSON）时的错误处理：不崩溃，报告错误，用默认值恢复
12. `OperationLock` 为内存级同步锁，崩溃恢复不依赖此锁，依赖状态文件（`merge-state.json`/`schema-sync-state.json`/`batch-state.json`）

### DO NOT（绝对禁止）

1. **不要引入任何第三方运行时依赖**（开发依赖如 esbuild、TypeScript 可以）
2. **不要在 DataStore 中使用 `loadData()`/`saveData()`** —— 这是 Obsidian 专为 `data.json` 设计的 API
3. **不要在 M1/M2 中引入任何 AI/网络调用逻辑** —— 本组是纯数据层
4. **不要修改 `types.ts` 中的接口名称或字段名** —— 下游 6 个开发组将直接依赖这些接口
5. **不要在 settings.ts 中实现 AI 功能的实际调用** —— 设置面板只负责 UI 和数据持久化
6. **不要在 Store 方法中直接操作 YAML frontmatter** —— YAML 操作属于 M3（FrontmatterService）

---

## 4. 你必须导出的接口（下游消费方清单）

> 这是本组最重要的交付物。以下接口将被 M3–M8 的开发者直接 `import` 使用，他们看不到你的实现，只依赖这些类型签名和行为契约。

### 4.1 types.ts（被所有模块消费）

导出的每一个 `interface`、`type`、`enum` 都是跨组契约。完整定义见 §5。

### 4.2 constants.ts（被所有模块消费）

```typescript
// 视图 ID
export const TOOT_VIEW_TYPE: string;

// 数据文件名
export const TAG_SCHEMA_FILE: string;      // 'tag-schema.json'
export const TAG_REGISTRY_FILE: string;    // 'tag-registry.json'
export const TAG_STAGING_FILE: string;     // 'tag-staging.json'
export const VERIFICATION_QUEUE_FILE: string; // 'verification-queue.json'
export const BATCH_STATE_FILE: string;     // 'batch-state.json'
export const MERGE_STATE_FILE: string;     // 'merge-state.json'
export const SCHEMA_SYNC_STATE_FILE: string; // 'schema-sync-state.json'
export const BACKUPS_DIR: string;          // 'backups'

// 默认设置值
export const DEFAULT_SETTINGS: TootSettings;

// 插件生成的 YAML 字段名列表（供 M4 PromptAssembler.stripPluginFields() 使用）
export const PLUGIN_YAML_FIELDS: string[];
// 包含：'type', 'academic', 'project', 'course', 'journal', 'growth',
//       'relationship', 'meeting', 'finance', 'health', 'career',
//       'creative', 'admin', '_tag_version', '_tagged_at'

// 12 种笔记类型名称
export const NOTE_TYPES: string[];
```

### 4.3 settings.ts（被 main.ts 和需要读取设置的模块消费）

```typescript
export interface TootSettings { /* 见 §5 完整定义 */ }
export class TootSettingTab extends PluginSettingTab { /* 设置面板 UI */ }
```

### 4.4 operation-lock.ts（被 M5/M6/M7/M8 消费）

```typescript
export class OperationLock {
  acquire(name: string): boolean;    // 同步获取锁，成功返回 true
  release(): void;                   // 释放锁
  isLocked(): boolean;               // 查询是否被占用
  getCurrentOp(): string | null;     // 当前占用的操作名称
}
```

### 4.5 RegistryStore（被 M3/M4/M5/M6/M8 消费）

```typescript
export class RegistryStore extends DataStore<Registry> {
  // 完整 10 个方法签名见 §7.3
  addTag(entry: TagEntry): Promise<void>;
  rejectTag(label: string, rejectedInFavorOf: string): Promise<void>;
  getTag(label: string): Promise<TagEntry | null>;
  getTagsByFacets(facets: string[]): Promise<TagEntry[]>;
  getBlacklistMap(facets: string[]): Promise<Record<string, string>>;
  flagTag(label: string): Promise<void>;
  unflagTag(label: string): Promise<void>;
  expandFacets(label: string, newFacet: string): Promise<void>;
  deleteTag(label: string): Promise<void>;
  findByAlias(alias: string): Promise<TagEntry | null>;
}
```

### 4.6 StagingStore（被 M4/M5/M6/M7/M8 消费）

```typescript
export class StagingStore extends DataStore<Staging> {
  // 完整 8 个方法签名见 §7.4
  writeNoteResult(notePath: string, typeData: Record<string, Record<string, StagingTagItem[]>>, analyzedAt: string, contentHash: string): Promise<void>;
  updateTagStatus(notePath: string, type: string, facet: string, label: string, newStatus: UserStatus): Promise<void>;
  updateTagBadge(notePath: string, type: string, facet: string, label: string, newBadge: BadgeType): Promise<void>;
  replaceTag(notePath: string, type: string, facet: string, oldLabel: string, newEntry: StagingTagItem): Promise<void>;
  getNoteStaging(notePath: string): Promise<StagingNote | null>;
  cleanupProcessedTags(notePath: string, typesToClean: string[]): Promise<void>;
  findAndUpdateTagGlobally(label: string, updater: (entry: StagingTagItem) => StagingTagItem | null): Promise<void>;
  addTagToFacet(notePath: string, type: string, facet: string, newEntry: StagingTagItem): Promise<void>;
}
```

### 4.7 其他 Store（被特定模块消费）

```typescript
export class SchemaStore extends DataStore<Schema> { }        // M3/M6 消费
export class QueueStore extends DataStore<VerificationQueue> { } // M4 消费
export class BatchStateStore extends DataStore<BatchState> { }   // M7 消费
export class BackupManager {                                     // M6/M8 消费
  createBackup(sourceFile: string): Promise<string>;  // 返回备份文件路径
  listBackups(): Promise<string[]>;
}
export class SeedInitializer {                                   // main.ts 消费
  initialize(): Promise<void>;  // 幂等初始化
}
```

---

## 5. 完整类型定义（types.ts）

> 此文件是全项目的"契约层"。下游 M3–M8 的所有函数签名均以此为准。必须覆盖 §6 中所有 JSON 数据格式。

```typescript
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
  | 'verifying'        // ⚪ 验证管线进行中，操作按钮禁用
  | 'registry'         // 🟢 标签库已有
  | 'wiki_verified'    // 🔵 Wikipedia 确认
  | 'search_verified'  // 🔵 AI 搜索确认
  | 'needs_review'     // 🟡 三级验证均未确认
  | 'enum'             // 非 taxonomy：枚举值
  | 'wikilink'         // 非 taxonomy：库内链接
  | 'free_text'        // 非 taxonomy：自由文本
  | 'date';            // 非 taxonomy：日期

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
// tag-schema.json（§3.1 决策树 Schema）
// ────────────────────────────────────────────

/** 单个 facet 定义 */
export interface FacetDefinition {
  description: string;
  value_type: ValueType;
  allow_multiple: boolean;
  verification_required: boolean;
  values?: string[];                          // 仅 enum 类型有
  blacklist?: Record<string, string>;         // 仅 enum 类型可选（错误值→正确值）
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
// tag-registry.json（§3.2 标签库）
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
  verified_at: string;                        // ISO 时间戳
}

/** 单个标签条目 */
export interface TagEntry {
  label: string;
  aliases: string[];
  facets: string[];                           // 可属于多个 facet
  status: TagStatus;
  flagged?: boolean;                          // 仅 verified 标签可被 flag
  rejected_in_favor_of?: string;              // 仅 rejected 标签有
  relations: TagRelations;
  source: TagSource;
}

/** tag-registry.json 元信息 */
export interface RegistryMeta {
  version: number;
  last_updated: string;                       // ISO 时间戳
  total_tags: number;
}

/** tag-registry.json 顶层结构 */
export interface Registry {
  meta: RegistryMeta;
  tags: Record<string, TagEntry>;
}

// ────────────────────────────────────────────
// tag-staging.json（§3.5 暂存区）
// ────────────────────────────────────────────

/** 暂存区中单个标签条目 */
export interface StagingTagItem {
  label: string;
  badge: BadgeType;
  user_status: UserStatus;
  ai_recommended?: boolean;                   // true: AI 推荐; false: YAML 已有但 AI 未推荐
  replaces?: string[];                        // Edit/Regenerate 产生的替换链
}

/** 暂存区中单篇笔记条目 */
export interface StagingNote {
  analyzed_at: string;                        // ISO 时间戳
  content_hash: string;                       // 笔记 body SHA-256 前 8 位
  types: Record<string, Record<string, StagingTagItem[]>>;
  // 结构: { [typeName]: { [facetName]: StagingTagItem[] } }
}

/** tag-staging.json 顶层结构 */
export interface Staging {
  notes: Record<string, StagingNote>;         // key = 笔记相对路径
}

// ────────────────────────────────────────────
// verification-queue.json（§3.4 离线验证队列）
// ────────────────────────────────────────────

/** 离线验证队列条目 */
export interface VerificationQueueItem {
  id: string;
  tag_label: string;
  facet: string;
  suggested_by: 'ai' | 'user';
  source_notes: string[];                     // 按 tag_label 去重，source_notes 为数组
  queued_at: string;                          // ISO 时间戳
  attempts: number;
}

/** verification-queue.json 顶层结构 */
export interface VerificationQueue {
  queue: VerificationQueueItem[];
}

// ────────────────────────────────────────────
// batch-state.json（§3.6 批量处理进度）
// ────────────────────────────────────────────

/** 批量处理过滤条件 */
export interface BatchFilter {
  folders: string[];
  skip_tagged: boolean;
}

/** batch-state.json 顶层结构 */
export interface BatchState {
  task_id: string;
  started_at: string;                         // ISO 时间戳
  status: BatchStatus;
  filter: BatchFilter;
  processed_files: string[];                  // 已处理文件的相对路径集合
  failed_files: Record<string, string>;       // path → error message
}

// ────────────────────────────────────────────
// data.json（§3.7 用户设置）
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

/**
 * FrontmatterService.write() 的入参类型。
 *
 * 写入采用**全量替换**语义：对于 `types` 中列出的 type，
 * 以 `typeData` 提供的 facet 值直接覆盖 YAML 中对应的 type 块。
 * 不在 `types` 中的现有 type 块原样保留。
 * `type` 数组为追加逻辑（新 type 追加到已有 type 数组，不覆盖）。
 *
 * **types 构建规则**：仅包含 staging 中存在至少一个 user_status 为
 * accepted 或 deleted 的标签的 type（用户做出了至少一个主动决策）。
 * 全部 pending 且 ai_recommended: true 的 type 不纳入。
 */
export interface TagWriteData {
  types: string[];                            // 本次写入涉及的 type 列表
  typeData: Record<string, Record<string, any>>;
  // { [typeName]: { [facetName]: value } }
  // value: string | string[] 取决于 allow_multiple
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
  badge: BadgeType;                           // wiki_verified | search_verified | needs_review
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
  entry?: TagEntry;                           // 匹配到的完整标签条目（含 status）
}

// ────────────────────────────────────────────
// FrontmatterService 读取输出（M3 使用）
// ────────────────────────────────────────────

/** 从 YAML 读取的已标记笔记结构 */
export interface TaggedNote {
  types: string[];
  typeData: Record<string, Record<string, any>>;
  // { [typeName]: { [facetName]: value } }
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
  target_tag: string | null;                  // null 表示删除模式
  pending_files: string[];
  completed_files: string[];
  status: BulkOpStatus;
}

/** schema-sync-state.json 结构 */
export interface SchemaSyncState {
  operation: string;                          // 操作描述
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
  existingTags: Record<string, any>;          // 当前 YAML 中已有标签
  wikilinkCandidates: string[];
  noteContent: string;                        // 剥离插件字段后的内容
  maxTagsPerFacet: number;
}

/** facet → tags 映射（AI 输出原始格式） */
export type FacetTagMap = Record<string, string | string[]>;
```

---

## 6. 数据格式定义

### 6.1 tag-schema.json（决策树 Schema）

定义每种笔记类型必须/可以标注的 facet，以及每个 facet 的值类型和验证要求。

```json
{
  "version": 1,
  "note_types": {
    "academic": {
      "label": "学术研究",
      "description": "学术论文精读、文献综述、研究方法论笔记、学术概念梳理",
      "required_facets": ["domain", "genre", "lang"],
      "optional_facets": [
        "method", "algorithm", "concept", "dataset",
        "problem", "software", "programming-language",
        "scholar", "venue"
      ]
    },
    "project": {
      "label": "项目/复现",
      "description": "编程项目、论文复现、开源贡献、工程实践记录",
      "required_facets": ["domain", "status", "tech-stack"],
      "optional_facets": [
        "programming-language", "software",
        "collaborator", "source-repo"
      ]
    },
    "course": {
      "label": "课程学习",
      "description": "在线课程笔记、教材阅读笔记、课堂记录、学习进度追踪",
      "required_facets": ["domain", "source", "instructor"],
      "optional_facets": ["concept", "method", "platform"]
    },
    "journal": {
      "label": "日记",
      "description": "每日日记、情绪记录、生活流水账、个人反思",
      "required_facets": ["mood"],
      "optional_facets": ["people", "location", "event-type", "reflection-topic"]
    },
    "growth": {
      "label": "自我成长",
      "description": "个人成长反思、习惯养成、心态转变、人生感悟",
      "required_facets": ["growth-area"],
      "optional_facets": ["method", "trigger", "insight-type"]
    },
    "relationship": {
      "label": "人际关系",
      "description": "人物档案、社交关系维护、人际互动记录",
      "required_facets": ["person", "relation-type"],
      "optional_facets": ["affiliation", "domain", "interaction-type"]
    },
    "meeting": {
      "label": "会议/社交",
      "description": "会议纪要、研讨会笔记、社交活动记录、演讲摘要",
      "required_facets": ["participants", "meeting-type"],
      "optional_facets": ["related-project", "location"]
    },
    "finance": {
      "label": "财务",
      "description": "收支记录、投资分析、预算规划、财务决策",
      "required_facets": ["finance-type", "amount-range"],
      "optional_facets": ["category", "recurring"]
    },
    "health": {
      "label": "健康",
      "description": "健康指标追踪、就医记录、运动日志、饮食与睡眠",
      "required_facets": ["health-area"],
      "optional_facets": ["metric", "provider", "condition"]
    },
    "career": {
      "label": "职业发展",
      "description": "求职记录、技能提升计划、职业转型思考、里程碑",
      "required_facets": ["career-aspect"],
      "optional_facets": ["company", "role", "skill", "milestone"]
    },
    "creative": {
      "label": "创作",
      "description": "写作草稿、绘画记录、音乐创作、摄影项目、设计灵感",
      "required_facets": ["medium", "status"],
      "optional_facets": ["theme", "audience", "inspiration"]
    },
    "admin": {
      "label": "行政/生活",
      "description": "日常事务、预约提醒、购物清单、出行规划、证件办理",
      "required_facets": ["admin-type"],
      "optional_facets": ["deadline", "priority"]
    }
  },
  "facet_definitions": {

    "method": {
      "description": "方法论/技术方法",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "algorithm": {
      "description": "具体算法",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "concept": {
      "description": "核心概念/术语",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "dataset": {
      "description": "数据集",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "problem": {
      "description": "研究问题/任务",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "domain": {
      "description": "所属知识/研究领域",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "tech-stack": {
      "description": "技术栈",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "software": {
      "description": "软件工具",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "skill": {
      "description": "技能",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "condition": {
      "description": "健康状况/疾病",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "reflection-topic": {
      "description": "反思主题",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "theme": {
      "description": "创作主题",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },

    "genre": {
      "description": "内容体裁",
      "value_type": "enum",
      "values": ["paper", "textbook", "tutorial", "lecture-note", "blog", "documentation", "thesis"],
      "blacklist": { "article": "paper", "book": "textbook", "guide": "tutorial", "doc": "documentation" },
      "allow_multiple": false,
      "verification_required": false
    },
    "lang": {
      "description": "语言",
      "value_type": "enum",
      "values": ["en", "zh", "ja", "de", "fr", "ko"],
      "blacklist": { "english": "en", "chinese": "zh", "japanese": "ja", "german": "de", "french": "fr", "korean": "ko" },
      "allow_multiple": false,
      "verification_required": false
    },
    "mood": {
      "description": "情绪状态",
      "value_type": "enum",
      "values": ["great", "good", "neutral", "low", "bad"],
      "allow_multiple": false,
      "verification_required": false
    },
    "status": {
      "description": "进度状态",
      "value_type": "enum",
      "values": ["not-started", "in-progress", "completed", "paused", "abandoned"],
      "allow_multiple": false,
      "verification_required": false
    },
    "programming-language": {
      "description": "编程语言",
      "value_type": "enum",
      "values": ["python", "javascript", "typescript", "java", "c", "cpp", "rust", "go", "r", "julia", "matlab", "scala", "kotlin", "swift", "shell"],
      "allow_multiple": true,
      "verification_required": false
    },
    "event-type": {
      "description": "事件类型",
      "value_type": "enum",
      "values": ["social", "academic", "family", "travel", "work", "personal"],
      "allow_multiple": false,
      "verification_required": false
    },
    "meeting-type": {
      "description": "会议类型",
      "value_type": "enum",
      "values": ["one-on-one", "group", "seminar", "conference", "workshop", "casual"],
      "allow_multiple": false,
      "verification_required": false
    },
    "relation-type": {
      "description": "人际关系类型",
      "value_type": "enum",
      "values": ["friend", "colleague", "mentor", "mentee", "family", "acquaintance"],
      "allow_multiple": false,
      "verification_required": false
    },
    "interaction-type": {
      "description": "互动方式",
      "value_type": "enum",
      "values": ["meeting", "email", "call", "chat", "collaboration"],
      "allow_multiple": false,
      "verification_required": false
    },
    "finance-type": {
      "description": "财务类型",
      "value_type": "enum",
      "values": ["income", "expense", "investment", "debt", "saving"],
      "allow_multiple": false,
      "verification_required": false
    },
    "amount-range": {
      "description": "金额区间",
      "value_type": "enum",
      "values": ["<100", "100-500", "500-2000", "2000-10000", ">10000"],
      "allow_multiple": false,
      "verification_required": false
    },
    "category": {
      "description": "消费/财务分类",
      "value_type": "enum",
      "values": ["food", "transport", "housing", "entertainment", "education", "health", "clothing", "electronics", "subscription", "other"],
      "allow_multiple": false,
      "verification_required": false
    },
    "recurring": {
      "description": "是否周期性",
      "value_type": "enum",
      "values": ["daily", "weekly", "monthly", "yearly", "one-time"],
      "allow_multiple": false,
      "verification_required": false
    },
    "health-area": {
      "description": "健康领域",
      "value_type": "enum",
      "values": ["physical", "mental", "sleep", "nutrition", "exercise", "medical"],
      "allow_multiple": false,
      "verification_required": false
    },
    "growth-area": {
      "description": "成长领域",
      "value_type": "enum",
      "values": ["emotional", "intellectual", "spiritual", "social", "professional", "physical"],
      "allow_multiple": true,
      "verification_required": false
    },
    "career-aspect": {
      "description": "职业发展方面",
      "value_type": "enum",
      "values": ["job-search", "skill-development", "networking", "promotion", "transition", "side-project"],
      "allow_multiple": false,
      "verification_required": false
    },
    "medium": {
      "description": "创作媒介",
      "value_type": "enum",
      "values": ["writing", "drawing", "music", "photography", "video", "code", "design"],
      "allow_multiple": true,
      "verification_required": false
    },
    "insight-type": {
      "description": "洞察类型",
      "value_type": "enum",
      "values": ["realization", "habit-change", "mindset-shift", "lesson-learned"],
      "allow_multiple": false,
      "verification_required": false
    },
    "admin-type": {
      "description": "行政事务类型",
      "value_type": "enum",
      "values": ["errand", "appointment", "maintenance", "paperwork", "shopping", "travel-planning"],
      "allow_multiple": false,
      "verification_required": false
    },
    "priority": {
      "description": "优先级",
      "value_type": "enum",
      "values": ["high", "medium", "low"],
      "allow_multiple": false,
      "verification_required": false
    },
    "platform": {
      "description": "学习平台",
      "value_type": "enum",
      "values": ["coursera", "edx", "youtube", "udemy", "mit-ocw", "stanford-online", "bilibili", "other"],
      "allow_multiple": false,
      "verification_required": false
    },

    "scholar": {
      "description": "学者/研究者",
      "value_type": "wikilink",
      "allow_multiple": true,
      "verification_required": false
    },
    "people": {
      "description": "相关人物",
      "value_type": "wikilink",
      "allow_multiple": true,
      "verification_required": false
    },
    "person": {
      "description": "核心人物（关系笔记主体）",
      "value_type": "wikilink",
      "allow_multiple": false,
      "verification_required": false
    },
    "participants": {
      "description": "参与者",
      "value_type": "wikilink",
      "allow_multiple": true,
      "verification_required": false
    },
    "collaborator": {
      "description": "协作者",
      "value_type": "wikilink",
      "allow_multiple": true,
      "verification_required": false
    },
    "instructor": {
      "description": "讲师/教授",
      "value_type": "wikilink",
      "allow_multiple": true,
      "verification_required": false
    },
    "provider": {
      "description": "医疗/服务提供者",
      "value_type": "wikilink",
      "allow_multiple": true,
      "verification_required": false
    },
    "company": {
      "description": "公司/组织",
      "value_type": "wikilink",
      "allow_multiple": true,
      "verification_required": false
    },
    "related-project": {
      "description": "所属/关联项目",
      "value_type": "wikilink",
      "allow_multiple": false,
      "verification_required": false
    },

    "venue": {
      "description": "会议/期刊名称（含年份，如 NeurIPS-2017）",
      "value_type": "free-text",
      "allow_multiple": false,
      "verification_required": false
    },
    "source": {
      "description": "来源（URL/书名/课程名）",
      "value_type": "free-text",
      "allow_multiple": false,
      "verification_required": false
    },
    "source-repo": {
      "description": "源代码仓库 URL",
      "value_type": "free-text",
      "allow_multiple": false,
      "verification_required": false
    },
    "location": {
      "description": "地点",
      "value_type": "free-text",
      "allow_multiple": false,
      "verification_required": false
    },
    "trigger": {
      "description": "触发因素",
      "value_type": "free-text",
      "allow_multiple": false,
      "verification_required": false
    },
    "inspiration": {
      "description": "灵感来源",
      "value_type": "free-text",
      "allow_multiple": true,
      "verification_required": false
    },
    "audience": {
      "description": "目标受众",
      "value_type": "free-text",
      "allow_multiple": false,
      "verification_required": false
    },
    "affiliation": {
      "description": "所属机构",
      "value_type": "free-text",
      "allow_multiple": true,
      "verification_required": false
    },
    "metric": {
      "description": "健康指标",
      "value_type": "free-text",
      "allow_multiple": true,
      "verification_required": false
    },
    "role": {
      "description": "职位/角色",
      "value_type": "free-text",
      "allow_multiple": false,
      "verification_required": false
    },
    "milestone": {
      "description": "里程碑",
      "value_type": "free-text",
      "allow_multiple": true,
      "verification_required": false
    },
    "deadline": {
      "description": "截止日期（ISO 格式，如 2026-04-15）",
      "value_type": "date",
      "allow_multiple": false,
      "verification_required": false
    }
  }
}
```

**value_type 说明**：

| value_type | 含义 | 验证 | 入标签库 |
|------------|------|------|---------|
| `taxonomy` | 受控词表术语 | 走三级验证管线（所有 taxonomy 均 `verification_required: true`） | 是 |
| `enum` | 固定值列表（全部 lowercase-hyphenated） | AI 从列表中选择 | 否 |
| `wikilink` | 库内笔记链接 `[[Name]]` | 无需验证 | 否 |
| `free-text` | 自由文本 | 无需验证 | 否 |
| `date` | ISO 日期格式（如 `2026-04-15`） | 格式校验 | 否 |

### 6.2 tag-registry.json（标签库）

采用 SKOS（Simple Knowledge Organization System）风格。**只存正式标签（verified）和黑名单标签（rejected）**。

**完整示例**：

```json
{
  "meta": {
    "version": 1,
    "last_updated": "2026-03-11T10:30:00Z",
    "total_tags": 156
  },
  "tags": {
    "transformer": {
      "label": "transformer",
      "aliases": ["Transformer模型", "Transformer架构"],
      "facets": ["method"],
      "status": "verified",
      "flagged": false,
      "relations": {
        "broader": ["neural-network-architecture"],
        "narrower": ["vision-transformer", "GPT", "BERT"],
        "related": ["self-attention", "sequence-to-sequence"]
      },
      "source": {
        "verified_by": "wikipedia",
        "url": "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)",
        "verified_at": "2026-03-11T10:30:00Z"
      }
    },
    "ML": {
      "label": "ML",
      "aliases": [],
      "facets": ["domain"],
      "status": "rejected",
      "rejected_in_favor_of": "machine-learning",
      "relations": { "broader": [], "narrower": [], "related": [] },
      "source": {
        "verified_by": "manual",
        "verified_at": "2026-03-11T10:30:00Z"
      }
    }
  }
}
```

**关键设计——`facets` 为数组**：一个标签可以属于多个 facet。例如 `deep-learning` 可以同时是 `domain` 和 `method`。新标签首次入库时 `facets` 初始化为当前使用的 facet；每次用户 Accept 一个已有标签到新 facet 时，代码自动追加到 `facets` 数组。

**标签状态与标记**：

| 字段 | 含义 |
|--------|------|
| `status: "verified"` | 已入库的正式标签 |
| `status: "rejected"` | 黑名单标签（带 `rejected_in_favor_of`） |
| `flagged: true` | 待复核标记（离线 applyAll 后验证失败），仅 verified 标签可被 flag |

**来源类型**：

| verified_by | 含义 |
|-------------|------|
| `seed` | 预置种子标签（ACM CCS 等） |
| `wikipedia` | Wikipedia API 确认 |
| `ai_search` | AI 联网搜索确认 |
| `manual` | 用户手动添加并确认 |

### 6.3 笔记 YAML frontmatter（最终写入格式，由 M3 FrontmatterService 负责）

**单 type 示例**：

```yaml
---
type: [academic]
academic:
  domain: [attention-mechanism, natural-language-processing]
  method: [transformer, self-attention]
  genre: paper
  lang: en
  problem: [machine-translation, sequence-modeling]
  scholar: ["[[Vaswani-A]]", "[[Shazeer-N]]"]
  venue: NeurIPS-2017
  software: [tensorflow]
  programming-language: [python]
_tag_version: 1
_tagged_at: 2026-03-11
---
```

**多 type 示例**：

```yaml
---
type: [academic, project]
academic:
  domain: [attention-mechanism]
  method: [transformer]
  genre: paper
  lang: en
  programming-language: [python]
project:
  domain: [deep-learning]
  status: in-progress
  tech-stack: [pytorch]
  programming-language: [python]
_tag_version: 2
_tagged_at: 2026-03-11
---
```

**元字段说明**：

| 字段 | 值 | 含义 |
|------|----|------|
| `_tag_version` | 整数 | 标签版本号，每次 applyAll 递增 |
| `_tagged_at` | ISO 日期 | 最后打标时间 |

### 6.4 verification-queue.json（离线验证队列）

队列按 `tag_label` 去重：同一标签被多篇笔记触发时只保留一条记录，`source_notes` 为数组。

```json
{
  "queue": [
    {
      "id": "q_001",
      "tag_label": "flash-attention",
      "facet": "method",
      "suggested_by": "ai",
      "source_notes": ["path/to/note-A.md", "path/to/note-B.md"],
      "queued_at": "2026-03-11T10:30:00Z",
      "attempts": 0
    }
  ]
}
```

### 6.5 tag-staging.json（暂存区）

```json
{
  "notes": {
    "path/to/note.md": {
      "analyzed_at": "2026-03-11T10:30:00Z",
      "content_hash": "a3f2b8c1",
      "types": {
        "academic": {
          "domain": [
            {
              "label": "attention-mechanism",
              "badge": "wiki_verified",
              "user_status": "pending"
            },
            {
              "label": "natural-language-processing",
              "badge": "registry",
              "user_status": "pending",
              "ai_recommended": true
            }
          ],
          "method": [
            {
              "label": "flash-attention",
              "badge": "verifying",
              "user_status": "pending",
              "ai_recommended": true
            },
            {
              "label": "self-attention",
              "badge": "needs_review",
              "user_status": "pending",
              "replaces": ["self-attn"],
              "ai_recommended": true
            },
            {
              "label": "LSTM",
              "badge": "registry",
              "user_status": "accepted",
              "ai_recommended": false
            }
          ],
          "genre": [
            {
              "label": "paper",
              "badge": "enum",
              "user_status": "pending"
            }
          ]
        }
      }
    }
  }
}
```

**字段说明**：

| 字段 | 含义 |
|------|------|
| `badge` | 验证来源/信心级别：`verifying`（⚪）、`registry`（🟢）、`wiki_verified`（🔵）、`search_verified`（🔵）、`needs_review`（🟡）、`enum`/`wikilink`/`free_text`/`date`（非 taxonomy） |
| `user_status` | `pending`（等待操作）/ `accepted`（已接受）/ `deleted`（已删除） |
| `ai_recommended` | `true`：AI 推荐的标签；`false`：YAML 中已有但 AI 未推荐的标签 |
| `replaces` | 可选数组，记录被当前标签替换的旧标签链条（Edit/Regenerate 产生） |
| `content_hash` | 笔记正文（不含 frontmatter）的 SHA-256 前 8 位 |

### 6.6 batch-state.json（批量处理进度）

采用路径集合（非位置索引）记录进度，确保文件系统变更后恢复不出错。

```json
{
  "task_id": "batch_001",
  "started_at": "2026-03-11T10:00:00Z",
  "status": "paused",
  "filter": {
    "folders": ["Academic", "Projects"],
    "skip_tagged": true
  },
  "processed_files": [
    "Academic/attention-is-all-you-need.md",
    "Academic/bert-paper.md",
    "Projects/my-transformer.md"
  ],
  "failed_files": {
    "Academic/corrupted-note.md": "Invalid YAML frontmatter"
  }
}
```

### 6.7 data.json（用户设置）

通过 Obsidian 的 `loadData()`/`saveData()` 管理，**不使用 DataStore 基类**。

```json
{
  "generation_api_key": "",
  "generation_base_url": "",
  "generation_model": "",
  "generation_temperature": 0.7,
  "generation_max_tokens": 2048,

  "verification_api_key": "",
  "verification_base_url": "",
  "verification_model": "",
  "verification_temperature": 0.3,

  "search_type": "brave",
  "search_api_key": "",
  "search_base_url": "",

  "knowledge_base_source": "wikipedia",
  "knowledge_base_lang": "en",
  "use_knowledge_base": true,

  "max_tags_per_facet": 5,
  "regenerate_count": 5,
  "max_wikilink_candidates": 100,

  "batch_concurrency": 1,
  "max_batch_size": 50,
  "request_timeout_ms": 30000,
  "ping_interval_ms": 60000
}
```

**默认值表**：

| 字段 | 默认值 | 含义 |
|------|--------|------|
| `generation_temperature` | 0.7 | Generation AI 温度 |
| `generation_max_tokens` | 2048 | 步骤 2 AI 输出 max_tokens |
| `verification_temperature` | 0.3 | Verification AI 温度 |
| `search_type` | `"brave"` | 搜索 API 类型（brave / tavily） |
| `knowledge_base_source` | `"wikipedia"` | 知识库源 |
| `knowledge_base_lang` | `"en"` | 知识库语言 |
| `use_knowledge_base` | `true` | 是否启用知识库验证 |
| `max_tags_per_facet` | 5 | 每 facet 最大标签数 |
| `regenerate_count` | 5 | 每次 Regenerate 的同义词数量 |
| `max_wikilink_candidates` | 100 | wikilink 候选池上限 |
| `batch_concurrency` | 1 | 批量处理并发度 |
| `max_batch_size` | 50 | 单次批量处理最大笔记数 |
| `request_timeout_ms` | 30000 | 单个请求超时（毫秒） |
| `ping_interval_ms` | 60000 | 健康检查间隔（毫秒） |

---

## 7. 实现规格

### 7.1 src/types.ts

完整代码见 §5。这是全项目的"契约层"，所有接口定义必须与 §6 中的 JSON 格式完全对应。

### 7.2 src/constants.ts

```typescript
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
// 供 M4 PromptAssembler.stripPluginFields() 使用
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
```

### 7.3 src/settings.ts

`TootSettingTab extends PluginSettingTab`。渲染 §6.7 data.json 中所有字段的 UI。

**三组服务配置区域**：
- **Generation AI**：apiKey、baseUrl、model、temperature、max_tokens 文本输入框。提示"需要支持多模态输入（图像、文本、音频）"
- **Verification AI**：apiKey、baseUrl、model、temperature。提示"推荐使用任意 OpenAI-compatible API"
- **Search API**：search_type 下拉选择（Brave/Tavily）、apiKey、baseUrl。提示"用于标签验证的网页搜索，支持 Brave Search 和 Tavily Search"
- **Knowledge Base**：knowledge_base_source、knowledge_base_lang、use_knowledge_base 开关
- **标签行为**：max_tags_per_facet、regenerate_count、max_wikilink_candidates
- **批量处理 & 网络**：batch_concurrency、max_batch_size、request_timeout_ms、ping_interval_ms

### 7.4 src/operation-lock.ts

全局互斥锁，防止破坏性批量操作（TagMerger、Schema Sync、BatchProcessor）并发执行。

```typescript
export class OperationLock {
  private locked: boolean = false;
  private currentOp: string | null = null;

  /**
   * 同步获取锁。成功返回 true，已被占用返回 false。
   * 调用方（M5 applyAll, M7 BatchProcessor, M8 TagMerger, M6 Schema Sync）
   * 在获取失败时应 Notice 提示用户并拒绝执行。
   */
  acquire(name: string): boolean;

  /** 释放锁 */
  release(): void;

  /** 查询是否被占用 */
  isLocked(): boolean;

  /** 当前占用的操作名称，未锁定时返回 null */
  getCurrentOp(): string | null;
}
```

**崩溃恢复说明**：此锁为内存级（非持久化），插件重启后自动释放。崩溃恢复依靠状态文件（`merge-state.json`/`schema-sync-state.json`/`batch-state.json`）：启动时检测状态文件 `status: "running"` 时调用 `acquire()` 恢复锁状态。

### 7.5 src/main.ts

插件主类 `TheOnlyOneTagger extends Plugin`。

- `onload()`：加载设置、注册视图、注册命令、调用 SeedInitializer、注册设置面板
- 持有各模块的单例引用和 `OperationLock` 实例，是依赖注入的根节点
- AI 服务等在首次使用时才创建（懒初始化）—— 本阶段只需预留挂载点
- 本阶段应实现：设置加载/保存、SeedInitializer 调用、各 Store 初始化

### 7.6 src/storage/data-store.ts

泛型存储基类，封装 `adapter.read/write` + JSON 序列化/反序列化。

```typescript
export class DataStore<T> {
  protected filePath: string;      // manifest.dir + normalizePath(fileName)
  protected defaultValue: T;       // 文件不存在时的默认值
  private writeQueue: Promise<void>;  // 写入队列（Promise 链）

  constructor(app: App, manifest: PluginManifest, fileName: string, defaultValue: T);

  /**
   * 从磁盘加载 JSON。
   * 文件不存在 → 用默认值创建并写入。
   * 文件内容损坏（非法 JSON）→ console.error + 用默认值恢复。
   */
  load(): Promise<T>;

  /** 序列化写入磁盘 */
  save(data: T): Promise<void>;

  /**
   * 串行化读-改-写。
   *
   * 内部维护写入队列（Promise 链），确保多个并发 update() 调用严格串行执行。
   *
   * 实现方式：
   *   this.writeQueue = this.writeQueue
   *     .catch(() => {})  // 错误隔离：恢复链条
   *     .then(() => { load → mutate → save });
   *
   * 错误隔离：单次 update() 失败向调用方返回 reject（调用方自行处理），
   * 但 Promise 链本身始终保持 resolved 状态，后续排队操作不受影响。
   *
   * 这对 StagingStore 尤其关键——VerificationPipeline 并发更新 badge、
   * applyAll 清理条目、BatchProcessor 写入新分析结果可能同时操作 staging。
   */
  update(mutator: (data: T) => void): Promise<void>;
}
```

**关键实现细节**：
- 路径通过 `this.manifest.dir` + `normalizePath()` 计算
- **`data.json` 不使用此基类**，由 Obsidian 的 `loadData()`/`saveData()` 管理
- `load()` 内部用 `app.vault.adapter.read()` 读取，`save()` 用 `app.vault.adapter.write()` 写入
- 文件不存在时 `adapter.read()` 会抛异常，catch 后用默认值创建

### 7.7 src/storage/registry-store.ts —— 10 个方法完整规格

`RegistryStore extends DataStore<Registry>`。在通用存储之上封装标签库业务方法。这些方法是后续模块操作 registry 的**唯一入口**。

#### 方法 1: `addTag(entry: TagEntry): Promise<void>`

新增 verified 标签到 registry。

- **幂等**：标签已存在时更新字段（如 `verified_by` 升级为更高权威来源）而非报错或创建重复条目
- 自动更新 `meta.last_updated` 和 `meta.total_tags`（仅新增时递增，更新不变）
- 内部调用 `this.update()` 保证并发安全

#### 方法 2: `rejectTag(label: string, rejectedInFavorOf: string): Promise<void>`

将标签标记为黑名单（`status: "rejected"`）。

- 设置 `rejected_in_favor_of` 字段指向目标标签
- **幂等**：标签已在黑名单中时跳过
- 如果标签之前是 `verified`，改为 `rejected`（不递减 total_tags，rejected 也计数）

#### 方法 3: `getTag(label: string): Promise<TagEntry | null>`

按 label 精确查找标签条目。

- 返回完整 `TagEntry`（含 `status`，供调用方区分 verified/rejected）
- 未找到返回 `null`
- 纯读取，不修改数据

#### 方法 4: `getTagsByFacets(facets: string[]): Promise<TagEntry[]>`

返回 `facets` 数组与给定 facets 有交集的所有 **verified** 标签。

- **仅返回 `status: "verified"` 的标签**（含 `flagged: true` 的标签），不返回 rejected
- 这是 M3 PromptFilterBuilder 的候选数据源
- 过滤逻辑：遍历所有标签，检查 `tag.facets` 与参数 `facets` 的交集是否非空

#### 方法 5: `getBlacklistMap(facets: string[]): Promise<Record<string, string>>`

返回指定 facets 下的黑名单映射。

- 输出格式：`{ rejectedLabel: rejected_in_favor_of_target }`
- 仅返回 `status: "rejected"` 且 `facets` 与参数有交集的标签
- 供 M4 AIResponseValidator 硬编码解析使用

#### 方法 6: `flagTag(label: string): Promise<void>`

标记标签为 `flagged: true`（验证失败的已入库标签）。

- 仅对 `status: "verified"` 的标签生效
- 标签不存在或不是 verified → 跳过（幂等）

#### 方法 7: `unflagTag(label: string): Promise<void>`

取消标签的 flagged 标记（验证通过或用户手动确认）。

- 设置 `flagged: false`
- 标签不存在 → 跳过（幂等）

#### 方法 8: `expandFacets(label: string, newFacet: string): Promise<void>`

自动追加 facet 到已有标签的 `facets` 数组。

- 如果 `newFacet` 已在数组中 → 跳过（去重，幂等）
- 标签不存在 → 跳过
- 更新 `meta.last_updated`

#### 方法 9: `deleteTag(label: string): Promise<void>`

从 registry 中彻底移除该条目（含 verified 和 rejected）。

- 同时递减 `meta.total_tags`
- **幂等**：标签不存在时跳过
- 供 M8 TagMerger 删除模式使用

#### 方法 10: `findByAlias(alias: string): Promise<TagEntry | null>`

遍历所有标签（verified + rejected），检查各标签的 `aliases` 数组是否包含该字符串。

- 返回首个命中的完整 `TagEntry`
- 未命中返回 `null`
- **纯数据查询**，不含规范化逻辑（规范化由 M3 TagMatcher 负责）
- 供 M3 TagMatcher 使用

### 7.8 src/storage/staging-store.ts —— 8 个方法完整规格

`StagingStore extends DataStore<Staging>`。在通用存储之上封装暂存区业务方法。所有操作内部通过 `update()` 的写入队列保证并发安全。

#### 方法 1: `writeNoteResult(notePath: string, typeData: Record<string, Record<string, StagingTagItem[]>>, analyzedAt: string, contentHash: string): Promise<void>`

写入/覆盖整个笔记的分析结果。

- 如果笔记已有 staging 数据，**按 type 粒度覆盖**：传入的 type 覆盖旧数据，其他 type 不受影响
- 更新 `analyzed_at` 和 `content_hash`
- 用于 AI 分析完成后写入结果，以及重新分析时覆盖旧数据

#### 方法 2: `updateTagStatus(notePath: string, type: string, facet: string, label: string, newStatus: UserStatus): Promise<void>`

更新单个标签的 `user_status`（三态切换）。

- 找到指定的 notePath → type → facet → label 匹配的条目，设置 `user_status`
- 路径中任何层级不存在 → 跳过（幂等）

#### 方法 3: `updateTagBadge(notePath: string, type: string, facet: string, label: string, newBadge: BadgeType): Promise<void>`

更新单个标签的 `badge`（验证完成回调）。

- badge 更新不影响其他字段（`user_status`、`replaces` 等）
- 路径中任何层级不存在 → 跳过（幂等）

#### 方法 4: `replaceTag(notePath: string, type: string, facet: string, oldLabel: string, newEntry: StagingTagItem): Promise<void>`

Edit 替换操作。

- 移除 `oldLabel` 对应的条目
- 在同一位置插入 `newEntry`
- `newEntry` 应已包含正确的 `replaces` 链（由调用方 M5 TagOperationExecutor 负责构建）
- oldLabel 不存在 → 直接插入 newEntry

#### 方法 5: `getNoteStaging(notePath: string): Promise<StagingNote | null>`

读取单笔记的完整 staging 数据。

- 供 UI 展示和 M5 applyAll 收集使用
- 笔记不在 staging 中 → 返回 `null`

#### 方法 6: `cleanupProcessedTags(notePath: string, typesToClean: string[]): Promise<void>`

applyAll 后增量清理。

- 对指定 type 列表执行清理：
  - 移除 `user_status` 为 `accepted` 或 `deleted` 的条目
  - **`pending` 的标签保留在 staging 中**（多 type 场景用户只审核了部分 type）
  - type 下无 pending 条目时 → 移除该 type 块
  - 笔记下所有 type 块均已清空 → 移除整个笔记条目

#### 方法 7: `findAndUpdateTagGlobally(label: string, updater: (entry: StagingTagItem) => StagingTagItem | null): Promise<void>`

全局标签操作：遍历所有笔记的所有 type/facet。

- 对 `label` 匹配的条目执行 `updater` 回调
- updater 返回新条目 → 替换原条目
- updater 返回 `null` → 移除该条目
- 供 M8 TagMerger 合并/删除模式和 M4 VerificationQueueManager 广播更新共用
- 全部遍历完成后一次性写入（单次 `update()` 调用）

#### 方法 8: `addTagToFacet(notePath: string, type: string, facet: string, newEntry: StagingTagItem): Promise<void>`

向指定 facet 追加一个标签条目。

- **前置条件**：该笔记/type 在 staging 中已存在（由调用方 M5/M6 保证）
- 如果 staging 中不存在该笔记/type，调用方需先通过 `FrontmatterService.read()` 获取现有标签并调用 `writeNoteResult()` 初始化
- 本方法仅负责追加，不含 YAML 读取逻辑（避免 M2 → M3 层级违反）

### 7.9 src/storage/schema-store.ts

`SchemaStore extends DataStore<Schema>`。

- 默认值为空 schema（`{ version: 1, note_types: {}, facet_definitions: {} }`）
- 实际内容由 SeedInitializer 初始化
- 无额外业务方法（M3 SchemaResolver 负责查询逻辑）

### 7.10 src/storage/queue-store.ts

`QueueStore extends DataStore<VerificationQueue>`。

- 默认值为 `{ queue: [] }`
- 无额外业务方法（M4 VerificationQueueManager 封装队列操作）

### 7.11 src/storage/batch-state-store.ts

`BatchStateStore extends DataStore<BatchState>`。

- 默认值为 `{ task_id: '', started_at: '', status: 'completed', filter: { folders: [], skip_tagged: true }, processed_files: [], failed_files: {} }`
- 无额外业务方法（M7 BatchStateManager 封装进度操作）

### 7.12 src/storage/backup-manager.ts

```typescript
export class BackupManager {
  constructor(app: App, manifest: PluginManifest);

  /**
   * 创建带时间戳的 JSON 备份到 backups/ 目录。
   * 备份文件名格式：{originalName}.backup.{timestamp}.json
   * 例如：tag-registry.backup.1710000000000.json
   *
   * 如果 backups/ 目录不存在，自动创建。
   * @returns 备份文件的完整路径
   */
  createBackup(sourceFile: string): Promise<string>;

  /**
   * 列出 backups/ 目录下的所有备份文件。
   * @returns 备份文件路径数组，按时间降序排列
   */
  listBackups(): Promise<string[]>;
}
```

### 7.13 src/seed/seed-schema.ts

导出默认 schema 定义。内容为 §6.1 的完整 JSON 对应的 TypeScript 对象。

```typescript
import type { Schema } from '../types';
export const DEFAULT_SCHEMA: Schema = { /* §6.1 完整内容 */ };
```

### 7.14 src/seed/seed-registry.ts —— ~80 个 ACM CCS 种子标签

导出种子标签数组。所有种子标签均预标记 `status: "verified"`, `verified_by: "seed"`, `flagged: false`。

**要求覆盖以下领域**（约 80 个标签）：

**计算机科学主要领域（domain facet，约 25 个）**：
- `artificial-intelligence`, `machine-learning`, `deep-learning`, `natural-language-processing`, `computer-vision`, `information-retrieval`, `knowledge-representation`, `robotics`
- `software-engineering`, `programming-languages`, `compilers`, `formal-methods`
- `computer-networks`, `distributed-systems`, `operating-systems`, `database-systems`, `cloud-computing`
- `computer-security`, `cryptography`
- `human-computer-interaction`, `computer-graphics`, `data-science`, `computational-linguistics`
- `theory-of-computation`, `algorithms-and-complexity`

**常见方法（method facet，约 25 个）**：
- `supervised-learning`, `unsupervised-learning`, `reinforcement-learning`, `semi-supervised-learning`, `transfer-learning`, `self-supervised-learning`, `federated-learning`
- `transformer`, `convolutional-neural-network`, `recurrent-neural-network`, `generative-adversarial-network`, `variational-autoencoder`, `graph-neural-network`, `attention-mechanism`, `self-attention`
- `gradient-descent`, `backpropagation`, `dropout`, `batch-normalization`
- `bayesian-inference`, `monte-carlo-methods`, `dimensionality-reduction`, `clustering`, `ensemble-methods`
- `neural-network-architecture`

**常见算法（algorithm facet，约 10 个）**：
- `k-means`, `random-forest`, `support-vector-machine`, `k-nearest-neighbors`, `decision-tree`, `logistic-regression`, `linear-regression`, `principal-component-analysis`, `BERT`, `GPT`

**常见工具（software facet，约 10 个）**：
- `pytorch`, `tensorflow`, `scikit-learn`, `numpy`, `pandas`, `jupyter`, `docker`, `git`, `linux`, `vscode`

**常见概念（concept facet，约 10 个）**：
- `overfitting`, `underfitting`, `bias-variance-tradeoff`, `cross-validation`, `regularization`, `feature-engineering`, `data-augmentation`, `hyperparameter-tuning`, `model-interpretability`, `neural-network`

每个种子标签的完整结构：

```typescript
{
  label: 'deep-learning',
  aliases: ['深度学习', 'DL'],
  facets: ['domain', 'method'],  // 可属于多个 facet
  status: 'verified',
  flagged: false,
  relations: {
    broader: ['machine-learning'],
    narrower: ['convolutional-neural-network', 'recurrent-neural-network'],
    related: ['neural-network-architecture', 'backpropagation']
  },
  source: {
    verified_by: 'seed',
    verified_at: '<初始化时间 ISO 格式>'
  }
}
```

**注意**：
- 每个标签的 `aliases` 至少包含中文翻译（如有常见缩写也加入）
- `facets` 设置要准确——一个标签可能同时属于 `domain` 和 `method`（如 `deep-learning`）
- `relations` 中引用的标签必须也在种子库中（或留空），避免悬空引用
- 标签的 label 格式统一为 lowercase-hyphenated

### 7.15 src/seed/initializer.ts

```typescript
export class SeedInitializer {
  constructor(
    schemaStore: SchemaStore,
    registryStore: RegistryStore
  );

  /**
   * 首次启动检测与初始化。
   *
   * **幂等性保证**：
   * 1. 检测 tag-schema.json 是否存在（或为空/无效）
   *    - 不存在 → 写入 DEFAULT_SCHEMA
   *    - 已存在 → 不覆盖
   * 2. 检测 tag-registry.json
   *    - 不存在 → 写入种子标签
   *    - 已存在但 tags 对象为空 → 写入种子标签
   *    - 已存在且有标签 → 不覆盖（保护用户手动增加的标签）
   *
   * 这保证了：用户手动增加标签 → 重启 → 手动增加的标签不被种子覆盖。
   */
  initialize(): Promise<void>;
}
```

### 7.16 styles.css

全局样式占位文件。所有 CSS 类名使用 `.toot-` 前缀。

本阶段仅需包含设置面板相关的基础样式（如有需要）。后续 UI 模块会扩充此文件。

### 7.17 构建配置

**manifest.json**：

```json
{
  "id": "the-only-one-tagger",
  "name": "The Only One Tagger",
  "version": "0.1.0",
  "minAppVersion": "0.15.0",
  "description": "AI-powered tag management system with faceted classification",
  "author": "Your Name",
  "isDesktopOnly": true
}
```

**参考构建配置**：参照 `D:\Vault-4\Projects\obsidian-sample-plugin` 的 esbuild、tsconfig、package.json 配置。确保：
- `tsconfig.json` 开启 `strict` 模式
- esbuild 配置输出到 `main.js`
- `package.json` 的 `scripts` 包含 `build` 和 `dev` 命令

---

## 8. 测试策略

### 8.1 构建验证

- `npm run build` 零报错
- `tsc --noEmit` 类型检查通过
- 输出文件 `main.js` 可被 Obsidian 加载

### 8.2 插件启动验证

- 插件在 Obsidian 中启用，控制台无报错
- 设置面板所有字段可见且可编辑
- `data.json` 首次启动后正确创建，重启后设置不丢失

### 8.3 SeedInitializer 测试

| 场景 | 预期 |
|------|------|
| 首次启动（无 schema/registry 文件） | `tag-schema.json` 含 12 种 type；`tag-registry.json` 含 ~80 种子标签 |
| 首次初始化 → 手动添加标签 → 重启 | 手动增加的标签**不被覆盖** |
| schema 文件存在但为空 JSON `{}` | 不覆盖（已存在即跳过） |
| registry 文件存在但 tags 为空对象 `{ "meta": {...}, "tags": {} }` | 写入种子标签 |

### 8.4 DataStore 基类测试

| 场景 | 预期 |
|------|------|
| 写入后读取 | 数据一致（roundtrip） |
| 文件不存在时 `load()` | 自动创建默认值并写入文件 |
| 文件内容为非法 JSON | 不崩溃，`console.error` 报告，用默认值恢复 |
| 10 个并发 `update()` 调用 | 所有修改均保留，无数据丢失 |
| 第 3 次 `update()` 模拟抛出异常 | 第 4-10 次仍正常执行；第 3 次的调用方收到 reject |

### 8.5 RegistryStore 测试

| 场景 | 预期 |
|------|------|
| `addTag()` 新标签 | registry 中出现该标签，`total_tags` 递增 |
| `addTag()` 已有标签 | 更新字段（如 `verified_by`），`total_tags` 不变 |
| `rejectTag()` | 标签变为 `rejected`，`rejected_in_favor_of` 正确 |
| `rejectTag()` 已在黑名单 | 跳过（幂等） |
| `getTagsByFacets(["method"])` | 返回种子标签中 facets 含 `"method"` 的全部标签，不含 rejected |
| `getBlacklistMap(["domain"])` | 返回 domain facet 下的 rejected 标签映射 |
| `expandFacets("deep-learning", "domain")` | facets 数组追加 `"domain"`（如未有） |
| `expandFacets()` 已有 facet | 跳过（去重，幂等） |
| `deleteTag("some-tag")` | 删除后 `getTag()` 返回 null，`total_tags` 递减 |
| `deleteTag()` 不存在的标签 | 不报错（幂等） |
| `findByAlias("DL")` | 命中 `deep-learning`，返回完整 TagEntry |
| `findByAlias("nonexistent")` | 返回 null |
| `flagTag()` / `unflagTag()` | flagged 状态正确切换 |

### 8.6 StagingStore 测试

| 场景 | 预期 |
|------|------|
| `writeNoteResult()` → `getNoteStaging()` | 返回完整数据 |
| 重新分析覆盖 | 仅覆盖该 type 数据，其他 type 不受影响 |
| `updateTagStatus()` 三态切换 | pending→accepted、accepted→pending、deleted→accepted |
| 并发 5 次 `updateTagStatus()` | 全部生效，无数据丢失 |
| `updateTagBadge()` | badge 更新正确，不影响其他字段 |
| `replaceTag()` | 新条目替代旧条目，`replaces` 链正确继承 |
| `cleanupProcessedTags()` | accepted/deleted 移除、pending 保留、空 type 块移除、空笔记移除 |
| `findAndUpdateTagGlobally()` 跨 3 篇笔记 | 同一标签全部被更新 |
| `findAndUpdateTagGlobally()` updater 返回 null | 条目被移除 |
| `addTagToFacet()` 向已有 staging 追加 | 标签正确追加 |

### 8.7 BackupManager 测试

| 场景 | 预期 |
|------|------|
| `createBackup()` | 备份文件存在，内容与源文件一致 |
| `listBackups()` | 返回所有备份，按时间降序 |
| backups/ 目录不存在 | 自动创建 |

### 8.8 验收流程

1. `npm run build` — TypeScript 无报错
2. 手动复制 `main.js`、`manifest.json`、`styles.css` 到 `.obsidian/plugins/the-only-one-tagger/`
3. 在 Obsidian 中启用插件，检查控制台无报错
4. 检查 `.obsidian/plugins/the-only-one-tagger/` 下的数据文件格式正确
5. 设置面板渲染完整，修改后持久化
6. 重启 Obsidian 后数据持久

---

## 9. 验收标准

1. **构建成功**：`npm run build` 零报错，`tsc --noEmit` 类型检查通过，Obsidian 中可加载
2. **设置面板完整**：三组 AI 服务配置 + 标签行为 + 批量处理参数全部可见可编辑，修改后 `data.json` 正确持久化
3. **类型定义完整**：`types.ts` 覆盖 §6 中所有 JSON 数据格式，导出的接口名称和字段与本文档完全一致
4. **种子数据正确**：首次启动后 `tag-schema.json` 含 12 种 type 完整定义；`tag-registry.json` 含 ~80 个 ACM CCS 种子标签，全部 `verified_by: "seed"`
5. **种子幂等**：重启插件后用户手动增加的标签不被覆盖
6. **RegistryStore 全部 10 个方法行为正确**：幂等性、并发安全、过滤逻辑均符合 §7.7 规格
7. **StagingStore 全部 8 个方法行为正确**：并发安全、清理逻辑、全局遍历均符合 §7.8 规格
8. **DataStore 写入队列**：10 个并发 `update()` 全部成功，单次失败不影响后续
9. **BackupManager**：备份创建和列举功能正常
10. **OperationLock**：acquire/release/isLocked/getCurrentOp 行为正确
11. **数据持久**：所有 Store 的数据在 Obsidian 重启后保持完整
