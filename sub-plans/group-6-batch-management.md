# Sub-Plan: Group 6 — 批量处理 + 标签库管理（M7 + M8）

> 本文件是**完整独立**的开发指南。开发者只需阅读本文件即可完成 M7 和 M8 的全部开发。无需参考其他文档。

---

## 1. 开发目标

本组包含两个**互相独立**的子模块，共 12 个源文件：

- **M7 批量处理**（5 文件）：对全库笔记批量 AI 打标，后台运行不阻塞用户。带过滤、并发控制、进度追踪、暂停/恢复/终止、错误隔离、跨重启恢复。处理结果写入 staging，用户后续通过侧边栏逐篇审核。
- **M8 标签库管理**（7 文件）：标签库的浏览、编辑、合并/删除、导入导出、统计面板、关系自动发现。提供 `BulkYamlModifier` 抽象基类供 TagMerger（本模块）和 Schema Editor（M6，其他团队）共用。

**关键原则**：M7 和 M8 之间**零依赖**，可完全并行开发。

---

## 2. 开发范围

### M7 批量处理（5 文件）

| 文件 | 路径 | 职责 |
|------|------|------|
| VaultScanner | `src/batch/vault-scanner.ts` | 枚举 vault markdown 文件，过滤 + 排序 |
| BatchProcessor | `src/batch/batch-processor.ts` | 并发控制 + 错误隔离 + 暂停/恢复/终止 |
| BatchStateManager | `src/batch/batch-state-manager.ts` | 进度持久化到 `batch-state.json` + 跨重启恢复 |
| BatchStatusBarItem | `src/ui/batch-status-bar.ts` | Obsidian 状态栏进度显示 |
| BatchProgressModal | `src/ui/batch-progress-modal.ts` | 进度查看窗口（笔记列表 + 跳转） |

### M8 标签库管理（7 文件）

| 文件 | 路径 | 职责 |
|------|------|------|
| BulkYamlModifier | `src/management/bulk-yaml-modifier.ts` | **抽象基类**：全库 YAML 批量修改 + 崩溃恢复 |
| TagMerger | `src/management/tag-merger.ts` | 标签合并（A→B）+ 删除模式 |
| ImportExportManager | `src/management/import-export-manager.ts` | Registry JSON 导入导出 |
| RelationDiscoverer | `src/management/relation-discoverer.ts` | AI 批量补全标签关系 |
| TagBrowserModal | `src/ui/tag-browser-modal.ts` | 标签库浏览/搜索/过滤主界面 |
| TagPropertyEditor | `src/ui/tag-property-editor.ts` | 单标签属性编辑面板 |
| StatisticsPanel | `src/ui/statistics-panel.ts` | 实时统计面板（无持久化文件） |

---

## 3. 绝对约束

以下规则不可违反：

1. **M7 与 M8 零依赖** — 两者之间不得有任何 import 关系
2. **零运行时依赖** — 仅依赖 `obsidian` 包，不引入任何 npm 包；HTTP 请求使用 `requestUrl`
3. **CSS 前缀** — 所有样式类名使用 `.toot-` 前缀（the-only-one-tagger 缩写），防止与其他插件冲突
4. **OperationLock 互斥** — BatchProcessor 和 TagMerger 启动前必须 `acquire()`，完成/暂停/终止后必须 `release()`
5. **TagMerger Registry 后置写入** — 所有 YAML 修改 + Staging 清理完成后才写入 Registry
6. **BatchProcessor max_batch_size** — 到达上限（默认 50）时自动暂停并释放 OperationLock
7. **batch-state.json 使用路径集合恢复** — 不使用索引，使用 `processed_files` 路径集合
8. **Statistics 实时计算** — 不产生持久化文件，每次打开时扫描计算
9. **BulkYamlModifier 是抽象基类** — 同时被 TagMerger（本组）和 Schema Editor sync（M6，其他团队开发）继承
10. **processFrontMatter 写入 YAML** — 使用 Obsidian 官方 API，不直接字符串操作
11. **adapter.read/write 操作插件数据文件** — 不让插件数据文件出现在用户笔记列表中
12. **Git 检测** — TagMerger 操作前检测 `.git` 目录，存在时提示用户建议先 commit

---

## 4. 上游接口

以下接口由其他团队已完成，你直接 import 使用。**不要重新实现这些模块**。

### 4.1 OperationLock（M1，`src/operation-lock.ts`）

全局互斥锁，防止 BatchProcessor / TagMerger / Schema Sync 并发执行。

```typescript
class OperationLock {
  /**
   * 同步获取锁。成功返回 true，已被占用返回 false。
   * @param name 操作名称，如 "批量打标"、"标签合并"
   */
  acquire(name: string): boolean;

  /** 释放锁 */
  release(): void;

  /** 当前是否被占用 */
  isLocked(): boolean;

  /** 获取当前占用操作的名称（未占用时返回 null） */
  getCurrentOp(): string | null;
}
```

**使用规则**：
- BatchProcessor：`acquire("批量打标")`，在完成 / pause / terminate 时 `release()`
- TagMerger：`acquire("标签合并")`，完成后 `release()`
- 获取失败时 `Notice` 提示用户当前有其他操作正在执行

### 4.2 AnalysisOrchestrator（M5，`src/operations/analysis-orchestrator.ts`）

编排单篇笔记的完整 AI 分析流程（type 检测 → tag 生成 → 验证 → 写入 staging）。

```typescript
class AnalysisOrchestrator {
  /**
   * 完整分析流程（含 type 检测），将结果写入 StagingStore。
   * 包含 content_hash 计算，用于后续变更检测。
   * @throws 网络错误、AI 调用失败等
   */
  analyzeNote(file: TFile): Promise<void>;
}
```

**BatchProcessor 调用说明**：
- 逐文件调用 `analyzeNote(file)`，结果自动写入 StagingStore
- 如果抛出异常，BatchProcessor 记录错误后跳过该文件，继续下一个
- `analyzeNote` 内部已处理 content_hash 记录

### 4.3 RateLimiter（M4，`src/ai/rate-limiter.ts`）

Token Bucket 算法限速器，按 `baseUrl` 维度控制 API 调用频率。

```typescript
class RateLimiter {
  /** 在令牌可用前 await 阻塞。批量处理时防止 API 被封 */
  acquire(): Promise<void>;
}
```

### 4.4 StagingStore（M2，`src/storage/staging-store.ts`）

暂存区数据存储，所有操作内部通过写入队列保证并发安全。

```typescript
class StagingStore extends DataStore<Staging> {
  /** 读取单笔记的完整 staging 数据 */
  getNoteStaging(notePath: string): Promise<StagingNote | null>;

  /**
   * 全局标签操作：遍历所有笔记的所有 type/facet，
   * 对 label 匹配的条目执行 updater。
   * updater 返回新条目则替换，返回 null 则移除。
   * 供 TagMerger 合并/删除模式使用。
   */
  findAndUpdateTagGlobally(
    label: string,
    updater: (entry: StagingTagItem) => StagingTagItem | null
  ): Promise<void>;
}
```

**M7 使用**：`getNoteStaging()` 用于 BatchProgressModal 判断笔记审核状态。
**M8 使用**：`findAndUpdateTagGlobally()` 用于 TagMerger 合并/删除后的 staging 同步清理。

### 4.5 BatchStateStore（M2，`src/storage/batch-state-store.ts`）

`batch-state.json` 的底层存储，继承自 `DataStore<BatchState>`。

```typescript
class BatchStateStore extends DataStore<BatchState> {
  /** 从磁盘加载 batch-state.json，不存在时返回默认空状态 */
  load(): Promise<BatchState>;

  /** 序列化写入磁盘 */
  save(data: BatchState): Promise<void>;

  /** 串行读-改-写（加载 → mutator 修改 → 写回），写入队列保证并发安全 */
  update(mutator: (data: BatchState) => void): Promise<void>;
}
```

### 4.6 RegistryStore（M2，`src/storage/registry-store.ts`）

标签库数据存储。**M8 需要使用全部方法**。

```typescript
interface TagEntry {
  label: string;
  aliases: string[];
  facets: string[];                    // 标签所属的 facet 列表，如 ["method", "domain"]
  status: "verified" | "rejected";
  flagged?: boolean;                   // 待复核标记（离线 applyAll 后验证失败）
  rejected_in_favor_of?: string;       // rejected 标签指向的正确标签
  relations: {
    broader: string[];
    narrower: string[];
    related: string[];
  };
  source: {
    verified_by: "seed" | "wikipedia" | "ai_search" | "manual";
    url?: string;
    verified_at: string;               // ISO 8601
  };
}

class RegistryStore extends DataStore<Registry> {
  /** 新增 verified 标签。幂等：已存在时更新字段而非报错 */
  addTag(entry: TagEntry): Promise<void>;

  /** 标记为黑名单。幂等：已在黑名单中时跳过 */
  rejectTag(label: string, rejectedInFavorOf: string): Promise<void>;

  /** 按 label 查找标签，未找到返回 null */
  getTag(label: string): Promise<TagEntry | null>;

  /**
   * 返回 facets 数组与给定 facets 有交集的所有 verified 标签。
   * 不含 rejected 标签。
   */
  getTagsByFacets(facets: string[]): Promise<TagEntry[]>;

  /**
   * 返回指定 facets 下的黑名单映射 { rejectedLabel → rejected_in_favor_of }
   */
  getBlacklistMap(facets: string[]): Promise<Record<string, string>>;

  /** 标记标签为 flagged: true */
  flagTag(label: string): Promise<void>;

  /** 取消标签的 flagged 标记 */
  unflagTag(label: string): Promise<void>;

  /** 自动追加 facet 到已有标签的 facets 数组 */
  expandFacets(label: string, newFacet: string): Promise<void>;

  /**
   * 从 registry 中彻底移除该条目（含 verified 和 rejected），
   * 同时递减 meta.total_tags。幂等：标签不存在时跳过。
   * 供 TagMerger 删除模式使用。
   */
  deleteTag(label: string): Promise<void>;

  /**
   * 遍历所有标签（verified + rejected），检查各标签的 aliases 数组
   * 是否包含该字符串，返回首个命中的完整 TagEntry，未命中返回 null。
   */
  findByAlias(alias: string): Promise<TagEntry | null>;

  /** 获取全部标签（用于统计、导入导出、关系发现） */
  load(): Promise<Registry>;

  /** 写入完整 registry 数据 */
  save(data: Registry): Promise<void>;

  /** 串行读-改-写 */
  update(mutator: (data: Registry) => void): Promise<void>;
}
```

**Registry 数据格式**：

```typescript
interface Registry {
  meta: {
    version: number;
    last_updated: string;   // ISO 8601
    total_tags: number;
  };
  tags: Record<string, TagEntry>;   // key = label
}
```

### 4.7 FrontmatterService（M3，`src/engine/frontmatter-service.ts`）

封装 Obsidian `processFrontMatter` API 的结构化 YAML 读写。

```typescript
interface TaggedNote {
  types: string[];                                  // 如 ["academic", "project"]
  typeData: Record<string, Record<string, any>>;    // 如 { academic: { domain: [...], method: [...] } }
  tagVersion: number;
  taggedAt: string;
}

interface TagWriteData {
  types: string[];                                  // 本次写入涉及的 type 列表
  typeData: Record<string, Record<string, any>>;    // 各 type 下各 facet 的完整值集合
}

class FrontmatterService {
  /**
   * 读取笔记 YAML 中的 type/facet/tag 结构。
   * 无 YAML 或无标签相关字段时返回空结构。
   */
  read(file: TFile): Promise<TaggedNote>;

  /**
   * 全量替换写入。
   * - types 追加到现有 type 数组（去重）
   * - typeData 中各 type 块直接覆盖对应 YAML type 块
   * - 不在 data 中的现有 type 块原样保留
   * - _tag_version 递增、_tagged_at 更新
   */
  write(file: TFile, data: TagWriteData): Promise<void>;

  /**
   * 删除某 type 及其全部 facet 数据，同时从 type 数组中移除该 type。
   * 供 TagMerger 删除模式使用（当某 type 下所有 facet 都被清空时）。
   */
  removeTypeBlock(file: TFile, type: string): Promise<void>;
}
```

**TagMerger 使用说明**：TagMerger 在逐文件修改 YAML 时，需要通过 `FrontmatterService` 读取当前 YAML，修改后通过 `processFrontMatter` 写回。具体操作见 §9.2 TagMerger YAML 修改逻辑。

### 4.8 BackupManager（M2，`src/storage/backup-manager.ts`）

在破坏性操作前创建带时间戳的 JSON 备份到 `backups/` 目录。

```typescript
class BackupManager {
  /**
   * 创建备份文件。
   * 备份路径：{pluginDir}/backups/{sourceFileName}.backup.{timestamp}.json
   */
  createBackup(sourceFile: string): Promise<void>;

  /** 列出所有备份文件 */
  listBackups(): Promise<string[]>;
}
```

### 4.9 SchemaResolver（M3，`src/engine/schema-resolver.ts`）

查询 tag-schema.json 中 facet 定义的运行时接口。TagMerger 删除模式需要查询 `allow_multiple` 决定删除策略。

```typescript
interface FacetDefinition {
  description: string;
  value_type: "taxonomy" | "enum" | "wikilink" | "free-text" | "date";
  allow_multiple: boolean;
  verification_required: boolean;
  values?: string[];           // enum 类型时的可选值列表
  blacklist?: Record<string, string>;  // enum 类型时的黑名单映射
}

class SchemaResolver {
  /** 返回该 type 的全部 facet 定义（required + optional） */
  resolve(type: string): ResolvedSchema;

  /** 返回 12 种 type 的名称 + label + 简短描述 */
  getAllTypes(): TypeSummary[];

  /** 返回该 type 下所有 value_type: "taxonomy" 的 facet 名称 */
  getTaxonomyFacets(type: string): string[];
}

interface ResolvedSchema {
  required: Record<string, FacetDefinition>;
  optional: Record<string, FacetDefinition>;
}
```

---

## 5. 你必须导出的接口

以下接口由其他模块消费，**签名不可更改**。

### 5.1 BulkYamlModifier（抽象基类，被 M6 Schema Editor 消费）

**这是最关键的导出**。Schema Editor 的"同步更新"功能继承此基类，与 TagMerger 共享逐文件追踪 + 崩溃恢复能力。

```typescript
/**
 * 全库 YAML 批量修改的抽象基类。
 * 提供：逐文件追踪、状态持久化（pending_files / completed_files）、崩溃恢复。
 *
 * 子类实现 modifyFile() 定义具体的单文件修改逻辑。
 *
 * 消费者：
 * - TagMerger（本组 M8）：标签合并/删除时的 YAML 批量修改
 * - Schema Editor sync（M6，其他团队）：schema 变更时的 YAML 同步更新
 */
abstract class BulkYamlModifier {
  protected app: App;
  protected stateFilePath: string;    // 状态文件路径（merge-state.json 或 schema-sync-state.json）

  constructor(app: App, stateFilePath: string);

  /**
   * 子类必须实现：对单个文件执行 YAML 修改。
   * @param file 要修改的笔记文件
   * @param context 子类自定义的上下文数据
   * @returns 修改是否成功（false 时记为失败但不中断批次）
   */
  protected abstract modifyFile(file: TFile, context: any): Promise<boolean>;

  /**
   * 执行批量修改。
   * 1. 创建状态文件（pending_files + completed_files）
   * 2. 逐文件调用 modifyFile()
   * 3. 每成功一个文件，将其从 pending 移到 completed 并持久化
   * 4. 全部完成后标记 status: "completed"
   *
   * @param files 待处理的文件列表
   * @param context 传递给 modifyFile 的上下文
   * @param onProgress 进度回调 (completed, total)
   */
  async execute(
    files: TFile[],
    context: any,
    onProgress?: (completed: number, total: number) => void
  ): Promise<BulkModifyResult>;

  /**
   * 检测是否有未完成的操作（启动时调用）。
   * 读取状态文件，status 为 "running" 时返回恢复信息。
   */
  async detectIncomplete(): Promise<IncompleteState | null>;

  /**
   * 从上次中断处恢复执行。
   * 读取 pending_files，过滤仍存在的文件，继续处理。
   */
  async resume(context: any): Promise<BulkModifyResult>;

  /** 清理状态文件（操作完成后调用） */
  protected async cleanupState(): Promise<void>;
}

interface BulkModifyResult {
  total: number;
  completed: number;
  failed: number;
  failedFiles: Record<string, string>;  // path → error message
}

interface IncompleteState {
  pendingFiles: string[];     // 剩余待处理文件路径
  completedFiles: string[];   // 已完成文件路径
  context: any;               // 子类自定义上下文（如 source_tag, target_tag）
}
```

### 5.2 其他导出

以下类/函数由 UI 层或主类使用：

| 导出 | 消费者 | 说明 |
|------|--------|------|
| `VaultScanner` | main.ts 命令注册 | 扫描文件列表 |
| `BatchProcessor` | main.ts 命令注册 | 启动/暂停/恢复/终止批量处理 |
| `BatchStateManager` | main.ts 启动恢复检测 | 检测未完成 batch |
| `BatchStatusBarItem` | main.ts onload | 注册状态栏项 |
| `BatchProgressModal` | 状态栏点击事件 | 打开进度窗口 |
| `TagBrowserModal` | main.ts 命令注册 | 打开标签浏览器 |
| `TagMerger` | TagBrowserModal/TagPropertyEditor | 合并/删除标签 |
| `ImportExportManager` | TagBrowserModal | 导入导出操作 |
| `StatisticsPanel` | TagBrowserModal | 统计面板 |
| `RelationDiscoverer` | TagBrowserModal | 关系发现 |

---

## 6. 需要的类型定义

以下类型定义在 `src/types.ts`（M1）中已声明，直接 import 使用。

### 6.1 Staging 相关类型

```typescript
interface StagingTagItem {
  label: string;
  badge: "verifying" | "registry" | "wiki_verified" | "search_verified"
       | "needs_review" | "enum" | "wikilink" | "free_text" | "date";
  user_status: "pending" | "accepted" | "deleted";
  ai_recommended?: boolean;
  replaces?: string[];
}

interface StagingNote {
  analyzed_at: string;
  content_hash: string;       // 笔记 body 的 SHA-256 前 8 位
  types: Record<string, StagingTypeData>;
}

type StagingTypeData = Record<string, StagingTagItem[]>;
// key = facet 名称, value = 该 facet 下的标签列表

interface Staging {
  notes: Record<string, StagingNote>;   // key = 笔记相对路径
}
```

### 6.2 Batch 相关类型

```typescript
interface BatchState {
  task_id: string;
  started_at: string;
  status: "running" | "paused" | "completed";
  filter: {
    folders: string[];
    skip_tagged: boolean;
  };
  processed_files: string[];              // 已处理文件的相对路径
  failed_files: Record<string, string>;   // path → error message
}
```

### 6.3 Merge 相关类型

```typescript
interface MergeState {
  source_tag: string;
  target_tag: string | null;    // null 表示删除模式
  pending_files: string[];
  completed_files: string[];
  status: "running" | "completed";
}
```

### 6.4 Settings 相关

```typescript
interface TootSettings {
  // ... 其他设置
  batch_concurrency: number;    // 默认 1
  max_batch_size: number;       // 默认 50
  request_timeout_ms: number;   // 默认 30000
  // ...
}
```

---

## 7. 数据格式

### 7.1 batch-state.json（§3.6）

采用**路径集合**而非位置索引记录进度，确保文件系统变更（新建/删除/重命名笔记）后恢复不出错。

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

**路径集合恢复语义**：
- 恢复时用同样的 `filter` 条件重新扫描文件列表
- 过滤掉 `processed_files` 中已存在的路径
- 剩余文件从头继续处理
- 用户删除笔记 → 重新扫描时不在列表中，自然跳过
- 新建笔记 → 不在 `processed_files` 中，会被处理
- 重命名 → 旧路径不影响，新路径会被重新处理（多一次 AI 调用，远好于跳过或出错）
- 400 个路径约 16KB 存储，完全可接受

**存储位置**：`.obsidian/plugins/the-only-one-tagger/batch-state.json`

### 7.2 merge-state.json

TagMerger 的操作进度状态，用于崩溃恢复。

```json
{
  "source_tag": "ml",
  "target_tag": "machine-learning",
  "pending_files": [
    "Academic/note3.md",
    "Academic/note4.md",
    "Projects/note5.md"
  ],
  "completed_files": [
    "Academic/note1.md",
    "Academic/note2.md"
  ],
  "status": "running"
}
```

**删除模式**：`target_tag` 为 `null`。

```json
{
  "source_tag": "deprecated-tag",
  "target_tag": null,
  "pending_files": ["Academic/note3.md"],
  "completed_files": ["Academic/note1.md", "Academic/note2.md"],
  "status": "running"
}
```

**恢复语义**：
- 插件启动时检测 `merge-state.json`（`status: "running"`）
- 提示用户是否继续执行剩余 `pending_files` 的操作
- Staging 同步清理在 YAML 修改完成后执行（幂等，可安全重新执行）
- Registry 写入在最后执行（确保中断时 registry 与"未完成操作"状态一致）

**存储位置**：`.obsidian/plugins/the-only-one-tagger/merge-state.json`

---

## 8. M7 实现规格

### 8.1 VaultScanner（`src/batch/vault-scanner.ts`）

枚举 vault 中的 markdown 文件，返回有序文件列表。

**接口**：

```typescript
interface ScanFilter {
  folders: string[];        // 包含的文件夹路径（空数组 = 全库）
  excludeFolders?: string[];  // 排除的文件夹路径
  skip_tagged: boolean;     // true = 跳过已有 _tagged_at 的笔记
}

class VaultScanner {
  constructor(private app: App);

  /**
   * 扫描 vault 中符合条件的 markdown 文件。
   * @returns 按路径字母序排序的 TFile[]，确保可恢复性
   */
  scan(filter: ScanFilter): TFile[];
}
```

**实现要点**：
1. 通过 `this.app.vault.getMarkdownFiles()` 获取全部 md 文件
2. **文件夹过滤**：`folders` 非空时，只保留路径以任一指定文件夹开头的文件；`excludeFolders` 中的路径排除
3. **skip_tagged 过滤**：通过 `this.app.metadataCache.getFileCache(file)?.frontmatter?._tagged_at` 检测，存在则跳过
4. **路径排序**：结果按 `file.path` 字母序升序排列（`Array.sort()`），确保恢复时文件顺序一致
5. 返回 `TFile[]`，不做任何 AI 调用

### 8.2 BatchProcessor（`src/batch/batch-processor.ts`）

核心批量处理引擎，后台运行。

**接口**：

```typescript
interface BatchProgressEvent {
  processed: number;
  total: number;
  current_file: string;
  failed_count: number;
}

class BatchProcessor {
  constructor(
    private orchestrator: AnalysisOrchestrator,
    private rateLimiter: RateLimiter,
    private stateManager: BatchStateManager,
    private operationLock: OperationLock,
    private settings: TootSettings
  );

  /**
   * 启动批量处理。
   * 1. acquire OperationLock（失败则 Notice + 返回）
   * 2. 截取前 max_batch_size 个文件
   * 3. 按 batch_concurrency 并发处理
   * 4. 到达上限自动暂停
   */
  start(files: TFile[], filter: ScanFilter): Promise<void>;

  /** 暂停当前批次（等待正在处理的文件完成后暂停） */
  pause(): void;

  /** 恢复已暂停的批次 */
  resume(): Promise<void>;

  /** 终止批次（等待正在处理的文件完成后终止） */
  terminate(): void;

  /** 订阅进度事件 */
  on(event: "progress", callback: (data: BatchProgressEvent) => void): void;
  /** 订阅单笔记完成事件（供侧边栏刷新用） */
  on(event: "noteCompleted", callback: (notePath: string) => void): void;

  /** 获取当前状态 */
  getState(): "idle" | "running" | "paused";
}
```

**实现要点**：

1. **OperationLock**：
   - `start()` 入口处调用 `operationLock.acquire("批量打标")`
   - 返回 `false` 时 `new Notice("当前有操作正在执行：" + operationLock.getCurrentOp())`，直接返回
   - `pause()` / `terminate()` / 全部完成时调用 `operationLock.release()`

2. **批次规模上限**：
   - `files` 列表长度超过 `settings.max_batch_size`（默认 50）时，截取前 N 个
   - 到达上限处理完毕后自动暂停
   - `new Notice("本批次 ${max_batch_size} 篇已完成，请审核后再启动下一批")`
   - 调用 `operationLock.release()`
   - 用户可通过命令面板重新启动（`skip_tagged` 自动跳过已打标笔记），逐批推进

3. **并发控制**：
   - 使用简单信号量（计数器 + Promise）控制并发度，值为 `settings.batch_concurrency`（默认 1）
   - 每次处理文件前先 `await rateLimiter.acquire()` 限速
   - 每次处理前再 `await semaphore.acquire()` 控制并发

4. **错误隔离**：
   - 每个文件的 `analyzeNote()` 调用包裹在 try-catch 中
   - 失败时记录到 `stateManager.recordFailure(filePath, error.message)`
   - 不中断批次，继续下一个文件
   - 进度事件中 `failed_count` 递增

5. **暂停/恢复/终止**：
   - 内部维护 `_state: "idle" | "running" | "paused"` 标志
   - `pause()` 设置标志，当前文件处理完后检查标志，停止取下一个文件
   - `resume()` 重置标志，从 stateManager 恢复剩余文件继续
   - `terminate()` 设置标志，当前文件处理完后彻底停止，不可恢复
   - 暂停和终止都调用 `operationLock.release()`

6. **后台运行**：不使用 Worker，直接在主线程通过 async/await 运行。`await` 点足够多（每次 AI 调用），不会阻塞 UI。

### 8.3 BatchStateManager（`src/batch/batch-state-manager.ts`）

将批量处理进度持久化到 `batch-state.json`。

**接口**：

```typescript
class BatchStateManager {
  constructor(private store: BatchStateStore);

  /** 初始化新的批量任务 */
  init(taskId: string, filter: ScanFilter): Promise<void>;

  /** 记录一个文件处理成功 */
  recordSuccess(filePath: string): Promise<void>;

  /** 记录一个文件处理失败 */
  recordFailure(filePath: string, error: string): Promise<void>;

  /** 更新状态（running / paused / completed） */
  setStatus(status: "running" | "paused" | "completed"): Promise<void>;

  /** 获取当前 batch state（从内存缓存读取） */
  getState(): Promise<BatchState>;

  /**
   * 检测是否有未完成的批次。
   * 启动时调用。status 为 "running" 或 "paused" 时返回 true。
   */
  hasIncomplete(): Promise<boolean>;

  /**
   * 获取恢复信息：重新扫描文件 → 过滤 processed_files → 返回剩余文件。
   */
  getRecoveryFiles(scanner: VaultScanner): Promise<TFile[]>;
}
```

**实现要点**：
1. `init()` 创建新的 `batch-state.json`，`processed_files: []`，`failed_files: {}`，`status: "running"`
2. `recordSuccess()` 将文件相对路径追加到 `processed_files` 并立即 `store.save()`
3. `recordFailure()` 将文件路径和错误信息写入 `failed_files` 并持久化
4. `getRecoveryFiles()` 恢复逻辑：
   - 从 state 中读取 `filter` 条件
   - 调用 `scanner.scan(filter)` 重新扫描
   - 将结果中已在 `processed_files` 集合中的路径过滤掉
   - 返回剩余 `TFile[]`
5. 使用 `Set<string>` 缓存 `processed_files` 提高查找效率

### 8.4 BatchStatusBarItem（`src/ui/batch-status-bar.ts`）

Obsidian 右下角状态栏进度项。

**接口**：

```typescript
class BatchStatusBarItem {
  constructor(
    private statusBarEl: HTMLElement,
    private processor: BatchProcessor,
    private openModal: () => void
  );

  /** 显示状态栏项 */
  show(): void;

  /** 隐藏状态栏项 */
  hide(): void;

  /** 更新进度文本 */
  update(processed: number, total: number): void;
}
```

**实现要点**：
1. 通过 `plugin.addStatusBarItem()` 获取状态栏元素
2. 批量处理运行时显示：`"批量打标 127/400"`
3. CSS 类名使用 `.toot-batch-status`
4. 点击事件：调用 `openModal()` 打开 BatchProgressModal
5. 批量处理未运行时隐藏（`display: none`）
6. 订阅 BatchProcessor 的 `progress` 事件自动更新

### 8.5 BatchProgressModal（`src/ui/batch-progress-modal.ts`）

批量处理的**进度查看窗口**（非审核界面，审核在侧边栏完成）。

**接口**：

```typescript
class BatchProgressModal extends Modal {
  constructor(
    app: App,
    private processor: BatchProcessor,
    private stateManager: BatchStateManager,
    private stagingStore: StagingStore
  );
}
```

**UI 规格**：

```
┌──────────────────────────────────────────────────┐
│  批量打标进度                                      │
│  ────────────────────────────────────────────    │
│  [████████████░░░░░░░░] 127/400                   │
│  [暂停] [恢复] [终止]                              │
│                                                    │
│  ▼ 待审核（85）                                    │
│    📄 attention-is-all-you-need.md  [12 标签] [跳转]│
│    📄 bert-paper.md                 [8 标签]  [跳转]│
│    ...                                             │
│                                                    │
│  ▼ 已完成（40）                                    │
│    ✅ my-transformer.md                             │
│    ...                                             │
│                                                    │
│  ▼ 失败（2）                                       │
│    ❌ corrupted-note.md: Invalid YAML  [重试]       │
│    ...                                             │
└──────────────────────────────────────────────────┘
```

**实现要点**：

1. **顶部进度条**：
   - 使用 HTML `<progress>` 元素或自定义 div
   - CSS 类名 `.toot-batch-progress-bar`
   - 显示 `{processed}/{total}`

2. **操作按钮**：
   - `[暂停]`：调用 `processor.pause()`，按钮变为灰色
   - `[恢复]`：调用 `processor.resume()`
   - `[终止]`：确认弹窗后调用 `processor.terminate()`
   - 根据 `processor.getState()` 控制按钮启用/禁用状态

3. **笔记列表（按状态分三组）**：
   - **待审核**：staging 中有该笔记且存在 `user_status: "pending"` 的标签。显示笔记名 + 待审核标签数 + `[跳转]` 按钮
   - **已完成**：staging 中该笔记无 pending 标签（全部 accepted/deleted），或不在 staging 中（已 applyAll）
   - **失败**：`failed_files` 中的文件。显示错误原因 + `[重试]` 按钮

4. **跳转行为**：
   - 点击 `[跳转]` 按钮
   - 关闭 Modal（`this.close()`）
   - 在编辑器中打开该笔记：`this.app.workspace.openLinkText(notePath, "", false)`
   - 侧边栏自动展示该笔记的 staging 标签（通过已有的 `active-leaf-change` 事件自动触发）

5. **重试行为**：
   - 点击 `[重试]` 按钮
   - 将该文件从 `failed_files` 移除
   - 重新调用 `orchestrator.analyzeNote(file)` 进行分析

6. **可展开分组**：每个分组标题可点击展开/折叠，使用 `.toot-batch-group` 类

7. **实时更新**：订阅 `processor.on("progress")` 事件，每次进度变化时更新进度条和列表

---

## 9. M8 实现规格

### 9.1 BulkYamlModifier（`src/management/bulk-yaml-modifier.ts`）

**抽象基类**，提供全库 YAML 批量修改 + 崩溃恢复能力。

**完整实现指南**：

```typescript
abstract class BulkYamlModifier {
  protected app: App;
  protected stateFilePath: string;

  constructor(app: App, stateFilePath: string) {
    this.app = app;
    this.stateFilePath = stateFilePath;
  }

  /** 子类实现：单文件修改逻辑 */
  protected abstract modifyFile(file: TFile, context: any): Promise<boolean>;

  async execute(
    files: TFile[],
    context: any,
    onProgress?: (completed: number, total: number) => void
  ): Promise<BulkModifyResult> {
    // 1. 创建状态文件
    const state = {
      ...context,
      pending_files: files.map(f => f.path),
      completed_files: [] as string[],
      status: "running" as const
    };
    await this.writeState(state);

    // 2. 逐文件处理
    const result: BulkModifyResult = { total: files.length, completed: 0, failed: 0, failedFiles: {} };

    for (const file of files) {
      try {
        const success = await this.modifyFile(file, context);
        if (success) {
          result.completed++;
        } else {
          result.failed++;
          result.failedFiles[file.path] = "modifyFile returned false";
        }
      } catch (e) {
        result.failed++;
        result.failedFiles[file.path] = e.message;
      }

      // 3. 更新状态文件：移动到 completed
      state.pending_files = state.pending_files.filter((p: string) => p !== file.path);
      state.completed_files.push(file.path);
      await this.writeState(state);

      onProgress?.(result.completed + result.failed, files.length);
    }

    // 4. 标记完成
    state.status = "completed";
    await this.writeState(state);

    return result;
  }

  async detectIncomplete(): Promise<IncompleteState | null> {
    // 读取状态文件，status 为 "running" 返回恢复信息
    const state = await this.readState();
    if (!state || state.status !== "running") return null;

    const { pending_files, completed_files, status, ...context } = state;
    return { pendingFiles: pending_files, completedFiles: completed_files, context };
  }

  async resume(context: any): Promise<BulkModifyResult> {
    const state = await this.readState();
    if (!state) throw new Error("No state file found for resume");

    // 过滤出仍然存在的待处理文件
    const pendingFiles: TFile[] = [];
    for (const path of state.pending_files) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        pendingFiles.push(file);
      }
    }

    return this.execute(pendingFiles, context);
  }

  protected async cleanupState(): Promise<void> {
    // 使用 adapter 删除状态文件
  }

  private async writeState(state: any): Promise<void> {
    // 使用 app.vault.adapter.write() 写入
  }

  private async readState(): Promise<any | null> {
    // 使用 app.vault.adapter.read() 读取，不存在返回 null
  }
}
```

**关键设计**：
- 状态文件路径由构造函数参数决定：TagMerger 传 `merge-state.json`，Schema Editor 传 `schema-sync-state.json`
- 每完成一个文件**立即**持久化状态（从 pending 移到 completed），确保崩溃后能精确恢复
- `modifyFile()` 返回 `false` 或抛异常时，该文件计为失败但**不中断**批次
- `resume()` 重新验证文件存在性（用户可能在中断期间删除了文件）

### 9.2 TagMerger（`src/management/tag-merger.ts`）

标签合并/删除的完整实现。继承 `BulkYamlModifier`。

**接口**：

```typescript
interface MergeOptions {
  sourceTag: string;          // 源标签（要被合并或删除的）
  targetTag: string | null;   // 目标标签（null = 删除模式）
}

interface DryRunResult {
  affectedFiles: Array<{
    path: string;
    changes: string;          // 描述：合并模式 "ml → machine-learning"，删除模式 "移除 ml"
  }>;
  totalAffected: number;
}

class TagMerger extends BulkYamlModifier {
  constructor(
    app: App,
    private registryStore: RegistryStore,
    private stagingStore: StagingStore,
    private frontmatterService: FrontmatterService,
    private backupManager: BackupManager,
    private operationLock: OperationLock,
    private schemaResolver: SchemaResolver
  );

  /** Dry-run 预览：扫描全库 YAML，列出所有受影响笔记 */
  dryRun(options: MergeOptions): Promise<DryRunResult>;

  /**
   * 执行合并/删除操作。
   * 1. acquire OperationLock
   * 2. 创建备份
   * 3. BulkYamlModifier.execute() 逐文件修改 YAML
   * 4. StagingStore 同步清理
   * 5. RegistryStore 写入（后置）
   * 6. release OperationLock
   */
  merge(options: MergeOptions): Promise<BulkModifyResult>;

  /** 检测 vault 是否为 git 仓库 */
  isGitRepo(): boolean;
}
```

**两种模式的 YAML 修改逻辑**（`modifyFile` 实现）：

#### 合并模式（`targetTag` 非空）：A → B

对每个笔记文件，通过 `processFrontMatter` 读取 YAML：

```typescript
// 伪代码
app.fileManager.processFrontMatter(file, (frontmatter) => {
  const types = frontmatter.type || [];
  for (const typeName of types) {
    const typeBlock = frontmatter[typeName];
    if (!typeBlock) continue;
    for (const [facetName, facetValue] of Object.entries(typeBlock)) {
      if (Array.isArray(facetValue)) {
        // allow_multiple: true 的 facet
        const idx = facetValue.indexOf(sourceTag);
        if (idx !== -1) {
          if (facetValue.includes(targetTag)) {
            // A 和 B 都存在 → 移除 A，保留 B（防重复）
            facetValue.splice(idx, 1);
          } else {
            // 只有 A → 替换为 B
            facetValue[idx] = targetTag;
          }
          // 移除后数组为空则删除整个 facet 键
          if (facetValue.length === 0) {
            delete typeBlock[facetName];
          }
        }
      } else if (facetValue === sourceTag) {
        // allow_multiple: false 的单值 facet
        typeBlock[facetName] = targetTag;
      }
    }
  }
});
```

#### 删除模式（`targetTag` 为 null）：移除 A

```typescript
// 伪代码
app.fileManager.processFrontMatter(file, (frontmatter) => {
  const types = frontmatter.type || [];
  for (const typeName of types) {
    const typeBlock = frontmatter[typeName];
    if (!typeBlock) continue;
    for (const [facetName, facetValue] of Object.entries(typeBlock)) {
      if (Array.isArray(facetValue)) {
        // allow_multiple: true → 从数组中移除
        const idx = facetValue.indexOf(sourceTag);
        if (idx !== -1) {
          facetValue.splice(idx, 1);
          // 数组空了则删除整个 facet 键
          if (facetValue.length === 0) {
            delete typeBlock[facetName];
          }
        }
      } else if (facetValue === sourceTag) {
        // allow_multiple: false → 直接删除该 facet 键
        delete typeBlock[facetName];
      }
    }
  }
});
```

**StagingStore 同步清理**（YAML 全部修改完成后执行）：

使用 `stagingStore.findAndUpdateTagGlobally()` 遍历所有 staging 数据。

#### 合并模式 staging 清理（三种情况去重）：

```typescript
// 对源标签 A 的处理
await stagingStore.findAndUpdateTagGlobally(sourceTag, (entry) => {
  // 需要检查同一 facet 中是否已有 targetTag
  // 这需要在 findAndUpdateTagGlobally 的 updater 中处理

  // 情况 1: 仅 A 存在，B 不存在 → 替换 label 为 B（保留其他状态不变）
  // 情况 2: A 和 B 同时存在 → 移除 A（返回 null）
  // 情况 3: 仅 B 存在 → 不会触发（因为遍历的是 A）

  // 由于 findAndUpdateTagGlobally 只看到当前条目，
  // 需要在外层预先收集每个 facet 中是否存在 targetTag

  return updatedEntry; // 或 null 表示移除
});
```

**详细实现方案**：由于 `findAndUpdateTagGlobally` 的 updater 只能看到单个条目，三种情况的去重需要在调用前预扫描。实现步骤：

1. **预扫描**：加载整个 staging 数据，对每个笔记的每个 type/facet，检查是否同时包含 `sourceTag` 和 `targetTag`
2. **执行清理**：
   - 如果该 facet 中**只有 A**（无 B）：调用 `findAndUpdateTagGlobally(sourceTag, entry => ({ ...entry, label: targetTag }))`，将 label 替换为 B，保留 `user_status`、`badge` 等状态
   - 如果该 facet 中**A 和 B 同时存在**：调用 `findAndUpdateTagGlobally(sourceTag, () => null)`，移除 A 条目，保留 B 条目
   - 如果该 facet 中**只有 B**：不操作

#### 删除模式 staging 清理：

```typescript
// 直接移除所有 sourceTag 的条目
await stagingStore.findAndUpdateTagGlobally(sourceTag, () => null);
```

**Registry 写入（后置，所有 YAML + Staging 完成后才执行）**：

```typescript
// 合并模式
await registryStore.rejectTag(sourceTag, targetTag);
// B 继承 A 的 relations
const sourceEntry = await registryStore.getTag(sourceTag); // 此时还是 verified
const targetEntry = await registryStore.getTag(targetTag);
if (sourceEntry && targetEntry) {
  // 将 A 的 broader/narrower/related 追加到 B（去重）
  // 通过 registryStore.update() 完成
}

// 删除模式
await registryStore.deleteTag(sourceTag);
```

**完整执行流程**：

```
1. OperationLock.acquire("标签合并") → 失败则 Notice + 返回
2. Git 检测：isGitRepo() → true 时 Notice "建议先 git commit"
3. BackupManager.createBackup("tag-registry.json")
4. BulkYamlModifier.execute(affectedFiles, mergeOptions)
   → 逐文件 modifyFile()
   → 每完成一个文件更新 merge-state.json
5. StagingStore 同步清理（合并模式三种情况去重 / 删除模式直接移除）
6. RegistryStore 写入：
   → 合并模式: rejectTag(A, B) + B 继承 A 的 relations
   → 删除模式: deleteTag(A)
7. merge-state.json 标记 status: "completed"
8. OperationLock.release()
```

**启动恢复**：

```typescript
// 在插件 onload() 中调用
const incomplete = await tagMerger.detectIncomplete();
if (incomplete) {
  // 弹窗确认：是否继续执行？
  // 确认 → tagMerger.resume(incomplete.context)
  // Staging 清理和 Registry 写入在 resume 完成后重新执行（幂等）
}
```

**Git 检测实现**：

```typescript
isGitRepo(): boolean {
  // 检测 vault 根目录下是否存在 .git 目录
  const vaultPath = (this.app.vault.adapter as any).getBasePath();
  // 使用 app.vault.adapter.exists('.git') 检测
  return existsSync(path.join(vaultPath, '.git'));
}
```

### 9.3 TagBrowserModal（`src/ui/tag-browser-modal.ts`）

标签库主界面。

**接口**：

```typescript
class TagBrowserModal extends Modal {
  constructor(
    app: App,
    private registryStore: RegistryStore,
    private tagMerger: TagMerger,
    private importExportManager: ImportExportManager,
    private statisticsPanel: StatisticsPanel,
    private relationDiscoverer: RelationDiscoverer
  );
}
```

**UI 规格**：

```
┌──────────────────────────────────────────────────────┐
│  标签库浏览器                              [统计] [导出]│
│  ──────────────────────────────────────────────────  │
│  搜索: [________________]                             │
│  过滤: [Facet ▼] [Status ▼] [☐ 仅待复核]              │
│                                                      │
│  ⚠️ transformer  | method, domain | 使用 12 次 | →  │
│  ✓  deep-learning | domain, method | 使用 8 次  | →  │
│  ✗  ML (→ machine-learning)                    | →  │
│  ...                                                 │
│                                                      │
│  页码: ◀ 1 / 5 ▶                                     │
│  ──────────────────────────────────────────────────  │
│  [合并标签] [导入]                                     │
└──────────────────────────────────────────────────────┘
```

**功能要点**：

1. **搜索**：输入文本模糊匹配 label 和 aliases 数组中的值
2. **过滤**：
   - **按 facet**：下拉选择 facet，只显示 `facets[]` 包含该值的标签
   - **按 status**：`verified` / `rejected` / 全部
   - **仅待复核**（checkbox）：勾选后只显示 `flagged: true` 的标签
3. **列表项**：
   - `⚠️` 图标：`flagged: true` 的标签
   - `✓`/`✗` 图标：verified / rejected 状态
   - 显示 label、facets、使用次数（从统计面板获取）
   - `→` 点击进入 TagPropertyEditor 详情
4. **分页**：每页 20 项
5. **操作按钮**：
   - `[合并标签]`：弹出输入框（源标签、目标标签），调用 TagMerger.dryRun → 预览 → 确认 → merge
   - `[统计]`：展开/切换到 StatisticsPanel
   - `[导出]`/`[导入]`：调用 ImportExportManager
6. CSS 类名使用 `.toot-tag-browser-*` 前缀

### 9.4 TagPropertyEditor（`src/ui/tag-property-editor.ts`）

编辑单个标签的所有属性。在 TagBrowserModal 内嵌使用，或作为独立面板。

**接口**：

```typescript
class TagPropertyEditor {
  constructor(
    private containerEl: HTMLElement,
    private registryStore: RegistryStore,
    private tagMerger: TagMerger
  );

  /** 渲染指定标签的编辑面板 */
  render(tagLabel: string): Promise<void>;
}
```

**UI 规格**：

```
┌──────────────────────────────────────────┐
│  标签详情: transformer                     │
│  ────────────────────────────────────    │
│  Label: transformer                       │
│  Status: verified    [flagged: ⚠️]        │
│                                          │
│  Facets: [method] [domain] [+ 添加]       │
│  Aliases: [Transformer模型] [Transformer架构] [+ 添加] │
│                                          │
│  Relations:                               │
│    Broader:  [neural-network-architecture] [+ 添加] │
│    Narrower: [vision-transformer] [GPT] [BERT] [+ 添加] │
│    Related:  [self-attention] [seq2seq] [+ 添加]    │
│                                          │
│  来源: wikipedia                          │
│  URL: https://en.wikipedia.org/wiki/...   │
│  验证时间: 2026-03-11T10:30:00Z           │
│                                          │
│  [合并到其他标签] [删除标签]                │
└──────────────────────────────────────────┘
```

**功能要点**：

1. **facets[] 编辑**：可增删的标签列表。添加时从全局 facet 名称列表中选择
2. **aliases[] 编辑**：可增删的文本列表
3. **relations 编辑**：broader / narrower / related 各自可增删。输入时自动补全已有 verified 标签的 label
4. **即时保存**：每次修改后立即通过 `registryStore.update()` 持久化
5. **合并操作**：点击 `[合并到其他标签]` → 输入目标标签 → TagMerger.dryRun → 预览 → 确认 → merge
6. **删除操作**：点击 `[删除标签]` → TagMerger.dryRun(deleteMode) → 预览 → 确认 → merge(deleteMode)
7. **Flagged 标签操作**：
   - 显示 `⚠️` 标记
   - 提供三个选项：修正拼写（触发 TagMerger 合并模式）、确认保留（`unflagTag()`）、删除（触发 TagMerger 删除模式）
8. CSS 类名使用 `.toot-tag-property-*` 前缀

### 9.5 ImportExportManager（`src/management/import-export-manager.ts`）

Registry 的导入导出。

**接口**：

```typescript
interface ImportConflict {
  label: string;
  existing: TagEntry;
  incoming: TagEntry;
}

type ImportStrategy = "overwrite" | "skip" | "manual";

class ImportExportManager {
  constructor(private registryStore: RegistryStore);

  /**
   * 导出 registry 全量 JSON。
   * 返回 JSON 字符串，由调用方处理文件保存对话框。
   */
  exportJSON(): Promise<string>;

  /**
   * 导入 JSON 数据。
   * 1. 格式校验（是否为合法 Registry 结构）
   * 2. 冲突检测（已有同名标签）
   * 3. 返回冲突列表，等待用户选择策略
   */
  detectConflicts(jsonData: string): Promise<ImportConflict[]>;

  /**
   * 执行导入。
   * @param jsonData 导入的 JSON 数据
   * @param strategy 冲突处理策略
   * @param manualResolutions 手动选择的结果（strategy 为 manual 时）
   */
  import(
    jsonData: string,
    strategy: ImportStrategy,
    manualResolutions?: Record<string, "keep" | "replace">
  ): Promise<{ imported: number; skipped: number }>;
}
```

**实现要点**：
1. **导出**：`registryStore.load()` → `JSON.stringify(data, null, 2)`
2. **格式校验**：检查 `meta` 和 `tags` 结构存在，每个 tag 有 `label`、`status` 等必要字段
3. **冲突检测**：遍历导入数据的每个标签，`registryStore.getTag(label)` 查找是否已存在
4. **导入策略**：
   - `overwrite`：直接覆盖已有标签
   - `skip`：跳过已存在的标签
   - `manual`：按 `manualResolutions` 逐个处理

### 9.6 StatisticsPanel（`src/ui/statistics-panel.ts`）

实时计算统计数据，**不产生持久化文件**。

**接口**：

```typescript
interface TagStatistics {
  totalTags: number;
  verifiedCount: number;
  rejectedCount: number;
  flaggedCount: number;
  usageFrequency: Array<{ label: string; count: number }>;   // 按 count 降序
  orphanTags: string[];          // registry 有但全库无笔记使用
  facetDistribution: Record<string, number>;  // facet → 该 facet 下的标签数
}

class StatisticsPanel {
  constructor(
    private app: App,
    private registryStore: RegistryStore
  );

  /** 计算完整统计数据（实时扫描，不缓存） */
  compute(): Promise<TagStatistics>;

  /** 渲染统计面板到指定容器 */
  render(containerEl: HTMLElement): Promise<void>;
}
```

**实现要点**：

1. **总标签数 / verified / rejected / flagged**：从 `registryStore.load()` 遍历 `tags` 对象统计
2. **使用频率**：
   - 遍历 `app.vault.getMarkdownFiles()`
   - 对每个文件通过 `app.metadataCache.getFileCache(file)?.frontmatter` 读取 YAML
   - 提取所有 type 下所有 facet 的值，统计每个标签出现次数
   - 按次数降序排列
3. **孤立标签**：registry 中 `status: "verified"` 且使用次数为 0 的标签
4. **Facet 分布**：遍历 registry 中每个标签的 `facets[]`，按 facet 名聚合计数

**UI 规格**：

```
┌──────────────────────────────────────┐
│  标签库统计                            │
│  ──────────────────────────────────  │
│  总标签: 156  已验证: 140  黑名单: 16  │
│  待复核: 3                             │
│                                      │
│  使用频率 Top 10:                      │
│    deep-learning ████████ 42          │
│    transformer   ██████   31          │
│    ...                                │
│                                      │
│  孤立标签（5）:                        │
│    obsolete-tag, unused-method, ...   │
│                                      │
│  Facet 分布:                          │
│    domain: 45 | method: 38 | ...      │
└──────────────────────────────────────┘
```

CSS 类名使用 `.toot-statistics-*` 前缀。

### 9.7 RelationDiscoverer（`src/management/relation-discoverer.ts`）

利用 AI 批量为缺少 relations 的标签补全 broader / narrower / related。

**接口**：

```typescript
interface RelationDiff {
  label: string;
  current: TagEntry["relations"];
  suggested: TagEntry["relations"];
  added: {
    broader: string[];
    narrower: string[];
    related: string[];
  };
}

class RelationDiscoverer {
  constructor(
    private registryStore: RegistryStore,
    private generationProvider: any   // OpenAICompatibleProvider 实例
  );

  /**
   * 批量发现标签关系。
   * 将全部标签（或指定子集）发送给 AI，
   * AI 拥有全局标签视野，返回建议的关系补全。
   * @param subset 可选，指定要处理的标签列表（为空时处理全部缺少 relations 的标签）
   */
  discover(subset?: string[]): Promise<RelationDiff[]>;

  /**
   * 应用 diff 到 registry。
   * 只追加新关系，不覆盖已有关系。
   */
  apply(diffs: RelationDiff[]): Promise<void>;
}
```

**实现要点**：

1. **标签筛选**：从 registry 中筛选 `status: "verified"` 且 relations 为空（或 broader/narrower/related 均为空数组）的标签
2. **AI 调用**：将全部标签的 label 列表一次性发送给 Generation AI，prompt 包含：
   - 全部标签列表
   - 每个标签的 facets 和 aliases 信息（帮助 AI 理解语义）
   - 输出格式要求：`{ "tag_label": { "broader": [...], "narrower": [...], "related": [...] } }`
   - 约束：只能使用已有标签（registry 中存在的 label），不可创造新标签
3. **Diff 预览**：AI 返回结果与现有 relations 对比，生成 `RelationDiff[]`。只包含新增的关系（已有的不重复显示）
4. **用户确认**：在 UI 中展示 diff 列表，用户逐条确认或全部应用
5. **写入**：通过 `registryStore.update()` 将确认的关系追加到对应标签（不覆盖已有 relations）

---

## 10. 测试策略

### 10.1 M7 测试

| 测试项 | 预期结果 |
|--------|---------|
| Scanner 文件夹过滤 | 只返回指定文件夹下的 md 文件 |
| Scanner skip_tagged | 跳过已有 `_tagged_at` 的笔记 |
| Scanner 排序 | 结果按 `file.path` 字母序 |
| Processor 正常流程 | 10 个文件全部处理，进度事件准确 |
| Processor 错误隔离 | 第 3 个文件报错 → 其余 9 个正常完成 |
| Processor 并发 | `batch_concurrency: 3` 时同时 3 个文件 |
| Processor OperationLock | 已锁定时 Notice 提示，不启动 |
| Processor max_batch_size | 100 个文件 → 处理 50 个后自动暂停，Notice 提示 |
| State 路径恢复 | 处理 5/10 → 重启 → 重新扫描过滤 processed → 继续 5 个 |
| State 文件系统变更 | 删除已处理文件 + 新建文件 → 恢复后新文件被处理 |
| 暂停/恢复 | 暂停后无新 API 调用，恢复后继续 |
| 终止 | 终止后不可恢复（需重新启动） |
| 状态栏 | 显示正确进度文本，点击打开 Modal |
| Modal 跳转 | 关闭 Modal → 打开笔记 → 侧边栏展示 staging |
| Modal 重试 | 失败文件重试后成功 |
| Rate limiting | 批量处理不超过 API 速率限制 |

### 10.2 M8 测试

| 测试项 | 预期结果 |
|--------|---------|
| 搜索 | 精确匹配、alias 匹配、部分匹配 |
| 过滤 | 单条件、组合条件、flagged 过滤 |
| 编辑 facets | 修改后 RegistryStore 持久化正确 |
| 合并 dry-run | 报告列出所有受影响文件及具体修改 |
| 合并执行 | 备份 → YAML 更新 → staging 清理 → registry（按此顺序） |
| 合并中断恢复 | 30/62 文件后中断 → 恢复后剩余 32 文件处理 → registry 最终写入 |
| 删除模式 dry-run | 列出包含该标签的笔记及将发生的移除 |
| 删除模式 allow_multiple:true | 从数组移除元素；空数组则删 facet 键 |
| 删除模式 allow_multiple:false | 直接删除 facet 键 |
| 删除模式 registry | 全部 YAML 完成后 `deleteTag()` 彻底移除 |
| 合并 staging 清理（仅 A） | A→B 后 staging 中 A 的 label 变为 B，状态不变 |
| 合并 staging 清理（A+B） | A→B 后 staging 中 A 移除，B 保留 |
| 删除 staging 清理 | A 从 staging 中全部移除 |
| Staging 防撤销 | 合并后 applyAll → YAML 写入 B（非 A） |
| 合并去重 | staging 中 domain 有 `ml`(pending) + `machine-learning`(accepted) → 合并后只剩 `machine-learning`(accepted) |
| Git 检测 | `.git` 存在时提示建议 commit |
| 导入导出 roundtrip | 导出 → 导入 → 数据完整一致 |
| 导入冲突 | 检测已有同名标签，按策略处理 |
| 统计 | 各计数与实际数据一致 |
| 统计实时性 | 修改 registry 后重新计算，数据更新 |
| 关系发现 | AI 返回结果正确写入，不覆盖已有 relations |
| BulkYamlModifier 崩溃恢复 | 中断后 detectIncomplete 返回正确 pending/completed |
| BulkYamlModifier 幂等 | resume 时 Staging/Registry 重新执行无副作用 |

---

## 11. 验收标准

### 11.1 M7 验收标准

1. **命令面板**"批量打标"启动后台处理，状态栏显示进度（如 `"批量打标 127/400"`）
2. **点击状态栏**打开 BatchProgressModal，笔记列表正确分为三组（待审核/已完成/失败）
3. **点击"跳转"**后正确导航到笔记 + 侧边栏展示该笔记的 staging 标签
4. **暂停/恢复/终止**正常工作，操作后 OperationLock 正确释放
5. **单文件错误不中断批次**：10 个文件中 1 个报错，其余 9 个正常完成
6. **Obsidian 重启后**检测到未完成 batch，提示恢复，恢复后从上次进度继续
7. **并发度可通过设置调整**（`batch_concurrency`）
8. **到达 `max_batch_size` 上限时**自动暂停并释放 OperationLock，Notice 提示用户审核
9. `npm run build` 零报错

### 11.2 M8 验收标准

1. **命令面板**打开标签浏览器，搜索和过滤功能正常（含 flagged 筛选器）
2. **编辑** facets 数组、aliases、relations 后立即生效并持久化
3. **合并操作**（A→B）：dry-run 预览准确 → 确认后备份已创建 → 全库 YAML 中 A 替换为 B → staging 中 A 同步清理 → registry 中 A 标记 rejected
4. **删除操作**：dry-run 预览准确 → 确认后全库 YAML 中该标签被移除 → staging 中该标签被移除 → registry 中该条目被彻底删除
5. **合并/删除中断恢复**：中断后重启可从 merge-state.json 恢复，剩余文件继续处理
6. **Git 检测**：vault 为 git 仓库时提示建议先 commit
7. **导出后重新导入**，标签库数据完整
8. **统计面板**数据准确（标签总数、使用频率、孤立标签、facet 分布）
9. **BulkYamlModifier 基类**可被 TagMerger 和 Schema Editor（M6）共同继承使用
10. `npm run build` 零报错

### 11.3 每模块验收流程

1. `npm run build` — TypeScript 无报错
2. 手动复制 `main.js`、`manifest.json`、`styles.css` 到 `.obsidian/plugins/the-only-one-tagger/`
3. 在 Obsidian 中启用插件，检查控制台无报错
4. 执行上述测试策略和验收标准
5. 检查 `.obsidian/plugins/the-only-one-tagger/` 下的数据文件格式正确
