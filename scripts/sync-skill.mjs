import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SOURCE_DIR = "llm-wiki-zh";
const TARGET_DIR = "skills/llm-wiki-zh";
const MANIFESTS = [
  "plugin.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function relativePath(directory, name) {
  return path.relative(directory, name).split(path.sep).join("/");
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readFileTree(directory, { required = false } = {}) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (!required && error.code === "ENOENT") {
      return new Map();
    }
    if (required && error.code === "ENOENT") {
      throw new Error(`源目录不存在 / Source directory is missing: ${directory}`);
    }
    throw error;
  }

  const files = new Map();
  for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nestedFiles = await readFileTree(entryPath, { required: true });
      for (const [nestedPath, content] of nestedFiles) {
        files.set(path.posix.join(entry.name, nestedPath), content);
      }
    } else if (entry.isFile()) {
      files.set(relativePath(directory, entryPath), await readFile(entryPath));
    }
  }
  return new Map([...files.entries()].sort(([left], [right]) => comparePaths(left, right)));
}

async function readJson(filePath, label) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} 不存在 / ${label} is missing: ${filePath}`);
    }
    throw error;
  }

  try {
    const value = JSON.parse(text);
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error("not an object");
    }
    return value;
  } catch {
    throw new Error(`${label} 格式错误 / ${label} is malformed: ${filePath}`);
  }
}

async function readPackageVersion(root) {
  const packageJson = await readJson(path.join(root, "package.json"), "package.json");
  if (typeof packageJson.version !== "string" || !SEMVER.test(packageJson.version)) {
    throw new Error(`package.json 版本不是有效 SemVer / package.json version is not valid SemVer: ${packageJson.version}`);
  }
  return packageJson.version;
}

export async function syncRepository(root, { check = false } = {}) {
  const repositoryRoot = path.resolve(root);
  const sourcePath = path.join(repositoryRoot, SOURCE_DIR);
  const targetPath = path.join(repositoryRoot, TARGET_DIR);
  const [sourceFiles, targetFiles, packageVersion] = await Promise.all([
    readFileTree(sourcePath, { required: true }),
    readFileTree(targetPath),
    readPackageVersion(repositoryRoot),
  ]);
  const manifests = await Promise.all(MANIFESTS.map(async (manifestPath) => ({
    manifestPath,
    value: await readJson(path.join(repositoryRoot, manifestPath), "插件清单 / Plugin manifest"),
  })));
  const differences = [];

  for (const [relative, sourceContent] of sourceFiles) {
    const targetContent = targetFiles.get(relative);
    const generatedPath = path.posix.join(TARGET_DIR, relative);
    if (targetContent === undefined) {
      differences.push(`missing: ${generatedPath}`);
    } else if (!sourceContent.equals(targetContent)) {
      differences.push(`changed: ${generatedPath}`);
    }
  }
  for (const relative of targetFiles.keys()) {
    if (!sourceFiles.has(relative)) {
      differences.push(`stale: ${path.posix.join(TARGET_DIR, relative)}`);
    }
  }
  for (const { manifestPath, value } of manifests) {
    if (value.version !== packageVersion) {
      differences.push(`version: ${manifestPath}`);
    }
  }

  if (!check) {
    for (const [relative, sourceContent] of sourceFiles) {
      const destination = path.join(targetPath, relative);
      const targetContent = targetFiles.get(relative);
      if (targetContent === undefined || !sourceContent.equals(targetContent)) {
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, sourceContent);
      }
    }
    for (const relative of targetFiles.keys()) {
      if (!sourceFiles.has(relative)) {
        await rm(path.join(targetPath, relative), { force: true });
      }
    }
    for (const { manifestPath, value } of manifests) {
      if (value.version !== packageVersion) {
        value.version = packageVersion;
        await writeFile(path.join(repositoryRoot, manifestPath), `${JSON.stringify(value, null, 2)}\n`);
      }
    }
  }

  return { differences, changed: differences.length > 0 };
}

function parseArguments(argumentsList) {
  let check = false;
  let root = process.cwd();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--check") {
      check = true;
    } else if (argument === "--root") {
      const value = argumentsList[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--root 缺少路径 / --root requires a path");
      }
      root = value;
      index += 1;
    } else {
      throw new Error(`未知参数 / Unknown argument: ${argument}`);
    }
  }
  return { check, root };
}

async function main() {
  try {
    const { check, root } = parseArguments(process.argv.slice(2));
    const result = await syncRepository(root, { check });
    if (check && result.changed) {
      process.stdout.write(`${result.differences.join("\n")}\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
