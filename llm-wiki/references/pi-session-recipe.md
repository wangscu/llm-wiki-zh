# Pi 会话配方

如何遍历和摄取 Pi 代理会话。LLM Wiki 摄取工作流中
会话步骤的延迟加载参考文档。

## 目录布局

Pi 将会话存储在 `~/.pi/agent/sessions/--<encoded-cwd>--/`，其中
`<encoded-cwd>` 是绝对工作目录路径，将 `/` 替换为 `-`。
同一目录下的多个 JSONL 文件 = 同一项目的恢复会话。

## 第 0 步：分叉检测（必须执行）

在阅读任何内容之前，检查分叉。分叉意味着恢复的会话、
子代理生成或重复的用户消息——每个分支可能包含不同的
主题内容。

```bash
SESSION="$HOME/.pi/agent/sessions/--<encoded-cwd>--/<file>.jsonl"

# 1. 分叉（拥有 >1 个子节点的父节点）——绝不跳过
jq -r 'select(.type=="message") | .parentId' "$SESSION" | sort | uniq -c | awk '$1>1 {print}'

# 2. 带时间戳的用户消息——检测跨日会话
jq -r 'select(.type=="message" and .message.role=="user") |
       "\(.timestamp[0:19]): \((.message.content | if type=="string" then . else (map(.text) | join("")) end) | .[0:100])"' "$SESSION"
```

**如果存在分叉，逐分支阅读。** 不要按时间戳排序后线性
阅读。提取所有带 `parentId` 元数据的助手消息。

## 第 1 步：提取实质性内容

```bash
# 所有助手文本和思考块（跨所有分支）
jq -r 'select(.type=="message" and .message.role=="assistant") |
       "\n--- parent=\(.parentId) ts=\(.timestamp) ---\n" +
       (.message.content | if type=="string" then . else
         (map(select(.type=="text" or .type=="thinking") | "[\(.type)] \(.text)") | join("\n")) end)' "$SESSION"
```

**关键规则：** 如果助手消息仅包含 `thinking: null` 且没有
`text`，说明助手通过 `write`/`edit` 工具调用产出了产物。检查
`custom` 事件（第 2 步）以了解产出了什么。

## 第 2 步：从自定义事件中提取失败和值得注意的事件

```bash
# 获取失败
echo "=== 获取失败 ==="
jq -r 'select(.type=="custom" and .data.type=="fetch_content" and .data.error) |
       "FAIL \(.data.urls[0]): \(.data.error)"' "$SESSION"

# 速率限制 / 错误
echo "=== 错误 ==="
jq -r 'select(.type=="custom" and (.data.type=="error" or .data.type=="rate_limit")) |
       "\(.data.type): \(.data | tostring)"' "$SESSION"

# 工具使用统计
echo "=== 工具 ==="
jq -r 'select(.type=="custom" and .data.type=="tool_execution_end") | .data.toolName' "$SESSION" | sort | uniq -c | sort -rn

# 通过 write/edit 产出的产物
echo "=== 产物 ==="
jq -r 'select(.type=="custom" and .data.type=="tool_execution_end" and
       (.data.toolName=="write" or .data.toolName=="edit")) |
       "\(.data.toolName): \(.data.result // .data.args // \"unknown\")"' "$SESSION"
```

**在会话页面中记录以下内容：**
- 获取失败（认证、429、登录墙）
- 速率限制或中断
- 通过工具调用产生的产物

## 第 3 步：提取引用的来源

```bash
# 来自 web_search + fetch_content 的 URL
jq -r 'select(.type=="custom" and .data.type=="web_search") | .data.queries[]?' "$SESSION"
jq -r 'select(.type=="custom" and .data.type=="fetch_content") |
       (.data.urls[]?, .data.queries[]?)' "$SESSION" | sort -u

# 被触及的文件
jq -r '.. | strings' "$SESSION" |
  grep -oE '[a-zA-Z_./~-]+\.(py|cu|md|txt|pdf|h|cc|json|jsonl|ts|js)' | sort -u
```

## 会话页面模板

```markdown
---
title: "Session YYYY-MM-DD: <主题>"
type: session
updated: YYYY-MM-DD
sources:
  - /absolute/path/to/session.jsonl
see_also: []
---

## 引言
一行摘要。

## 结构
线性 / 分叉（N 个分支）。是否跨日？是否触发速率限制？

## 关键内容
- 用户询问 X → 助手回复 Y

## 值得注意的事件
- 速率限制，时间戳："..."
- 获取失败：URL、原因
- 产生的产物：文件路径
```

## 应避免的错误

1. **❌ 按时间戳线性扫描**——会遗漏恢复会话和分叉分支。
2. **❌ 跳过自定义事件**——会遗漏获取失败、速率限制、错误。
3. **❌ 将工具调用分支视为空**——助手可能通过
   `write`/`edit` 产出了 40KB 的文件但无文本回复。
