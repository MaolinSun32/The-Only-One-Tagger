# The Only One Tagger — 审查与修订记录

> 从 dev-plan.md 迁移的历次架构审核记录。所有修订均已写入 dev-plan.md 对应章节。

---

## 第一轮实现复盘（2026-03-11）

> 第一轮实现后发现的缺陷，作为重新开发的补充需求。

### 1.1 严重：验证管线未接入标签生成主流程

代码存在但从未被调用。AI 建议新标签后直接以 `pending` 入库，跳过了 §2.4 的三级验证。必须在展示给用户前实时走 Tier 1→2→3 验证。

### 1.2 严重：Accept 不更新 registry

点 ✓ 只在内存中标记状态，不更新标签库。用户确认的标签应同时在 registry 标记为 `verified`（`verified_by: 'manual'`）。

### 1.3 中等：冷启动扫描无过滤

把所有 inline tag 不加过滤地塞入 registry，且全部默认 `facet: 'area'`。已移除，后续如恢复需加过滤规则。

### 1.4 UI：Tag chip 应可编辑

已改为 `<input>`，保留。

### 1.5 UI：Analyze 命令在侧边栏焦点时消失

`checkCallback` 应改用 `getActiveFile()` 检测。

### 1.6 架构备忘：混合模式的正确理解

§2.2 "YAML 为主，行内标签为辅"指的是**分工**，不是重复写入：
- YAML：插件管理的结构化 facet 标签
- 行内标签/tags 字段：用户手动的状态标记（`#todo`、`#review`），插件不管

---

## 第三轮架构审核修订（2026-03-12）

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

## 第四轮架构审核修订（2026-03-13）

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

*文档版本：7.0 | 日期：2026-03-13*

---

## 第五轮架构审核修订（2026-03-15）

> 深度审阅完整开发计划后发现的 9 个阻塞性问题，聚焦于业务层并发冲突、跨存储非原子写入、配置缺失。所有修订已写入对应章节。

| # | 问题 | 修订 | 影响位置 |
|---|------|------|---------|
| 1 | 批量处理与用户手动编辑存在写入冲突——BatchProcessor 后台覆盖用户正在操作的 staging 数据 | 侧边栏检测笔记是否在 batch 未处理队列中，若是显示等待态"⏳ 处理完成后可审核"，不加载 staging。batch 已处理完的笔记正常显示审核视图 | M6 Tab A, M7 |
| 2 | batch-state.json 用位置索引恢复进度，文件系统变更后出错 | 改为存储已处理文件的**相对路径集合** `processed_files`，恢复时重新扫描并过滤已处理路径 | §3.6, M7 |
| 3 | `applyAll` 跨 YAML/Registry/Staging 三个目标写入无事务保证，中途失败导致数据分裂 | 调整执行顺序：先写 YAML（最易失败）→ 再写 registry → 最后清理 staging。`addTag`/`rejectTag` 增加幂等性保证 | M5, M2 |
| 4 | 用户无法撤回 Accept/Delete 决策，误操作无法恢复 | ✓/✗ 改为三态切换按钮：pending↔accepted、pending↔deleted，用户可随时改主意直到点击"应用" | §2.7, M5, M6 |
| 5 | verification 侧缺少 `base_url` 配置，与 generation 侧不对称，用户无法使用代理/自部署端点 | `data.json` 补齐 `verification_base_url`，generation 和 verification 统一为四件套配置 | §3.7, M1, M4 |
| 6 | `verification-queue.json` 无生命周期管理，staging 清理后队列条目成为幽灵 | 增加三层清理：applyAll 后移除已入库标签、验证完成后始终移除条目、启动时清理已在 registry 中的条目 | M4, M5 |
| 7 | Schema 修改与正在运行的 batch/分析无互斥，导致跨笔记 schema 不一致 | batch 运行时锁定 Schema Editor；AnalysisOrchestrator 入口做 schema 快照；applyAll 做 facet 有效性校验 | M5, M6, M7 |
| 8 | TagMerger 全库 YAML 重写无断点恢复，中断后无法得知哪些文件已改 | 新增 `merge-state.json` 持久化合并进度，逐文件更新。Registry 写入放在所有 YAML 修改完成之后。启动时检测未完成合并 | M8, §2.6 |
| 9 | `data.json` 缺少 Regenerate 数量、候选标签上限、wikilink 池上限、AI 输出 token 限制等关键 AI 参数 | 补齐 `max_candidates_per_facet`(50)、`regenerate_count`(5)、`max_wikilink_candidates`(100)、`generation_max_tokens`(2048) | §3.7, M1, M4 |

**系统性风险总结**：

1. **业务层并发无协调**：DataStore 写入队列解决了数据层并发，但更高层的业务语义冲突（batch vs 用户手动操作、schema 修改 vs 正在运行的分析）此前完全没有保护
2. **跨多个持久化目标的非原子操作**：`applyAll` 写三处、`TagMerger` 写全库，都需要有序执行 + 幂等保证 + 断点恢复

*文档版本：8.0 | 日期：2026-03-15*

---

## 第六轮架构审核修订（2026-03-16）

> 深度审阅完整开发计划后发现的 10 个问题，经充分讨论后确认 7 项修正、撤回 3 项。聚焦于黑名单机制重设计、AI 配置简化、验证管线解耦、跨模块崩溃恢复、步骤编号消歧义。所有修订已写入 dev-plan.md 对应章节。

### 已实施的 7 项修正

| # | 问题 | 讨论过程 | 最终修订 | 影响位置 |
|---|------|---------|---------|---------|
| 1 | `max_candidates_per_facet` 按使用频率截断，但 tag-registry.json 无 `usage_count` 字段，PromptFilterBuilder（M3 纯计算层）无法执行全库扫描获取频率 | 第一轮未理解，第二轮用具体场景说明后达成共识：现代 LLM 上下文窗口充足，registry 规模在百级别，全量传入即可 | 删除 `max_candidates_per_facet` 配置项及截断逻辑，PromptFilterBuilder 全量返回所有 verified 标签 | §2.3, §3.7, M3 |
| 2 | Schema Editor "同步更新"执行跨全库 YAML 修改，但与 TagMerger 不同，缺少崩溃恢复机制（无进度持久化、无中断恢复、无进度 UI） | 第一轮提出即达成共识：复用 TagMerger 恢复机制 | 提取 `BulkYamlModifier` 共用基类供 TagMerger 和 Schema 同步复用；新增 `schema-sync-state.json` 逐文件追踪进度；增加进度 UI | §2.6, M6, M8 |
| 3 | 离线创建并 `applyAll` 的标签在联网后验证失败时，行为完全未定义。标签已在 YAML 和 registry 中，Notice 提醒后无后续纠正措施 | 第一轮提出即达成共识 | `TagEntry` 增加 `flagged: boolean` 字段；验证失败时 registry 标记 `flagged: true`；M8 标签浏览器增加"待复核标签"筛选器；侧边栏 flagged 标签显示 ⚠️；Notice 可点击跳转定位 | §2.4, §3.2, M2, M4, M8 |
| 4 | 黑名单传入 AI prompt 不可靠（AI 可能无视指令）+ Enum 模糊匹配无法实现为确定性算法（`"english"` → `"en"` 无标准字符串相似度可匹配） | 三轮讨论：①提出 enum 别名映射表方案 → ②用户指出与 taxonomy 黑名单机制相同可复用 → ③确认只发正式候选不发黑名单，硬编码安全网统一处理 taxonomy 和 enum。最终统一命名为"黑名单" | Prompt 只发正式候选不含黑名单；AIResponseValidator 增加 `resolveBlacklist()` 统一函数，硬编码解析 taxonomy 动态黑名单（registry rejected）和 enum 静态黑名单（schema blacklist 字段）；enum facet 定义增加 `blacklist: Record<string, string>` | §2.3, §2.4, §3.1, §3.2, M3, M4, M5, §8 |
| 5 | AI 配置使用 provider 下拉选择（deepseek/qwen/kimi/perplexity），需维护 4 个 provider 类 + 工厂机制，但所有服务均兼容 OpenAI chat completion 格式。且 verification AI 验证能力依赖搜索应独立配置 | 三轮讨论：①指出 provider factory 缺失 → ②用户提出废弃 provider 选择，全部用 apiKey/baseUrl/model → ③用户补充 generation 需多模态、verification 搜索由独立 Search API 提供（Brave/Tavily），采用 `search_type` 下拉选择 | 三组服务独立配置：Generation AI（多模态）、Verification AI（普通文本）、Search API（Brave/Tavily）。删除 4 个 provider 子类，只保留 `OpenAICompatibleProvider` 单一实现。新增 `SearchClient` + `BraveSearchAdapter`/`TavilySearchAdapter`。验证管线改为 Wikipedia → Search API 获取结果 → Verification AI 判定 | §2.5, §3.7, M1, M4 |
| 6 | Wikipedia 可达性检测职责在 NetworkMonitor 和 VerificationPipeline 之间悬空，且 NetworkMonitor 只管两个 provider 不包含 Wikipedia | 两轮讨论：①提出 Wikipedia ping 归属不明 → ②用户提出统一 HealthChecker 抽象，所有服务共用一个 ping 模块 | 创建 `HealthChecker` 通用抽象，每个外部服务实例化一个 checker（generation/verification/search/wikipedia）。新增 `NetworkStatusAggregator` 组合 checker 提供红绿灯和 tooltip。替代原 NetworkMonitor | §2.8, M4, M6 |
| 7 | `TypeOperationExecutor` 中 `addType` "执行步骤 2-6" 不对应任何已定义的步骤编号体系。§2.3 三步 vs Orchestrator 七步，按 Orchestrator 解读跳过了步骤 7（验证管线） | 三轮讨论：①②用户未理解 → ③用具体代码实现展示"按步骤 2-6 实现会导致新标签 badge 永远停在 ⚪"后理解。用户采纳方法名方案 | AnalysisOrchestrator 暴露 `analyzeNote()`（完整流程）和 `analyzeWithType()`（跳过 type 检测）两个方法。TypeOperationExecutor 改为引用方法名。§2.3 增加概念模型与实现步骤的映射注释 | §2.3, M5 |

### 已撤回的 3 项

| # | 问题 | 撤回原因 |
|---|------|---------|
| A | YAML 顶层键名（type 名称如 `project`、`journal`）与用户既有 frontmatter 碰撞导致数据丢失 | 用户判断不是问题，对 Vault 命名规范有把握 |
| B | RateLimiter 按 provider 维度限速，同一 provider 用于 generation + verification 时实际频率翻倍 | 用户认为不重要，429 错误被错误处理捕获即可 |
| C | RelationDiscoverer（M8）无消费者，relations 数据不参与任何自动化流程 | 用户保留，未来需要开发多层级标签体系 |

### 架构模式总结

1. **"AI 软约束 + 硬编码安全网"双层防线**：AI prompt 引导正确输出（软约束），AIResponseValidator 用确定性算法做兜底解析（安全网）。黑名单不再依赖 AI 遵守指令，而是由本地代码硬编码替换
2. **统一抽象消除职责悬空**：HealthChecker 统一所有外部服务 ping、`resolveBlacklist()` 统一 taxonomy/enum 黑名单解析、`BulkYamlModifier` 统一全库修改 + 崩溃恢复
3. **配置极简化**：废弃 provider 选择器，用户直接填写 apiKey/baseUrl/model，插件通过单一 OpenAI-compatible 实现类发送请求

*文档版本：9.0 | 日期：2026-03-16*

---

## 第七轮架构审核修订（2026-03-17）

> 深度审阅完整开发计划后发现 4 个问题，经充分讨论后确认 2 项修正、1 项暂缓、1 项参考实现后修正。

### 已实施的 2 项修正

| # | 问题 | 讨论过程 | 最终修订 | 影响位置 |
|---|------|---------|---------|---------|
| 1 | StagingStore 单文件写入队列在批量处理时的 I/O 瓶颈 + VerificationPipeline 批量处理时验证请求无界累积 | 初始分析以 400 篇为场景，提出内存缓存+合并写入方案。用户指出：①"走内存断电就丢了"②本质是 API 限流问题，应控制 batch 规模而非加代码复杂度③为什么一定要 batch 400 篇？限制在 50 篇不行吗？最终合并为一个解决方案 | `data.json` 新增 `max_batch_size` 配置项（默认 50）。`BatchProcessor` 到达上限时自动暂停并 Notice 提示，`OperationLock.release()`。用户通过命令面板重新启动（`skip_tagged` 跳过已打标笔记），逐批推进。50 篇规模下 StagingStore 写入队列和 VerificationPipeline 并发量均在可接受范围 | §3.7, M7 |
| 2 | Flagged 标签无法从全库 YAML 中批量移除——TagMerger 只支持 A→B 合并不支持 A→nothing 删除 | 参考了 tag-wrangler 实现：标签删除=重命名为空字符串，统一走 rename 流程。但 tag-wrangler 只处理顶层 `tags`/`aliases` 字段（CST 解析），本项目 YAML 是嵌套结构（`academic.domain: [...]`），`processFrontMatter` 操作 JS 对象更适合。确认改动不影响架构，只是 TagMerger 的扩展分支 | TagMerger 增加**删除模式**（target 为空时）：从全库 YAML 中移除标签（`allow_multiple: true` 从数组删元素，空则删 facet 键；`allow_multiple: false` 直接删键）；Registry 中直接删除条目。复用 BulkYamlModifier 崩溃恢复。§2.4 flagged 标签"删除"操作关联到此模式 | §2.4, M8 |

### 暂缓的 1 项

| # | 问题 | 暂缓原因 |
|---|------|---------|
| 3 | Edit/Regenerate 的全局黑名单副作用缺少安全防护——用户在一篇笔记的 Edit 操作会永久影响所有后续笔记的 AI 输出，Regenerate 候选中相关但不等价的概念可能被误入黑名单 | 用户判断这本质是标签粒度问题，后续会开发层级标签体系时统一处理，当前阶段不阻断 |

*文档版本：10.0-11.0 | 日期：2026-03-17*

---

## 第八轮架构审核修订（2026-03-17）

> 对第七轮修改进行全量通读复核，发现 2 个因新增功能引入的缺失。

| # | 问题 | 讨论过程 | 最终修订 | 影响位置 |
|---|------|---------|---------|---------|
| 1 | RegistryStore 缺少 `deleteTag()` 方法——TagMerger 删除模式最后一步需要"从 Registry 中彻底移除条目"，但 RegistryStore 的 8 个方法中无一能执行此操作。`rejectTag` 需要 `rejected_in_favor_of` 目标标签，删除模式没有目标 | 全量通读时发现，TagMerger 删除模式描述为"直接删除 A 条目"但 RegistryStore 方法列表无对应 API。开发者实现到 Registry 写入步骤时会阻断 | M2 RegistryStore 新增 `deleteTag(label: string): void`——从 registry `tags` 对象中彻底移除条目，递减 `meta.total_tags`。幂等：标签不存在时跳过。M2 测试策略增加对应用例 | M2, M8 |
| 2 | TagMerger 两种模式均未清理 StagingStore，applyAll 会撤销合并——合并 A→B 后 staging 中残留 A（accepted），用户 applyAll 时 Step 4 `addTag(A)` 会将已被 reject 的 A 重新覆盖为 verified，等于撤销黑名单 | 全量通读时发现，TagMerger 执行步骤（备份→YAML→Registry）全程不涉及 staging。若被操作标签同时存在于 staging 中（批量处理后未审核），残留条目会导致数据不一致 | TagMerger 执行步骤中，YAML 修改与 Registry 写入之间增加 **StagingStore 同步清理**：合并模式→将 staging 中 label A 替换为 B（保留状态不变）；删除模式→移除 staging 中 label A 的条目。M8 测试策略增加 3 条 staging 清理用例（含防撤销验证） | M8 |

*文档版本：12.0 | 日期：2026-03-17*
