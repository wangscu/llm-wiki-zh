---
name: llm-wiki-zh
description: Use when users explicitly ask to ingest/录入 or save material into an LLM Wiki, query/查询 an existing wiki, or lint/检查 its health.
---

# LLM Wiki

LLM 策划的知识库。用户策划来源并提问；
LLM 负责记录整理——摘要、交叉引用、标记矛盾。
知识在 wiki 中不断积累，而非每次查询都从原始片段重新推导。

## 操作契约

Pi 保留原有 `/wiki-ingest`、`/wiki-query`、`/wiki-lint` 命令；其他宿主使用各自原生的 Skill 调用方式，不假定存在同名斜杠命令。

| 操作 | 写入契约 |
|------|----------|
| `ingest` | 仅在用户明确要求摄取、初始化、更新或保存材料后写入；执行注册来源 → 阅读讨论 → 汇编页面 → 级联更新。 |
| `query` | 严格只读。可以提议 synthesis，但只有用户另行明确接受并要求保存后才进入写操作。 |
| `lint` | 用户明确要求普通检查后，可修复确定性缺陷并按原行为写 `log.md`；启发式问题只报告。 |
| `lint --check` / `只检查` / `只报告` | 严格只读；不得修复，不得修改索引、schema、页面或任何其他文件，也不得写 `log.md`。 |

普通总结、研究、比较、问答或“与已有知识联系起来”均保持只读，既不初始化也不修改 Wiki；只有用户另行明确要求摄取、初始化、更新或保存时才写入。

## 何时使用

触发条件：
- "把XX录入wiki" / "把这个加到我的 llm-wiki"
- "wiki里关于XX怎么说" / "总结我的 wiki"
- "检查wiki" / "只检查wiki" / "只报告wiki问题"

这里的一切都是默认且模块化的——SCHEMA.md 可以覆盖
任何不适合当前领域的内容。

如果目标尚不存在 `llm-wiki/`，只有显式 ingest 才进入**初始化**；
query 或任何 lint 只报告需要先 ingest，且不创建任何文件。
已有 Wiki 时，在操作前读取 `llm-wiki/SCHEMA.md`——它会覆盖此处的默认设置。

## 目标项目与写入边界

在任何写入前按以下优先级解析一次目标项目根：

1. 用户明确给定的目录；
2. 否则当前目录最近的上级 Git 根目录；
3. 否则当前工作目录。

Wiki 固定为 `<resolved-project-root>/llm-wiki/`。绝不把 Wiki 数据写入插件目录或用户主目录下的全局插件数据目录。初始化前展示解析后的完整路径并等待用户确认。query 和任何 lint 面对未初始化目标时只报告需要先 ingest，什么也不创建。

本技能采用单写者契约。读取用于规划写入的文件后，必须在实际写入前立即重新检查所有相关源文件和目标文件的内容或版本；任何目标发生变化，都停止该次写入并报告冲突。对无法确定来源的人工或并发改动，绝不静默合并或覆盖。

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

新页面使用且仅使用以下八种规范类型之一：

- `concept` — 某事物是什么（架构、数学、机制）
- `decision` — 为何选择 X 而非 Y（对比表、替代方案、证据）
- `bug` / `bugfix` — 出了什么问题以及如何修复（前后代码、影响、回归测试）
- `open-question` — 已知未知，附带监控/触发/延迟模式
- `source` — 会话或文档摘要（简洁指针，非深度内容）
- `reference` — 命令、配置、API 文档（查询表，非叙述）
- `synthesis` — 归档的查询答案（引用 wiki 页面，非原始来源）

`entity` 和 `archive` 仅作为 legacy 兼容值：lint 对它们发出警告，
但不判失败、不重写、不自动迁移。已存在的归档页面保持不可变。

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

为实际注册的内容计算 `sha256` 摘要，并把摘要与规范来源身份一起记录。
规范身份按来源确定：

- 项目内文件：相对目标项目根的规范化路径；
- 项目外文件：规范化绝对路径；
- URL：用户明确提供、去除凭据（包括签名查询参数）后的 URL；若不存在可持久化的无凭据 URL，改用稳定声明标签；
- 粘贴文本或当前可见会话材料：稳定且明确声明的标签或标识符。

身份或索引中不得出现 Cookie、Authorization header、签名查询凭据或其他秘密。
每个注册版本都必须对应不可变 artifact：稳定且版本固定的位置可作为引用，
否则在 `raw-sources/` 中保存该版本的只读副本。同一身份和同一摘要是严格 no-op：报告内容已存在，任何文件都不写，
包括不追加日志。同一身份但摘要变化时，追加一个新来源版本和新的不可变
原始材料，并链接到上一版本；绝不编辑旧来源。

**引用 vs 副本：**
- 稳定位置（项目内文件、外部文件、明确 URL）→ **引用**。
- 无规范位置（粘贴文本、临时对话记录）→ **副本**，复制到
  `raw-sources/<bucket>/YYYY-MM-DD-slug.md`，使用
  `references/source.template.md` 模板。原文照录，去除格式噪音，
  保留原观点。

Slug 规则（副本）：kebab-case，≤60 字符。如已知发布日期则加
`YYYY-MM-DD-` 前缀；否则省略并将 `published` 设为 `Unknown`。

追加到 `raw-sources/index.md` 的 `## <bucket>` 下，并记录规范身份、
`sha256`、版本关系和实际注册内容的位置。新建 bucket 需要用户批准 +
SCHEMA 更新。格式：

    ## papers
    - **Title** — identity: URL_or_path — sha256: DIGEST — collected YYYY-MM-DD → [page](../topic/page.md)

`→` 箭头列出此来源贡献到的页面（在摄取结束时填写；
一个来源可产生多个链接）。

### 输入与安全预检

- URL 摄取只访问用户明确给出的地址；不搜索、不爬取链接页面、不收集遥测。
- 访问需登录或其他私有材料前先确认。不得持久化凭据、Cookie、认证头或临时签名 URL。
- 单份文本超过约 1 MiB、一次超过 20 个文件，或预计会超出宿主上下文时，先做只读预检并提出分批方案；用户确认前不写入。
- 二进制输入必须先有可审计的文本伴生文件，之后才能摄取。
- 任何脱敏都在 provenance 或审计备注中披露；不存在静默关闭脱敏的全局模式。

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

**会话。** 按明确来源渐进路由，只在需要时读取对应配方：

无论宿主为何，只保留明确识别的用户文本、助手最终文本和安全工具名称／产物路径摘要；绝不输出或持久化 reasoning、raw tool arguments、完整工具结果或认证材料。

- 当前对话：仅使用当前上下文中可见的内容，以及已经回传到该上下文的子代理结果；无需也不得从磁盘发现会话。
- 用户明确提供的 Pi transcript：参见 `references/pi-session-recipe.md`。
- 用户明确提供的 Claude Code、Gemini CLI 或 opencode artifact：参见 `references/agent-session-recipe.md`。
- 用户明确提供的 Codex transcript：参见 `references/codex-session-recipe.md`。

对于明确提供的 Claude 或 Codex JSONL 文件，从已安装 Skill 根目录运行：

```bash
node scripts/normalize-session.mjs --format claude /absolute/path/to/session.jsonl
node scripts/normalize-session.mjs --format codex /absolute/path/to/session.jsonl
```

脚本在 stdout 输出供审阅的 Markdown，在 stderr 报告 unknown、malformed、
redactions 等统计；非零退出表示安全失败。先审阅输出，再决定是否摄取。
若 Node 不可用或解析拒绝该 artifact，降级为保守手工读取：只提取明确识别的
用户文本与助手最终文本，跳过 reasoning、工具 payload 和未知记录，脱敏秘密，
并披露局限；不得猜测字段或伪造对话。

不得扫描宿主存储来猜“当前会话”，也不得声称可以访问隐藏的子代理轨迹。
只有用户明确提供子代理 transcript 时才处理；缺少 `.meta.json` 不得阻止读取。
provenance 必须记录明确 artifact 路径或标识符、请求格式、normalizer 的
unknown/malformed/redactions 统计，以及提取限制。将每个被引用的底层来源作为
独立条目提取，并优先处理底层来源而非会话摘要。

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
优先使用 wiki 而非训练数据；若覆盖不全请说明。查询全过程严格只读。

**归档：** 如果答案综合了 ≥2 个 wiki 页面，或发现了尚未记录的
新联系，主动提议将其归档为 `type: synthesis`
页面。综合页面引用它们的源 wiki 页面（而非原始来源），
并在"综合"栏目下编入索引。这可以防止好的答案
消失在聊天历史中。提议本身不授权写入；只有用户另行明确接受并要求保存，
才启动独立写操作，并重新执行目标解析和单写者检查。

**保存已接受的综合**（按需）：新页面只能使用 `type: synthesis`，
`sources:` 列出引用的 wiki 页面，更新 `index.md`，追加到 `log.md`。
绝不创建新的 `archive` 页面，也不修改已经归档的页面。

## 检查

先根据用户请求选择且只选择一种模式：

- **普通 lint：** 在用户明确要求普通检查后，修复确定性问题：
  索引/文件系统同步、死链、参见双向性、原始引用有效性、frontmatter
  类型一致性。对 `entity`、`archive` 仅发 legacy 警告，绝不失败、重写或迁移。
- **check-only：** 当请求含 `--check`、`只检查` 或 `只报告` 时，
  运行与普通 lint 相同的确定性和启发式检查并报告结果，但不修复、不改
  index/schema/page/raw source 或任何其他文件，也不创建或修改 `log.md`。

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

普通 lint 将发现发布到 `log.md`；check-only 只在回复中报告。

## Schema 协同演化

以下任何触发条件出现时，schema 将演化：
- 需要新 bucket（来源种类不在 SCHEMA bucket 列表中）
- 需要新 topic（概念不适合现有分类）
- 类型误用模式（同一概念被标记为多种类型）
- 系统性检查发现（例如，所有类型 X 的页面都缺少 Y）
- 用户要求新增约定

向 SCHEMA.md 提议变更；用户批准或修改。

## 规则

- 注册后绝不可编辑已有 `raw-sources/` artifact；新内容只能形成新版本。
  注册表仅追加，派生页面仅做精准合并。
- 创建后绝不可编辑归档的 synthesis 或 legacy archive 页面。
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
