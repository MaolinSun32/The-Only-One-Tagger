# Sub-Plan: Group 2 — 标签逻辑引擎（M3）

> **本文件是独立开发指南。** 开发者仅需阅读本文件即可完成 Group 2 全部开发工作。不需要阅读 dev-plan.md 或其他 sub-plan。

---

## 1. 开发目标

实现 **6 个纯计算模块**，位于 `src/engine/` 目录下，构成整个插件的"纯计算层"。这些模块：

- 负责 schema 解析、候选标签过滤、标签规范化、标签匹配、YAML frontmatter 结构化读写、笔记内容哈希
- **零网络 I/O**——所有计算均为本地纯函数或 Obsidian API 调用
- **零文件 I/O**（除 `FrontmatterService` 通过 Obsidian 的 `processFrontMatter` API 进行 YAML 读写外）
- 被 4 个下游模块组（M4 网络/AI/验证、M5 标签生命周期、M6 侧边栏 UI、M8 标签库管理）直接依赖
- 必须 **100% 单元测试覆盖**

---

## 2. 开发范围

你需要创建以下 6 个文件：

```
src/engine/
├── schema-resolver.ts          # type->facet 决策树查询
├── prompt-filter-builder.ts    # 候选标签过滤（全量，不截断）
├── tag-normalizer.ts           # lowercase-hyphenated 规范化
├── tag-matcher.ts              # registry 标签匹配（2 步流程）
├── frontmatter-service.ts      # YAML 全量替换读写
└── content-hasher.ts           # 笔记 body SHA-256 前 8 位
```

---

## 3. 绝对约束

| 编号 | 约束 | 原因 |
|------|------|------|
| C1 | **禁止任何网络 I/O** | 本组为纯计算层，网络操作属于 M4 |
| C2 | **禁止直接文件 I/O**（`adapter.read/write`） | 文件操作属于 M2。唯一例外是 `FrontmatterService` 使用 Obsidian 的 `processFrontMatter` API |
| C3 | **禁止修改 `src/types.ts`** | 由 Group 1（M1）所有，本组只消费 |
| C4 | **禁止修改 `src/constants.ts`** | 由 Group 1（M1）所有，本组只消费 |
| C5 | **禁止引入运行时依赖** | 整个插件仅依赖 `obsidian`，不使用任何 npm 包 |
| C6 | **FrontmatterService 必须使用 `processFrontMatter`** | 官方 API，避免直接字符串操作 YAML 导致格式破坏 |
| C7 | **PromptFilterBuilder 全量返回，不截断** | registry 规模在百级别，全量传入 AI prompt 不成问题 |
| C8 | **PromptFilterBuilder 不返回黑名单** | 黑名单由 M4 的 AIResponseValidator 在 AI 输出后硬编码处理 |
| C9 | **所有 CSS 使用 `.toot-` 前缀** | 避免与其他插件样式冲突 |
| C10 | **全部代码 100% 单元测试覆盖** | 纯计算函数天然适合测试 |

---

## 4. 上游接口（你消费的接口）

你的代码依赖 Group 1 提供的类型定义和 Group 1（M2）提供的数据存储接口。以下是你**直接调用**的上游接口的完整 TypeScript 签名。

### 4.1 类型定义（`src/types.ts`，Group 1 提供）

```typescript
// ============================================================
// 标签注册表相关
// ============================================================

/** 验证来源 */
type VerifiedBy = 'seed' | 'wikipedia' | 'ai_search' | 'manual';

/** 标签来源信息 */
interface TagSource {
  verified_by: VerifiedBy;
  url?: string;
  verified_at: string; // ISO datetime
}

/** 标签关系（SKOS 风格） */
interface TagRelations {
  broader: string[];
  narrower: string[];
  related: string[];
}

/** 单个标签条目（tag-registry.json 中的一条记录） */
interface TagEntry {
  label: string;
  aliases: string[];
  facets: string[];             // 一个标签可属于多个 facet
  status: 'verified' | 'rejected';
  flagged?: boolean;            // 待复核标记
  rejected_in_favor_of?: string; // 仅 rejected 标签有此字段
  relations: TagRelations;
  source: TagSource;
}

// ============================================================
// Schema 相关
// ============================================================

/** facet 值类型 */
type FacetValueType = 'taxonomy' | 'enum' | 'wikilink' | 'free-text' | 'date';

/** 单个 facet 定义 */
interface FacetDefinition {
  description: string;
  value_type: FacetValueType;
  allow_multiple: boolean;
  verification_required: boolean;
  values?: string[];                         // 仅 enum 有
  blacklist?: Record<string, string>;        // 仅 enum 有（错误值 -> 正确值）
}

/** 单个 note type 定义 */
interface NoteTypeSchema {
  label: string;
  description: string;
  required_facets: string[];
  optional_facets: string[];
}

/** tag-schema.json 顶层结构 */
interface TagSchema {
  version: number;
  note_types: Record<string, NoteTypeSchema>;
  facet_definitions: Record<string, FacetDefinition>;
}

// ============================================================
// Staging 相关
// ============================================================

/** staging 中单个标签条目 */
interface StagingTagItem {
  label: string;
  badge: 'verifying' | 'registry' | 'wiki_verified' | 'search_verified'
       | 'needs_review' | 'enum' | 'wikilink' | 'free_text' | 'date';
  user_status: 'pending' | 'accepted' | 'deleted';
  ai_recommended?: boolean;    // true=AI推荐, false=YAML已有但AI未推荐
  replaces?: string[];         // Edit/Regenerate 产生的替换链
}

/** staging 中单个笔记 */
interface StagingNote {
  analyzed_at: string;
  content_hash: string;        // body-only SHA-256 前 8 位
  types: Record<string, Record<string, StagingTagItem[]>>;
  // types[typeName][facetName] = StagingTagItem[]
}

/** tag-staging.json 顶层结构 */
interface Staging {
  notes: Record<string, StagingNote>; // key = 笔记路径
}

// ============================================================
// FrontmatterService 专用
// ============================================================

/** FrontmatterService.write() 的入参 */
interface TagWriteData {
  types: string[];
  // 本次写入涉及的 type 列表
  typeData: Record<string, Record<string, any>>;
  // typeData[typeName][facetName] = 该 facet 的完整值集合
  // allow_multiple: true  -> string[]
  // allow_multiple: false -> string
}

/** FrontmatterService.read() 的返回值 */
interface TaggedNote {
  types: string[];                                  // 当前 YAML 中的 type 数组
  typeData: Record<string, Record<string, any>>;    // typeData[typeName][facetName]
  tagVersion: number;                               // _tag_version
  taggedAt: string | null;                          // _tagged_at
}
```

### 4.2 常量（`src/constants.ts`，Group 1 提供）

```typescript
/** 插件生成的 YAML 字段名列表 — 供 PromptAssembler 使用，你不直接需要 */
const PLUGIN_YAML_FIELDS: string[] = [
  'type',
  'academic', 'project', 'course', 'journal', 'growth', 'relationship',
  'meeting', 'finance', 'health', 'career', 'creative', 'admin',
  '_tag_version', '_tagged_at',
];

/** 数据文件路径常量 */
const TAG_SCHEMA_FILE = 'tag-schema.json';
const TAG_REGISTRY_FILE = 'tag-registry.json';
const TAG_STAGING_FILE = 'tag-staging.json';
```

### 4.3 SchemaStore（`src/storage/schema-store.ts`，Group 1 M2 提供）

```typescript
class SchemaStore extends DataStore<TagSchema> {
  /** 加载 tag-schema.json，文件不存在则用默认值创建 */
  load(): Promise<TagSchema>;

  /** 保存完整 schema */
  save(data: TagSchema): Promise<void>;
}
```

你的 `SchemaResolver` 接收一个 `TagSchema` 对象（通过 `SchemaStore.load()` 获取后传入），**不直接持有 SchemaStore 引用**。

### 4.4 RegistryStore（`src/storage/registry-store.ts`，Group 1 M2 提供）

你的模块中只有 `PromptFilterBuilder` 和 `TagMatcher` 需要调用 RegistryStore。以下是你需要用到的方法签名：

```typescript
class RegistryStore extends DataStore<Registry> {
  /**
   * 按 label 精确查找标签（verified + rejected 都查）。
   * 返回完整 TagEntry，未命中返回 null。
   */
  getTag(label: string): TagEntry | null;

  /**
   * 遍历所有标签（verified + rejected），检查各标签的 aliases 数组
   * 是否包含该字符串。返回首个命中的完整 TagEntry，未命中返回 null。
   * 纯数据查询，不含规范化逻辑。
   */
  findByAlias(alias: string): TagEntry | null;

  /**
   * 返回 facets 数组与给定 facets 有交集的所有 verified 标签。
   * 仅返回 status: "verified"（含 flagged: true），不含 rejected。
   */
  getTagsByFacets(facets: string[]): TagEntry[];

  /**
   * 返回指定 facets 下的黑名单映射。
   * Record<rejectedLabel, rejected_in_favor_of>
   * 你的模块不直接使用此方法（由 M4 AIResponseValidator 使用），
   * 但 PromptFilterBuilder 需要知道它存在以理解过滤逻辑。
   */
  getBlacklistMap(facets: string[]): Record<string, string>;
}
```

**关键理解：RegistryStore 的职责边界**

RegistryStore（M2）只做数据存取——按 label 查、按 alias 查、按 facets 过滤。**匹配策略和规范化逻辑**由你的 `TagMatcher`（M3）编排。RegistryStore 不含任何规范化或匹配策略代码。

---

## 5. 你必须导出的接口（下游依赖）

以下接口被 4 个下游模块组直接消费。**签名一旦确定不可随意变更**。

### 5.1 SchemaResolver

**文件**：`src/engine/schema-resolver.ts`

**消费者**：M4（PromptAssembler、AIResponseValidator）、M5（AnalysisOrchestrator）、M6（SchemaEditor）

```typescript
/** resolve() 的返回类型 */
interface ResolvedSchema {
  typeName: string;
  label: string;
  description: string;
  requiredFacets: ResolvedFacet[];
  optionalFacets: ResolvedFacet[];
}

/** 单个 facet 的完整解析结果 */
interface ResolvedFacet {
  name: string;              // facet 键名，如 "domain"
  description: string;
  value_type: FacetValueType;
  allow_multiple: boolean;
  verification_required: boolean;
  values?: string[];                    // enum 时的可选值列表
  blacklist?: Record<string, string>;   // enum 时的静态黑名单
}

/** getAllTypes() 返回的 type 摘要 */
interface TypeSummary {
  name: string;        // 如 "academic"
  label: string;       // 如 "学术研究"
  description: string; // 如 "学术论文精读、文献综述..."
}

class SchemaResolver {
  /**
   * 构造时接收完整的 TagSchema 对象。
   * 调用方通过 SchemaStore.load() 获取后传入。
   */
  constructor(schema: TagSchema);

  /**
   * 给定 type 名称，返回该 type 的全部 facet 定义（required + optional）。
   * type 不存在时抛出 Error。
   */
  resolve(type: string): ResolvedSchema;

  /**
   * 返回 12 种 type 的名称 + label + 简短描述。
   * 供 AI 步骤 1（识别 type）的 prompt 使用。
   */
  getAllTypes(): TypeSummary[];

  /**
   * 返回该 type 下所有 value_type === "taxonomy" 的 facet 名称。
   * 供 PromptFilterBuilder 调用。
   */
  getTaxonomyFacets(type: string): string[];
}
```

### 5.2 PromptFilterBuilder

**文件**：`src/engine/prompt-filter-builder.ts`

**消费者**：M4（PromptAssembler）、M5（AnalysisOrchestrator）

```typescript
/** build() 的返回类型 */
interface FilteredCandidates {
  /**
   * 按 facet 分组的候选标签。
   * key = facet 名称（如 "domain"、"method"）
   * value = 该 facet 下的所有 verified 标签（TagEntry[]）
   *
   * 全量返回，不截断。仅含 verified 标签，不含 rejected。
   */
  candidatesByFacet: Map<string, TagEntry[]>;
}

class PromptFilterBuilder {
  constructor(
    schemaResolver: SchemaResolver,
    registryStore: RegistryStore
  );

  /**
   * 给定一个 type 名称：
   * 1. 从 SchemaResolver 取该 type 的所有 taxonomy 类 facet 名称
   * 2. 从 RegistryStore.getTagsByFacets() 获取所有 verified 标签
   * 3. 对每个标签的 facets[] 与步骤 1 的 facet 集合取交集
   * 4. 交集非空的标签，按 facet 分组（一个标签可能出现在多个 facet 下）
   * 5. 全量返回，不截断，不含黑名单
   *
   * @param type - note type 名称，如 "academic"
   * @returns 按 facet 分组的候选标签集合
   */
  build(type: string): FilteredCandidates;
}
```

### 5.3 TagNormalizer

**文件**：`src/engine/tag-normalizer.ts`

**消费者**：M4（AIResponseValidator）、M5（TagOperationExecutor）、M6（手动模式标签输入）

```typescript
class TagNormalizer {
  /**
   * 将任意格式字符串转为 lowercase-hyphenated 标准形式。
   *
   * 规则（按顺序应用）：
   * 1. 去除首尾空白（trim）
   * 2. CamelCase 拆分：在大写字母前插入分隔符
   *    - "DeepLearning" -> "deep-learning"
   *    - "GPT" -> "gpt"（连续大写不拆分）
   *    - "TensorFlow" -> "tensor-flow"
   *    - "NLPModel" -> "nlp-model"（连续大写 + 小写 -> 最后一个大写前拆分）
   * 3. 空格 -> 连字符
   * 4. 下划线 -> 连字符
   * 5. 全部小写化（仅对非中文字符）
   * 6. 中文字符保持不变
   * 7. 去除重复连字符（"--" -> "-"）
   * 8. 去除首尾连字符
   *
   * @param input - 任意格式字符串
   * @returns 规范化后的 lowercase-hyphenated 字符串
   */
  static normalize(input: string): string;
}
```

### 5.4 TagMatcher

**文件**：`src/engine/tag-matcher.ts`

**消费者**：M4（AIResponseValidator）、M5（TagOperationExecutor、手动模式）、M6（手动模式标签输入）

```typescript
/** match() 的返回类型 */
interface MatchResult {
  /** 是否命中 */
  matched: boolean;

  /** 匹配类型：精确 label 匹配 / alias 匹配 / 未命中 */
  matchType: 'exact' | 'alias' | 'none';

  /**
   * 命中时返回完整 TagEntry（含 status，调用方可区分 verified/rejected）。
   * 未命中时为 null。
   */
  entry: TagEntry | null;
}

class TagMatcher {
  constructor(registryStore: RegistryStore);

  /**
   * 2 步匹配流程：
   *
   * 步骤 1：将输入经 TagNormalizer.normalize() 规范化
   * 步骤 2：调用 RegistryStore.getTag(normalized)
   *   - 命中 -> 返回 { matched: true, matchType: 'exact', entry }
   * 步骤 3：调用 RegistryStore.findByAlias(normalized)
   *   - 命中 -> 返回 { matched: true, matchType: 'alias', entry }
   * 步骤 4：未命中
   *   - 返回 { matched: false, matchType: 'none', entry: null }
   *
   * 重要：RegistryStore 只做数据存取，匹配策略由本方法编排。
   * 返回的 entry 包含 status 字段，调用方据此区分 verified / rejected。
   *
   * @param input - 原始输入字符串（未规范化）
   * @returns 匹配结果
   */
  match(input: string): MatchResult;
}
```

### 5.5 FrontmatterService

**文件**：`src/engine/frontmatter-service.ts`

**消费者**：M5（AnalysisOrchestrator、TagOperationExecutor、TypeOperationExecutor）、M6（手动模式读取 YAML）、M8（TagMerger/BulkYamlModifier）

```typescript
import { App, TFile } from 'obsidian';

class FrontmatterService {
  constructor(app: App, schemaResolver: SchemaResolver);

  /**
   * 读取当前 YAML 中的 type/facet/tag 结构。
   *
   * 返回的 typeData 保持 YAML 中的原始值格式：
   * - allow_multiple: true  的 facet -> string[]
   * - allow_multiple: false 的 facet -> string
   *
   * 无 type 或无 frontmatter 时返回空结构。
   */
  read(file: TFile): Promise<TaggedNote>;

  /**
   * 全量替换写入。内部流程：
   *
   * 1. 通过 processFrontMatter 读取现有 YAML
   * 2. 将 data.types 追加到现有 type 数组（去重）
   * 3. 对 data.typeData 中的每个 type 块：
   *    - 以 typeData[type] 提供的各 facet 值 **直接覆盖** 对应 YAML type 块
   *    - typeData 提供的是该 type 各 facet 的完整值集合
   *      （包含 accepted 标签 + pending 且原有标签，不含 deleted 标签）
   *    - deleted 标签不被收集 = 不写入 = 从 YAML 移除
   * 4. 不在 data.typeData 中的现有 type 块原样保留
   * 5. _tag_version 递增（整数，全笔记级别）
   * 6. _tagged_at 更新为当前 ISO 日期（YYYY-MM-DD）
   *
   * 写入时处理 allow_multiple 语义：
   * - allow_multiple: true  的 facet -> 值为 string[]（YAML 数组）
   * - allow_multiple: false 的 facet -> 值为 string（YAML 标量）
   *
   * 通过 app.fileManager.processFrontMatter() 进行写入，
   * **绝不直接操作字符串**。
   */
  write(file: TFile, data: TagWriteData): Promise<void>;

  /**
   * 删除某 type 及其全部 facet 数据。
   *
   * 1. 通过 processFrontMatter 读取 YAML
   * 2. 从 type 数组中移除该 type
   * 3. 删除该 type 对应的键（如 delete frontmatter['academic']）
   * 4. 不修改 _tag_version 和 _tagged_at
   */
  removeTypeBlock(file: TFile, type: string): Promise<void>;
}
```

### 5.6 ContentHasher

**文件**：`src/engine/content-hasher.ts`

**消费者**：M5（AnalysisOrchestrator）、M7（BatchProcessor）

```typescript
import { App, TFile } from 'obsidian';

class ContentHasher {
  constructor(app: App);

  /**
   * 计算笔记正文的 SHA-256 前 8 位十六进制字符串。
   *
   * **只计算 frontmatter 之后的 body 内容**：
   * - 笔记以 `---\n` 开头时，找到第二个 `---\n`，取其之后的全部内容
   * - 笔记不以 `---\n` 开头时，取全部内容
   * - 对提取的 body 内容计算 SHA-256，返回前 8 位 hex 字符串
   *
   * 设计理由：确保 applyAll 写入标签到 YAML 后不会改变 hash 值，
   * 避免"笔记已修改"横幅误报。
   *
   * @param file - Obsidian TFile 对象
   * @returns 8 字符的十六进制哈希字符串，如 "a3f2b8c1"
   */
  hash(file: TFile): Promise<string>;
}
```

---

## 6. 需要的类型定义

以下是你需要从 `src/types.ts` 导入的类型子集。**不要自己定义这些类型**，从 `../types` 导入即可。

```typescript
// 你的文件中使用：
import type {
  TagSchema,
  NoteTypeSchema,
  FacetDefinition,
  FacetValueType,
  TagEntry,
  TagRelations,
  TagSource,
  VerifiedBy,
  StagingTagItem,
  StagingNote,
  TagWriteData,
  TaggedNote,
} from '../types';
```

你自己需要**定义并导出**的类型（写在各自的 `.ts` 文件中或单独的 `src/engine/types.ts` 中）：

```typescript
// SchemaResolver 的返回类型
export interface ResolvedSchema { ... }   // 见 §5.1
export interface ResolvedFacet { ... }    // 见 §5.1
export interface TypeSummary { ... }      // 见 §5.1

// PromptFilterBuilder 的返回类型
export interface FilteredCandidates { ... } // 见 §5.2

// TagMatcher 的返回类型
export interface MatchResult { ... }      // 见 §5.4
```

---

## 7. 数据格式

你的代码需要理解三种核心数据格式，以便正确解析和生成。

### 7.1 tag-schema.json（决策树 Schema）

`SchemaResolver` 的数据源。完整结构如下：

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
    "domain":                { "description": "所属知识/研究领域",        "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "method":                { "description": "方法论/技术方法",          "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "algorithm":             { "description": "具体算法",                "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "concept":               { "description": "核心概念/术语",           "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "dataset":               { "description": "数据集",                  "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "problem":               { "description": "研究问题/任务",           "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "tech-stack":            { "description": "技术栈",                  "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "software":              { "description": "软件工具",                "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "skill":                 { "description": "技能",                    "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "condition":             { "description": "健康状况/疾病",           "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "reflection-topic":      { "description": "反思主题",                "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },
    "theme":                 { "description": "创作主题",                "value_type": "taxonomy",   "allow_multiple": true,  "verification_required": true },

    "genre":                 { "description": "内容体裁",   "value_type": "enum", "values": ["paper","textbook","tutorial","lecture-note","blog","documentation","thesis"], "blacklist": {"article":"paper","book":"textbook","guide":"tutorial","doc":"documentation"}, "allow_multiple": false, "verification_required": false },
    "lang":                  { "description": "语言",       "value_type": "enum", "values": ["en","zh","ja","de","fr","ko"], "blacklist": {"english":"en","chinese":"zh","japanese":"ja","german":"de","french":"fr","korean":"ko"}, "allow_multiple": false, "verification_required": false },
    "mood":                  { "description": "情绪状态",   "value_type": "enum", "values": ["great","good","neutral","low","bad"], "allow_multiple": false, "verification_required": false },
    "status":                { "description": "进度状态",   "value_type": "enum", "values": ["not-started","in-progress","completed","paused","abandoned"], "allow_multiple": false, "verification_required": false },
    "programming-language":  { "description": "编程语言",   "value_type": "enum", "values": ["python","javascript","typescript","java","c","cpp","rust","go","r","julia","matlab","scala","kotlin","swift","shell"], "allow_multiple": true, "verification_required": false },
    "event-type":            { "description": "事件类型",   "value_type": "enum", "values": ["social","academic","family","travel","work","personal"], "allow_multiple": false, "verification_required": false },
    "meeting-type":          { "description": "会议类型",   "value_type": "enum", "values": ["one-on-one","group","seminar","conference","workshop","casual"], "allow_multiple": false, "verification_required": false },
    "relation-type":         { "description": "人际关系类型","value_type": "enum", "values": ["friend","colleague","mentor","mentee","family","acquaintance"], "allow_multiple": false, "verification_required": false },
    "interaction-type":      { "description": "互动方式",   "value_type": "enum", "values": ["meeting","email","call","chat","collaboration"], "allow_multiple": false, "verification_required": false },
    "finance-type":          { "description": "财务类型",   "value_type": "enum", "values": ["income","expense","investment","debt","saving"], "allow_multiple": false, "verification_required": false },
    "amount-range":          { "description": "金额区间",   "value_type": "enum", "values": ["<100","100-500","500-2000","2000-10000",">10000"], "allow_multiple": false, "verification_required": false },
    "category":              { "description": "消费/财务分类","value_type": "enum", "values": ["food","transport","housing","entertainment","education","health","clothing","electronics","subscription","other"], "allow_multiple": false, "verification_required": false },
    "recurring":             { "description": "是否周期性", "value_type": "enum", "values": ["daily","weekly","monthly","yearly","one-time"], "allow_multiple": false, "verification_required": false },
    "health-area":           { "description": "健康领域",   "value_type": "enum", "values": ["physical","mental","sleep","nutrition","exercise","medical"], "allow_multiple": false, "verification_required": false },
    "growth-area":           { "description": "成长领域",   "value_type": "enum", "values": ["emotional","intellectual","spiritual","social","professional","physical"], "allow_multiple": true, "verification_required": false },
    "career-aspect":         { "description": "职业发展方面","value_type": "enum", "values": ["job-search","skill-development","networking","promotion","transition","side-project"], "allow_multiple": false, "verification_required": false },
    "medium":                { "description": "创作媒介",   "value_type": "enum", "values": ["writing","drawing","music","photography","video","code","design"], "allow_multiple": true, "verification_required": false },
    "insight-type":          { "description": "洞察类型",   "value_type": "enum", "values": ["realization","habit-change","mindset-shift","lesson-learned"], "allow_multiple": false, "verification_required": false },
    "admin-type":            { "description": "行政事务类型","value_type": "enum", "values": ["errand","appointment","maintenance","paperwork","shopping","travel-planning"], "allow_multiple": false, "verification_required": false },
    "priority":              { "description": "优先级",     "value_type": "enum", "values": ["high","medium","low"], "allow_multiple": false, "verification_required": false },
    "platform":              { "description": "学习平台",   "value_type": "enum", "values": ["coursera","edx","youtube","udemy","mit-ocw","stanford-online","bilibili","other"], "allow_multiple": false, "verification_required": false },

    "scholar":               { "description": "学者/研究者",             "value_type": "wikilink",   "allow_multiple": true,  "verification_required": false },
    "people":                { "description": "相关人物",                "value_type": "wikilink",   "allow_multiple": true,  "verification_required": false },
    "person":                { "description": "核心人物（关系笔记主体）",  "value_type": "wikilink",   "allow_multiple": false, "verification_required": false },
    "participants":          { "description": "参与者",                  "value_type": "wikilink",   "allow_multiple": true,  "verification_required": false },
    "collaborator":          { "description": "协作者",                  "value_type": "wikilink",   "allow_multiple": true,  "verification_required": false },
    "instructor":            { "description": "讲师/教授",              "value_type": "wikilink",   "allow_multiple": true,  "verification_required": false },
    "provider":              { "description": "医疗/服务提供者",         "value_type": "wikilink",   "allow_multiple": true,  "verification_required": false },
    "company":               { "description": "公司/组织",              "value_type": "wikilink",   "allow_multiple": true,  "verification_required": false },
    "related-project":       { "description": "所属/关联项目",           "value_type": "wikilink",   "allow_multiple": false, "verification_required": false },

    "venue":                 { "description": "会议/期刊名称（含年份，如 NeurIPS-2017）", "value_type": "free-text", "allow_multiple": false, "verification_required": false },
    "source":                { "description": "来源（URL/书名/课程名）",                   "value_type": "free-text", "allow_multiple": false, "verification_required": false },
    "source-repo":           { "description": "源代码仓库 URL",                            "value_type": "free-text", "allow_multiple": false, "verification_required": false },
    "location":              { "description": "地点",                                      "value_type": "free-text", "allow_multiple": false, "verification_required": false },
    "trigger":               { "description": "触发因素",                                  "value_type": "free-text", "allow_multiple": false, "verification_required": false },
    "inspiration":           { "description": "灵感来源",                                  "value_type": "free-text", "allow_multiple": true,  "verification_required": false },
    "audience":              { "description": "目标受众",                                  "value_type": "free-text", "allow_multiple": false, "verification_required": false },
    "affiliation":           { "description": "所属机构",                                  "value_type": "free-text", "allow_multiple": true,  "verification_required": false },
    "metric":                { "description": "健康指标",                                  "value_type": "free-text", "allow_multiple": true,  "verification_required": false },
    "role":                  { "description": "职位/角色",                                 "value_type": "free-text", "allow_multiple": false, "verification_required": false },
    "milestone":             { "description": "里程碑",                                    "value_type": "free-text", "allow_multiple": true,  "verification_required": false },

    "deadline":              { "description": "截止日期（ISO 格式，如 2026-04-15）",        "value_type": "date",      "allow_multiple": false, "verification_required": false }
  }
}
```

**value_type 分类总结**：

| value_type | 含义 | 验证 | 入标签库 | 你的模块需关注 |
|------------|------|------|---------|--------------|
| `taxonomy` | 受控词表术语 | 走三级验证管线 | 是 | SchemaResolver、PromptFilterBuilder |
| `enum` | 固定值列表 | AI 从列表选择 | 否 | SchemaResolver（返回 values/blacklist） |
| `wikilink` | 库内笔记链接 `[[Name]]` | 无需验证 | 否 | FrontmatterService（读写） |
| `free-text` | 自由文本 | 无需验证 | 否 | FrontmatterService（读写） |
| `date` | ISO 日期 `YYYY-MM-DD` | 格式校验 | 否 | FrontmatterService（读写） |

### 7.2 tag-registry.json（标签库）

`PromptFilterBuilder` 通过 `RegistryStore.getTagsByFacets()` 读取，`TagMatcher` 通过 `RegistryStore.getTag()` 和 `RegistryStore.findByAlias()` 读取。

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
    "deep-learning": {
      "label": "deep-learning",
      "aliases": ["深度学习", "DL"],
      "facets": ["domain", "method"],
      "status": "verified",
      "relations": {
        "broader": ["machine-learning"],
        "narrower": ["convolutional-neural-network", "recurrent-neural-network"],
        "related": ["neural-network-architecture", "backpropagation"]
      },
      "source": {
        "verified_by": "wikipedia",
        "url": "https://en.wikipedia.org/wiki/Deep_learning",
        "verified_at": "2026-03-11T10:30:00Z"
      }
    },
    "ML": {
      "label": "ML",
      "facets": ["domain"],
      "status": "rejected",
      "rejected_in_favor_of": "machine-learning",
      "source": {
        "verified_by": "manual",
        "verified_at": "2026-03-11T10:30:00Z"
      }
    }
  }
}
```

**关键点**：

- `facets` 是数组——一个标签可属于多个 facet（如 `deep-learning` 属于 `domain` 和 `method`）
- `status: "verified"` 是正式标签，`status: "rejected"` 是黑名单
- `PromptFilterBuilder` 只关心 `verified` 标签
- `TagMatcher` 需要同时查 `verified` 和 `rejected`（命中 rejected 时调用方会自动替换为 `rejected_in_favor_of` 目标）

### 7.3 YAML frontmatter 格式

`FrontmatterService` 读写的目标格式。

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

**格式规则**：

| 字段 | 规则 |
|------|------|
| `type` | 始终为数组格式 `[academic]`，即使只有一个 type |
| type 块 | 键名 = type 名称（如 `academic:`），值为 facet 键值对的对象 |
| facet 值 | `allow_multiple: true` -> YAML 数组 `[a, b, c]`；`allow_multiple: false` -> YAML 标量 `paper` |
| `_tag_version` | 整数，每次 `write()` 递增 1。全笔记级别，不区分 type |
| `_tagged_at` | ISO 日期格式 `YYYY-MM-DD`。全笔记级别 |
| 多 type 同名 facet | 各自独立存在（如 academic 和 project 各有自己的 `programming-language`），接受 YAML 重复 |
| wikilink 值 | 保持 `"[[Name]]"` 格式，YAML 中需要引号包裹 |

**元字段说明**：

| 字段 | 含义 |
|------|------|
| `_tag_version` | 标签版本号。首次写入为 1，每次 `write()` 递增。用于批量处理的 `skip_tagged` 判断 |
| `_tagged_at` | 最后打标日期。每次 `write()` 更新 |

---

## 8. 实现规格（逐文件）

### 8.1 SchemaResolver（`src/engine/schema-resolver.ts`）

**职责**：给定 type 名称，返回完整的 facet 定义集合。是 type->facet "决策树"的运行时查询接口。

**构造函数**：

```typescript
constructor(schema: TagSchema)
```

接收完整的 `TagSchema` 对象并存储为内部字段。调用方负责通过 `SchemaStore.load()` 获取 schema 后传入。

**方法实现细节**：

1. **`resolve(type: string): ResolvedSchema`**
   - 从 `schema.note_types[type]` 获取 `NoteTypeSchema`
   - type 不存在时抛出 `Error(`Unknown note type: ${type}`)`
   - 遍历 `required_facets` 和 `optional_facets`，对每个 facet 名从 `schema.facet_definitions` 获取完整定义
   - facet 名不存在于 `facet_definitions` 时跳过并 `console.warn`（schema 可能被用户手动编辑过）
   - 返回 `ResolvedSchema` 对象，含完整的 `ResolvedFacet[]`

2. **`getAllTypes(): TypeSummary[]`**
   - 遍历 `schema.note_types` 的所有键
   - 返回 `{ name, label, description }` 数组

3. **`getTaxonomyFacets(type: string): string[]`**
   - 调用 `resolve(type)` 获取所有 facet
   - 过滤 `value_type === "taxonomy"` 的 facet
   - 返回 facet 名称数组

### 8.2 PromptFilterBuilder（`src/engine/prompt-filter-builder.ts`）

**职责**：给定 type，构建候选标签子集（全量，按 facet 分组）。

**构造函数**：

```typescript
constructor(schemaResolver: SchemaResolver, registryStore: RegistryStore)
```

**`build(type: string): FilteredCandidates`** 实现步骤：

1. 调用 `schemaResolver.getTaxonomyFacets(type)` 获取该 type 的所有 taxonomy facet 名称列表。例如 `academic` -> `["domain", "method", "algorithm", "concept", "dataset", "problem", "software", "tech-stack", ...]`

2. 调用 `registryStore.getTagsByFacets(taxonomyFacets)` 获取所有 verified 标签（这些标签的 `facets[]` 与 `taxonomyFacets` 有交集）

3. 构建 `Map<string, TagEntry[]>`：
   - 对每个返回的 `TagEntry`，遍历其 `facets[]`
   - 对 `facets[]` 中每个 facet，如果该 facet 存在于步骤 1 的 `taxonomyFacets` 中，则将此标签加入该 facet 的列表
   - 一个标签可能出现在多个 facet 下（如 `deep-learning` 的 `facets: ["domain", "method"]`，在 academic type 下会同时出现在 `domain` 和 `method` 的候选列表中）

4. 返回 `{ candidatesByFacet: map }`

**关键约束**：
- **全量返回，不截断**——registry 规模在百级别，全量传入 AI prompt 不成问题
- **不返回 rejected 标签**——黑名单由 M4 的 AIResponseValidator 在 AI 输出后处理
- **不传入黑名单到 AI prompt**

### 8.3 TagNormalizer（`src/engine/tag-normalizer.ts`）

**职责**：将任意格式字符串转为 lowercase-hyphenated 标准形式。

**实现为静态方法**：`static normalize(input: string): string`

**规范化规则（按顺序应用）**：

```
步骤 1: trim()
步骤 2: CamelCase 拆分
  - 在「小写字母或数字」后紧跟「大写字母」的位置插入连字符
    例: "DeepLearning" -> "Deep-Learning"
  - 在「连续大写字母」后紧跟「大写+小写」的位置插入连字符
    例: "NLPModel" -> "NLP-Model"
  - 纯大写缩写不拆分: "GPT" -> "GPT"
步骤 3: 空格 -> 连字符
步骤 4: 下划线 -> 连字符
步骤 5: 全部小写化（仅对 Latin 字符，中文字符不变）
步骤 6: 去除重复连字符 "--" -> "-"
步骤 7: 去除首尾连字符
```

**测试用例（作为规格一部分）**：

| 输入 | 输出 | 说明 |
|------|------|------|
| `"Deep Learning"` | `"deep-learning"` | 空格 + 小写 |
| `"deep_learning"` | `"deep-learning"` | 下划线转连字符 |
| `"DeepLearning"` | `"deep-learning"` | CamelCase 拆分 |
| `"TensorFlow"` | `"tensor-flow"` | CamelCase 拆分 |
| `"NLPModel"` | `"nlp-model"` | 连续大写 + 后接小写 |
| `"GPT"` | `"gpt"` | 纯大写不拆分，直接小写 |
| `"BERT"` | `"bert"` | 纯大写不拆分 |
| `"self attention"` | `"self-attention"` | 空格转连字符 |
| `"self-attention"` | `"self-attention"` | 已规范化，不变 |
| `"  deep--learning  "` | `"deep-learning"` | 去空白 + 去重复连字符 |
| `"机器学习"` | `"机器学习"` | 中文不变 |
| `"深度学习"` | `"深度学习"` | 中文不变 |
| `"AI模型"` | `"ai模型"` | 混合：Latin 小写化，中文不变 |
| `""` | `""` | 空字符串 |
| `"---"` | `""` | 全连字符去除 |
| `"CNN"` | `"cnn"` | 纯大写缩写 |
| `"ResNet50"` | `"res-net50"` | CamelCase + 数字 |
| `"PyTorch"` | `"py-torch"` | CamelCase |

### 8.4 TagMatcher（`src/engine/tag-matcher.ts`）

**职责**：在 registry 中查找匹配标签，编排规范化 + 数据查询的 2 步流程。

**构造函数**：

```typescript
constructor(registryStore: RegistryStore)
```

**`match(input: string): MatchResult`** 实现步骤：

```
1. normalized = TagNormalizer.normalize(input)

2. exactHit = registryStore.getTag(normalized)
   如果 exactHit !== null:
     返回 { matched: true, matchType: 'exact', entry: exactHit }

3. aliasHit = registryStore.findByAlias(normalized)
   如果 aliasHit !== null:
     返回 { matched: true, matchType: 'alias', entry: aliasHit }

4. 返回 { matched: false, matchType: 'none', entry: null }
```

**关键设计决策**：

- **RegistryStore 只做数据存取**（getTag 按 label 查、findByAlias 遍历 aliases），**匹配策略由 TagMatcher 编排**
- 返回的 `entry` 包含 `status` 字段（`verified` 或 `rejected`），**调用方据此区分**：
  - `status: "verified"` -> 库内正式标签（🟢）
  - `status: "rejected"` -> 黑名单标签，调用方读取 `entry.rejected_in_favor_of` 进行替换
- TagMatcher **不做替换决策**，只返回匹配结果，替换逻辑由调用方（M4 AIResponseValidator、M5 TagOperationExecutor）执行

**下游使用示例**（帮助你理解调用方如何消费）：

```typescript
// M4 AIResponseValidator 中的使用方式（你不实现这段，仅供理解）
const result = tagMatcher.match(aiReturnedTag);
if (result.matched && result.entry!.status === 'verified') {
  // 🟢 库内标签，label 替换为正式 label
  stagingEntry.label = result.entry!.label;
  stagingEntry.badge = 'registry';
} else if (result.matched && result.entry!.status === 'rejected') {
  // 命中黑名单，替换为 rejected_in_favor_of 目标
  const targetLabel = result.entry!.rejected_in_favor_of!;
  // ... 用 targetLabel 再次查询获取正式标签
} else {
  // 新词，进入验证管线
  stagingEntry.badge = 'verifying';
}
```

### 8.5 FrontmatterService（`src/engine/frontmatter-service.ts`）

**职责**：封装 Obsidian 的 `processFrontMatter` API，提供结构化的 YAML 读写。

**构造函数**：

```typescript
constructor(app: App, schemaResolver: SchemaResolver)
```

需要 `schemaResolver` 来查询 `allow_multiple` 等 facet 属性，以便正确处理数组 vs 标量的写入。

#### 8.5.1 `read(file: TFile): Promise<TaggedNote>`

**实现步骤**：

1. 通过 `app.metadataCache.getFileCache(file)?.frontmatter` 读取 YAML（或通过 `app.vault.read(file)` 解析——推荐使用 metadataCache 因为它是内存级缓存）
2. 提取 `type` 字段（确保为数组）
3. 对每个 type，读取对应的对象块（如 `frontmatter['academic']`）
4. 对每个 facet 键值对，保持原始格式返回
5. 提取 `_tag_version`（默认 0）和 `_tagged_at`（默认 null）
6. 返回 `TaggedNote` 对象

**边界情况**：
- 无 frontmatter -> 返回 `{ types: [], typeData: {}, tagVersion: 0, taggedAt: null }`
- 有 frontmatter 但无 `type` 字段 -> 同上
- `type` 为字符串而非数组 -> 包装为数组

#### 8.5.2 `write(file: TFile, data: TagWriteData): Promise<void>`

**这是最复杂的方法。** 必须通过 `app.fileManager.processFrontMatter()` 进行写入。

**实现步骤**（在 `processFrontMatter` 的回调中执行）：

```typescript
await app.fileManager.processFrontMatter(file, (frontmatter) => {
  // 1. type 数组追加（去重）
  const existingTypes: string[] = Array.isArray(frontmatter.type)
    ? [...frontmatter.type]
    : frontmatter.type ? [frontmatter.type] : [];
  for (const t of data.types) {
    if (!existingTypes.includes(t)) {
      existingTypes.push(t);
    }
  }
  frontmatter.type = existingTypes;

  // 2. 对 data.typeData 中的每个 type 块：直接覆盖
  for (const [typeName, facetMap] of Object.entries(data.typeData)) {
    frontmatter[typeName] = {};
    for (const [facetName, value] of Object.entries(facetMap)) {
      frontmatter[typeName][facetName] = value;
      // value 已经是正确格式：
      //   allow_multiple: true  -> string[]
      //   allow_multiple: false -> string
    }
  }

  // 3. 不在 data.typeData 中的现有 type 块原样保留（不触碰）

  // 4. _tag_version 递增
  const currentVersion = typeof frontmatter._tag_version === 'number'
    ? frontmatter._tag_version : 0;
  frontmatter._tag_version = currentVersion + 1;

  // 5. _tagged_at 更新
  frontmatter._tagged_at = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
});
```

**关键语义：全量替换**
- `data.typeData[typeName]` 提供的是该 type 各 facet 的**完整值集合**
- 直接覆盖对应的 YAML type 块（不是 merge，是 replace）
- 如果 `data.typeData['academic']` 中没有 `domain` 键，那么 academic 块中的 `domain` 会被移除
- 这确保了 `deleted` 标签（不被收集到 typeData 中）自动从 YAML 中移除

#### 8.5.3 `removeTypeBlock(file: TFile, type: string): Promise<void>`

**实现步骤**：

```typescript
await app.fileManager.processFrontMatter(file, (frontmatter) => {
  // 1. 从 type 数组移除
  if (Array.isArray(frontmatter.type)) {
    frontmatter.type = frontmatter.type.filter((t: string) => t !== type);
  }

  // 2. 删除 type 对应的键
  delete frontmatter[type];

  // 3. 不修改 _tag_version 和 _tagged_at
});
```

### 8.6 ContentHasher（`src/engine/content-hasher.ts`）

**职责**：计算笔记正文（不含 frontmatter）的 SHA-256 前 8 位。

**构造函数**：

```typescript
constructor(app: App)
```

**`hash(file: TFile): Promise<string>`** 实现步骤：

1. 通过 `app.vault.read(file)` 获取笔记全文
2. 提取 body 内容：
   - 如果内容以 `---\n` 或 `---\r\n` 开头，找到第二个 `---` 行（`\n---\n` 或 `\n---\r\n` 或文件结尾），取其之后的全部内容
   - 如果不以 `---` 开头，取全部内容
3. 对 body 内容计算 SHA-256：
   - 使用 Web Crypto API：`crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))`
   - Obsidian 桌面端（Electron）支持 Web Crypto API
4. 取 SHA-256 结果的前 8 位十六进制字符并返回

**body 提取的伪代码**：

```typescript
function extractBody(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }
  // 找到第二个 ---
  const secondDashIndex = content.indexOf('\n---', 3);
  if (secondDashIndex === -1) {
    // frontmatter 未关闭，视为全部是 frontmatter，body 为空
    return '';
  }
  // 跳过 \n--- 和紧随的换行
  const afterClosing = content.indexOf('\n', secondDashIndex + 4);
  if (afterClosing === -1) {
    return '';
  }
  return content.substring(afterClosing + 1);
}
```

**设计理由**：只哈希 body，确保 `applyAll` 写入标签到 YAML frontmatter 后不会改变 hash 值，从而避免"笔记已修改"横幅误报。

---

## 9. 测试策略

### 9.1 测试框架

使用与项目一致的测试框架（建议 `vitest` 或 `jest`，取决于 Group 1 的构建配置）。

### 9.2 Mock 指南

#### Mock RegistryStore

`TagMatcher` 和 `PromptFilterBuilder` 需要 mock RegistryStore。最小 mock 如下：

```typescript
function createMockRegistryStore(tags: Record<string, TagEntry>): RegistryStore {
  return {
    getTag(label: string): TagEntry | null {
      return tags[label] ?? null;
    },

    findByAlias(alias: string): TagEntry | null {
      for (const entry of Object.values(tags)) {
        if (entry.aliases?.includes(alias)) {
          return entry;
        }
      }
      return null;
    },

    getTagsByFacets(facets: string[]): TagEntry[] {
      return Object.values(tags).filter(
        t => t.status === 'verified'
          && t.facets.some(f => facets.includes(f))
      );
    },
  } as unknown as RegistryStore;
}
```

#### Mock Obsidian API（FrontmatterService / ContentHasher）

```typescript
// 最小 TFile mock
const mockFile = { path: 'test/note.md', basename: 'note' } as TFile;

// Mock processFrontMatter
const mockApp = {
  fileManager: {
    processFrontMatter: async (file: TFile, fn: (fm: any) => void) => {
      const fm = { /* 预设 frontmatter 内容 */ };
      fn(fm);
      // 验证 fm 的最终状态
    },
  },
  vault: {
    read: async (file: TFile) => '---\ntype: [academic]\n---\nBody content here',
  },
  metadataCache: {
    getFileCache: (file: TFile) => ({
      frontmatter: { type: ['academic'], academic: { domain: ['nlp'] } },
    }),
  },
} as unknown as App;
```

### 9.3 逐模块测试要求

#### SchemaResolver 测试

| 测试用例 | 验证点 |
|---------|--------|
| `resolve("academic")` | 返回 required: domain,genre,lang + optional: method,algorithm,... 的完整 facet 定义 |
| `resolve("journal")` | 返回 required: mood + optional: people,location,event-type,reflection-topic |
| `resolve("nonexistent")` | 抛出 Error |
| `getAllTypes()` | 返回 12 个 TypeSummary，每个含 name/label/description |
| `getTaxonomyFacets("academic")` | 返回 `["domain", "method", "algorithm", "concept", "dataset", "problem", "software"]` |
| `getTaxonomyFacets("journal")` | 返回 `["reflection-topic"]` |
| `getTaxonomyFacets("finance")` | 返回 `[]`（finance 没有 taxonomy 类 facet） |
| 缺失 facet 定义 | 跳过并 console.warn，不崩溃 |

#### PromptFilterBuilder 测试

| 测试用例 | 验证点 |
|---------|--------|
| 空 registry + academic type | 返回空 Map（所有 facet 下均无候选） |
| 单 facet 标签 `transformer(method)` + academic | `method` 分组下包含 transformer |
| 多 facet 标签 `deep-learning(domain,method)` + academic | `domain` 和 `method` 两个分组下都包含 deep-learning |
| rejected 标签 `ML(rejected)` + academic | 输出中不包含 ML |
| `deep-learning(domain,method)` + project type | `domain` 分组下包含（project 有 domain facet）；method 分组不包含（project 无 method facet） |
| 全量无截断 | 200 个标签全部返回，无截断逻辑 |
| finance type（无 taxonomy facet） | 返回空 Map |

#### TagNormalizer 测试

见 §8.3 测试用例表，全部覆盖。

#### TagMatcher 测试

| 测试用例 | 验证点 |
|---------|--------|
| `match("transformer")` | `{ matched: true, matchType: 'exact', entry: transformerEntry }` |
| `match("Transformer")` | normalize 后为 "transformer"，精确匹配 |
| `match("DL")` | normalize 后为 "dl"，getTag miss，findByAlias 命中 deep-learning（aliases 含 "DL"）-> `matchType: 'alias'` |
| `match("deep learning")` | normalize 后为 "deep-learning"，精确匹配 |
| `match("ML")` | normalize 后为 "ml"，精确匹配（rejected 标签也返回），`entry.status === 'rejected'` |
| `match("nonexistent")` | `{ matched: false, matchType: 'none', entry: null }` |
| `match("深度学习")` | normalize 后不变，getTag miss，findByAlias 命中 deep-learning（aliases 含 "深度学习"）|
| `match("")` | 空字符串，未命中 |

#### FrontmatterService 测试

| 测试用例 | 验证点 |
|---------|--------|
| 单 type 写入 + 读取 roundtrip | 写入 academic 数据后读取，数据一致 |
| 多 type 写入 + 读取 roundtrip | 写入 academic+project 数据后读取，两个 type 块均正确 |
| 全量替换语义 | 已有 `domain: [NLP, ML]`，typeData 提供 `domain: [NLP, attention]` -> 结果 `domain: [NLP, attention]`（ML 被移除） |
| type 数组追加去重 | 已有 `type: [academic]`，写入 project -> `type: [academic, project]` |
| 已有 type 不受影响 | 已有 academic+project，仅写入 academic 的更新 -> project 块原样保留 |
| `_tag_version` 递增 | 已有 `_tag_version: 1` -> 写入后变为 2 |
| 首次写入 | 无 `_tag_version` -> 写入后为 1 |
| `_tagged_at` 更新 | 写入后为当前日期 `YYYY-MM-DD` |
| `removeTypeBlock` | 删除 academic 后，project 块和 type 数组均正确更新 |
| `removeTypeBlock` 后 type 数组 | `[academic, project]` -> 删除 academic -> `[project]` |
| 无 frontmatter 的 read | 返回空 TaggedNote |
| `type` 为字符串的 read | `type: academic` -> 返回 `types: ["academic"]` |
| wikilink 格式保留 | `scholar: ["[[Vaswani-A]]"]` 读写后格式不变 |

#### ContentHasher 测试

| 测试用例 | 验证点 |
|---------|--------|
| 有 frontmatter 的笔记 | 仅哈希 body 部分 |
| 修改 frontmatter 不影响 hash | 修改 YAML 字段后重新计算，hash 不变 |
| 修改 body 改变 hash | 修改正文后重新计算，hash 变化 |
| 无 frontmatter 的笔记 | 哈希全部内容 |
| 空 body | `---\ntype: [academic]\n---\n` -> body 为空，返回空字符串的 SHA-256 前 8 位 |
| 返回长度 | 始终为 8 个十六进制字符 |
| 未关闭的 frontmatter | `---\ntype: [academic]` (无关闭的 ---) -> body 为空 |

---

## 10. 验收标准

### 10.1 编译

- `npm run build` 零报错
- `tsc --noEmit` 类型检查通过
- 所有 6 个文件均位于 `src/engine/` 目录下

### 10.2 接口兼容

- `SchemaResolver`、`PromptFilterBuilder`、`TagNormalizer`、`TagMatcher`、`FrontmatterService`、`ContentHasher` 的导出签名严格匹配 §5 中定义的接口
- 导出的类型 `ResolvedSchema`、`ResolvedFacet`、`TypeSummary`、`FilteredCandidates`、`MatchResult` 可被下游模块正确导入

### 10.3 功能验证

- **SchemaResolver**：12 种 type 各返回正确的 facet 集合；`getTaxonomyFacets("academic")` 返回所有 taxonomy 类 facet
- **PromptFilterBuilder**：给定 academic type + 含种子标签的 registry，返回 domain/method/algorithm 等 facet 下的全部候选标签，不含 rejected 标签，无截断
- **TagNormalizer**：§8.3 中所有测试用例通过
- **TagMatcher**：精确匹配、alias 匹配、rejected 匹配、miss 四种情况均正确
- **FrontmatterService**：写入后 Obsidian 的 YAML 渲染与 §7.3 示例格式一致；全量替换语义正确（旧值被覆盖，不是 merge）；跨 type 保留正确
- **ContentHasher**：修改 frontmatter 后 hash 不变；修改 body 后 hash 变化

### 10.4 测试覆盖

- 所有纯计算函数（`TagNormalizer.normalize`、`SchemaResolver.resolve/getAllTypes/getTaxonomyFacets`、`PromptFilterBuilder.build`、`TagMatcher.match`、`ContentHasher` body 提取逻辑）100% 单元测试覆盖
- `FrontmatterService` 通过 mock `processFrontMatter` 测试核心逻辑

### 10.5 约束检查

- 无 `fetch`、`requestUrl`、`XMLHttpRequest` 等网络调用
- 无 `adapter.read`、`adapter.write` 等直接文件操作（`FrontmatterService` 使用 `processFrontMatter` 除外）
- 无对 `src/types.ts` 或 `src/constants.ts` 的修改
- 无 npm 运行时依赖

---

*本文件为 Group 2 开发者的完整独立指南。如有疑问，以本文件为准。*
