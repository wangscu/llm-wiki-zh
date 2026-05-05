---
name: llm-wiki-zh
description: |
  在项目中构建和维护 LLM 策划的个人知识库。
  实现 Karpathy 的 LLM Wiki 模式（gist 442a6bf555914893e9891c11519de94f）。
  优化场景：书籍和论文研读讨论、代理会话保存、
  AI 模型开发（代码、检查点、数据集）、软件移植文档。
  触发词："把XX录入wiki" / "ingest into the wiki"、
  "wiki里关于XX怎么说" / "what does the wiki say about X"、
  "检查wiki" / "lint the wiki"，或任何应沉淀而非散落的材料积累。
---

# LLM Wiki

LLM 策划的知识库。用户策划来源并提问；
LLM 负责记录整理——摘要、交叉引用、标记矛盾。
知识在 wiki 中不断积累，而非每次查询都从原始片段重新推导。

## 何时使用

触发条件：
- "把XX录入wiki" / "把这个加到我的 llm-wiki"
- "wiki里关于XX怎么说" / "总结我的 wiki"
- "检查wiki"
- 一般积累：论文、会话、截图、代码、音频等
  应该被组织起来而非散落各处的材料。

这里的一切都是默认且模块化的——SCHEMA.md 可以覆盖
任何不适合当前领域的内容。

如果尚不存在 `llm-wiki/`，先执行**初始化**。否则在
做任何事之前先读取 `llm-wiki/SCHEMA.md`——它会覆盖此处的默认设置。

## 架构

三个层次：

- **原始来源** — `llm-wiki/raw-sources/`。不可变。要么是*副本*
  （无规范位置 → `raw-sources/<bucket>/`），要么是*引用*
  （稳定位置 → 仅在 `raw-sources/index.md` 中记录）。
- **Wiki** — `llm-wiki/<topic>/<page>.md`，由 LLM 汇编。顶层另有
  `index.md`（目录）和 `log.md`（操作日志）。
- **Schema** — `llm-wiki/SCHEMA.md`。各项目的约定规范。LLM
  提议，用户批准。协同演化。

三种操作：**摄取(ingest)**、**查询(query)**、**检查(lint)**。

## 项目布局

```
<项目根目录>/llm-wiki/
├── SCHEMA.md            # 首先读取
├── index.md             # 已汇编页面的目录
├── log.md               # 操作日志
├── raw-sources/
│   ├── index.md         # 所有来源的注册表（副本或引用）
│   └── <bucket>/        # 仅存放副本
└── <topic>/             # 已汇编的页面
```

Bucket 按*种类*组织来源（论文、对话、图表）；
topic 按*主题*组织已汇编页面。一个来源可以
贡献到多个页面。

## 初始化

在首次摄取时作为第 0 步内联执行：

1. 与用户确认。创建 `llm-wiki/`、`llm-wiki/raw-sources/`，以及
   四个桩文件：`SCHEMA.md`（基于 `references/SCHEMA.template.md`）、
   `index.md`（`# Wiki 索引`）、`log.md`（`# Wiki 日志`）、
   `raw-sources/index.md`（`# 原始来源`）。
2. 根据手头内容提议 SCHEMA 值（领域、分类、bucket、类型）；
   用户批准或修改。
3. 提议将 `llm-wiki/` 加入 `.gitignore`（在 schema 稳定前变动频繁）；
   用户按项目决定。

继续进入摄取步骤 1。如果用户在任何摄取之前运行查询/检查，
告知他们应先进行摄取；不要自动创建。

## 页面类型

每个页面使用且仅使用一种类型：

- `concept` — 某事物是什么（架构、数学、机制）
- `decision` — 为何选择 X 而非 Y（对比表、替代方案、证据）
- `bug` / `bugfix` — 出了什么问题以及如何修复（前后代码、影响、回归测试）
- `open-question` — 已知未知，附带监控/触发/延迟模式
- `source` — 会话或文档摘要（简洁指针，非深度内容）
- `reference` — 命令、配置、API 文档（查询表，非叙述）
- `synthesis` — 归档的查询答案（引用 wiki 页面，非原始来源）

## 页面质量启发规则

将页面标记为"完成"之前，验证深度与其类型匹配：

| 类型 | 最低深度要求 |
|------|-------------|
| `concept` | ≥1 个表格，≥1 个代码块，≥3 段正文 |
| `decision` | 含证据的备选方案对比表，≥3 段 |
| `bug` / `bugfix` | 修复前后代码片段，影响评估，回归测试引用 |
| `open-question` | 症状、缓解措施、触发条件、拟议修复 |
| `source` | 元数据 + 关键内容 + 可靠性——可简洁 |
| `reference` | 查询表或命令列表——可简洁 |
| `synthesis` | 引用 ≥2 个 wiki 页面，增加新联系或结论 |

瘦页面（frontmatter + 一段正文 + 参见）是桩页面。桩页面
对 `source` 和 `reference` 可接受，但对 `concept`、
`decision` 或 `bug` 不可接受。

## 摄取

两个阶段：先注册，再汇编。二者缺一不可。

### 1. 注册来源

**引用 vs 副本：**
- 稳定位置（项目内文件、外部文件、URL）→ **引用**。
  项目内路径用相对路径；项目外用绝对路径。
- 无规范位置（粘贴文本、临时对话记录）→ **副本**，复制到
  `raw-sources/<bucket>/YYYY-MM-DD-slug.md`，使用
  `references/source.template.md` 模板。原文照录，去除格式噪音，
  保留原观点。

Slug 规则（副本）：kebab-case，≤60 字符。如已知发布日期则加
`YYYY-MM-DD-` 前缀；否则省略并将 `published` 设为 `Unknown`。

追加到 `raw-sources/index.md` 的 `## <bucket>` 下。新建 bucket 需要
用户批准 + SCHEMA 更新。格式：

    ## papers
    - **Title** — URL_or_path — collected YYYY-MM-DD → [page](../topic/page.md)

`→` 箭头列出此来源贡献到的页面（在摄取结束时填写；
一个来源可产生多个链接）。

### 2. 阅读和讨论

分块阅读长材料。在编写页面之前，先向用户提炼关键要点。

### 3. 汇编为 wiki 页面

- **与已有页面论点相同** → 合并：将来源追加到
  `sources:`，仅做精准替换（不重写），更新
  `updated:`。
- **新概念** → 在最相关的 topic 下新建页面。以概念命名文件，
  而非来源的 slug。新 topic？先确认；更新 SCHEMA。
- **跨越多个主题** → 放入最合适的主页面；在别处通过参见交叉引用。
- **冲突** → 内联标注并注明归属；frontmatter 中列出来源双方。

每来源页面数 = 其中存在的独立论点数量。不设配额；不要用碎片凑数。
当自然合适时，将围绕同一核心思想的论点聚合到一个页面中。

**完成标准** — 汇编结束前，验证：
- Frontmatter：`title`、`type`、`updated`、`sources` 全部存在
- 正文：一段引言 + 关键声明（含引用）+ 开放问题
- 深度：通过其类型对应的页面质量启发规则
- 参见：如果本页面提到某个已有独立页面的概念，在此链接；
  如果你为页面 A 添加指向页面 B 的参见，确保 B 也链接回 A
- 索引：页面出现在 `index.md` 中并附一行摘要

### 4. 级联

扫描连锁反应：先检查同 topic 页面，再通过
`index.md` 检查其他。仅做精准替换；绝不重写整个章节。每个
页面更新 `updated:`。绝不对归档页面进行级联更新。如果某页面
正文引用另一页面但缺少参见链接，补上。

### 5. 更新索引和日志

- `index.md`：每个被触及的页面添加 链接 + 一行摘要 + `Updated: YYYY-MM-DD`。
- `raw-sources/index.md`：回填来源条目上的 `→` 链接。
- `log.md`：追加

  ```
  ## [YYYY-MM-DD] ingest | <来源标题>
  - Updated: <级联页面>
  ```

  无级联时省略 `- Updated:`。

### 6. 总结

告知用户：变更了哪些页面，优先查看哪里，值得归档的后续事项。

### 特殊来源类型

**会话。** Pi 会话是 JSONL 树结构——参见
`references/pi-session-recipe.md`。**关键：** 会话不是
时间线流。它们包含分叉（恢复的对话、子代理生成）、
自定义事件（获取失败、速率限制、错误）以及
助手仅通过工具调用产生产物而无文本回复的分支。
你必须在阅读任何内容之前运行树分析（配方中的第 0 步）。
对于 Claude Code（`~/.claude/projects/<sanitized-cwd>/*.jsonl`）、
Gemini CLI（`~/.gemini/tmp/<project>/chats/*.json`）和 opencode
（`~/.local/share/opencode/opencode.db` SQLite），参见
`references/agent-session-recipe.md`——仅在真正扫描
这些工具的对话记录时才加载，不要在技能常规加载时加载。
将每个被引用的来源作为独立条目提取；优先处理底层来源而非会话。

**图表 / 截图 / 音频 / MIDI / 检查点。** 相同模式：
每种类型一个 bucket（`figures/`、`audio/` 等），稳定则引用，临时的
则复制。始终配一个伴生 `.md` 描述文件（原文
+ 1-3 句话）——这是可搜索的句柄。引用 `.md` 文件，
而非二进制文件。

**来源摘要页面。** 对于重要来源，先写一个
`type: source` 页面总结该来源的主张、其可靠性
及其涉及的概念。然后合并到规范页面。示例：
`raw-sources/papers/2026-04-29-attention.md` →
`wiki/sources/attention-is-all-you-need.md`（来源页面）→ 更新
`wiki/concepts/transformers.md`。

## 查询

读取 `index.md`，找到候选页面，读取页面，综合并附引用。
优先使用 wiki 而非训练数据；若覆盖不全请说明。

**归档：** 如果答案综合了 ≥2 个 wiki 页面，或发现了尚未记录的
新联系，主动提议将其归档为 `type: synthesis`
页面。综合页面引用它们的源 wiki 页面（而非原始来源），
并在"综合"栏目下编入索引。这可以防止好的答案
消失在聊天历史中。

**存档**（按需）：综合页面使用 `type: synthesis` 或
`archive`，`sources:` 列出引用的 wiki 页面，更新 `index.md` 标注
`[Archived]`，追加到 `log.md`。

## 检查

自动修复确定性问题：索引/文件系统同步、死链、
参见双向性、原始引用有效性、frontmatter
类型一致性（类型必须来自规范列表）。

向用户报告启发式问题：
- **矛盾：** 在同主题页面间 grep 反义词对
  （例如"采用"vs"拒绝"、"有效"vs"无效"）。标记格式：
  `⚠️ 矛盾：[页面 A] 声称 X，但 [页面 B] 声称非X`
- **过期声明：** `updated:` 早于 SCHEMA 过期阈值
  （默认 30 天）且其主题近期有摄取的页面。
- **瘦页面：** 正文短于其类型对应的质量启发规则要求。
- **孤立页面：** 无其他内容页面入链的页面。
- **概念缺口：** 参见中提到但缺乏独立页面的概念。
- **索引冗余：** 索引条目对应的文件已不存在。

所有发现发布到 `log.md`。

## Schema 协同演化

以下任何触发条件出现时，schema 将演化：
- 需要新 bucket（来源种类不在 SCHEMA bucket 列表中）
- 需要新 topic（概念不适合现有分类）
- 类型误用模式（同一概念被标记为多种类型）
- 系统性检查发现（例如，所有类型 X 的页面都缺少 Y）
- 用户要求新增约定

向 SCHEMA.md 提议变更；用户批准或修改。

## 规则

- 注册后绝不可编辑 `raw-sources/`。注册表仅追加。
- 创建后绝不可编辑归档页面。
- 薄弱或推测性来源应明确标注为如此；不可
  给予其与更强来源同等的权重。
- 对于重要来源，先写来源摘要页面，再
  合并到规范页面。

## 约定

- **路径。** 文件内部使用 wiki 相对路径；聊天中使用项目根相对路径。
- **日期。** ISO `YYYY-MM-DD` 格式。`updated:` 在实质性变更时更新。
- **Frontmatter**（必填）：`title`、`type`、`updated`、`sources`。
  可选：`see_also`、`tags`。
- **链接。** 标准 markdown 格式。

## 可选工具

本技能无需任何工具即可工作，但以下工具可提升体验：

- **Obsidian** 用于浏览：图谱视图展示页面连接关系；Dataview
  可查询 frontmatter 生成动态表格。
- **qmd** 用于规模化搜索（>100 页）：混合 BM25/向量搜索
  配合 LLM 重排序，提供 CLI + MCP 服务器。
- **Web Clipper** 用于来源采集：浏览器扩展将文章转换为
  markdown 以便快速摄取。
