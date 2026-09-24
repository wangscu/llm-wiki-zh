# Codex 与 Claude Code CLI 支持规格

## 目标

让 `llm-wiki-zh` 在不破坏现有 Pi 安装和三个 `/wiki-*` 命令的前提下，成为可由 Codex CLI 与 Claude Code CLI 发现、安装和执行的同一项 Skill。

首个兼容版本为 `1.5.0`。本仓库只准备可发布产物，不执行 npm 发布、Git 推送、GitHub Release 或 marketplace submission。

实施裁决：设计访谈最初按仓库内的 `1.0.4` 选择 `1.1.0`；实施前核实 npm registry 后发现同名包已经发布到 `1.4.8`，且 `1.1.0` 已被占用。因此改用下一个未占用的向后兼容功能版本 `1.5.0`。

## 产品边界

- `llm-wiki-zh/` 是唯一人工维护的 Skill 事实源。
- `skills/llm-wiki-zh/` 是提交到 Git 的生成产物，供 Codex 和 Claude Code 共用。
- Pi 继续从 `llm-wiki-zh/` 加载 Skill 和 `extension.ts`。
- Codex 与 Claude Code 各自拥有独立 manifest 和 marketplace 元数据，不共享宿主专属配置。
- 项目级安装是文档首选；用户级安装是可选路径。
- 不开发自定义安装器，不自动修改消费项目的 `AGENTS.md` 或 `CLAUDE.md`。
- 卸载插件绝不删除项目中的 `llm-wiki/`。

## 目录与生成

目标仓库至少包含：

```text
llm-wiki-zh/                  # 唯一事实源，兼容 Pi
skills/llm-wiki-zh/           # 由事实源生成，两套 CLI 共用
plugin.json                   # Codex portable manifest
.codex-plugin/plugin.json     # Codex 当前兼容 fallback，由版本源生成
.claude-plugin/plugin.json    # Claude Code manifest
.agents/plugins/marketplace.json
.claude-plugin/marketplace.json
scripts/sync-skill.mjs        # 生成或只读校验
test/                         # Node 内置测试运行器
```

`.codex-plugin/plugin.json` 作为 Codex 当前兼容 fallback 生成，但不得成为另一份人工维护的元数据源。

`package.json` 是唯一版本源。生成脚本使用 Node 标准库，不新增运行时或开发依赖：

- 默认模式把 `llm-wiki-zh/` 镜像到 `skills/llm-wiki-zh/`，删除生成目录中已经不属于事实源的陈旧文件。
- `--check` 只比较、不修改；存在缺失、内容差异或陈旧文件时以非零状态退出，并列出差异。
- manifest 中的版本由同一脚本与 `package.json` 同步。
- 生成产物提交 Git，安装用户无需执行构建。

## Skill 触发与操作

Skill 维持单一入口 `llm-wiki-zh`，内部路由三种操作：

| 操作 | 行为契约 |
|---|---|
| `ingest` | 显式写操作；注册来源、汇编页面、级联、更新索引和日志 |
| `query` | 严格只读；可提议保存 synthesis，但不得自行保存 |
| `lint` | 保留现有行为：显式调用后修复确定性问题、报告启发式问题、写日志 |
| `lint` 只检查模式 | 严格只读；它是 Skill 操作模式，不冒充无模型 shell 命令 |

允许模型在明确的 LLM Wiki 请求中自动选择 Skill，但写入必须来自明确的摄取、初始化、更新、保存 synthesis 或可修复 lint 意图。普通总结、研究和问答不得自动创建或修改 `llm-wiki/`。

Pi 保留 `/wiki-ingest`、`/wiki-query`、`/wiki-lint`。其他宿主使用原生 Skill 调用语法，不承诺三个宿主拥有相同的斜杠命令，但三种操作语义一致。

## 项目根与存储

知识库只写入目标项目，不写入插件目录或用户主目录：

1. 用户明确给定目录时使用该目录。
2. 否则使用当前目录所属的最近 Git 根目录。
3. 不在 Git 仓库内时使用当前目录。
4. 初始化前展示最终路径并等待确认。

如果 query 或 lint 遇到未初始化项目，报告需要先 ingest，不自动创建 Wiki。

## 来源、幂等与冲突

- `raw-sources/` 中已注册的原始材料和归档页面保持不可变。
- 同一规范化来源、内容摘要相同：不写文件。
- 同一来源出现新内容：登记为新版本，不修改旧原文。
- 派生 Wiki 页面只做精确合并和级联更新。
- 无法安全合并的人工修改或并发变化必须停止对应写入并报告，不得静默覆盖。
- 第一阶段采用单写者契约； query 和只检查模式可以并发。
- 新 bucket、topic 与 schema 演化继续要求用户批准。

规范页面类型为 `concept`、`decision`、`bug`、`bugfix`、`open-question`、`source`、`reference`、`synthesis`。`entity` 和 `archive` 作为 legacy 类型只警告、不判失败、不自动迁移。

## 会话摄取

两套 CLI 的 transcript JSONL 字段均不是稳定公共接口。第一阶段：

- 摄取当前模型可见的主会话和已经回传到主会话的子代理结果。
- 不承诺获得子代理隐藏的完整轨迹。
- 用户明确给出 transcript 文件时才 best-effort 解析；不扫描内部目录猜测“当前会话”。
- 保留 `references/agent-session-recipe.md` 路径，修正 Claude Code 的不稳定假设。
- 新增 `references/codex-session-recipe.md`，仅在摄取 Codex 会话时读取。
- 加入可选的 `scripts/normalize-session.mjs`：读取明确指定的 Codex/Claude JSONL，向 stdout 输出脱敏后的统一文本，不修改原文件。
- 规范化助手容忍未知记录，报告跳过数量；解析失败以非零状态退出并给出可操作错误。
- Node 不可用或脚本不支持该格式时，Skill 降级为安全原文读取，不猜测字段。

规范化助手不得输出思考链、完整工具参数或工具结果。它只保留用户文本、助手最终文本和安全的工具名称／产物路径摘要。

## 隐私、网络与输入保护

- 默认脱敏令牌、Cookie、密码、环境变量和认证配置；记录“已省略敏感内容”的审计标记。
- 不提供静默关闭脱敏的全局开关。单个来源确需保留时必须单独确认。
- 不收集遥测。
- URL 摄取只访问用户明确给出的地址，不搜索、不爬取关联页面。
- 登录态或私有资源访问前确认；Cookie、认证头和临时签名 URL 不得写入 Wiki。
- 单文件超过约 1 MiB 文本、批次超过 20 个文件或预计超出宿主上下文时，先只读预检并提出分批方案，确认后才写。
- 二进制材料必须先获得可审计的文本伴生文件。

## 平台、文档与兼容性

- Skill 的 ingest、query、lint 核心跨平台。
- 会话文件自动化首版支持 macOS、Linux 和 WSL；原生 Windows 自动发现延期。
- Node 规范化助手是可选增强，缺少 Node 不能阻断 Skill 的安全降级路径。
- 中文是唯一完整文档；插件名、短描述、关键词和关键错误信息使用中英双语。
- 明确最低支持的 Codex／Claude Code 版本并测试当前稳定版；旧版只提供手动复制 Skill 的 best-effort 说明。
- 保留 Pi 现有 Git 安装行为和命令。

## 验证与验收

仓库 CI 不调用付费模型、不读取真实用户会话，必须运行：

- Node 单元测试：生成／漂移检查、版本同步、会话规范化、未知记录、恶意或敏感 fixture。
- Skill frontmatter 与引用路径验证。
- Codex／Claude manifest 和 marketplace schema 验证。
- `npm pack --dry-run`，确认发布包包含所有宿主产物。

本地装有目标 CLI 时执行真实发现／加载 smoke test；缺少 CLI 时必须报告“未执行”，不能伪称通过。

## 第一阶段非目标

- MCP、Hook。
- 公共二进制 CLI、无模型语义 linter。
- 原生 Windows 会话自动发现。
- 自动扫描全部历史会话或摄取隐藏子代理轨迹。
- legacy 页面类型自动迁移。
- 完整英文文档。
- npm、GitHub 或 marketplace 的实际发布与提交。
