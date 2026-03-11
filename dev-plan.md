# The Only One Tagger — 开发计划

> 经过充分讨论后形成的架构思路与开发总体计划。不含具体代码实现，但包含完整的数据存储格式定义。

---

## 一、项目背景与目标

### 核心需求

为 Obsidian 构建一个 AI 驱动的"标签管家"插件，目标是将整个知识库（当前约 400 篇原子笔记，未来持续增长）用一套严谨、一致、可维护的标签体系覆盖，最终实现：

- **覆盖人生全部业务**：学术研究、项目复现、课程学习、人际关系、日记、自我成长等 12 种笔记类型
- **AI 辅助打标，人工确认**：AI 识别内容并从标签库中选择/生成标签，用户审核后写入
- **标签验证，拒绝杜撰**：新标签必须经过权威来源（Wikipedia/Google Scholar/AI 搜索）认证后才能入库
- **标签系统有序管理**：标签之间有上下位关系，不重复，不蔓延

### 插件信息

| 字段 | 值 |
|------|-----|
| 插件 ID | `the-only-one-tagger` |
| 插件名称 | The Only One Tagger |
| 最低 Obsidian 版本 | 0.15.0 |
| 桌面端专属 | 是（isDesktopOnly: true） |

---

## 二、核心架构决策

### 2.1 分面分类法（Faceted Classification）

**决策**：采用分面分类，而非单一层级树。

**理由**：层级树强迫每篇笔记只能归入一个类别（"这是学术还是项目？"），而分面分类允许同时标注多个正交维度，类似线性代数的正交基——每个维度独立，互不干扰。

图书馆学的 PMEST 框架（个体-材料-能量-空间-时间）和 ACM 计算分类系统都采用此思路。

```
笔记类型（type）→ 决定必须有哪些 facet
facet 值        → 来自受控词表（标签库）
多个 facet      → 独立正交，可同时标注
```

### 2.2 存储格式：YAML 为主，行内标签为辅

**决策**：

| 用途 | 存储位置 |
|------|---------|
| 结构化分类（业务类型、领域、方法） | YAML frontmatter（主力） |
| 快速状态标记（待办、待审） | 行内标签 `#todo` `#review` |
| 可查询元数据（日期、评分、状态） | YAML frontmatter |
| 文中语境标注 | 行内标签 |
| Dataview 查询 | YAML（更强大） |
| Graph view 可视化 | 行内标签（更好） |

**理由**：
- YAML 天生支持键值对和嵌套，程序化操作可靠
- 行内标签保留给用户手动的、临时的、语境性标注
- 两者通过插件统一管理，互不冲突

### 2.3 Schema 驱动的"决策树"标签流程

笔记类型（type）作为决策树的根节点，决定该笔记**必须**填写哪些 facet（required），**可以**填写哪些 facet（optional）。

```
识别 type → 加载对应 schema → AI 填充各 facet → 查本地标签库 → 在线验证新标签
```

### 2.4 三级标签验证管线

```
AI 提取候选标签
      │
  本地标签库 ────命中────→ 直接使用 ✅
      │未命中
  Wikipedia API ──命中──→ 规范化标签名，入库 ✅
      │未命中
  AI + 联网搜索 ──确认──→ 入库，标记 verified ✅
      │存疑
  标记 needs_review ──→ 等用户确认 ⚠️
```

**为什么 Wikipedia 作为第二级**：
- 完全免费，无速率限制
- 90% 的学术术语都有词条
- Wikipedia 词条标题即学术界"规范名"，比 AI 生成的更权威
- 中国大陆被墙时，直接跳到第三级（Qwen/Kimi 有内置搜索）

### 2.5 分层 AI 后端

| 用途 | 推荐服务 | 理由 |
|------|---------|------|
| 标签生成（量大） | DeepSeek | 最便宜，$0.28/$0.42/1M token |
| 标签验证（国内，需搜索） | Qwen 通义千问 / Kimi 月之暗面 | 内置联网搜索，返回来源 URL |
| 标签验证（国外，需搜索） | Perplexity Sonar | 原生搜索，免费引用 |

> **注意**：DeepSeek API 不含内置搜索，仅适合生成，不适合验证。

### 2.6 数据存储位置

所有插件数据存储在 Obsidian 插件目录内，不污染用户的笔记空间：

```
.obsidian/plugins/the-only-one-tagger/
  ├── main.js                 # 编译后的插件代码
  ├── manifest.json           # 插件元数据
  ├── styles.css              # 样式
  ├── data.json               # 用户设置（saveData() 自动写入）
  ├── tag-schema.json         # 标签决策树 schema
  ├── tag-registry.json       # 标签库
  └── verification-queue.json # 待验证队列（离线缓存）
```

> **技术说明**：使用 `this.manifest.dir` 获取插件目录路径，`app.vault.adapter.read/write` 操作文件，`normalizePath()` 保证跨平台兼容。Obsidian Sync 会同步 `.obsidian/` 下的内容，跨设备无需额外处理。

### 2.7 标签冲突处理

AI 建议的标签与笔记现有标签不一致时，采用**右侧边栏 diff 展示**方式：

```
┌─────────────────────────────┐
│  AI Tag Review              │
│  ─────────────────────────  │
│  当前标签     AI 建议        │
│  area: [NLP] area: [NLP,    │
│              attention]     │
│              method:        │
│              [transformer]  │
│  [✅ 全部接受] [逐条审核]    │
│  [❌ 拒绝]                  │
└─────────────────────────────┘
```

使用 Obsidian 的 `ItemView`（右侧边栏面板），而非阻塞式 Modal，原因是用户需要同时看到笔记内容和建议标签。

### 2.8 离线模式

API 不可用时：
- 仅从本地标签库匹配，不生成新标签
- 新生成的待验证标签缓存到 `verification-queue.json`
- 联网恢复后批量验证队列

---

## 三、数据存储格式定义

### 3.1 tag-schema.json（决策树 Schema）

定义每种笔记类型必须/可以标注的 facet，以及每个 facet 的值类型和验证要求。

```json
{
  "version": 1,
  "note_types": {
    "academic": {
      "label": "学术研究",
      "required_facets": ["area", "genre", "lang"],
      "optional_facets": [
        "method", "algorithm", "concept", "dataset",
        "problem", "software", "programming-language",
        "scholar", "venue"
      ],
      "validation": "strict"
    },
    "project": {
      "label": "项目/复现",
      "required_facets": ["domain", "status", "tech-stack"],
      "optional_facets": [
        "programming-language", "software",
        "collaborator", "source-repo"
      ],
      "validation": "strict"
    },
    "course": {
      "label": "课程学习",
      "required_facets": ["domain", "source", "instructor"],
      "optional_facets": ["concept", "method", "platform"],
      "validation": "moderate"
    },
    "journal": {
      "label": "日记",
      "required_facets": ["mood"],
      "optional_facets": ["people", "location", "event-type", "reflection-topic"],
      "validation": "loose"
    },
    "growth": {
      "label": "自我成长",
      "required_facets": ["growth-area"],
      "optional_facets": ["method", "trigger", "insight-type"],
      "validation": "loose"
    },
    "relationship": {
      "label": "人际关系",
      "required_facets": ["person", "relation-type"],
      "optional_facets": ["affiliation", "domain", "interaction-type"],
      "validation": "moderate"
    },
    "meeting": {
      "label": "会议/社交",
      "required_facets": ["participants", "meeting-type"],
      "optional_facets": ["project", "action-items", "location"],
      "validation": "loose"
    },
    "finance": {
      "label": "财务",
      "required_facets": ["finance-type", "amount-range"],
      "optional_facets": ["category", "recurring"],
      "validation": "loose"
    },
    "health": {
      "label": "健康",
      "required_facets": ["health-area"],
      "optional_facets": ["metric", "provider", "condition"],
      "validation": "moderate"
    },
    "career": {
      "label": "职业发展",
      "required_facets": ["career-aspect"],
      "optional_facets": ["company", "role", "skill", "milestone"],
      "validation": "moderate"
    },
    "creative": {
      "label": "创作",
      "required_facets": ["medium", "status"],
      "optional_facets": ["theme", "audience", "inspiration"],
      "validation": "loose"
    },
    "admin": {
      "label": "行政/生活",
      "required_facets": ["admin-type"],
      "optional_facets": ["deadline", "priority"],
      "validation": "loose"
    }
  },
  "facet_definitions": {
    "area": {
      "description": "研究/知识领域",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "method": {
      "description": "方法论/技术方法",
      "value_type": "taxonomy",
      "allow_multiple": true,
      "verification_required": true
    },
    "genre": {
      "description": "内容类型",
      "value_type": "enum",
      "values": ["paper", "textbook", "tutorial", "lecture-note", "blog", "documentation", "thesis"],
      "allow_multiple": false,
      "verification_required": false
    },
    "lang": {
      "description": "语言",
      "value_type": "enum",
      "values": ["en", "zh", "ja", "de", "fr", "ko"],
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
    }
  },
  "validation_levels": {
    "strict": "所有 taxonomy 类标签必须经过在线验证",
    "moderate": "优先匹配本地标签库，新标签建议验证",
    "loose": "允许 AI 自由生成，仅去重检查"
  }
}
```

### 3.2 tag-registry.json（标签库）

采用 SKOS（Simple Knowledge Organization System）风格，记录标签间的上位/下位/相关关系，形成轻量级知识图谱。

```json
{
  "meta": {
    "version": 1,
    "last_updated": "2026-03-11",
    "total_tags": 156
  },
  "tags": {
    "transformer": {
      "label": "transformer",
      "aliases": ["Transformer模型", "Transformer架构"],
      "facet": "method",
      "status": "verified",
      "relations": {
        "broader": ["neural-network-architecture"],
        "narrower": ["vision-transformer", "GPT", "BERT"],
        "related": ["self-attention", "sequence-to-sequence"]
      },
      "source": {
        "verified_by": "wikipedia",
        "url": "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)",
        "verified_at": "2026-03-11"
      }
    },
    "computer-vision": {
      "label": "computer-vision",
      "aliases": ["计算机视觉", "CV"],
      "facet": "area",
      "status": "verified",
      "relations": {
        "broader": ["artificial-intelligence"],
        "narrower": ["object-detection", "image-segmentation", "image-classification"],
        "related": ["deep-learning", "convolutional-neural-network"]
      },
      "source": {
        "verified_by": "wikipedia",
        "url": "https://en.wikipedia.org/wiki/Computer_vision",
        "verified_at": "2026-03-11"
      }
    }
  }
}
```

**标签状态枚举**：

| status | 含义 |
|--------|------|
| `verified` | 已通过权威来源确认 |
| `pending` | 待验证（AI 生成但未确认） |
| `needs_review` | 验证存疑，需人工确认 |
| `rejected` | 已拒绝的标签 |

**来源类型**：

| verified_by | 含义 |
|-------------|------|
| `seed` | 预置种子标签（ACM CCS 等） |
| `wikipedia` | Wikipedia API 确认 |
| `ai_search` | AI 联网搜索确认（Qwen/Kimi/Perplexity） |
| `manual` | 用户手动添加并确认 |

### 3.3 笔记 YAML frontmatter（最终写入格式）

**学术笔记示例**：

```yaml
---
type: academic
academic:
  area: [attention-mechanism, natural-language-processing]
  method: [transformer, self-attention]
  genre: paper
  lang: en
  problem: [machine-translation, sequence-modeling]
  scholar: ["[[Vaswani-A]]", "[[Shazeer-N]]"]
  venue: NeurIPS-2017
  software: [TensorFlow]
  programming-language: [Python]
_tag_status: confirmed
_tag_version: 1
_tagged_at: 2026-03-11
---
```

**日记示例**：

```yaml
---
type: journal
journal:
  mood: good
  people: ["[[Alice]]", "[[Bob]]"]
  location: 咖啡厅
  event-type: social
_tag_status: confirmed
_tag_version: 1
_tagged_at: 2026-03-11
---
```

**元字段说明**：

| 字段 | 值 | 含义 |
|------|----|------|
| `_tag_status` | `pending` / `confirmed` / `rejected` | 该笔记的标签审核状态 |
| `_tag_version` | 整数 | 标签版本号，每次更新递增 |
| `_tagged_at` | ISO 日期 | 最后打标时间 |

> **关于人物的交叉关系**：`scholar: ["[[Vaswani-A]]"]` 中的 `[[wikilink]]` 直接链接到人物笔记，Dataview 和 Graph view 可自动聚合某学者的所有相关论文/项目/会议记录。

### 3.4 verification-queue.json（离线验证队列）

```json
{
  "queue": [
    {
      "id": "q_001",
      "tag_label": "flash-attention",
      "facet": "method",
      "suggested_by": "ai",
      "source_note": "path/to/note.md",
      "queued_at": "2026-03-11T10:30:00Z",
      "attempts": 0
    }
  ]
}
```

### 3.5 data.json（用户设置，通过 saveData() 管理）

```json
{
  "generation_provider": "deepseek",
  "generation_api_key": "",
  "generation_model": "deepseek-chat",
  "generation_base_url": "https://api.deepseek.com/v1",

  "verification_provider": "qwen",
  "verification_api_key": "",
  "verification_model": "qwen-plus",

  "use_wikipedia": false,
  "wikipedia_lang": "en",

  "validation_mode": "mixed",
  "auto_accept_threshold": 0.9,
  "max_tags_per_facet": 5,

  "batch_concurrency": 1,
  "request_timeout_ms": 30000,
  "offline_mode": false
}
```

---

## 四、标签冷启动策略

一开始标签库为空，采用 A+B 合并方案：

**方案 A（预置种子）**：内置约 80 个来自 ACM CCS（ACM 计算分类系统）的学术标签，均预标记 `status: verified, verified_by: seed`。覆盖：
- 计算机科学主要领域（AI、CV、NLP、SE、Systems...）
- 常见方法（deep-learning、transformer、reinforcement-learning...）
- 常见工具（PyTorch、TensorFlow、Docker...）

**方案 B（扫描已有笔记）**：插件首次加载时扫描现有 400 篇笔记，提取已有的标签和 frontmatter 字段，作为补充种子，标记 `verified_by: auto-extract, status: pending`。

**B 方案提取的标签仍需验证**：即便是用户自己写的标签，也需要走验证流程后才能变为 `verified`，保证标签库的严谨性。

---

## 五、开发阶段规划

### Phase 1：项目骨架 + 数据结构

**目标**：可编译的插件骨架，能加载/保存 schema 和 registry，有完整的设置界面。无 AI 调用。

| 文件 | 职责 |
|------|------|
| `manifest.json` / `package.json` / `tsconfig.json` / `esbuild.config.mjs` | 构建配置（参考 obsidian-sample-plugin） |
| `src/types.ts` | 所有 TypeScript 接口定义 |
| `src/constants.ts` | 视图 ID、文件名、默认值常量 |
| `src/settings.ts` | 插件设置接口 + 设置面板 UI |
| `src/storage/schema-store.ts` | tag-schema.json 的加载/保存 |
| `src/storage/registry-store.ts` | tag-registry.json 的加载/保存 |
| `src/seed/seed-schema.ts` | 默认 schema（12 种笔记类型） |
| `src/seed/seed-registry.ts` | ~80 个 ACM CCS 种子标签 |
| `src/main.ts` | 最简插件主类 |

**验收标准**：
- `npm run build` 无报错
- 插件在 Obsidian 中启用，设置面板正常渲染
- `tag-schema.json` 和 `tag-registry.json` 在首次加载后自动创建
- 重新加载插件后数据持久

---

### Phase 2：单篇笔记 AI 打标 + 审核 UI

**目标**：对当前打开的笔记调用 AI 生成标签建议，在右侧边栏审核，接受后写入 frontmatter。

| 文件 | 职责 |
|------|------|
| `src/utils/http.ts` | 封装 Obsidian 的 `requestUrl` |
| `src/ai/ai-service.ts` | AI 服务抽象接口 + 工厂函数 |
| `src/ai/providers/openai-compatible.ts` | 基类（所有提供商共用 OpenAI 格式） |
| `src/ai/providers/deepseek.ts` 等 | 各提供商配置 |
| `src/ai/prompts.ts` | 提示词模板（librarian-taxonomist 角色） |
| `src/tagging/frontmatter-reader.ts` | 读取笔记当前 YAML 标签 |
| `src/tagging/tag-applicator.ts` | 通过 `processFrontMatter` 写入标签 |
| `src/tagging/tag-matcher.ts` | 模糊匹配本地标签库 |
| `src/ui/tag-review-view.ts` | 右侧边栏 ItemView |
| `src/ui/tag-review-renderer.ts` | Diff 展示渲染器 |
| `src/ui/components.ts` | 公共 UI 组件（tag chip、置信度徽章） |
| `src/utils/normalization.ts` | 标签字符串规范化（lowercase-hyphenated） |

**关键设计**：
- AI 提示词包含当前笔记类型的 schema facets + 已有标签库中的相关标签，引导 AI 优先从现有词表中选
- 所有提供商继承同一基类（DeepSeek/Qwen/Kimi/Perplexity 都兼容 OpenAI chat 格式）
- 新生成的标签自动加入 registry，初始状态为 `pending`

**验收标准**：
- Ribbon 图标点击打开右侧边栏
- 命令面板"分析当前笔记"可用
- API 调用成功，建议标签带置信度显示
- 逐条接受/拒绝功能正常
- "应用"后 frontmatter 写入正确
- 缺少 API Key 时给出友好错误提示

---

### Phase 3：标签验证管线

**目标**：对 pending 标签走三级验证，更新标签状态，UI 展示验证徽章。

| 文件 | 职责 |
|------|------|
| `src/verification/wikipedia-client.ts` | Wikipedia REST API 封装 |
| `src/verification/ai-verifier.ts` | AI + 联网搜索验证 |
| `src/verification/verification-pipeline.ts` | 三级编排器 |
| `src/verification/verification-queue.ts` | 离线队列管理 |
| `src/storage/queue-store.ts` | 队列文件持久化 |

**中国大陆适配**：设置项 `use_wikipedia: boolean`，关闭后跳过第二级，直接用 Qwen/Kimi 验证。

**验收标准**：
- 已知标签跳过 API 调用
- Wikipedia 返回正确的规范标签名
- AI 联网验证对冷门术语有效
- 离线状态下队列正常缓存，联网后批量消化
- UI 正确显示验证徽章（绿/黄/红）

---

### Phase 4：批量回溯处理

**目标**：对全库 400+ 笔记批量打标，带进度显示和人工审核队列。

| 文件 | 职责 |
|------|------|
| `src/batch/vault-scanner.ts` | 枚举 markdown 文件，按文件夹/状态过滤 |
| `src/batch/batch-processor.ts` | 队列式顺序处理，发出进度事件 |
| `src/batch/batch-state.ts` | 批处理任务状态持久化（支持跨重启恢复） |
| `src/ai/rate-limiter.ts` | Token Bucket 速率限制 |
| `src/ui/batch-modal.ts` | 批量审核 Modal |

**批量审核 Modal 功能**：
- 进度条（暂停/恢复/终止）
- 上一篇/下一篇导航
- 逐标签接受/拒绝
- 自动接受阈值滑块（置信度 > X 自动通过）
- "应用所有已审核"批量提交

**验收标准**：
- 扫描器枚举正确的文件集合
- 进度实时更新
- 暂停/恢复/终止正常
- 单文件报错不中断整个批次
- 跨重启后可从上次进度继续

---

### Phase 5：标签库管理 UI

**目标**：提供标签库的浏览、编辑、合并、导入/导出界面。

| 文件 | 职责 |
|------|------|
| `src/ui/tag-browser-modal.ts` | 标签库浏览器（搜索、过滤、列表） |
| `src/ui/tag-relationship-editor.ts` | 编辑 broader/narrower/related/aliases |

**功能列表**：
- 按 label、alias、ID 搜索
- 按 facet、status、笔记类型过滤
- 标签合并（重写全库 frontmatter + 合并关系）
- 导入/导出 JSON
- 统计面板（总数、已验证/待验证、使用频率、孤立标签）

**验收标准**：
- 浏览器正确显示所有标签
- 按 alias 搜索命中
- 合并操作更新所有受影响文件
- 导出后导入数据完整

---

## 六、横切关注点

### 技术约束

| 约束 | 原因 |
|------|------|
| 零运行时依赖（仅 obsidian） | 避免 node_modules 体积膨胀；`requestUrl` 替代 `fetch`/`axios` |
| 所有 CSS 使用 `.atw-` 前缀 | 避免与其他插件样式冲突 |
| 使用 `processFrontMatter` 写入 YAML | 官方 API，避免直接字符串操作 YAML 带来的格式破坏 |
| 使用 `adapter.read/write` 操作插件数据文件 | 不让插件数据文件出现在用户笔记列表 |
| AI 服务懒初始化 | 插件加载时不创建 AI 实例，首次调用时才初始化 |

### 每阶段验收流程

1. `npm run build` — TypeScript 无报错
2. 手动复制 `main.js`、`manifest.json`、`styles.css` 到 `.obsidian/plugins/the-only-one-tagger/`
3. 在 Obsidian 中启用插件，检查控制台无报错
4. 执行本阶段的功能测试清单
5. 检查 `.obsidian/plugins/the-only-one-tagger/` 下的数据文件格式正确

---

## 七、关键参考资料

| 资源 | 用途 |
|------|------|
| `D:\Vault-4\Projects\obsidian-sample-plugin` | 构建配置参考（esbuild、tsconfig、eslint） |
| `D:\Vault-4\Projects\tag-wrangler` | YAML 处理参考（CST 无损编辑）、Obsidian API 用法 |
| ACM Computing Classification System | 学术标签种子来源 |
| W3C SKOS 规范 | 标签关系（broader/narrower/related）设计依据 |
| Wikipedia REST API | `https://en.wikipedia.org/w/api.php` |

---

---

## 八、第一轮实现复盘（2026-03-11）

> 第一轮实现后发现的缺陷，作为重新开发的补充需求。

### 8.1 严重：验证管线未接入标签生成主流程

代码存在但从未被调用。AI 建议新标签后直接以 `pending` 入库，跳过了 §2.4 的三级验证。必须在展示给用户前实时走 Tier 1→2→3 验证。

### 8.2 严重：Accept 不更新 registry

点 ✓ 只在内存中标记状态，不更新标签库。用户确认的标签应同时在 registry 标记为 `verified`（`verified_by: 'manual'`）。

### 8.3 中等：冷启动扫描无过滤

把所有 inline tag 不加过滤地塞入 registry，且全部默认 `facet: 'area'`。已移除，后续如恢复需加过滤规则。

### 8.4 UI：Tag chip 应可编辑

已改为 `<input>`，保留。

### 8.5 UI：Analyze 命令在侧边栏焦点时消失

`checkCallback` 应改用 `getActiveFile()` 检测。

### 8.6 架构备忘：混合模式的正确理解

§2.2 "YAML 为主，行内标签为辅"指的是**分工**，不是重复写入：
- YAML：插件管理的结构化 facet 标签
- 行内标签/tags 字段：用户手动的状态标记（`#todo`、`#review`），插件不管

*文档版本：1.1 | 日期：2026-03-11 | 状态：准备重新开发*
