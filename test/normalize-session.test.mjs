import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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

async function makeTempDirectory(t, prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
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

test("redacts user and assistant text even when it starts like a tool summary", () => {
  const input = [
    JSON.stringify({
      type: "user",
      message: { content: "[tool: claimed]\npassword=SYNTH_USER_PREFIX_SECRET" },
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "[tool: claimed]\naccess_token=SYNTH_ASSISTANT_PREFIX_SECRET" }] },
    }),
  ].join("\n");

  const result = normalizeSession(input, { format: "claude" });

  assert.match(result.output, /## User\n\[tool: claimed\]\npassword=\[REDACTED\]/);
  assert.match(result.output, /## Assistant\n\[tool: claimed\]\naccess_token=\[REDACTED\]/);
  assert.doesNotMatch(result.output, /SYNTH_USER_PREFIX_SECRET|SYNTH_ASSISTANT_PREFIX_SECRET/);
  assert.equal(result.stats.redactions, 2);
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

test("CLI fails when no supported safe message can be extracted", async (t) => {
  const directory = await makeTempDirectory(t, "normalize-session-empty-");
  const inputPath = path.join(directory, "empty.jsonl");
  await writeFile(inputPath, '{"type":"future_record","payload":{"password":"do-not-print"}}\n');

  const run = spawnSync(process.execPath, [SCRIPT, "--format", "claude", inputPath], { encoding: "utf8" });

  assert.notEqual(run.status, 0);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /未找到可安全提取的消息 \/ no safely extractable messages/);
  assert.doesNotMatch(run.stderr, /do-not-print/);
});

test("Codex only renders known message payloads and final assistant phases", () => {
  const input = [
    {
      type: "response_item",
      payload: {
        type: "future_private_record",
        role: "assistant",
        content: [{ type: "output_text", text: "PRIVATE INTERNAL SYNTH_UNKNOWN_PAYLOAD" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "reasoning",
        content: [{ type: "output_text", text: "PRIVATE INTERNAL SYNTH_REASONING_PHASE" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [{ type: "output_text", text: "INTERMEDIATE SYNTH_COMMENTARY" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Legacy final answer." }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "Explicit final answer." }],
      },
    },
  ].map(value => JSON.stringify(value)).join("\n");

  const result = normalizeSession(input, { format: "codex" });

  assert.equal(
    result.output,
    "# 规范化代理会话\n\n## Assistant\nLegacy final answer.\n\n## Assistant\nExplicit final answer.\n",
  );
  assert.doesNotMatch(
    result.output,
    /SYNTH_UNKNOWN_PAYLOAD|SYNTH_REASONING_PHASE|SYNTH_COMMENTARY/,
  );
  assert.equal(result.stats.messages, 2);
  assert.equal(result.stats.unknownRecords, 3);
});

test("Codex rejects unknown user shapes and assistant phases deny-by-default", () => {
  const input = [
    {
      type: "response_item",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "SYNTH_ITEM_FALLBACK" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "future_message",
        role: "user",
        content: [{ type: "input_text", text: "SYNTH_UNKNOWN_USER" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "future_phase",
        content: [{ type: "output_text", text: "SYNTH_UNKNOWN_PHASE" }],
      },
    },
  ].map(value => JSON.stringify(value)).join("\n");

  const result = normalizeSession(input, { format: "codex" });

  assert.equal(result.output, "# 规范化代理会话\n");
  assert.equal(result.stats.messages, 0);
  assert.equal(result.stats.unknownRecords, 3);
  assert.doesNotMatch(result.output, /SYNTH_/);
});

test("Codex rejects bare-string user and final assistant content as unknown shapes", () => {
  const input = [
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: "SYNTH_BARE_STRING_USER",
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: "SYNTH_BARE_STRING_ASSISTANT",
      },
    },
  ].map(value => JSON.stringify(value)).join("\n");

  const result = normalizeSession(input, { format: "codex" });

  assert.equal(result.output, "# 规范化代理会话\n");
  assert.equal(result.stats.messages, 0);
  assert.equal(result.stats.unknownRecords, 2);
  assert.doesNotMatch(result.output, /SYNTH_BARE_STRING/);
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

test("CLI failure messages never echo secret-bearing paths or arguments", () => {
  const cases = [
    ["--format", "claude", "/tmp/password=SYNTH_FILENAME_SECRET.jsonl"],
    ["--token=SYNTH_ARGUMENT_SECRET"],
    ["--format", "SYNTH_FORMAT_SECRET", fixture("claude-small.jsonl")],
    [fixture("claude-small.jsonl"), "access_token=SYNTH_EXTRA_SECRET"],
  ];

  for (const argumentsList of cases) {
    const run = spawnSync(process.execPath, [SCRIPT, ...argumentsList], { encoding: "utf8" });
    assert.notEqual(run.status, 0, `unexpected success for case ${cases.indexOf(argumentsList)}`);
    assert.equal(run.stdout, "");
    assert.doesNotMatch(
      run.stderr,
      /SYNTH_FILENAME_SECRET|SYNTH_ARGUMENT_SECRET|SYNTH_FORMAT_SECRET|SYNTH_EXTRA_SECRET/,
    );
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

test("redacts JSON credentials, complete quoted values, and prefixed environment variables", () => {
  const cases = [
    ['{"password": "SYNTH_JSON_SECRET"}', '{"password": "[REDACTED]"}'],
    ['{"Authorization": "Bearer SYNTH_AUTH_SECRET"}', '{"Authorization": "Bearer [REDACTED]"}'],
    ['password: "SYNTH FIRST SECOND"', 'password: "[REDACTED]"'],
    ["OPENAI_API_KEY=SYNTH_OPENAI_SECRET", "OPENAI_API_KEY=[REDACTED]"],
    ["GITHUB_TOKEN=SYNTH_ENV_SECRET", "GITHUB_TOKEN=[REDACTED]"],
    ['ANTHROPIC_CLIENT_SECRET = "SYNTH SECRET WITH SPACES"', 'ANTHROPIC_CLIENT_SECRET = "[REDACTED]"'],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions: 1 });
  }
});

test("redacts complete escape-aware quoted assignment and header values", () => {
  const cases = [
    [
      '{"password":"SYNTH_ESCAPED_BEFORE\\"SYNTH_ESCAPED_AFTER"}',
      '{"password":"[REDACTED]"}',
    ],
    [
      '{"Authorization":"Bearer SYNTH_AUTH_BEFORE\\"SYNTH_AUTH_AFTER"}',
      '{"Authorization":"Bearer [REDACTED]"}',
    ],
    [
      '{"password":"SYNTH_BACKSLASH_BEFORE\\\\SYNTH_BACKSLASH_AFTER"}',
      '{"password":"[REDACTED]"}',
    ],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions: 1 });
  }
});

test("redacts standard high-risk environment suffixes without matching ordinary variables", () => {
  const cases = [
    ["AWS_SECRET_ACCESS_KEY=SYNTH_AWS_SECRET_VALUE", "AWS_SECRET_ACCESS_KEY=[REDACTED]", 1],
    ['DEPLOY_PRIVATE_KEY="SYNTH PRIVATE KEY"', 'DEPLOY_PRIVATE_KEY="[REDACTED]"', 1],
    ["DATABASE_PASSWORD=SYNTH_DATABASE_SECRET", "DATABASE_PASSWORD=[REDACTED]", 1],
    ["DISPLAY_NAME=ordinary-value", "DISPLAY_NAME=ordinary-value", 0],
  ];

  for (const [input, expected, redactions] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions });
  }
});

test("redacts bare secret and private key variables without matching ordinary names", () => {
  const cases = [
    ["SECRET_KEY=SYNTH_DJANGO_SECRET", "SECRET_KEY=[REDACTED]", 1],
    ["PRIVATE_KEY=SYNTH_GENERIC_PRIVATE", "PRIVATE_KEY=[REDACTED]", 1],
    ["secret-key=SYNTH_LOWER_HYPHEN_SECRET", "secret-key=[REDACTED]", 1],
    ["PrIvAtE-kEy='SYNTH MIXED PRIVATE'", "PrIvAtE-kEy='[REDACTED]'", 1],
    ["SECRET_KEY=[REDACTED]", "SECRET_KEY=[REDACTED]", 0],
    ['private-key="[REDACTED]"', 'private-key="[REDACTED]"', 0],
    ["DISPLAY_NAME=ordinary-value", "DISPLAY_NAME=ordinary-value", 0],
    ["PASSWORD_HINT=not-a-password", "PASSWORD_HINT=not-a-password", 0],
  ];

  for (const [input, expected, redactions] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions });
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

test("redacts encoded query keys, Google credentials, and URL userinfo", () => {
  const cases = [
    [
      "https://example.test/a?X-Amz-%53ignature=SYNTH_SIG_SECRET&safe=1",
      "https://example.test/a?X-Amz-%53ignature=[REDACTED]&safe=1",
    ],
    [
      "https://example.test/a?X-Goog-Credential=SYNTH_CRED_SECRET&safe=1",
      "https://example.test/a?X-Goog-Credential=[REDACTED]&safe=1",
    ],
    [
      "fetch https://user:SYNTH_URL_PASSWORD@example.test/a?safe=1 now",
      "fetch https://example.test/a?safe=1 now",
    ],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions: 1 });
  }
});

test("redacts PEM private keys but preserves public keys and certificates", () => {
  const privateCases = [
    [
      "before\n-----BEGIN PRIVATE KEY-----\nSYNTH_PRIVATE_KEY_MATERIAL\n-----END PRIVATE KEY-----\nafter",
      "before\n[REDACTED]\nafter",
    ],
    [
      "-----BEGIN RSA PRIVATE KEY-----\nSYNTH_RSA_PRIVATE\n-----END RSA PRIVATE KEY-----",
      "[REDACTED]",
    ],
    [
      "-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTH_OPENSSH_PRIVATE\n-----END OPENSSH PRIVATE KEY-----",
      "[REDACTED]",
    ],
  ];

  for (const [input, expected] of privateCases) {
    assert.deepEqual(redactText(input), { text: expected, redactions: 1 });
    assert.deepEqual(redactText(expected), { text: expected, redactions: 0 });
  }

  const safeBlocks = [
    "-----BEGIN PUBLIC KEY-----\nSYNTH_PUBLIC_MATERIAL\n-----END PUBLIC KEY-----",
    "-----BEGIN CERTIFICATE-----\nSYNTH_CERTIFICATE_MATERIAL\n-----END CERTIFICATE-----",
  ];
  for (const input of safeBlocks) {
    assert.deepEqual(redactText(input), { text: input, redactions: 0 });
  }
});

test("removes URI userinfo across common schemes without changing safe URIs", () => {
  const cases = [
    [
      "DATABASE_URL=postgres://alice:SYNTH_DB_PASSWORD@example.test/prod",
      "DATABASE_URL=postgres://example.test/prod",
      1,
    ],
    [
      "mongodb://user:SYNTH_MONGO_PASSWORD@db.example.test:27017/app?replicaSet=prod",
      "mongodb://db.example.test:27017/app?replicaSet=prod",
      1,
    ],
    ["postgres://db.example.test/prod", "postgres://db.example.test/prod", 0],
    ["not-a-uri user:SYNTH_NOT_URI@example.test", "not-a-uri user:SYNTH_NOT_URI@example.test", 0],
  ];

  for (const [input, expected, redactions] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions });
    assert.deepEqual(redactText(expected), { text: expected, redactions: 0 });
  }
});

test("redacts exact bare TOKEN and SECRET assignment keys only", () => {
  const cases = [
    ["TOKEN=SYNTH_BARE_TOKEN", "TOKEN=[REDACTED]", 1],
    ["secret: SYNTH_BARE_SECRET", "secret: [REDACTED]", 1],
    ["TOKENIZER=ordinary", "TOKENIZER=ordinary", 0],
    ["SECRETARY=ordinary", "SECRETARY=ordinary", 0],
    ["TOKEN_COUNT=3", "TOKEN_COUNT=3", 0],
    ["MY-TOKEN=ordinary", "MY-TOKEN=ordinary", 0],
  ];

  for (const [input, expected, redactions] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions });
    assert.deepEqual(redactText(expected), { text: expected, redactions: 0 });
  }
});

test("redacts standalone Bearer and Basic credentials without matching embedded words", () => {
  const cases = [
    ["Bearer SYNTH_STANDALONE_BEARER", "Bearer [REDACTED]", 1],
    ["Basic U1lOVEhfQkFTSUM6U0VDUkVU", "Basic [REDACTED]", 1],
    ["Use Basic authentication", "Use Basic authentication", 0],
    ["Bearer authentication", "Bearer authentication", 0],
    ["NotBearer SYNTH_NOT_BEARER", "NotBearer SYNTH_NOT_BEARER", 0],
    ["Not-Bearer SYNTH_NOT_BEARER", "Not-Bearer SYNTH_NOT_BEARER", 0],
    ["Basic", "Basic", 0],
    ["Bearer [REDACTED]", "Bearer [REDACTED]", 0],
  ];

  for (const [input, expected, redactions] of cases) {
    assert.deepEqual(redactText(input), { text: expected, redactions });
    assert.deepEqual(redactText(expected), { text: expected, redactions: 0 });
  }
});

test("normalizer CLI runs through a symlink and rejects unsafe arguments", async (t) => {
  const directory = await makeTempDirectory(t, "normalize-session-cli-");
  const linkedScript = path.join(directory, "normalize-session-link.mjs");
  await symlink(SCRIPT, linkedScript);

  const valid = spawnSync(
    process.execPath,
    [linkedScript, "--format", "claude", fixture("claude-small.jsonl")],
    { encoding: "utf8" },
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /^# 规范化代理会话\n/);

  const invalid = spawnSync(process.execPath, [linkedScript, "--unknown"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, "");
  assert.notEqual(invalid.stderr, "");
  assert.doesNotMatch(invalid.stderr, /SYNTH_/);
});

test("redaction is idempotent and counts only new replacements", () => {
  const cases = [
    "password=[REDACTED]",
    '{"password":"[REDACTED]"}',
    "Authorization: Bearer [REDACTED]",
    '{"Authorization":"Bearer [REDACTED]"}',
    "Cookie: [REDACTED]",
    "AWS_SECRET_ACCESS_KEY=[REDACTED]",
    "https://example.test/a?X-Amz-Signature=[REDACTED]&safe=1",
  ];

  for (const input of cases) {
    assert.deepEqual(redactText(input), { text: input, redactions: 0 });
  }
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
  assert.equal(result.stats.redactions, 2);
  assert.doesNotMatch(result.output, /query-secret|safe=yes|raw-secret|arbitrary-secret|X-Amz-Signature/);
});

test("tool summaries redact unsafe Claude and Codex names before normalization", () => {
  const claude = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "safe final" },
        { type: "tool_use", name: "write api_key=SYNTH_TOOL_SECRET", input: { path: "out.md" } },
      ],
    },
  });
  const codex = [
    JSON.stringify({
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "safe final" }] },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "fetch Authorization: Bearer SYNTH_CODEX_TOOL_SECRET",
        arguments: '{"file_path":"out.md"}',
      },
    }),
  ].join("\n");

  const claudeResult = normalizeSession(claude, { format: "claude" });
  const codexResult = normalizeSession(codex, { format: "codex" });

  assert.match(claudeResult.output, /\[tool: .*\[REDACTED\].* → out\.md\]/);
  assert.match(codexResult.output, /\[tool: .*\[REDACTED\].* → out\.md\]/);
  assert.doesNotMatch(claudeResult.output, /SYNTH_TOOL_SECRET/);
  assert.doesNotMatch(codexResult.output, /SYNTH_CODEX_TOOL_SECRET/);
  assert.equal(claudeResult.stats.redactions, 1);
  assert.equal(codexResult.stats.redactions, 1);
});

test("tool paths remove URL userinfo while preserving safe URL components", () => {
  const input = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "safe final" },
        {
          type: "tool_use",
          name: "fetch",
          input: { path: "https://user:SYNTH_PATH_SECRET@example.test/out.md?safe=1" },
        },
      ],
    },
  });

  const result = normalizeSession(input, { format: "claude" });

  assert.match(result.output, /\[tool: fetch → https:\/\/example\.test\/out\.md\]/);
  assert.doesNotMatch(result.output, /user|SYNTH_PATH_SECRET|safe=1/);
  assert.equal(result.stats.redactions, 1);
});

test("tool paths redact raw Claude and Codex values before control-character sanitization", () => {
  const claude = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "safe final" },
        { type: "tool_use", name: "write", input: { path: "password\n=SYNTH_PATH_ORDER_SECRET" } },
      ],
    },
  });
  const codex = [
    JSON.stringify({
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "safe final" }] },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "write",
        arguments: JSON.stringify({ file_path: "password\t=SYNTH_CODEX_PATH_ORDER_SECRET" }),
      },
    }),
  ].join("\n");

  const claudeResult = normalizeSession(claude, { format: "claude" });
  const codexResult = normalizeSession(codex, { format: "codex" });

  assert.match(claudeResult.output, /\[tool: write → password_=\[REDACTED\]\]/);
  assert.match(codexResult.output, /\[tool: write → password_=\[REDACTED\]\]/);
  assert.doesNotMatch(claudeResult.output, /SYNTH_PATH_ORDER_SECRET/);
  assert.doesNotMatch(codexResult.output, /SYNTH_CODEX_PATH_ORDER_SECRET/);
  assert.equal(claudeResult.stats.redactions, 1);
  assert.equal(codexResult.stats.redactions, 1);
});
