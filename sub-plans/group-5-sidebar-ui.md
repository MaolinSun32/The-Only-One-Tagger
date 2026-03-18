# Sub-Plan: Group 5 — 侧边栏 UI（M6）

> **本文件是自包含开发计划。开发者只需阅读本文件即可完成 M6 全部实现。**

---

## 1. 开发目标

实现 Obsidian 右侧边栏面板，包含双 Tab 界面：

- **Tab A「标签审核」**：手动模式 / AI 模式 / 批量打标后自动进入 / 批量队列等待态
- **Tab B「标签模式」**（Schema Editor）：type/facet 的 CRUD + Schema 修改同步策略

这是用户与标签系统交互的**唯一主界面**，涵盖标签展示、审核操作、Schema 编辑、网络状态指示。

---

## 2. 开发范围

**13 个源文件 + 1 个样式文件**：

```
src/ui/tag-review-view.ts          ← ItemView 主视图（Tab 切换 + active-leaf-change 监听）
src/ui/manual-mode-renderer.ts     ← 手动模式渲染
src/ui/ai-mode-renderer.ts         ← AI 模式渲染
src/ui/schema-editor-renderer.ts   ← Schema Editor Tab B 渲染

src/ui/components/tag-chip.ts          ← 标签芯片（5 种 value_type 变体）
src/ui/components/facet-section.ts     ← facet 区块（标题 + TagChip 列表 + 添加按钮）
src/ui/components/type-selector.ts     ← type 下拉 + 修改/增加/删除 type 按钮
src/ui/components/network-indicator.ts ← 红绿灯 + tooltip + 点击刷新
src/ui/components/candidate-list.ts    ← Regenerate 候选浮层（内存暂存，不持久化）
src/ui/components/schema-type-list.ts  ← Tab B type 可展开列表
src/ui/components/schema-facet-editor.ts  ← Tab B facet 属性编辑面板
src/ui/components/schema-sync-dialog.ts   ← Schema 修改/删除同步确认弹窗

styles.css                             ← 全局样式（.toot- 前缀）
```

---

## 3. 绝对约束

| # | 约束 | 原因 |
|---|------|------|
| 1 | **所有 CSS 类名使用 `.toot-` 前缀** | 避免与其他插件样式冲突（the-only-one-tagger 缩写） |
| 2 | **使用 Obsidian `ItemView` 实现侧边栏**，`Modal` 实现弹窗 | 官方 API，不用自造容器 |
| 3 | **`checkCallback` 中使用 `getActiveFile()` 获取当前笔记**，不使用焦点检测 | 焦点在侧边栏时 `activeLeaf` 可能指向侧边栏本身 |
| 4 | **Schema Editor：任何同步操作前必须检查 `OperationLock`** | 防止与批量打标/标签合并并发执行 |
| 5 | **BulkYamlModifier 在本 Group 中是 STUB** | 真正实现在 Group 6（M8），本 Group 仅声明接口、提供空壳/mock |
| 6 | **手动模式下 staging 必须持有 COMPLETE 标签集合才能 applyAll** | 否则全量替换语义会丢失原有标签 |
| 7 | **非 taxonomy facet：无验证 badge（圆点）、无 Edit/Regenerate 按钮** | 编辑功能内置在组件本身（下拉/输入框） |
| 8 | **零运行时依赖（仅 obsidian）** | 用 `requestUrl` 替代 fetch/axios |
| 9 | **AI 服务懒初始化** | 插件加载时不创建 AI 实例，首次调用时才初始化 |
| 10 | **使用 `adapter.read/write` 操作插件数据文件** | 不让插件数据文件出现在用户笔记列表 |
| 11 | **使用 `processFrontMatter` 写入 YAML** | 官方 API，避免直接字符串操作 YAML 带来的格式破坏 |

---

## 4. 上游接口

以下接口均由上游模块（M1-M5 + M4 网络层）提供，**你只消费、不实现**。请严格按照签名和语义调用。

### 4.1 M1 基础设施

#### `OperationLock`（`src/operation-lock.ts`）

全局互斥锁，防止破坏性批量操作并发执行。

```typescript
class OperationLock {
  acquire(name: string): boolean;    // 获取锁，成功返回 true
  release(): void;                   // 释放锁
  isLocked(): boolean;               // 当前是否有操作持锁
  getCurrentOp(): string | null;     // 返回当前持锁操作名称
}
```

#### `常量`（`src/constants.ts`）

```typescript
const TOOT_VIEW_TYPE = 'toot-tag-review';  // 视图注册 ID
const TAG_SCHEMA_FILE = 'tag-schema.json';
const TAG_REGISTRY_FILE = 'tag-registry.json';
const TAG_STAGING_FILE = 'tag-staging.json';
const PLUGIN_YAML_FIELDS: string[];  // 12 type 名称 + 'type' + '_tag_version' + '_tagged_at'
```

#### `核心类型`（`src/types.ts`）

```typescript
// 标签验证来源
type VerifiedBy = 'seed' | 'wikipedia' | 'ai_search' | 'manual';

// Badge 信心级别
type Badge = 'verifying' | 'registry' | 'wiki_verified' | 'search_verified'
           | 'needs_review' | 'enum' | 'wikilink' | 'free_text' | 'date';

// 用户操作状态
type UserStatus = 'pending' | 'accepted' | 'deleted';

// Facet 值类型
type ValueType = 'taxonomy' | 'enum' | 'wikilink' | 'free-text' | 'date';

// Staging 中的单个标签条目
interface StagingTagItem {
  label: string;
  badge: Badge;
  user_status: UserStatus;
  ai_recommended?: boolean;   // true=AI推荐, false=YAML已有但AI未推荐
  replaces?: string[];        // Edit/Regenerate 产生的替换链
}

// 单笔记的 staging 数据
interface StagingNote {
  analyzed_at: string;
  content_hash: string;       // 笔记 body SHA-256 前 8 位
  types: Record<string, Record<string, StagingTagItem[]>>;
  // types[typeName][facetName] = StagingTagItem[]
}

// FrontmatterService.write() 的入参
interface TagWriteData {
  types: string[];  // 本次写入涉及的 type 列表
  typeData: Record<string, Record<string, any>>;
  // typeData[typeName][facetName] = 完整值集合
}

// tag-registry.json 中的标签条目
interface TagEntry {
  label: string;
  aliases: string[];
  facets: string[];
  status: 'verified' | 'rejected';
  flagged?: boolean;
  rejected_in_favor_of?: string;
  relations: {
    broader: string[];
    narrower: string[];
    related: string[];
  };
  source: {
    verified_by: VerifiedBy;
    url?: string;
    verified_at: string;
  };
}

// tag-schema.json 中的 facet 定义
interface FacetDefinition {
  description: string;
  value_type: ValueType;
  allow_multiple: boolean;
  verification_required: boolean;
  values?: string[];           // 仅 enum 类型有此字段
  blacklist?: Record<string, string>; // 仅 enum 类型有此字段
}

// type 定义
interface NoteTypeSchema {
  label: string;
  description: string;
  required_facets: string[];
  optional_facets: string[];
}

// SchemaResolver 返回的解析结果（与 types.ts 一致）
interface ResolvedSchema {
  typeName: string;                              // 注意：字段名是 typeName 不是 type
  label: string;
  description: string;
  requiredFacets: Record<string, FacetDefinition>;  // key 是 facet 名称
  optionalFacets: Record<string, FacetDefinition>;
}

// type 摘要
interface TypeSummary {
  name: string;
  label: string;
  description: string;
}

// FrontmatterService.read() 的返回值
interface TaggedNote {
  types: string[];
  typeData: Record<string, Record<string, any>>;
  tagVersion: number;
  taggedAt: string;
}

// 健康状态
type HealthStatus = 'online' | 'offline' | 'not_configured';

// 批量处理状态
interface BatchState {
  task_id: string;
  started_at: string;
  status: 'running' | 'paused' | 'completed' | 'terminated';
  filter: { folders: string[]; skip_tagged: boolean; };
  processed_files: string[];
  failed_files: Record<string, string>;
}
```

### 4.2 M2 数据持久化层

#### `RegistryStore`（`src/storage/registry-store.ts`）

```typescript
class RegistryStore extends DataStore<Registry> {
  // 按 label 查找标签
  getTag(label: string): TagEntry | null;

  // 返回 facets 数组与给定 facets 有交集的所有 verified 标签
  // 仅返回 status: "verified"（不含 rejected）
  getTagsByFacets(facets: string[]): TagEntry[];

  // 遍历所有标签，检查 aliases 数组是否包含该字符串
  // 返回首个命中的完整 TagEntry，未命中返回 null
  findByAlias(alias: string): TagEntry | null;
}
```

**M6 使用场景**：
- 手动模式添加标签时判定 badge（`getTag()` 查库内标签）
- 手动模式初始化 staging 时判定已有标签的 badge

#### `StagingStore`（`src/storage/staging-store.ts`）

```typescript
class StagingStore extends DataStore<Staging> {
  // 读取单笔记的完整 staging 数据
  getNoteStaging(notePath: string): StagingNote | null;

  // 向指定 facet 追加一个标签条目
  // 注意：如果该笔记/type 在 staging 中不存在，
  // 调用方需先通过 FrontmatterService.read() 获取现有标签
  // 并调用 writeNoteResult() 初始化后再调用本方法
  addTagToFacet(notePath: string, type: string, facet: string, newEntry: StagingTagItem): void;

  // 写入/覆盖整个笔记某 type 的分析结果
  writeNoteResult(notePath: string, typeData: Record<string, StagingTagItem[]>,
                  analyzedAt: string, contentHash: string): void;

  // 变更事件（任何 staging 数据变化后触发）
  on(event: 'change', callback: () => void): void;
}
```

**M6 使用场景**：
- 打开笔记时读取 staging 数据（`getNoteStaging()`）
- 手动模式添加标签时初始化 staging（`writeNoteResult()` + `addTagToFacet()`）
- 订阅 change 事件刷新 UI

#### `SchemaStore`（`src/storage/schema-store.ts`）

```typescript
class SchemaStore extends DataStore<Schema> {
  // 读取完整 schema 数据
  load(): Promise<Schema>;

  // 写入完整 schema 数据
  save(data: Schema): Promise<void>;

  // 读-改-写（串行写入队列保证安全）
  update(mutator: (data: Schema) => void): Promise<void>;

  // 变更事件
  on(event: 'change', callback: () => void): void;
}
```

### 4.3 M3 纯计算层

#### `FrontmatterService`（`src/engine/frontmatter-service.ts`）

```typescript
class FrontmatterService {
  // 提取当前 YAML 中的 type/facet/tag 结构
  read(file: TFile): TaggedNote;

  // 全量替换写入（对 TagWriteData 中的 type 块直接覆盖）
  write(file: TFile, data: TagWriteData): void;

  // 删除某 type 及其全部 facet 数据，同时从 type 数组中移除
  removeTypeBlock(file: TFile, type: string): void;
}
```

**M6 使用场景**：
- 手动模式无 staging 时从 YAML 读取展示（`read()`）
- 手动模式初始化 staging 时获取现有标签（`read()`）

#### `SchemaResolver`（`src/engine/schema-resolver.ts`）

```typescript
class SchemaResolver {
  // 返回该 type 的全部 facet 定义（required + optional）
  resolve(type: string): ResolvedSchema;

  // 返回 12 种 type 的名称 + label + 简短描述
  getAllTypes(): TypeSummary[];
}
```

#### `TagNormalizer`（`src/engine/tag-normalizer.ts`）

```typescript
class TagNormalizer {
  // 将任意格式字符串转为 lowercase-hyphenated 标准形式
  // 规则：空格/下划线→连字符, CamelCase拆分, 全部小写, 中文不变, 去重复连字符
  normalize(input: string): string;
}
```

#### `TagMatcher`（`src/engine/tag-matcher.ts`）

```typescript
interface MatchResult {
  type: 'exact' | 'alias';
  entry: TagEntry;  // 完整 TagEntry，含 status（verified/rejected）
}

class TagMatcher {
  // 输入经 TagNormalizer 规范化后匹配 registry
  // 优先级：① getTag(normalized) 精确 label 匹配
  //         ② findByAlias(normalized) alias 匹配
  // 返回 null 表示未命中
  match(normalizedLabel: string): MatchResult | null;
}
```

**M6 使用场景**：手动模式键入新标签时，先 normalize 再 match，决定 badge。

#### `ContentHasher`（`src/engine/content-hasher.ts`）

```typescript
class ContentHasher {
  // 计算笔记 body（frontmatter 之后）的 SHA-256 前 8 位
  hash(file: TFile): Promise<string>;
}
```

**M6 使用场景**：打开审核时比对 `content_hash`，不匹配则显示"笔记已修改"横幅。

### 4.4 M5 业务编排层

#### `AnalysisOrchestrator`（`src/operations/analysis-orchestrator.ts`）

```typescript
class AnalysisOrchestrator {
  // 完整流程（含 type 检测），执行步骤 1-9
  // 结果写入 StagingStore，新词自动走 VerificationPipeline
  analyzeNote(file: TFile): Promise<void>;

  // 跳过 type 检测，以给定 type 执行步骤 2-9
  analyzeWithType(file: TFile, type: string): Promise<void>;
}
```

**M6 使用场景**：
- 用户点击"分析"按钮 → `analyzeNote()`
- TypeOperationExecutor 内部调用 `analyzeWithType()`

#### `TagOperationExecutor`（`src/operations/tag-operation-executor.ts`）

**全部方法**——所有 registry 写入推迟到 `applyAll`，逐条操作仅修改 staging 状态：

```typescript
class TagOperationExecutor {
  // 三态切换：pending→accepted / accepted→pending / deleted→accepted
  toggleAccept(notePath: string, type: string, facet: string, tagLabel: string): void;

  // 三态切换：pending→deleted / deleted→pending / accepted→deleted
  // 不产生黑名单
  toggleDelete(notePath: string, type: string, facet: string, tagLabel: string): void;

  // 新词替换旧词入 staging
  // 旧词记入 replaces 数组（链式继承）
  // 新词走 TagNormalizer → TagMatcher：
  //   命中 verified → 🟢, 命中 rejected → 自动替换为目标标签（🟢）
  //   未命中 → 在线 ⚪ verifying 走验证管线，离线 🟡 needs_review
  edit(notePath: string, type: string, facet: string,
       oldTag: string, newTag: string): Promise<void>;

  // AI 生成同义候选（内存暂存，不持久化）
  // 返回候选列表，UI 展示给用户选择
  regenerate(notePath: string, type: string, facet: string,
             tag: string): Promise<string[]>;

  // 选择 regenerate 候选后确认替换
  // 选中词替换原词入 staging，原词 + 未选中候选全部记入 replaces
  confirmRegenerate(notePath: string, type: string, facet: string,
                    originalTag: string, selectedTag: string,
                    allCandidates: string[]): void;

  // 全量替换写入，所有 registry 操作在此刻统一执行
  // 检查 OperationLock.isLocked()，被占用时 Notice 并拒绝
  // 执行顺序：YAML写入 → Registry写入 → 队列清理 → Staging清理
  applyAll(notePath: string): Promise<void>;
}
```

#### `TypeOperationExecutor`（`src/operations/type-operation-executor.ts`）

**全部方法**：

```typescript
class TypeOperationExecutor {
  // 等同于 deleteType(oldType) + addType(newType)
  changeType(notePath: string, oldType: string, newType: string): Promise<void>;

  // 完全独立调用 analyzeWithType(additionalType)，不携带现有 type 信息
  addType(notePath: string, additionalType: string): Promise<void>;

  // 从 staging 移除该 type 整块；如已写入 YAML 则一并移除
  deleteType(notePath: string, type: string): Promise<void>;
}
```

### 4.5 M4 网络层

#### `NetworkStatusAggregator`（`src/network/network-status-aggregator.ts`）

```typescript
class NetworkStatusAggregator {
  // generation AND verification 均 online 时返回 true
  isFullyOnline(): boolean;

  // 组合各 checker 状态生成人类可读描述
  // 示例："生成服务: ✓ · 验证服务: ✗ 未配置 API Key"
  getStatusTooltip(): string;

  // 手动刷新全部 checker
  refreshAll(): Promise<void>;

  // 任一 checker 状态变更时触发
  on(event: 'statusChange', callback: () => void): void;
}
```

### 4.6 M4 验证层 / M7 批量处理（事件）

#### `VerificationPipeline` 事件

```typescript
// 每个标签验证完成后立即触发（不等全部完成）
verificationPipeline.on('tagVerified', (data: { label: string; badge: Badge }) => void);
```

#### `BatchProcessor` 事件

```typescript
// 单篇笔记处理完成后触发
batchProcessor.on('noteCompleted', (notePath: string) => void);
```

### 4.7 上游依赖：BulkYamlModifier（STUB）

`BulkYamlModifier`（`src/management/bulk-yaml-modifier.ts`）是 Group 6（M8）的产出物。在本 Group 开发期间，**创建一个 stub 实现**：

```typescript
// STUB — 真正实现由 Group 6 (M8) 提供
// Schema Editor 的"同步更新"功能在本 Group 中声明 UI 和流程框架，
// YAML 批量修改的实际执行委托给此 stub
class BulkYamlModifier {
  // 逐文件修改 YAML + 崩溃恢复
  // stub 实现：throw new Error('BulkYamlModifier not yet implemented')
  // 或提供最简单的逐文件遍历（无崩溃恢复）
  async execute(config: SyncConfig): Promise<void> {
    throw new Error('BulkYamlModifier: 此功能将在 Group 6 (M8) 中实现');
  }
}
```

Schema Editor 的"同步更新"按钮在 stub 阶段应：
1. 正确执行 Staging 更新（直接操作 StagingStore）
2. 正确执行 Registry 更新（直接操作 RegistryStore）
3. YAML 批量修改阶段调用 stub → 捕获异常 → Notice 提示"YAML 批量同步功能尚未实现，将在后续版本提供"

---

## 5. 你必须导出的接口

### 5.1 视图注册

在 `main.ts` 的 `onload()` 中注册：

```typescript
this.registerView(TOOT_VIEW_TYPE, (leaf) => new TagReviewView(leaf, this));
```

### 5.2 命令注册

```typescript
this.addCommand({
  id: 'open-tag-review',
  name: '打开标签审核侧边栏',
  callback: () => { this.activateView(); }
});

this.addCommand({
  id: 'analyze-current-note',
  name: '分析当前笔记',
  checkCallback: (checking: boolean) => {
    const file = this.app.workspace.getActiveFile();  // 不用焦点检测
    if (!file) return false;
    if (checking) return true;
    this.analysisOrchestrator.analyzeNote(file);
    return true;
  }
});
```

### 5.3 Ribbon 图标

```typescript
this.addRibbonIcon('tag', 'The Only One Tagger', () => {
  this.activateView();
});
```

### 5.4 事件对外暴露

本 Group 不新增事件。仅消费上游事件（见 §10）。

---

## 6. 需要的类型定义

所有类型定义来自 `src/types.ts`（M1），已在 §4.1 中完整列出。本 Group 不需要新增类型定义，仅使用上游已定义的接口。

关键类型汇总：
- `StagingTagItem` — staging 中的单个标签
- `StagingNote` — 单笔记的完整 staging 数据
- `TagWriteData` — applyAll 的写入数据
- `TagEntry` — registry 中的标签条目
- `FacetDefinition` — schema 中的 facet 定义
- `NoteTypeSchema` — type 定义
- `ResolvedSchema` — SchemaResolver 返回的解析结果
- `TypeSummary` — type 摘要
- `TaggedNote` — FrontmatterService.read() 的返回值
- `Badge` / `UserStatus` / `ValueType` / `HealthStatus` — 枚举/联合类型

---

## 7. UI 规格（逐组件）

### 7.1 TagReviewView（主视图）

**文件**：`src/ui/tag-review-view.ts`

继承 `ItemView`，注册到 Obsidian 右侧边栏。

```
┌─────────────────────────────────────────┐
│  [📋 标签审核] [⚙️ 标签模式]            │  ← Tab 切换
│  ───────────────────────────────────    │
│                                         │
│  （Tab A 或 Tab B 的内容区域）            │
│                                         │
└─────────────────────────────────────────┘
```

**核心逻辑**：
- `getViewType()` 返回 `TOOT_VIEW_TYPE`
- `getDisplayText()` 返回 `"标签审核"`
- `getIcon()` 返回 `"tag"`
- `onOpen()` 创建 Tab 切换 UI + 默认展示 Tab A
- 监听 `workspace.on('active-leaf-change')` → 切换笔记时自动刷新 Tab A 内容
- Tab A 根据状态委托给不同 renderer：
  - 有 staging 数据 → `AIModeRenderer`（无论数据来自 AI 分析还是批量处理）
  - 无 staging + 在线 → 展示"分析"按钮 + 手动模式
  - 无 staging + 离线 → 纯手动模式
  - 笔记在批量队列未处理 → 等待态
- Tab B 委托给 `SchemaEditorRenderer`

### 7.2 TagChip（标签芯片）

**文件**：`src/ui/components/tag-chip.ts`

根据 `value_type` 渲染 5 种不同形态：

#### taxonomy 类型

```
[● label ✓ ✗ ✎ ↻]
 ↑   ↑    ↑ ↑ ↑ ↑
 badge   Accept Delete Edit Regenerate
 圆点
```

- **Badge 圆点颜色**：
  - ⚪ `verifying` — 灰色，加载动画（CSS animation），**所有操作按钮禁用**
  - 🟢 `registry` — 绿色，仅显示 ✓ ✗（库内标签无 Edit/Regenerate）
  - 🔵 `wiki_verified` / `search_verified` — 蓝色，显示 ✓ ✗ ✎ ↻
  - 🟡 `needs_review` — 黄色，显示 ✓ ✗ ✎ ↻

- **`ai_recommended: false` 时**：额外显示"AI 未推荐"灰色小标签（提示用户此标签在 YAML 中已有但 AI 审查后未推荐）

- **user_status 视觉状态**：
  - `accepted` — 标签高亮 + 打勾效果
  - `deleted` — 删除线 + 灰显
  - `pending` — 正常显示

#### enum 类型

```
[value ▼ ✓ ✗]
```

- 下拉选择器，选项来自 `FacetDefinition.values`
- 无 badge 圆点
- 仅 ✓ ✗ 按钮（编辑通过下拉切换完成）

#### wikilink 类型

```
[[[Name]] ___ ✓ ✗]
```

- 输入框 + vault 内自动补全（通过 `app.metadataCache` 搜索笔记名）
- 无 badge 圆点
- 仅 ✓ ✗ 按钮（编辑通过输入框完成）

#### free-text 类型

```
[text_value ___ ✓ ✗]
```

- 纯文本输入框
- 无 badge 圆点
- 仅 ✓ ✗ 按钮（编辑通过输入框完成）

#### date 类型

```
[2026-04-15 📅 ✓ ✗]
```

- 日期选择器或文本框 + ISO 格式校验（`YYYY-MM-DD`）
- 无 badge 圆点
- 仅 ✓ ✗ 按钮（编辑通过选择/输入完成）

### 7.3 FacetSection（facet 区块）

**文件**：`src/ui/components/facet-section.ts`

```
  domain:                    ← facet 标题（含 required/optional 标记）
  [NLP 🟢 ✓✗] [attention ⚪ ···]  ← TagChip 列表
  [+ 添加]                   ← 添加新标签按钮
```

- facet 标题显示 facet description
- TagChip 列表根据该 facet 的 `value_type` 渲染对应形态
- "添加"按钮行为：
  - taxonomy → 弹出输入框，键入后走 TagNormalizer → TagMatcher 判定 badge
  - enum → 弹出下拉，从 values 中选择
  - wikilink → 弹出输入框 + vault 自动补全
  - free-text → 弹出输入框
  - date → 弹出日期输入

### 7.4 TypeSelector（type 选择器）

**文件**：`src/ui/components/type-selector.ts`

```
  Type: [academic ▼] [修改] [+ 增加 type] [× 删除]
```

- 下拉选择当前 type（多 type 笔记显示多个，每个可独立操作）
- **修改 type**：调用 `TypeOperationExecutor.changeType()`
- **增加 type**：弹出 type 选择下拉 → 调用 `TypeOperationExecutor.addType()`
- **删除 type**：确认弹窗 → 调用 `TypeOperationExecutor.deleteType()`
- 无 type 笔记：显示 type 选择下拉供用户选择

### 7.5 NetworkIndicator（网络状态指示器）

**文件**：`src/ui/components/network-indicator.ts`

```
  🟢 在线                    ← isFullyOnline() == true
  🔴 不可用 (hover: 详情)    ← isFullyOnline() == false
```

- 🟢 = generation AND verification 均 online
- 🔴 = 任一不可用
- **🔴 时悬停 tooltip** 显示具体原因：`NetworkStatusAggregator.getStatusTooltip()`
  - 示例：`"生成服务: ✓ · 验证服务: ✗ 未配置 API Key"`
  - 示例：`"生成服务: ✗ 无法连接 · 验证服务: ✓"`
- **单击**可手动刷新网络状态（调用 `refreshAll()`）
- 订阅 `NetworkStatusAggregator.on('statusChange')` 自动更新

### 7.6 CandidateList（Regenerate 候选浮层）

**文件**：`src/ui/components/candidate-list.ts`

```
  ↻ regenerate 点击后展开：
  ┌─────────────────────┐
  │ ○ synonym-a         │
  │ ○ synonym-b         │
  │ ○ synonym-c         │
  │ [再生成更多]          │
  └─────────────────────┘
```

- 每次点击 ↻ 追加更多同义候选（不替换已有列表）
- 用户选中一个 → 调用 `TagOperationExecutor.confirmRegenerate()`
- **不持久化**：关闭侧边栏后列表丢失，重新点击重新生成
- **仅适用于**：🔵 / 🟡 badge 的 taxonomy 标签（不适用于 🟢 库内标签）

### 7.7 SchemaTypeList（Tab B type 列表）

**文件**：`src/ui/components/schema-type-list.ts`

```
  ▶ academic (学术研究)
  ▼ project (项目/复现)
    required: [domain, status, tech-stack]
    optional: [programming-language, software, ...]
    [+ 添加 facet] [编辑 type]
  ▶ course (课程学习)
  ...
  [+ 新增 Type]
```

- 所有 type 的可展开列表
- 展开后显示 required/optional facets
- 支持增删 facet、编辑 type 的 label 和 description
- 底部"新增 Type"按钮

### 7.8 SchemaFacetEditor（facet 属性编辑）

**文件**：`src/ui/components/schema-facet-editor.ts`

点击某 facet 后展开：

```
  description: [方法论/技术方法    ]
  value_type:  taxonomy  (只读)      ← 不可修改 value_type
  allow_multiple: [✓]
  (enum 时) values: [paper, textbook, ...]  [+ 添加] [× 移除]
```

- `value_type` 为**只读**（修改需直接编辑 JSON 文件）
- enum 类型额外显示 values 列表，可增删

### 7.9 SchemaSyncDialog（同步确认弹窗）

**文件**：`src/ui/components/schema-sync-dialog.ts`

继承 `Modal`。

```
┌───────────────────────────────────────┐
│  ⚠️ Schema 修改将影响以下笔记：        │
│                                       │
│  • note-a.md (domain facet)           │
│  • note-b.md (domain facet)           │
│  • note-c.md (domain facet)           │
│  共 3 篇笔记受影响                     │
│                                       │
│  [同步更新]  [仅修改模式]  [取消]       │
└───────────────────────────────────────┘
```

- 仅在**修改/删除**操作时弹出（新增直接生效）
- "同步更新"按钮行为见 §9
- "仅修改模式"仅改 schema，不动 YAML 和 registry
- "取消"关闭弹窗，不做任何修改

---

## 8. 手动模式数据流（critical section）

> **这是最近重新设计的核心流程，必须严格遵守。**

### 8.1 打开笔记时的状态判定

```
打开笔记
  │
  ├─ StagingStore.getNoteStaging(notePath) 有数据?
  │   ├─ YES → 直接展示 staging 数据（与 AI 模式一致），所有操作按钮可用
  │   │        （数据可能来自 AI 分析、批量处理、或之前未完成的手动操作）
  │   │
  │   └─ NO → 检查笔记是否在批量队列中?
  │       ├─ YES → 显示等待态："⏳ 此笔记在批量处理队列中，处理完成后可审核"
  │       │        不加载 staging、不显示标签、不提供分析按钮
  │       │
  │       └─ NO → 从 YAML 读取现有标签并按 type → facet 结构展示
  │              （FrontmatterService.read()）
  │              如果有 staging 的 content_hash → 比对当前文件哈希
  │              不匹配 → 显示横幅："⚠️ 此笔记在分析后已被修改，标签建议可能不准确。[重新分析]"
```

### 8.2 用户添加新标签时的 staging 初始化

**这是手动模式的关键步骤——保证 staging 持有完整标签集合：**

```
用户点击某 type 的某 facet 的 [+ 添加]
  │
  ├─ 检查：该 type 是否已在 staging 中?
  │   ├─ YES → 直接追加新标签到 staging（步骤 3）
  │   │
  │   └─ NO → 先初始化该 type 的 staging：
  │       │
  │       ├─ Step 1: 调用 FrontmatterService.read() 获取该 type 下所有现有 YAML 标签
  │       │
  │       ├─ Step 2: 将所有现有标签加载到 staging，标记为：
  │       │   - user_status: "accepted"（默认保留）
  │       │   - ai_recommended: true（与 AI 模式步骤 7 的"YAML已有+AI推荐"一致）
  │       │   - badge: 通过 RegistryStore.getTag(label) 判定：
  │       │     - getTag() 返回 verified entry → badge: "registry"（🟢）
  │       │     - getTag() 返回 null → badge: "needs_review"（🟡）
  │       │
  │       ├─ Step 3: 调用 StagingStore.writeNoteResult() 写入初始化数据
  │       │
  │       └─ Step 4: 然后追加新标签
  │
  ├─ Step 3（追加新标签）：
  │   新标签经过 TagNormalizer.normalize()
  │   然后 TagMatcher.match(normalized):
  │     │
  │     ├─ 命中 verified（含 aliases 匹配）→ label 替换为正式 label，badge: "registry"（🟢）
  │     ├─ 命中 rejected → 自动替换为 rejected_in_favor_of 目标标签，badge: "registry"（🟢）
  │     └─ 未命中 → badge: "needs_review"（🟡），同时入 verification-queue.json
  │       （联网后后台自动验证）
  │
  └─ 调用 StagingStore.addTagToFacet() 追加
```

### 8.3 无 type 笔记的处理

如果笔记没有 `type` 字段（从未被打标），用户需先从 TypeSelector 选择一个 type，然后才能添加标签。选择 type 后，根据该 type 的 schema 展示空的 facet 区块。

### 8.4 Apply（应用）按钮

手动模式的"应用"按钮调用 `TagOperationExecutor.applyAll()`，与 AI 模式**完全共享**同一个写入逻辑：

1. 检查 `OperationLock.isLocked()` → 被占用则 Notice 拒绝
2. 构建 `TagWriteData`：
   - 收集 `user_status: "accepted"` 的标签
   - 收集 `user_status: "pending"` 且 `ai_recommended: false` 的标签（原 YAML 已有、默认保留）
   - `deleted` 标签不收集 = 从 YAML 移除
3. `FrontmatterService.write()` 全量替换
4. Registry 写入（🔵/🟡 新标签入库）
5. 队列清理
6. Staging 增量清理

### 8.5 手动模式数据完整性保证示例

```
场景：YAML 有 domain: [NLP, ML, DL]，用户手动添加 attention-mechanism

1. staging 无数据 → 初始化：
   domain: [
     { label: "NLP", badge: "registry", user_status: "accepted", ai_recommended: true },
     { label: "ML", badge: "registry", user_status: "accepted", ai_recommended: true },
     { label: "DL", badge: "registry", user_status: "accepted", ai_recommended: true },
   ]

2. 追加新标签：
   domain: [
     { label: "NLP", badge: "registry", user_status: "accepted", ai_recommended: true },
     { label: "ML", badge: "registry", user_status: "accepted", ai_recommended: true },
     { label: "DL", badge: "registry", user_status: "accepted", ai_recommended: true },
     { label: "attention-mechanism", badge: "registry"/"needs_review", user_status: "pending", ai_recommended: true },
   ]

3. Apply → TagWriteData 收集 4 个标签 → YAML: domain: [NLP, ML, DL, attention-mechanism]
   原有标签不丢失 ✓
```

---

## 9. Schema Editor 规格（Tab B）

### 9.1 两级可展开列表

- **第一级**：所有 type 列表（name + label），每个 type 旁有展开/折叠按钮
- **展开某 type 后**：显示 required_facets 和 optional_facets 列表
- **底部**："+ 新增 Type" 按钮

### 9.2 type 操作

| 操作 | 弹窗? | 行为 |
|------|------|------|
| 新增 type | 否 | 直接在 schema 中添加新 type 定义 |
| 编辑 type（label/description） | 否 | 直接更新 schema |
| 删除 type | **弹 SchemaSyncDialog** | 影响所有该 type 的笔记 |
| 重命名 type（name） | **弹 SchemaSyncDialog** | 影响 YAML 中 type 数组 + type 块名称 |

### 9.3 facet 操作

| 操作 | 弹窗? | 行为 |
|------|------|------|
| 新增 facet | 否 | 在 schema 中添加 facet 定义 + 关联到 type |
| 移动 facet（required ↔ optional） | 否 | 仅改 schema 中的归属列表 |
| 从 type 移除 facet | **弹 SchemaSyncDialog** | 影响该 type 下有此 facet 的笔记 |
| 编辑 facet 属性（description, allow_multiple） | 否 | 直接更新 schema |
| enum 值增删 | 删除时弹 | 新增直接生效；删除影响使用该值的笔记 |

### 9.4 修改/删除的同步策略

**触发条件**：重命名或移除 type/facet/enum 值

**SchemaSyncDialog 显示**：
- 受影响笔记列表（通过扫描 vault YAML 得出）
- 三个按钮：`[同步更新]` `[仅修改模式]` `[取消]`

#### "同步更新" 执行流程

```
用户点击 [同步更新]
  │
  ├─ Step 0: OperationLock.acquire("Schema 同步")
  │   失败 → Notice "当前有 {getCurrentOp()} 正在执行，请等待完成" → 终止
  │
  ├─ Step 1: BackupManager 备份 registry
  │   提示用户建议 git commit
  │
  ├─ Step 2: 更新 Staging（最安全，单文件，幂等，毫秒级）
  │   示例：重命名 facet "domain" → "research-area"
  │   → 遍历 StagingStore 中所有笔记，将 facet 键名 "domain" 改为 "research-area"
  │
  ├─ Step 3: 更新 Registry（单文件，幂等）
  │   示例：重命名 facet → 修改所有标签的 facets[] 数组中的 "domain" → "research-area"
  │
  ├─ Step 4: 逐文件修改 YAML（最慢、最危险）
  │   通过 BulkYamlModifier（STUB）执行
  │   ⚠️ 当前为 stub，会抛出异常
  │   → 捕获异常 → Notice "YAML 批量同步功能尚未实现"
  │
  ├─ Step 5: 更新 SchemaStore（写入新 schema）
  │
  └─ Step 6: OperationLock.release()
```

**执行顺序原则**：Staging → Registry → YAML（从最安全到最危险）

#### 崩溃恢复机制（BulkYamlModifier 提供）

YAML 阶段通过 `schema-sync-state.json` 持久化进度：
- `pending_files`：待处理文件列表
- `completed_files`：已处理文件列表
- `status: "running" | "completed"`

恢复时：
1. Staging 和 Registry 更新**无条件重新执行**（幂等，重复执行无副作用）
2. YAML 从 `pending_files` 续传

> 注意：由于 BulkYamlModifier 在本 Group 中是 STUB，崩溃恢复在集成 Group 6 后才能实际工作。

### 9.5 互斥操作期间锁定

通过 `OperationLock.isLocked()` 检查：

```
if (operationLock.isLocked()) {
  // Tab B 顶部显示：
  // "⚠️ {operationLock.getCurrentOp()} 运行中，请等待完成后再修改模式"
  // 所有编辑控件禁用
}
```

当任何互斥操作（批量打标 / 标签合并 / Schema 同步）正在运行时，Tab B 全部编辑控件禁用。

### 9.6 不支持的操作

修改 facet 的 `value_type`（如 enum → taxonomy）**不在 UI 中支持**，需直接编辑 JSON 文件。

---

## 10. 事件订阅关系

本 Group 的 UI 需要订阅以下事件：

| 发布者 | 事件 | 订阅者 | 行为 |
|--------|------|--------|------|
| `StagingStore` | `change` | `TagReviewView` / `ManualModeRenderer` / `AIModeRenderer` | 刷新标签列表（staging 数据变化时自动更新 UI） |
| `VerificationPipeline` | `tagVerified(label, badge)` | `AIModeRenderer` / Tag A 标签审核 | 刷新该标签的 badge 圆点颜色 + 启用操作按钮 |
| `NetworkStatusAggregator` | `statusChange` | `NetworkIndicator` + `TagReviewView` | 更新 🟢/🔴 指示器；切换手动/AI 模式可用性（🔴 时禁用"分析"按钮） |
| `SchemaStore` | `change` | `SchemaEditorRenderer` | 刷新 Tab B 的 type/facet 列表 |
| `BatchProcessor` | `noteCompleted(notePath)` | `TagReviewView` | 如果当前查看的笔记刚被批量处理完成，自动从等待态刷新为审核视图 |
| `workspace` | `active-leaf-change` | `TagReviewView` | 切换笔记时自动刷新 Tab A 内容 |

**事件注册与清理**：
- 所有事件订阅在 `onOpen()` 中注册
- 所有事件订阅在 `onClose()` 中清理（防止内存泄漏）
- 使用 Obsidian 的 `this.registerEvent()` 包装 workspace 事件，自动随视图卸载

---

## 11. 实现规格

### 11.1 Tag A 四种状态

#### 状态 1：AI 模式（在线 + 已分析后）

触发条件：`StagingStore.getNoteStaging(notePath)` 返回非 null 且数据来自 AI 分析

展示：
- NetworkIndicator 🟢 + "分析"按钮
- 按 type → facet → tag 三级结构展示 staging 数据
- TypeSelector（修改/增加/删除 type）
- 每个 facet 的 TagChip 列表
- 底部"全部接受"/"全部删除"/"应用"按钮

#### 状态 2：手动模式（默认态 / 离线时）

触发条件：staging 无数据 + 非批量队列中

展示：
- NetworkIndicator（可能 🔴）
- 如果 🔴："分析"按钮禁用，显示提示"AI 服务不可用，请检查网络连接和 API 配置"
- TypeSelector（选择/添加 type）
- 从 YAML 读取的现有标签展示
- 每个 facet 的"添加"按钮可用
- 底部"应用"按钮

#### 状态 3：批量打标后自动进入

触发条件：`StagingStore.getNoteStaging(notePath)` 返回非 null 且数据来自批量处理

展示：与 AI 模式完全一致（staging 数据自动展示，无需再点"分析"）

#### 状态 4：批量队列等待态

触发条件：笔记在 `batch-state.json` 的未处理队列中

展示：
```
⏳ 此笔记在批量处理队列中，处理完成后可审核
```
- 不加载 staging
- 不显示标签
- 不提供"分析"按钮
- 批量处理完该笔记后（`noteCompleted` 事件）自动刷新为审核视图

### 11.2 "全部接受" / "全部删除" 按钮语义

- **全部接受**：将当前笔记**所有 type** 下 `user_status: "pending"` 的标签标记为 `"accepted"`
- **全部删除**：将当前笔记**所有 type** 下 `user_status: "pending"` 的标签标记为 `"deleted"`
- **不翻转已有决策**：已经是 `accepted` 或 `deleted` 的标签不受影响
- **不影响 ⚪ 标签**：⚪ 验证中标签的操作按钮禁用，`user_status` 始终为 `pending`，不被全部接受/删除改变

### 11.3 "应用"按钮与 ⚪ 验证中标签

⚪ 标签因操作按钮禁用，`user_status` 始终为 `pending`。点击"应用"时，`applyAll` 只处理 `accepted`/`deleted` 的标签，⚪ 标签自然保留在 staging 中。验证完成后 badge 更新（⚪→🔵/🟡），按钮启用，用户下次打开笔记时审核。

### 11.4 Accept/Delete 三态切换

✓ 和 ✗ 按钮为**三态切换**，用户可在 `pending` ↔ `accepted` ↔ `deleted` 之间自由切换：

| 当前状态 | 点击 ✓ (Accept) | 点击 ✗ (Delete) |
|----------|-----------------|-----------------|
| `pending` | → `accepted` | → `deleted` |
| `accepted` | → `pending`（撤回） | → `deleted` |
| `deleted` | → `accepted` | → `pending`（撤回） |

### 11.5 content_hash 变更检测

打开审核视图时：
1. 从 staging 读取 `content_hash`
2. 调用 `ContentHasher.hash(file)` 计算当前哈希
3. 不匹配 → 顶部显示横幅：`"⚠️ 此笔记在分析后已被修改，标签建议可能不准确。[重新分析]"`
4. 点击 `[重新分析]` → 调用 `AnalysisOrchestrator.analyzeNote(file)`

### 11.6 🔴 不可用时的行为

- AI 打标功能**完全不可用**
- "分析"按钮禁用并显示提示：`"AI 服务不可用，请检查网络连接和 API 配置"`
- 同时引导用户悬停红灯查看具体原因
- 降级为**手动模式**：用户仍可手动添加/删除标签并 Apply

### 11.7 侧边栏线框图

```
┌─────────────────────────────────────────┐
│  [📋 标签审核] [⚙️ 标签模式]            │
│  ───────────────────────────────────    │
│  🟢 在线 (hover: 详情)       [分析]      │
│  Type: [academic ▼] [+ 增加 type]      │
│                                         │
│  domain:                    ← taxonomy  │
│  [NLP 🟢 ✓✗] [attention ⚪ ···]         │
│  [+ 添加]                               │
│                                         │
│  method:                    ← taxonomy  │
│  [transformer 🟢 ✓✗] [+ 添加]           │
│                                         │
│  genre: [paper ▼]  ✓✗       ← enum     │
│  lang:  [en ▼]     ✓✗       ← enum     │
│  scholar: [[[Vaswani-A]] ▼] ✓✗          │
│           [+ 添加]          ← wikilink  │
│  venue: [NeurIPS-2017 ___] ✓✗           │
│                              ← free-text│
│                                         │
│  [✅ 全部接受] [❌ 全部删除] [应用]      │
└─────────────────────────────────────────┘
```

> ⚪ 验证中的标签显示灰色圆点 + 加载动画，操作按钮禁用，验证完成后自动更新为 🔵/🟡 并启用按钮。

> 🟢 库内标签只有 ✓ ✗ 两个操作。🔵🟡 新标签额外有 ✎ ↻。⚪ 验证中标签所有按钮禁用。

> 非 taxonomy 标签（enum/wikilink/free-text/date）无圆点，只有 ✓ ✗，编辑通过组件本身完成。

---

## 12. 测试策略

### 12.1 Tab 切换

- A/B Tab 切换正确，内容不丢失
- 切换回 Tab A 时恢复之前的标签审核状态

### 12.2 无标签笔记

- 手动模式正确渲染空态，可手动添加标签
- 显示 type 选择下拉供用户选择

### 12.3 已有标签笔记

- 正确读取并显示 YAML 中的 type/facet/tags
- 各 value_type 的组件正确渲染

### 12.4 AI 分析后

- staging 数据正确渲染
- badge 颜色对应：⚪灰色、🟢绿色、🔵蓝色、🟡黄色
- ⚪ 验证中标签：按钮禁用，验证完成后自动启用

### 12.5 操作测试

- 点击 ✓/✗/✎/↻ 仅更新 staging，不触碰 registry
- Accept/Delete 三态切换正确（pending↔accepted↔deleted）
- Edit：新词替换旧词，replaces 链正确
- Regenerate：候选列表展开/追加/选择/收起

### 12.6 切换笔记

- 视图自动刷新到新笔记的标签状态
- 前一笔记的 staging 数据保留（持久化）

### 12.7 离线行为

- "分析"按钮禁用并显示提示
- 手动模式可用
- 手动添加标签后 badge 正确（库内 🟢，新词 🟡）

### 12.8 手动模式 staging 路径

- staging 有数据 → 直接展示 staging
- staging 无数据 → 从 YAML 读取展示

### 12.9 手动模式添加标签

- 添加第一个标签时该 type 的现有 YAML 标签自动加载到 staging（accepted, ai_recommended: true）
- 新标签追加到 staging
- 库内标签为 🟢
- rejected 自动替换为目标标签
- 新词为 🟡 + 入验证队列

### 12.10 手动模式 Apply

- 与 AI 模式共享 applyAll 全量替换逻辑
- staging 持有完整集合，不丢失原有标签

### 12.11 手动模式数据完整性

- YAML 有 `domain: [NLP, ML, DL]`
- 手动添加 `attention-mechanism`
- staging 包含 4 个标签
- Apply 后 YAML 为 `domain: [NLP, ML, DL, attention-mechanism]`

### 12.12 staging 恢复

- 关闭侧边栏 → 重新打开 → staging 中 `pending` 状态的标签恢复显示

### 12.13 批量打标后打开笔记

- staging 数据自动展示（无需再点"分析"）

### 12.14 批量队列中的笔记

- 显示等待态
- batch 处理完后自动刷新为审核视图（`noteCompleted` 事件）

### 12.15 checkCallback

- 使用 `getActiveFile()` 而非焦点检测

### 12.16 Schema Editor

- type 增删改：新增直接生效，删除/重命名弹窗确认
- facet 增删改：新增直接生效，从 type 移除弹窗确认
- enum 值增删：新增直接生效，删除弹窗确认

### 12.17 Schema Editor 互斥锁定

- batch/merge/sync 运行时编辑控件禁用
- 完成后恢复
- 显示正确的操作名称

### 12.18 Schema 同步

- 修改/删除时弹窗正确显示受影响笔记
- "同步更新"按 Staging → Registry → YAML 顺序执行
- YAML 阶段（stub）捕获异常并 Notice 提示
- "仅修改模式"只改 schema

### 12.19 Schema 同步崩溃恢复（集成测试，依赖 Group 6）

- 同步 150/300 YAML 文件后模拟中断
- 重启后 Staging+Registry 更新无条件重新执行（幂等）
- YAML 从 `pending_files` 续传

### 12.20 非 taxonomy UI

- enum 显示下拉选择器
- wikilink 显示自动补全输入框
- free-text 显示文本输入框
- date 显示日期选择器
- 以上均无 badge 圆点，仅 ✓ ✗ 按钮

### 12.21 content_hash 检测

- 笔记内容变更后打开审核，显示"笔记已修改"横幅提示
- 点击"重新分析"触发 analyzeNote

---

## 13. 验收标准

### 基础功能

- [ ] `npm run build` 零报错
- [ ] Ribbon 图标点击打开侧边栏
- [ ] Tab A 显示当前笔记标签
- [ ] Tab B 显示 Schema Editor

### 网络状态

- [ ] 网络状态指示器正确（🟢/🔴）
- [ ] 🔴 时悬停 tooltip 显示具体原因（来自 `getStatusTooltip()`）
- [ ] 单击 🟢/🔴 可手动刷新

### 完整单篇流程

- [ ] 分析 → ⚪ 验证中 → badge 逐个刷新为 🔵/🟡 → 逐标签操作 → 应用
- [ ] YAML 更新正确 + registry 统一写入正确
- [ ] Accept/Delete 三态切换可撤回

### 手动模式

- [ ] 手动键入标签 → 库内为 🟢，新词为 🟡 + 入验证队列
- [ ] 手动模式添加标签时正确初始化 staging（从 YAML 加载已有标签）
- [ ] Apply 后不丢失原有标签

### Type 操作

- [ ] 修改/增加/删除 type 功能正常
- [ ] 不产生跨 type 数据泄漏

### 持久化

- [ ] 关闭重开侧边栏后 staging 状态恢复
- [ ] Regenerate 候选列表关闭后丢失（预期行为）

### Schema Editor

- [ ] type/facet 的增删改查全功能正常
- [ ] Schema 修改同步：Staging + Registry 正确联动更新
- [ ] YAML 同步（stub 阶段）捕获异常并提示
- [ ] 互斥操作期间编辑控件禁用

### 批量处理集成

- [ ] 批量处理后打开笔记自动展示 staging
- [ ] 批量队列中的笔记显示等待态
- [ ] batch 完成后自动刷新为审核视图

### CSS

- [ ] 所有 CSS 类名使用 `.toot-` 前缀
- [ ] 无与 Obsidian 默认样式冲突

### 边界情况

- [ ] 空笔记（无 frontmatter）正确处理
- [ ] 多 type 笔记正确渲染（每个 type 独立区块）
- [ ] content_hash 不匹配时横幅正确显示
- [ ] ⚪ 标签 Apply 后保留在 staging 中（不丢失）
