import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { syncRepository } from "../scripts/sync-skill.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/sync-skill.mjs", import.meta.url));
const MANIFEST_PATHS = [
  "plugin.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
];

async function makeFixture({ version = "1.5.0", manifestVersion = "1.0.4" } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-zh-sync-"));
  await mkdir(path.join(root, "llm-wiki-zh"), { recursive: true });
  await mkdir(path.join(root, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(root, ".claude-plugin"), { recursive: true });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "fixture",
    version,
  }, null, 2)}\n`);
  await writeFile(path.join(root, "llm-wiki-zh", "SKILL.md"), "canonical\n");
  await writeFile(path.join(root, "plugin.json"), `${JSON.stringify({
    name: "fixture",
    version: manifestVersion,
    description: "fixture description",
  }, null, 2)}\n`);
  await writeFile(path.join(root, ".codex-plugin", "plugin.json"), `${JSON.stringify({
    name: "fixture",
    version: manifestVersion,
    description: "fixture description",
  }, null, 2)}\n`);
  await writeFile(path.join(root, ".claude-plugin", "plugin.json"), `${JSON.stringify({
    name: "fixture",
    version: manifestVersion,
    description: "fixture description",
  }, null, 2)}\n`);
  return root;
}

test("check reports a missing generated skill without writing it", async () => {
  const root = await makeFixture();
  const result = await syncRepository(root, { check: true });
  assert.equal(result.changed, true);
  assert.match(result.differences.join("\n"), /missing: skills\/llm-wiki-zh\/SKILL\.md/);
  await assert.rejects(readFile(path.join(root, "skills/llm-wiki-zh/SKILL.md")));
});

test("check reports changed, stale, and version drift without writing any affected bytes", async () => {
  const root = await makeFixture();
  const target = path.join(root, "skills/llm-wiki-zh");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "SKILL.md"), "changed generated skill\n");
  await writeFile(path.join(target, "stale.md"), "stale\n");
  const affectedFiles = [
    path.join(target, "SKILL.md"),
    path.join(target, "stale.md"),
    ...MANIFEST_PATHS.map((manifestPath) => path.join(root, manifestPath)),
  ];
  const before = await Promise.all(affectedFiles.map((filePath) => readFile(filePath)));

  const result = await syncRepository(root, { check: true });

  assert.deepEqual(result, {
    differences: [
      "changed: skills/llm-wiki-zh/SKILL.md",
      "stale: skills/llm-wiki-zh/stale.md",
      "version: plugin.json",
      "version: .codex-plugin/plugin.json",
      "version: .claude-plugin/plugin.json",
    ],
    changed: true,
  });
  assert.deepEqual(await Promise.all(affectedFiles.map((filePath) => readFile(filePath))), before);
});

test("CLI check prints drift and exits one without writing the fixture", async () => {
  const root = await makeFixture();
  const target = path.join(root, "skills/llm-wiki-zh");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "SKILL.md"), "changed generated skill\n");
  const generatedSkill = path.join(target, "SKILL.md");
  const before = await readFile(generatedSkill);

  const run = spawnSync(process.execPath, [SCRIPT, "--check", "--root", root], { encoding: "utf8" });

  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /^changed: skills\/llm-wiki-zh\/SKILL\.md$/m);
  assert.deepEqual(await readFile(generatedSkill), before);
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

test("npm metadata describes bilingual Pi, Codex CLI, and Claude Code discovery", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(packageJson.description, /Pi/);
  assert.match(packageJson.description, /Codex CLI/);
  assert.match(packageJson.description, /Claude Code/);
  assert.match(packageJson.description, /中文/);
  assert.deepEqual(packageJson.keywords.slice(0, 5), [
    "pi-package",
    "llm-wiki",
    "karpathy",
    "knowledge-base",
    "second-brain",
  ]);
  assert.ok(packageJson.keywords.some((keyword) => /[\u4e00-\u9fff]/u.test(keyword)));
});
