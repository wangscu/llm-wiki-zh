import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { syncRepository } from "../scripts/sync-skill.mjs";

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
