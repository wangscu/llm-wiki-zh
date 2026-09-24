import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { syncRepository } from "./sync-skill.mjs";

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLUGIN_NAME = "llm-wiki-zh";
const CLAUDE_MARKETPLACE_NAME = "llm-wiki-zh-marketplace";
const REQUIRED_PACKAGE_SURFACES = [
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
const JSON_PATHS = [
  "package.json",
  "plugin.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
];
const REQUIRED_REGULAR_FILES = [
  "README.md",
  "LICENSE",
  "scripts/sync-skill.mjs",
  "scripts/validate-package.mjs",
];
const SKILL_ROOTS = ["llm-wiki-zh", "skills/llm-wiki-zh"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addIssue(issues, chinese, english, detail = "") {
  issues.push(`${chinese} / ${english}${detail ? `: ${detail}` : ""}`);
}

async function readJsonObject(repositoryRoot, relativePath, issues) {
  let text;
  try {
    text = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      addIssue(issues, "缺少必需的 JSON 文件", "Required JSON file is missing", relativePath);
    } else {
      addIssue(issues, "无法读取必需的 JSON 文件", "Required JSON file cannot be read", relativePath);
    }
    return null;
  }

  try {
    const value = JSON.parse(text);
    if (!isObject(value)) {
      throw new Error("not an object");
    }
    return value;
  } catch {
    addIssue(issues, "JSON 文件格式错误", "JSON file is malformed", relativePath);
    return null;
  }
}

async function requireRegularFile(repositoryRoot, relativePath, issues) {
  try {
    const metadata = await lstat(path.join(repositoryRoot, relativePath));
    if (!metadata.isFile()) {
      addIssue(issues, "必需路径不是普通文件", "Required path is not a regular file", relativePath);
      return false;
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      addIssue(issues, "缺少必需文件", "Required file is missing", relativePath);
    } else {
      addIssue(issues, "无法检查必需文件", "Required file cannot be checked", relativePath);
    }
    return false;
  }
}

function requireExact(issues, relativePath, field, actual, expected) {
  if (actual !== expected) {
    addIssue(
      issues,
      "字段值不符合包契约",
      "Field does not match the package contract",
      `${relativePath} ${field} (expected ${JSON.stringify(expected)})`,
    );
  }
}

function requireNonempty(issues, relativePath, field, actual) {
  if (!isNonemptyString(actual)) {
    addIssue(issues, "字段必须是非空字符串", "Field must be a nonempty string", `${relativePath} ${field}`);
  }
}

function validatePackageFiles(packageJson, issues) {
  if (!Array.isArray(packageJson.files)) {
    addIssue(issues, "package.json.files 必须是数组", "package.json.files must be an array");
    return;
  }

  const entries = [];
  packageJson.files.forEach((entry, index) => {
    if (typeof entry !== "string") {
      addIssue(
        issues,
        "package.json.files 条目必须是字符串",
        "package.json.files entry must be a string",
        `index ${index}`,
      );
      return;
    }

    const slashPath = entry.replaceAll("\\", "/");
    const segments = slashPath.split("/");
    if (path.posix.isAbsolute(slashPath) || path.win32.isAbsolute(entry) || segments.includes("..")) {
      addIssue(
        issues,
        "package.json.files 禁止绝对路径或父目录穿越",
        "package.json.files rejects absolute paths or traversal",
        `index ${index}`,
      );
      return;
    }

    const normalized = path.posix.normalize(slashPath).replace(/^\.\//u, "").replace(/\/$/u, "");
    if (normalized === "" || normalized === "..") {
      addIssue(issues, "package.json.files 条目无效", "package.json.files entry is invalid", `index ${index}`);
      return;
    }
    entries.push(normalized);
  });

  for (const required of REQUIRED_PACKAGE_SURFACES) {
    const covered = entries.some(entry => entry === "." || required === entry || required.startsWith(`${entry}/`));
    if (!covered) {
      addIssue(
        issues,
        "package.json.files 未覆盖发布内容",
        "package.json.files does not cover a distributed surface",
        required,
      );
    }
  }
}

function validatePluginManifests(packageJson, manifests, issues) {
  const packageVersion = packageJson?.version;
  const validPackageVersion = typeof packageVersion === "string" && STRICT_SEMVER.test(packageVersion);
  if (packageJson && !validPackageVersion) {
    addIssue(
      issues,
      "package.json 版本必须是严格的 MAJOR.MINOR.PATCH",
      "package.json version must be strict MAJOR.MINOR.PATCH",
      "package.json version",
    );
  }

  for (const [relativePath, manifest] of [
    ["plugin.json", manifests.root],
    [".codex-plugin/plugin.json", manifests.codex],
    [".claude-plugin/plugin.json", manifests.claude],
  ]) {
    if (!manifest) {
      continue;
    }
    requireExact(issues, relativePath, "name", manifest.name, PLUGIN_NAME);
    if (validPackageVersion && manifest.version !== packageVersion) {
      addIssue(
        issues,
        "插件版本与 package.json version 不一致",
        "Plugin version does not match package.json version",
        `${relativePath} version`,
      );
    }
  }

  const codex = manifests.codex;
  if (codex) {
    requireNonempty(issues, ".codex-plugin/plugin.json", "author.name", codex.author?.name);
    requireExact(issues, ".codex-plugin/plugin.json", "skills", codex.skills, "./skills/");
    const pluginInterface = codex.interface;
    if (!isObject(pluginInterface)) {
      addIssue(
        issues,
        "Codex interface 必须是对象",
        "Codex interface must be an object",
        ".codex-plugin/plugin.json interface",
      );
      return;
    }
    for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category", "defaultPrompt"]) {
      requireNonempty(issues, ".codex-plugin/plugin.json", `interface.${field}`, pluginInterface[field]);
    }
    if (isNonemptyString(pluginInterface.developerName)) {
      requireExact(issues, ".codex-plugin/plugin.json", "interface.developerName", pluginInterface.developerName, "wangscu");
    }
    if (isNonemptyString(pluginInterface.category)) {
      requireExact(issues, ".codex-plugin/plugin.json", "interface.category", pluginInterface.category, "Productivity");
    }
    if (
      !Array.isArray(pluginInterface.capabilities)
      || pluginInterface.capabilities.length === 0
      || pluginInterface.capabilities.some(capability => !isNonemptyString(capability))
    ) {
      addIssue(
        issues,
        "Codex capabilities 必须包含非空字符串",
        "Codex capabilities must contain nonempty strings",
        ".codex-plugin/plugin.json interface.capabilities",
      );
    }
  }
}

function validateMarketplaces(marketplaces, issues) {
  const codexPath = ".agents/plugins/marketplace.json";
  const codex = marketplaces.codex;
  if (codex) {
    requireExact(issues, codexPath, "name", codex.name, PLUGIN_NAME);
    const entry = Array.isArray(codex.plugins) && isObject(codex.plugins[0]) ? codex.plugins[0] : null;
    if (!entry) {
      addIssue(issues, "Codex marketplace 缺少插件条目", "Codex marketplace plugin entry is missing", codexPath);
    } else {
      requireExact(issues, codexPath, "plugins[0].name", entry.name, PLUGIN_NAME);
      if (!isObject(entry.source)) {
        addIssue(issues, "Codex marketplace source 必须是对象", "Codex marketplace source must be an object", codexPath);
      } else {
        requireExact(issues, codexPath, "plugins[0].source.source", entry.source.source, "local");
        requireExact(issues, codexPath, "plugins[0].source.path", entry.source.path, "./");
      }
      if (!isObject(entry.policy)) {
        addIssue(issues, "Codex marketplace 缺少 policy", "Codex marketplace policy is missing", codexPath);
      } else {
        requireExact(issues, codexPath, "plugins[0].policy.installation", entry.policy.installation, "AVAILABLE");
        requireExact(issues, codexPath, "plugins[0].policy.authentication", entry.policy.authentication, "ON_INSTALL");
      }
      requireExact(issues, codexPath, "plugins[0].category", entry.category, "Productivity");
    }
  }

  const claudePath = ".claude-plugin/marketplace.json";
  const claude = marketplaces.claude;
  if (claude) {
    requireExact(issues, claudePath, "name", claude.name, CLAUDE_MARKETPLACE_NAME);
    requireNonempty(issues, claudePath, "owner.name", claude.owner?.name);
    requireNonempty(issues, claudePath, "metadata.description", claude.metadata?.description);
    const entry = Array.isArray(claude.plugins) && isObject(claude.plugins[0]) ? claude.plugins[0] : null;
    if (!entry) {
      addIssue(issues, "Claude marketplace 缺少插件条目", "Claude marketplace plugin entry is missing", claudePath);
    } else {
      requireExact(issues, claudePath, "plugins[0].name", entry.name, PLUGIN_NAME);
      requireExact(issues, claudePath, "plugins[0].source", entry.source, "./");
    }
  }
}

function extractSkillReferenceTokens(markdown) {
  const tokens = [];
  const pattern = /(?:^|[\s("'`])((?:\/)?(?:references|scripts)\/[^\s)\]}>"'`]+)/gmu;
  for (const match of markdown.matchAll(pattern)) {
    const token = match[1].replace(/[.,;:!?]+$/u, "");
    if (token) {
      tokens.push(token);
    }
  }
  return [...new Set(tokens)].sort();
}

async function scanSkillReferences(repositoryRoot, skillRoot, issues) {
  const skillPath = path.posix.join(skillRoot, "SKILL.md");
  let markdown;
  try {
    markdown = await readFile(path.join(repositoryRoot, skillPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      addIssue(issues, "缺少 Skill 入口文件", "Skill entry file is missing", skillPath);
    } else {
      addIssue(issues, "无法读取 Skill 入口文件", "Skill entry file cannot be read", skillPath);
    }
    return;
  }

  for (const token of extractSkillReferenceTokens(markdown)) {
    const slashToken = token.replaceAll("\\", "/");
    const segments = slashToken.split("/");
    if (path.posix.isAbsolute(slashToken) || path.win32.isAbsolute(token) || segments.includes("..")) {
      addIssue(
        issues,
        "Skill 引用禁止绝对路径或父目录穿越",
        "Skill reference rejects absolute paths or traversal",
        `${skillPath} -> ${token}`,
      );
      continue;
    }

    const normalized = path.posix.normalize(slashToken);
    const relativeTarget = path.posix.join(skillRoot, normalized);
    try {
      const metadata = await lstat(path.join(repositoryRoot, relativeTarget));
      if (!metadata.isFile()) {
        addIssue(
          issues,
          "Skill 引用目标不是普通文件",
          "Skill reference target is not a regular file",
          `${skillPath} -> ${token}`,
        );
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        addIssue(
          issues,
          "Skill 引用无法解析",
          "Skill reference is unresolved",
          `${skillPath} -> ${token}`,
        );
      } else {
        addIssue(
          issues,
          "无法检查 Skill 引用",
          "Skill reference cannot be checked",
          `${skillPath} -> ${token}`,
        );
      }
    }
  }
}

export async function validateRepository(root) {
  const repositoryRoot = path.resolve(root);
  const issues = [];
  const values = {};

  await Promise.all(JSON_PATHS.map(async relativePath => {
    values[relativePath] = await readJsonObject(repositoryRoot, relativePath, issues);
  }));
  await Promise.all(REQUIRED_REGULAR_FILES.map(relativePath => requireRegularFile(repositoryRoot, relativePath, issues)));

  const packageJson = values["package.json"];
  const manifests = {
    root: values["plugin.json"],
    codex: values[".codex-plugin/plugin.json"],
    claude: values[".claude-plugin/plugin.json"],
  };
  const marketplaces = {
    codex: values[".agents/plugins/marketplace.json"],
    claude: values[".claude-plugin/marketplace.json"],
  };

  if (packageJson) {
    validatePackageFiles(packageJson, issues);
  }
  validatePluginManifests(packageJson, manifests, issues);
  validateMarketplaces(marketplaces, issues);

  await Promise.all(SKILL_ROOTS.map(skillRoot => scanSkillReferences(repositoryRoot, skillRoot, issues)));

  const canRunSync = packageJson
    && typeof packageJson.version === "string"
    && STRICT_SEMVER.test(packageJson.version)
    && manifests.root
    && manifests.codex
    && manifests.claude;
  if (canRunSync) {
    try {
      const result = await syncRepository(repositoryRoot, { check: true });
      for (const difference of result.differences) {
        addIssue(issues, "Skill 生成内容存在差异", "Generated Skill content has drift", difference);
      }
    } catch {
      addIssue(
        issues,
        "无法检查规范与生成 Skill 的一致性",
        "Cannot check canonical and generated Skill consistency",
        "llm-wiki-zh -> skills/llm-wiki-zh",
      );
    }
  }

  return [...new Set(issues)].sort();
}

function parseArguments(argumentsList) {
  let root = process.cwd();
  let rootSeen = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument !== "--root") {
      throw new Error("未知参数 / Unknown argument");
    }
    if (rootSeen) {
      throw new Error("--root 只能提供一次 / --root may be provided only once");
    }
    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error("--root 缺少路径 / --root requires a path");
    }
    root = value;
    rootSeen = true;
    index += 1;
  }
  return { root };
}

async function main() {
  try {
    const { root } = parseArguments(process.argv.slice(2));
    const issues = await validateRepository(root);
    if (issues.length > 0) {
      process.stderr.write(`${issues.map(issue => `- ${issue}`).join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write("Package validation passed.\n");
  } catch {
    process.stderr.write("包验证参数或执行失败 / Package validation argument or execution failed\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
