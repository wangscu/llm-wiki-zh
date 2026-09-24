# LLM Wiki Skill 行为评估

## RED：修改前基线

评估日期：2026-09-24

评估对象：`llm-wiki-zh/SKILL.md` 与 `references/agent-session-recipe.md` 的当前版本。

### 场景 1：普通总结是否触发写操作

请求：在 Git 仓库子目录中说“帮我总结这篇论文，看看能不能和已有知识联系起来”，项目尚无 `llm-wiki/`。

基线行为：

- 评估代理会因为“论文”和“应组织沉淀的材料”而选择 ingest，即使用户没有表达保存意图。
- 它会把 Git 根目录判断为目标项目，准备初始化并在确认后创建 Wiki 文件。
- 当前 Skill 的首次初始化确认避免了立即落盘，但触发范围仍把普通总结误判成写操作。

失败：自动选择 Skill 可以成立，但没有明确写入意图时应保持只读，不应进入初始化或摄取流程。

### 场景 2：只读 lint

请求：已有 Wiki，用户说“检查 wiki，但只报告，绝对不要改任何文件”。

基线行为：

- 评估代理能让用户的直接约束覆盖默认行为，并执行只读审计。
- 但当前 Skill 没有正式的只检查模式；默认会自动修复确定性问题并把发现写入 `log.md`。

风险：依赖代理临场解决冲突，无法形成跨宿主一致的操作契约。

### 场景 3：小型、未知格式且含秘密的 Claude transcript

请求：摄取当前 Claude Code 会话及子代理；主 JSONL 为 4 KB，包含未知记录，工具参数含 Bearer token，子代理只有 `agent-abc.jsonl`，机器没有 `jq`。

基线行为：

- `<5 KB` 硬规则把真实主会话当作桩文件跳过。
- 子代理发现只遍历 `*.meta.json`，因此忽略只有 JSONL 的子代理。
- 未知记录被静默跳过。
- 缺少 `jq` 时没有回退路径。
- 工具参数使用 `tostring` 输出，可能泄露 Authorization token 并被持久化。
- 不能稳定识别“当前会话”。

失败：会丢失用户明确指定的证据，且存在秘密泄露风险。

## GREEN 验收场景

修改后用新 Skill 和脚本重新评估以下行为：

1. 普通总结保持只读；只有明确的摄取、初始化、更新或保存意图才写入。
2. “只检查”进入正式只读模式；普通 lint 保留现有确定性修复行为。
3. 明确指定的 4 KB transcript 不因大小跳过。
4. 会话助手在没有 `jq` 时仍能工作，因为它仅依赖 Node 标准库。
5. 未知记录被计数并报告，不导致崩溃或伪造。
6. Bearer token、Cookie、密码和认证字段不出现在规范化输出。
7. 缺少 `.meta.json` 不阻止读取用户明确指定的子代理 transcript。
8. 不扫描内部目录猜测当前会话；无法取得隐藏子代理轨迹时明确说明边界。

## GREEN：修改后结果

评估日期：2026-09-24

评估对象：修改后的 `llm-wiki-zh/SKILL.md`、Pi extension、会话配方与
`scripts/normalize-session.mjs`。

### 场景 1：普通总结保持只读 — PASS

请求：“帮我总结这篇论文，看看能不能和已有知识联系起来”，项目没有 Wiki，
请求中也没有保存意图。

观察结果：

- discovery description 不会把普通总结识别为 ingest 请求。
- 即使显式加载 Skill，普通总结与“联系已有知识”仍按操作契约严格只读。
- 不解析写入目标、不进入初始化，也不创建或修改 `SCHEMA.md`、`index.md`、
  `log.md`、`raw-sources/` 或其他 Wiki 文件。
- 可以直接给出总结，并说明若要沉淀需另行明确要求摄取、初始化、更新或保存。

### 场景 2：只报告 lint 是正式无写入模式 — PASS

请求：“检查 wiki，但只报告，绝对不要改任何文件”。

观察结果：

- “只报告”正式路由到 check-only，而不是依赖临场覆盖普通 lint。
- check-only 报告与普通 lint 相同的确定性和启发式问题类别，但不修复，
  不修改 index、SCHEMA、page、raw source 或任何其他文件，尤其不创建或修改
  `log.md`；结果只在回复中给出。
- 普通 lint 仍可修复确定性问题，并按原契约记录 `log.md`。
- Pi bridge 对 `只报告`、`只检查` 和独立 `--check` 均发送
  `只检查wiki，不要修改任何文件`；普通 lint 仍发送 `检查wiki`。

### 场景 3：小型 Claude transcript 安全处理 — PASS

对明确提供的 506-byte `test/fixtures/sessions/claude-small.jsonl` 实际运行：

```bash
node llm-wiki-zh/scripts/normalize-session.mjs --format claude test/fixtures/sessions/claude-small.jsonl
```

观察结果：

- 进程 exit 0；文件远小于 5 KiB，仍被处理，没有小文件跳过规则。
- stdout 仅包含规范化标题、User 文本（Authorization 值为 `[REDACTED]`）、
  Assistant 最终文本和 `[tool: write → notes/result.md]`；Bearer 原值、密码、
  private thinking 与未知记录中的 secret 均未出现。
- stderr 精确为
  `[normalize-session] format=claude records=3 messages=2 unknown=1 malformed=0 redactions=1`，
  unknown、malformed 与 redactions 均有披露。
- normalizer 只依赖 Node 标准库，不依赖 `jq`；thinking、raw tool arguments 和
  完整工具结果不会输出。
- 用户明确提供的 child JSONL 即使没有 `.meta.json` 也可独立处理；Skill 不扫描
  存储猜测 current session，也不承诺 hidden child trajectory。
- Node 不可用或解析失败时，契约要求保守只读降级，只提取明确的用户／助手最终
  文本、脱敏秘密并披露局限，不猜测字段或伪造对话。
