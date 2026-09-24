import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateRepository } from "../scripts/validate-package.mjs";

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/validate-package.mjs");
const REQUIRED_PACKAGE_FILES = [
  "llm-wiki-zh",
  "skills",
  "plugin.json",
  ".codex-plugin",
  ".claude-plugin",
  ".agents",
  "scripts",
  "README.md",
  "LICENSE",
];

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function mutateJson(filePath, mutate) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  const nextValue = mutate(value) ?? value;
  await writeJson(filePath, nextValue);
}

async function makeValidPluginFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-zh-validate-"));
  const skillFiles = new Map([
    ["SKILL.md", [
      "---",
      "name: llm-wiki-zh",
      "description: fixture",
      "---",
      "Read references/guide.md and run scripts/helper.mjs.",
      "",
    ].join("\n")],
    ["references/guide.md", "# Guide\n"],
    ["scripts/helper.mjs", "export const fixture = true;\n"],
  ]);

  await writeJson(path.join(root, "package.json"), {
    name: "@fixture/llm-wiki-zh",
    version: "1.5.0",
    files: [...REQUIRED_PACKAGE_FILES],
    scripts: {
      "sync:skill": "node scripts/sync-skill.mjs",
      "check:skill": "node scripts/sync-skill.mjs --check",
      test: "node --test",
    },
  });
  await writeJson(path.join(root, "plugin.json"), {
    name: "llm-wiki-zh",
    version: "1.5.0",
    description: "fixture",
  });
  await writeJson(path.join(root, ".codex-plugin/plugin.json"), {
    name: "llm-wiki-zh",
    version: "1.5.0",
    description: "fixture",
    author: { name: "wangscu" },
    skills: "./skills/",
    interface: {
      displayName: "LLM Wiki Zh",
      shortDescription: "中文 LLM Wiki / Chinese LLM Wiki",
      longDescription: "构建和维护中文 LLM Wiki / Build and maintain a Chinese LLM Wiki",
      developerName: "wangscu",
      category: "Productivity",
      capabilities: ["Read", "Write"],
      defaultPrompt: "Query an existing Wiki before proposing changes.",
    },
  });
  await writeJson(path.join(root, ".claude-plugin/plugin.json"), {
    name: "llm-wiki-zh",
    version: "1.5.0",
    description: "fixture",
    author: { name: "wangscu" },
  });
  await writeJson(path.join(root, ".agents/plugins/marketplace.json"), {
    name: "llm-wiki-zh",
    interface: { displayName: "LLM Wiki Zh" },
    plugins: [{
      name: "llm-wiki-zh",
      source: { source: "local", path: "./" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    }],
  });
  await writeJson(path.join(root, ".claude-plugin/marketplace.json"), {
    name: "llm-wiki-zh-marketplace",
    owner: { name: "wangscu" },
    metadata: { description: "中文 LLM Wiki / Chinese LLM Wiki" },
    plugins: [{ name: "llm-wiki-zh", source: "./" }],
  });

  for (const [relative, contents] of skillFiles) {
    for (const skillRoot of ["llm-wiki-zh", "skills/llm-wiki-zh"]) {
      const destination = path.join(root, skillRoot, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }
  }

  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "scripts/sync-skill.mjs"), "// fixture\n");
  await writeFile(path.join(root, "scripts/validate-package.mjs"), "// fixture\n");
  await writeFile(path.join(root, "README.md"), "# Fixture\n");
  await writeFile(path.join(root, "LICENSE"), "MIT\n");
  return root;
}

function assertBilingualIssues(issues) {
  for (const issue of issues) {
    assert.match(issue, /[\u3400-\u9fff]/u);
    assert.match(issue, /[A-Za-z]/);
  }
}

test("accepts a complete dual-host plugin root", async () => {
  const root = await makeValidPluginFixture();
  assert.deepEqual(await validateRepository(root), []);
});

test("reports Claude version drift and an unresolved generated reference", async () => {
  const root = await makeValidPluginFixture();
  await mutateJson(path.join(root, ".claude-plugin/plugin.json"), value => ({ ...value, version: "1.4.8" }));
  await writeFile(path.join(root, "skills/llm-wiki-zh/SKILL.md"), "Read references/missing.md\n");

  const issues = await validateRepository(root);

  assert.ok(issues.some(issue => issue.includes("version") && issue.includes(".claude-plugin/plugin.json")));
  assert.ok(issues.some(issue => issue.includes("references/missing.md")));
  assert.deepEqual(issues, [...issues].sort());
  assertBilingualIssues(issues);
});

test("rejects Codex marketplace traversal and missing policy", async () => {
  const root = await makeValidPluginFixture();
  await mutateJson(path.join(root, ".agents/plugins/marketplace.json"), value => {
    value.plugins[0].source.path = "../..";
    delete value.plugins[0].policy;
    return value;
  });

  const issues = await validateRepository(root);

  assert.ok(issues.some(issue => issue.includes("source.path")));
  assert.ok(issues.some(issue => issue.includes("policy")));
  assertBilingualIssues(issues);
});

test("accepts only strict MAJOR.MINOR.PATCH package versions", async () => {
  const invalidVersions = ["v1.5.0", "1.5.0-rc.1", "1.5.0+build", "1.5", "01.5.0", "1.05.0", "1.5.00"];

  for (const version of invalidVersions) {
    const root = await makeValidPluginFixture();
    await mutateJson(path.join(root, "package.json"), value => ({ ...value, version }));
    const issues = await validateRepository(root);
    assert.ok(issues.some(issue => issue.includes("package.json") && issue.includes("MAJOR.MINOR.PATCH")), version);
  }
});

test("requires every plugin manifest version to equal the package version", async () => {
  const manifestPaths = ["plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"];

  for (const manifestPath of manifestPaths) {
    const root = await makeValidPluginFixture();
    await mutateJson(path.join(root, manifestPath), value => ({ ...value, version: "1.4.8" }));
    const issues = await validateRepository(root);
    assert.ok(issues.some(issue => issue.includes(manifestPath) && issue.includes("version")), manifestPath);
  }
});

test("requires canonical plugin and marketplace names", async () => {
  const cases = [
    ["plugin.json", value => ({ ...value, name: "wrong" })],
    [".codex-plugin/plugin.json", value => ({ ...value, name: "wrong" })],
    [".claude-plugin/plugin.json", value => ({ ...value, name: "wrong" })],
    [".agents/plugins/marketplace.json", value => ({ ...value, name: "wrong" })],
    [".agents/plugins/marketplace.json", value => { value.plugins[0].name = "wrong"; return value; }],
    [".claude-plugin/marketplace.json", value => ({ ...value, name: "wrong" })],
    [".claude-plugin/marketplace.json", value => { value.plugins[0].name = "wrong"; return value; }],
  ];

  for (const [relativePath, mutate] of cases) {
    const root = await makeValidPluginFixture();
    await mutateJson(path.join(root, relativePath), mutate);
    const issues = await validateRepository(root);
    assert.ok(issues.some(issue => issue.includes(relativePath) && issue.includes("name")), relativePath);
  }
});

test("requires exact local marketplace roots and rejects absolute or parent paths", async () => {
  const codexPaths = ["/tmp/plugin", "../plugin", "nested/../plugin", "plugin"];
  for (const sourcePath of codexPaths) {
    const root = await makeValidPluginFixture();
    await mutateJson(path.join(root, ".agents/plugins/marketplace.json"), value => {
      value.plugins[0].source.path = sourcePath;
      return value;
    });
    const issues = await validateRepository(root);
    assert.ok(issues.some(issue => issue.includes("source.path")), sourcePath);
  }

  const root = await makeValidPluginFixture();
  await mutateJson(path.join(root, ".claude-plugin/marketplace.json"), value => {
    value.plugins[0].source = "../plugin";
    return value;
  });
  const issues = await validateRepository(root);
  assert.ok(issues.some(issue => issue.includes("source") && issue.includes(".claude-plugin/marketplace.json")));
});

test("requires exact Codex marketplace policy and category semantics", async () => {
  const mutations = [
    value => { value.plugins[0].source.source = "git"; return value; },
    value => { value.plugins[0].policy.installation = "AUTO"; return value; },
    value => { value.plugins[0].policy.authentication = "NONE"; return value; },
    value => { value.plugins[0].category = "Other"; return value; },
  ];

  for (const mutate of mutations) {
    const root = await makeValidPluginFixture();
    await mutateJson(path.join(root, ".agents/plugins/marketplace.json"), mutate);
    assert.notDeepEqual(await validateRepository(root), []);
  }
});

test("requires Claude marketplace owner and bilingual discovery description fields to be nonempty", async () => {
  const root = await makeValidPluginFixture();
  await mutateJson(path.join(root, ".claude-plugin/marketplace.json"), value => {
    value.owner.name = "";
    value.metadata.description = "";
    return value;
  });

  const issues = await validateRepository(root);

  assert.ok(issues.some(issue => issue.includes("owner.name")));
  assert.ok(issues.some(issue => issue.includes("metadata.description")));
});

test("requires Codex author, skill path, and presentation interface", async () => {
  const mutations = [
    value => { value.author.name = ""; return value; },
    value => { value.skills = "skills"; return value; },
    value => { value.interface.displayName = ""; return value; },
    value => { value.interface.shortDescription = ""; return value; },
    value => { value.interface.longDescription = ""; return value; },
    value => { value.interface.developerName = ""; return value; },
    value => { value.interface.category = ""; return value; },
    value => { value.interface.capabilities = ["Read", ""]; return value; },
    value => { value.interface.defaultPrompt = ""; return value; },
  ];

  for (const mutate of mutations) {
    const root = await makeValidPluginFixture();
    await mutateJson(path.join(root, ".codex-plugin/plugin.json"), mutate);
    assert.notDeepEqual(await validateRepository(root), []);
  }
});

test("reports missing, changed, and stale generated Skill files without repairing them", async () => {
  const root = await makeValidPluginFixture();
  await rm(path.join(root, "skills/llm-wiki-zh/references/guide.md"));
  await writeFile(path.join(root, "skills/llm-wiki-zh/scripts/helper.mjs"), "changed\n");
  await writeFile(path.join(root, "skills/llm-wiki-zh/stale.md"), "stale\n");
  const before = await readFile(path.join(root, "skills/llm-wiki-zh/scripts/helper.mjs"));

  const issues = await validateRepository(root);

  assert.ok(issues.some(issue => issue.includes("missing: skills/llm-wiki-zh/references/guide.md")));
  assert.ok(issues.some(issue => issue.includes("changed: skills/llm-wiki-zh/scripts/helper.mjs")));
  assert.ok(issues.some(issue => issue.includes("stale: skills/llm-wiki-zh/stale.md")));
  assert.deepEqual(await readFile(path.join(root, "skills/llm-wiki-zh/scripts/helper.mjs")), before);
  await assert.rejects(readFile(path.join(root, "skills/llm-wiki-zh/references/guide.md")));
});

test("reports a missing canonical Skill tree as an issue instead of throwing", async () => {
  const root = await makeValidPluginFixture();
  await rm(path.join(root, "llm-wiki-zh"), { recursive: true });

  const issues = await validateRepository(root);

  assert.ok(issues.some(issue => issue.includes("llm-wiki-zh")));
  assertBilingualIssues(issues);
});

test("resolves safe Skill references and rejects unresolved, traversal, and absolute references", async () => {
  const cases = [
    ["Read references/missing.md\n", "references/missing.md"],
    ["Read references/../outside.md\n", "references/../outside.md"],
    ["Run scripts/../../outside.mjs\n", "scripts/../../outside.mjs"],
    ["Read /references/guide.md\n", "/references/guide.md"],
  ];

  for (const [skill, token] of cases) {
    const root = await makeValidPluginFixture();
    await writeFile(path.join(root, "llm-wiki-zh/SKILL.md"), skill);
    await writeFile(path.join(root, "skills/llm-wiki-zh/SKILL.md"), skill);
    const issues = await validateRepository(root);
    assert.ok(issues.some(issue => issue.includes(token)), token);
  }
});

test("requires package files to cover every distributed surface and accepts parent coverage", async () => {
  const root = await makeValidPluginFixture();
  await mutateJson(path.join(root, "package.json"), value => ({ ...value, files: ["."] }));
  assert.deepEqual(await validateRepository(root), []);

  await mutateJson(path.join(root, "package.json"), value => ({
    ...value,
    files: REQUIRED_PACKAGE_FILES.filter(entry => entry !== ".agents"),
  }));
  let issues = await validateRepository(root);
  assert.ok(issues.some(issue => issue.includes(".agents")));

  await mutateJson(path.join(root, "package.json"), value => ({ ...value, files: [...REQUIRED_PACKAGE_FILES, "../secret", 42] }));
  issues = await validateRepository(root);
  assert.ok(issues.some(issue => issue.includes("package.json.files") && issue.includes("traversal")));
  assert.ok(issues.some(issue => issue.includes("package.json.files") && issue.includes("string")));
});

test("turns malformed and missing required JSON files into path-specific issues", async () => {
  const root = await makeValidPluginFixture();
  await writeFile(path.join(root, ".codex-plugin/plugin.json"), "{bad json\n");
  await rm(path.join(root, ".claude-plugin/marketplace.json"));

  const issues = await validateRepository(root);

  assert.ok(issues.some(issue => issue.includes(".codex-plugin/plugin.json") && issue.includes("malformed")));
  assert.ok(issues.some(issue => issue.includes(".claude-plugin/marketplace.json") && issue.includes("missing")));
  assertBilingualIssues(issues);
});

test("CLI prints exactly one success line for a clean root", async () => {
  const root = await makeValidPluginFixture();
  const run = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "Package validation passed.\n");
  assert.equal(run.stderr, "");
});

test("CLI prints sorted issues to stderr and exits one for an invalid root", async () => {
  const root = await makeValidPluginFixture();
  await mutateJson(path.join(root, ".claude-plugin/plugin.json"), value => ({ ...value, version: "1.4.8" }));
  const run = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });

  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  const lines = run.stderr.trimEnd().split("\n");
  assert.ok(lines.every(line => line.startsWith("- ")));
  assert.deepEqual(lines, [...lines].sort());
});

test("CLI rejects unknown flags and a missing root value without echoing unsafe arguments", () => {
  const cases = [
    ["--root"],
    ["--unknown=SYNTH_SECRET_ARGUMENT"],
    ["positional-secret"],
  ];

  for (const argumentsList of cases) {
    const run = spawnSync(process.execPath, [SCRIPT, ...argumentsList], { encoding: "utf8" });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /[\u3400-\u9fff].*\/.*[A-Za-z]/u);
    assert.doesNotMatch(run.stderr, /SYNTH_SECRET_ARGUMENT|positional-secret/);
  }
});

test("validation leaves all fixture bytes unchanged when drift exists", async () => {
  const root = await makeValidPluginFixture();
  await writeFile(path.join(root, "skills/llm-wiki-zh/SKILL.md"), "changed generated bytes\n");
  const observedPaths = [
    "package.json",
    "plugin.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
    "llm-wiki-zh/SKILL.md",
    "skills/llm-wiki-zh/SKILL.md",
  ];
  const before = await Promise.all(observedPaths.map(relative => readFile(path.join(root, relative))));

  assert.notDeepEqual(await validateRepository(root), []);

  const after = await Promise.all(observedPaths.map(relative => readFile(path.join(root, relative))));
  assert.deepEqual(after, before);
});
