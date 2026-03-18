# Sub-Plan: Group 3 — 网络、AI 与验证管线（M4）

> **本文件是自包含的开发规格书。** 开发者只需阅读本文件即可完成 Group 3 的全部开发工作。不需要阅读主开发计划或其他 sub-plan。

---

## 1. 开发目标

实现完整的外部 I/O 层——统一健康检查、AI 两步调用（单一 OpenAI-compatible 实现）、两级标签验证管线（Wikipedia → Search API + AI 判定，库内匹配和黑名单解析在 AIResponseValidator 中完成）。

本模块是插件与外部世界交互的唯一出口，覆盖：

- **网络层**：统一 HTTP 客户端、4 个独立的健康检查器、聚合状态指示器
- **AI 层**：两步 prompt 组装与调用（type 识别 + tag 生成）、AI 响应校验与黑名单解析、同义词生成、wikilink 候选收集、速率限制
- **验证层**：Wikipedia 查询、搜索 API（Brave/Tavily）适配、AI 判定、两级验证管线编排、离线队列管理

**三组外部服务配置**：

| 服务 | 用途 | 配置字段 | 能力要求 |
|------|------|---------|---------|
| Generation AI | 步骤 1 type 识别 + 步骤 2 tag 生成 + Regenerate 同义词 | `generation_api_key`, `generation_base_url`, `generation_model`, `generation_temperature`, `generation_max_tokens` | 需支持多模态输入（图像、文本、音频） |
| Verification AI | 阅读搜索结果，判定标签真实性 | `verification_api_key`, `verification_base_url`, `verification_model`, `verification_temperature` | 普通文本理解即可 |
| Search API | 为验证管线提供网页搜索结果 | `search_type`（`brave` / `tavily`）, `search_api_key`, `search_base_url` | Brave Search API 或 Tavily Search API |

所有主流 AI 服务（DeepSeek、Qwen、Kimi、OpenAI、Gemini 等）均兼容 OpenAI chat completion 格式，因此只需一个 `OpenAICompatibleProvider` 实现类，通过配置区分 Generation 和 Verification 角色。

---

## 2. 开发范围（17 files in network/, ai/, verification/）

```
src/
├── network/                        网络层（3 files）
│   ├── health-checker.ts               通用健康检查抽象（×4 实例）
│   ├── network-status-aggregator.ts    红绿灯 + tooltip 聚合
│   └── http-client.ts                  requestUrl 薄封装
│
├── ai/                             AI 层（7 files）
│   ├── generation-provider.ts          生成接口定义
│   ├── verification-provider.ts        验证接口定义
│   ├── openai-compatible.ts            单一实现类（配置区分角色）
│   ├── prompt-assembler.ts             两步 prompt 组装
│   ├── ai-response-validator.ts        校验 + resolveBlacklist()
│   ├── wikilink-candidate-collector.ts vault wikilink 去重池
│   └── rate-limiter.ts                 Token Bucket（按 baseUrl）
│
└── verification/                   验证层（7 files）
    ├── wikipedia-client.ts             Wikipedia REST API
    ├── search-client.ts                搜索 API 抽象
    ├── brave-search-adapter.ts         Brave Search 适配
    ├── tavily-search-adapter.ts        Tavily Search 适配
    ├── ai-verifier.ts                  Search→AI 两步验证
    ├── verification-pipeline.ts        两级验证编排
    └── verification-queue-manager.ts   离线队列 + 广播更新
```

---

## 3. 绝对约束

以下约束不可违反，违反任意一条即验收不通过：

1. **零运行时依赖**：仅依赖 `obsidian` 模块。所有外部 HTTP 请求通过 Obsidian 的 `requestUrl` 发出（经 `HttpClient` 封装），**绝不使用 `fetch`、`axios` 或任何第三方 HTTP 库**
2. **HealthChecker：API Key 为空 → `not_configured`（不发 ping）**。API Key 为空的服务直接标记为 `not_configured` 状态，不发送任何网络请求
3. **⚪ `verifying` 必须在 `request_timeout_ms` 内终止**：任何验证步骤的请求失败（网络错误、超时、5xx、认证错误）均视为该级未命中，继续到下一级。如果所有级别均失败，标记为 🟡 `needs_review`。未预期异常通过 catch-all 标记 🟡 + `console.error`。**绝不允许标签永久停留在 ⚪ 状态**
4. **AIResponseValidator 步骤 3 使用 `TagMatcher.match()` 做别名匹配**：经过 TagNormalizer 规范化后，调用 TagMatcher.match()，命中 verified 标签时 **label 替换为匹配到的正式 label**（如 `"dl"` → `"deep-learning"`）
5. **RateLimiter：Token Bucket 按 `baseUrl` 维度限速**。指向同一 API 端点的所有请求（generation + verification）共享一个限速器
6. **验证事件必须 per-tag 发射**（不是 batch 发射）。每个标签完成验证后立即 emit 事件，供 UI 逐个刷新 badge
7. **黑名单不传入 AI prompt**。黑名单解析由 AIResponseValidator 在 AI 输出后硬编码处理
8. **VerificationPipeline 只接收不在 registry 中的新词**。库内标签匹配和黑名单解析在 AIResponseValidator 中已完成
9. **所有 CSS 使用 `.toot-` 前缀**（the-only-one-tagger 缩写）

---

## 4. 上游接口

这些接口由 Group 1（M1/M2）和 Group 2（M3）提供，你不需要实现它们，但需要调用。以下是完整的接口契约。

### 4.1 RegistryStore（M2，`src/storage/registry-store.ts`）

```typescript
class RegistryStore extends DataStore<Registry> {
  // 按 label 查找标签，返回完整 TagEntry 或 null
  getTag(label: string): TagEntry | null;

  // 返回 facets 数组与给定 facets 有交集的所有 verified 标签
  // 仅返回 status: "verified"（含 flagged: true 的），不含 rejected
  getTagsByFacets(facets: string[]): TagEntry[];

  // 返回指定 facets 下的黑名单映射：rejectedLabel → rejected_in_favor_of
  // 供 AIResponseValidator 硬编码解析使用
  getBlacklistMap(facets: string[]): Record<string, string>;

  // 遍历所有标签（verified + rejected），检查各标签的 aliases 数组
  // 是否包含该字符串，返回首个命中的完整 TagEntry，未命中返回 null
  // 纯数据查询，不含规范化逻辑
  findByAlias(alias: string): TagEntry | null;

  // 标记标签为 flagged: true（验证失败的已入库标签）
  flagTag(label: string): void;

  // 取消标签的 flagged 标记（验证通过或用户手动确认）
  unflagTag(label: string): void;
}
```

### 4.2 StagingStore（M2，`src/storage/staging-store.ts`）

```typescript
class StagingStore extends DataStore<Staging> {
  // 更新单个标签的 badge（验证完成回调）
  // 内部通过 DataStore.update() 的写入队列保证并发安全
  updateTagBadge(
    notePath: string,
    type: string,
    facet: string,
    label: string,
    newBadge: string
  ): void;

  // 全局标签操作：遍历所有笔记的所有 type/facet
  // 对 label 匹配的条目执行 updater
  // updater 返回新条目则替换，返回 null 则移除
  // 供 VerificationQueueManager 广播更新使用
  findAndUpdateTagGlobally(
    label: string,
    updater: (entry: StagingTagItem) => StagingTagItem | null
  ): void;
}
```

### 4.3 SchemaResolver（M3，`src/engine/schema-resolver.ts`）

```typescript
class SchemaResolver {
  // 返回该 type 的全部 facet 定义（required + optional）
  // 每个 facet 包含 value_type, allow_multiple, verification_required, values(enum), blacklist(enum)
  resolve(type: string): ResolvedSchema;

  // 返回 12 种 type 的名称 + label + 简短描述（步骤 1 prompt 用）
  getAllTypes(): TypeSummary[];

  // 返回该 type 下所有 value_type: "taxonomy" 的 facet 名称
  getTaxonomyFacets(type: string): string[];
}
```

`ResolvedSchema` 结构：

```typescript
interface ResolvedSchema {
  type: string;
  label: string;
  description: string;
  facets: Record<string, FacetDefinition>;
}

interface FacetDefinition {
  description: string;
  value_type: 'taxonomy' | 'enum' | 'wikilink' | 'free-text' | 'date';
  allow_multiple: boolean;
  verification_required: boolean;
  values?: string[];           // enum 类型的可选值列表
  blacklist?: Record<string, string>;  // enum 类型的静态黑名单映射
}

interface TypeSummary {
  name: string;    // 如 "academic"
  label: string;   // 如 "学术研究"
  description: string;
}
```

### 4.4 PromptFilterBuilder（M3，`src/engine/prompt-filter-builder.ts`）

```typescript
class PromptFilterBuilder {
  // 给定 type，返回该 type 下所有 taxonomy facet 的候选标签子集
  // 仅包含 verified 标签，不含 rejected（黑名单）
  // 全量返回，不截断（registry 规模在百级别）
  build(type: string): { candidatesByFacet: Map<string, TagEntry[]> };
}
```

### 4.5 TagNormalizer（M3，`src/engine/tag-normalizer.ts`）

```typescript
class TagNormalizer {
  // 将任意格式字符串转为 lowercase-hyphenated 标准形式
  // 规则：空格/下划线→连字符，CamelCase 拆分，全部小写化，中文不变
  // 去除首尾空白和重复连字符
  static normalize(input: string): string;
}
```

### 4.6 TagMatcher（M3，`src/engine/tag-matcher.ts`）

```typescript
interface MatchResult {
  type: 'exact' | 'alias';  // 匹配方式
  entry: TagEntry;           // 完整标签条目（含 status、label 等）
}

class TagMatcher {
  // 输入经 TagNormalizer 规范化后，按以下优先级查找：
  // ① RegistryStore.getTag(normalized) → 精确 label 匹配
  // ② RegistryStore.findByAlias(normalized) → alias 匹配
  // 返回匹配结果含匹配类型和完整 TagEntry（含 status，供调用方区分 verified/rejected）
  match(normalizedLabel: string): MatchResult | null;
}
```

### 4.7 FrontmatterService（M3，`src/engine/frontmatter-service.ts`）

```typescript
class FrontmatterService {
  // 提取当前 YAML 中的 type/facet/tag 结构
  read(file: TFile): TaggedNote;
}

// TaggedNote 包含当前笔记的完整 type → facet → tags 结构
interface TaggedNote {
  types: string[];
  typeData: Record<string, Record<string, any>>;  // type → facet → value(s)
}
```

### 4.8 QueueStore（M2，`src/storage/queue-store.ts`）

```typescript
class QueueStore extends DataStore<VerificationQueue> {
  // 标准 DataStore 方法：load(), save(), update()
  // VerificationQueue = { queue: QueueItem[] }
}

interface QueueItem {
  id: string;              // 如 "q_001"
  tag_label: string;       // 标签名
  facet: string;           // 所属 facet
  suggested_by: string;    // "ai" | "user"
  source_notes: string[];  // 来源笔记路径数组
  queued_at: string;       // ISO datetime
  attempts: number;        // 重试次数
}
```

### 4.9 关键类型定义（M1，`src/types.ts`）

```typescript
type HealthStatus = 'online' | 'offline' | 'not_configured';

type Badge = 'verifying' | 'registry' | 'wiki_verified' | 'search_verified'
           | 'needs_review' | 'enum' | 'wikilink' | 'free_text' | 'date';

type VerifiedBy = 'seed' | 'wikipedia' | 'ai_search' | 'manual';

interface TagEntry {
  label: string;
  aliases: string[];
  facets: string[];
  status: 'verified' | 'rejected';
  flagged?: boolean;
  rejected_in_favor_of?: string;  // 仅 rejected 标签有此字段
  relations: {
    broader: string[];
    narrower: string[];
    related: string[];
  };
  source: {
    verified_by: VerifiedBy;
    url?: string;
    verified_at: string;  // ISO datetime
  };
}

interface StagingTagItem {
  label: string;
  badge: Badge;
  user_status: 'pending' | 'accepted' | 'deleted';
  ai_recommended?: boolean;
  replaces?: string[];
}

interface VerificationResult {
  verified: boolean;
  verified_by?: VerifiedBy;
  url?: string;
}

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

// AI 步骤 2 的上下文
interface TagGenContext {
  type: string;
  candidatesByFacet: Map<string, TagEntry[]>;
  existingTags: Record<string, any>;  // 当前 type 下的已有 YAML 标签
  noteContent: string;                // 剥离插件字段后的笔记内容
  facetDefinitions: Record<string, FacetDefinition>;
  wikilinkCandidates: string[];       // wikilink 候选池
}

// AI 步骤 2 的原始返回（未经 validator 处理）
type FacetTagMap = Record<string, string | string[]>;
```

### 4.10 常量（M1，`src/constants.ts`）

```typescript
// 插件生成的 YAML 字段名列表，供 PromptAssembler.stripPluginFields() 使用
const PLUGIN_YAML_FIELDS: string[] = [
  'type',
  'academic', 'project', 'course', 'journal', 'growth', 'relationship',
  'meeting', 'finance', 'health', 'career', 'creative', 'admin',
  '_tag_version', '_tagged_at'
];

// data.json 默认值
const DEFAULT_SETTINGS = {
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

### 4.11 Obsidian API 用法提示

```typescript
import { requestUrl, TFile, App } from 'obsidian';

// 所有 HTTP 请求必须通过 requestUrl（Obsidian 内置）
const response = await requestUrl({
  url: 'https://...',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ...' },
  body: JSON.stringify({ ... }),
  throw: false,  // 不自动抛异常，手动检查 status
});

// app.metadataCache — WikilinkCandidateCollector 用于扫描 vault
// app.vault.getMarkdownFiles() — 获取所有 md 文件
```

---

## 5. 你必须导出的接口

下游模块（M5 AnalysisOrchestrator、M6 侧边栏 UI、M7 BatchProcessor）会直接调用以下接口。接口签名不可变更。

### 5.1 HealthChecker

```typescript
// src/network/health-checker.ts
class HealthChecker {
  constructor(config: {
    name: string;           // 如 "generation", "verification", "search", "wikipedia"
    getEndpoint: () => string;   // 返回 ping URL（如 baseUrl + '/models'）
    getApiKey: () => string;     // 返回 API Key
    pingIntervalMs: number;      // ping 间隔（默认 60000）
    httpClient: HttpClient;
  });

  getStatus(): HealthStatus;         // 'online' | 'offline' | 'not_configured'
  refresh(): Promise<void>;          // 手动触发 ping
  on(event: 'statusChange', callback: (status: HealthStatus) => void): void;
  off(event: 'statusChange', callback: (status: HealthStatus) => void): void;
  start(): void;                     // 启动定时 ping
  stop(): void;                      // 停止定时 ping（onunload 调用）
}
```

**行为规格**：
- `getApiKey()` 返回空字符串 → 不发 ping，状态直接设为 `not_configured`
- 定时 ping 间隔由 `pingIntervalMs` 控制（默认 `ping_interval_ms` = 60000ms）
- ping 成功 → `online`；ping 失败（网络错误/超时/非 2xx）→ `offline`
- 状态变更时 emit `statusChange` 事件（仅在新状态与旧状态不同时 emit）
- `stop()` 清除定时器，防止内存泄漏

### 5.2 NetworkStatusAggregator

```typescript
// src/network/network-status-aggregator.ts
class NetworkStatusAggregator {
  constructor(checkers: {
    generation: HealthChecker;
    verification: HealthChecker;
    search: HealthChecker;
    wikipedia: HealthChecker;
  });

  // generation 和 verification 均 online 时返回 true
  // search 和 wikipedia 不参与红绿灯判定
  isFullyOnline(): boolean;

  // 组合各 checker 状态生成人类可读描述
  // 示例："生成服务: ✓ · 验证服务: ✗ 未配置 API Key"
  // 示例："生成服务: ✗ 无法连接 · 验证服务: ✓"
  getStatusTooltip(): string;

  // 手动刷新全部 checker
  refreshAll(): Promise<void>;

  // 任一 checker 状态变更时触发
  on(event: 'statusChange', callback: () => void): void;
  off(event: 'statusChange', callback: () => void): void;
}
```

### 5.3 HttpClient

```typescript
// src/network/http-client.ts
interface HttpError {
  status: number;        // HTTP 状态码，网络不可达时为 0
  message: string;
  isTimeout: boolean;
  isNetworkError: boolean;
}

class HttpClient {
  constructor(settings: { request_timeout_ms: number });

  // 发送 GET 请求，返回解析后的 JSON
  get<T>(url: string, headers?: Record<string, string>): Promise<T>;

  // 发送 POST 请求，返回解析后的 JSON
  post<T>(url: string, body: any, headers?: Record<string, string>): Promise<T>;

  // 更新超时设置
  updateTimeout(ms: number): void;
}
```

**行为规格**：
- 内部使用 Obsidian 的 `requestUrl`
- 统一超时处理（`request_timeout_ms`，默认 30000ms）
- 错误码规范化：网络不可达 / API 错误 / 超时 → 统一的 `HttpError` 类型
- 自动 JSON 解析响应 body

### 5.4 GenerationProvider（接口）

```typescript
// src/ai/generation-provider.ts
interface GenerationProvider {
  // 步骤 1：识别笔记类型
  // 输入：笔记全文 + 12 种 type 的名称/描述
  // 输出：type 名称（单个字符串）
  detectType(noteContent: string, typeDescriptions: TypeSummary[]): Promise<string>;

  // 步骤 2：按 type 生成标签
  // 输入：TagGenContext（候选标签、已有标签、facet 定义、笔记内容等）
  // 输出：{ facet: [tags] } 完整集合映射（未经 validator 处理的原始返回）
  generateTags(context: TagGenContext): Promise<FacetTagMap>;

  // Regenerate：生成同义候选
  // 输出：候选同义词数组（数量由 regenerate_count 控制，默认 5）
  generateSynonyms(tag: string, facet: string, noteContext: string): Promise<string[]>;
}
```

### 5.5 VerificationProvider（接口）

```typescript
// src/ai/verification-provider.ts
interface VerificationProvider {
  // 基于搜索结果判定标签真实性
  // 返回确认/否认 + 来源 URL
  verifyTag(
    tag: string,
    facet: string,
    searchResults: SearchResult[]
  ): Promise<VerificationResult>;
}
```

### 5.6 OpenAICompatibleProvider

```typescript
// src/ai/openai-compatible.ts
// 单一实现类，同时实现 GenerationProvider 和 VerificationProvider
// 通过配置（apiKey、baseUrl、model、temperature）区分角色
class OpenAICompatibleProvider implements GenerationProvider, VerificationProvider {
  constructor(config: {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens?: number;   // 仅 generation 需要
    httpClient: HttpClient;
    rateLimiter: RateLimiter;
  });

  // GenerationProvider 方法
  detectType(noteContent: string, typeDescriptions: TypeSummary[]): Promise<string>;
  generateTags(context: TagGenContext): Promise<FacetTagMap>;
  generateSynonyms(tag: string, facet: string, noteContext: string): Promise<string[]>;

  // VerificationProvider 方法
  verifyTag(tag: string, facet: string, searchResults: SearchResult[]): Promise<VerificationResult>;
}
```

**行为规格**：
- 请求格式：标准 OpenAI chat completion（`POST {baseUrl}/chat/completions`）
- 响应解析：从 markdown code block（```json ... ```）或纯 JSON 中提取结构化输出
- Generation 和 Verification 各创建一个实例，仅配置不同

### 5.7 PromptAssembler

```typescript
// src/ai/prompt-assembler.ts
class PromptAssembler {
  constructor(deps: {
    schemaResolver: SchemaResolver;
    promptFilterBuilder: PromptFilterBuilder;
    wikilinkCandidateCollector: WikilinkCandidateCollector;
  });

  // 构建步骤 1 的 prompt messages
  buildStep1Prompt(noteContent: string): ChatMessage[];

  // 构建步骤 2 的 prompt messages
  buildStep2Prompt(
    type: string,
    candidatesByFacet: Map<string, TagEntry[]>,
    existingTags: Record<string, any>,
    noteContent: string,
    wikilinkCandidates: string[]
  ): ChatMessage[];

  // 构建 Regenerate 的 prompt messages
  buildRegeneratePrompt(
    tag: string,
    facet: string,
    noteContext: string,
    count: number
  ): ChatMessage[];

  // 剥离插件生成的 YAML 字段
  // 移除 PLUGIN_YAML_FIELDS 中列出的字段，保留用户手写字段
  stripPluginFields(noteContent: string): string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];  // 多模态时使用 ContentPart[]
}
```

### 5.8 AIResponseValidator

```typescript
// src/ai/ai-response-validator.ts
interface ValidatedTag {
  label: string;       // 规范化后的 label（库内标签已替换为正式 label）
  badge: Badge;        // 'registry' | 'verifying' | 'needs_review' | 'enum' | 'wikilink' | 'free_text' | 'date'
  isNew: boolean;      // true = 新词，需走验证管线
}

interface ValidationOutput {
  facetTags: Record<string, ValidatedTag[]>;  // facet → 校验后的标签列表
  warnings: string[];                          // 校验过程中产生的 warning 日志
}

class AIResponseValidator {
  constructor(deps: {
    schemaResolver: SchemaResolver;
    tagMatcher: TagMatcher;
    tagNormalizer: typeof TagNormalizer;
    registryStore: RegistryStore;
  });

  // 校验 AI 步骤 2 返回的 { facet: [tags] } 映射
  validate(
    rawOutput: FacetTagMap,
    type: string
  ): ValidationOutput;
}
```

**6 步校验规则详解**（核心实现规格）：

1. **Facet 白名单过滤**：丢弃不在当前 type schema 中的 facet，记录 warning 日志
2. **TagNormalizer 统一调用**：所有 taxonomy 值强制经过 `TagNormalizer.normalize()` 规范化
3. **Taxonomy 库内匹配与黑名单解析**（最关键的一步）：
   - 经过规范化的 taxonomy 标签 → 调用 `TagMatcher.match(normalizedLabel)`
   - 命中 verified 标签（精确 label / aliases 任一命中）→ badge 设为 `registry`（🟢），**label 替换为匹配到的正式 label**（如 `"dl"` → `"deep-learning"`）
   - 命中 rejected 标签 → 自动替换为 `rejected_in_favor_of` 目标标签，badge 为 `registry`（🟢）
   - 未命中 → 新词，badge 为 `verifying`（⚪），`isNew: true`
4. **Enum 黑名单解析**：
   - 值不在 `values` 列表中 → 查 schema 中 facet 的 `blacklist` 映射表
   - 命中则替换为正确值，未命中则丢弃并记录 warning
   - **与 taxonomy 黑名单共用 `resolveBlacklist(value, map)` 解析函数**
5. **单值/多值规范化**：`allow_multiple: false` 的 facet 收到数组 → 取第一个；`allow_multiple: true` 收到字符串 → 包装为数组
6. **空值过滤**：移除空字符串、null、undefined 值

```typescript
// 共用黑名单解析函数
function resolveBlacklist(
  value: string,
  blacklistMap: Record<string, string>
): { resolved: string; wasReplaced: boolean } | null;
// 返回 null 表示值不在 blacklist 中且不在白名单中（丢弃）
// wasReplaced: true 表示发生了替换
```

### 5.9 WikilinkCandidateCollector

```typescript
// src/ai/wikilink-candidate-collector.ts
class WikilinkCandidateCollector {
  constructor(app: App);

  // 从 vault 中收集 wikilink 候选
  // 扫描全库已有 YAML 中所有 wikilink 类型 facet 的值
  // 提取 [[Name]] → 全部合并为一个去重池
  // 返回数组，最大长度 max_wikilink_candidates
  collect(maxCandidates: number): string[];
}
```

**行为规格**：
- 通过 `app.metadataCache` 扫描，不额外缓存（metadataCache 本身是内存级缓存）
- 扫描的 wikilink facet 列表：`scholar`、`people`、`person`、`participants`、`collaborator`、`instructor`、`provider`、`company`
- 统一池设计：同一人可能在不同 facet 下出现，统一池确保所有已知人名在任何 wikilink facet 中都可被推荐
- 冷启动时候选为空，AI 从笔记内容提取名称，随使用逐步积累

### 5.10 VerificationPipeline

```typescript
// src/verification/verification-pipeline.ts
class VerificationPipeline {
  constructor(deps: {
    wikipediaClient: WikipediaClient;
    aiVerifier: AIVerifier;
    wikipediaChecker: HealthChecker;
    searchChecker: HealthChecker;
    stagingStore: StagingStore;
    settings: { use_knowledge_base: boolean; request_timeout_ms: number };
  });

  // 对新词列表并发执行两级验证
  // 每个标签独立并发走管线，完成后立即 emit 事件
  verifyTags(tags: Array<{
    label: string;
    facet: string;
    notePath: string;
    type: string;
  }>): Promise<void>;

  // 单标签验证完成事件
  on(event: 'tagVerified', callback: (data: {
    label: string;
    badge: Badge;  // 'wiki_verified' | 'search_verified' | 'needs_review'
    notePath: string;
    type: string;
    facet: string;
  }) => void): void;

  off(event: 'tagVerified', callback: Function): void;
}
```

### 5.11 VerificationQueueManager

```typescript
// src/verification/verification-queue-manager.ts
class VerificationQueueManager {
  constructor(deps: {
    queueStore: QueueStore;
    verificationPipeline: VerificationPipeline;
    stagingStore: StagingStore;
    registryStore: RegistryStore;
    networkAggregator: NetworkStatusAggregator;
  });

  // 入队（自动按 tag_label 去重）
  enqueue(item: {
    tag_label: string;
    facet: string;
    suggested_by: 'ai' | 'user';
    source_note: string;
  }): Promise<void>;

  // 启动监听（监听 NetworkStatusAggregator 的 statusChange）
  start(): void;

  // 停止监听
  stop(): void;

  // 手动触发重试（启动时、网络恢复时调用）
  processQueue(): Promise<void>;

  // 清理已入 registry 的条目（applyAll 后调用）
  cleanupRegistered(): Promise<void>;

  // 启动时清理（移除所有 tag_label 已在 registry 中的条目）
  cleanupOnStartup(): Promise<void>;
}
```

### 5.12 RateLimiter

```typescript
// src/ai/rate-limiter.ts
class RateLimiter {
  constructor(config?: {
    tokensPerSecond?: number;  // 默认合理值，如 10
    bucketSize?: number;       // 默认合理值，如 20
  });

  // 获取一个令牌，在令牌可用前 await 阻塞
  // dimension 为 baseUrl，确保同一 API 端点的所有请求共享限速
  acquire(dimension: string): Promise<void>;
}
```

### 5.13 WikipediaClient

```typescript
// src/verification/wikipedia-client.ts
class WikipediaClient {
  constructor(deps: {
    httpClient: HttpClient;
    lang: string;  // 默认 'en'
  });

  // 查询 Wikipedia，返回验证结果
  // 处理重定向（#REDIRECT）和消歧义页面
  // 网络不可达时返回 { verified: false }（不报错）
  lookup(label: string): Promise<VerificationResult>;
}
```

**Wikipedia REST API**：
- 端点：`https://{lang}.wikipedia.org/w/api.php`
- 参数：`action=query&titles={label}&format=json&redirects=1&prop=pageprops`
- 命中判定：页面存在且非消歧义页面（`pageprops` 不含 `disambiguation`）
- 命中时 `url` 为 `https://{lang}.wikipedia.org/wiki/{title}`

### 5.14 SearchClient

```typescript
// src/verification/search-client.ts
class SearchClient {
  constructor(deps: {
    httpClient: HttpClient;
    searchType: 'brave' | 'tavily';
    apiKey: string;
    baseUrl: string;
  });

  // 搜索标签，返回标准化的 SearchResult[]
  search(query: string): Promise<SearchResult[]>;
}
```

### 5.15 BraveSearchAdapter

```typescript
// src/verification/brave-search-adapter.ts
class BraveSearchAdapter {
  constructor(httpClient: HttpClient, apiKey: string, baseUrl: string);

  // Brave Search API：GET + header auth（X-Subscription-Token）
  search(query: string): Promise<SearchResult[]>;
}
```

**Brave Search API 格式**：
- 端点：`GET {baseUrl}/res/v1/web/search?q={query}&count=5`
- 认证：`X-Subscription-Token: {apiKey}` header
- 响应解析：`response.web.results[]` → 提取 `title`, `description`(→snippet), `url`

### 5.16 TavilySearchAdapter

```typescript
// src/verification/tavily-search-adapter.ts
class TavilySearchAdapter {
  constructor(httpClient: HttpClient, apiKey: string, baseUrl: string);

  // Tavily Search API：POST + body auth
  search(query: string): Promise<SearchResult[]>;
}
```

**Tavily Search API 格式**：
- 端点：`POST {baseUrl}/search`
- 认证：`api_key` 在 request body 中
- Body：`{ "api_key": "...", "query": "...", "max_results": 5 }`
- 响应解析：`response.results[]` → 提取 `title`, `content`(→snippet), `url`

### 5.17 AIVerifier

```typescript
// src/verification/ai-verifier.ts
class AIVerifier {
  constructor(deps: {
    searchClient: SearchClient;
    verificationProvider: VerificationProvider;
  });

  // 两步验证：① 搜索标签 ② 将搜索结果发给 Verification AI 判定
  verify(tag: string, facet: string): Promise<VerificationResult>;
}
```

---

## 6. 需要的类型定义

以下类型来自 `src/types.ts`（M1 提供），你需要 import 使用。完整定义见 §4.9。

| 类型 | 用途 |
|------|------|
| `HealthStatus` | HealthChecker 状态 |
| `Badge` | 标签信心级别 |
| `VerifiedBy` | 验证来源 |
| `TagEntry` | 标签库条目 |
| `StagingTagItem` | 暂存区标签项 |
| `VerificationResult` | 验证管线返回 |
| `SearchResult` | 搜索 API 返回 |
| `TagGenContext` | AI 步骤 2 上下文 |
| `FacetTagMap` | AI 步骤 2 原始返回 |
| `FacetDefinition` | Facet 定义 |
| `TypeSummary` | Type 摘要 |

---

## 7. 数据格式

### 7.1 verification-queue.json（离线验证队列）

**队列按 `tag_label` 去重**：同一标签被多篇笔记触发时只保留一条记录，`source_notes` 为数组，记录所有来源笔记路径。验证完成后广播更新**整个 staging** 中包含该标签的所有笔记条目（不限于 `source_notes` 列表中的笔记）。

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

### 7.2 tag-staging.json（暂存区，badge 更新目标）

本模块会通过 `StagingStore.updateTagBadge()` 更新 staging 中标签的 badge 字段。badge 取值：

| badge 值 | 颜色 | 含义 | 何时设置 |
|----------|------|------|---------|
| `verifying` | ⚪ 灰色 | 验证管线进行中（操作按钮禁用） | AIResponseValidator 发现新词时初始设置 |
| `registry` | 🟢 绿色 | 标签库已有 | AIResponseValidator 匹配到 verified/rejected 标签 |
| `wiki_verified` | 🔵 蓝色 | Wikipedia 确认 | VerificationPipeline 第 1 级命中 |
| `search_verified` | 🔵 蓝色 | AI 联网搜索确认 | VerificationPipeline 第 2 级命中 |
| `needs_review` | 🟡 黄色 | 三级验证均未确认 | VerificationPipeline 全部未命中 |
| `enum` | — | enum 类型（无需验证） | AIResponseValidator 对 enum facet 标签设置 |
| `wikilink` | — | wikilink 类型 | AIResponseValidator 对 wikilink facet 标签设置 |
| `free_text` | — | free-text 类型 | AIResponseValidator 对 free-text facet 标签设置 |
| `date` | — | date 类型 | AIResponseValidator 对 date facet 标签设置 |

staging 中单个标签条目示例：

```json
{
  "label": "flash-attention",
  "badge": "verifying",
  "user_status": "pending",
  "ai_recommended": true
}
```

### 7.3 data.json 中与本模块相关的设置

| 字段 | 默认值 | 用途 |
|------|--------|------|
| `generation_api_key` | `""` | Generation AI 的 API Key |
| `generation_base_url` | `""` | Generation AI 的端点 |
| `generation_model` | `""` | Generation AI 的模型名 |
| `generation_temperature` | `0.7` | Generation AI 的温度 |
| `generation_max_tokens` | `2048` | 步骤 2 AI 输出的 max_tokens |
| `verification_api_key` | `""` | Verification AI 的 API Key |
| `verification_base_url` | `""` | Verification AI 的端点 |
| `verification_model` | `""` | Verification AI 的模型名 |
| `verification_temperature` | `0.3` | Verification AI 的温度 |
| `search_type` | `"brave"` | 搜索 API 类型：`brave` / `tavily` |
| `search_api_key` | `""` | Search API 的 API Key |
| `search_base_url` | `""` | Search API 的端点 |
| `knowledge_base_source` | `"wikipedia"` | 知识库来源（当前固定 wikipedia） |
| `knowledge_base_lang` | `"en"` | Wikipedia 语言 |
| `use_knowledge_base` | `true` | 是否启用第 1 级 Wikipedia 验证 |
| `regenerate_count` | `5` | Regenerate 生成的同义词数量 |
| `max_wikilink_candidates` | `100` | wikilink 候选池上限 |
| `request_timeout_ms` | `30000` | 单个请求超时（ms） |
| `ping_interval_ms` | `60000` | HealthChecker ping 间隔（ms） |

### 7.4 badge → verified_by 映射

`applyAll`（M5 实现）时使用此映射将 staging badge 转为 registry 的 `verified_by` 字段。本模块需确保 badge 值与此映射一致：

| staging badge | registry verified_by |
|---------------|---------------------|
| `wiki_verified` | `wikipedia` |
| `search_verified` | `ai_search` |
| `needs_review` | `manual` |
| `registry` | （不更新 registry，标签已在库中） |

---

## 8. 实现规格（per-file，按子目录组织）

### 8.1 network/health-checker.ts

**职责**：通用的外部服务健康检查抽象。插件为每个外部服务各实例化一个 checker。

**4 个实例规格**：

| 实例 | 检测目标 | ping 端点 | 参与红绿灯 |
|------|---------|----------|-----------|
| `generationChecker` | Generation AI | `{generation_base_url}/models` | 是 |
| `verificationChecker` | Verification AI | `{verification_base_url}/models` | 是 |
| `searchChecker` | Search API（Brave/Tavily endpoint） | 根据 search_type 使用适当端点 | 否 |
| `wikipediaChecker` | Wikipedia API | `https://{lang}.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json` | 否 |

**核心逻辑**：

```
constructor → 状态初始化为 not_configured（如果 getApiKey() 为空）或 offline
start():
  如果 getApiKey() 返回空 → 状态设为 not_configured，不启动定时器
  否则 → 立即执行一次 ping，然后启动 setInterval(ping, pingIntervalMs)
ping():
  try:
    await httpClient.get(getEndpoint())
    如果当前状态不是 online → 设为 online，emit statusChange
  catch:
    如果当前状态不是 offline → 设为 offline，emit statusChange
refresh():
  如果 getApiKey() 为空 → 重新设为 not_configured
  否则 → 执行一次 ping
stop():
  clearInterval(定时器)
```

**事件机制**：使用简单的回调数组实现，不引入第三方 EventEmitter。

### 8.2 network/network-status-aggregator.ts

**职责**：组合 4 个 HealthChecker，提供聚合接口。

**聚合逻辑**：
- `isFullyOnline()` = `generation.getStatus() === 'online' && verification.getStatus() === 'online'`
- search 和 wikipedia 的状态**不影响** `isFullyOnline()` 返回值
- `getStatusTooltip()` 生成规则：
  - 遍历 generation 和 verification checker
  - `online` → `"✓"`
  - `offline` → `"✗ 无法连接"`
  - `not_configured` → `"✗ 未配置 API Key"`
  - 格式：`"生成服务: {状态} · 验证服务: {状态}"`
- 订阅所有 4 个 checker 的 `statusChange`，任一变更时 re-emit 聚合事件

### 8.3 network/http-client.ts

**职责**：`requestUrl` 的薄封装。

**实现要点**：
- 内部调用 `requestUrl({ url, method, headers, body, throw: false })`
- `throw: false` 防止 Obsidian 自动抛异常
- 检查 `response.status`：2xx → 返回 `response.json`；其他 → 抛出 `HttpError`
- 超时处理：`requestUrl` 不直接支持自定义超时，需要用 `Promise.race` + `setTimeout` 实现
- 超时后抛出 `HttpError { status: 0, message: 'Request timeout', isTimeout: true, isNetworkError: false }`
- 网络不可达：`requestUrl` 抛出异常时包装为 `HttpError { status: 0, isTimeout: false, isNetworkError: true }`

### 8.4 ai/generation-provider.ts

**职责**：纯接口定义文件，定义 `GenerationProvider` 接口。无实现代码。

### 8.5 ai/verification-provider.ts

**职责**：纯接口定义文件，定义 `VerificationProvider` 接口。无实现代码。

### 8.6 ai/openai-compatible.ts

**职责**：所有 AI 服务的单一实现类，处理 OpenAI chat completion 格式。

**请求格式**（标准 OpenAI）：

```json
POST {baseUrl}/chat/completions
{
  "model": "...",
  "messages": [ { "role": "system", "content": "..." }, ... ],
  "temperature": 0.7,
  "max_tokens": 2048
}
```

**响应解析**：
1. 提取 `response.choices[0].message.content`
2. 尝试直接 `JSON.parse(content)`
3. 若失败，用正则提取 markdown code block 中的 JSON：`` ```json\n...\n``` `` 或 `` ```\n...\n``` ``
4. 若仍失败，对于 `detectType` 等返回纯字符串的方法，直接使用 content.trim()

**认证**：`Authorization: Bearer {apiKey}`

**各方法的 prompt 构建委托给 PromptAssembler**，本类只负责发送请求和解析响应。

### 8.7 ai/prompt-assembler.ts

**职责**：组装两步 AI 调用和 Regenerate 的 prompt 文本。

**步骤 1 prompt 构建**：

```
system:
  你是一位专业的图书馆分类员和知识管理专家。
  根据笔记内容，从以下 12 种笔记类型中选择最匹配的一种。
  只返回类型名称，不要返回其他内容。

  类型列表：
  - academic: 学术研究 — 学术论文精读、文献综述、研究方法论笔记、学术概念梳理
  - project: 项目/复现 — 编程项目、论文复现、开源贡献、工程实践记录
  ... （12 种 type 全部列出）

user:
  {笔记内容（经 stripPluginFields() 剥离插件字段后的完整笔记）}
```

预估约 500-800 token。

**步骤 2 prompt 构建**：

```
system:
  你是一位专业的图书馆分类员和知识管理专家。
  为以下笔记标注标签。对每个 facet，严格审查已有标签，确保标签完整覆盖内容。
  保留准确的，移除不准确的，补充遗漏的。
  返回你认为该笔记应拥有的完整标签集合。
  以 JSON 格式返回：{ "facet_name": ["tag1", "tag2"], ... }

  当前笔记类型：{type}（{label} — {description}）

  === Facet 定义 ===

  【{facet_name}】({description})
  类型：taxonomy，可多选：{allow_multiple}
  候选标签（可从中选择或建议新词）：
  - tag-a
  - tag-b
  ...

  【{facet_name}】({description})
  类型：enum，可多选：{allow_multiple}
  可选值（只能从中选择，不可自创）：
  - value-a
  - value-b

  【{facet_name}】({description})
  类型：wikilink，可多选：{allow_multiple}
  已有人名列表（可使用已有名称或创建新名称，格式 [[Name]]）：
  - [[Person-A]]
  - [[Person-B]]

  【{facet_name}】({description})
  类型：free-text
  格式要求：{描述}

  【{facet_name}】({description})
  类型：date
  格式要求：YYYY-MM-DD

  === 已有标签（请审查） ===
  {facet_name}: [existing-tag-1, existing-tag-2]
  ...

user:
  {笔记内容（剥离插件字段后）}
```

**Regenerate prompt 构建**：

```
system:
  你是一位专业的图书馆分类员。
  为以下标签生成 {count} 个同义词或近义词。
  要求：
  - 必须是同义或近义概念，不能是不同概念
  - 使用 lowercase-hyphenated 格式
  - 以 JSON 数组格式返回：["synonym-1", "synonym-2", ...]

  标签：{tag}
  所属 facet：{facet}

user:
  笔记上下文（用于参考）：
  {noteContext}
```

**`stripPluginFields()` 实现**：
- 解析笔记中的 YAML frontmatter（`---\n...\n---`）
- 移除 `PLUGIN_YAML_FIELDS` 中列出的字段（`type`、12 个 type 名称、`_tag_version`、`_tagged_at`）
- 保留用户手写字段（如 `title`、`author` 等）
- 重新组装 frontmatter + body 返回

### 8.8 ai/ai-response-validator.ts

**职责**：校验 AI 步骤 2 返回的 `{ facet: [tags] }` 映射。6 步校验规则见 §5.8。

**核心实现流程**（伪代码）：

```typescript
validate(rawOutput: FacetTagMap, type: string): ValidationOutput {
  const schema = this.schemaResolver.resolve(type);
  const warnings: string[] = [];
  const facetTags: Record<string, ValidatedTag[]> = {};
  // 获取 taxonomy 黑名单映射（用于 step 3 rejected 标签解析）
  const taxonomyFacets = Object.keys(schema.facets)
    .filter(f => schema.facets[f].value_type === 'taxonomy');

  for (const [facet, rawValues] of Object.entries(rawOutput)) {
    // Step 1: Facet 白名单
    if (!(facet in schema.facets)) {
      warnings.push(`未知 facet "${facet}" 已丢弃`);
      continue;
    }

    const def = schema.facets[facet];
    let values = Array.isArray(rawValues) ? rawValues : [rawValues];

    // Step 6: 空值过滤
    values = values.filter(v => v != null && v !== '');

    const validated: ValidatedTag[] = [];

    for (const raw of values) {
      if (def.value_type === 'taxonomy') {
        // Step 2: TagNormalizer
        const normalized = TagNormalizer.normalize(raw);

        // Step 3: TagMatcher 匹配
        const matchResult = this.tagMatcher.match(normalized);

        if (matchResult) {
          if (matchResult.entry.status === 'verified') {
            // 命中 verified → 🟢，label 替换为正式 label
            validated.push({
              label: matchResult.entry.label,
              badge: 'registry',
              isNew: false
            });
          } else if (matchResult.entry.status === 'rejected') {
            // 命中 rejected → 替换为目标标签（🟢）
            const targetLabel = matchResult.entry.rejected_in_favor_of!;
            validated.push({
              label: targetLabel,
              badge: 'registry',
              isNew: false
            });
          }
        } else {
          // 未命中 → 新词（⚪ verifying）
          validated.push({
            label: normalized,
            badge: 'verifying',
            isNew: true
          });
        }
      } else if (def.value_type === 'enum') {
        // Step 4: Enum 校验
        if (def.values!.includes(raw)) {
          validated.push({ label: raw, badge: 'enum', isNew: false });
        } else {
          // 查 enum blacklist
          const resolved = resolveBlacklist(raw, def.blacklist || {});
          if (resolved) {
            validated.push({ label: resolved.resolved, badge: 'enum', isNew: false });
            if (resolved.wasReplaced) {
              warnings.push(`Enum 值 "${raw}" 替换为 "${resolved.resolved}"`);
            }
          } else {
            warnings.push(`非法 enum 值 "${raw}" 已丢弃`);
          }
        }
      } else if (def.value_type === 'wikilink') {
        validated.push({ label: raw, badge: 'wikilink', isNew: false });
      } else if (def.value_type === 'free-text') {
        validated.push({ label: raw, badge: 'free_text', isNew: false });
      } else if (def.value_type === 'date') {
        validated.push({ label: raw, badge: 'date', isNew: false });
      }
    }

    // Step 5: 单值/多值规范化
    if (!def.allow_multiple && validated.length > 1) {
      facetTags[facet] = [validated[0]];
    } else {
      facetTags[facet] = validated;
    }
  }

  return { facetTags, warnings };
}
```

### 8.9 ai/wikilink-candidate-collector.ts

**职责**：从 vault 中收集所有 wikilink facet 的值，合并为去重池。

**实现要点**：
- 遍历 `app.vault.getMarkdownFiles()`
- 对每个文件，通过 `app.metadataCache.getFileCache(file)?.frontmatter` 读取 YAML
- 扫描所有 wikilink 类型 facet 字段：`scholar`, `people`, `person`, `participants`, `collaborator`, `instructor`, `provider`, `company`
- 提取值中的 `[[Name]]` → 去掉双括号得到 `Name`
- 全部合并到一个 `Set<string>` 中去重
- 返回 Array，限制最大长度为 `max_wikilink_candidates`

### 8.10 ai/rate-limiter.ts

**职责**：Token Bucket 限速器，按 `baseUrl` 维度限速。

**实现要点**：
- 维护 `Map<string, Bucket>` — 每个 baseUrl 一个 bucket
- Token Bucket 算法：
  - 桶容量 `bucketSize`（默认如 20），初始满
  - 每秒补充 `tokensPerSecond` 个令牌（默认如 10）
  - `acquire(dimension)` 检查对应桶：令牌 >= 1 → 消耗 1 个立即返回；不足 → 计算需等待的时间 → `await delay(waitMs)`
- 令牌补充使用时间差计算（lazy refill），而非定时器：每次 acquire 时计算距上次补充的时间差 × tokensPerSecond，累加到当前令牌数（不超过 bucketSize）

### 8.11 verification/wikipedia-client.ts

**职责**：封装 Wikipedia REST API 查询。

**API 调用详情**：

```
GET https://{lang}.wikipedia.org/w/api.php
  ?action=query
  &titles={label}
  &format=json
  &redirects=1
  &prop=pageprops
```

**命中判定**：
1. 响应中 `query.pages` 不含 `-1` 键（页面存在）
2. 页面的 `pageprops` 不包含 `disambiguation` 键（非消歧义页面）

**返回**：
- 命中：`{ verified: true, verified_by: 'wikipedia', url: 'https://{lang}.wikipedia.org/wiki/{normalized_title}' }`
- 未命中：`{ verified: false }`
- 网络错误/超时：`{ verified: false }`（catch 后返回，不抛异常，让 pipeline 继续到下一级）

### 8.12 verification/search-client.ts

**职责**：统一的搜索 API 抽象层。根据 `search_type` 配置委派给具体适配器。

**实现要点**：
- 构造时根据 `searchType` 创建对应适配器（BraveSearchAdapter 或 TavilySearchAdapter）
- `search(query)` 委派给适配器，返回标准化的 `SearchResult[]`

### 8.13 verification/brave-search-adapter.ts

**职责**：Brave Search API 适配。

**API 调用详情**：

```
GET {baseUrl}/res/v1/web/search
  ?q={query}
  &count=5

Headers:
  Accept: application/json
  X-Subscription-Token: {apiKey}
```

**响应解析**：
```typescript
response.web.results.map(r => ({
  title: r.title,
  snippet: r.description,
  url: r.url
}))
```

### 8.14 verification/tavily-search-adapter.ts

**职责**：Tavily Search API 适配。

**API 调用详情**：

```
POST {baseUrl}/search

Body:
{
  "api_key": "{apiKey}",
  "query": "{query}",
  "max_results": 5
}
```

**响应解析**：
```typescript
response.results.map(r => ({
  title: r.title,
  snippet: r.content,
  url: r.url
}))
```

### 8.15 verification/ai-verifier.ts

**职责**：组合搜索 + AI 判定的两步验证流程。

**流程**：
1. 调用 `searchClient.search(tag)` 获取搜索结果
2. 如果搜索结果为空 → 返回 `{ verified: false }`
3. 调用 `verificationProvider.verifyTag(tag, facet, searchResults)` → AI 判定
4. 返回 AI 判定结果

**Verification AI prompt**（在 OpenAICompatibleProvider 中构建）：

```
system:
  你是一个术语验证专家。
  根据以下搜索结果，判断给定标签是否为真实存在的学术/技术术语。
  返回 JSON：{ "verified": true/false, "url": "最相关的来源 URL" }
  如果搜索结果中没有足够证据确认该术语存在，返回 { "verified": false }

user:
  标签：{tag}
  所属类别：{facet}

  搜索结果：
  1. [{title}]({url})
     {snippet}
  2. ...
```

### 8.16 verification/verification-pipeline.ts

**职责**：两级验证编排器。**最关键的实现之一**。

**两级验证级联逻辑**（每个标签独立并发）：

```
输入：新词（AIResponseValidator 已确认不在 registry 中）
     badge 已设为 ⚪ verifying

Level 1: Wikipedia 验证
  ├── use_knowledge_base === false → 跳过
  ├── wikipediaChecker.getStatus() !== 'online' → 跳过（自动降级）
  └── WikipediaClient.lookup(label)
      ├── 命中 → badge: wiki_verified (🔵) → 完成 ✓
      └── 未命中 → 继续

Level 2: Search API + AI 判定
  ├── searchChecker.getStatus() === 'not_configured' → badge: needs_review (🟡) → 完成
  └── AIVerifier.verify(label, facet)
      ├── 确认 → badge: search_verified (🔵) → 完成 ✓
      └── 存疑 → badge: needs_review (🟡) → 完成

完成后：
  1. StagingStore.updateTagBadge(notePath, type, facet, label, badge)
  2. emit('tagVerified', { label, badge, notePath, type, facet })
```

**⚪ 终态保证实现**：

```typescript
async verifySingleTag(tag): Promise<void> {
  let badge: Badge = 'needs_review';  // 默认终态

  try {
    // Level 1
    if (this.settings.use_knowledge_base &&
        this.wikipediaChecker.getStatus() === 'online') {
      try {
        const result = await this.wikipediaClient.lookup(tag.label);
        if (result.verified) {
          badge = 'wiki_verified';
          // 更新 staging 并发射事件
          await this.finalize(tag, badge, result.url);
          return;
        }
      } catch (e) {
        // Wikipedia 请求失败 → 跳到 Level 2，不报错
        console.warn('Wikipedia lookup failed, falling through', e);
      }
    }

    // Level 2
    if (this.searchChecker.getStatus() === 'not_configured') {
      badge = 'needs_review';
    } else {
      try {
        const result = await this.aiVerifier.verify(tag.label, tag.facet);
        badge = result.verified ? 'search_verified' : 'needs_review';
      } catch (e) {
        // Search/AI 验证失败 → needs_review
        console.warn('AI verification failed, marking as needs_review', e);
        badge = 'needs_review';
      }
    }
  } catch (e) {
    // catch-all：未预期异常 → needs_review
    console.error('Unexpected error in verification pipeline', e);
    badge = 'needs_review';
  }

  await this.finalize(tag, badge);
}

private async finalize(tag, badge, url?): Promise<void> {
  await this.stagingStore.updateTagBadge(
    tag.notePath, tag.type, tag.facet, tag.label, badge
  );
  this.emit('tagVerified', {
    label: tag.label,
    badge,
    notePath: tag.notePath,
    type: tag.type,
    facet: tag.facet,
  });
}
```

**并发机制**：
- `verifyTags(tags)` 对所有标签调用 `Promise.allSettled(tags.map(t => verifySingleTag(t)))`
- 每个标签独立并发，先完成的先 emit 事件
- `allSettled` 确保一个标签的失败不影响其他标签

### 8.17 verification/verification-queue-manager.ts

**职责**：管理离线验证队列。

**入队逻辑（`enqueue()`）**：

```typescript
async enqueue(item): Promise<void> {
  await this.queueStore.update(data => {
    // 按 tag_label 去重
    const existing = data.queue.find(q => q.tag_label === item.tag_label);
    if (existing) {
      // 追加 source_note（如果不在列表中）
      if (!existing.source_notes.includes(item.source_note)) {
        existing.source_notes.push(item.source_note);
      }
    } else {
      // 新建队列项
      data.queue.push({
        id: `q_${Date.now()}`,
        tag_label: item.tag_label,
        facet: item.facet,
        suggested_by: item.suggested_by,
        source_notes: [item.source_note],
        queued_at: new Date().toISOString(),
        attempts: 0,
      });
    }
  });
}
```

**三层清理逻辑**：

1. **`applyAll` 后清理（`cleanupRegistered()`）**：
   - 加载队列 → 过滤掉 `tag_label` 已在 `RegistryStore`（`status: verified`）中的条目 → 保存

2. **验证完成后清理**（在 `processQueue()` 内部）：
   - 验证完成的标签 → 检查 RegistryStore：
     - 标签已在 registry 且 `flagged: true` → `unflagTag(label)`
     - 标签已在 registry → 更新 `verified_by`（如从 `manual` 升级为 `wikipedia`）
   - **广播更新 staging**：调用 `StagingStore.findAndUpdateTagGlobally(label, updater)` 更新所有包含该标签且 badge 为 `verifying` 或 `needs_review` 的条目
   - **始终**从队列移除已验证条目（无论 staging 中是否找到匹配）

3. **启动时清理（`cleanupOnStartup()`）**：
   - 加载队列 → 移除所有 `tag_label` 已在 RegistryStore 中（`status: verified`）的条目 → 保存

**网络恢复自动重试**：

```typescript
start(): void {
  // 监听 NetworkStatusAggregator 的 statusChange 事件
  this.networkAggregator.on('statusChange', () => {
    if (this.networkAggregator.isFullyOnline()) {
      this.processQueue();
    }
  });
}

async processQueue(): Promise<void> {
  const data = await this.queueStore.load();
  for (const item of data.queue) {
    item.attempts++;
    try {
      // 使用 VerificationPipeline 的单标签验证逻辑
      // 但需要处理 staging 中可能不存在对应条目的情况
      const result = await this.verifyQueuedTag(item);
      // 广播更新
      await this.broadcastResult(item, result);
      // 从队列移除
      await this.removeFromQueue(item.tag_label);
    } catch (e) {
      if (item.attempts >= MAX_ATTEMPTS) {
        // 超过重试上限 → 标为 needs_review 并移除
        await this.broadcastResult(item, { verified: false });
        await this.removeFromQueue(item.tag_label);
      }
      // 未超过上限 → 保留在队列中，下次重试
    }
  }
}
```

**验证失败后的标签处理**：
- 标签已在 registry 中（之前 `applyAll` 过，`verified_by: manual`）→ `registryStore.flagTag(label)`；发 Notice 通知用户
- 标签仍在 staging 中 → badge 保持 `needs_review`
- 验证成功 → 如标签 `flagged` 则 `unflagTag()`

---

## 9. 测试策略

### 9.1 Mock HTTP（核心基础）

所有外部 HTTP 请求通过 `HttpClient` 发出。测试时 mock `HttpClient` 的 `get()` 和 `post()` 方法即可隔离全部外部依赖。

```typescript
// mock 示例
const mockHttpClient = {
  get: jest.fn(),
  post: jest.fn(),
  updateTimeout: jest.fn(),
};
```

### 9.2 AI 调用测试

- **Prompt 构建正确性**：mock PromptFilterBuilder 返回已知候选 → 验证 PromptAssembler 输出包含正确的候选标签、facet schema，**不含黑名单标签**
- **两步流程端到端**：mock 步骤 1 返回 `"academic"` → 验证步骤 2 prompt 包含 academic 的 facet 定义和对应标签子集
- **响应解析**：mock 返回 JSON code block → 验证正确提取；mock 返回纯 JSON → 验证正确解析；mock 返回非法 JSON → 验证 graceful 降级

### 9.3 AIResponseValidator 测试

- **Aliases 匹配**：AI 返回 `"DL"` → TagNormalizer 规范化为 `"dl"` → TagMatcher 命中 `deep-learning` 的 aliases → badge 为 🟢 `registry`，label 为 `"deep-learning"`（非 `"dl"`），不走验证管线
- **Taxonomy 黑名单**：AI 返回 `"ML"`（registry 中 rejected，`rejected_in_favor_of: "machine-learning"`）→ 自动替换为 `"machine-learning"`，badge 🟢
- **Enum 黑名单**：AI 返回 `"english"`（schema lang blacklist 中映射到 `"en"`）→ 自动替换为 `"en"`；AI 返回 `"unknown-lang"` → 丢弃并记录 warning
- **Facet 白名单**：AI 返回不存在的 facet → 丢弃 + warning
- **单值/多值**：`allow_multiple: false` 收到 `["a", "b"]` → 取 `"a"`
- **`resolveBlacklist()` 共用函数**：taxonomy 和 enum 黑名单映射表均正确解析

### 9.4 验证管线测试

- **两级级联**：mock Wikipedia miss → Search + AI hit → 返回 `search_verified`
- **全 miss**：Wikipedia miss + Search+AI 存疑 → `needs_review`
- **Search API 未配置**：`searchChecker.getStatus()` 返回 `not_configured` → Wikipedia miss 后直接 `needs_review`
- **Wikipedia 不可达**：`wikipediaChecker.getStatus()` 返回 `offline` → 跳过 Level 1，直接 Level 2
- **`use_knowledge_base: false`**：跳过 Level 1
- **⚪ 终态保证**：Wikipedia 请求超时 + Search API 500 + Verification AI 认证失败 → 所有级别均失败 → badge 从 ⚪ 更新为 🟡 `needs_review`（非永久卡死）；未预期异常 → catch-all 标记 🟡

### 9.5 并发验证测试

- 5 个标签同时验证，不同完成顺序，每个标签的 `tagVerified` 事件均正确发出
- `Promise.allSettled` 确保一个标签的失败不影响其他标签

### 9.6 SearchClient 测试

- mock Brave 响应 → 验证 BraveSearchAdapter 正确转换为标准化 `SearchResult[]`
- mock Tavily 响应 → 验证 TavilySearchAdapter 正确转换为标准化 `SearchResult[]`
- 空搜索结果 → 返回空数组

### 9.7 离线队列测试

- **去重**：同一标签从 3 篇笔记入队 → 队列中只有 1 条记录，`source_notes` 含 3 个路径
- **广播**：验证完成 → staging 中所有包含该标签的笔记 badge 均更新（通过 `findAndUpdateTagGlobally`）
- **自动重试**：入队 → 模拟 online 事件 → 自动重试 → 成功后出队
- **三层清理**：
  - applyAll 后：已入 registry 的标签从队列移除
  - 验证完成后：条目始终移除
  - 启动时：清理已在 registry 中的条目
- **验证失败 flagging**：已 applyAll 的标签验证失败 → registry 标记 `flagged: true`；验证成功 → 取消 flagged

### 9.8 HealthChecker 测试

- API Key 为空 → 不发 ping，状态为 `not_configured`
- ping 成功 → `online`；ping 失败 → `offline`
- 状态变更时 emit 事件（相同状态不重复 emit）
- generation 可达 + verification 不可达 → `isFullyOnline()` 返回 `false`
- tooltip 文本包含正确状态描述

### 9.9 RateLimiter 测试

- 突发请求被正确节流，限速后请求排队等待
- 同一 baseUrl 的 generation 和 verification 请求共享限速器
- 不同 baseUrl 的请求使用独立限速器

---

## 10. 验收标准

### 10.1 必须通过的功能验收

1. **HealthChecker ×4 实例**：
   - 配置 Generation API Key 后，generationChecker 状态为 `online`
   - Verification API Key 为空 → verificationChecker 状态为 `not_configured`
   - `isFullyOnline()` 返回 `false`（因为 verification 非 online）
   - tooltip 显示 `"生成服务: ✓ · 验证服务: ✗ 未配置 API Key"`

2. **AI 两步调用**：
   - 配置 Generation API Key 后，对一篇笔记执行步骤 1 → 返回 type 名称
   - 执行步骤 2 → 返回结构化 `{ facet: [tags] }` 映射
   - AIResponseValidator 校验后：黑名单已解析、label 已规范化、badge 已设置

3. **AIResponseValidator 别名匹配**：
   - AI 返回 `"DL"` → 经 TagNormalizer + TagMatcher → label 变为 `"deep-learning"`，badge 为 `registry`

4. **两级验证管线**：
   - 新 taxonomy 标签自动走验证管线
   - 每个标签独立完成后 `tagVerified` 事件触发
   - Wikipedia 不可达时自动降级到第 2 级
   - Search API 未配置时 Wikipedia 未命中直接标 🟡

5. **⚪ 终态保证**：
   - 所有验证步骤失败 → badge 从 ⚪ 变为 🟡（不卡死）

6. **离线队列**：
   - 离线时验证入队
   - 联网后自动重试（监听 statusChange 事件）
   - 同一标签不重复验证（去重）
   - 验证完成后广播更新整个 staging

7. **RateLimiter**：
   - 批量请求被正确节流
   - 按 baseUrl 维度隔离

### 10.2 构建验收

- `npm run build` — TypeScript 无报错
- `tsc --noEmit` 类型检查通过
- 17 个源文件全部存在且可正常 import

### 10.3 集成验收

- 配置 Generation + Verification API Key 后，对一篇笔记执行完整步骤 1 + 步骤 2
- 返回经 AIResponseValidator 校验后的结构化标签映射
- taxonomy 新词自动走验证管线，badge 从 ⚪ 异步更新为 🔵 / 🟡
- 每个标签完成后 `tagVerified` 事件正确触发
- 无 API Key 时 `isFullyOnline()` 返回 `false`，tooltip 显示未配置提示

### 10.4 事件订阅契约

本模块发射的事件，下游模块会订阅：

| 发布者 | 事件 | 数据 | 订阅者 |
|--------|------|------|--------|
| `HealthChecker` (×4) | `statusChange` | `HealthStatus` | `NetworkStatusAggregator` |
| `NetworkStatusAggregator` | `statusChange` | （无参数） | `NetworkIndicator`（M6）、`VerificationQueueManager`（M4） |
| `VerificationPipeline` | `tagVerified` | `{ label, badge, notePath, type, facet }` | `TagReviewView/AI 模式`（M6）→ 刷新圆点 + 启用按钮 |
