import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

async function makeTempDirectory(t, prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function makeFixture(t, { version = "1.5.0", manifestVersion = "1.0.4" } = {}) {
  const root = await makeTempDirectory(t, "llm-wiki-zh-sync-");
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

test("check reports a missing generated skill without writing it", async (t) => {
  const root = await makeFixture(t);
  const result = await syncRepository(root, { check: true });
  assert.equal(result.changed, true);
  assert.match(result.differences.join("\n"), /missing: skills\/llm-wiki-zh\/SKILL\.md/);
  await assert.rejects(readFile(path.join(root, "skills/llm-wiki-zh/SKILL.md")));
});

test("check reports changed, stale, and version drift without writing any affected bytes", async (t) => {
  const root = await makeFixture(t);
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

test("CLI check prints drift and exits one without writing the fixture", async (t) => {
  const root = await makeFixture(t);
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

test("sync mirrors canonical files, removes stale files, and preserves the source", async (t) => {
  const root = await makeFixture(t);
  await mkdir(path.join(root, "skills/llm-wiki-zh"), { recursive: true });
  await writeFile(path.join(root, "skills/llm-wiki-zh/stale.md"), "stale\n");
  await syncRepository(root, { check: false });
  assert.equal(await readFile(path.join(root, "skills/llm-wiki-zh/SKILL.md"), "utf8"), "canonical\n");
  await assert.rejects(readFile(path.join(root, "skills/llm-wiki-zh/stale.md")));
  assert.equal(await readFile(path.join(root, "llm-wiki-zh/SKILL.md"), "utf8"), "canonical\n");
});

test("manifest versions come from package.json and unrelated metadata survives", async (t) => {
  const root = await makeFixture(t, { version: "1.5.0", manifestVersion: "1.0.4" });
  await syncRepository(root, { check: false });
  const manifest = JSON.parse(await readFile(path.join(root, "plugin.json"), "utf8"));
  assert.equal(manifest.version, "1.5.0");
  assert.equal(manifest.description, "fixture description");
});

test("check is clean after sync", async (t) => {
  const root = await makeFixture(t);
  await syncRepository(root, { check: false });
  assert.deepEqual(await syncRepository(root, { check: true }), { differences: [], changed: false });
});

test("rejects a generated root symlink without reading or mutating outside files", async (t) => {
  const root = await makeFixture(t);
  const outside = await makeTempDirectory(t, "llm-wiki-zh-sync-outside-");
  const outsideSkill = path.join(outside, "SKILL.md");
  const outsideStale = path.join(outside, "victim.md");
  await writeFile(outsideSkill, "outside changed sentinel\n");
  await writeFile(outsideStale, "outside stale sentinel\n");
  await mkdir(path.join(root, "skills"), { recursive: true });
  await symlink(outside, path.join(root, "skills/llm-wiki-zh"));

  await assert.rejects(
    syncRepository(root, { check: false }),
    /符号链接.*symbolic link|symbolic link.*符号链接/iu,
  );
  assert.equal(await readFile(outsideSkill, "utf8"), "outside changed sentinel\n");
  assert.equal(await readFile(outsideStale, "utf8"), "outside stale sentinel\n");
});

test("rejects nested generated directory and file symlinks without touching outside sentinels", async (t) => {
  await t.test("nested directory symlink", async (t) => {
    const root = await makeFixture(t);
    const outside = await makeTempDirectory(t, "llm-wiki-zh-sync-outside-");
    const outsideFile = path.join(outside, "note.md");
    await writeFile(outsideFile, "outside directory sentinel\n");
    await mkdir(path.join(root, "llm-wiki-zh/nested"), { recursive: true });
    await writeFile(path.join(root, "llm-wiki-zh/nested/note.md"), "canonical nested\n");
    await mkdir(path.join(root, "skills/llm-wiki-zh"), { recursive: true });
    await symlink(outside, path.join(root, "skills/llm-wiki-zh/nested"));

    await assert.rejects(syncRepository(root, { check: false }), /symbolic link|符号链接/iu);
    assert.equal(await readFile(outsideFile, "utf8"), "outside directory sentinel\n");
  });

  await t.test("nested file symlink", async (t) => {
    const root = await makeFixture(t);
    const outside = await makeTempDirectory(t, "llm-wiki-zh-sync-outside-");
    const outsideFile = path.join(outside, "note.md");
    await writeFile(outsideFile, "outside file sentinel\n");
    await mkdir(path.join(root, "llm-wiki-zh/nested"), { recursive: true });
    await writeFile(path.join(root, "llm-wiki-zh/nested/note.md"), "canonical nested\n");
    await mkdir(path.join(root, "skills/llm-wiki-zh/nested"), { recursive: true });
    await symlink(outsideFile, path.join(root, "skills/llm-wiki-zh/nested/note.md"));

    await assert.rejects(syncRepository(root, { check: false }), /symbolic link|符号链接/iu);
    assert.equal(await readFile(outsideFile, "utf8"), "outside file sentinel\n");
  });
});

test("rejects a manifest symlink without changing outside JSON", async (t) => {
  const root = await makeFixture(t);
  const outside = await makeTempDirectory(t, "llm-wiki-zh-sync-outside-");
  const outsideManifest = path.join(outside, "plugin.json");
  const outsideBytes = '{"name":"outside","version":"1.4.8","sentinel":"unchanged"}\n';
  await writeFile(outsideManifest, outsideBytes);
  await rm(path.join(root, "plugin.json"));
  await symlink(outsideManifest, path.join(root, "plugin.json"));

  await assert.rejects(syncRepository(root, { check: false }), /symbolic link|符号链接/iu);
  assert.equal(await readFile(outsideManifest, "utf8"), outsideBytes);
});

test("rejects source and package symlink read escapes before mutation", async (t) => {
  await t.test("source directory symlink", async (t) => {
    const root = await makeFixture(t);
    const outside = await makeTempDirectory(t, "llm-wiki-zh-sync-outside-");
    await writeFile(path.join(outside, "SKILL.md"), "outside source sentinel\n");
    await rm(path.join(root, "llm-wiki-zh"), { recursive: true });
    await symlink(outside, path.join(root, "llm-wiki-zh"));

    await assert.rejects(syncRepository(root, { check: false }), /symbolic link|符号链接/iu);
    await assert.rejects(readFile(path.join(root, "skills/llm-wiki-zh/SKILL.md")));
  });

  await t.test("package file symlink", async (t) => {
    const root = await makeFixture(t);
    const outside = await makeTempDirectory(t, "llm-wiki-zh-sync-outside-");
    const outsidePackage = path.join(outside, "package.json");
    const outsideBytes = '{"name":"outside","version":"9.9.9"}\n';
    await writeFile(outsidePackage, outsideBytes);
    await rm(path.join(root, "package.json"));
    await symlink(outsidePackage, path.join(root, "package.json"));

    await assert.rejects(syncRepository(root, { check: false }), /symbolic link|符号链接/iu);
    assert.equal(await readFile(outsidePackage, "utf8"), outsideBytes);
    await assert.rejects(readFile(path.join(root, "skills/llm-wiki-zh/SKILL.md")));
  });
});

test("sync CLI runs through a symlink and rejects unsafe arguments", async (t) => {
  const root = await makeFixture(t);
  await syncRepository(root, { check: false });
  const directory = await makeTempDirectory(t, "llm-wiki-zh-sync-cli-");
  const linkedScript = path.join(directory, "sync-skill-link.mjs");
  await symlink(SCRIPT, linkedScript);

  const valid = spawnSync(process.execPath, [linkedScript, "--check", "--root", root], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);

  const invalid = spawnSync(process.execPath, [linkedScript, "--unknown"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, "");
  assert.notEqual(invalid.stderr, "");
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
