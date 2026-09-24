import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { normalizeSession, redactText } from "../llm-wiki-zh/scripts/normalize-session.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "llm-wiki-zh/scripts/normalize-session.mjs");

function fixture(name) {
  return path.join(import.meta.dirname, "fixtures/sessions", name);
}

test("normalizes a small Claude transcript without secrets or reasoning", async () => {
  const fixturePath = fixture("claude-small.jsonl");
  const input = await readFile(fixturePath, "utf8");
  assert.ok((await stat(fixturePath)).size < 5 * 1024);

  const result = normalizeSession(input, { format: "claude" });

  assert.match(result.output, /^# 规范化代理会话\n/);
  assert.match(result.output, /## User/);
  assert.match(result.output, /Compare alpha and beta\. Authorization: Bearer \[REDACTED\]/);
  assert.match(result.output, /## Assistant/);
  assert.match(result.output, /Alpha is safer\./);
  assert.match(result.output, /\[tool: write → notes\/result\.md\]/);
  assert.doesNotMatch(result.output, /secret-token|hunter2|private chain|future-secret/);
  assert.deepEqual(result.stats, {
    format: "claude",
    records: 3,
    messages: 2,
    unknownRecords: 1,
    malformedLines: 0,
    redactions: 1,
  });
});

test("normalizes Codex response items and ignores metadata and unknown events", async () => {
  const input = await readFile(fixture("codex-basic.jsonl"), "utf8");
  const result = normalizeSession(input, { format: "codex" });

  assert.match(result.output, /## User\nCompare the release candidates\./);
  assert.match(result.output, /## Assistant\nThe second candidate is safer\./);
  assert.match(result.output, /\[tool: download → artifacts\/report\.md\]/);
  assert.doesNotMatch(result.output, /X-Amz-Signature|signed-secret|session_meta|private_event|unknown-secret|private-project/);
  assert.equal(result.stats.records, 5);
  assert.equal(result.stats.messages, 2);
  assert.equal(result.stats.unknownRecords, 1);
});

test("reports malformed lines without inventing content", () => {
  const result = normalizeSession('{"type":"user"}\nnot-json\n', { format: "claude" });

  assert.equal(result.stats.malformedLines, 1);
  assert.equal(result.stats.records, 1);
  assert.equal(result.stats.messages, 0);
  assert.doesNotMatch(result.output, /not-json/);
});

test("CLI writes only Markdown to stdout, one stats line to stderr, and preserves source bytes", async () => {
  const fixturePath = fixture("claude-small.jsonl");
  const before = await readFile(fixturePath);
  const run = spawnSync(process.execPath, [SCRIPT, "--format", "claude", fixturePath], { encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^# 规范化代理会话\n/);
  assert.doesNotMatch(run.stdout, /\[normalize-session\]|secret-token|hunter2|private chain|future-secret/);
  assert.equal(run.stderr, "[normalize-session] format=claude records=3 messages=2 unknown=1 malformed=0 redactions=1\n");
  assert.deepEqual(await readFile(fixturePath), before);
});

test("auto mode detects pure Claude and pure Codex inputs", async () => {
  const claude = await readFile(fixture("claude-small.jsonl"), "utf8");
  const codex = await readFile(fixture("codex-basic.jsonl"), "utf8");

  assert.equal(normalizeSession(claude, { format: "auto" }).stats.format, "claude");
  assert.equal(normalizeSession(codex, { format: "auto" }).stats.format, "codex");
});

test("auto mode rejects mixed and unsupported inputs instead of guessing", async () => {
  const claude = await readFile(fixture("claude-small.jsonl"), "utf8");
  const codex = await readFile(fixture("codex-basic.jsonl"), "utf8");

  assert.throws(
    () => normalizeSession(`${claude}${codex}`, { format: "auto" }),
    /mixed|混合/i,
  );
  assert.throws(
    () => normalizeSession('{"type":"future_record"}\n', { format: "auto" }),
    /unsupported|不支持/i,
  );
});

test("CLI fails when no supported safe message can be extracted", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "normalize-session-empty-"));
  const inputPath = path.join(directory, "empty.jsonl");
  await writeFile(inputPath, '{"type":"future_record","payload":{"password":"do-not-print"}}\n');

  const run = spawnSync(process.execPath, [SCRIPT, "--format", "claude", inputPath], { encoding: "utf8" });

  assert.notEqual(run.status, 0);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /未找到可安全提取的消息 \/ no safely extractable messages/);
  assert.doesNotMatch(run.stderr, /do-not-print/);
});

test("CLI rejects missing files, unknown arguments, and unsupported format values", () => {
  const cases = [
    [],
    ["--unknown"],
    ["--format"],
    ["--format", "gemini", fixture("claude-small.jsonl")],
    [fixture("claude-small.jsonl"), fixture("codex-basic.jsonl")],
  ];

  for (const argumentsList of cases) {
    const run = spawnSync(process.execPath, [SCRIPT, ...argumentsList], { encoding: "utf8" });
    assert.notEqual(run.status, 0, `unexpected success for ${argumentsList.join(" ")}`);
    assert.equal(run.stdout, "");
    assert.notEqual(run.stderr, "");
  }
});

test("redacts authentication headers with case-insensitive spellings", () => {
  const cases = [
    ["Authorization: Bearer secret-token", "Authorization: Bearer [REDACTED]"],
    ["authorization=basic Zm9vOmJhcg==", "authorization=basic [REDACTED]"],
    ["Cookie: session=abc; theme=dark", "Cookie: [REDACTED]"],
    ["sEt-CoOkIe = sid=secret; Secure", "sEt-CoOkIe = [REDACTED]"],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions: 1 });
  }
});

test("redacts sensitive key assignments with case-insensitive spellings", () => {
  const cases = [
    ["api_key=alpha", "api_key=[REDACTED]"],
    ["PASSWORD: hunter2", "PASSWORD: [REDACTED]"],
    ['access_token="access-secret"', "access_token=\"[REDACTED]\""],
    ["Refresh_Token = 'refresh-secret'", "Refresh_Token = '[REDACTED]'"],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions: 1 });
  }
});

test("redacts known provider token forms and AWS access-key IDs", () => {
  const cases = [
    ["ghp_abcdefghijklmnopqrstuvwxyz1234567890", "[REDACTED]"],
    ["github_pat_11AA0abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED]"],
    ["sk-proj-abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED]"],
    ["xoxb_123456789012-123456789012-abcdefghijklmnopqrstuvwx", "[REDACTED]"],
    ["AKIAIOSFODNN7EXAMPLE", "[REDACTED]"],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions: 1 });
  }
});

test("redacts sensitive signed-URL query values while preserving safe components", () => {
  const input = "https://storage.example.com/reports/a.txt?download=1&X-Amz-Signature=abc123&X-Amz-Credential=AKIA%2Fscope&token=url-secret&safe=yes#result";
  const expected = "https://storage.example.com/reports/a.txt?download=1&X-Amz-Signature=[REDACTED]&X-Amz-Credential=[REDACTED]&token=[REDACTED]&safe=yes#result";

  assert.deepEqual(redactText(input), { text: expected, redactions: 3 });
});

test("tool summaries expose only redacted names and allow-listed paths", () => {
  const claude = [
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "save-sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
          input: {
            filePath: "https://example.com/out.md?X-Amz-Signature=query-secret&safe=yes",
            content: "password=raw-secret",
            command: "echo arbitrary-secret",
          },
        }],
      },
    }),
  ].join("\n");

  const result = normalizeSession(claude, { format: "claude" });

  assert.equal(result.output, "# 规范化代理会话\n\n## Assistant\n[tool: save-[REDACTED] → https://example.com/out.md]\n");
  assert.equal(result.stats.redactions, 1);
  assert.doesNotMatch(result.output, /query-secret|safe=yes|raw-secret|arbitrary-secret|X-Amz-Signature/);
});
