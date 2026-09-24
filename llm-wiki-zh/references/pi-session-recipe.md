# Pi 会话配方

用于安全摄取用户明确提供的单一 transcript。Pi JSONL 是带 `parentId` 的树，
不是可按时间戳直接线性化的消息流；恢复操作和分支可能使同一父节点拥有多个
子节点。

## 明确文件与能力边界

- 要求用户提供一个明确的 transcript 绝对路径；不得扫描 Pi 存储目录猜测 current session。
- 不承诺访问隐藏分支或隐藏 agent 轨迹。只有明确文件中可见的记录才在范围内。
- 原 JSONL 是不稳定证据 artifact，不是稳定 API；未知或无法确认的记录保守跳过并披露。
- 只读原文件，不修改它。任何终端输出或 Wiki 持久化之前都必须先脱敏。

## 第 0 步：只做结构检查

如果有 `jq`，可对明确文件只输出聚合结构统计。下列命令不输出消息内容、
事件 payload、URL、错误详情或工具参数／结果：

```bash
PI_TRANSCRIPT=/absolute/path/to/pi-session.jsonl
jq -s '{
  messages: ([.[] | select(.type == "message")] | length),
  roots: ([.[] | select(.type == "message" and .parentId == null)] | length),
  branch_points: ([.[] | select(.type == "message") | .parentId]
    | group_by(.) | map(select(length > 1)) | length)
}' "$PI_TRANSCRIPT"
```

`branch_points > 0` 表示必须按 `parentId` 关系区分分支，不能按时间戳拼成一条
对话。结构解析失败时停止自动处理并报告；不要退回宽泛打印记录的命令。

缺少 `jq` 时安全降级：只读打开用户明确提供的文件，保守识别树关系；如果
无法可靠确认父子关系，则披露“分支结构未验证”，只处理能够明确识别的内容。

## 第 1 步：允许的内容

逐分支处理时只允许以下输出：

1. `message.role == user` 的明确文本内容；
2. `message.role == assistant` 的最终 `text` 内容；
3. allowlist 中的安全工具名称，以及结构化 `path`、`file_path` 或 `filePath`
   产物路径摘要。工具 allowlist 限于产生明确文件的 `write`、`edit`。

助手最终文本不包括 thinking、reasoning 或其他私有块。工具记录不读取或输出
raw arguments、raw result、完整工具返回值、错误 payload、查询、URL 或未知字段。
不要递归遍历任意字符串来猜文件、来源或产物。

## 第 2 步：先脱敏，再输出

在任何终端显示、审阅文本或 Wiki 写入前，对允许内容执行脱敏：

- 删除 Authorization、Cookie、密码、token、API key、私钥和环境凭据；
- URL 或路径只保留无凭据的安全部分，移除 userinfo、query 和 fragment；
- 工具名称只接受 allowlist 的字面值；产物路径只接受上节三个结构化字段；
- 统计并披露 unknown、malformed、redactions 和被跳过内容类别。

如果无法可靠解析或脱敏某条记录，跳过它并披露限制；不得猜测字段、回显原始
记录或伪造对话。仅含私有块或不安全工具 payload 的分支可记录为“无可安全
提取的最终文本”，不能用原始工具数据补齐。

## 第 3 步：来源与 provenance

把明确 transcript 自身作为来源，不从未知事件中自动提取 URL、查询或文件。
provenance 至少记录：

- 用户明确提供的 transcript 路径或稳定标识符；
- Pi 树结构是否验证、分支点数量（若可得）；
- unknown、malformed、redactions 与跳过类别；
- 未访问隐藏分支／agent 的边界，以及任何安全降级限制；
- 原 transcript 未被修改，注册版本对应不可变 snapshot。

## 会话页面模板

```markdown
---
title: "Pi Session YYYY-MM-DD: <主题>"
type: source
updated: YYYY-MM-DD
sources:
  - <明确 transcript snapshot 或不可变 locator>
see_also: []
---

## 提取说明
分支结构、unknown/malformed/redactions 统计与安全降级限制。

## 关键内容
仅包含已脱敏的用户文本、助手最终文本和安全产物路径摘要。

## 可靠性
说明未解析记录、不可见分支和其他证据边界，不填补缺失内容。
```

## 应避免的错误

1. 按时间戳线性拼接树形会话。
2. 打印 reasoning、未知事件、完整错误、URL/query、工具参数或工具结果。
3. 扫描目录猜 current session，或承诺取得未明确提供的隐藏轨迹。
4. 在脱敏前把会话内容输出到终端或持久化到 Wiki。
