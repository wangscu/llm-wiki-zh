# llm-wiki-zh

Karpathy 的 [LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)，以**极简、锋利的技能**形式面向 Pi 及其他代理。

用户策划来源。LLM 负责记录整理——摘要、交叉引用、标记矛盾。知识在 wiki 中不断积累，而非每次查询都从原始片段重新推导。

## 设计理念

**极简。** 无依赖、无 JSON 元数据、无强制扩展。标准 markdown、标准链接、标准 frontmatter。基于约定的约束，而非基于代码的约束。

**锋利。** `SKILL.md` 中的每一行都服务于该模式。没有冗余，没有不产生价值的抽象。

**Karpathy 的 gist 为权威来源。** 本技能忠实地实现了他的三层架构（原始来源 → wiki → schema）和三种操作（摄取、查询、检查）。如有偏差，我们最小化偏差并记录原因。

**代理会话摄取是一等公民。** 支持 Pi JSONL 树（含分叉检测）、Claude Code JSONL、opencode SQLite 和 Gemini CLI JSON。会话配方采用**延迟加载**——在 `SKILL.md` 中按路径引用，不内联。仅在真正扫描会话时才加载，绝不在技能常规加载时加载。

## 安装

### Pi（npm — 推荐）
```bash
pi install npm:@micuintus/llm-wiki
```

### Pi（git）
```bash
pi install https://github.com/wangscu/llm-wiki-zh
```

### Claude Code / Codex / 其他代理
将 `llm-wiki/SKILL.md` 和 `llm-wiki/references/` 复制到你的代理技能目录中。

## 适用场景

- **书籍和论文研究**——摄取章节、论文、图表；在阅读过程中构建互链的概念页面
- **代理会话保存**——Pi JSONL 会话的树遍历和自定义事件提取；Claude Code / opencode / Gemini CLI 对话记录及子代理支持
- **AI 模型开发**——代码、检查点、数据集、音频/MIDI 及伴生描述
- **软件移植文档**——追踪架构研究、设计决策和移植进展

## 结构

```
llm-wiki/
├── SKILL.md              # 技能指令（~12 KB，极简）
├── references/
│   ├── page.template.md      # wiki 页面 frontmatter 模板
│   ├── source.template.md    # 原始来源副本模板
│   ├── SCHEMA.template.md    # 各项目 schema 骨架
│   ├── pi-session-recipe.md  # Pi JSONL 分叉检测 + 提取
│   └── agent-session-recipe.md  # Claude Code、opencode、Gemini CLI
```

## SKILL.md 包含的内容

- **页面类型**——7 种规范类型及定义（`concept`、`decision`、`bug`、`bugfix`、`open-question`、`source`、`reference`、`synthesis`）
- **页面质量启发规则**——每种类型的最低深度要求（表格、代码块、段落），防止页面停留在桩状态
- **查询归档**——综合 ≥2 个页面的答案会提议归档为 `type: synthesis`，让好的回答不会消失在聊天历史中
- **矛盾检测**——grep 反义词对，标记为 `⚠️ 矛盾：` 格式
- **检查规则**——确定性修复（死链、孤立页面、类型一致性）+ 启发式报告（过期声明、瘦页面、概念缺口）
- **Schema 协同演化**——5 个触发条件促使 SCHEMA.md 更新

## 会话配方（延迟加载）

`SKILL.md` 按路径引用两个配方文件。它们在**技能常规加载时不会被加载**——仅在你真正需要扫描代理会话时才加载。

- **`references/pi-session-recipe.md`**——Pi JSONL 树遍历。分叉检测（必须）、自定义事件提取（获取失败、速率限制、工具产物）、逐分支阅读。
- **`references/agent-session-recipe.md`**——Claude Code JSONL、Gemini CLI JSON、opencode SQLite（双 schema 变体）。清单、分类、提取模式。一行表格快速映射工具→位置。

## 其他值得关注的实现

- [Astro-Han/karpathy-llm-wiki](https://github.com/Astro-Han/karpathy-llm-wiki)——纯技能，最成熟（~638 stars）
- [praneybehl/llm-wiki-plugin](https://github.com/praneybehl/llm-wiki-plugin)——Claude Code 插件，带斜杠命令、BM25 搜索、图谱层
- [iRonin/pi-llm-wiki](https://github.com/iRonin/pi-llm-wiki)——Pi 原生包，带扩展约束和生成元数据

本技能保持更轻量——无扩展依赖、无 JSON 元数据、小规模下不需要搜索引擎。取舍是约定优先于强制执行。

## 许可证

MIT
