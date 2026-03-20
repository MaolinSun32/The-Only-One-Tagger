# The Only One Tagger — 学习计划

> 这是一份从零理解整个项目的渐进式学习路线。
> 项目是一个 **Obsidian 插件**，用 AI 实现 faceted（分面）标签管理系统。
> 全部用 TypeScript 编写，esbuild 打包，Vitest 测试。

---

## 项目全貌速览

```
┌─────────────────────────────────────────────────────────────┐
│                    main.ts (插件入口)                         │
│     加载设置 → 初始化 8 个模块 → 注册命令 → 启动后台服务          │
└─────────────────────────────────────────────────────────────┘
        │          │          │         │         │
   ┌────┴───┐  ┌───┴───┐  ┌──┴──┐  ┌──┴──┐  ┌──┴──┐
   │Storage │  │Engine │  │ AI  │  │Ops  │  │ UI  │
   │M1/M2   │  │ M3    │  │ M4  │  │ M5  │  │ M6  │
   └────┬───┘  └───┬───┘  └──┬──┘  └──┬──┘  └──┬──┘
        │          │          │        │        │
        └──────────┴──────────┴────────┴────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
           ┌──┴──┐   ┌───┴───┐   ┌───┴──┐
           │Batch│   │Manage │   │Infra │
           │ M7  │   │  M8   │   │网络/锁│
           └─────┘   └───────┘   └──────┘
```

**核心数据流（一句话版）：**
用户打开笔记 → AI 检测笔记类型 → AI 根据 Schema 生成标签 → 验证管线校验 → 用户在侧边栏审核 → 写入 YAML frontmatter + 标签注册表

---

## 阶段 0：环境与工具链（30 分钟）

**目标：** 能跑起来、能改代码、能跑测试。

### 要做的事
1. 阅读 `package.json` — 理解有哪些 scripts（`dev`, `build`, `test`, `test:watch`）
2. 阅读 `esbuild.config.mjs` — 理解打包流程（入口 `src/main.ts` → 输出 `main.js`）
3. 阅读 `tsconfig.json` — 注意 `baseUrl: "src"`, `target: "es6"`, `strict: true`
4. 阅读 `vitest.config.ts` — 注意路径别名 `~ → src/` 和 Obsidian mock
5. 运行 `npm run dev` — 确认 watch 模式正常
6. 运行 `npm run test` — 确认 6 个测试全部通过

### 要理解的概念
- **esbuild**：极快的 JS 打包器，把所有 .ts 文件打包成一个 main.js
- **Obsidian 插件加载机制**：Obsidian 读取 `manifest.json` + `main.js`，调用 `onload()`

### 阅读文件
| 文件 | 重点 |
|------|------|
| `package.json` | scripts, dependencies |
| `esbuild.config.mjs` | 入口、外部依赖、dev/prod 模式差异 |
| `tsconfig.json` | 路径映射、编译选项 |
| `vitest.config.ts` | mock 策略 |
| `manifest.json` | 插件元数据 |

---

## 阶段 1：类型系统与常量（1 小时）

**目标：** 建立整个系统的"数据词汇表"，后续所有模块都依赖这里定义的类型。

### 要做的事
1. **通读 `src/types.ts`** — 这是整个项目最重要的文件之一
2. 阅读 `src/constants.ts` — 文件名常量、笔记类型列表、插件字段名

### 核心概念图谱

```
Schema（模式）
├── note_types: Record<string, NoteTypeSchema>    ← 12 种笔记类型
│   ├── required_facets: string[]                 ← 必填维度
│   └── optional_facets: string[]                 ← 可选维度
└── facet_definitions: Record<string, FacetDefinition>  ← 40+ 个维度定义
    ├── value_type: 'taxonomy' | 'enum' | 'wikilink' | 'free-text' | 'date'
    ├── allow_multiple: boolean
    └── verification_required: boolean

Registry（注册表）
└── tags: Record<string, TagEntry>
    ├── label, aliases, facets, status
    ├── relations: { broader, narrower, related }  ← SKOS 风格
    └── source: { created_by, verified_by }

Staging（暂存区）
└── notes: Record<path, StagingNote>
    └── types: Record<type, Record<facet, StagingTagItem[]>>
        └── { label, badge, user_status, ai_recommended }
```

### 练习
- 画出 `Schema → NoteTypeSchema → FacetDefinition` 的关系图
- 列出 5 种 `ValueType` 分别对应什么场景（比如 `taxonomy` = 可自由创建的分类词，`enum` = 固定选项）
- 理解 `BadgeType` 的 8 种值分别代表什么状态

---

## 阶段 2：存储层 — DataStore 模式（1 小时）

**目标：** 理解所有持久化数据如何读写，这是整个系统的"地基"。

### 核心文件
| 文件 | 作用 |
|------|------|
| `src/storage/data-store.ts` | **泛型基类** — Promise 链式写入队列 |
| `src/storage/schema-store.ts` | Schema 的持久化封装 |
| `src/storage/registry-store.ts` | 标签注册表（12+ 个查询/修改方法） |
| `src/storage/staging-store.ts` | 暂存区（待审核的标签） |
| `src/storage/queue-store.ts` | 验证队列 |
| `src/storage/batch-state-store.ts` | 批处理状态 |
| `src/storage/backup-manager.ts` | 变更前自动备份 |

### 阅读顺序
1. **先读 `data-store.ts`** — 这是最核心的抽象
2. 然后读 `schema-store.ts`（最简单的子类）
3. 再读 `registry-store.ts`（方法最多，理解标签 CRUD）
4. 最后读 `staging-store.ts`（理解暂存区生命周期）

### 关键设计模式

```typescript
// Promise 链式写入队列 — 保证并发安全
class DataStore<T> {
  private writeQueue: Promise<void> = Promise.resolve();

  async update(mutator: (data: T) => void): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const data = await this.load();
      mutator(data);           // 原地修改
      await this.save(data);   // 写回文件
      this.emit('change');     // 通知订阅者
    });
    return this.writeQueue;
  }
}
```

**为什么这样设计？** Obsidian 插件中多个操作可能同时触发写入（用户点击、后台验证、批处理），Promise 链保证所有写入严格串行，不会互相覆盖。

### 练习
- 阅读 `data-store.ts`，理解 `writeQueue` 如何将并发写入串行化
- 在 `registry-store.ts` 中找到 `addTag()`, `rejectTag()`, `expandFacets()` 三个方法，理解它们各自做了什么
- 理解 `staging-store.ts` 中 `writeNoteResult()` 和 `cleanupProcessedTags()` 的区别

---

## 阶段 3：引擎层 — Schema 解析与标签匹配（1.5 小时）

**目标：** 理解标签的规范化、匹配和 Schema 查询逻辑。这是纯逻辑层，无副作用，最适合通过测试来学习。

### 核心文件（按阅读顺序）
| 文件 | 作用 | 测试文件 |
|------|------|----------|
| `src/engine/tag-normalizer.ts` | CamelCase → kebab-case 转换 | `tests/engine/tag-normalizer.test.ts` |
| `src/engine/schema-resolver.ts` | Schema 查询接口 | `tests/engine/schema-resolver.test.ts` |
| `src/engine/tag-matcher.ts` | 注册表标签匹配（精确+别名） | `tests/engine/tag-matcher.test.ts` |
| `src/engine/content-hasher.ts` | SHA-256 内容哈希 | `tests/engine/content-hasher.test.ts` |
| `src/engine/frontmatter-service.ts` | YAML 读写 | `tests/engine/frontmatter-service.test.ts` |
| `src/engine/prompt-filter-builder.ts` | 候选标签过滤 | `tests/engine/prompt-filter-builder.test.ts` |

### 学习策略：测试驱动理解
**最佳学习方式：先读测试，再读源码。**

```bash
# 每次专注一个模块
npm run test -- --reporter=verbose tests/engine/tag-normalizer.test.ts
```

1. 打开测试文件，看每个 `it()` / `test()` 的描述
2. 理解输入 → 预期输出
3. 再去源码中追踪实现

### 关键算法

**TagNormalizer 的转换规则：**
```
"MachineLearning"  → "machine-learning"   (CamelCase 拆分)
"deep_learning"    → "deep-learning"       (下划线转连字符)
"  HELLO WORLD  "  → "hello-world"         (trim + 空格转连字符)
"机器学习"          → "机器学习"             (CJK 保留原样)
```

**TagMatcher 的两步查找：**
```
输入: "ML"
Step 1: registryStore.getTag("ml") → 精确匹配
Step 2: registryStore.findByAlias("ml") → 扫描所有 tag 的 aliases 数组
结果: 找到 "machine-learning" (aliases: ["ml", "ML"])
```

### 练习
- 运行所有引擎测试，确保全部通过
- 给 `tag-normalizer.test.ts` 添加一个新的测试用例（比如混合 CJK 和 ASCII 的情况）
- 阅读 `frontmatter-service.ts`，理解"扁平格式"和"嵌套遗留格式"的区别

---

## 阶段 4：AI 与网络层（2 小时）

**目标：** 理解 AI 如何生成标签、如何验证标签、网络健康检查如何工作。

### 先理解网络基础设施
| 文件 | 作用 |
|------|------|
| `src/network/http-client.ts` | `requestUrl` 封装（超时、错误处理） |
| `src/network/health-checker.ts` | 后台心跳检测 |
| `src/network/network-status-aggregator.ts` | 聚合 4 个服务的在线状态 |

### 再理解 AI 提供者
| 文件 | 作用 |
|------|------|
| `src/ai/openai-compatible.ts` | **核心** — OpenAI 兼容 API 调用 |
| `src/ai/prompt-assembler.ts` | 提示词构建（Step 1 类型检测 + Step 2 标签生成） |
| `src/ai/generation-provider.ts` | 生成 AI 接口 |
| `src/ai/verification-provider.ts` | 验证 AI 接口 |
| `src/ai/ai-response-validator.ts` | **关键** — AI 输出的 6 步验证 |
| `src/ai/image-extractor.ts` | 提取笔记中的图片发送给多模态 AI |
| `src/ai/rate-limiter.ts` | 令牌桶限流 |

### 关键流程：AI 的"两步法"

```
Step 1: 类型检测
┌──────────────┐     ┌──────┐     ┌──────────────┐
│ 笔记全文内容  │────→│  AI  │────→│ "academic"   │
└──────────────┘     └──────┘     └──────────────┘

Step 2: 标签生成
┌──────────────────────────────┐     ┌──────┐     ┌────────────────────────┐
│ 笔记内容 + Schema + 候选标签  │────→│  AI  │────→│ { domain: [...], ... } │
└──────────────────────────────┘     └──────┘     └────────────────────────┘
```

### AI 输出验证的 6 步管线
```
AI 返回 JSON → ① 过滤未知 facet
             → ② 标准化 taxonomy 标签（TagNormalizer）
             → ③ 注册表匹配（TagMatcher）
             → ④ 枚举值校验
             → ⑤ 单值/多值约束
             → ⑥ 空值过滤
```

### 阅读顺序
1. `http-client.ts` → `health-checker.ts`（理解网络层）
2. `prompt-assembler.ts`（理解发给 AI 的提示词长什么样）
3. `openai-compatible.ts`（理解 API 调用）
4. `ai-response-validator.ts`（理解 6 步验证）
5. `rate-limiter.ts`（理解令牌桶算法）

### 练习
- 在 `prompt-assembler.ts` 中找到 Step 1 和 Step 2 的提示词模板，理解它们的结构
- 在 `ai-response-validator.ts` 中追踪一个 taxonomy 标签从"AI 原始输出"到"验证后标签"的完整路径
- 理解 `rate-limiter.ts` 中的令牌桶算法：`capacity`, `refillRate`, `tokens` 三个参数如何协作

---

## 阶段 5：验证管线（1 小时）

**目标：** 理解标签如何被验证为"真实存在"的概念。

### 核心文件
| 文件 | 作用 |
|------|------|
| `src/verification/verification-pipeline.ts` | **核心** — 两级验证编排 |
| `src/verification/wikipedia-client.ts` | Level 1: Wikipedia API |
| `src/verification/search-client.ts` | Level 2 入口: 搜索适配器 |
| `src/verification/brave-search-adapter.ts` | Brave Search |
| `src/verification/tavily-search-adapter.ts` | Tavily Search |
| `src/verification/ai-verifier.ts` | Level 2: AI 判定搜索结果 |
| `src/verification/verification-queue-manager.ts` | 离线队列 + 重试 |

### 两级验证流程

```
新 taxonomy 标签
     │
     ▼
Level 1: Wikipedia 查询
     │
     ├── 找到 → badge: wiki_verified ✓
     │
     └── 没找到 ↓
              │
              ▼
         Level 2: 搜索 API + AI 判定
              │
              ├── AI 判定为真 → badge: search_verified ✓
              │
              └── AI 判定为假 → badge: needs_review ⚠
```

### 离线队列
```
网络断开时:
  新标签 → verification-queue.json（排队等待）

网络恢复时:
  NetworkStatusAggregator 触发 → 自动处理队列
  每个标签最多重试 3 次
```

### 练习
- 阅读 `verification-pipeline.ts`，画出完整的验证决策树
- 理解 `verification-queue-manager.ts` 的去重逻辑（同一个标签不会重复入队）
- 思考：为什么要分两级？（提示：Wikipedia 免费且快，搜索 API 需要 key 且有配额）

---

## 阶段 6：操作层 — 9 步分析管线（2 小时）

**目标：** 这是整个插件最核心的业务逻辑，串联了前面所有模块。

### 核心文件
| 文件 | 作用 |
|------|------|
| `src/operations/analysis-orchestrator.ts` | **最核心** — 9 步分析管线 |
| `src/operations/tag-operation-executor.ts` | 标签 CRUD + 应用写入 |
| `src/operations/type-operation-executor.ts` | 笔记类型操作 |

### 9 步分析管线详解

```
analyzeNote(file)
│
├── Step 1: AI 检测笔记类型（"academic"）
├── Step 2: Schema 验证（类型存在？）
├── Step 3: 深拷贝 Schema（防止并发污染）
├── Step 4: 构建候选标签集（PromptFilterBuilder）
├── Step 5: 读取现有 YAML frontmatter
├── Step 6: AI 生成标签（Step 2 提示词）
├── Step 7: 验证 AI 输出（6 步验证）
├── Step 8: 三方比较 — AI 输出 vs 现有 YAML
│   ├── AI ∩ YAML → accepted（双方同意）
│   ├── AI - YAML → pending（新建议，待用户决定）
│   └── YAML - AI → accepted, ai_recommended=false（保留人工标注）
├── Step 9: 写入暂存区（StagingStore）
└── Step 10: 后台触发验证（fire-and-forget）
```

### 应用写入流程 (applyAll)

```
用户点击"应用"
│
├── 收集所有 accepted 标签
├── 格式化值（wikilink 加 [[]]，单值转标量）
├── 调用 frontmatterService.write() 写入 YAML
├── 更新注册表（新标签 addTag，已有 expandFacets）
├── 处理替换链（rejectTag）
├── 清理验证队列
└── 清理暂存区（只删 accepted/deleted，pending 保留）
```

### 阅读策略
1. **先读 `analysis-orchestrator.ts`**，逐步标注每一步用了哪个模块
2. 再读 `tag-operation-executor.ts`，重点看 `applyAll()` 方法
3. 最后读 `type-operation-executor.ts`

### 练习
- 在 `analysis-orchestrator.ts` 中，给每一步添加注释标注它调用了哪个模块的哪个方法
- 理解"三方比较"的逻辑：为什么 `YAML - AI` 要保留？（提示：尊重人工标注）
- 追踪 `applyAll()` 中的 `replaces` 处理逻辑

---

## 阶段 7：UI 层（2 小时）

**目标：** 理解侧边栏如何渲染、用户交互如何触发业务逻辑。

### 核心文件
| 文件 | 作用 |
|------|------|
| `src/ui/tag-review-view.ts` | 侧边栏主视图（ItemView 子类） |
| `src/ui/manual-mode-renderer.ts` | 手动模式（无暂存数据时） |
| `src/ui/ai-mode-renderer.ts` | AI 审核模式（有暂存数据时） |
| `src/ui/schema-editor-renderer.ts` | Schema 编辑器 |
| `src/ui/components/facet-section.ts` | 单个 facet 的渲染 |
| `src/ui/components/tag-chip.ts` | 单个标签的交互组件 |

### UI 状态机

```
打开侧边栏
│
├── 没有打开 Markdown 文件 → showNoFile()
├── 文件在批处理队列中 → showBatchWaiting()
├── 暂存区有数据 → AIModeRenderer
└── 暂存区无数据 → ManualModeRenderer
```

### 组件层级

```
TagReviewView (ItemView)
├── Tab: 标签审核
│   ├── ManualModeRenderer
│   │   ├── 当前 YAML 标签展示
│   │   └── "分析" 按钮
│   └── AIModeRenderer
│       ├── NetworkIndicator（网络状态）
│       ├── 内容变更警告横幅
│       ├── FacetSection × N（每个 facet）
│       │   └── TagChip × M（每个标签）
│       │       ├── badge 状态点
│       │       ├── 标签文本
│       │       └── ✓ ✗ ✎ ↻ 按钮
│       └── Footer: 全部接受 / 全部删除 / 应用
└── Tab: 标签模式
    └── SchemaEditorRenderer
```

### Obsidian UI 开发要点
- **没有 React/Vue** — 全部是 `createEl()` / `createDiv()` 命令式 DOM 操作
- **事件驱动更新** — 订阅 `staging.on('change')` 和 `verificationPipeline.on('tagVerified')`
- **局部更新优化** — 验证完成时只更新对应 TagChip 的 badge CSS，不重渲染整个视图

### 阅读顺序
1. `tag-review-view.ts` — 理解视图生命周期和状态分发
2. `manual-mode-renderer.ts` — 最简单的渲染器
3. `ai-mode-renderer.ts` — 最复杂的渲染器（重点）
4. `components/facet-section.ts` → `components/tag-chip.ts` — 组件细节

### 练习
- 在 `tag-review-view.ts` 中找到 `active-leaf-change` 事件监听，理解侧边栏如何自动刷新
- 在 `tag-chip.ts` 中追踪一个标签从"pending"到"accepted"的 CSS 变化
- 理解 `AIModeRenderer` 中 `suppressNextRefresh` 的作用（提示：防止用户操作后的无意义重渲染）

---

## 阶段 8：批处理与管理（1 小时）

**目标：** 理解如何一次处理整个 vault，以及标签库的高级管理功能。

### 批处理
| 文件 | 作用 |
|------|------|
| `src/batch/batch-processor.ts` | 并发处理引擎（信号量） |
| `src/batch/batch-state-manager.ts` | 状态持久化与恢复 |
| `src/batch/vault-scanner.ts` | 文件枚举与过滤 |

### 管理功能
| 文件 | 作用 |
|------|------|
| `src/management/tag-merger.ts` | 标签合并/删除（全 vault 批量修改） |
| `src/management/bulk-yaml-modifier.ts` | 崩溃恢复机制 |
| `src/management/import-export-manager.ts` | 注册表导入导出 |
| `src/management/relation-discoverer.ts` | AI 关系发现 |

### 关键设计

**信号量控制并发：**
```
batch_concurrency = 3（默认 1）

Semaphore: [slot1] [slot2] [slot3]
           ↓       ↓       ↓
        note1   note2   note3   ← 并行分析
        note4   (等待)  (等待)   ← note1 完成后 note4 进入
```

**崩溃恢复：**
```
合并操作开始 → 写入 merge-state.json（pending_files）
          ↓
    逐个修改 YAML → 移入 completed_files
          ↓
    全部完成 → 修改注册表 → 删除 merge-state.json

启动时检测到 merge-state.json 存在？
  → 自动恢复：只处理 pending_files 中未完成的部分
```

### 练习
- 阅读 `batch-processor.ts` 中的信号量实现
- 理解 `batch-state-manager.ts` 如何记录进度以支持暂停/恢复
- 阅读 `tag-merger.ts` 的崩溃恢复逻辑

---

## 阶段 9：插件入口与模块编排（1 小时）

**目标：** 回到起点，现在你已理解所有模块，重新阅读 `main.ts` 将一切串联。

### 要做的事
1. **重新通读 `src/main.ts`** — 这次你应该能理解每一行在做什么
2. 标注每个模块的初始化顺序和依赖关系
3. 理解命令注册（4 个命令）
4. 理解 `onunload()` 的清理逻辑

### 依赖注入图
```
main.ts 手动构造所有依赖（无 DI 框架）：

settings ──→ stores ──→ engine ──→ network ──→ ai ──→ verification
                                                        ↓
                                              operations ──→ ui ──→ batch ──→ management
```

### 练习
- 画一张完整的模块依赖图
- 找出哪些模块在 `onunload()` 中需要清理
- 思考：为什么不用依赖注入框架？（提示：Obsidian 插件追求简单，67 个文件手动注入完全可控）

---

## 阶段 10：Seed 数据与领域模型（30 分钟）

**目标：** 理解 12 种笔记类型和 40+ 个 facet 的领域设计。

### 核心文件
| 文件 | 作用 |
|------|------|
| `src/seed/seed-schema.ts` | 默认 Schema（12 类型、40+ facet） |
| `src/seed/seed-registry.ts` | 种子标签数据 |
| `src/seed/initializer.ts` | 幂等初始化逻辑 |

### 12 种笔记类型
```
academic   — 学术论文/教材       project    — 项目笔记
course     — 课程笔记            journal    — 日记/随笔
growth     — 个人成长            relationship — 人际关系
meeting    — 会议记录            finance    — 财务相关
health     — 健康记录            career     — 职业发展
creative   — 创意/创作           admin      — 行政管理
```

### 练习
- 通读 `seed-schema.ts`，理解每种类型有哪些 required/optional facets
- 理解 `initializer.ts` 的幂等性：为什么需要幂等？（提示：插件每次启动都会调用）

---

## 推荐学习路线总结

```
                     ┌─────────────┐
                     │  阶段 0      │  环境搭建
                     │  30 min     │
                     └──────┬──────┘
                            │
                     ┌──────▼──────┐
                     │  阶段 1      │  类型系统（types.ts）
                     │  1 hr       │  ← 最重要的基础
                     └──────┬──────┘
                            │
                ┌───────────┼───────────┐
                │                       │
         ┌──────▼──────┐         ┌──────▼──────┐
         │  阶段 2      │         │  阶段 3      │
         │  存储层      │         │  引擎层      │  ← 可以并行学习
         │  1 hr       │         │  1.5 hr     │
         └──────┬──────┘         └──────┬──────┘
                │                       │
                └───────────┬───────────┘
                            │
                ┌───────────┼───────────┐
                │                       │
         ┌──────▼──────┐         ┌──────▼──────┐
         │  阶段 4      │         │  阶段 5      │
         │  AI 层       │         │  验证管线    │  ← 可以并行学习
         │  2 hr       │         │  1 hr       │
         └──────┬──────┘         └──────┬──────┘
                │                       │
                └───────────┬───────────┘
                            │
                     ┌──────▼──────┐
                     │  阶段 6      │  操作层（核心管线）
                     │  2 hr       │  ← 串联所有模块
                     └──────┬──────┘
                            │
                ┌───────────┼───────────┐
                │                       │
         ┌──────▼──────┐         ┌──────▼──────┐
         │  阶段 7      │         │  阶段 8      │
         │  UI 层       │         │  批处理/管理  │  ← 可以并行学习
         │  2 hr       │         │  1 hr       │
         └──────┬──────┘         └──────┬──────┘
                │                       │
                └───────────┬───────────┘
                            │
                     ┌──────▼──────┐
                     │  阶段 9      │  main.ts 全串联
                     │  1 hr       │
                     └──────┬──────┘
                            │
                     ┌──────▼──────┐
                     │  阶段 10     │  领域模型
                     │  30 min     │
                     └──────────────┘

总计: 约 13-14 小时
```

---

## 深入学习建议

### 如果你想深入某个方向

| 方向 | 重点文件 | 学习目标 |
|------|----------|----------|
| AI 提示词工程 | `prompt-assembler.ts`, `ai-response-validator.ts` | 理解如何约束 AI 输出结构化数据 |
| 并发与数据安全 | `data-store.ts`, `batch-processor.ts`, `operation-lock.ts` | 理解 Promise 链、信号量、互斥锁 |
| Obsidian 插件开发 | `main.ts`, `tag-review-view.ts`, `frontmatter-service.ts` | 理解 Obsidian API 的使用模式 |
| 领域驱动设计 | `types.ts`, `seed-schema.ts`, `schema-resolver.ts` | 理解 faceted classification |
| 容错与恢复 | `bulk-yaml-modifier.ts`, `batch-state-manager.ts`, `verification-queue-manager.ts` | 理解崩溃恢复模式 |

### 推荐的实践项目
1. **给一个引擎模块写新测试** — 从 `tag-normalizer.test.ts` 开始，最安全
2. **修改 Seed Schema** — 添加一个新的笔记类型，追踪它如何传播到各模块
3. **添加一个新的验证源** — 比如接入 Wikidata API，实现一个新的 adapter
4. **给 UI 添加一个小功能** — 比如在 TagChip 上显示标签创建时间

---

## 项目架构文档参考

项目包含极其详细的架构文档（AI 生成），可作为深入参考：

| 文件 | 内容 | 行数 |
|------|------|------|
| `dev-plan.md` | 完整架构规格 | 7000+ |
| `update-logs.md` | 5 轮架构审查 | 5000+ |
| `sub-plans/group-1-foundation-storage.md` | 存储层详细设计 | — |
| `sub-plans/group-2-engine.md` | 引擎层详细设计 | — |
| `sub-plans/group-3-network-ai.md` | 网络/AI 层详细设计 | — |
| `sub-plans/group-4-operations.md` | 操作层详细设计 | — |
| `sub-plans/group-5-sidebar-ui.md` | UI 层详细设计 | — |
| `sub-plans/group-6-batch-management.md` | 批处理/管理层详细设计 | — |
