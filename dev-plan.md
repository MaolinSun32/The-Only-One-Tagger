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

### 2.4 标签验证管线

> **实现说明**：本地标签库匹配（🟢）在 AnalysisOrchestrator（M5）中完成，不属于 VerificationPipeline。Pipeline 只接收未命中库的新词，执行两级验证（Wikipedia → AI 搜索）。

```
AI 返回候选 taxonomy 标签（步骤 2 输出）
      │
      ├── 命中本地标签库 ──→ 🟢 库内标签（跳过验证）← 在 AnalysisOrchestrator 中完成
      │
      └── 未命中 → badge 初始化为 ⚪ verifying → 进入 VerificationPipeline 并发验证：
              │
          Wikipedia API ──命中──→ 🔵 已认证（wiki_verified）
              │未命中/不可达（ping 超时则跳过）
          AI + 联网搜索 ──确认──→ 🔵 已认证（search_verified）
              │存疑
          标记 🟡 needs_review ──→ 等用户确认 ⚠️
              │
              └── 所有标签（🟢⚪🔵🟡）全部进入 tag-staging.json
                  ⚪ 验证中的标签操作按钮禁用，验证完成后自动启用
                  等待用户在侧边栏逐条操作
```

**验证并发机制**：
- 每个 taxonomy 标签独立并发走验证管线（不排队）
- `request_timeout_ms`（默认 30000）为单个验证请求的超时
- 新标签进入 staging 时 badge 为 `verifying`（⚪ 灰色），操作按钮禁用
- UI 逐个刷新 badge 颜色（先完成的先显示，不等全部完成），badge 更新后按钮启用
- 离线时不发起 AI 验证，用户手动键入的新 taxonomy 标签为 🟡（`needs_review`），可直接操作，同时入 `verification-queue.json` 排队，联网后后台自动验证，验证失败时通过 Notice 提醒用户

**Wikipedia 作为第二级**：
- 完全免费，无速率限制
- 90% 的学术术语都有词条
- Wikipedia 词条标题即学术界"规范名"，比 AI 生成的更权威
- 通过 NetworkMonitor ping 检测 Wikipedia 可达性，**不可达时自动跳到第三级**（无需手动配置）
- 设置中预留 `knowledge_base_source` / `knowledge_base_lang` / `use_knowledge_base` 配置结构，方便未来扩展其他知识库源

### 2.5 分层 AI 后端

| 用途 | 推荐服务 | 理由 |
|------|---------|------|
| 标签生成（量大） | DeepSeek | 最便宜，$0.28/$0.42/1M token |
| 标签验证（需联网搜索） | Qwen 通义千问 / Kimi 月之暗面 / Perplexity Sonar | 内置联网搜索，返回来源 URL |

> **注意**：DeepSeek API 不含内置搜索，仅适合生成，不适合验证。验证 provider 不区分国内/国外，用户在设置中自行选择。

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

> **关键设计：所有 registry 写入（入库、黑名单）统一推迟到 `applyAll`**。用户在侧边栏的逐条操作仅更新 staging 状态，不触碰 registry。这确保用户关闭侧边栏不应用时，不会产生数据不一致。

| 操作 | 图标 | 含义 | 行为（仅更新 staging，registry 在 applyAll 时统一处理） |
|------|------|------|------|
| **Accept** | ✓ | 认可这个标签 | staging 中标记 `user_status: "accepted"` |
| **Delete** | ✗ | 不需要此标签 | staging 中标记 `user_status: "deleted"`，不产生黑名单 |
| **Edit** | ✎ | 手动键入替代词 | 新词替换旧词入 staging，旧词记入 `replaces` 数组（applyAll 时旧词入黑名单） |
| **Regenerate** | ↻ | 要同义但更好的词 | 展开候选列表，选一个替换，其余+原词记入 `replaces`（applyAll 时全部入黑名单） |

**`replaces` 链式追踪**：Edit 和 Regenerate 可能产生链式替换（A→B→C）。staging 中 `replaces` 字段为数组，继承完整链条。`applyAll` 时：最终标签 → `registry verified`，`replaces` 中所有标签 → `registry rejected`（`rejected_in_favor_of` 指向最终标签）。

**Edit 后新标签的验证**：用户手动键入的新 taxonomy 标签也需走验证管线。在线时 badge 为 ⚪ `verifying`（验证完成后更新）；离线时 badge 为 🟡 `needs_review`，可直接操作，同时入 `verification-queue.json` 排队，联网后后台自动验证。

**Regenerate 细则**：
- 针对**单个标签**（不是整个 facet）
- 每次点击在列表中**追加**更多同义候选（不替换已有列表）
- 用户从列表中选一个 → Accept → 入库
- 列表中所有未被选中的词 + 原始词 = 该 accepted 词的黑名单
- **仅适用于**：AI 新生成的标签（🔵 / 🟡 badge），不适用于 🟢 库内标签
- 候选列表**不持久化**（关闭侧边栏后丢失，重新点击重新生成）
- Prompt 约束：regenerate 必须产生同义/近义词，不能产生不同概念的标签

**标签来源 badge**（颜色区分信心级别，仅适用于 taxonomy 类 facet）：

| Badge | 颜色 | 含义 | applyAll 时的 registry 行为 |
|-------|------|------|------------|
| 验证中 | ⚪ 灰色 | 新生成，验证管线进行中 | （操作按钮禁用，等待验证完成） |
| 库内 | 🟢 绿色 | 标签库已有（verified） | 仅写入 frontmatter，不更新 registry |
| 已认证 | 🔵 蓝色 | 新生成 + 已通过验证（Wikipedia/AI 搜索） | 写入 + 入库（`verified_by` 取决于验证来源） |
| 待确认 | 🟡 黄色 | 新生成 + 三级验证均未确认 | 写入 + 入库（`verified_by: manual`） |

> **注意**：Badge 是信心级别指示，不是状态。⚪ 验证中时操作按钮禁用；🟢🔵🟡 的用户可执行操作完全一致。

**非 taxonomy 类 facet 的 UI 形态**：

非 taxonomy 类 facet 无需验证 badge，无 ✎ Edit / ↻ Regenerate 按钮，编辑功能内置在组件中：

| value_type | UI 形态 | Badge | 操作按钮 |
|------------|---------|-------|----------|
| `taxonomy` | tag chip + 彩色圆点 | ⚪🟢🔵🟡 | ✓ ✗ ✎ ↻（按 badge 规则） |
| `enum` | 下拉选择器（从 `values` 列表选） | 无圆点 | ✓ ✗ + 下拉切换（内置编辑） |
| `wikilink` | 输入框 + vault 内自动补全 | 无圆点 | ✓ ✗ + 输入框编辑 |
| `free-text` | 纯文本输入框 | 无圆点 | ✓ ✗ + 输入框编辑 |
| `date` | 日期选择器或文本框 + 格式校验 | 无圆点 | ✓ ✗ + 选择/编辑 |

**审核粒度**：
- **标签级**：每个 tag chip 可独立 Accept / Delete / Edit
- **Facet 级**：用户可对整个 facet 执行增加标签操作

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

> ⚪ 验证中的标签（如 `attention`）显示灰色圆点 + 加载动画，操作按钮禁用，验证完成后自动更新为 🔵/🟡 并启用按钮。

> 🟢 库内标签只有 ✓ Accept 和 ✗ Delete 两个操作。🔵🟡 新标签额外有 ✎ Edit 和 ↻ Regenerate。⚪ 验证中标签所有按钮禁用。非 taxonomy 标签（enum/wikilink/free-text/date）无圆点，只有 ✓ ✗，编辑通过组件本身完成（下拉/输入框）。

**"全部接受"/"全部删除"按钮语义**：

- **✅ 全部接受**：将当前笔记**所有 type** 下 `user_status: "pending"` 的标签标记为 `"accepted"`
- **❌ 全部删除**：将当前笔记**所有 type** 下 `user_status: "pending"` 的标签标记为 `"deleted"`
- **不翻转已有决策**：已经是 `accepted` 或 `deleted` 的标签不受影响
- **不影响 ⚪ 标签**：⚪ 验证中标签的操作按钮禁用，`user_status` 始终为 `pending`，不被全部接受/删除改变

**"应用"按钮与 ⚪ 验证中标签**：

⚪ 标签因操作按钮禁用，`user_status` 始终为 `pending`。点击"应用"时，`applyAll` 只处理 `accepted`/`deleted` 的标签，⚪ 标签自然保留在 staging 中。验证完成后 badge 更新（⚪→🔵/🟡），按钮启用，用户下次打开笔记时审核。

**重新分析已打标笔记**：

对已有 `_tagged_at` 的笔记再次点击"分析"时，采用**增量式**策略，不破坏现有标签：
1. 读取当前 YAML（通过 FrontmatterService）
2. 正常跑 AI 步骤 1→2→3
3. 将 AI 结果与现有 YAML 比对：
   - AI 建议的标签**已在 YAML 中** → 写入 staging，`user_status: "accepted"`（自动确认，灰显）
   - AI 建议的标签**不在 YAML 中** → 写入 staging，`user_status: "pending"`（正常待审核）
   - YAML 中已有但 AI **没建议的标签** → **不进 staging，不从 YAML 删除**（保持不变）
4. 重新分析**覆盖**该笔记在 staging 中的旧数据（新分析结果替代旧的未完成审核）
5. `applyAll` 时合并写入：保留不在 staging 中的现有 facet/标签，`_tag_version` 递增

### 2.8 网络状态检测与离线降级

**网络状态检测**：
- 插件启动时立即 ping 所有已配置的 API（轻量级请求，如 `GET /models`）
- **API Key 为空的 provider 不发 ping**，直接标记为"未配置"
- 每 **60 秒** 自动重新检测
- 侧边栏顶部显示状态指示器：🟢 在线 / 🔴 不可用
- **全链路判定**：🟢 要求 generation provider **和** verification provider **同时可达**。任一环节不可达或未配置 → 🔴
- **🔴 悬停提示**（tooltip）：鼠标悬停时显示每个环节的具体状态，帮助用户定位问题。provider 名称取自用户实际设置。示例：`生成服务 (deepseek): ✓ · 验证服务 (qwen): ✗ 未配置 API Key`，或 `生成服务 (deepseek): ✗ 无法连接 · 验证服务 (qwen): ✓`
- **🟢 悬停提示**（可选）：显示 `生成服务 (deepseek): ✓ · 验证服务 (qwen): ✓`
- Wikipedia 可达性不影响红绿灯（它是验证管线的可选加速层，不可达时自动跳过）
- 单击状态指示器可**手动刷新**网络状态

**🔴 不可用时**：
- AI 打标功能**完全不可用**（生成或验证服务不可达/未配置 = 无法完成完整打标流程）
- 点击"分析"按钮弹出提示："AI 服务不可用，请检查网络连接和 API 配置"（同时引导用户悬停红灯查看具体原因）
- 侧边栏降级为**手动模式**：显示当前笔记的 YAML 标签，用户可从标签库下拉选择或手动键入
- 手动键入的标签：库内已有的为 🟢，用户手动键入的新 taxonomy 词为 🟡（`needs_review`），可直接 Accept（`verified_by: manual`），同时入 `verification-queue.json` 排队
- 联网后后台自动验证排队中的标签：验证通过 → **同时检查 registry 和 staging 两个位置**：标签已在 registry 中则更新 `verified_by`；标签还在 staging 中则更新 `badge`（如 `needs_review` → `wiki_verified`）；验证失败 → 侧边栏 Notice 提醒用户
- 已生成但验证失败的标签同样保留在 `verification-queue.json`，联网后自动重试

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

    "_comment_taxonomy": "taxonomy: 受控词表，需走验证管线（本地标签库 → Wikipedia → AI 搜索）",

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
    "related-project": {
      "description": "所属/关联项目",
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
    "last_updated": "2026-03-11T10:30:00Z",
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
    }
  }
}
```

**关键设计——`facets` 为数组**：

一个标签可以属于多个 facet。例如 "deep-learning" 可以同时是 `domain`（知识领域）和 `method`（技术方法）。

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

> **`getTagsByFacets()` 过滤规则**：此方法只返回 `status: "verified"` 的标签，不返回 `rejected` 标签。黑名单标签通过单独的 `getBlacklist()` 方法获取。这确保 PromptFilterBuilder 构建的候选列表和黑名单互不交叉。

**Rejected 标签黑名单机制**：

黑名单标签保留在 registry 中，增加 `rejected_in_favor_of` 字段，指向用户选择的正确标签。AI 生成时 prompt 携带黑名单，避免重复推荐。

```json
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

**多 type 示例（用户手动增加 type，共享 facet 各自独立）**：

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

> 注意：`programming-language` 在 academic 和 project 中各自独立存在（接受重复），删除某个 type 时整块移除即可。`domain` 同理——academic 和 project 各自独立填写。

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
| `_tag_version` | 整数 | 标签版本号（全笔记级别），每次 `applyAll` 写入时递增，不区分 type。用于"笔记整体是否被打标过"的快速筛选（如批量处理 `skip_tagged`） |
| `_tagged_at` | ISO 日期 | 最后打标时间（全笔记级别），不区分 type |

> `_tag_status` 已移除——YAML 中只存在用户确认后的标签，因此状态始终为 confirmed，无需额外字段标记。未确认的标签存在 `tag-staging.json` 中。

> **关于人物的交叉关系**：`scholar: ["[[Vaswani-A]]"]` 中的 `[[wikilink]]` 直接链接到人物笔记，Dataview 和 Graph view 可自动聚合某学者的所有相关论文/项目/会议记录。

> **多 Type 笔记的 Dataview 查询说明**：多 type 笔记的 YAML 为嵌套结构（`academic.domain`、`project.domain`），标准 Dataview 查询需指定 type 前缀。跨 type 查询同一 facet（如"所有 domain 含 NLP 的笔记"）需使用 DataviewJS 动态遍历 `type` 数组。不在 YAML 中添加扁平化聚合字段，以保持数据结构简洁。

### 3.4 verification-queue.json（离线验证队列）

**队列按 `tag_label` 去重**：同一标签被多篇笔记触发时只保留一条记录，`source_notes` 为数组，记录所有来源笔记路径。验证完成后广播更新整个 staging 中包含该标签的所有笔记条目（不限于 `source_notes` 列表中的笔记）。

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

### 3.5 tag-staging.json（暂存区：等待用户确认的标签）

AI 生成并通过验证的标签，在用户确认前暂存于此文件。按笔记路径索引，支持跨会话持久化。

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
              "user_status": "pending"
            }
          ],
          "method": [
            {
              "label": "flash-attention",
              "badge": "verifying",
              "user_status": "pending"
            },
            {
              "label": "self-attention",
              "badge": "needs_review",
              "user_status": "pending",
              "replaces": ["self-attn"]
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
| `badge` | 验证来源/信心级别：`verifying`（⚪ 验证进行中，操作按钮禁用）、`registry`（🟢 库内）、`wiki_verified`（🔵 Wikipedia 确认）、`search_verified`（🔵 AI 搜索确认）、`needs_review`（🟡 三级验证均未确认）、`enum`/`wikilink`/`free_text`/`date`（非 taxonomy，无需验证） |
| `user_status` | `pending`（等待操作）/ `accepted`（已接受，待批量写入）/ `deleted`（已删除） |
| `replaces` | 可选数组。记录被当前标签替换的旧标签链条（Edit/Regenerate 产生）。`applyAll` 时链条中所有标签入 registry 黑名单，`rejected_in_favor_of` 指向当前标签 |
| `content_hash` | 分析时**笔记正文（不含 frontmatter）**的 SHA-256 前 8 位，由 `ContentHasher`（M3）计算。只计算 `---\n...\n---` 之后的 body 内容，确保 `applyAll` 写入标签到 YAML 后不会改变 hash 值（避免"笔记已修改"横幅误报）。用户打开审核时重新计算哈希并比对，不匹配则提示"笔记内容已变更，建议重新分析" |

**生命周期**：
- 用户点"分析"后，AI 结果写入 staging（同时记录 `content_hash`）
- 用户逐条 Accept/Delete/Edit 时更新 `user_status`
- 用户点"应用"时，`applyAll` **仅处理** `user_status` 为 `accepted` 或 `deleted` 的标签：`accepted` 写入 YAML + registry，`deleted` 不写入。**`pending` 的标签保留在 staging 中不移除**（如多 type 场景中用户只审核了部分 type）。当某个 type 下所有标签均已处理（无 pending）时移除该 type 块；当笔记下所有 type 块均已清空时移除整个笔记条目
- 用户关闭侧边栏未完成操作 → staging 保留，下次打开时恢复
- Regenerate 候选列表**不存入 staging**（关闭后丢失）
- 用户打开审核时，如果 `content_hash` 与当前文件不匹配，显示横幅提示："⚠️ 此笔记在分析后已被修改，标签建议可能不准确。[重新分析]"

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

  "knowledge_base_source": "wikipedia",
  "knowledge_base_lang": "en",
  "use_knowledge_base": true,

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

- **TypeScript 类型系统**（`src/types.ts`）：定义所有数据结构接口——`TagEntry`、`StagingNote`、`StagingTagItem`、`FacetDefinition`、`NoteTypeSchema`、`VerificationResult`、`BatchState`、`TagWriteData` 等。这是全项目的"契约层"，后续模块的函数签名均以此为准。类型定义必须覆盖 §三 中所有 JSON 格式。
  - **`TagWriteData`**：`FrontmatterService.write()` 的入参类型，包含 `types: string[]`（本次写入涉及的 type 列表）和 `typeData: Record<string, Record<string, any>>`（每个 type 下各 facet 的值映射）。`write()` 采用**增量合并**语义：读取现有 YAML → 将 `TagWriteData` 中的 type 块合并到现有数据 → 写回。不在 `TagWriteData` 中的现有 type 块原样保留。`type` 数组为**追加**逻辑（新 type 追加到已有 `type` 数组，不覆盖）。

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
  - `update(mutator: (data: T) => void): Promise<void>` — 序列化读-改-写（加载 → 调用 mutator 修改内存对象 → 写回磁盘）。内部维护 **写入队列**（Promise 链），确保多个并发 `update()` 调用严格串行执行，防止交叉读写导致数据丢失。实现方式：`this.writeQueue = this.writeQueue.then(() => { load → mutate → save })`。这对 `StagingStore` 尤其关键——VerificationPipeline 并发更新 badge、applyAll 清理条目、BatchProcessor 写入新分析结果三者可能同时操作 staging
  - 路径通过 `this.manifest.dir` + `normalizePath()` 计算
  - **注意**：`data.json`（用户设置）不使用此基类，由 Obsidian 的 `loadData()`/`saveData()` 管理

- **`RegistryStore extends DataStore<Registry>`**（`src/storage/registry-store.ts`）：在通用存储之上封装标签库业务方法。这些方法是后续模块操作 registry 的唯一入口：
  - `addTag(entry: TagEntry): void` — 新增 verified 标签
  - `rejectTag(label, rejectedInFavorOf): void` — 标记为黑名单
  - `getTag(label): TagEntry | null` — 按 label 查找
  - `getTagsByFacets(facets: string[]): TagEntry[]` — 返回 `facets` 数组与给定 facets 有交集的所有**verified**标签（仅 `status: "verified"`，不含 rejected）。PromptFilterBuilder 的候选数据源
  - `getBlacklist(facets: string[]): RejectedTag[]` — 返回指定 facets 下的黑名单标签（仅 `status: "rejected"`）
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
- DataStore 写入队列：10 个并发 `update()` 调用（模拟 VerificationPipeline 并发 badge 更新），所有修改均保留，无数据丢失

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
  - `write(file: TFile, data: TagWriteData): void` — **增量合并写入**。内部流程：① 通过 `processFrontMatter` 读取现有 YAML；② 将 `data.types` 追加到现有 `type` 数组（去重）；③ 将 `data.typeData` 中各 type 块合并到 YAML（已有同名 type 块则合并 facet，新 type 块直接写入）；④ 不在 `data` 中的现有 type 块原样保留；⑤ `_tag_version` 递增、`_tagged_at` 更新
  - `removeTypeBlock(file: TFile, type: string): void` — 删除某 type 及其全部 facet 数据（用于"删除 type"操作），同时从 `type` 数组中移除该 type
  - 写入时处理 `allow_multiple` 语义：数组 vs 单值

- **`ContentHasher`**（`src/engine/content-hasher.ts`）：计算笔记正文的 SHA-256 前 8 位。**只计算 frontmatter 之后的 body 内容**（`---\n...\n---` 之后的部分），不含 frontmatter。这确保 `applyAll` 写入标签到 YAML 后不会改变 hash 值，避免"笔记已修改"横幅误报。提供 `hash(file: TFile): Promise<string>` 方法。

**功能清单**：
- `src/engine/schema-resolver.ts`
- `src/engine/prompt-filter-builder.ts`
- `src/engine/tag-normalizer.ts`
- `src/engine/tag-matcher.ts`
- `src/engine/frontmatter-service.ts`
- `src/engine/content-hasher.ts`

**测试策略**：
- SchemaResolver：12 种 type 各返回正确的 facet 集合；`getTaxonomyFacets("academic")` 返回 `["domain", "method", "algorithm", ...]`
- PromptFilterBuilder：空 registry → 空候选；单 facet 标签正确过滤；多 facet 标签（如 `"deep-learning"` 属于 `domain+method`）在 `academic` 和 `project` type 下都能被选中；黑名单标签不出现在候选中但出现在 blacklist 输出中；`getTagsByFacets` 不返回 rejected 标签
- TagNormalizer：`"Deep Learning"` → `"deep-learning"`，`"TensorFlow"` → `"tensorflow"`，`"self attention"` → `"self-attention"`，中文不变
- TagMatcher：精确匹配、alias 匹配（`"DL"` 命中 `deep-learning`）、miss
- FrontmatterService：单 type 写入/读取 roundtrip、多 type 写入/读取 roundtrip、`removeTypeBlock` 后其他 type 不受影响、`_tag_version` 递增正确
- FrontmatterService 增量合并：已有 `type: [academic]` + 写入 project 数据 → 结果 `type: [academic, project]`，academic 块不受影响
- ContentHasher：修改 frontmatter 后 hash 不变；修改 body 后 hash 变化；空 frontmatter 笔记正确处理

**验收标准**：
- 给定 `academic` type + 种子 registry，PromptFilterBuilder 返回所有 facets 含 `domain`/`method`/`algorithm` 等的种子标签
- FrontmatterService 写入后，Obsidian 的 YAML 渲染与 §3.3 示例格式一致
- 所有纯计算函数 100% 单元测试覆盖

---

### M4：网络、AI 与验证管线

**目标**：完整的外部 I/O 层——网络状态检测、多 AI 提供商两步调用、两级标签验证管线（Wikipedia → AI 搜索，库内匹配在 M5 AnalysisOrchestrator 中完成）。

**依赖**：M1（类型）、M2（RegistryStore、QueueStore）、M3（PromptFilterBuilder、TagNormalizer）

**关键抽象**：

- **`NetworkMonitor`**（`src/network/network-monitor.ts`）：管理 generation 和 verification 两个 provider 的在线状态。启动时 ping 已配置的 API（轻量 `GET /models` 或 `HEAD` 请求），**API Key 为空的 provider 不发 ping，直接标记为 `not_configured`**。之后按 `ping_interval_ms`（默认 60s）定时刷新。暴露：
  - `getStatus(): { generation: ProviderStatus, verification: ProviderStatus }`（`ProviderStatus = 'online' | 'offline' | 'not_configured'`）
  - `isFullyOnline(): boolean` — generation 和 verification 均为 `online` 时返回 `true`，用于红绿灯判定
  - `getStatusTooltip(): string` — 返回人类可读的状态描述（含 provider 名称和具体原因），供 UI tooltip 显示
  - 事件 `on('statusChange', callback)` 供 UI 订阅
  - 提供手动刷新方法供用户点击状态图标时调用。`onunload` 时清除定时器

- **`HttpClient`**（`src/network/http-client.ts`）：`requestUrl` 的薄封装。统一：
  - 超时处理（`request_timeout_ms`）
  - 错误码规范化（网络不可达 / API 错误 / 超时 → 统一的 `HttpError` 类型）
  - 响应 JSON 解析
  - 所有外部 HTTP 请求通过此类发出

- **`GenerationProvider` 接口**（`src/ai/generation-provider.ts`）：生成类 AI 能力，不要求联网搜索：
  - `detectType(noteContent, typeDescriptions): Promise<string>` — 步骤 1：识别笔记类型
  - `generateTags(context: TagGenContext): Promise<FacetTagMap>` — 步骤 2：按 type 生成标签
  - `generateSynonyms(tag, facet, noteContext): Promise<string[]>` — Regenerate：生成同义候选

- **`VerificationProvider` 接口**（`src/ai/verification-provider.ts`）：验证类 AI 能力，**要求联网搜索能力**：
  - `verifyTag(tag, facet): Promise<VerificationResult>` — 验证标签真实性，返回确认/否认 + 来源 URL

- **`OpenAICompatibleProvider`**（`src/ai/openai-compatible.ts`）：处理 OpenAI chat completion 格式的请求/响应的基类。所有 provider 继承此类，仅覆盖 `baseUrl`、`defaultModel`、`headers` 等配置差异。响应解析包含 JSON 提取（从 markdown code block 或纯 JSON 中提取结构化输出）。
  - **只实现 `GenerationProvider`**：`DeepSeekProvider`（不具备联网搜索，仅用于生成）
  - **同时实现 `GenerationProvider` + `VerificationProvider`**：`QwenProvider`、`KimiProvider`、`PerplexityProvider`（具备联网搜索能力，可同时用于生成和验证）
  - 设置 UI 中 `verification_provider` 下拉列表**只显示支持 `VerificationProvider` 的 provider**，从 UI 层杜绝错误配置

- **`PromptAssembler`**（`src/ai/prompt-assembler.ts`）：组装两步 AI 调用的 prompt 文本。**依赖 PromptFilterBuilder（M3）提供 taxonomy 候选/黑名单 + SchemaResolver（M3）提供 facet 定义/enum values**：
  - **步骤 1 prompt**：system role（librarian-taxonomist）+ 12 种 type 名称/描述 + 笔记全文 → 返回 type 名称。预估 500-800 token
  - **步骤 2 prompt**：按 facet 分区组装，**每种 value_type 不同策略**：
    - `taxonomy`：候选标签列表 + 黑名单（来自 PromptFilterBuilder）+ "可从列表选择或建议新词"
    - `enum`：完整 `values` 列表（来自 SchemaResolver）+ "只能从中选择，不可自创"
    - `wikilink`：vault 中已有的相关笔记名列表（来自 WikilinkCandidateCollector）+ `[[Name]]` 格式要求 + "可使用已有名称或创建新名称"
    - `free-text`：facet 描述 + 格式要求（如 venue 含年份）
    - `date`：`YYYY-MM-DD` 格式要求
  - **Regenerate prompt**：当前标签 + facet 上下文 + "产生同义/近义词，不可产生不同概念" 约束

- **`AIResponseValidator`**（`src/ai/ai-response-validator.ts`）：校验 AI 步骤 2 返回的 `{ facet: [tags] }` 映射，防止非法输出污染 staging。位于 PromptAssembler（构建请求）和 AnalysisOrchestrator（消费结果）之间。校验规则：
  1. **Facet 白名单过滤**：丢弃不在当前 type schema 中的 facet，记录 warning 日志
  2. **TagNormalizer 统一调用**：所有 taxonomy 值强制经过 TagNormalizer 规范化
  3. **Enum 值校验**：不在 `values` 列表中的值 → 尝试模糊匹配（如 `"english"` → `"en"`），匹配失败则丢弃并记录 warning
  4. **单值/多值规范化**：`allow_multiple: false` 的 facet 收到数组 → 取第一个；`allow_multiple: true` 收到字符串 → 包装为数组
  5. **空值过滤**：移除空字符串、null、undefined 值
  - 依赖 SchemaResolver（M3）获取当前 type 的 facet 定义和 enum values

- **`WikilinkCandidateCollector`**（`src/ai/wikilink-candidate-collector.ts`）：从 vault 中收集 wikilink 候选。通过 `app.metadataCache` 扫描全库已有 YAML 中**所有** wikilink 类型 facet（`scholar`、`people`、`person`、`participants`、`collaborator`、`instructor`、`provider`、`company`）的值 → 提取 `[[Name]]` → **全部合并为一个去重池**（不按原始 facet 分组）。为任何 wikilink facet 组装 prompt 时，均从此统一池中获取候选列表。**不做额外缓存**，`metadataCache` 本身是 Obsidian 维护的内存级缓存。冷启动时候选为空，AI 从笔记内容提取名称，随使用逐步积累。
  - **统一池的设计理由**：同一人可能在不同 facet 下出现（如 `[[Li-Fei-Fei]]` 作为 `scholar` 和 `collaborator`），统一池确保所有已知人名在任何 wikilink facet 中都可被推荐。人名列表通常为几十到几百条（约 500 token），对 prompt 长度影响极小，AI 能结合笔记内容和 facet 描述准确选择。

- **`VerificationPipeline`**（`src/verification/verification-pipeline.ts`）：两级验证编排器。**只接收 AnalysisOrchestrator 已确认不在 registry 中的新词**（库内标签在 orchestrator 中已过滤），每个标签独立并发走两级验证：
  1. `WikipediaClient.lookup(label)` → 命中 → `wiki_verified` badge
  2. `AIVerifier.verify(label, facet)` → 确认 → `search_verified` badge；存疑 → `needs_review` badge
  - 新标签进入 staging 时 badge 为 `verifying`（⚪），操作按钮禁用
  - 每个标签完成后立即通过事件通知（供 UI 逐个刷新 badge 并启用按钮），不等全部完成
  - `use_knowledge_base: false` 时跳过第 1 级；`use_knowledge_base: true` 时通过 NetworkMonitor ping 检测 Wikipedia 可达性，不可达自动跳到第 2 级

- **`WikipediaClient`**（`src/verification/wikipedia-client.ts`）：封装 Wikipedia REST API（`/w/api.php?action=query&titles=...`），处理重定向（`#REDIRECT`）和消歧义页面。网络不可达时返回 miss（不报错），让 pipeline 继续到第 3 级。

- **`AIVerifier`**（`src/verification/ai-verifier.ts`）：使用具有联网搜索能力的 AI provider（Qwen/Kimi/Perplexity）验证标签真实性。prompt 要求返回确认/否认 + 来源 URL。

- **`VerificationQueueManager`**（`src/verification/verification-queue-manager.ts`）：管理 `verification-queue.json`。离线时将待验证标签入队；监听 NetworkMonitor 的 `online` 事件，自动批量重试。记录 `attempts` 计数，超过阈值标记为 `needs_review`。
  - **队列按 `tag_label` 去重**：同一个标签被多篇笔记触发时只保留一条记录，`source_notes` 数组记录所有来源笔记路径（避免同一标签重复验证，批量处理 400 篇笔记时尤为关键）
  - **验证完成后广播更新**：不仅更新 `source_notes` 中的笔记，而是**扫描整个 StagingStore**，将所有包含该标签且 badge 为 `verifying` 或 `needs_review` 的条目统一更新为验证结果。同时检查 RegistryStore：标签已在 registry 中则更新 `verified_by`

- **`RateLimiter`**（`src/ai/rate-limiter.ts`）：Token Bucket 算法，按 provider 维度限速。`acquire(): Promise<void>` 在令牌可用前阻塞。批量处理时防止 API 被封。

**功能清单**：
- `src/network/network-monitor.ts`
- `src/network/http-client.ts`
- `src/ai/generation-provider.ts`（生成接口定义）
- `src/ai/verification-provider.ts`（验证接口定义）
- `src/ai/openai-compatible.ts`（基类）
- `src/ai/providers/deepseek.ts`（仅 GenerationProvider）、`qwen.ts`、`kimi.ts`、`perplexity.ts`（GenerationProvider + VerificationProvider）
- `src/ai/prompt-assembler.ts`
- `src/ai/ai-response-validator.ts`
- `src/ai/wikilink-candidate-collector.ts`
- `src/ai/rate-limiter.ts`
- `src/verification/wikipedia-client.ts`
- `src/verification/ai-verifier.ts`
- `src/verification/verification-pipeline.ts`
- `src/verification/verification-queue-manager.ts`

**测试策略**：
- AI 调用：mock HTTP 响应，验证 prompt 构建正确（包含正确的候选标签、黑名单、facet schema）、响应 JSON 解析正确
- 两步流程端到端：mock 步骤 1 返回 `"academic"` → 验证步骤 2 prompt 包含 academic 的 facet 定义和对应标签子集
- AIResponseValidator：AI 返回非法 facet → 丢弃；enum 值 `"english"` → 模糊匹配为 `"en"`；`allow_multiple: false` 收到数组 → 取第一个；taxonomy 值未经规范化 → 自动 normalize
- 验证管线：mock 两个 tier，测试 fallthrough（tier 1 Wikipedia miss → tier 2 AI hit → 返回 `search_verified`）、全 miss → `needs_review`
- 并发验证：5 个标签同时验证，不同完成顺序，事件均正确发出
- 离线队列去重：同一标签从 3 篇笔记入队 → 队列中只有 1 条记录，`source_notes` 含 3 个路径
- 离线队列广播：验证完成 → staging 中所有包含该标签的笔记 badge 均更新
- 离线队列：入队 → 模拟 online 事件 → 自动重试 → 成功后出队
- Rate limiter：突发请求被正确节流，限速后请求排队等待
- NetworkMonitor：API Key 为空 → 不发 ping，状态为 `not_configured`；generation 可达 + verification 不可达 → `isFullyOnline()` 返回 `false`；tooltip 文本包含正确的 provider 名称和原因

**验收标准**：
- 配置 Generation + Verification API Key 后，对一篇笔记执行步骤 1 + 步骤 2，返回结构化 `{ facet: [tags] }` 映射（经 AIResponseValidator 校验后）
- taxonomy 标签自动走验证管线，每个标签独立完成后事件触发
- Wikipedia 被墙时自动降级到第 2 级（AI 搜索）
- 离线时验证入队，联网后自动重试，同一标签不重复验证
- 无 API Key 时红灯 + 悬停提示"未配置 API Key"（非原始 HTTP 错误码）
- `verification_provider` 设置下拉列表不显示不支持验证的 provider（如 DeepSeek）

---

### M5：标签生命周期操作

**目标**：实现 Accept/Delete/Edit/Regenerate 四种用户操作 + Type 操作的完整业务逻辑。这是连接 AI 输出和用户决策的核心调度层——上承 M4 的 AI/验证输出，下接 M2 的持久化和 M3 的 YAML 写入。

**依赖**：M2（所有 Store）、M3（FrontmatterService、SchemaResolver、ContentHasher）、M4（GenerationProvider、VerificationPipeline、AIResponseValidator）

**关键抽象**：

- **`AnalysisOrchestrator`**（`src/operations/analysis-orchestrator.ts`）：编排单篇笔记的完整分析流程，是"分析当前笔记"命令的核心实现：
  1. 调用 `GenerationProvider.detectType()` → 获得 type
  2. 调用 `PromptFilterBuilder.build(type)` → 获得候选标签子集 + 黑名单
  3. 调用 `GenerationProvider.generateTags(type, candidates, blacklist, note)` → 获得 `facet→tags` 映射
  4. **AIResponseValidator 校验**：过滤非法 facet、规范化 taxonomy 值、校验 enum 值、处理单值/多值不匹配
  5. 本地组装：每个 tag 通过 TagMatcher 与 registry 匹配 → 区分"库内"（🟢）和"新词"
  6. 全部结果写入 `StagingStore`（同时通过 `ContentHasher` 记录笔记 body 的 `content_hash`）：库内标签 badge 为 `registry`（🟢），新词 badge 为 `verifying`（⚪）
  7. 新词并发走 `VerificationPipeline` → badge 从 ⚪ 异步更新为 🔵 / 🟡（UI 通过事件订阅实时刷新，按钮从禁用变为启用）
  - **重新分析**：如果笔记已有 YAML 标签，先读取现有标签，AI 建议中与现有标签匹配的自动标记 `user_status: "accepted"`，新建议为 `"pending"`，现有但未被 AI 建议的标签保持不变（不进 staging，不删除）。重新分析覆盖该笔记的旧 staging 数据

- **`TagOperationExecutor`**（`src/operations/tag-operation-executor.ts`）：纯业务逻辑，不涉及 UI。**所有 registry 写入（入库、黑名单）统一推迟到 `applyAll`**，逐条操作仅修改 staging 状态：
  - `accept(notePath, type, facet, tagLabel)` → 标记 staging 中 `user_status: "accepted"`（registry 写入推迟到 applyAll）
  - `delete(notePath, type, facet, tagLabel)` → 标记 staging 中 `user_status: "deleted"`。**不触发任何 registry 操作，不产生黑名单**
  - `edit(notePath, type, facet, oldTag, newTag)` →
    - newTag 入 staging 替代 oldTag（badge: 在线时为 `verifying` 并走验证管线，离线时为 `needs_review`）
    - oldTag 记入 newTag 的 `replaces` 数组（如已有 `replaces` 链则继承：`[...oldTag.replaces, oldTag.label]`）
    - **registry 不立即变更**，applyAll 时统一处理
  - `regenerate(notePath, type, facet, tag)` →
    - 调用 `GenerationProvider.generateSynonyms(tag, facet, noteContext)` → 返回候选列表
    - 候选列表暂存于内存（**不持久化**，关闭侧边栏后丢失）
    - 用户选择后：选中词替换原词入 staging，原词 + 未选中候选全部记入 `replaces` 数组
  - `applyAll(notePath)` → 收集该笔记所有 `user_status: "accepted"` 的标签，**统一执行所有 registry 操作**：
    1. 🟢 registry badge → 仅写入 YAML（registry 不变）
    2. 🔵/🟡 新 badge → 写入 YAML + `RegistryStore.addTag()`（`verified_by` 取决于 badge）
    3. 标签已有但当前 facet 不在其 `facets[]` 中 → `RegistryStore.expandFacets()` 自动追加
    4. 处理 `replaces` 链：链中所有标签 → `RegistryStore.rejectTag(label, rejectedInFavorOf: 最终标签)`
    5. **构建 `TagWriteData`**：从 accepted 标签中提取本次涉及的 type 列表和各 type 的 facet→tags 映射，然后调用 `FrontmatterService.write(file, tagWriteData)` 执行增量合并写入。`write()` 内部读取现有 YAML → 将新 type 追加到 `type` 数组 → 合并 type 块 → 保留不在本次写入中的现有 type 块 → `_tag_version` 递增
    6. **StagingStore 增量清理**：仅移除 `user_status` 为 `accepted` 或 `deleted` 的标签条目；**`pending` 的标签保留在 staging 中**（如多 type 场景用户只审核了部分 type）。当某 type 下所有标签均已处理（无 pending）时移除该 type 块；当笔记下所有 type 块均已清空时移除整个笔记条目

- **`TypeOperationExecutor`**（`src/operations/type-operation-executor.ts`）：
  - `changeType(notePath, oldType, newType)` → **等同于 `deleteType(oldType)` + `addType(newType)`**：先移除 staging 中旧 type 数据 + YAML 中旧 type 块（如已写入），再以 newType 独立执行步骤 2-6（跳过步骤 1）
  - `addType(notePath, additionalType)` → 以 additionalType **独立**执行步骤 2-6（不携带现有 type 信息，§2.3 中的"完全独立调用"），结果追加到 staging
  - `deleteType(notePath, type)` → 从 staging 中移除该 type 整块；如果该 type 已写入 YAML 则通过 `FrontmatterService.removeTypeBlock()` 一并移除

**功能清单**：
- `src/operations/analysis-orchestrator.ts`
- `src/operations/tag-operation-executor.ts`
- `src/operations/type-operation-executor.ts`

**测试策略**：
- Accept：仅更新 staging `user_status: "accepted"`，**registry 在此阶段无变化**
- Delete：staging 更新为 deleted，registry 无任何变化
- Edit：新词替换旧词入 staging，`replaces` 包含旧词，**registry 在此阶段无变化**
- Edit 链式：A→B→C，C 的 `replaces` 为 `["A", "B"]`
- Regenerate：候选列表返回后，选择一个替换，`replaces` 包含原词 + 未选中候选
- `applyAll` 🟢 标签：staging 移除，YAML 写入，registry 无变化
- `applyAll` 🔵 标签：YAML 写入 + registry 新增 verified 条目（`verified_by` 正确）
- `applyAll` 🟡 标签：YAML 写入 + registry 新增（`verified_by: "manual"`）
- `applyAll` 已有标签到新 facet：`RegistryStore.expandFacets()` 被调用
- `applyAll` 含 `replaces` 链：链中所有标签入黑名单，`rejected_in_favor_of` 指向最终标签
- `applyAll` 增量合并：已有 YAML 中不在 staging 里的标签保持不变
- `applyAll` pending 保留：多 type 笔记中一个 type 全部 accepted、另一个 type 全部 pending → apply 后 pending 的 type 仍在 staging 中
- `changeType`：旧 type staging 清除 + YAML 旧 type 块移除，新 type 结果填入
- `addType`：不影响已有 type 数据，完全独立
- `deleteType`：staging + YAML 中该 type 整块移除
- 重新分析：已有 YAML 标签自动 accepted，新建议 pending，未建议的已有标签不受影响

**验收标准**：
- 对一篇笔记完成分析 → 逐标签操作 → 应用，YAML 和 registry 状态均与 §三 定义一致
- Type 操作（修改/增加/删除）正确执行，不产生跨 type 数据泄漏
- Regenerate 黑名单机制正确（选中词不入黑名单，其余全入）

---

### M6：侧边栏 UI

**目标**：右侧边栏面板，包含双 Tab 界面——Tab A「标签审核」（手动/AI 模式）和 Tab B「标签模式」（Schema Editor），是用户与标签系统交互的主界面。

**依赖**：M2（RegistryStore、SchemaStore，手动模式读取标签库，Schema Editor 读写 schema）、M3（FrontmatterService，读取当前 YAML；SchemaResolver）、M5（AnalysisOrchestrator、TagOperationExecutor、TypeOperationExecutor）

**关键抽象**：

- **`TagReviewView extends ItemView`**（`src/ui/tag-review-view.ts`）：注册到 Obsidian 右侧边栏（`registerView`）。顶部为 Tab 切换：`[📋 标签审核]` `[⚙️ 标签模式]`。监听 `active-leaf-change` 事件，切换笔记时自动刷新 Tab A 内容。

- **Tab A：标签审核**，有两种模式：
  - **手动模式**（默认态 / 离线时）：展示当前笔记的 YAML frontmatter 标签（通过 FrontmatterService 读取）；每个 facet 提供下拉选择器（从 registry 按 facet 过滤）+ 手动键入输入框；手动键入的新 taxonomy 词自动走 TagNormalizer，库内匹配为 🟢，新词为 🟡（同时入 `verification-queue.json`，联网后后台验证）
  - **AI 模式**（在线 + 已分析后）："分析"按钮触发 AnalysisOrchestrator；按 type → facet → tag 三级结构展示 staging 数据；验证 badge 逐个刷新（订阅 VerificationPipeline 事件）
  - **批量打标后自动进入 AI 模式**：当用户打开某篇笔记时，如果 staging 中已有该笔记的待审核数据（来自后台批量处理），侧边栏自动展示 staging 标签，无需再点"分析"

- **Tab B：标签模式（Schema Editor）**，两级可展开列表：
  - **第一级**：所有 type 列表（名称 + label），每个 type 旁有展开/折叠按钮。底部有"+ 新增 Type"按钮
  - **展开某 type 后**：显示 required_facets 和 optional_facets 列表（可增删 facet），可编辑 type 的 label 和描述
  - **点击某 facet**：展开属性编辑面板——description、value_type（只读）、allow_multiple 开关；enum 类型显示可选值列表（可增删）
  - **Schema 修改/删除的同步策略**：
    - **新增**（新 type、新 facet、新 enum 值）→ 直接生效，不弹窗
    - **修改/删除**（重命名或移除 type/facet/enum 值）→ 弹窗显示受影响笔记列表，三个按钮：`[同步更新]` `[仅修改模式]` `[取消]`
    - "同步更新"：**YAML + Registry + Staging 同时更新**（如重命名 facet 时，YAML 键名、registry 中标签的 `facets` 数组、staging 中的 facet 键名一起改），执行前自动 `BackupManager` 备份 registry + 提示用户建议 git commit
    - "仅修改模式"：只改 schema，不动已有 YAML 和 registry
  - **不支持的操作**：修改 facet 的 `value_type`（如 enum → taxonomy），需直接编辑 JSON 文件

- **UI 组件**（`src/ui/components/`）：
  - **`TagChip`**：根据 `value_type` 渲染不同形态。**taxonomy**：badge 颜色圆点 + 标签文本 + 操作按钮组（⚪ 全禁用；🟢 显示 ✓ ✗；🔵🟡 显示 ✓ ✗ ✎ ↻），文本部分为可编辑 `<input>`（§9.4）。**enum**：下拉选择器 + ✓ ✗（无圆点）。**wikilink**：输入框 + vault 内自动补全 + ✓ ✗（无圆点）。**free-text**：纯文本输入框 + ✓ ✗（无圆点）。**date**：日期选择器/文本框 + ✓ ✗（无圆点）
  - **`FacetSection`**：facet 标题 + TagChip 列表 + "添加"按钮
  - **`TypeSelector`**：type 下拉选择 + "修改 type" / "增加 type" / "删除 type" 按钮
  - **`NetworkIndicator`**：状态灯（🟢/🔴）+ 点击刷新 + **🔴 时悬停 tooltip 显示具体原因**（如"生成服务 (deepseek): ✓ · 验证服务 (qwen): ✗ 未配置 API Key"）。通过 `NetworkMonitor.getStatusTooltip()` 获取文本。订阅 NetworkMonitor 状态变更事件
  - **`CandidateList`**：Regenerate 候选列表浮层（临时 UI，不持久化，关闭后丢失）
  - **`SchemaTypeList`**：Tab B 的 type 可展开列表
  - **`SchemaFacetEditor`**：Tab B 的 facet 属性编辑面板
  - **`SchemaSyncDialog`**：Schema 修改/删除时的同步确认弹窗

- **事件订阅**：
  - `StagingStore` 变更 → 刷新 tag 列表
  - `VerificationPipeline` 单标签完成 → 更新该标签的 badge 颜色 + 启用操作按钮
  - `NetworkMonitor` 状态变更 → 切换手动/AI 模式可用性 + 更新指示器
  - `SchemaStore` 变更 → 刷新 Tab B

**功能清单**：
- `src/ui/tag-review-view.ts`：ItemView 主视图（含 Tab 切换）
- `src/ui/manual-mode-renderer.ts`：手动模式渲染
- `src/ui/ai-mode-renderer.ts`：AI 模式渲染
- `src/ui/schema-editor-renderer.ts`：Schema Editor Tab B 渲染
- `src/ui/components/tag-chip.ts`
- `src/ui/components/facet-section.ts`
- `src/ui/components/type-selector.ts`
- `src/ui/components/network-indicator.ts`
- `src/ui/components/candidate-list.ts`
- `src/ui/components/schema-type-list.ts`
- `src/ui/components/schema-facet-editor.ts`
- `src/ui/components/schema-sync-dialog.ts`
- `styles.css`：全部使用 `.toot-` 前缀

**测试策略**：
- Tab 切换：A/B Tab 切换正确，内容不丢失
- 无标签笔记：手动模式正确渲染空态，可手动添加标签
- 已有标签笔记：正确读取并显示 YAML 中的 type/facet/tags
- AI 分析后：staging 数据正确渲染，badge 颜色对应（⚪🟢🔵🟡）
- ⚪ 验证中标签：按钮禁用，验证完成后自动启用
- 操作测试：点击 ✓/✗/✎/↻ 仅更新 staging，不触碰 registry
- Regenerate：候选列表展开/选择/收起
- 切换笔记：视图自动刷新到新笔记的标签状态
- 离线：分析按钮禁用并显示提示，手动模式可用
- staging 恢复：关闭侧边栏 → 重新打开 → staging 中 `pending` 状态的标签恢复显示
- 批量打标后打开笔记：staging 数据自动展示
- `checkCallback` 使用 `getActiveFile()` 而非焦点检测（§9.5）
- Schema Editor：type 增删改、facet 增删改、enum 值增删
- Schema 同步：修改/删除时弹窗正确显示受影响笔记，"同步更新"正确修改 YAML + registry + staging，"仅修改模式"只改 schema
- 非 taxonomy UI：enum 显示下拉、wikilink 显示自动补全输入框、free-text 显示文本输入框、date 显示日期选择
- content_hash 检测：笔记内容变更后打开审核，显示"笔记已修改"横幅提示

**验收标准**：
- Ribbon 图标点击打开侧边栏，Tab A 显示当前笔记标签，Tab B 显示 Schema Editor
- 网络状态指示器正确（🟢/🔴），单击可刷新
- 完整单篇流程：分析 → ⚪ 验证中 → badge 逐个刷新为 🔵/🟡 → 逐标签操作 → 应用 → YAML 更新 + registry 统一写入
- 手动键入标签 → 库内为 🟢，新词为 🟡 + 入验证队列
- 修改/增加/删除 type 功能正常
- 关闭重开侧边栏后 staging 状态恢复
- Schema Editor：type/facet 的增删改查全功能正常
- Schema 修改同步：YAML + registry + staging 正确联动更新，备份已创建

---

### M7：批量处理

**目标**：对全库笔记批量 AI 打标，后台运行不阻塞用户。带过滤、并发控制、进度追踪、暂停恢复、错误隔离、跨重启恢复。处理结果写入 staging，用户后续通过侧边栏逐篇审核。

**依赖**：M4（RateLimiter）、M5（AnalysisOrchestrator）

**关键抽象**：

- **`VaultScanner`**（`src/batch/vault-scanner.ts`）：枚举 vault 中的 markdown 文件，返回有序文件列表（按路径排序，确保可恢复性）。支持过滤条件：
  - 按文件夹包含/排除
  - `skip_tagged: true` 跳过已有 `_tagged_at` 的笔记
  - 结果为 `TFile[]`，供 BatchProcessor 消费

- **`BatchProcessor`**（`src/batch/batch-processor.ts`）：按 `batch_concurrency` 设置控制并发度（默认 1，用户可调），通过信号量 + RateLimiter 控制。每个文件调用 AnalysisOrchestrator，结果写入 staging（**含 `content_hash`**，用于后续检测笔记是否被修改）。
  - 发出进度事件：`{ processed, total, current_file, failed_count }`
  - **错误隔离**：单个文件处理失败（AI 调用报错、YAML 损坏等）不中断批次，记录错误后跳过，继续下一个
  - 通过 RateLimiter 控制 API 调用频率
  - 支持 `pause()` / `resume()` / `terminate()` 操作
  - **后台运行**：不阻塞用户操作，用户可正常编辑笔记
  - **内容变更检测**：用户打开批量处理过的笔记审核时，侧边栏比对 `content_hash` 与当前文件哈希，不匹配则显示横幅提示"⚠️ 此笔记在分析后已被修改，标签建议可能不准确。[重新分析]"

- **`BatchStateManager`**（`src/batch/batch-state-manager.ts`）：将批量处理进度持久化到 `batch-state.json`（§3.6 格式）。
  - 每处理完一个文件更新 `processed` 计数
  - Obsidian 关闭后重启 → 检测到未完成的 batch（`status: "paused"` 或 `"running"`）→ 提示用户是否恢复
  - 恢复时从 `processed + 1` 处继续（文件列表排序确保一致性）

- **`BatchStatusBarItem`**（`src/ui/batch-status-bar.ts`）：Obsidian 右下角状态栏项。
  - 批量处理运行时显示进度摘要（如 `"批量打标 127/400"`）
  - 点击状态栏项 → 打开 BatchProgressModal

- **`BatchProgressModal extends Modal`**（`src/ui/batch-progress-modal.ts`）：批量处理的**进度查看窗口**（非审核界面，审核在侧边栏完成）。
  - 顶部：进度条 + 暂停/恢复/终止按钮
  - 中部：可展开的笔记列表，按状态分组：
    - **待审核**（staging 中有待确认标签）：显示笔记名 + 待审核标签数 + `[跳转]` 按钮
    - **已完成**（用户已审核并应用）
    - **失败**（处理出错）：显示错误原因 + `[重试]` 按钮
  - **跳转行为**：点击 `[跳转]` → 关闭 Modal → 在编辑器中打开该笔记 → 侧边栏自动展示该笔记的 staging 标签。点击状态栏可重新打开 Modal（从 `batch-state.json` 恢复状态）

**功能清单**：
- `src/batch/vault-scanner.ts`
- `src/batch/batch-processor.ts`
- `src/batch/batch-state-manager.ts`
- `src/ui/batch-status-bar.ts`
- `src/ui/batch-progress-modal.ts`

**测试策略**：
- Scanner：文件夹过滤正确，`skip_tagged` 跳过已打标笔记，排序一致
- Processor：模拟 10 个文件，第 3 个报错 → 其余 9 个正常完成，进度事件准确
- 并发：`batch_concurrency: 3` 时同时处理 3 个文件，RateLimiter 正确节流
- State：处理 5/10 → 模拟重启 → 恢复后从第 6 个继续
- 暂停/恢复：暂停后无新 API 调用，恢复后继续下一个文件
- 状态栏：显示正确进度，点击打开 Modal
- Modal 跳转：关闭 Modal → 打开笔记 → 侧边栏展示 staging
- Rate limiting：批量处理不超过 API 速率限制

**验收标准**：
- 命令面板"批量打标"启动后台处理，状态栏显示进度
- 点击状态栏打开 Modal，笔记列表正确分组
- 点击"跳转"后正确导航到笔记 + 侧边栏展示标签
- 暂停/恢复/终止正常工作
- 单文件错误不中断批次
- Obsidian 重启后可从上次进度继续
- 并发度可通过设置调整

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
      │     → 用户 Accept → staging 标记 accepted
      │     → 用户 Delete → staging 标记 deleted
      │
      └── 未命中 → badge 初始化为 ⚪ verifying → 进入 staging
              │     操作按钮禁用
              │
              ├── Wikipedia 确认  → badge 更新为 🔵 wiki_verified，按钮启用
              ├── AI 搜索确认    → badge 更新为 🔵 search_verified，按钮启用
              └── 都未确认       → badge 更新为 🟡 needs_review，按钮启用
              │
              └── 展示给用户，等待操作：
                  │
                  ├── Accept  → staging 标记 accepted
                  │
                  ├── Delete  → staging 标记 deleted
                  │             不产生黑名单
                  │
                  ├── Edit    → 新词替换旧词入 staging
                  │             旧词记入 replaces 数组
                  │             新词走验证管线（在线 ⚪ / 离线 🟡）
                  │
                  └── Regenerate → 展开候选列表
                        → 选一个替换原词
                        → 原词 + 未选中候选记入 replaces
                  │
                  └── applyAll（统一写入，所有 registry 操作在此刻执行）：
                        → 🟢 accepted → 仅写入 YAML
                        → 🔵/🟡 accepted → 写入 YAML + registry verified
                        → replaces 链中所有标签 → registry rejected
                        → facets 自动追加
                        → staging 条目移除
```

**用户侧状态模型**：

| 状态 | 含义 | 存在位置 |
|------|------|---------|
| `verified` | 已入库的正式标签 | tag-registry.json |
| `rejected` | 黑名单标签 | tag-registry.json（带 `rejected_in_favor_of`） |
| `pending_verification` | 等待网络验证 | verification-queue.json |
| `pending_user` | 已验证/验证失败/验证中，等待用户确认 | tag-staging.json |

**Badge 属性**（信心级别，非状态，用于 UI 展示）：

| Badge | 颜色 | 含义 |
|-------|------|------|
| `verifying` | ⚪ 灰色 | 验证管线进行中（操作按钮禁用） |
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

---

## 十、第三轮架构审核修订（2026-03-12）

> 全量审查后发现的 13 个矛盾/缺失/边界情况，经讨论后确认的修订。

| # | 严重度 | 问题 | 修订 | 影响位置 |
|---|--------|------|------|---------|
| 1 | 🟢 低 | VerificationPipeline Tier 1（registry 查找）与 AnalysisOrchestrator 重复 | Pipeline 改为两级（Wikipedia → AI 搜索），库内匹配在 Orchestrator 中完成 | §2.4, M4 |
| 2 | 🔴 高 | `applyAll` 移除整个笔记 staging 条目，多 Type 场景丢失 pending 标签 | applyAll 仅移除 accepted/deleted 条目，保留 pending | §3.5, M5 |
| 3 | 🟡 中 | 离线验证队列成功后 staging badge 不同步 | VerificationQueueManager 同时检查 registry 和 staging 两个位置 | §2.8, M4 |
| 4 | 🔴 高 | `changeType` 不处理已写入的 YAML，旧 type 块残留 | changeType = deleteType + addType | M5 |
| 5 | 🔴 高 | Schema 中 type 缺少 `description` 字段，AI 步骤 1 无法区分相似 type | 每个 type 增加 description 字段 | §3.1 |
| 6 | 🟡 中 | 非 taxonomy 标签（enum/wikilink/free-text/date）的 UI 行为未定义 | 按 value_type 定义不同 UI 组件形态 | §2.7, M6 |
| 7 | 🟡 中 | ⚪ 验证中时点"应用"行为未定义 | ⚪ 标签因按钮禁用无法 Accept → 自然保留在 staging（依赖 #2） | §2.7 |
| 8 | 🟢 低 | WikilinkCandidateCollector 跨 facet 候选不共享 | 所有 wikilink 候选合并为一个去重池，不按 facet 分组 | M4 |
| 9 | 🟡 中 | 批量处理与手动编辑竞争，staging 标签可能基于过时内容 | staging 中记录 content_hash，审核时比对提示 | §3.5, M7 |
| 10 | 🟡 中 | "全部接受"/"全部删除"按钮语义不明 | 只影响 pending 标签，不翻转已有 accepted/deleted 决策 | §2.7 |
| 11 | 🟢 低 | 多 Type 嵌套 YAML 的 Dataview 查询复杂 | 不加聚合字段，后续用 DataviewJS 解决 | §3.3 |
| 12 | 🟡 中 | Schema 修改同步未考虑 staging 数据 | "同步更新"时同时更新 YAML + Registry + Staging | M6 |
| 13 | 🟢 低 | `_tag_version` 全笔记级别，无法追踪 per-type 变更 | 保持全局版本号，文档说明限制 | §3.3 |

---

## 十一、第四轮架构审核修订（2026-03-13）

> 深度审阅开发计划后发现的 7 个阻塞性问题，经讨论后确认的修订。所有修订已写入对应章节。

| # | 问题 | 修订 | 影响位置 |
|---|------|------|---------|
| 1 | `applyAll` 部分应用时 `FrontmatterService.write()` 的合并语义缺失，`TagWriteData` 类型未定义。多 type 笔记只 apply 一个 type 时，YAML 中 `type` 数组和 type 块的写入行为不明确 | M1 types.ts 增加 `TagWriteData` 类型定义（含增量合并语义说明）；M3 `FrontmatterService.write()` 改为增量合并：内部读取现有 YAML → 合并新 type 块 → 保留不在本次写入中的现有 type 块 → `type` 数组追加逻辑；M5 `applyAll` 增加显式构建 `TagWriteData` 步骤 | M1, M3, M5 |
| 2 | `StagingStore` 无并发写入保护。VerificationPipeline 并发更新 badge、applyAll 清理条目、BatchProcessor 写入新分析结果三者可能同时操作 staging，`DataStore.update()` 的异步读-改-写在交叉执行时丢失数据 | `DataStore.update()` 内部维护写入队列（Promise 链），确保多个并发调用严格串行执行 | M2 |
| 3 | AI 响应的 Schema 校验层完全缺失。AI 可能返回不存在的 facet、不合法的 enum 值、错误的单值/多值格式，非法输出直接污染 staging | M4 新增 `AIResponseValidator`，位于 AI 响应返回后、写入 staging 前。执行 facet 白名单过滤、TagNormalizer 统一调用、enum 值模糊匹配、单值/多值规范化 | M4, M5 |
| 4 | `content_hash` 的计算范围未定义。包含 frontmatter 时 `applyAll` 写入标签会改变 hash 导致永远误报；不包含时才正确 | 明确定义 `content_hash` 只计算 frontmatter 之后的 body 内容。M3 新增 `ContentHasher` 工具类 | §3.5, M3, M5 |
| 5 | `NetworkMonitor` 将"未配置 API Key"等同于"离线"，新用户首次体验阻塞。且单一红绿灯无法表达 generation/verification 两个 provider 的独立状态 | 全链路判定：generation + verification 同时可达 = 🟢，任一不可达/未配置 = 🔴。API Key 为空时不发 ping，直接标记为"未配置"。🔴 时鼠标悬停 tooltip 显示每个环节的具体状态和原因（provider 名称取自用户设置）。NetworkMonitor 增加 `getStatus()`、`isFullyOnline()`、`getStatusTooltip()` 方法 | §2.8, M4, M6 |
| 6 | `verification-queue.json` 标签去重策略缺失。同一标签被多篇笔记触发时重复验证浪费 API，且验证完成后可能遗漏部分笔记的 staging badge 更新 | 队列按 `tag_label` 去重，`source_note` 改为 `source_notes` 数组。验证完成后广播更新：扫描整个 staging 中包含该标签的所有笔记条目，统一更新 badge | §3.4, M4 |
| 7 | `AIProvider` 接口混合生成和验证职责，DeepSeek 不具备联网搜索但被迫实现 `verifyTag`，运行时可能调用不支持的方法 | 拆分为 `GenerationProvider`（detectType/generateTags/generateSynonyms）和 `VerificationProvider`（verifyTag）两个独立接口。DeepSeek 只实现 GenerationProvider。设置 UI 中 verification_provider 下拉列表只显示支持验证的 provider | M4 |

*文档版本：7.0 | 日期：2026-03-13 | 状态：第四轮架构审核完成（7 项修订），8 模块开发计划就绪*
