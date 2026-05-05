# 代理会话配方

Claude Code、Gemini CLI、opencode 和 Pi 的最小提取模式。
延迟加载：仅在真正扫描代理对话记录时读取此文件。

## 概览

| 工具 | 存储位置 | 格式 | 分叉？ |
|------|---------|--------|--------|
| **Claude Code** | `~/.claude/projects/<sanitized-cwd>/<uuid>.jsonl` | JSONL 流 | 极少（恢复 = 新文件） |
| **Gemini CLI** | `~/.gemini/tmp/<proj>/chats/session-*.json` | 单个 JSON | 否 |
| **opencode** | `~/.local/share/opencode/opencode.db` | SQLite | 是（`parent_id`） |
| **Pi** | `~/.pi/agent/sessions/--<cwd>--/<file>.jsonl` | JSONL **树** | **是（关键）** |

`<sanitized-cwd>` = 将 `/` 替换为 `-`。Pi：`--<cwd>--` = 双横线包裹。

---

## Pi（JSONL 树）——分叉检测是必须的

Pi 会话**不是线性**的。每条消息都有 `parentId`。恢复的
对话、子代理生成和重复的用户消息会产生
**分叉**（一个父节点 → 多个子节点）。

### 第 0 步：检测分叉

```bash
SESSION="$HOME/.pi/agent/sessions/--<encoded-cwd>--/<file>.jsonl"

# 拥有 >1 个子节点的父节点 → 分叉分支
jq -r 'select(.type=="message") | .parentId' "$SESSION" | \
  sort | uniq -c | awk '$1>1 {print}'

# 用户消息时间戳 + 预览
jq -r 'select(.type=="message" and .message.role=="user") |
  "\(.timestamp[0:19]): \((.message.content | if type=="string" then . else (map(.text) | join("")) end) | .[0:100])"' "$SESSION"
```

**如果存在分叉，逐分支阅读。** 不要按时间戳排序。

### 逐分支提取

```bash
# 所有助手文本/思考（跨所有分支）
jq -r 'select(.type=="message" and .message.role=="assistant") |
  "\n--- parent=\(.parentId) ts=\(.timestamp) ---\n" +
  (.message.content | if type=="string" then . else
    (map(select(.type=="text" or .type=="thinking") |
      "[\(.type)] \(.text)") | join("\n")) end)' "$SESSION"

# 自定义事件：失败、产物、工具
jq -r 'select(.type=="custom") |
  if .data.type=="fetch_content" and .data.error then "FETCH_FAIL: \(.data.urls[0])"
  elif .data.type=="error" then "ERROR: \(.data | tostring[0:200])"
  elif .data.type=="tool_execution_end" and (.data.toolName=="write" or .data.toolName=="edit")
    then "ARTIFACT: \(.data.toolName) → \(.data.result // .data.args // "?")"
  else empty end' "$SESSION"
```

**关键：** 如果助手消息仅包含 `thinking: null` 且没有
`text`，说明助手通过 `write`/`edit` 产出了产物。检查自定义
事件以了解产出了什么。

---

## Claude Code（JSONL 流）

```bash
PROJ="$HOME/.claude/projects/-Users-me-devel-ProjName"

# 按大小 + 标题分类
ls -laS "$PROJ"/*.jsonl
for f in "$PROJ"/*.jsonl; do echo "$(basename "$f"): $(grep -m1 '"aiTitle":' "$f" | cut -d'"' -f4)"; done

# 跳过桩文件（<5 KB）

# 提取
jq -r 'select(.type=="user" and .message.role=="user") |
  "\n--- USER \(.timestamp) ---\n" +
  (.message.content | if type=="string" then . else (map(select(.type=="text") | .text) | join("\n")) end)' "$PROJ"/<uuid>.jsonl

jq -r 'select(.type=="assistant") |
  "\n--- ASSIST \(.timestamp) ---\n" +
  (.message.content | map(if .type=="text" then .text elif .type=="thinking" then "[think] "+.thinking elif .type=="tool_use" then "[tool:\(.name)] "+(.input|tostring|.[0:200]) else empty end) | join("\n"))' "$PROJ"/<uuid>.jsonl

# 子代理
for meta in "$PROJ"/<uuid>/subagents/*.meta.json; do
  echo "$(basename "$meta"): $(jq -r '.agent_type + " :: " + (.task_description // .description // "?")' "$meta")"
done
```

**首先读取 `memory/MEMORY.md`**——预先浓缩的基本事实。

---

## Gemini CLI（单个 JSON）

```bash
PROJ="$HOME/.gemini/tmp/<project-name>"

# 通过 .project_root 查找项目
for d in "$HOME/.gemini/tmp/"*/; do
  [ -f "$d/.project_root" ] && [ "$(cat "$d/.project_root")" = "$PWD" ] && echo "$d"
done

# 提取
SESSION="$PROJ/chats/session-*.json"
jq -r '.messages[] |
  if .type=="user" then "\n--- USER \(.timestamp) ---\n" + (.content | if type=="string" then . else (map(.text) | join("\n")) end)
  elif .type=="gemini" then "\n--- GEMINI \(.timestamp) ---\n" + .content +
    (if .thoughts then "\n[thoughts]\n" + (.thoughts | map("- [\(.subject)] \(.description)") | join("\n")) else "" end) +
    (if .toolCalls then "\n[tools]\n" + (.toolCalls | map("\(.name)(\(.args | tostring | .[0:160]))") | join("\n")) else "" end)
  else empty end' "$SESSION"

# Token 总量
jq -r '[.messages[] | select(.tokens) | .tokens.total] | add' "$SESSION"
```

工具输出在 `tool-outputs/session-<id>/`——有选择地读取。

---

## opencode（SQLite——两种 schema 变体）

```bash
DB="$HOME/.local/share/opencode/opencode.db"

# 索引项目的会话
sqlite3 "$DB" "SELECT id, title, datetime(time_created/1000,'unixepoch') FROM session WHERE directory LIKE '%$(basename "$PWD")%' ORDER BY time_created;"

# 检测 schema 变体
sqlite3 "$DB" ".schema message" | head -5
```

### 变体 A（较新）：`message.data` 和 `part.data` 是 JSON blob

```bash
SID="ses_..."
sqlite3 -separator $'\x1f' "$DB" "
  SELECT 'M', m.id, m.time_created, m.data FROM message m WHERE m.session_id='$SID'
  UNION ALL
  SELECT 'P', p.message_id, p.time_created, p.data FROM part p WHERE p.session_id='$SID'
  ORDER BY 3, 1;" | while IFS=$'\x1f' read -r kind mid ts data; do
  if [ "$kind" = "M" ]; then
    echo; echo "--- MSG role=$(echo "$data" | jq -r '.role // "?"') ts=$ts ---"
  else
    echo "$data" | jq -r 'if .type=="text" then .text
      elif .type=="tool" then "[tool:\(.tool // "?")] " + ((.state // {}) | tostring | .[0:300])
      elif .type=="reasoning" then "[think] " + .text
      else "[\(.type)] " + (. | tostring | .[0:200]) end'
  fi
done
```

### 变体 B（较旧）：`message` 有 `role`、`text`；`part` 有 `type`、`text`

```bash
SID="ses_..."
sqlite3 -header -separator $'\t' "$DB" "
  SELECT m.role, datetime(m.time_created/1000,'unixepoch') AS t, p.type, p.text
  FROM message m LEFT JOIN part p ON p.message_id = m.id
  WHERE m.session_id='$SID' ORDER BY m.time_created, p.id;"
```

**子代理：** `session.parent_id` 链接子会话到父会话。

---

## 分类（所有工具）

1. **跳过 <5 KB**——桩文件只是噪音
2. **首先读取 memory**（仅 Claude）——每字节价值最高
3. **使用标题/slug** 在深度阅读前按主题聚类
4. **交叉引用 git log**——靠近提交的会话时间戳揭示驱动因素
5. **记录提取失败**——不要伪造你无法读取的内容

## 模板

```markdown
---
title: "<工具> YYYY-MM-DD: <主题>"
type: source
updated: YYYY-MM-DD
sources:
  - /path/to/session.{jsonl,json}  # 或 sqlite id
---

## 元数据
ID、项目、开始/更新、长度、模型。

## 结构
线性 / 分叉 / 恢复。子代理？附属文件？

## 关键内容
用户询问 X → 助手 Y。触及的文件、引用的论文。

## 值得注意的事件
速率限制、获取失败、产生的产物。

## 可靠性
高 / 混合 / 低——原因。
```
