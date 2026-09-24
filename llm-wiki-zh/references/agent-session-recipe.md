# 代理会话配方

Claude Code、Gemini CLI 和 opencode 明确会话 artifact 的安全提取指南。
仅当用户明确提供 artifact 路径或标识符时加载；不得扫描宿主存储猜测
“当前会话”。Pi 会话使用 `pi-session-recipe.md`，Codex 会话使用
`codex-session-recipe.md`。

## 共同安全边界

- 只处理用户明确提供的 artifact。路径、目录布局和字段结构都是证据性实现细节，不是稳定 API。
- 只保留明确识别的用户文本、助手最终文本，以及安全的工具名称／产物路径摘要。
- 跳过 thoughts、thinking、reasoning、raw tool arguments/state、完整工具结果、认证材料和未知记录；不得把它们打印到终端或写入 Wiki。
- 默认移除 token、Cookie、密码、Authorization header、签名 URL 和其他秘密；在 provenance 中披露脱敏。
- artifact 很小也照常处理；不得按 `<5 KB` 或其他任意大小阈值跳过。
- 无法确认字段语义时停止解析该记录，计入 unknown/malformed 或披露手工跳过；不得猜字段、拼接不确定内容或伪造对话。
- 缺少附属 metadata 不阻止处理用户明确提供的独立会话或子代理 artifact。

## Claude Code（JSONL，best-effort）

已知的高层证据位置是：

```text
~/.claude/projects/<project>/<session>.jsonl
```

目录布局与 JSONL schema 可能随 Claude Code 版本变化。不要从 cwd 推导目录名，
不要用 `aiTitle`、文件大小、slug 或固定字段去发现／排序会话，也不依赖 `jq`
或 `.meta.json`。要求用户提供要处理的绝对文件路径。

从已安装 Skill 根目录运行：

```bash
node scripts/normalize-session.mjs --format claude /absolute/path/to/session.jsonl
```

stdout 是脱敏后的统一 Markdown，供摄取前人工审阅；stderr 是一行统计，包含
format、records、messages、unknown、malformed 和 redactions。unknown 或
malformed 记录会被计数而不是静默消失。非零退出表示没有可安全提取的消息、
格式被拒绝或文件读取失败；此时不得把部分／猜测内容当作完整会话。

用户明确提供的独立子代理 JSONL 使用相同命令，即使没有 `.meta.json` 也可处理。
隐藏或未提供的子代理轨迹不可用，不得承诺能够取得。

## Gemini CLI（JSON，best-effort）

常见证据位置是 `~/.gemini/tmp/<project>/chats/*.json`，但布局和字段不是稳定
接口。用户必须明确选择文件；不要遍历目录猜测当前会话。对明确文件仅提取
可确定的 user 文本与 Gemini 最终文本，并可记录安全的工具名称／产物路径摘要。

不得输出 `.thoughts`、reasoning blocks、工具参数、工具 state、完整工具结果或
认证字段。若当前 Skill normalizer 不支持该 JSON 格式，按“安全降级”手工读取，
并在 provenance 中标为 best-effort 以及列出未解析部分。

## opencode（SQLite，best-effort）

常见证据位置是 `~/.local/share/opencode/opencode.db`。用户需明确提供数据库路径
和 session identifier；不得用标题、目录 slug 或时间自动猜当前 session。
opencode schema 可能变化，先只读查看 schema，再只提取明确的 user／assistant
最终文本与安全工具名称／产物路径摘要。

不得输出 reasoning part、raw tool arguments/state、完整工具结果或 secret-bearing
值。若 schema 与已知结构不符，停止自动提取，披露 unknown/malformed 范围，
不要用猜测字段补全会话。

## 安全降级

Node 不可用、normalizer 拒绝 artifact，或格式不是 Claude/Codex JSONL 时，
使用保守手工读取：

1. 以只读方式打开用户明确提供的 artifact；
2. 仅提取角色明确的用户文本与助手最终文本；
3. 跳过 reasoning、tool payload、完整工具结果和未知记录；
4. 脱敏秘密，并披露无法自动统计或识别的内容；
5. 不猜字段、不制造消息、不修改原 artifact。

## 分类与 provenance

内容价值而非文件大小决定是否摄取。不要 memory-first，不要使用标题／slug
启发式发现会话，也不要假设固定 metadata。可用明确来源时间与项目 Git 历史做
只读交叉核对，但不能据此制造缺失的会话内容。

每次摄取至少记录：

- 用户明确提供的 artifact 路径或标识符；
- 请求格式和实际使用的提取方式；
- normalizer 的 unknown、malformed、redactions 统计（若适用）；
- 被跳过的记录种类、脱敏和其他提取限制；
- 原 artifact 未被修改，注册后来源版本保持不可变。

## 来源页面模板

```markdown
---
title: "<工具> YYYY-MM-DD: <主题>"
type: source
updated: YYYY-MM-DD
sources:
  - <明确 artifact 路径或标识符>
---

## 提取说明
格式、提取方式、unknown/malformed/redactions 统计与限制。

## 关键内容
仅包含明确识别的用户文本、助手最终文本和安全产物路径摘要。

## 可靠性
高 / 混合 / 低——说明原因，不填补缺失内容。
```
