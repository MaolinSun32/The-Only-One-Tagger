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

**Type 检测机制：AI 初判 + 用户可改**

12 种笔记类型：`academic`、`project`、`course`、`journal`、`growth`、`relationship`、`meeting`、`finance`、`health`、`career`、`creative`、`admin`。

**两步 AI 调用**：拆分为 type 识别和 tag 填充两步，减小单次 prompt 上下文，提高模型准确度。

**步骤 1：识别 type**
- 输入：12 种 type 的名称 + 简短描述 + 笔记全文
- 输出：type 名称（单个）
- prompt 约 500-800 token，成本极低

**步骤 2：识别 tags**
- 输入：该 type 的 facet 定义 + 各 facet 对应的标签库子集（硬编码过滤）+ 黑名单 + 笔记全文
- 输出：`{ facet: [tags] }` 映射
- prompt 按需组装，只含相关 facet 的标签

**步骤 3：本地组装**（零成本，硬编码）
- 将 AI 返回的 tags 映射到 type/facet/tags 全链条结构
- 识别哪些是库内标签（🟢）、哪些是新标签需要验证

**Prompt 过滤逻辑**（硬编码，非 AI 完成）：
- 取当前 type 的 schema 中所有 taxonomy 类 facet 名称
- 与 registry 中每个标签的 `facets` 数组取交集
- 交集非空的标签 → 传入 prompt 作为候选词表
- 同时传入该 facet 下的黑名单标签

**多 Type 支持**：

- 默认约束为**一个 type**，步骤 1 仅返回一个
- 用户可在侧边栏手动**修改 type**（重跑步骤 2）
- 用户可手动**增加 type**（如一篇笔记同时是 `academic` + `project`），增加后跳过步骤 1，直接以新 type 为输入执行步骤 2（**完全独立调用，不携带 type1 的任何信息**）
- 用户可**删除 type**，同时移除该 type 下的所有 facet 标签（整块删除，无需检查其他 type）
- YAML 中 `type` 字段为数组格式（单 type 时为单元素数组）
- 多 type 的同名 facet（如两个 type 都有 `programming-language`）**各自独立填写，接受 YAML 重复**，换取删除 type 时的零风险

```
步骤 1 → 识别 type → 步骤 2 → 识别 tags → 步骤 3 → 本地组装
                                   ↓
                        taxonomy 标签并发验证 → 全部进入 staging
                                   ↓
                          展示给用户审核（侧边栏）
                                   ↕
                    用户可修改 type（重跑步骤 2）
                    用户可增加 type（独立执行步骤 2）
                    用户可删除 type（整块移除 facet）
```

### 2.4 三级标签验证管线

```
AI 返回候选 taxonomy 标签（步骤 2 输出）
      │
      ├── 命中本地标签库 ──→ 🟢 库内标签（跳过验证）
      │
      └── 未命中 → 每个标签独立并发验证：
              │
          Wikipedia API ──命中──→ 🔵 已认证（wiki_verified）
              │未命中
          AI + 联网搜索 ──确认──→ 🔵 已认证（search_verified）
              │存疑
          标记 🟡 needs_review ──→ 等用户确认 ⚠️
              │
              └── 所有标签（🟢🔵🟡）全部进入 tag-staging.json
                  等待用户在侧边栏逐条操作
```

**验证并发机制**：
- 每个 taxonomy 标签独立并发走验证管线（不排队）
- `request_timeout_ms`（默认 30000）为单个验证请求的超时
- UI 逐个刷新 badge 颜色（先完成的先显示，不等全部完成）
- 离线时不发起验证，用户手动键入的标签为 🟢（库内）或 🟡（新词，`verified_by: manual`）

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
  ├── main.js                    # 编译后的插件代码
  ├── manifest.json              # 插件元数据
  ├── styles.css                 # 样式
  │
  │  ── 持久化数据文件 ──
  ├── data.json                  # 用户设置（saveData() 自动写入）
  ├── tag-schema.json            # 标签决策树 schema
  ├── tag-registry.json          # 标签库（verified 正式标签 + rejected 黑名单）
  ├── tag-staging.json           # 暂存区：AI 生成的标签等待用户确认（按笔记路径索引）
  ├── verification-queue.json    # 离线验证队列：等待网络恢复后重试的标签
  ├── batch-state.json           # 批量处理进度状态（跨重启恢复）
  │
  │  ── 临时/备份文件 ──
  └── backups/                   # 标签合并操作前的自动备份
      └── tag-registry.backup.<timestamp>.json
```

> **技术说明**：使用 `this.manifest.dir` 获取插件目录路径，`app.vault.adapter.read/write` 操作文件，`normalizePath()` 保证跨平台兼容。Obsidian Sync 会同步 `.obsidian/` 下的内容，跨设备无需额外处理。

### 2.7 标签审核与冲突处理

使用 Obsidian 的 `ItemView`（右侧边栏面板），而非阻塞式 Modal，原因是用户需要同时看到笔记内容和建议标签。

**合并策略**：
- `allow_multiple: true` 的 facet → AI 建议的标签**追加**到现有值（不替换）
- `allow_multiple: false` 的 facet → 如果 AI 建议的值与现有值不同，展示冲突让**用户决定**

**用户操作定义**：

| 操作 | 图标 | 含义 | 行为 |
|------|------|------|------|
| **Accept** | ✓ | 认可这个标签 | 写入 YAML + 入库（根据 badge 不同详见下方） |
| **Delete** | ✗ | 不需要此标签 | 从 staging 移除，不产生任何记录，不入黑名单 |
| **Edit** | ✎ | 手动键入替代词 | 新词替换旧词入库，旧词 → 黑名单（`rejected_in_favor_of`） |
| **Regenerate** | ↻ | 要同义但更好的词 | 展开候选列表，选一个入库，其余 → 黑名单 |

**Regenerate 细则**：
- 针对**单个标签**（不是整个 facet）
- 每次点击在列表中**追加**更多同义候选（不替换已有列表）
- 用户从列表中选一个 → Accept → 入库
- 列表中所有未被选中的词 + 原始词 = 该 accepted 词的黑名单
- **仅适用于**：AI 新生成的标签（🔵 / 🟡 badge），不适用于 🟢 库内标签
- 候选列表**不持久化**（关闭侧边栏后丢失，重新点击重新生成）
- Prompt 约束：regenerate 必须产生同义/近义词，不能产生不同概念的标签

**标签来源 badge**（颜色区分信心级别）：

| Badge | 颜色 | 含义 | Accept 行为 |
|-------|------|------|------------|
| 库内 | 🟢 绿色 | 标签库已有（verified） | 仅写入 frontmatter |
| 已认证 | 🔵 蓝色 | 新生成 + 已通过验证（Wikipedia/AI 搜索） | 写入 + 入库（`verified_by` 取决于验证来源） |
| 待确认 | 🟡 黄色 | 新生成 + 三级验证均未确认 | 写入 + 入库（`verified_by: manual`） |

> **注意**：Badge 是信心级别指示，不是状态。三种 badge 的用户可执行操作完全一致。

**审核粒度**：
- **标签级**：每个 tag chip 可独立 Accept / Delete / Edit
- **Facet 级**：用户可对整个 facet 执行增加标签操作

```
┌─────────────────────────────────────────┐
│  AI Tag Review                          │
│  ───────────────────────────────────    │
│  Type: [academic ▼] [+ 增加 type]      │
│                                         │
│  area:                                  │
│  [NLP 🟢 ✓✗] [attention 🔵 ✓✗✎↻]      │
│  [+ 添加]                               │
│                                         │
│  method:                                │
│  [transformer 🟢 ✓✗] [+ 添加]           │
│                                         │
│  genre: [paper ▼]                       │
│                                         │
│  [✅ 全部接受] [❌ 全部删除]             │
└─────────────────────────────────────────┘
```

> 🟢 库内标签只有 ✓ Accept 和 ✗ Delete 两个操作。🔵🟡 新标签额外有 ✎ Edit 和 ↻ Regenerate。

### 2.8 网络状态检测与离线降级

**网络状态检测**：
- 插件启动时立即 ping 所有已配置的 API（轻量级请求，如 `GET /models`）
- 每 **60 秒** 自动重新检测
- 侧边栏顶部显示状态指示器：🟢 在线 / 🔴 离线
- 单击状态指示器可**手动刷新**网络状态

**离线时**：
- AI 打标功能**完全不可用**（无网络 = 无 AI 生成 = 无验证）
- 点击"分析"按钮弹出提示："当前处于离线状态，无法调用 AI 服务"
- 侧边栏降级为**手动模式**：显示当前笔记的 YAML 标签，用户可从标签库下拉选择或手动键入
- 手动键入的标签：库内已有的为 🟢，用户手动键入的新词为 🟡（`verified_by: manual`）
- 已生成但验证失败的标签保留在 `verification-queue.json`，联网后自动重试

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
      ]
    },
    "project": {
      "label": "项目/复现",
      "required_facets": ["domain", "status", "tech-stack"],
      "optional_facets": [
        "programming-language", "software",
        "collaborator", "source-repo"
      ]
    },
    "course": {
      "label": "课程学习",
      "required_facets": ["domain", "source", "instructor"],
      "optional_facets": ["concept", "method", "platform"]
    },
    "journal": {
      "label": "日记",
      "required_facets": ["mood"],
      "optional_facets": ["people", "location", "event-type", "reflection-topic"]
    },
    "growth": {
      "label": "自我成长",
      "required_facets": ["growth-area"],
      "optional_facets": ["method", "trigger", "insight-type"]
    },
    "relationship": {
      "label": "人际关系",
      "required_facets": ["person", "relation-type"],
      "optional_facets": ["affiliation", "domain", "interaction-type"]
    },
    "meeting": {
      "label": "会议/社交",
      "required_facets": ["participants", "meeting-type"],
      "optional_facets": ["project", "location"]
    },
    "finance": {
      "label": "财务",
      "required_facets": ["finance-type", "amount-range"],
      "optional_facets": ["category", "recurring"]
    },
    "health": {
      "label": "健康",
      "required_facets": ["health-area"],
      "optional_facets": ["metric", "provider", "condition"]
    },
    "career": {
      "label": "职业发展",
      "required_facets": ["career-aspect"],
      "optional_facets": ["company", "role", "skill", "milestone"]
    },
    "creative": {
      "label": "创作",
      "required_facets": ["medium", "status"],
      "optional_facets": ["theme", "audience", "inspiration"]
    },
    "admin": {
      "label": "行政/生活",
      "required_facets": ["admin-type"],
      "optional_facets": ["deadline", "priority"]
    }
  },
  "facet_definitions": {

    "_comment_taxonomy": "taxonomy: 受控词表，需走验证管线（本地标签库 → Wikipedia → AI 搜索）",

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
      "description": "所属领域（比 area 更宽泛，用于非学术笔记）",
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

    "_comment_enum": "enum: 固定值列表，AI 从中选择，不需验证",

    "genre": {
      "description": "内容体裁",
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

    "_comment_wikilink": "wikilink: 链接到库中其他笔记，格式 [[Name]]，不需验证",

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
    "project": {
      "description": "所属项目",
      "value_type": "wikilink",
      "allow_multiple": false,
      "verification_required": false
    },

    "_comment_freetext": "free-text: 自由文本，不需验证，不入标签库",

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

> **只有 `taxonomy` 类型的 facet 值会进入 tag-registry.json 并走验证管线**。所有 taxonomy facet 的 `verification_required` 均为 `true`，三级验证都无法确定的以 🟡 badge 展示，用户 Accept 即 `verified_by: manual`。

### 3.2 tag-registry.json（标签库）

采用 SKOS（Simple Knowledge Organization System）风格，记录标签间的上位/下位/相关关系，形成轻量级知识图谱。

**Registry 只存正式标签（verified）和黑名单标签（rejected）**。待验证/待确认的标签分别在 `verification-queue.json` 和 `tag-staging.json` 中。

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
      "facets": ["method"],
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
    "deep-learning": {
      "label": "deep-learning",
      "aliases": ["深度学习", "DL"],
      "facets": ["area", "method", "domain"],
      "status": "verified",
      "relations": {
        "broader": ["machine-learning"],
        "narrower": ["convolutional-neural-network", "recurrent-neural-network"],
        "related": ["neural-network-architecture", "backpropagation"]
      },
      "source": {
        "verified_by": "wikipedia",
        "url": "https://en.wikipedia.org/wiki/Deep_learning",
        "verified_at": "2026-03-11"
      }
    }
  }
}
```

**关键设计——`facets` 为数组**：

一个标签可以属于多个 facet。例如 "deep-learning" 可以同时是 `area`（研究领域）、`method`（技术方法）、`domain`（所属领域）。

- 新标签首次入库时，`facets` 初始化为当前使用的 facet（如 `["method"]`）
- 每次用户 Accept 一个已有标签到新 facet 时，代码**自动追加**到 `facets` 数组（如 `["method", "domain"]`）
- M8 标签库管理 UI 支持**人工编辑** `facets` 数组
- 构建 AI prompt 时，硬编码过滤逻辑：`当前 type 的 schema facets ∩ 标签的 facets` 取交集，交集非空则发送该标签

**标签状态枚举**：

| status | 含义 | 存在位置 |
|--------|------|---------|
| `verified` | 已入库的正式标签 | registry |
| `rejected` | 黑名单标签 | registry（带 `rejected_in_favor_of`） |

> 注意：`pending`（待网络验证）和 `pending_user`（待用户确认）不在 registry 中，分别存在于 `verification-queue.json` 和 `tag-staging.json`。

**Rejected 标签黑名单机制**：

黑名单标签保留在 registry 中，增加 `rejected_in_favor_of` 字段，指向用户选择的正确标签。AI 生成时 prompt 携带黑名单，避免重复推荐。

```json
"ML": {
  "label": "ML",
  "facets": ["area"],
  "status": "rejected",
  "rejected_in_favor_of": "machine-learning",
  "source": {
    "verified_by": "manual",
    "verified_at": "2026-03-11"
  }
}
```

**黑名单触发场景**（仅以下两种情况产生黑名单）：
1. **Edit**：用户手动键入替代词 → 原标签 `rejected_in_favor_of` 指向新词
2. **Regenerate**：用户从候选列表中选一个 → 其余候选词 + 原始词全部 `rejected_in_favor_of` 指向选中词

> **Delete 操作不产生黑名单**。Delete 表示"用户不需要此标签"，标签从 staging 中移除，不写入 registry。

**来源类型**：

| verified_by | 含义 |
|-------------|------|
| `seed` | 预置种子标签（ACM CCS 等） |
| `wikipedia` | Wikipedia API 确认 |
| `ai_search` | AI 联网搜索确认（Qwen/Kimi/Perplexity） |
| `manual` | 用户手动添加并确认（含三级验证均未确认后用户 Accept 的情况） |

### 3.3 笔记 YAML frontmatter（最终写入格式）

**只有用户确认（Accept）的标签才会写入 YAML frontmatter**。未确认的标签存在 `tag-staging.json` 中，不写入笔记文件。

**单 type 示例（常见情况）**：

```yaml
---
type: [academic]
academic:
  area: [attention-mechanism, natural-language-processing]
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

**多 type 示例（用户手动增加 type，共享 facet 各自独立）**：

```yaml
---
type: [academic, project]
academic:
  area: [attention-mechanism]
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

> 注意：`programming-language` 在 academic 和 project 中各自独立存在（接受重复），删除某个 type 时整块移除即可。

**日记示例**：

```yaml
---
type: [journal]
journal:
  mood: good
  people: ["[[Alice]]", "[[Bob]]"]
  location: 咖啡厅
  event-type: social
_tag_version: 1
_tagged_at: 2026-03-11
---
```

**元字段说明**：

| 字段 | 值 | 含义 |
|------|----|------|
| `_tag_version` | 整数 | 标签版本号，每次用户确认写入时递增 |
| `_tagged_at` | ISO 日期 | 最后打标时间 |

> `_tag_status` 已移除——YAML 中只存在用户确认后的标签，因此状态始终为 confirmed，无需额外字段标记。未确认的标签存在 `tag-staging.json` 中。

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

### 3.5 tag-staging.json（暂存区：等待用户确认的标签）

AI 生成并通过验证的标签，在用户确认前暂存于此文件。按笔记路径索引，支持跨会话持久化。

```json
{
  "notes": {
    "path/to/note.md": {
      "analyzed_at": "2026-03-11T10:30:00Z",
      "types": {
        "academic": {
          "area": [
            {
              "label": "attention-mechanism",
              "badge": "wiki_verified",
              "user_status": "pending"
            },
            {
              "label": "natural-language-processing",
              "badge": "registry",
              "user_status": "pending"
            }
          ],
          "method": [
            {
              "label": "flash-attention",
              "badge": "search_verified",
              "user_status": "pending"
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
| `badge` | 验证来源/信心级别：`registry`（🟢 库内）、`wiki_verified`（🔵 Wikipedia 确认）、`search_verified`（🔵 AI 搜索确认）、`needs_review`（🟡 三级验证均未确认）、`enum`/`wikilink`/`free_text`/`date`（非 taxonomy，无需验证） |
| `user_status` | `pending`（等待操作）/ `accepted`（已接受，待批量写入）/ `deleted`（已删除） |

**生命周期**：
- 用户点"分析"后，AI 结果写入 staging
- 用户逐条 Accept/Delete/Edit 时更新 `user_status`
- 用户点"应用"时，`accepted` 的标签写入 YAML + registry，整条笔记从 staging 中移除
- 用户关闭侧边栏未完成操作 → staging 保留，下次打开时恢复
- Regenerate 候选列表**不存入 staging**（关闭后丢失）

### 3.6 batch-state.json（批量处理进度）

```json
{
  "task_id": "batch_001",
  "started_at": "2026-03-11T10:00:00Z",
  "total_files": 400,
  "processed": 127,
  "pending_review": 15,
  "failed": 2,
  "status": "paused",
  "current_file": "path/to/current-note.md",
  "filter": {
    "folders": ["Academic", "Projects"],
    "skip_tagged": true
  }
}
```

### 3.7 data.json（用户设置，通过 saveData() 管理）

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

  "max_tags_per_facet": 5,

  "batch_concurrency": 1,
  "request_timeout_ms": 30000,
  "ping_interval_ms": 60000
}
```

---

## 四、标签冷启动策略

一开始标签库为空，采用预置种子方案：

**预置种子**：内置约 80 个来自 ACM CCS（ACM 计算分类系统）的学术标签，均预标记 `status: verified, verified_by: seed`。覆盖：
- 计算机科学主要领域（AI、CV、NLP、SE、Systems...）
- 常见方法（deep-learning、transformer、reinforcement-learning...）
- 常见工具（PyTorch、TensorFlow、Docker...）

后续新标签通过 AI 生成 → 三级验证管线逐步扩充标签库。

---

## 五、开发阶段规划

> 全功能分模块开发，按依赖顺序排列。每个模块开发完毕后独立可测试，不存在"先做简版后补全"的情况。模块之间通过 TypeScript 接口解耦，上层模块依赖下层模块的抽象而非实现。

### 模块依赖关系

```
M1 基础设施
 └→ M2 数据持久化
     └→ M3 标签逻辑引擎
         └→ M4 网络/AI/验证
             └→ M5 标签生命周期
                 ├→ M6 侧边栏 UI ──→ M7 批量处理
                 └→ M8 标签库管理

关键路径：M1 → M2 → M3 → M4 → M5 → M6 → M7
可并行：  M7 与 M8 互相独立
```

---

### M1：项目基础设施

**目标**：可编译的插件骨架 + 覆盖全项目的 TypeScript 类型定义 + 完整设置面板。

**关键抽象**：

- **TypeScript 类型系统**（`src/types.ts`）：定义所有数据结构接口——`TagEntry`、`StagingNote`、`StagingTagItem`、`FacetDefinition`、`NoteTypeSchema`、`VerificationResult`、`BatchState` 等。这是全项目的"契约层"，后续模块的函数签名均以此为准。类型定义必须覆盖 §三 中所有 JSON 格式。

- **插件主类**（`src/main.ts`）：`TheOnlyOneTagger extends Plugin`。`onload()` 只做视图注册、命令注册、设置加载；AI 服务等在首次使用时才创建（懒初始化）。主类持有各模块的单例引用，是依赖注入的根节点。

- **设置面板**（`src/settings.ts`）：`TootSettingTab extends PluginSettingTab`。渲染 §3.7 `data.json` 中所有字段的 UI（API 密钥输入、模型选择下拉、Wikipedia 开关等）。此阶段 UI 完整可交互，但 AI 功能不通（无后端服务）。

- **常量**（`src/constants.ts`）：视图 ID（`TOOT_VIEW_TYPE`）、数据文件名（`TAG_SCHEMA_FILE`、`TAG_REGISTRY_FILE` 等）、默认设置值。集中管理避免魔法字符串。

**功能清单**：
- 构建配置：`manifest.json`、`package.json`、`tsconfig.json`、`esbuild.config.mjs`
- `src/types.ts`：所有接口定义
- `src/constants.ts`：视图 ID、文件路径、默认值
- `src/settings.ts`：设置接口 + 设置面板 UI（完整字段）
- `src/main.ts`：插件主类（最简骨架，预留模块挂载点）

**测试策略**：
- `npm run build` 零报错，`tsc --noEmit` 类型检查通过
- 插件在 Obsidian 中启用，设置面板所有字段可见且可编辑
- `data.json` 首次启动后正确创建，重启后设置不丢失

**验收标准**：
- 构建成功，Obsidian 中可加载
- 设置面板渲染完整，修改后持久化
- 类型定义覆盖 §三 中所有数据格式

---

### M2：数据持久化层

**目标**：所有 JSON 数据文件的可靠读写，含种子数据初始化和备份管理。

**依赖**：M1（类型定义、常量）

**关键抽象**：

- **`DataStore<T>` 泛型存储基类**（`src/storage/data-store.ts`）：封装 `adapter.read/write` + JSON 序列化/反序列化 + 文件不存在时的默认值初始化。所有 JSON 数据文件（schema、registry、staging、queue、batch-state）都通过此基类操作，统一错误处理和格式校验。
  - `load(): Promise<T>` — 从磁盘加载 JSON，文件不存在则用默认值创建并写入
  - `save(data: T): Promise<void>` — 序列化写入磁盘
  - `update(mutator: (data: T) => void): Promise<void>` — 原子读-改-写（加载 → 调用 mutator 修改内存对象 → 写回磁盘）
  - 路径通过 `this.manifest.dir` + `normalizePath()` 计算
  - **注意**：`data.json`（用户设置）不使用此基类，由 Obsidian 的 `loadData()`/`saveData()` 管理

- **`RegistryStore extends DataStore<Registry>`**（`src/storage/registry-store.ts`）：在通用存储之上封装标签库业务方法。这些方法是后续模块操作 registry 的唯一入口：
  - `addTag(entry: TagEntry): void` — 新增 verified 标签
  - `rejectTag(label, rejectedInFavorOf): void` — 标记为黑名单
  - `getTag(label): TagEntry | null` — 按 label 查找
  - `getTagsByFacets(facets: string[]): TagEntry[]` — 返回 `facets` 数组与给定 facets 有交集的所有标签（PromptFilterBuilder 的数据源）
  - `getBlacklist(facets: string[]): RejectedTag[]` — 返回指定 facets 下的黑名单标签
  - `expandFacets(label, newFacet): void` — 自动追加 facet 到已有标签的 `facets` 数组

- **`BackupManager`**（`src/storage/backup-manager.ts`）：在破坏性操作（标签合并、批量修改）前创建带时间戳的 JSON 备份到 `backups/` 目录。提供 `createBackup(sourceFile)` 和 `listBackups()` 方法。

- **`SeedInitializer`**（`src/seed/initializer.ts`）：首次启动检测（`tag-schema.json` 不存在），初始化 12 种 type schema + ~80 个 ACM CCS 种子标签。**幂等**——已有数据时不覆盖。

**功能清单**：
- `src/storage/data-store.ts`：泛型基类
- `src/storage/schema-store.ts`：`tag-schema.json` 存储
- `src/storage/registry-store.ts`：`tag-registry.json` 存储 + 业务方法
- `src/storage/staging-store.ts`：`tag-staging.json` 存储
- `src/storage/queue-store.ts`：`verification-queue.json` 存储
- `src/storage/batch-state-store.ts`：`batch-state.json` 存储
- `src/storage/backup-manager.ts`：备份管理
- `src/seed/seed-schema.ts`：默认 schema 定义（§3.1 完整内容）
- `src/seed/seed-registry.ts`：~80 个 ACM CCS 种子标签
- `src/seed/initializer.ts`：首次启动初始化逻辑

**测试策略**：
- 写入后读取，数据一致（roundtrip）
- 文件不存在时自动创建默认值
- 文件内容损坏（非法 JSON）时的错误处理（不崩溃，报告错误并用默认值恢复）
- `RegistryStore.getTagsByFacets(["method"])` 返回种子标签中 facets 含 `"method"` 的全部标签
- `RegistryStore.expandFacets("deep-learning", "domain")` 正确追加
- SeedInitializer 幂等性：首次初始化 → 手动增加标签 → 重启后手动增加的标签不被覆盖
- BackupManager：创建备份后文件可读、内容与源文件一致

**验收标准**：
- 插件首次启动后，`tag-schema.json`（含 12 种 type）和 `tag-registry.json`（含 ~80 种子标签）自动创建
- 重启插件后数据持久
- `RegistryStore` 的所有业务方法行为正确
- 备份目录在触发时正确创建

---

### M3：标签逻辑引擎

**目标**：纯计算逻辑——schema 解析、prompt 过滤、标签匹配、YAML frontmatter 读写。无网络 I/O，高度可测试。

**依赖**：M2（SchemaStore、RegistryStore）

**关键抽象**：

- **`SchemaResolver`**（`src/engine/schema-resolver.ts`）：给定 type 名称，返回完整的 facet 定义集合（required + optional），包括每个 facet 的 `value_type`、`allow_multiple`、`verification_required`、`values`（enum 时）。这是 type→facet "决策树"的运行时查询接口。
  - `resolve(type: string): ResolvedSchema` — 返回该 type 的全部 facet 定义
  - `getAllTypes(): TypeSummary[]` — 返回 12 种 type 的名称 + label + 简短描述（步骤 1 prompt 用）
  - `getTaxonomyFacets(type: string): string[]` — 返回该 type 下所有 `value_type: "taxonomy"` 的 facet 名称

- **`PromptFilterBuilder`**（`src/engine/prompt-filter-builder.ts`）：**§2.3 硬编码过滤逻辑的核心实现**。给定一个 type：
  1. 从 SchemaResolver 取该 type 的所有 taxonomy 类 facet 名称
  2. 从 RegistryStore 中，对每个标签的 `facets[]` 与步骤 1 的 facet 集合取交集
  3. 交集非空的标签 → 构成该 type 的候选标签子集，按 facet 分组
  4. 同时提取该 type 各 facet 的黑名单标签（`status: rejected`）
  - 输出：`{ candidatesByFacet: Map<string, TagEntry[]>, blacklistByFacet: Map<string, string[]> }`
  - 性能说明：registry 规模有限（百级别），无需索引优化

- **`TagNormalizer`**（`src/engine/tag-normalizer.ts`）：将任意格式字符串转为 lowercase-hyphenated 标准形式。处理规则：
  - 空格/下划线 → 连字符
  - CamelCase 拆分（`DeepLearning` → `deep-learning`）
  - 全部小写化
  - 中文字符不变
  - 去除首尾空白和重复连字符

- **`TagMatcher`**（`src/engine/tag-matcher.ts`）：在 registry 中查找匹配标签。匹配优先级：精确匹配 label → 精确匹配 aliases → 规范化后匹配。返回匹配结果含匹配类型（`exact` / `alias` / `normalized`）。

- **`FrontmatterService`**（`src/engine/frontmatter-service.ts`）：封装 Obsidian 的 `processFrontMatter` API，提供结构化读写：
  - `read(file: TFile): TaggedNote` — 提取当前 YAML 中的 type/facet/tag 结构
  - `write(file: TFile, data: TagWriteData): void` — 按 §3.3 格式写入（含 `_tag_version` 递增、`_tagged_at` 更新）
  - `removeTypeBlock(file: TFile, type: string): void` — 删除某 type 及其全部 facet 数据（用于"删除 type"操作）
  - 写入时处理 `allow_multiple` 语义：数组 vs 单值

**功能清单**：
- `src/engine/schema-resolver.ts`
- `src/engine/prompt-filter-builder.ts`
- `src/engine/tag-normalizer.ts`
- `src/engine/tag-matcher.ts`
- `src/engine/frontmatter-service.ts`

**测试策略**：
- SchemaResolver：12 种 type 各返回正确的 facet 集合；`getTaxonomyFacets("academic")` 返回 `["area", "method", "algorithm", ...]`
- PromptFilterBuilder：空 registry → 空候选；单 facet 标签正确过滤；多 facet 标签（如 `"deep-learning"` 属于 `area+method+domain`）在 `academic` 和 `project` type 下都能被选中；黑名单标签不出现在候选中但出现在 blacklist 输出中
- TagNormalizer：`"Deep Learning"` → `"deep-learning"`，`"TensorFlow"` → `"tensorflow"`，`"self attention"` → `"self-attention"`，中文不变
- TagMatcher：精确匹配、alias 匹配（`"DL"` 命中 `deep-learning`）、miss
- FrontmatterService：单 type 写入/读取 roundtrip、多 type 写入/读取 roundtrip、`removeTypeBlock` 后其他 type 不受影响、`_tag_version` 递增正确

**验收标准**：
- 给定 `academic` type + 种子 registry，PromptFilterBuilder 返回所有 facets 含 `area`/`method`/`algorithm` 等的种子标签
- FrontmatterService 写入后，Obsidian 的 YAML 渲染与 §3.3 示例格式一致
- 所有纯计算函数 100% 单元测试覆盖

---

### M4：网络、AI 与验证管线

**目标**：完整的外部 I/O 层——网络状态检测、多 AI 提供商两步调用、三级标签验证管线。

**依赖**：M1（类型）、M2（RegistryStore、QueueStore）、M3（PromptFilterBuilder、TagNormalizer）

**关键抽象**：

- **`NetworkMonitor`**（`src/network/network-monitor.ts`）：管理所有 API 端点在线状态。启动时 ping（轻量 `GET /models` 或 `HEAD` 请求），之后按 `ping_interval_ms`（默认 60s）定时刷新。暴露事件 `on('statusChange', callback)` 供 UI 订阅。提供手动刷新方法供用户点击状态图标时调用。`onunload` 时清除定时器。

- **`HttpClient`**（`src/network/http-client.ts`）：`requestUrl` 的薄封装。统一：
  - 超时处理（`request_timeout_ms`）
  - 错误码规范化（网络不可达 / API 错误 / 超时 → 统一的 `HttpError` 类型）
  - 响应 JSON 解析
  - 所有外部 HTTP 请求通过此类发出

- **`AIProvider` 接口**（`src/ai/ai-provider.ts`）：
  - `detectType(noteContent, typeDescriptions): Promise<string>` — 步骤 1：识别笔记类型
  - `generateTags(context: TagGenContext): Promise<FacetTagMap>` — 步骤 2：按 type 生成标签
  - `generateSynonyms(tag, facet, noteContext): Promise<string[]>` — Regenerate：生成同义候选
  - `verifyTag(tag, facet): Promise<VerificationResult>` — 验证用（需联网搜索能力的 provider）

- **`OpenAICompatibleProvider`**（`src/ai/openai-compatible.ts`）：实现 `AIProvider`，处理 OpenAI chat completion 格式的请求/响应。DeepSeek/Qwen/Kimi/Perplexity 均继承此类，仅覆盖 `baseUrl`、`defaultModel`、`headers` 等配置差异。响应解析包含 JSON 提取（从 markdown code block 或纯 JSON 中提取结构化输出）。

- **`PromptAssembler`**（`src/ai/prompt-assembler.ts`）：组装两步 AI 调用的 prompt 文本：
  - **步骤 1 prompt**：system role（librarian-taxonomist）+ 12 种 type 名称/描述 + 笔记全文 → 返回 type 名称。预估 500-800 token
  - **步骤 2 prompt**：type 的 facet schema 定义 + PromptFilterBuilder 输出的候选标签子集 + 黑名单 + 笔记全文 → 返回 `{ facet: [tags] }` JSON。prompt 大小随候选标签数量变化
  - **Regenerate prompt**：当前标签 + facet 上下文 + "产生同义/近义词，不可产生不同概念" 约束
  - PromptAssembler 依赖 PromptFilterBuilder（M3）提供过滤后的标签数据

- **`VerificationPipeline`**（`src/verification/verification-pipeline.ts`）：三级编排器。接收一组 taxonomy 标签，**每个标签独立并发**走三级验证：
  1. `RegistryStore.getTag(label)` → 命中 → `registry` badge
  2. `WikipediaClient.lookup(label)` → 命中 → `wiki_verified` badge
  3. `AIVerifier.verify(label, facet)` → 确认 → `search_verified` badge；存疑 → `needs_review` badge
  - 每个标签完成后立即通过事件通知（供 UI 逐个刷新 badge），不等全部完成
  - `use_wikipedia: false` 时跳过第 2 级（中国大陆适配）

- **`WikipediaClient`**（`src/verification/wikipedia-client.ts`）：封装 Wikipedia REST API（`/w/api.php?action=query&titles=...`），处理重定向（`#REDIRECT`）和消歧义页面。网络不可达时返回 miss（不报错），让 pipeline 继续到第 3 级。

- **`AIVerifier`**（`src/verification/ai-verifier.ts`）：使用具有联网搜索能力的 AI provider（Qwen/Kimi/Perplexity）验证标签真实性。prompt 要求返回确认/否认 + 来源 URL。

- **`VerificationQueueManager`**（`src/verification/verification-queue-manager.ts`）：管理 `verification-queue.json`。离线时将待验证标签入队；监听 NetworkMonitor 的 `online` 事件，自动批量重试。记录 `attempts` 计数，超过阈值标记为 `needs_review`。

- **`RateLimiter`**（`src/ai/rate-limiter.ts`）：Token Bucket 算法，按 provider 维度限速。`acquire(): Promise<void>` 在令牌可用前阻塞。批量处理时防止 API 被封。

**功能清单**：
- `src/network/network-monitor.ts`
- `src/network/http-client.ts`
- `src/ai/ai-provider.ts`（接口定义）
- `src/ai/openai-compatible.ts`（基类）
- `src/ai/providers/deepseek.ts`、`qwen.ts`、`kimi.ts`、`perplexity.ts`
- `src/ai/prompt-assembler.ts`
- `src/ai/rate-limiter.ts`
- `src/verification/wikipedia-client.ts`
- `src/verification/ai-verifier.ts`
- `src/verification/verification-pipeline.ts`
- `src/verification/verification-queue-manager.ts`

**测试策略**：
- AI 调用：mock HTTP 响应，验证 prompt 构建正确（包含正确的候选标签、黑名单、facet schema）、响应 JSON 解析正确
- 两步流程端到端：mock 步骤 1 返回 `"academic"` → 验证步骤 2 prompt 包含 academic 的 facet 定义和对应标签子集
- 验证管线：mock 三个 tier，测试 fallthrough（tier 1 miss → tier 2 hit → 返回 `wiki_verified`）、全 miss → `needs_review`
- 并发验证：5 个标签同时验证，不同完成顺序，事件均正确发出
- 离线队列：入队 → 模拟 online 事件 → 自动重试 → 成功后出队
- Rate limiter：突发请求被正确节流，限速后请求排队等待

**验收标准**：
- 配置 DeepSeek API Key 后，对一篇笔记执行步骤 1 + 步骤 2，返回结构化 `{ facet: [tags] }` 映射
- taxonomy 标签自动走验证管线，每个标签独立完成后事件触发
- Wikipedia 被墙时自动降级到第 3 级
- 离线时验证入队，联网后自动重试
- 无 API Key 时给出明确错误信息（非原始 HTTP 错误码）

---

### M5：标签生命周期操作

**目标**：实现 Accept/Delete/Edit/Regenerate 四种用户操作 + Type 操作的完整业务逻辑。这是连接 AI 输出和用户决策的核心调度层——上承 M4 的 AI/验证输出，下接 M2 的持久化和 M3 的 YAML 写入。

**依赖**：M2（所有 Store）、M3（FrontmatterService、SchemaResolver）、M4（AIProvider、VerificationPipeline）

**关键抽象**：

- **`AnalysisOrchestrator`**（`src/operations/analysis-orchestrator.ts`）：编排单篇笔记的完整分析流程，是"分析当前笔记"命令的核心实现：
  1. 调用 `AIProvider.detectType()` → 获得 type
  2. 调用 `PromptFilterBuilder.build(type)` → 获得候选标签子集 + 黑名单
  3. 调用 `AIProvider.generateTags(type, candidates, blacklist, note)` → 获得 `facet→tags` 映射
  4. 本地组装：每个 tag 通过 TagMatcher 与 registry 匹配 → 区分"库内"（🟢）和"新词"
  5. 新词并发走 `VerificationPipeline` → 获得 badge（🔵 / 🟡）
  6. 全部结果（含非 taxonomy 的 enum/wikilink/free-text/date 标签）写入 `StagingStore`
  - 步骤 5 是异步的，badge 可能在写入 staging 后才陆续更新（UI 通过事件订阅实时刷新）

- **`TagOperationExecutor`**（`src/operations/tag-operation-executor.ts`）：纯业务逻辑，不涉及 UI。每个方法对应一种用户操作：
  - `accept(notePath, type, facet, tagLabel)` →
    - 🟢 registry badge → 仅标记 staging 中 `user_status: "accepted"`
    - 🔵/🟡 新 badge → 标记 staging + 准备 registry 入库数据（`verified_by` 取决于 badge）
    - 如果标签已有但当前 facet 不在其 `facets[]` 中 → 调用 `RegistryStore.expandFacets()` 自动追加
  - `delete(notePath, type, facet, tagLabel)` → 标记 staging 中 `user_status: "deleted"`。**不触发任何 registry 操作，不产生黑名单**
  - `edit(notePath, type, facet, oldTag, newTag)` →
    - newTag 入 staging 替代 oldTag（badge: `needs_review`，`verified_by: manual`）
    - oldTag 入 registry 黑名单（`status: rejected`，`rejected_in_favor_of: newTag`）
  - `regenerate(notePath, type, facet, tag)` →
    - 调用 `AIProvider.generateSynonyms(tag, facet, noteContext)` → 返回候选列表
    - 候选列表暂存于内存（**不持久化**，关闭侧边栏后丢失）
    - 用户选择后调用 `acceptFromCandidates(selected, allCandidates, originalTag)` → 选中词入库，其余+原词 → `rejected_in_favor_of: 选中词`
  - `applyAll(notePath)` → 收集该笔记所有 `user_status: "accepted"` 的标签 → `FrontmatterService.write()` 写入 YAML → `RegistryStore` 更新（新标签入库、facets 追加、黑名单写入）→ `StagingStore` 移除该笔记条目

- **`TypeOperationExecutor`**（`src/operations/type-operation-executor.ts`）：
  - `changeType(notePath, newType)` → 清除当前 staging 中该 type 全部标签 → 以 newType 重新执行 AnalysisOrchestrator 的步骤 2-6（跳过步骤 1）
  - `addType(notePath, additionalType)` → 以 additionalType **独立**执行步骤 2-6（不携带现有 type 信息，§2.3 中的"完全独立调用"），结果追加到 staging
  - `deleteType(notePath, type)` → 从 staging 中移除该 type 整块；如果该 type 已写入 YAML 则通过 `FrontmatterService.removeTypeBlock()` 一并移除

**功能清单**：
- `src/operations/analysis-orchestrator.ts`
- `src/operations/tag-operation-executor.ts`
- `src/operations/type-operation-executor.ts`

**测试策略**：
- Accept 🟢 标签：staging 更新为 accepted，registry 无变化
- Accept 🔵 标签：staging 更新 + registry 新增 verified 条目（`verified_by: "wikipedia"` 或 `"ai_search"`）
- Accept 🟡 标签：staging 更新 + registry 新增（`verified_by: "manual"`）
- Accept 已有标签到新 facet：`RegistryStore.expandFacets()` 被调用
- Delete：staging 更新为 deleted，registry 无任何变化
- Edit：新词入 staging + registry，旧词入黑名单，`rejected_in_favor_of` 指向正确
- Regenerate：候选列表返回后，选择一个 → 选中词入库，其余+原词入黑名单
- `applyAll`：批量写入 YAML 格式正确（单 type / 多 type），staging 条目移除，registry 状态一致
- `changeType`：旧 type staging 清除，新 type 结果填入
- `addType`：不影响已有 type 数据，完全独立
- `deleteType`：staging + YAML 中该 type 整块移除

**验收标准**：
- 对一篇笔记完成分析 → 逐标签操作 → 应用，YAML 和 registry 状态均与 §三 定义一致
- Type 操作（修改/增加/删除）正确执行，不产生跨 type 数据泄漏
- Regenerate 黑名单机制正确（选中词不入黑名单，其余全入）

---

### M6：侧边栏 UI

**目标**：右侧边栏面板，包含手动模式（离线可用）和 AI 模式（在线增强），是用户与标签系统交互的主界面。

**依赖**：M2（RegistryStore，手动模式读取标签库）、M3（FrontmatterService，读取当前 YAML）、M5（AnalysisOrchestrator、TagOperationExecutor、TypeOperationExecutor）

**关键抽象**：

- **`TagReviewView extends ItemView`**（`src/ui/tag-review-view.ts`）：注册到 Obsidian 右侧边栏（`registerView`）。监听 `active-leaf-change` 事件，切换笔记时自动刷新内容。视图有两种模式：
  - **手动模式**（默认态 / 离线时）：展示当前笔记的 YAML frontmatter 标签（通过 FrontmatterService 读取）；每个 facet 提供下拉选择器（从 registry 按 facet 过滤）+ 手动键入输入框；手动键入的新词自动走 TagNormalizer，库内匹配为 🟢，新词为 🟡（`verified_by: manual`）
  - **AI 模式**（在线 + 已分析后）："分析"按钮触发 AnalysisOrchestrator；按 type → facet → tag 三级结构展示 staging 数据；验证 badge 逐个刷新（订阅 VerificationPipeline 事件）

- **UI 组件**（`src/ui/components/`）：
  - **`TagChip`**：badge 颜色圆点 + 标签文本 + 操作按钮组。🟢 库内标签显示 ✓ ✗ 两个按钮；🔵🟡 新标签显示 ✓ ✗ ✎ ↻ 四个按钮。文本部分为可编辑 `<input>`（§9.4）
  - **`FacetSection`**：facet 标题 + TagChip 列表 + "添加"按钮
  - **`TypeSelector`**：type 下拉选择 + "修改 type" / "增加 type" / "删除 type" 按钮
  - **`NetworkIndicator`**：状态灯（🟢/🔴）+ 点击刷新。订阅 NetworkMonitor 状态变更事件
  - **`CandidateList`**：Regenerate 候选列表浮层（临时 UI，不持久化，关闭后丢失）

- **事件订阅**：
  - `StagingStore` 变更 → 刷新 tag 列表
  - `VerificationPipeline` 单标签完成 → 更新该标签的 badge 颜色
  - `NetworkMonitor` 状态变更 → 切换手动/AI 模式可用性 + 更新指示器

**功能清单**：
- `src/ui/tag-review-view.ts`：ItemView 主视图
- `src/ui/manual-mode-renderer.ts`：手动模式渲染
- `src/ui/ai-mode-renderer.ts`：AI 模式渲染
- `src/ui/components/tag-chip.ts`
- `src/ui/components/facet-section.ts`
- `src/ui/components/type-selector.ts`
- `src/ui/components/network-indicator.ts`
- `src/ui/components/candidate-list.ts`
- `styles.css`：全部使用 `.toot-` 前缀

**测试策略**：
- 无标签笔记：手动模式正确渲染空态，可手动添加标签
- 已有标签笔记：正确读取并显示 YAML 中的 type/facet/tags
- AI 分析后：staging 数据正确渲染，badge 颜色对应（🟢🔵🟡）
- 操作测试：点击 ✓/✗/✎/↻ 触发正确的 TagOperationExecutor 方法
- Regenerate：候选列表展开/选择/收起
- 切换笔记：视图自动刷新到新笔记的标签状态
- 离线：分析按钮禁用并显示提示，手动模式可用
- staging 恢复：关闭侧边栏 → 重新打开 → staging 中 `pending` 状态的标签恢复显示
- `checkCallback` 使用 `getActiveFile()` 而非焦点检测（§9.5）

**验收标准**：
- Ribbon 图标点击打开侧边栏，显示当前笔记标签
- 网络状态指示器正确（🟢/🔴），单击可刷新
- 完整单篇流程：分析 → badge 逐个刷新 → 逐标签操作 → 应用 → YAML 更新
- 手动键入标签 → 库内为 🟢，新词为 🟡
- 修改/增加/删除 type 功能正常
- 关闭重开侧边栏后 staging 状态恢复

---

### M7：批量处理

**目标**：对全库笔记批量 AI 打标，带过滤、进度追踪、暂停恢复、错误隔离、跨重启恢复。

**依赖**：M4（RateLimiter）、M5（AnalysisOrchestrator）、M6（复用 TagChip、FacetSection 等 UI 组件）

**关键抽象**：

- **`VaultScanner`**（`src/batch/vault-scanner.ts`）：枚举 vault 中的 markdown 文件，返回有序文件列表（按路径排序，确保可恢复性）。支持过滤条件：
  - 按文件夹包含/排除
  - `skip_tagged: true` 跳过已有 `_tagged_at` 的笔记
  - 结果为 `TFile[]`，供 BatchProcessor 消费

- **`BatchProcessor`**（`src/batch/batch-processor.ts`）：顺序处理文件列表，每个文件调用 AnalysisOrchestrator。
  - 发出进度事件：`{ processed, total, current_file, failed_count }`
  - **错误隔离**：单个文件处理失败（AI 调用报错、YAML 损坏等）不中断批次，记录错误后跳过，继续下一个
  - 通过 RateLimiter 控制 API 调用频率
  - 支持 `pause()` / `resume()` / `terminate()` 操作

- **`BatchStateManager`**（`src/batch/batch-state-manager.ts`）：将批量处理进度持久化到 `batch-state.json`（§3.6 格式）。
  - 每处理完一个文件更新 `processed` 计数
  - Obsidian 关闭后重启 → 检测到未完成的 batch（`status: "paused"` 或 `"running"`）→ 提示用户是否恢复
  - 恢复时从 `processed + 1` 处继续（文件列表排序确保一致性）

- **`BatchReviewModal extends Modal`**（`src/ui/batch-review-modal.ts`）：批量审核界面。
  - 顶部：进度条 + 暂停/恢复/终止按钮
  - 中部：当前笔记的标签审核（**复用 M6 的 AI 模式渲染组件**——TagChip、FacetSection、TypeSelector）
  - 底部："上一篇" / "下一篇"导航 + "应用所有已审核"批量提交
  - 导航时自动跳过无 staging 数据的笔记（已审核完或处理失败的）

**功能清单**：
- `src/batch/vault-scanner.ts`
- `src/batch/batch-processor.ts`
- `src/batch/batch-state-manager.ts`
- `src/ui/batch-review-modal.ts`

**测试策略**：
- Scanner：文件夹过滤正确，`skip_tagged` 跳过已打标笔记，排序一致
- Processor：模拟 10 个文件，第 3 个报错 → 其余 9 个正常完成，进度事件准确
- State：处理 5/10 → 模拟重启 → 恢复后从第 6 个继续
- 暂停/恢复：暂停后无新 API 调用，恢复后继续下一个文件
- Modal：导航正确，审核操作触发正确的 TagOperationExecutor 方法
- Rate limiting：批量处理不超过 API 速率限制

**验收标准**：
- 命令面板"批量打标"打开 Modal，Scanner 正确枚举文件
- 进度条实时更新
- 暂停/恢复/终止正常工作
- 单文件错误不中断批次
- Obsidian 重启后可从上次进度继续
- 审核操作与单篇流程一致

---

### M8：标签库管理

**目标**：标签库的浏览、编辑、合并、导入导出、关系自动发现。

**依赖**：M2（RegistryStore、BackupManager）、M3（FrontmatterService，合并时重写 YAML）、M5（TagOperationExecutor 的 registry 操作）

> M8 与 M7 无依赖关系，可与 M7 并行开发。

**关键抽象**：

- **`TagBrowserModal extends Modal`**（`src/ui/tag-browser-modal.ts`）：标签库主界面。
  - 搜索：按 label、alias 模糊搜索
  - 过滤：按 facet、status（verified / rejected）、使用频率
  - 列表：分页展示匹配标签，每项显示 label、facets、使用次数、relations 摘要
  - 点击进入详情编辑

- **`TagPropertyEditor`**（`src/ui/tag-property-editor.ts`）：编辑单个标签的所有属性。
  - `facets[]`：可增删的标签列表（**支持人工维护**，§2.3 中"确保人工可维护"的落地）
  - `aliases[]`：可增删
  - `relations`：broader / narrower / related 各自可增删，输入时自动补全已有标签
  - 修改即时保存到 RegistryStore

- **`TagMerger`**（`src/management/tag-merger.ts`）：将标签 A 合并到标签 B。
  1. **Dry-run 预览**：扫描全库 YAML，列出所有包含 A 的笔记及将发生的修改
  2. 用户确认后执行：
     - `BackupManager.createBackup("tag-registry.json")` 创建备份
     - 逐文件通过 `FrontmatterService` 将 A 替换为 B
     - 每修改一个文件记录到 merge log（内存中，操作完成后展示总结）
     - Registry 中 A → `rejected_in_favor_of: B`，B 继承 A 的 relations
  3. **Git 提示**：检测 vault 是否为 git 仓库（`.git` 目录存在），合并前提示建议 commit

- **`ImportExportManager`**（`src/management/import-export-manager.ts`）：
  - 导出：registry 全量 JSON 下载
  - 导入：JSON 格式校验 → 冲突检测（已有同名标签）→ 合并策略（覆盖 / 跳过 / 手动选择）

- **`StatisticsPanel`**（`src/ui/statistics-panel.ts`）：实时计算，不单独存文件。
  - 总标签数、verified / rejected 数量
  - 使用频率（扫描全库 YAML 统计每个标签出现次数）
  - 孤立标签（registry 中有但全库无笔记使用）
  - Facet 分布（每个 facet 下的标签数量）

- **`RelationDiscoverer`**（`src/management/relation-discoverer.ts`）：利用 AI 批量为缺少 relations 的标签补全 broader / narrower / related。将全部标签（或指定子集）发送给 AI，AI 拥有全局标签视野，关系质量高于逐条补全。结果展示为 diff 预览 → 用户确认后写入 registry。

**功能清单**：
- `src/ui/tag-browser-modal.ts`
- `src/ui/tag-property-editor.ts`
- `src/management/tag-merger.ts`
- `src/management/import-export-manager.ts`
- `src/ui/statistics-panel.ts`
- `src/management/relation-discoverer.ts`

**测试策略**：
- 搜索：精确匹配、alias 匹配、部分匹配
- 过滤：单条件、组合条件
- 编辑 facets：修改后 RegistryStore 持久化正确
- 合并 dry-run：报告列出所有受影响文件及具体修改
- 合并执行：备份创建 → 全部文件 YAML 正确更新 → registry 一致
- 导入导出：roundtrip 完整性
- 统计：计数与 registry + vault 实际数据一致
- 关系发现：AI 返回结果正确写入 registry，不覆盖已有 relations

**验收标准**：
- 命令面板打开标签浏览器，搜索和过滤正常
- 编辑 facets 数组、aliases、relations 后立即生效
- 合并操作：dry-run 预览准确，确认后全库 YAML 正确更新，备份已创建
- 导出后重新导入，标签库数据完整
- 统计面板数据准确

---

## 六、横切关注点

### 技术约束

| 约束 | 原因 |
|------|------|
| 零运行时依赖（仅 obsidian） | 避免 node_modules 体积膨胀；`requestUrl` 替代 `fetch`/`axios` |
| 所有 CSS 使用 `.toot-` 前缀 | 避免与其他插件样式冲突（the-only-one-tagger 缩写） |
| 使用 `processFrontMatter` 写入 YAML | 官方 API，避免直接字符串操作 YAML 带来的格式破坏 |
| 使用 `adapter.read/write` 操作插件数据文件 | 不让插件数据文件出现在用户笔记列表 |
| AI 服务懒初始化 | 插件加载时不创建 AI 实例，首次调用时才初始化 |

### 每模块验收流程

1. `npm run build` — TypeScript 无报错
2. 手动复制 `main.js`、`manifest.json`、`styles.css` 到 `.obsidian/plugins/the-only-one-tagger/`
3. 在 Obsidian 中启用插件，检查控制台无报错
4. 执行本模块的测试策略和验收标准
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

## 八、标签完整生命周期

一个 taxonomy 标签从诞生到归宿的全流程：

```
步骤 2 → AI 返回候选 taxonomy 标签
      │
      ├── 命中本地标签库 → 🟢 库内标签
      │     badge: registry
      │     → 进入 staging，展示给用户
      │     → 用户 Accept → 写入 YAML（不更新 registry）
      │     → 用户 Delete → 从 staging 移除
      │
      └── 未命中 → 每个标签独立并发验证
              │
              ├── Wikipedia 确认  → 🔵 badge: wiki_verified
              ├── AI 搜索确认    → 🔵 badge: search_verified
              └── 都未确认       → 🟡 badge: needs_review
              │
              └── 全部进入 tag-staging.json
                  展示给用户，等待操作：
                  │
                  ├── Accept  → 写入 YAML + 入库（status: verified）
                  │             registry.facets 自动追加当前 facet
                  │
                  ├── Delete  → 从 staging 移除
                  │             不入库，不产生黑名单
                  │
                  ├── Edit    → 新词入库（verified_by: manual）
                  │             旧词入库（status: rejected, rejected_in_favor_of: 新词）
                  │
                  └── Regenerate → 展开候选列表
                        → 选一个入库（verified_by: manual）
                        → 其余全部入库（status: rejected, rejected_in_favor_of: 选中词）
```

**用户侧状态模型**：

| 状态 | 含义 | 存在位置 |
|------|------|---------|
| `verified` | 已入库的正式标签 | tag-registry.json |
| `rejected` | 黑名单标签 | tag-registry.json（带 `rejected_in_favor_of`） |
| `pending_verification` | 等待网络验证 | verification-queue.json |
| `pending_user` | 已验证/验证失败，等待用户确认 | tag-staging.json |

**Badge 属性**（信心级别，非状态，用于 UI 展示）：

| Badge | 颜色 | 含义 |
|-------|------|------|
| `registry` | 🟢 绿色 | 标签库已有 |
| `wiki_verified` | 🔵 蓝色 | Wikipedia 确认 |
| `search_verified` | 🔵 蓝色 | AI 联网搜索确认 |
| `needs_review` | 🟡 黄色 | 三级验证均未确认 |

---

## 九、第一轮实现复盘（2026-03-11）

> 第一轮实现后发现的缺陷，作为重新开发的补充需求。

### 9.1 严重：验证管线未接入标签生成主流程

代码存在但从未被调用。AI 建议新标签后直接以 `pending` 入库，跳过了 §2.4 的三级验证。必须在展示给用户前实时走 Tier 1→2→3 验证。

### 9.2 严重：Accept 不更新 registry

点 ✓ 只在内存中标记状态，不更新标签库。用户确认的标签应同时在 registry 标记为 `verified`（`verified_by: 'manual'`）。

### 9.3 中等：冷启动扫描无过滤

把所有 inline tag 不加过滤地塞入 registry，且全部默认 `facet: 'area'`。已移除，后续如恢复需加过滤规则。

### 9.4 UI：Tag chip 应可编辑

已改为 `<input>`，保留。

### 9.5 UI：Analyze 命令在侧边栏焦点时消失

`checkCallback` 应改用 `getActiveFile()` 检测。

### 9.6 架构备忘：混合模式的正确理解

§2.2 "YAML 为主，行内标签为辅"指的是**分工**，不是重复写入：
- YAML：插件管理的结构化 facet 标签
- 行内标签/tags 字段：用户手动的状态标记（`#todo`、`#review`），插件不管

*文档版本：4.0 | 日期：2026-03-11 | 状态：架构审核完成，8 模块开发计划就绪*
