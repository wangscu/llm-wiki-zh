import { lstat, readFile, readdir, realpath } from "node:fs/promises";
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

function displayPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isInside(allowedRoot, candidate) {
  const relative = path.relative(allowedRoot, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function inspectSafePath(
  repositoryRoot,
  relativePath,
  issues,
  { expected = null, allowedRoot = repositoryRoot, reportMissing = true } = {},
) {
  const normalizedRelative = displayPath(relativePath);
  const candidate = path.resolve(repositoryRoot, relativePath);
  if (!isInside(repositoryRoot, candidate)) {
    addIssue(issues, "验证路径逃出仓库根目录", "Validation path escapes the repository root", normalizedRelative);
    return { ok: false, reason: "outside" };
  }

  const relative = path.relative(repositoryRoot, candidate);
  const segments = relative === "" ? [] : relative.split(path.sep);
  let current = repositoryRoot;
  let metadata;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") {
        if (reportMissing) {
          addIssue(issues, "验证路径不存在", "Validation path is missing", normalizedRelative);
        }
        return { ok: false, reason: "missing" };
      }
      addIssue(issues, "无法检查验证路径", "Validation path cannot be checked", normalizedRelative);
      return { ok: false, reason: "unreadable" };
    }
    if (metadata.isSymbolicLink()) {
      addIssue(
        issues,
        "验证输入不允许符号链接",
        "symbolic link is not allowed for validation input",
        `${normalizedRelative} (via ${displayPath(path.relative(repositoryRoot, current))})`,
      );
      return { ok: false, reason: "symlink" };
    }
  }

  let candidateRealPath;
  try {
    candidateRealPath = await realpath(candidate);
  } catch (error) {
    if (error.code === "ENOENT") {
      if (reportMissing) {
        addIssue(issues, "验证路径不存在", "Validation path is missing", normalizedRelative);
      }
      return { ok: false, reason: "missing" };
    }
    addIssue(issues, "无法解析验证路径", "Validation path cannot be resolved", normalizedRelative);
    return { ok: false, reason: "unreadable" };
  }
  if (!isInside(repositoryRoot, candidateRealPath) || !isInside(allowedRoot, candidateRealPath)) {
    addIssue(issues, "验证路径的真实位置越界", "Validation path real location escapes its allowed root", normalizedRelative);
    return { ok: false, reason: "outside" };
  }
  if (expected === "file" && !metadata?.isFile()) {
    addIssue(issues, "验证路径不是普通文件", "Validation path is not a regular file", normalizedRelative);
    return { ok: false, reason: "type" };
  }
  if (expected === "directory" && !metadata?.isDirectory()) {
    addIssue(issues, "验证路径不是目录", "Validation path is not a directory", normalizedRelative);
    return { ok: false, reason: "type" };
  }
  return { ok: true, path: candidate, realPath: candidateRealPath, metadata };
}

async function readJsonObject(repositoryRoot, relativePath, issues) {
  const inspected = await inspectSafePath(repositoryRoot, relativePath, issues, {
    expected: "file",
    reportMissing: false,
  });
  if (!inspected.ok) {
    if (inspected.reason === "missing") {
      addIssue(issues, "缺少必需的 JSON 文件", "Required JSON file is missing", relativePath);
    }
    return null;
  }

  let text;
  try {
    text = await readFile(inspected.path, "utf8");
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
  const inspected = await inspectSafePath(repositoryRoot, relativePath, issues, {
    expected: "file",
    reportMissing: false,
  });
  if (!inspected.ok && inspected.reason === "missing") {
    addIssue(issues, "缺少必需文件", "Required file is missing", relativePath);
  }
  if (!inspected.ok) {
    return false;
  }
  return true;
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
    if (packageJson && manifest.version !== packageVersion) {
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
    if (!Array.isArray(codex.plugins) || codex.plugins.length !== 1) {
      addIssue(
        issues,
        "Codex marketplace 必须恰好包含一个插件条目",
        "Codex marketplace must contain exactly one plugin entry",
        codexPath,
      );
    }
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
    if (!Array.isArray(claude.plugins) || claude.plugins.length !== 1) {
      addIssue(
        issues,
        "Claude marketplace 必须恰好包含一个插件条目",
        "Claude marketplace must contain exactly one plugin entry",
        claudePath,
      );
    }
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

async function readSafeFileTree(repositoryRoot, skillRoot, issues, { required }) {
  const rootInspection = await inspectSafePath(repositoryRoot, skillRoot, issues, {
    expected: "directory",
    reportMissing: false,
  });
  if (!rootInspection.ok) {
    if (rootInspection.reason === "missing" && required) {
      addIssue(issues, "缺少规范 Skill 目录", "Canonical Skill directory is missing", skillRoot);
    }
    return {
      exists: false,
      files: new Map(),
      realPath: null,
      safe: rootInspection.reason === "missing" && !required,
    };
  }

  const files = new Map();
  let safe = true;
  async function visit(directory, relativeDirectory = "") {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      addIssue(
        issues,
        "无法读取 Skill 目录",
        "Skill directory cannot be read",
        path.posix.join(skillRoot, displayPath(relativeDirectory)),
      );
      safe = false;
      return;
    }

    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      const repositoryRelative = path.join(skillRoot, relative);
      const shownPath = displayPath(repositoryRelative);
      if (entry.isSymbolicLink()) {
        addIssue(
          issues,
          "Skill 树不允许符号链接",
          "symbolic link is not allowed in a Skill tree",
          shownPath,
        );
        safe = false;
        continue;
      }
      if (entry.isDirectory()) {
        await visit(path.join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) {
        addIssue(issues, "Skill 树只允许普通文件", "Skill tree allows only regular files", shownPath);
        safe = false;
        continue;
      }

      const inspected = await inspectSafePath(repositoryRoot, repositoryRelative, issues, {
        expected: "file",
        allowedRoot: rootInspection.realPath,
      });
      if (!inspected.ok) {
        safe = false;
        continue;
      }
      try {
        files.set(displayPath(relative), await readFile(inspected.path));
      } catch {
        addIssue(issues, "无法读取 Skill 文件", "Skill file cannot be read", shownPath);
        safe = false;
      }
    }
  }

  await visit(rootInspection.path);
  return { exists: true, files, realPath: rootInspection.realPath, safe };
}

async function compareSkillTrees(repositoryRoot, issues) {
  const [canonical, generated] = await Promise.all([
    readSafeFileTree(repositoryRoot, "llm-wiki-zh", issues, { required: true }),
    readSafeFileTree(repositoryRoot, "skills/llm-wiki-zh", issues, { required: false }),
  ]);
  if (canonical.exists) {
    for (const [relative, sourceContent] of canonical.files) {
      const targetContent = generated.files.get(relative);
      const generatedPath = path.posix.join("skills/llm-wiki-zh", relative);
      if (targetContent === undefined) {
        addIssue(issues, "Skill 生成内容存在差异", "Generated Skill content has drift", `missing: ${generatedPath}`);
      } else if (!sourceContent.equals(targetContent)) {
        addIssue(issues, "Skill 生成内容存在差异", "Generated Skill content has drift", `changed: ${generatedPath}`);
      }
    }
    for (const relative of generated.files.keys()) {
      if (!canonical.files.has(relative)) {
        addIssue(
          issues,
          "Skill 生成内容存在差异",
          "Generated Skill content has drift",
          `stale: ${path.posix.join("skills/llm-wiki-zh", relative)}`,
        );
      }
    }
  }
  return { canonical, generated, safe: canonical.safe && generated.safe };
}

async function scanSkillReferences(repositoryRoot, skillRoot, tree, issues) {
  const skillPath = path.posix.join(skillRoot, "SKILL.md");
  if (!tree.exists) {
    return;
  }
  const skillContent = tree.files.get("SKILL.md");
  if (skillContent === undefined) {
    addIssue(issues, "缺少 Skill 入口文件", "Skill entry file is missing", skillPath);
    return;
  }
  const markdown = skillContent.toString("utf8");

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
    const inspected = await inspectSafePath(repositoryRoot, relativeTarget, issues, {
      expected: "file",
      allowedRoot: tree.realPath,
      reportMissing: false,
    });
    if (!inspected.ok && inspected.reason === "missing") {
      addIssue(
        issues,
        "Skill 引用无法解析",
        "Skill reference is unresolved",
        `${skillPath} -> ${token}`,
      );
    }
  }
}

export async function validateRepository(root) {
  const issues = [];
  const requestedRoot = path.resolve(root);
  let repositoryRoot;
  try {
    repositoryRoot = await realpath(requestedRoot);
    const rootMetadata = await lstat(repositoryRoot);
    if (!rootMetadata.isDirectory()) {
      addIssue(issues, "仓库根路径不是目录", "Repository root is not a directory");
      return [...new Set(issues)].sort();
    }
  } catch {
    addIssue(issues, "无法解析仓库根目录", "Repository root cannot be resolved");
    return [...new Set(issues)].sort();
  }

  const values = {};

  const [, , skillTrees] = await Promise.all([
    Promise.all(JSON_PATHS.map(async relativePath => {
      values[relativePath] = await readJsonObject(repositoryRoot, relativePath, issues);
    })),
    Promise.all(REQUIRED_REGULAR_FILES.map(relativePath => requireRegularFile(repositoryRoot, relativePath, issues))),
    compareSkillTrees(repositoryRoot, issues),
  ]);

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

  await Promise.all([
    scanSkillReferences(repositoryRoot, SKILL_ROOTS[0], skillTrees.canonical, issues),
    scanSkillReferences(repositoryRoot, SKILL_ROOTS[1], skillTrees.generated, issues),
  ]);

  const canRunSync = packageJson
    && typeof packageJson.version === "string"
    && STRICT_SEMVER.test(packageJson.version)
    && manifests.root
    && manifests.codex
    && manifests.claude
    && skillTrees.safe;
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

async function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    const [invokedPath, modulePath] = await Promise.all([
      realpath(path.resolve(process.argv[1])),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    return invokedPath === modulePath;
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (await isMainModule()) {
  await main();
}
