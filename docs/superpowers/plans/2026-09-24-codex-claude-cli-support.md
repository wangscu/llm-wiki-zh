# Codex and Claude Code CLI Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package one canonical `llm-wiki-zh` Skill for Pi, Codex CLI, and Claude Code CLI, with safe session normalization and reproducible validation.

**Architecture:** Keep `llm-wiki-zh/` as the only hand-maintained Skill source and generate `skills/llm-wiki-zh/` deterministically. Codex and Claude consume that shared generated tree through separate manifests and marketplace metadata. A dependency-free Node helper normalizes explicitly supplied session transcripts without exposing secrets or relying on stable vendor JSONL schemas.

**Tech Stack:** Markdown Agent Skills, Node.js 22+ standard library, Node built-in test runner, JSON manifests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-24-codex-claude-cli-support.md`

## Global Constraints

- Release version is exactly `1.5.0`; npm already contains `1.1.0` through `1.4.8`.
- `llm-wiki-zh/` is the only hand-maintained Skill source; `skills/llm-wiki-zh/` is generated and committed.
- Add no runtime or development dependency; scripts use only Node standard-library modules.
- Preserve Pi Git installation and the existing `/wiki-ingest`, `/wiki-query`, and `/wiki-lint` behavior.
- Codex and Claude share Skill content but never share host-specific manifest semantics.
- No MCP, Hook, public binary CLI, model call, telemetry, external publish, push, release, or marketplace submission.
- Transcript normalization reads only an explicitly supplied file, never discovers “current session,” never writes the source, and never emits reasoning, raw tool arguments, authentication data, or complete tool results.
- Project Wiki data remains outside plugin directories; uninstall metadata must not target or delete `llm-wiki/`.
- Full documentation remains Chinese; discovery metadata and important error text are bilingual.
- Support session automation on macOS, Linux, and WSL; native Windows discovery remains outside this plan.

## Review Focus

- A deleted or renamed canonical Skill file must become a detected stale generated file and must be removed only in sync mode — Task 1 tests this.
- A manifest version drift must fail check mode and be repaired from `package.json` without changing unrelated fields — Task 1 tests this.
- A malformed or unknown JSONL record must not crash, disappear silently, or produce fabricated dialogue — Task 2 tests this.
- Secrets embedded in message text, headers, tool arguments, and signed URLs must not reach stdout — Task 2 tests these input classes.
- Ordinary summarization must remain read-only, lint check-only must never write, and Pi’s `--check` argument must survive the extension bridge — Task 3 tests and forward-evaluates this.

---

### Task 1: Shared Skill generation and plugin packaging foundation

**Files:**
- Create: `scripts/sync-skill.mjs`
- Create: `test/sync-skill.test.mjs`
- Create: `plugin.json`
- Create: `.codex-plugin/plugin.json`
- Create: `.claude-plugin/plugin.json`
- Create: `.agents/plugins/marketplace.json`
- Create: `.claude-plugin/marketplace.json`
- Generate: `skills/llm-wiki-zh/**`
- Modify: `package.json`

**Interfaces:**
- Produces: `syncRepository(root, { check }) -> Promise<{ differences: string[], changed: boolean }>` exported from `scripts/sync-skill.mjs`.
- Produces: CLI `node scripts/sync-skill.mjs [--check] [--root ABSOLUTE_OR_RELATIVE_PATH]`.
- Produces: one self-contained plugin root consumed by both host manifests.
- Consumes: `package.json.version`, canonical directory `llm-wiki-zh/`, and the three plugin manifest paths.

- [ ] **Step 1: Write failing synchronization tests**

Create `test/sync-skill.test.mjs` with temporary repositories built under `fs.mkdtemp()` and literal expected files. Cover all of these behaviors:

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { syncRepository } from "../scripts/sync-skill.mjs";

test("check reports a missing generated skill without writing it", async () => {
  const root = await makeFixture();
  const result = await syncRepository(root, { check: true });
  assert.equal(result.changed, true);
  assert.match(result.differences.join("\n"), /missing: skills\/llm-wiki-zh\/SKILL\.md/);
  await assert.rejects(readFile(path.join(root, "skills/llm-wiki-zh/SKILL.md")));
});

test("sync mirrors canonical files, removes stale files, and preserves the source", async () => {
  const root = await makeFixture();
  await mkdir(path.join(root, "skills/llm-wiki-zh"), { recursive: true });
  await writeFile(path.join(root, "skills/llm-wiki-zh/stale.md"), "stale\n");
  await syncRepository(root, { check: false });
  assert.equal(await readFile(path.join(root, "skills/llm-wiki-zh/SKILL.md"), "utf8"), "canonical\n");
  await assert.rejects(readFile(path.join(root, "skills/llm-wiki-zh/stale.md")));
  assert.equal(await readFile(path.join(root, "llm-wiki-zh/SKILL.md"), "utf8"), "canonical\n");
});

test("manifest versions come from package.json and unrelated metadata survives", async () => {
  const root = await makeFixture({ version: "1.5.0", manifestVersion: "1.0.4" });
  await syncRepository(root, { check: false });
  const manifest = JSON.parse(await readFile(path.join(root, "plugin.json"), "utf8"));
  assert.equal(manifest.version, "1.5.0");
  assert.equal(manifest.description, "fixture description");
});

test("check is clean after sync", async () => {
  const root = await makeFixture();
  await syncRepository(root, { check: false });
  assert.deepEqual(await syncRepository(root, { check: true }), { differences: [], changed: false });
});
```

`makeFixture()` must create `package.json`, `llm-wiki-zh/SKILL.md`, and all three manifest files; use literal JSON values rather than helpers from production code.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test test/sync-skill.test.mjs
```

Expected: FAIL because `scripts/sync-skill.mjs` and `syncRepository` do not exist.

- [ ] **Step 3: Implement deterministic sync and check modes**

Create `scripts/sync-skill.mjs` using only `node:fs/promises`, `node:path`, `node:url`, and `node:process`.

Implement these exact rules:

```js
const SOURCE_DIR = "llm-wiki-zh";
const TARGET_DIR = "skills/llm-wiki-zh";
const MANIFESTS = [
  "plugin.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
];

export async function syncRepository(root, { check = false } = {}) {
  // Compare source and generated trees by relative path and byte content.
  // Differences use stable prefixes: "missing:", "changed:", "stale:", "version:".
  // check=true returns differences and performs no writes.
  // check=false recreates missing directories, copies changed files, removes stale target files,
  // and updates only each manifest's top-level version field from package.json.
}
```

Sort every traversed relative path so output and tests are deterministic. Reject a missing source directory, malformed package JSON, non-semver package version, missing manifest, or malformed manifest with a bilingual error and non-zero CLI status. The CLI must accept only `--check` and `--root PATH`; unknown or missing flag values exit non-zero.

- [ ] **Step 4: Run the synchronization tests and verify GREEN**

Run:

```bash
node --test test/sync-skill.test.mjs
```

Expected: four tests pass with no warnings.

- [ ] **Step 5: Add the host manifests and marketplace metadata**

Create root `plugin.json`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "llm-wiki-zh",
  "version": "1.5.0",
  "description": "构建和维护中文 LLM Wiki / Build and maintain a Chinese LLM Wiki"
}
```

Create `.codex-plugin/plugin.json` with the same name/version/description plus `author.name: "wangscu"`, `skills: "./skills/"`, and an `interface` whose display name is `LLM Wiki Zh`, category is `Productivity`, capabilities are `Read` and `Write`, and default prompt asks to query an existing Wiki.

Create `.claude-plugin/plugin.json` with `name`, `version`, `description`, and `author.name: "wangscu"`.

Create Codex marketplace metadata with marketplace name `llm-wiki-zh`, local source path `./`, `AVAILABLE` installation, `ON_INSTALL` authentication, and category `Productivity`:

```json
{
  "name": "llm-wiki-zh",
  "interface": { "displayName": "LLM Wiki Zh" },
  "plugins": [{
    "name": "llm-wiki-zh",
    "source": { "source": "local", "path": "./" },
    "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
    "category": "Productivity"
  }]
}
```

Create Claude marketplace metadata with name `llm-wiki-zh-marketplace`, owner name `wangscu`, and one local root plugin:

```json
{
  "name": "llm-wiki-zh-marketplace",
  "owner": { "name": "wangscu" },
  "plugins": [{ "name": "llm-wiki-zh", "source": "./" }]
}
```

- [ ] **Step 6: Update package metadata and generate the shared Skill**

Change `package.json` to version `1.5.0`. Add scripts:

```json
{
  "sync:skill": "node scripts/sync-skill.mjs",
  "check:skill": "node scripts/sync-skill.mjs --check",
  "test": "node --experimental-strip-types --test"
}
```

Include `skills`, `plugin.json`, `.codex-plugin`, `.claude-plugin`, `.agents`, and `scripts` in the npm `files` list while retaining the existing Pi files. Run:

```bash
npm run sync:skill
npm run check:skill
npm test
npm pack --dry-run
```

Expected: check exits 0, tests pass, and the dry-run package lists both canonical and generated Skill trees plus all manifests.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json scripts/sync-skill.mjs test/sync-skill.test.mjs plugin.json .codex-plugin .claude-plugin .agents skills
git commit -m "feat: package skill for codex and claude"
```

---

### Task 2: Safe best-effort session normalizer

**Files:**
- Create: `llm-wiki-zh/scripts/normalize-session.mjs`
- Create: `test/normalize-session.test.mjs`
- Create: `test/fixtures/sessions/claude-small.jsonl`
- Create: `test/fixtures/sessions/codex-basic.jsonl`
- Generate: `skills/llm-wiki-zh/scripts/normalize-session.mjs`

**Interfaces:**
- Produces: `redactText(text) -> { text, redactions }`.
- Produces: `normalizeSession(text, { format }) -> { output, stats }` where `format` is `auto`, `claude`, or `codex`.
- Produces: CLI `node scripts/normalize-session.mjs [--format auto|claude|codex] FILE` inside the installed Skill.
- Output contract: normalized Markdown on stdout; one bilingual stats line on stderr; no filesystem writes.

- [ ] **Step 1: Add literal red-team fixtures and failing tests**

`claude-small.jsonl` must be under 5 KiB and contain:

```jsonl
{"type":"user","timestamp":"2026-09-24T10:00:00Z","message":{"role":"user","content":"Compare alpha and beta. Authorization: Bearer secret-token-123"}}
{"type":"assistant","timestamp":"2026-09-24T10:00:01Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"private chain"},{"type":"text","text":"Alpha is safer."},{"type":"tool_use","name":"write","input":{"path":"notes/result.md","content":"password=hunter2"}}]}}
{"type":"future_record","payload":{"access_token":"future-secret"}}
```

`codex-basic.jsonl` must contain one `session_meta`, one user `response_item`, one assistant `response_item`, one tool-call item with a signed URL, and one unknown event.

Create `test/normalize-session.test.mjs` and assert observable behavior:

```js
test("normalizes a small Claude transcript without secrets or reasoning", async () => {
  const input = await readFile(fixture("claude-small.jsonl"), "utf8");
  const result = normalizeSession(input, { format: "claude" });
  assert.match(result.output, /## User/);
  assert.match(result.output, /Compare alpha and beta/);
  assert.match(result.output, /## Assistant/);
  assert.match(result.output, /Alpha is safer\./);
  assert.match(result.output, /\[tool: write → notes\/result\.md\]/);
  assert.doesNotMatch(result.output, /secret-token|hunter2|private chain|future-secret/);
  assert.equal(result.stats.unknownRecords, 1);
  assert.ok(result.stats.redactions >= 1);
});

test("normalizes Codex response items and ignores implementation events", async () => {
  const input = await readFile(fixture("codex-basic.jsonl"), "utf8");
  const result = normalizeSession(input, { format: "codex" });
  assert.match(result.output, /## User/);
  assert.match(result.output, /## Assistant/);
  assert.doesNotMatch(result.output, /X-Amz-Signature|session_meta|private_event/);
  assert.ok(result.stats.unknownRecords >= 1);
});

test("reports malformed lines without inventing content", () => {
  const result = normalizeSession('{"type":"user"}\nnot-json\n', { format: "claude" });
  assert.equal(result.stats.malformedLines, 1);
  assert.doesNotMatch(result.output, /not-json/);
});

test("CLI writes only normalized content to stdout and never mutates the source", async () => {
  const before = await readFile(fixture("claude-small.jsonl"), "utf8");
  const run = spawnSync(process.execPath, [SCRIPT, "--format", "claude", fixture("claude-small.jsonl")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /secret-token|hunter2|private chain/);
  assert.equal(await readFile(fixture("claude-small.jsonl"), "utf8"), before);
});
```

Also test Cookie/Set-Cookie headers, `api_key`, `password`, `access_token`, `refresh_token`, GitHub tokens, OpenAI-style `sk-` values, Slack tokens, AWS access keys, and signed URL query parameters using hand-written expected redactions.

- [ ] **Step 2: Run the normalizer tests and verify RED**

Run:

```bash
node --test test/normalize-session.test.mjs
```

Expected: FAIL because the normalizer module does not exist.

- [ ] **Step 3: Implement parsing, filtering, and redaction**

Implement `llm-wiki-zh/scripts/normalize-session.mjs` with these record boundaries:

- Claude: accept top-level `type: user|assistant`, read only `message.content` strings and blocks of `type: text`; render `tool_use` only as tool name and a path from `path`, `file_path`, or `filePath`; ignore `thinking` and raw tool input.
- Codex: accept `type: response_item`; extract message-like payloads with role `user|assistant` and text content; render tool calls only as safe tool name/path summaries; treat `session_meta`, `turn_context`, `event_msg`, `world_state`, and unknown types as metadata or unknown counts, never dialogue.
- Auto mode: detect Claude from top-level `user|assistant` records and Codex from `response_item`; mixed or unsupported input exits non-zero instead of guessing.
- Malformed lines increment `malformedLines`; unknown well-formed records increment `unknownRecords`.
- If no supported user or assistant text remains, the CLI exits non-zero with `未找到可安全提取的消息 / no safely extractable messages`.

Run all extracted text through `redactText`. Redact header values, sensitive key/value assignments, known token prefixes, AWS access-key IDs, and sensitive URL query parameters. Replace each secret with `[REDACTED]` and return the replacement count. Never provide a flag that disables redaction.

Output format:

```markdown
# 规范化代理会话

## User
Compare alpha and beta. Authorization: Bearer [REDACTED]

## Assistant
Alpha is safer.
[tool: write → notes/result.md]
```

Stats go to stderr in one stable line:

```text
[normalize-session] format=claude records=3 messages=2 unknown=1 malformed=0 redactions=1
```

- [ ] **Step 4: Run the normalizer tests and verify GREEN**

Run:

```bash
node --test test/normalize-session.test.mjs
npm run sync:skill
npm run check:skill
npm test
```

Expected: all normalizer tests and the complete suite pass; generated helper equals the canonical helper.

- [ ] **Step 5: Commit Task 2**

```bash
git add llm-wiki-zh/scripts/normalize-session.mjs skills/llm-wiki-zh/scripts/normalize-session.mjs test/normalize-session.test.mjs test/fixtures/sessions
git commit -m "feat: normalize agent sessions safely"
```

---

### Task 3: Cross-host Skill behavior and session guidance

**Files:**
- Modify: `llm-wiki-zh/SKILL.md`
- Modify: `llm-wiki-zh/extension.ts`
- Modify: `llm-wiki-zh/references/agent-session-recipe.md`
- Modify: `llm-wiki-zh/references/SCHEMA.template.md`
- Create: `llm-wiki-zh/references/codex-session-recipe.md`
- Create: `test/extension.test.mjs`
- Generate: corresponding files under `skills/llm-wiki-zh/`
- Use: `docs/superpowers/evaluations/2026-09-24-llm-wiki-skill.md`

**Interfaces:**
- Consumes: `node scripts/normalize-session.mjs --format FORMAT FILE` relative to the installed Skill root.
- Produces: one Skill with explicit `ingest`, `query`, `lint`, and lint check-only routing.
- Preserves: Pi command names and default messages.

- [ ] **Step 1: Write a failing Pi bridge test**

Create `test/extension.test.mjs`. Import `llm-wiki-zh/extension.ts` under Node’s type stripping, register commands against a real in-memory fake, then call the handlers:

```js
test("wiki-lint forwards explicit check-only intent", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-lint").handler("--check", {});
  assert.deepEqual(messages, ["只检查wiki，不要修改任何文件"]);
});

test("wiki-lint keeps the existing repair behavior by default", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-lint").handler("", {});
  assert.deepEqual(messages, ["检查wiki"]);
});
```

Also preserve the existing ingest and query messages in behavior tests.

- [ ] **Step 2: Run the Pi bridge test and verify RED**

Run:

```bash
node --experimental-strip-types --test test/extension.test.mjs
```

Expected: the check-only test fails because the existing handler ignores its argument.

- [ ] **Step 3: Implement the minimal Pi bridge change**

Change only `wiki-lint`’s handler:

```ts
async handler(args, _ctx) {
  const checkOnly = /(^|\s)--check(?:\s|$)/.test(args ?? "") || /只检查|只报告/.test(args ?? "");
  pi.sendUserMessage(checkOnly ? "只检查wiki，不要修改任何文件" : "检查wiki");
}
```

Run the extension test and verify it passes before editing the Skill prose.

- [ ] **Step 4: Revise Skill routing and mutation contracts**

Change the frontmatter description to a concise discovery condition that includes English and Chinese trigger terms but does not summarize the workflow:

```yaml
description: Use when users explicitly ask to ingest/录入 or save material into an LLM Wiki, query/查询 an existing wiki, or lint/检查 its health.
```

Add an operation contract near the top:

- Ordinary summarization, research, or “connect this with existing knowledge” remains read-only unless the user explicitly asks to persist it.
- `ingest` and accepted synthesis archival write; `query` never writes; normal `lint` may repair deterministic issues and log them; `lint --check` or “只检查／只报告” writes nothing, including `log.md`.
- Before any write, resolve the target as explicit path, otherwise nearest Git root, otherwise cwd; show it before initialization.
- If a write target changed after it was read, stop and report a single-writer conflict.

Revise ingest rules to define canonical source identity plus content digest behavior without editing immutable sources: unchanged source is a no-op; changed content is a new source version; derived pages receive precise changes only.

Change synthesis archival to `type: synthesis` only. Document `entity` and `archive` as legacy values that lint warns about but does not auto-migrate or fail.

Add security/input rules: explicit URL only, no crawling or telemetry, confirm private/authenticated access, never persist credentials, preflight text over 1 MiB or batches over 20 files, require text sidecars for binary sources.

- [ ] **Step 5: Replace brittle session assumptions with progressive references**

In `SKILL.md`, route session ingestion as follows:

- Current conversation: use only visible context and returned subagent results.
- Explicit Claude/Gemini/opencode transcript: read `references/agent-session-recipe.md`.
- Explicit Codex transcript: read `references/codex-session-recipe.md`.
- Run the optional normalizer for explicit Codex/Claude JSONL; if Node or parsing is unavailable, read conservatively and disclose the limitation.
- Never scan host storage to guess current session or promise hidden subagent trajectories.

Rewrite only the Claude section and common classification rules in `agent-session-recipe.md`: retain documented storage locations, remove sanitized-cwd derivation, `aiTitle`, `<5 KB`, fixed JSONL-field, and `.meta.json` requirements; give the exact normalizer command and explain that unknown records are reported. Preserve Gemini and opencode guidance unless it conflicts with the global secret-handling rule.

Create `codex-session-recipe.md` with:

- Official high-level locations `$CODEX_HOME/sessions` and `$CODEX_HOME/archived_sessions`, defaulting `CODEX_HOME` to `~/.codex`.
- A warning that transcript paths and JSONL formats are evidence artifacts, not stable APIs.
- Explicit-file-only normalizer invocation.
- Current visible-context guidance and clear hidden-subagent limitation.
- Failure, redaction, and provenance rules.

Update `SCHEMA.template.md` to list the eight canonical types and a separate legacy compatibility note for `entity` and `archive`.

- [ ] **Step 6: Validate and sync the revised Skill**

Run:

```bash
python3 /Users/wangyajun10/.codex/skills/.system/skill-creator/scripts/quick_validate.py llm-wiki-zh
npm run sync:skill
npm run check:skill
npm test
```

Expected: Skill validation succeeds, generated content is current, and all tests pass.

- [ ] **Step 7: Run GREEN forward evaluations with fresh subagents**

Repeat the three scenarios in `docs/superpowers/evaluations/2026-09-24-llm-wiki-skill.md` against the revised Skill. Record the resulting behavior under a new `## GREEN：修改后结果` section. Passing behavior must demonstrate explicit write authorization, a real check-only mode, small transcript handling, unknown-record reporting, and secret removal.

- [ ] **Step 8: Commit Task 3**

```bash
git add llm-wiki-zh skills/llm-wiki-zh test/extension.test.mjs docs/superpowers/evaluations/2026-09-24-llm-wiki-skill.md
git commit -m "feat: align wiki behavior across cli hosts"
```

---

### Task 4: Repository validator, CI, and installation documentation

**Files:**
- Create: `scripts/validate-package.mjs`
- Create: `test/validate-package.test.mjs`
- Create: `.github/workflows/validate.yml`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: `validateRepository(root) -> Promise<string[]>`, returning stable bilingual issue strings.
- Produces: CLI `node scripts/validate-package.mjs [--root PATH]`, exit 0 only when no issues exist.
- Consumes: generated Skill, all manifests, marketplaces, and package files list from Tasks 1–3.

- [ ] **Step 1: Write failing repository-validator tests**

Create `test/validate-package.test.mjs` with temporary fixture roots and literal malformed cases. Cover:

```js
test("accepts a complete dual-host plugin root", async () => {
  const root = await makeValidPluginFixture();
  assert.deepEqual(await validateRepository(root), []);
});

test("reports version drift and a missing generated reference", async () => {
  const root = await makeValidPluginFixture();
  await mutateJson(path.join(root, ".claude-plugin/plugin.json"), value => ({ ...value, version: "1.4.8" }));
  await writeFile(path.join(root, "skills/llm-wiki-zh/SKILL.md"), "Read references/missing.md\n");
  const issues = await validateRepository(root);
  assert.ok(issues.some(issue => issue.includes("version")));
  assert.ok(issues.some(issue => issue.includes("references/missing.md")));
});

test("rejects marketplace traversal and missing policy fields", async () => {
  const root = await makeValidPluginFixture();
  await mutateJson(path.join(root, ".agents/plugins/marketplace.json"), value => {
    value.plugins[0].source.path = "../..";
    delete value.plugins[0].policy;
    return value;
  });
  const issues = await validateRepository(root);
  assert.ok(issues.some(issue => issue.includes("source.path")));
  assert.ok(issues.some(issue => issue.includes("policy")));
});
```

Also test package `files` coverage, strict semver, matching plugin names, Claude owner, Codex root source `./`, Claude root source `./`, missing canonical/generated files, and unresolved one-level relative links from `SKILL.md`.

- [ ] **Step 2: Run validator tests and verify RED**

Run:

```bash
node --test test/validate-package.test.mjs
```

Expected: FAIL because `scripts/validate-package.mjs` does not exist.

- [ ] **Step 3: Implement the repository validator**

Create `scripts/validate-package.mjs` with `validateRepository(root)` and a thin CLI. Use only Node standard-library modules. Validate observable repository contracts, not prose wording:

- Required manifest and marketplace objects exist and parse.
- All plugin names equal `llm-wiki-zh` except marketplace name `llm-wiki-zh-marketplace`.
- All three plugin versions equal `package.json.version` and match strict `MAJOR.MINOR.PATCH`.
- Codex and Claude local marketplace roots are exactly `./`; reject absolute paths or any `..` component.
- Codex entry includes `policy.installation`, `policy.authentication`, and `category`.
- Claude marketplace contains `owner.name`.
- Every canonical Skill file has an equal generated file and no generated stale file exists; reuse `syncRepository(root, { check: true })`.
- Markdown references from `SKILL.md` to `references/` or `scripts/` resolve inside the Skill root.
- Every distribution path is covered by `package.json.files`.

Print each issue as `- <issue>` to stderr and exit 1; print `Package validation passed.` to stdout and exit 0 when clean.

- [ ] **Step 4: Run validator tests and verify GREEN**

Run:

```bash
node --test test/validate-package.test.mjs
```

Expected: all validator tests pass.

- [ ] **Step 5: Update scripts and add model-free CI**

Add package scripts:

```json
{
  "validate:package": "node scripts/validate-package.mjs",
  "validate": "npm run check:skill && npm run validate:package && npm test"
}
```

Create `.github/workflows/validate.yml`:

```yaml
name: validate
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm run validate
      - run: npm pack --dry-run
```

Do not add `npm install`; the project has no test dependency and installing the Pi peer is unnecessary for model-free validation.

- [ ] **Step 6: Rewrite installation and compatibility documentation**

Update `README.md` without creating a parallel English manual:

- Describe Pi, Codex CLI, and Claude Code CLI as first-class hosts.
- Lead with project-local manual copy from `skills/llm-wiki-zh/` to `.codex/skills/llm-wiki-zh/` or `.claude/skills/llm-wiki-zh/`.
- Document optional marketplace installation from this repository and retain the Pi Git command.
- State tested minimums: Codex CLI `0.151.0` and Claude Code CLI `2.0.76`; older versions use manual copy best effort.
- Provide one operation mapping table for Pi command, Codex invocation, and Claude invocation.
- Explain normal lint versus read-only check mode without showing a nonexistent public binary.
- Correct the structure tree so `extension.ts` is in `llm-wiki-zh/`, state eight canonical page types, explain legacy types, generated files, security defaults, supported platforms, and uninstall data retention.
- Clearly label marketplace publication as not performed by the repository build.

- [ ] **Step 7: Run all validators and package inspection**

Run:

```bash
npm run sync:skill
npm run validate
python3 /Users/wangyajun10/.codex/skills/.system/skill-creator/scripts/quick_validate.py llm-wiki-zh
python3 /Users/wangyajun10/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
npm pack --dry-run
git diff --check
```

If `claude` is installed, also run `claude plugin validate .`. If a Codex plugin validation command exists in `codex plugin --help`, run it; otherwise record that native Codex validation was unavailable rather than claiming it passed.

- [ ] **Step 8: Commit Task 4**

```bash
git add README.md package.json scripts/validate-package.mjs test/validate-package.test.mjs .github/workflows/validate.yml
git commit -m "docs: add cli installation and validation"
```
