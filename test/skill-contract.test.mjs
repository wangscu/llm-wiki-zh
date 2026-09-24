import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function skillFile(relativePath) {
  return readFile(new URL(`../llm-wiki-zh/${relativePath}`, import.meta.url), "utf8");
}

test("Pi recipe accepts one explicit transcript without broad secret-bearing extraction", async () => {
  const recipe = await skillFile("references/pi-session-recipe.md");

  assert.match(recipe, /用户明确提供的单一(?:个)? transcript/);
  assert.match(recipe, /助手最终文本/);
  assert.match(recipe, /脱敏/);
  assert.doesNotMatch(recipe, /select\([^\n]*\.type\s*==\s*"thinking"/);
  assert.doesNotMatch(recipe, /\.data\s*\|\s*tostring/);
  assert.doesNotMatch(recipe, /\.data\.(?:args|result)\s*\/\/\s*\.data\.(?:args|result)/);
  assert.doesNotMatch(recipe, /\.\.\s*\|\s*strings/);
  assert.doesNotMatch(recipe, /\.data\.(?:urls|queries|error)/);
  assert.match(recipe, /^type: source$/m);
  assert.doesNotMatch(recipe, /^type: session$/m);
});

test("new-page template contains only the eight canonical page types", async () => {
  const template = await skillFile("references/page.template.md");
  const canonicalTypes = [
    "concept",
    "decision",
    "bug",
    "bugfix",
    "open-question",
    "source",
    "reference",
    "synthesis",
  ];

  for (const type of canonicalTypes) {
    assert.match(template, new RegExp(`\\\`${type}\\\``));
  }
  assert.doesNotMatch(template, /`(?:entity|archive|session)`/);
  assert.doesNotMatch(template, /^type:\s*(?:entity|archive|session)$/m);
});

test("mutable locators require a digest-addressed immutable snapshot", async () => {
  const [skill, sourceTemplate] = await Promise.all([
    skillFile("SKILL.md"),
    skillFile("references/source.template.md"),
  ]);

  assert.match(skill, /content-addressed/);
  assert.match(skill, /commit-pinned/);
  assert.match(skill, /不可变版本 ID/);
  assert.match(skill, /普通工作区路径[^\n]*snapshot/);
  assert.match(skill, /普通 URL[^\n]*snapshot/);
  assert.doesNotMatch(skill, /稳定位置（项目内文件、外部文件、明确 URL）/);

  const indexExample = skill.match(/^\s+- \*\*Title\*\*.*$/m)?.[0] ?? "";
  assert.match(indexExample, /identity:/);
  assert.match(indexExample, /sha256:/);
  assert.match(indexExample, /version:/);
  assert.match(indexExample, /artifact:/);

  for (const field of ["identity", "sha256", "version", "snapshot"]) {
    assert.match(sourceTemplate, new RegExp(`^${field}:`, "m"));
  }
  assert.match(sourceTemplate, /同一 identity[^\n]*新 digest[^\n]*新 snapshot/);
  assert.doesNotMatch(sourceTemplate, /项目内路径、外部路径、URL[^\n]*无需复制/);
});
