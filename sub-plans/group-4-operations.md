# Sub-Plan: Group 4 — 标签生命周期操作（M5）

> 本文件是 M5 模块的完整、自包含开发计划。开发者只需阅读此文件即可完成全部实现。
> M5 只有 3 个源文件，但包含全项目最高密度的业务逻辑——它是连接 AI 输出与用户决策的核心调度层。

---

## 1. 开发目标

实现 Accept/Delete/Edit/Regenerate 四种用户操作 + Type 操作的完整业务逻辑。M5 上承 M4 的 AI/验证输出，下接 M2 的持久化和 M3 的 YAML 写入，是整个标签系统的业务编排核心。

你需要实现的 3 个文件：

| 文件 | 路径 | 职责 |
|------|------|------|
| `AnalysisOrchestrator` | `src/operations/analysis-orchestrator.ts` | 编排单篇笔记完整的 9 步分析流程 |
| `TagOperationExecutor` | `src/operations/tag-operation-executor.ts` | Accept/Delete/Edit/Regenerate/applyAll 业务逻辑 |
| `TypeOperationExecutor` | `src/operations/type-operation-executor.ts` | changeType/addType/deleteType 操作 |

---

## 2. 开发范围

### 2.1 你负责的

- `src/operations/analysis-orchestrator.ts`：9 步分析流程（`analyzeNote` / `analyzeWithType`）
- `src/operations/tag-operation-executor.ts`：标签操作（`toggleAccept` / `toggleDelete` / `edit` / `regenerate` / `applyAll`）
- `src/operations/type-operation-executor.ts`：类型操作（`changeType` / `addType` / `deleteType`）

### 2.2 你不负责的（由其他组提供，你只消费接口）

- M1：类型定义（`types.ts`）、常量（`constants.ts`）、`OperationLock`
- M2：`RegistryStore`、`StagingStore`、`QueueStore` 等所有 Store
- M3：`SchemaResolver`、`FrontmatterService`、`ContentHasher`、`TagMatcher`、`TagNormalizer`
- M4：`GenerationProvider`、`VerificationPipeline`、`AIResponseValidator`、`NetworkStatusAggregator`
- M6/M7：侧边栏 UI、批量处理（它们消费你的接口）

---

## 3. 绝对约束

以下规则不可违反：

1. **所有 registry 写入统一推迟到 `applyAll`**——`toggleAccept`、`toggleDelete`、`edit`、`regenerate` 只修改 staging，绝不触碰 registry
2. **`applyAll` 必须检查 `OperationLock.isLocked()`**——被占用时 Notice 提示并拒绝执行
3. **`applyAll` 写入顺序：YAML 优先（最危险）-> Registry -> Queue 清理 -> Staging 清理**——YAML 失败则后续全部不执行，用户可安全重试
4. **`applyAll` 全量替换语义**——staging 提供完整 facet 值集合，直接覆盖旧 YAML
5. **Edit 必须用 `TagMatcher.match()` 做别名解析**——新词经规范化后先查 registry（精确 label -> alias），命中则替换为正式 label
6. **AnalysisOrchestrator 入口处必须 deep clone schema**——防止分析期间 schema 被修改
7. **Regenerate 候选列表不持久化**——仅暂存于内存，关闭侧边栏后丢失
8. **`analyzeWithType` 完全独立**——不携带现有 type 的任何信息，不做跨 type 信息传递
9. **`addTag`/`rejectTag` 必须幂等**——整个 `applyAll` 可安全重入（连续调用两次无副作用）
10. **零运行时依赖**——只依赖 `obsidian` 包

---

## 4. 上游接口（你消费的全部接口）

> M5 的依赖面极广——需要从 M1、M2、M3、M4 四层获取服务。以下是你需要调用的全部接口及其行为契约。

### 4.1 M1 — OperationLock

```typescript
// src/operation-lock.ts
class OperationLock {
  acquire(name: string): boolean;  // 获取锁，成功返回 true，已被占用返回 false
  release(): void;                 // 释放锁
  isLocked(): boolean;             // 查询是否被占用
  getCurrentOp(): string | null;   // 返回当前占用操作名称
}
```

- 同步调用，内存级锁
- `applyAll` 调用 `isLocked()` 检查，被占用时 Notice 提示并拒绝执行
- `applyAll` 自身**不需要 acquire**——它不是互斥操作（互斥操作是 BatchProcessor、TagMerger、Schema Sync）

### 4.2 M2 — RegistryStore

```typescript
// src/storage/registry-store.ts
class RegistryStore extends DataStore<Registry> {
  // 新增 verified 标签（幂等：已存在时更新字段而非报错）
  addTag(entry: TagEntry): void;

  // 标记为黑名单（幂等：已在黑名单时跳过）
  rejectTag(label: string, rejectedInFavorOf: string): void;

  // 按 label 查找
  getTag(label: string): TagEntry | null;

  // 返回 facets 数组与给定 facets 有交集的所有 verified 标签（不含 rejected）
  getTagsByFacets(facets: string[]): TagEntry[];

  // 返回指定 facets 下的黑名单映射 { rejectedLabel -> targetLabel }
  getBlacklistMap(facets: string[]): Record<string, string>;

  // 标记标签为 flagged: true
  flagTag(label: string): void;

  // 取消 flagged 标记
  unflagTag(label: string): void;

  // 自动追加 facet 到已有标签的 facets 数组
  expandFacets(label: string, newFacet: string): void;

  // 从 registry 中彻底删除条目（幂等：不存在时跳过）
  deleteTag(label: string): void;

  // 遍历所有标签的 aliases 数组，返回首个命中的完整 TagEntry
  findByAlias(alias: string): TagEntry | null;
}
```

**你在 `applyAll` 中的使用场景**：
- `addTag()`：🔵/🟡 新标签入库
- `rejectTag()`：`replaces` 链中的标签入黑名单
- `expandFacets()`：已有标签被用于新 facet 时追加
- `getTag()`：判断标签是否已在库中（步骤 7 已有标签比对）

### 4.3 M2 — StagingStore

```typescript
// src/storage/staging-store.ts
class StagingStore extends DataStore<Staging> {
  // 写入/覆盖整个笔记的分析结果（重新分析时覆盖该 type 旧数据，其他 type 不受影响）
  writeNoteResult(notePath: string, typeData: StagingTypeData, analyzedAt: string, contentHash: string): void;

  // 更新单个标签的 user_status（三态切换）
  updateTagStatus(notePath: string, type: string, facet: string, label: string, newStatus: UserStatus): void;

  // 更新单个标签的 badge（验证完成回调）
  updateTagBadge(notePath: string, type: string, facet: string, label: string, newBadge: Badge): void;

  // Edit 替换：移除 oldLabel 条目，插入 newEntry（含 replaces 链继承）
  replaceTag(notePath: string, type: string, facet: string, oldLabel: string, newEntry: StagingTagItem): void;

  // 读取单笔记的完整 staging 数据
  getNoteStaging(notePath: string): StagingNote | null;

  // applyAll 后增量清理：移除 accepted/deleted 条目，清空的 type 块和笔记条目自动移除
  cleanupProcessedTags(notePath: string, typesToClean: string[]): void;

  // 全局标签操作：遍历所有笔记的所有 type/facet，对 label 匹配的条目执行 updater
  findAndUpdateTagGlobally(label: string, updater: (entry: StagingTagItem) => StagingTagItem | null): void;

  // 向指定 facet 追加一个标签条目
  addTagToFacet(notePath: string, type: string, facet: string, newEntry: StagingTagItem): void;
}
```

**关键行为**：
- 所有操作内部通过写入队列保证并发安全（多个 `update()` 严格串行执行）
- `writeNoteResult`：重新分析时覆盖该 type 的旧数据，其他 type 的 staging 数据不受影响
- `cleanupProcessedTags`：仅移除 `user_status` 为 `accepted` 或 `deleted` 的条目；`pending` 保留；空 type 块自动移除；空笔记条目自动移除

### 4.4 M2 — QueueStore

```typescript
// src/storage/queue-store.ts
class QueueStore extends DataStore<VerificationQueue> {
  // 标准 DataStore 方法：load(), save(), update()
  // applyAll 需要读取队列并移除已入库的标签
}
```

### 4.5 M3 — SchemaResolver

```typescript
// src/engine/schema-resolver.ts
class SchemaResolver {
  // 返回该 type 的全部 facet 定义（required + optional）
  resolve(type: string): ResolvedSchema;

  // 返回 12 种 type 的名称 + label + 简短描述（步骤 1 prompt 用）
  getAllTypes(): TypeSummary[];

  // 返回该 type 下所有 value_type: "taxonomy" 的 facet 名称
  getTaxonomyFacets(type: string): string[];
}
```

**`ResolvedSchema` 结构**：包含每个 facet 的 `value_type`（taxonomy/enum/wikilink/free-text/date）、`allow_multiple`（boolean）、`verification_required`（boolean）、`values`（enum 时的可选值列表）。

**你的使用场景**：
- `analyzeNote` 步骤 1 前 deep clone schema 快照
- `applyAll` 步骤 1 校验 facet 有效性
- 配合 `PromptFilterBuilder` 构建候选

### 4.6 M3 — FrontmatterService

```typescript
// src/engine/frontmatter-service.ts
class FrontmatterService {
  // 提取当前 YAML 中的 type/facet/tag 结构
  read(file: TFile): TaggedNote;

  // 全量替换写入
  write(file: TFile, data: TagWriteData): void;

  // 删除某 type 及其全部 facet 数据，同时从 type 数组中移除该 type
  removeTypeBlock(file: TFile, type: string): void;
}
```

**`write()` 内部行为**：
1. 通过 `processFrontMatter` 读取现有 YAML
2. 将 `data.types` 追加到现有 `type` 数组（去重）
3. 将 `data.typeData` 中各 type 块**直接覆盖**对应的 YAML type 块
4. 不在 `data` 中的现有 type 块**原样保留**
5. `_tag_version` 递增、`_tagged_at` 更新

**`TagWriteData` 结构**：

```typescript
interface TagWriteData {
  types: string[];  // 本次写入涉及的 type 列表
  typeData: Record<string, Record<string, any>>;  // 每个 type 下各 facet 的完整值集合
}
```

### 4.7 M3 — ContentHasher

```typescript
// src/engine/content-hasher.ts
class ContentHasher {
  // 计算笔记正文（不含 frontmatter）的 SHA-256 前 8 位
  hash(file: TFile): Promise<string>;
}
```

- 只计算 `---\n...\n---` 之后的 body 内容
- `applyAll` 写入标签到 YAML 后不会改变 hash 值

### 4.8 M3 — TagMatcher

```typescript
// src/engine/tag-matcher.ts
class TagMatcher {
  // 输入经 TagNormalizer 规范化后，按优先级查找：
  // 1. RegistryStore.getTag(normalized) -> 精确 label 匹配
  // 2. RegistryStore.findByAlias(normalized) -> alias 匹配
  // 返回匹配结果含匹配类型和完整 TagEntry（含 status 区分 verified/rejected）
  match(normalizedLabel: string): MatchResult | null;
}

interface MatchResult {
  type: 'exact' | 'alias';
  entry: TagEntry;  // 完整 TagEntry，含 status: "verified" | "rejected"
}
```

**你在 `edit()` 中的使用场景**：
1. 用户输入新词 -> `TagNormalizer.normalize()` -> `TagMatcher.match()`
2. 命中 verified（label 或 alias）-> label 替换为正式 label，badge 为 `registry`（🟢），跳过验证
3. 命中 rejected -> 自动替换为 `rejected_in_favor_of` 目标标签，badge 为 `registry`（🟢）
4. 未命中 -> 新词，在线时 badge 为 `verifying` 并走验证管线，离线时 badge 为 `needs_review`

### 4.9 M3 — TagNormalizer

```typescript
// src/engine/tag-normalizer.ts
class TagNormalizer {
  // 将任意格式字符串转为 lowercase-hyphenated 标准形式
  normalize(input: string): string;
}
```

规则：空格/下划线 -> 连字符、CamelCase 拆分、全部小写、中文不变、去除首尾空白和重复连字符。

### 4.10 M4 — GenerationProvider

```typescript
// src/ai/generation-provider.ts
interface GenerationProvider {
  // 步骤 1：识别笔记类型
  detectType(noteContent: string, typeDescriptions: TypeSummary[]): Promise<string>;

  // 步骤 2：按 type 生成标签，返回完整集合（非增量）
  generateTags(context: TagGenContext): Promise<FacetTagMap>;

  // Regenerate：生成同义候选
  generateSynonyms(tag: string, facet: string, noteContext: string): Promise<string[]>;
}

// FacetTagMap = Record<string, string[]>  例如 { "domain": ["NLP", "attention"], "method": ["transformer"] }
```

### 4.11 M4 — VerificationPipeline

```typescript
// src/verification/verification-pipeline.ts
class VerificationPipeline {
  // 对新词执行两级验证（Wikipedia -> Search+AI），每个标签独立并发
  // 完成后通过事件通知，badge 从 verifying 更新为 wiki_verified/search_verified/needs_review
  verify(tags: NewTagInfo[]): void;

  // 事件订阅
  on(event: 'tagVerified', callback: (label: string, badge: Badge) => void): void;
}
```

- 只接收 AIResponseValidator 已确认不在 registry 中的新词
- 每个标签完成后立即通过事件通知（不等全部完成）
- 保证 ⚪ verifying 是有限时间的临时态，必须在 `request_timeout_ms` 内转为 🔵 或 🟡

### 4.12 M4 — AIResponseValidator

```typescript
// src/ai/ai-response-validator.ts
class AIResponseValidator {
  // 校验 AI 步骤 2 返回的 { facet: [tags] } 映射
  // 返回已区分 verified（🟢 库内标签）和新词的结构化结果
  validate(rawOutput: FacetTagMap, type: string): ValidatedResult;
}

interface ValidatedResult {
  // 每个 facet 下的标签列表，每个标签已标注：
  // - isRegistry: boolean（是否库内标签）
  // - resolvedLabel: string（经规范化和黑名单解析后的最终 label）
  // - badge: Badge
  tags: Record<string, ValidatedTag[]>;
}
```

校验规则（按顺序）：
1. Facet 白名单过滤：丢弃不在当前 type schema 中的 facet
2. TagNormalizer 统一调用：所有 taxonomy 值强制规范化
3. Taxonomy 库内匹配与黑名单解析：TagMatcher.match() -> 命中 verified 为 🟢（label 替换为正式 label）；命中 rejected -> 替换为 `rejected_in_favor_of` 目标标签（🟢）；未命中 -> 新词
4. Enum 黑名单解析：不在 values 列表 -> 查 schema blacklist -> 命中替换，未命中丢弃
5. 单值/多值规范化：`allow_multiple: false` 收到数组取第一个
6. 空值过滤

### 4.13 M4 — NetworkStatusAggregator

```typescript
// src/network/network-status-aggregator.ts
class NetworkStatusAggregator {
  // generation 和 verification 均 online 时返回 true
  isFullyOnline(): boolean;
  getStatusTooltip(): string;
  refreshAll(): Promise<void>;
  on(event: 'statusChange', callback: () => void): void;
}
```

- 你在 `edit()` 中需要判断在线/离线来决定新词的初始 badge（`verifying` vs `needs_review`）

---

## 5. 你必须导出的接口

> 以下接口被 M6（侧边栏 UI）和 M7（批量处理）消费。方法签名、参数、返回值不可更改。

### 5.1 AnalysisOrchestrator

```typescript
// src/operations/analysis-orchestrator.ts
export class AnalysisOrchestrator {
  constructor(
    schemaResolver: SchemaResolver,
    generationProvider: GenerationProvider,
    promptFilterBuilder: PromptFilterBuilder,
    frontmatterService: FrontmatterService,
    aiResponseValidator: AIResponseValidator,
    stagingStore: StagingStore,
    registryStore: RegistryStore,
    contentHasher: ContentHasher,
    verificationPipeline: VerificationPipeline
  );

  /**
   * 完整 9 步分析流程（含 type 检测）
   * - M6 侧边栏"分析"按钮调用
   * - M7 BatchProcessor 逐文件调用
   */
  analyzeNote(file: TFile): Promise<void>;

  /**
   * 跳过 type 检测，直接以给定 type 执行步骤 2-9
   * - TypeOperationExecutor.addType() 调用
   * - TypeOperationExecutor.changeType() 调用
   * - 完全独立调用，不携带现有 type 的任何信息
   */
  analyzeWithType(file: TFile, type: string): Promise<void>;
}
```

### 5.2 TagOperationExecutor

```typescript
// src/operations/tag-operation-executor.ts
export class TagOperationExecutor {
  constructor(
    stagingStore: StagingStore,
    registryStore: RegistryStore,
    frontmatterService: FrontmatterService,
    schemaResolver: SchemaResolver,
    tagNormalizer: TagNormalizer,
    tagMatcher: TagMatcher,
    generationProvider: GenerationProvider,
    verificationPipeline: VerificationPipeline,
    networkStatusAggregator: NetworkStatusAggregator,
    operationLock: OperationLock,
    queueStore: QueueStore
  );

  /** 三态切换：pending->accepted / accepted->pending / deleted->accepted */
  toggleAccept(notePath: string, type: string, facet: string, tagLabel: string): Promise<void>;

  /** 三态切换：pending->deleted / deleted->pending / accepted->deleted */
  toggleDelete(notePath: string, type: string, facet: string, tagLabel: string): Promise<void>;

  /**
   * 编辑替换（含 TagMatcher 别名解析）
   * - newTag 经 TagNormalizer 规范化后查 TagMatcher
   * - 命中 verified -> 🟢；命中 rejected -> 替换为目标标签 🟢
   * - 未命中 -> 在线 verifying / 离线 needs_review
   */
  edit(notePath: string, type: string, facet: string, oldTag: string, newTag: string): Promise<void>;

  /**
   * 生成同义候选列表（返回值仅暂存内存，不持久化）
   * 用户选择后由 UI 层调用 edit() 或直接操作 staging
   */
  regenerate(notePath: string, type: string, facet: string, tag: string, noteContext: string): Promise<string[]>;

  /**
   * 应用全部变更 — 6 步流程
   * 检查 OperationLock -> 构建 TagWriteData -> YAML -> Registry -> Queue -> Staging
   */
  applyAll(notePath: string, file: TFile): Promise<void>;
}
```

### 5.3 TypeOperationExecutor

```typescript
// src/operations/type-operation-executor.ts
export class TypeOperationExecutor {
  constructor(
    analysisOrchestrator: AnalysisOrchestrator,
    stagingStore: StagingStore,
    frontmatterService: FrontmatterService
  );

  /** 修改 type = deleteType(old) + addType(new) */
  changeType(notePath: string, file: TFile, oldType: string, newType: string): Promise<void>;

  /** 完全独立调用 analyzeWithType，结果追加到 staging */
  addType(notePath: string, file: TFile, additionalType: string): Promise<void>;

  /** 从 staging 移除该 type 整块；如已写入 YAML 则一并移除 */
  deleteType(notePath: string, file: TFile, type: string): Promise<void>;
}
```

---

## 6. 需要的类型定义

> 以下类型由 M1 `src/types.ts` 提供。你直接 import 使用。

```typescript
// === 标签库条目 ===
interface TagEntry {
  label: string;
  aliases: string[];
  facets: string[];             // 一个标签可属于多个 facet
  status: 'verified' | 'rejected';
  flagged: boolean;
  relations: {
    broader: string[];
    narrower: string[];
    related: string[];
  };
  source: {
    verified_by: VerifiedBy;
    url?: string;
    verified_at: string;        // ISO datetime
  };
  rejected_in_favor_of?: string;  // 仅 rejected 标签有此字段
}

type VerifiedBy = 'seed' | 'wikipedia' | 'ai_search' | 'manual';

// === Staging 标签项 ===
interface StagingTagItem {
  label: string;
  badge: Badge;
  user_status: UserStatus;
  ai_recommended: boolean;     // true: AI 推荐; false: YAML 已有但 AI 未推荐
  replaces?: string[];         // Edit/Regenerate 产生的替换链
}

type Badge =
  | 'verifying'         // ⚪ 灰色，验证进行中，操作按钮禁用
  | 'registry'          // 🟢 绿色，标签库已有
  | 'wiki_verified'     // 🔵 蓝色，Wikipedia 确认
  | 'search_verified'   // 🔵 蓝色，AI 搜索确认
  | 'needs_review'      // 🟡 黄色，三级验证均未确认
  | 'enum'              // 非 taxonomy，enum 类型
  | 'wikilink'          // 非 taxonomy，wikilink 类型
  | 'free_text'         // 非 taxonomy，free-text 类型
  | 'date';             // 非 taxonomy，date 类型

type UserStatus = 'pending' | 'accepted' | 'deleted';

// === Staging 笔记结构 ===
interface StagingNote {
  analyzed_at: string;
  content_hash: string;
  types: Record<string, StagingTypeBlock>;  // type name -> facet data
}

type StagingTypeBlock = Record<string, StagingTagItem[]>;  // facet name -> tag items

// === FrontmatterService 写入参数 ===
interface TagWriteData {
  types: string[];
  typeData: Record<string, Record<string, any>>;
}

// === SchemaResolver 返回值 ===
interface ResolvedSchema {
  required_facets: FacetDefinition[];
  optional_facets: FacetDefinition[];
}

interface FacetDefinition {
  name: string;
  description: string;
  value_type: 'taxonomy' | 'enum' | 'wikilink' | 'free-text' | 'date';
  allow_multiple: boolean;
  verification_required: boolean;
  values?: string[];            // enum 时的可选值列表
  blacklist?: Record<string, string>;  // enum 时的黑名单映射
}

interface TypeSummary {
  name: string;     // 如 "academic"
  label: string;    // 如 "学术研究"
  description: string;
}

// === FrontmatterService 读取返回值 ===
interface TaggedNote {
  types: string[];
  typeData: Record<string, Record<string, any>>;  // type -> facet -> values
  tagVersion: number;
  taggedAt: string | null;
}
```

---

## 7. 数据格式

### 7.1 tag-staging.json 格式

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
              "user_status": "pending",
              "ai_recommended": true
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
| `badge` | 验证来源/信心级别：`verifying`（⚪ 验证进行中）、`registry`（🟢 库内）、`wiki_verified`（🔵）、`search_verified`（🔵）、`needs_review`（🟡）、`enum`/`wikilink`/`free_text`/`date`（非 taxonomy） |
| `user_status` | `pending`（等待操作）/ `accepted`（已接受）/ `deleted`（已删除） |
| `ai_recommended` | `true`：AI 推荐的标签；`false`：YAML 中已有但 AI 未推荐的标签 |
| `replaces` | 可选。被当前标签替换的旧标签链条（Edit/Regenerate 产生）。`applyAll` 时链条中所有标签入黑名单 |
| `content_hash` | 分析时笔记正文（不含 frontmatter）的 SHA-256 前 8 位 |

### 7.2 YAML frontmatter 写入格式

**单 type 示例**：

```yaml
---
type: [academic]
academic:
  domain: [attention-mechanism, natural-language-processing]
  method: [transformer, self-attention]
  genre: paper
  lang: en
  scholar: ["[[Vaswani-A]]", "[[Shazeer-N]]"]
  venue: NeurIPS-2017
_tag_version: 1
_tagged_at: 2026-03-11
---
```

**多 type 示例**（共享 facet 各自独立）：

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

**元字段**：

| 字段 | 值 | 含义 |
|------|----|------|
| `_tag_version` | 整数 | 每次 `applyAll` 递增（全笔记级别） |
| `_tagged_at` | ISO 日期 | 最后打标时间 |

### 7.3 tag-registry.json 格式（供 applyAll 写入参考）

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
      "relations": { "broader": [], "narrower": [], "related": [] },
      "source": {
        "verified_by": "wikipedia",
        "url": "https://...",
        "verified_at": "2026-03-11T10:30:00Z"
      }
    },
    "ML": {
      "label": "ML",
      "facets": ["domain"],
      "status": "rejected",
      "rejected_in_favor_of": "machine-learning",
      "source": { "verified_by": "manual", "verified_at": "..." }
    }
  }
}
```

---

## 8. 实现规格

### 8.1 AnalysisOrchestrator（9 步分析流程）

文件：`src/operations/analysis-orchestrator.ts`

#### 入口方法 1：`analyzeNote(file: TFile)`

执行完整的步骤 1-9。

#### 入口方法 2：`analyzeWithType(file: TFile, type: string)`

跳过步骤 1，直接以给定 type 从步骤 2 开始执行。供 `TypeOperationExecutor` 的 `addType`/`changeType` 调用。**完全独立——不携带现有 type 的任何信息**。

#### 步骤详情

**步骤 0（隐含）：Schema Deep Clone 快照**

```
入口处对当前 schema 做 deep clone（JSON.parse(JSON.stringify(...))）
整个分析流程使用快照而非实时引用
目的：防止分析期间用户在 Schema Editor 修改 facet 定义导致中途 facet 变化
```

**步骤 1：识别 type**

```
调用 GenerationProvider.detectType(noteContent, schemaResolver.getAllTypes())
返回：type 名称（如 "academic"）
analyzeWithType 跳过此步，直接使用传入的 type
```

**步骤 2：构建候选标签子集**

```
调用 PromptFilterBuilder.build(type)
返回：按 facet 分组的全量候选标签（仅 verified，不含 rejected 黑名单）
```

**步骤 3：读取现有 YAML 标签**

```
调用 FrontmatterService.read(file)
返回：TaggedNote（现有 type/facet/tag 结构）
用于步骤 5 构建 prompt 的"已有标签区块" + 步骤 7 的比对
```

**步骤 4：AI 生成标签**

```
调用 GenerationProvider.generateTags(context)
context 包含：type、候选标签（步骤 2）、已有标签（步骤 3，仅当前 type 下的）、笔记内容
返回：{ facet: [tags] } 完整集合（AI 返回其认为该笔记应拥有的全部标签，非增量）
```

**步骤 5：AIResponseValidator 校验**

```
调用 AIResponseValidator.validate(rawOutput, type)
处理：
  - 过滤非法 facet
  - TagNormalizer 规范化 taxonomy 值
  - TagMatcher 匹配：命中 verified -> 🟢 + label 替换为正式 label
  - 命中 rejected -> 替换为 rejected_in_favor_of 目标标签（🟢）
  - Enum 黑名单解析
  - 单值/多值规范化
  - 空值过滤
返回：ValidatedResult（已区分 🟢 库内标签和新词）
```

**步骤 6：本地组装**

```
将 validator 输出中已区分的标签分类：
  - 🟢 库内标签：badge = "registry"
  - 新词：badge = "verifying"（⚪，后续走验证管线）
```

**步骤 7：已有标签比对（3-way 比对，仅 AI 当前检测到的 type）**

这是最关键的步骤——将 AI 结果与现有 YAML 标签做 3-way 比对，**所有标签均进入 staging**：

```
对于当前 type 下的每个 facet：
  取 AI 推荐的标签集合 A 和现有 YAML 中的标签集合 Y

  情况 1：AI 推荐 + YAML 已有（A ∩ Y）
    -> user_status: "accepted"
    -> ai_recommended: true
    -> badge: 继承步骤 5/6 的判定结果（通常为 "registry" 🟢）
    -> 含义：自动确认，侧边栏灰显

  情况 2：AI 推荐 + YAML 没有（A - Y）
    -> user_status: "pending"
    -> ai_recommended: true
    -> badge: 继承步骤 5/6 的判定结果（🟢 或 "verifying" ⚪）
    -> 含义：正常待审核

  情况 3：YAML 已有 + AI 未推荐（Y - A）
    -> user_status: "accepted"
    -> ai_recommended: false
    -> badge: 通过 RegistryStore.getTag(label) 判定（库内为 "registry" 🟢，未命中为 "needs_review" 🟡）
    -> 含义：默认保留，侧边栏显示"AI 未推荐"标识
    -> 用户可 toggle 为 deleted 以移除
    -> 不走验证管线
```

**`ai_recommended` 字段语义**：
- `true`：AI 推荐的标签（AI 看到了笔记内容，认为应该有此标签）
- `false`：YAML 中已有但 AI 主动未将其列入推荐集合。这比"AI 没看过已有标签"信息量更强——说明 AI 认为该标签不准确或不相关

**首次分析（无已有 YAML）**：所有标签均为 `ai_recommended: true`，不存在情况 3

**步骤 8：写入 StagingStore**

```
调用 StagingStore.writeNoteResult(notePath, typeData, analyzedAt, contentHash)
  - typeData：步骤 7 组装的 StagingTypeBlock
  - contentHash：通过 ContentHasher.hash(file) 计算
  - 重新分析时覆盖该 type 的旧 staging 数据，其他 type 不受影响
```

**步骤 9：新词走验证管线**

```
收集步骤 6 中标记为"新词"（badge = "verifying"）的 taxonomy 标签
调用 VerificationPipeline.verify(newTags)
  - 每个标签独立并发验证
  - 完成后 VerificationPipeline 通过事件通知
  - badge 从 ⚪ 异步更新为 🔵 / 🟡
  - UI 通过事件订阅实时刷新

注意：已有标签（ai_recommended: false）不走验证管线
```

### 8.2 TagOperationExecutor

文件：`src/operations/tag-operation-executor.ts`

#### `toggleAccept(notePath, type, facet, tagLabel)`

**三态切换**——仅修改 staging，不触碰 registry：

```
读取当前 user_status：
  - "pending"  -> 改为 "accepted"
  - "accepted" -> 改回 "pending"
  - "deleted"  -> 改为 "accepted"

调用 StagingStore.updateTagStatus(notePath, type, facet, tagLabel, newStatus)
```

#### `toggleDelete(notePath, type, facet, tagLabel)`

**三态切换**——仅修改 staging，不触碰 registry，**不产生黑名单**：

```
读取当前 user_status：
  - "pending"  -> 改为 "deleted"
  - "deleted"  -> 改回 "pending"
  - "accepted" -> 改为 "deleted"

调用 StagingStore.updateTagStatus(notePath, type, facet, tagLabel, newStatus)
```

#### `edit(notePath, type, facet, oldTag, newTag)`

**含 TagMatcher 别名解析**——核心流程：

```
1. 规范化：normalizedNew = TagNormalizer.normalize(newTag)

2. TagMatcher 查询：matchResult = TagMatcher.match(normalizedNew)

3. 根据匹配结果确定最终 label 和 badge：
   a) 命中 verified（entry.status === "verified"）：
      - finalLabel = matchResult.entry.label（正式 label，如 "DL" -> "deep-learning"）
      - badge = "registry"（🟢）
      - 跳过验证管线

   b) 命中 rejected（entry.status === "rejected"）：
      - finalLabel = matchResult.entry.rejected_in_favor_of（替代标签）
      - badge = "registry"（🟢）
      - 跳过验证管线

   c) 未命中：
      - finalLabel = normalizedNew
      - 在线（NetworkStatusAggregator.isFullyOnline()）：
        badge = "verifying"（⚪），后续走验证管线
      - 离线：
        badge = "needs_review"（🟡），入 verification-queue.json 排队

4. 构建 replaces 链：
   - 读取 oldTag 的现有 replaces 数组
   - 新 replaces = [...(oldTag.replaces || []), oldTag.label]
   - 实现链式追踪（A->B->C 时 C 的 replaces 为 ["A", "B"]）

5. 构建新 StagingTagItem：
   {
     label: finalLabel,
     badge: badge,
     user_status: "accepted",  // Edit 后自动标记为 accepted
     ai_recommended: true,
     replaces: newReplaces
   }

6. 调用 StagingStore.replaceTag(notePath, type, facet, oldTag.label, newEntry)

7. 如果是新词且在线 -> 调用 VerificationPipeline.verify([{ label: finalLabel, facet }])
```

#### `regenerate(notePath, type, facet, tag, noteContext)`

```
1. 调用 GenerationProvider.generateSynonyms(tag, facet, noteContext)
2. 返回候选列表（string[]）
3. 候选列表仅暂存于内存（不持久化，不存入 staging）
4. 关闭侧边栏后丢失，重新点击重新生成

用户从列表中选择后：
  - 由 UI 层组合调用：选中词替换原词（类似 edit 逻辑）
  - replaces = [...(原词.replaces || []), 原词.label, ...未选中候选]
  - 选中词 + 未选中候选 + 原始词全部的处理：
    选中词 -> 入 staging
    原词 + 未选中候选 -> 记入 replaces 数组（applyAll 时全部入黑名单）
```

**Regenerate 限制**：
- 针对单个标签（不是整个 facet）
- 每次点击追加更多同义候选（不替换已有列表）
- 仅适用于 🔵/🟡 badge 的新标签，不适用于 🟢 库内标签
- Prompt 约束：必须产生同义/近义词，不能产生不同概念的标签

#### `applyAll(notePath, file)` — 6 步流程

这是 M5 最核心的方法。**所有 registry 写入在此刻统一执行**。

```
前置检查：
  if (OperationLock.isLocked()) {
    Notice("当前有操作正在执行（{OperationLock.getCurrentOp()}），请等待完成后再应用");
    return;  // 拒绝执行
  }
```

**步骤 1：Facet 有效性校验**

```
用当前 schema（SchemaResolver.resolve(type)）校验 staging 中的 facet
已从 schema 中删除的 facet -> 跳过写入，通过 Notice 通知用户
```

**步骤 2：构建 `TagWriteData`（纯内存计算）**

这是最复杂的步骤。核心规则：

**Type 纳入规则**：

```
遍历 staging 中该笔记的所有 type：
  - 该 type 下存在至少一个 user_status 为 "accepted" 或 "deleted" 的标签
    （即用户做出了至少一个主动决策）
    -> 纳入 TagWriteData.types

  - 该 type 下全部标签为 "pending" 且 ai_recommended: true
    （用户完全未触碰的新建议 type）
    -> 不纳入 TagWriteData
    -> 其 YAML 块原样保留
    -> 其 staging 数据保留（下次审核）
```

这防止了未审核 type 块被全量替换写入空数据导致的数据丢失。

**Facet 值收集规则**（对于纳入的 type）：

```
对每个 facet，收集以下标签作为该 facet 的完整值集合：
  1. user_status: "accepted" 的标签 -> 写入
  2. user_status: "pending" 且 ai_recommended: false 的标签 -> 写入（原 YAML 已有、用户未操作、默认保留）
  3. user_status: "deleted" 的标签 -> 不收集 = 不写入 = 从 YAML 移除
  4. user_status: "pending" 且 ai_recommended: true 的标签 -> 不收集（但 staging 中保留）

对收集到的标签取 label，构成 facet 的值：
  - allow_multiple: true -> 数组
  - allow_multiple: false -> 单值（取第一个）
```

**构建 TagWriteData 对象**：

```typescript
const tagWriteData: TagWriteData = {
  types: typesToWrite,    // 仅纳入的 type
  typeData: {
    "academic": {
      "domain": ["NLP", "attention-mechanism"],
      "method": ["transformer"],
      "genre": "paper",
      ...
    },
    ...
  }
};
```

**步骤 3：写入笔记 YAML（最危险，先执行）**

```
调用 FrontmatterService.write(file, tagWriteData)
  - 全量替换：typeData 中的 facet 值直接覆盖对应 YAML type 块
  - 新 type 追加到 type 数组
  - 不在 tagWriteData 中的现有 type 块原样保留
  - _tag_version 递增、_tagged_at 更新

失败处理：
  如果 write() 抛出异常 -> 直接停止，不执行步骤 4-6
  用户可安全重试（因为后续步骤均未执行，无数据不一致）
```

**步骤 4：写入 Registry（幂等）**

遍历所有被纳入的 type 中 `user_status: "accepted"` 的标签：

```
按 badge 决定行为：

  badge = "registry"（🟢 库内标签）：
    -> registry 不变
    -> 但检查当前 facet 是否在标签的 facets 数组中：
       不在 -> RegistryStore.expandFacets(label, currentFacet)

  badge = "wiki_verified"（🔵）：
    -> RegistryStore.addTag({
         label, facets: [currentFacet], status: "verified",
         source: { verified_by: "wikipedia", ... }
       })

  badge = "search_verified"（🔵）：
    -> RegistryStore.addTag({
         label, facets: [currentFacet], status: "verified",
         source: { verified_by: "ai_search", ... }
       })

  badge = "needs_review"（🟡）：
    -> RegistryStore.addTag({
         label, facets: [currentFacet], status: "verified",
         source: { verified_by: "manual", ... }
       })
```

**badge -> verified_by 映射表**：

| badge | verified_by |
|-------|-------------|
| `registry` | 不写入 registry（已存在） |
| `wiki_verified` | `"wikipedia"` |
| `search_verified` | `"ai_search"` |
| `needs_review` | `"manual"` |

处理 `replaces` 链（Edit/Regenerate 产生）：

```
对于每个含 replaces 数组的 accepted 标签：
  遍历 replaces 中的每个 oldLabel：
    RegistryStore.rejectTag(oldLabel, currentLabel)
    // 即 oldLabel 入黑名单，rejected_in_favor_of 指向当前标签
```

**步骤 5：清理验证队列**

```
读取 verification-queue.json
检查本次处理过的标签（步骤 4 中 addTag 的标签）
已入 registry 的标签 -> 从队列移除
```

**步骤 6：StagingStore 增量清理（最后执行）**

```
调用 StagingStore.cleanupProcessedTags(notePath, typesToWrite)
  - 仅移除 user_status 为 "accepted" 或 "deleted" 的标签条目
  - "pending" 的标签保留在 staging 中（多 type 场景用户只审核了部分 type）
  - 当某 type 下所有标签均已处理（无 pending）时移除该 type 块
  - 当笔记下所有 type 块均已清空时移除整个笔记条目
```

**幂等安全保证**：
- YAML 写入幂等（同样的标签写两次结果不变）
- `addTag` 幂等（标签已存在时更新而非创建重复）
- `rejectTag` 幂等（已在黑名单时跳过）
- staging 清理幂等（已清理的条目不存在时跳过）
- 因此整个 `applyAll` 可安全重入

### 8.3 TypeOperationExecutor

文件：`src/operations/type-operation-executor.ts`

#### `changeType(notePath, file, oldType, newType)`

等同于 `deleteType(oldType)` + `addType(newType)`：

```
1. 先移除 staging 中 oldType 的数据
2. 如果 oldType 已写入 YAML -> FrontmatterService.removeTypeBlock(file, oldType)
3. 调用 AnalysisOrchestrator.analyzeWithType(file, newType)
```

#### `addType(notePath, file, additionalType)`

```
调用 AnalysisOrchestrator.analyzeWithType(file, additionalType)
  - 完全独立调用，不携带现有 type 的任何信息
  - 结果通过 StagingStore.writeNoteResult 追加到该笔记的 staging
  - 不影响已有 type 的 staging 数据
```

#### `deleteType(notePath, file, type)`

```
1. 从 staging 中移除该 type 整块
   - 直接操作 StagingStore（移除该 type 键下的所有数据）
2. 如果该 type 已写入 YAML：
   - 调用 FrontmatterService.removeTypeBlock(file, type)
   - 从 YAML 的 type 数组中移除该 type
   - 移除该 type 的全部 facet 数据块
```

---

## 9. 测试策略

### 9.1 toggleAccept 测试

- `pending` -> `accepted`：staging 更新为 `accepted`，**registry 在此阶段无变化**
- `accepted` -> `pending`：撤回接受，staging 回到 `pending`
- `deleted` -> `accepted`：改主意，从删除变为接受

### 9.2 toggleDelete 测试

- `pending` -> `deleted`：staging 更新为 `deleted`，**registry 无任何变化，不产生黑名单**
- `deleted` -> `pending`：撤回删除
- `accepted` -> `deleted`：改主意，从接受变为删除

### 9.3 Edit 测试

- 新词替换旧词入 staging，`replaces` 包含旧词，**registry 在此阶段无变化**
- Edit registry 检查：
  - 编辑为库内已有标签 -> badge 为 🟢 `registry`，不走验证管线
  - 编辑为 rejected 标签 -> 自动替换为目标标签（🟢）
  - 编辑为已有标签的 alias（如 `"DL"`）-> TagMatcher 命中 -> label 替换为正式 label `"deep-learning"`，badge 为 🟢
- Edit 链式：A->B->C，C 的 `replaces` 为 `["A", "B"]`

### 9.4 Regenerate 测试

- 候选列表返回后，选择一个替换，`replaces` 包含原词 + 未选中候选
- 候选列表不持久化（关闭侧边栏后丢失）

### 9.5 applyAll 测试

- **🟢 标签**：staging 移除，YAML 写入，registry 无变化
- **🔵 标签**：YAML 写入 + registry 新增 verified 条目（`verified_by` 正确映射）
- **🟡 标签**：YAML 写入 + registry 新增（`verified_by: "manual"`）
- **已有标签到新 facet**：`RegistryStore.expandFacets()` 被调用
- **含 `replaces` 链**：链中所有标签入黑名单，`rejected_in_favor_of` 指向最终标签
- **全量替换**：已有 YAML `domain: [NLP, ML, DL]`，staging 中 NLP accepted + ML deleted + DL pending(ai_recommended:false) + attention accepted -> 写入 `domain: [NLP, DL, attention]`（ML 被删除，DL 默认保留因为 ai_recommended:false 且 pending）
- **pending 保留**：多 type 笔记中一个 type 全部 accepted、另一个 type 全部 pending(ai_recommended:true) -> apply 后仅 accepted type 写入 YAML，pending type 的 YAML 块原样保留，staging 数据保留
- **type 纳入规则**：staging 中某 type 有 accepted+deleted -> 纳入 TagWriteData；某 type 全部 pending+ai_recommended:true -> 不纳入，不触碰 YAML
- **写入顺序**：YAML 写入失败 -> registry 和 staging 均无变化，可安全重试
- **幂等性**：连续调用两次 -> 第二次无副作用（addTag/rejectTag 幂等，staging 已清理则跳过）
- **facet 校验**：staging 中有已删除的 facet -> 跳过该 facet，Notice 通知用户
- **队列清理**：applyAll 后已入 registry 的标签从 verification-queue.json 中移除
- **OperationLock**：OperationLock 被占用时 applyAll 拒绝执行并 Notice 提示

### 9.6 TypeOperationExecutor 测试

- `changeType`：旧 type staging 清除 + YAML 旧 type 块移除，调用 `analyzeWithType(newType)` 填入新 type 结果
- `addType`：调用 `analyzeWithType(additionalType)`，不影响已有 type 数据，完全独立
- `deleteType`：staging + YAML 中该 type 整块移除

### 9.7 AnalysisOrchestrator 测试

- 重新分析：AI 推荐+YAML已有 -> auto-accepted(ai_recommended:true)；AI 推荐+YAML没有 -> pending(ai_recommended:true)；YAML已有+AI未推荐 -> accepted(ai_recommended:false)
- Schema deep clone：分析期间修改 schema -> 不影响正在运行的分析流程
- analyzeWithType 独立性：不携带现有 type 信息

---

## 10. 验收标准

### 10.1 核心功能验收

1. **完整单篇流程**：对一篇笔记完成分析 -> 逐标签操作（Accept/Delete/Edit/Regenerate） -> 应用，YAML 和 registry 状态均与数据格式定义一致
2. **三态切换正确**：Accept/Delete 在 pending/accepted/deleted 三态之间正确切换
3. **Edit 别名解析**：输入已有标签的 alias -> 自动替换为正式 label（🟢）；输入 rejected 标签 -> 自动替换为目标标签（🟢）
4. **Regenerate 候选列表**：返回同义候选，选择后正确处理 replaces 链，候选列表不持久化
5. **applyAll 写入顺序**：YAML 失败不影响 registry/staging，可安全重试
6. **applyAll 全量替换**：staging 提供完整 facet 值集合，YAML 正确覆盖
7. **applyAll 幂等**：连续调用两次无副作用

### 10.2 Type 操作验收

1. **changeType**：旧 type 数据完全移除，新 type 分析结果正确生成
2. **addType**：完全独立分析，不产生跨 type 数据泄漏
3. **deleteType**：staging + YAML 中该 type 整块移除

### 10.3 数据安全验收

1. **逐条操作不触碰 registry**：所有 Accept/Delete/Edit/Regenerate 仅修改 staging
2. **OperationLock 检查**：applyAll 在锁被占用时拒绝执行
3. **未审核 type 保护**：全部 pending + ai_recommended:true 的 type 不被纳入 TagWriteData，YAML 块原样保留
4. **replaces 链式追踪**：A->B->C 的完整链条在 applyAll 时全部入黑名单
5. **Schema deep clone**：分析期间 schema 变更不影响正在运行的流程

### 10.4 构建验收

1. `npm run build` 零 TypeScript 报错
2. `tsc --noEmit` 类型检查通过
3. 3 个文件均可被 M6/M7 正确 import 和调用
