# llm-wiki-zh

`llm-wiki-zh` 是面向 Pi、Codex CLI 和 Claude Code CLI 的中文 LLM Wiki Skill。它实现了 Karpathy 的 [LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)：用户选择来源，代理负责整理摘要、交叉引用、矛盾与演化记录，让知识持续积累在项目内的 Markdown Wiki 中。

三个宿主共享同一份 Skill 行为，但保留各自的安装与调用方式。仓库不包含 MCP、Hook、公共 `wiki-lint` 二进制或模型调用型 CI。

## 安装

### Codex CLI：项目级手动复制（推荐）

从本仓库复制完整的生成目录 `skills/llm-wiki-zh/`，不要只复制 `SKILL.md`；`references/` 与 `scripts/` 必须随 Skill 一起安装。
```bash
mkdir -p .codex/skills/llm-wiki-zh
cp -R /absolute/path/to/llm-wiki-zh/skills/llm-wiki-zh/. .codex/skills/llm-wiki-zh/
```

### Claude Code CLI：项目级手动复制（推荐）

同样复制完整的生成目录：

```bash
mkdir -p .claude/skills/llm-wiki-zh
cp -R /absolute/path/to/llm-wiki-zh/skills/llm-wiki-zh/. .claude/skills/llm-wiki-zh/
```

末尾的 `/.` 表示复制目录内容；重复执行会原位更新，不会生成嵌套的 `llm-wiki-zh/llm-wiki-zh/`。若升级版本删除或重命名过文件，先仅删除对应的 `.codex/skills/llm-wiki-zh/` 或 `.claude/skills/llm-wiki-zh/` 安装目录，再执行上述命令，以免保留陈旧文件；这不会触碰项目的 `<root>/llm-wiki/` 数据。

项目级安装让团队可以审核并固定 Skill 版本。确有跨项目需要时，也可以用同样的”创建目标目录，再复制源目录 `/.` 内容”方式更新用户级 `~/.codex/skills/llm-wiki-zh/` 或 `~/.claude/skills/llm-wiki-zh/`；用户级复制是可选项，不替代项目级安装建议。

### Pi：Git 安装

```bash
pi install https://github.com/wangscu/llm-wiki-zh
```

Pi 会加载 Skill 与 `extension.ts`，提供现有的三个 `/wiki-*` 命令。

### 从本地克隆可选安装 marketplace 插件

仓库包含 Codex 与 Claude Code 的 manifest/marketplace 元数据。已克隆本仓库后，可使用绝对路径注册本地 marketplace：

```bash
codex plugin marketplace add /absolute/path/to/llm-wiki-zh
codex plugin add llm-wiki-zh@llm-wiki-zh

claude plugin marketplace add /absolute/path/to/llm-wiki-zh
claude plugin install --scope project llm-wiki-zh@llm-wiki-zh-marketplace
```

这些命令来自本地 CLI 帮助。本仓库构建只准备可验证的安装产物，不提交或发布 marketplace，不发布 npm 包或 GitHub Release，也不执行 Git push。

已测试基线为 Codex CLI `0.151.0` 与 Claude Code CLI `2.0.76`。更早版本仅建议按上文完整目录手动复制，兼容性按 best effort 提供。

## 调用与操作映射

| 操作 | Pi | Codex CLI | Claude Code CLI |
|---|---|---|---|
| 录入 | `/wiki-ingest <材料>` | `$llm-wiki-zh ingest <材料>`，适当时也可自动匹配 | 项目复制：`/llm-wiki-zh ingest <材料>`；插件安装：`/llm-wiki-zh:llm-wiki-zh ingest <材料>`，也可能自动匹配 |
| 查询 | `/wiki-query <主题>` | `$llm-wiki-zh query <主题>`，适当时也可自动匹配 | 项目复制：`/llm-wiki-zh query <主题>`；插件安装：`/llm-wiki-zh:llm-wiki-zh query <主题>`，也可能自动匹配 |
| 检查并修复 | `/wiki-lint` | `$llm-wiki-zh lint` | 项目复制：`/llm-wiki-zh lint`；插件安装：`/llm-wiki-zh:llm-wiki-zh lint` |
| 只检查 | `/wiki-lint --check` | `$llm-wiki-zh lint --check`，也可说”只检查”或”只报告” | 在对应调用后使用 `lint --check`，也可说”只检查”或”只报告” |

Codex 与 Claude Code 不会获得 Pi 的 `/wiki-ingest`、`/wiki-query`、`/wiki-lint` 三个命令；表中调用使用各宿主原生的 Skill 语法。

普通 `lint` 是显式的 Skill 操作：可以修复确定性问题并写入 `log.md`。`lint --check`、”只检查”或”只报告”是严格只读的 Skill 模式，连 `log.md` 也不写。本项目没有可直接在 shell 中运行的公共 `wiki-lint` 程序。

## 行为与安全默认值

- 只有明确的摄取、初始化、更新、保存 synthesis 或可修复 lint 意图才允许写入。普通总结、研究、查询与 check-only 操作不写文件。
- URL 摄取只访问用户明确提供的地址，不搜索、不爬取关联页面；访问私有或需登录资源前先确认。
- 凭据、Cookie、认证头和临时签名 URL 必须脱敏；Skill 不收集遥测。
- 单个文本超过约 1 MiB、批次超过 20 个文件或预计超出上下文时，先做只读预检并提出分批方案。二进制来源必须先有可审计的文本伴生文件。
- `raw-sources/` 与归档材料保持不可变。相同来源、相同摘要不写入；内容改变时创建新的版本快照，再对派生页面做精确更新。
- 写入采用单写者契约。目标在读取后发生变化时，停止并报告冲突，不静默覆盖；query 与只检查模式可并发。
- Wiki 始终位于目标项目的 `<root>/llm-wiki/`，不写入插件目录。目标路径按”用户显式路径 → 最近 Git 根 → 当前目录”解析，并在初始化前展示确认。

## 会话摄取边界

当前会话只使用模型可见的上下文，或已经明确返回到主会话的结果。只有用户显式提供 transcript 文件时才解析；Skill 不扫描宿主目录猜测”当前会话”，也不承诺获取隐藏的子代理轨迹。

对明确给出的 Codex/Claude JSONL，可以选择运行随 Skill 一起安装的 Node 规范化器：

```bash
node scripts/normalize-session.mjs --format codex /explicit/path/session.jsonl
node scripts/normalize-session.mjs --format claude /explicit/path/session.jsonl
```

规范化器只输出脱敏后的用户文本、助手最终文本和安全的工具名称／产物路径摘要；未知记录会统计报告，原 transcript 不会被修改。没有 Node 或格式不受支持时，Skill 只做保守读取并说明限制。

会话处理支持 macOS、Linux 和 WSL；原生 Windows 的会话发现留待后续版本。Codex/Claude transcript 的内部路径与 JSONL 字段是证据产物，不视为稳定公共 API。

## Wiki 页面模型

规范页面类型恰好八种：

1. `concept`
2. `decision`
3. `bug`
4. `bugfix`
5. `open-question`
6. `source`
7. `reference`
8. `synthesis`

旧 Wiki 中的 `entity` 与 `archive` 只作为 legacy 兼容类型：lint 会警告，但不会因此失败，也不会自动迁移。新页面不再使用这两个类型。

## 仓库结构

```text
llm-wiki-zh/
├── SKILL.md                         # 唯一人工维护的 Skill 入口
├── extension.ts                     # Pi 的 /wiki-* 命令桥接
├── references/
│   ├── SCHEMA.template.md
│   ├── agent-session-recipe.md      # Claude、Gemini、opencode 显式 transcript
│   ├── codex-session-recipe.md      # Codex 显式 transcript
│   ├── page.template.md
│   ├── pi-session-recipe.md
│   └── source.template.md
└── scripts/
    └── normalize-session.mjs
skills/llm-wiki-zh/                  # 从上方事实源生成并提交，两套 CLI 共用
plugin.json                          # portable plugin manifest
.codex-plugin/plugin.json            # Codex 兼容 manifest
.agents/plugins/marketplace.json     # Codex 本地 marketplace
.claude-plugin/plugin.json           # Claude Code manifest
.claude-plugin/marketplace.json      # Claude 本地 marketplace
scripts/
├── sync-skill.mjs                   # 生成/检查共享 Skill
└── validate-package.mjs             # 只读仓库与发布包校验
test/                                # Node 内置测试
.github/workflows/validate.yml       # 无模型 CI
```

## 贡献与验证

`llm-wiki-zh/` 是唯一人工维护的 Skill 事实源；`skills/llm-wiki-zh/` 是确定性生成结果，不应单独编辑。修改事实源后运行：

```bash
npm run sync:skill
npm run check:skill
npm run validate
```

- `npm run sync:skill` 镜像规范目录、删除生成目录中的陈旧文件，并同步 manifest 版本。
- `npm run check:skill` 只读检查规范目录、生成目录和版本是否漂移。
- `npm run validate` 依次执行漂移检查、package/manifest/引用验证与完整测试，全程不调用模型。

## 卸载与数据保留

删除插件或复制的 Skill 只移除安装产物，绝不会删除项目中的 `<root>/llm-wiki/`。安装与卸载都不会自动修改消费项目的 `AGENTS.md` 或 `CLAUDE.md`。

## 许可证

MIT
