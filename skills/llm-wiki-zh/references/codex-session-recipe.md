# Codex 会话配方

用于安全摄取用户明确提供的 Codex transcript。当前对话直接使用当前上下文中
可见的内容和已经回传的子代理结果，不需要也不得从磁盘发现会话。

> **不稳定证据警告：** `$CODEX_HOME/sessions` 与
> `$CODEX_HOME/archived_sessions` 是已知的高层证据位置；`$CODEX_HOME`
> 默认是 `~/.codex`。这些路径和其中的 JSONL 字段都是实现产生的证据 artifact，
> 不是稳定公共 API，可能随 Codex 版本变化。

## 明确文件原则

- 不扫描上述目录来猜测“当前会话”；要求用户明确提供 transcript 文件。
- 不承诺访问隐藏的子代理轨迹。只有用户明确提供 child transcript 时才处理，
  缺少 metadata 不阻止读取明确文件。
- 不把不稳定字段表述为保证，也不靠字段猜测或补全对话。

## 安全规范化

从已安装 Skill 根目录运行：

```bash
node scripts/normalize-session.mjs --format codex /absolute/path/to/session.jsonl
```

脚本只读明确文件，不修改原 transcript：

- stdout 输出脱敏后的统一 Markdown，只包含可安全识别的用户文本、助手最终文本和安全工具名称／产物路径摘要；
- stderr 输出一行统计，包括 format、records、messages、unknown、malformed 和 redactions；
- unknown／malformed 记录会计数并跳过，不会成为伪造对话；
- reasoning、raw tool arguments、完整工具结果、认证材料和秘密不会进入输出；
- 非零退出是安全失败，表示读取失败、格式被拒绝或没有可安全提取的消息。

始终先审阅 stdout 与 stderr，再决定是否摄取。规范化输出不是原 transcript 的
替代物；注册来源后保持原始来源版本和归档 synthesis 不可变。

## Node 不可用或解析失败

降级为保守手工读取：

1. 只读打开用户明确提供的 transcript；
2. 仅提取角色明确的用户文本和助手最终文本；
3. 跳过 reasoning、工具 payload、完整工具结果和未知记录；
4. 移除 token、Cookie、密码、Authorization header、签名 URL 等秘密；
5. 披露 Node 不可用／解析失败和手工提取限制；
6. 不猜字段、不伪造消息、不修改原文件。

## Provenance

摄取记录至少包含：

- 用户明确提供的 transcript 绝对路径或稳定标识符；
- 请求格式 `codex` 与实际提取方式；
- normalizer 的 unknown、malformed、redactions 统计（若运行成功）；
- 脱敏、跳过记录与安全降级限制；
- 原 transcript 未被修改，以及已注册来源版本保持不可变。

明确提供的 child transcript 使用同一流程；没有文件就明确说明不可访问隐藏轨迹。
