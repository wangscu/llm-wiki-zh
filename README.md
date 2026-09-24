# llm-wiki-zh

Karpathy 的 [LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，以**极简、锋利的技能**形式面向 Pi 及其他代理。

用户策划来源。LLM 负责记录整理——摘要、交叉引用、标记矛盾。知识在 wiki 中不断积累，而非每次查询都从原始片段重新推导。

## 安装

### Pi（git — 推荐）

```bash
pi install https://github.com/wangscu/llm-wiki-zh
```

安装后自动加载扩展和技能，三个命令即刻可用。

### Claude Code / Codex / 其他代理

将 `llm-wiki-zh/SKILL.md` 和 `llm-wiki-zh/references/` 复制到你的代理技能目录中。

## 使用方法

安装后，三个 pi 命令即刻可用：

| 命令 | 作用 | 示例 |
|------|------|------|
| `/wiki-ingest <内容>` | 录入材料到 wiki | `/wiki-ingest 这篇论文` |
| `/wiki-query <主题>` | 查询 wiki 中的知识 | `/wiki-query transformers` |
| `/wiki-lint` | 检查 wiki 健康度 | `/wiki-lint` |

也可以直接用中文触发：`把这几段对话录入wiki`、`wiki里关于微调怎么说`、`检查wiki`。

## 结构

```
llm-wiki-zh/
├── SKILL.md              # 技能指令
├── extension.ts          # 注册 /wiki-ingest、/wiki-query、/wiki-lint 命令
├── references/
│   ├── page.template.md          # wiki 页面 frontmatter 模板
│   ├── source.template.md        # 原始来源副本模板
│   ├── SCHEMA.template.md        # 各项目 schema 骨架
│   ├── pi-session-recipe.md      # Pi JSONL 分叉检测 + 提取
│   ├── agent-session-recipe.md   # Claude Code、opencode、Gemini CLI
│   └── codex-session-recipe.md   # Codex transcript 提取
└── scripts/
    └── normalize-session.mjs     # 代理会话规范化器
```

## 适用场景

- **书籍和论文研究**——摄取章节、论文、图表；在阅读过程中构建互链的概念页面
- **代理会话保存**——Pi JSONL 会话的树遍历和自定义事件提取；Claude Code / opencode / Gemini CLI 对话记录及子代理支持
- **AI 模型开发**——代码、检查点、数据集、音频/MIDI 及伴生描述
- **软件移植文档**——追踪架构研究、设计决策和移植进展

## 许可证

MIT