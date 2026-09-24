import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
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

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isInside(allowedRoot, candidate) {
  const relative = path.relative(allowedRoot, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function displayPath(repositoryRoot, candidate) {
  const relative = path.relative(repositoryRoot, candidate);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

async function resolveRepositoryRoot(root) {
  const requestedRoot = path.resolve(root);
  try {
    const repositoryRoot = await realpath(requestedRoot);
    const metadata = await lstat(repositoryRoot);
    if (!metadata.isDirectory()) {
      throw new Error("not a directory");
    }
    return repositoryRoot;
  } catch {
    throw new Error(`无法解析仓库根目录 / Repository root cannot be resolved: ${requestedRoot}`);
  }
}

async function inspectSafePath(
  repositoryRoot,
  candidate,
  { allowMissing = false, expected = null, label = "同步路径 / Sync path" } = {},
) {
  const resolvedCandidate = path.resolve(candidate);
  const shownPath = displayPath(repositoryRoot, resolvedCandidate);
  if (!isInside(repositoryRoot, resolvedCandidate)) {
    throw new Error(`${label} 越出仓库根目录 / ${label} escapes the repository root: ${shownPath}`);
  }

  const relative = path.relative(repositoryRoot, resolvedCandidate);
  const segments = relative === "" ? [] : relative.split(path.sep);
  let current = repositoryRoot;
  let metadata = await lstat(repositoryRoot);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT" && allowMissing) {
        const ancestorRealPath = await realpath(path.dirname(current));
        if (!isInside(repositoryRoot, ancestorRealPath)) {
          throw new Error(`${label} 的真实位置越界 / ${label} real path escapes the repository root: ${shownPath}`);
        }
        return { exists: false, path: resolvedCandidate };
      }
      if (error.code === "ENOENT") {
        throw new Error(`${label} 不存在 / ${label} is missing: ${shownPath}`);
      }
      throw new Error(`${label} 无法检查 / ${label} cannot be inspected: ${shownPath}`);
    }
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `${label} 不允许符号链接 / ${label} does not allow a symbolic link: ${displayPath(repositoryRoot, current)}`,
      );
    }
  }

  let candidateRealPath;
  try {
    candidateRealPath = await realpath(resolvedCandidate);
  } catch {
    throw new Error(`${label} 无法解析真实路径 / ${label} real path cannot be resolved: ${shownPath}`);
  }
  if (!isInside(repositoryRoot, candidateRealPath)) {
    throw new Error(`${label} 的真实位置越界 / ${label} real path escapes the repository root: ${shownPath}`);
  }
  if (expected === "file" && !metadata.isFile()) {
    throw new Error(`${label} 不是普通文件 / ${label} is not a regular file: ${shownPath}`);
  }
  if (expected === "file" && metadata.nlink > 1) {
    throw new Error(`${label} 存在多个硬链接 / ${label} has multiple hard links: ${shownPath}`);
  }
  if (expected === "directory" && !metadata.isDirectory()) {
    throw new Error(`${label} 不是目录 / ${label} is not a directory: ${shownPath}`);
  }
  return { exists: true, path: resolvedCandidate, realPath: candidateRealPath, metadata };
}

async function readFileTree(repositoryRoot, relativeDirectory, { required = false } = {}) {
  const directory = path.join(repositoryRoot, relativeDirectory);
  const rootInspection = await inspectSafePath(repositoryRoot, directory, {
    allowMissing: !required,
    expected: "directory",
    label: "Skill 目录 / Skill directory",
  });
  if (!rootInspection.exists) {
    return new Map();
  }

  const files = new Map();
  async function visit(currentDirectory, relativeRoot = "") {
    await inspectSafePath(repositoryRoot, currentDirectory, {
      expected: "directory",
      label: "Skill 目录 / Skill directory",
    });
    let entries;
    try {
      entries = await readdir(currentDirectory, { withFileTypes: true });
    } catch {
      throw new Error(
        `无法读取 Skill 目录 / Skill directory cannot be read: ${displayPath(repositoryRoot, currentDirectory)}`,
      );
    }

    for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
      const entryPath = path.join(currentDirectory, entry.name);
      const relative = relativeRoot ? path.join(relativeRoot, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Skill 树不允许符号链接 / Skill tree does not allow a symbolic link: ${displayPath(repositoryRoot, entryPath)}`,
        );
      }
      if (entry.isDirectory()) {
        await visit(entryPath, relative);
      } else if (entry.isFile()) {
        await inspectSafePath(repositoryRoot, entryPath, {
          expected: "file",
          label: "Skill 文件 / Skill file",
        });
        files.set(relative.split(path.sep).join("/"), await readFile(entryPath));
      } else {
        throw new Error(
          `Skill 树只允许普通文件和目录 / Skill tree allows only regular files and directories: ${displayPath(repositoryRoot, entryPath)}`,
        );
      }
    }
  }

  await visit(directory);
  return new Map([...files.entries()].sort(([left], [right]) => comparePaths(left, right)));
}

async function readJson(repositoryRoot, filePath, label) {
  await inspectSafePath(repositoryRoot, filePath, { expected: "file", label });
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
  const packageJson = await readJson(root, path.join(root, "package.json"), "package.json");
  if (typeof packageJson.version !== "string" || !SEMVER.test(packageJson.version)) {
    throw new Error(`package.json 版本不是有效 SemVer / package.json version is not valid SemVer: ${packageJson.version}`);
  }
  return packageJson.version;
}

export async function syncRepository(root, { check = false } = {}) {
  const repositoryRoot = await resolveRepositoryRoot(root);
  const targetPath = path.join(repositoryRoot, TARGET_DIR);
  const [sourceFiles, targetFiles, packageVersion] = await Promise.all([
    readFileTree(repositoryRoot, SOURCE_DIR, { required: true }),
    readFileTree(repositoryRoot, TARGET_DIR),
    readPackageVersion(repositoryRoot),
  ]);
  const manifests = await Promise.all(MANIFESTS.map(async (manifestPath) => ({
    manifestPath,
    value: await readJson(
      repositoryRoot,
      path.join(repositoryRoot, manifestPath),
      "插件清单 / Plugin manifest",
    ),
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
        await inspectSafePath(repositoryRoot, path.dirname(destination), {
          allowMissing: true,
          expected: "directory",
          label: "生成目录 / Generated directory",
        });
        await mkdir(path.dirname(destination), { recursive: true });
        await inspectSafePath(repositoryRoot, destination, {
          allowMissing: true,
          expected: "file",
          label: "生成文件 / Generated file",
        });
        await writeFile(destination, sourceContent);
      }
    }
    for (const relative of targetFiles.keys()) {
      if (!sourceFiles.has(relative)) {
        const stalePath = path.join(targetPath, relative);
        await inspectSafePath(repositoryRoot, stalePath, {
          expected: "file",
          label: "陈旧生成文件 / Stale generated file",
        });
        await rm(stalePath, { force: true });
      }
    }
    for (const { manifestPath, value } of manifests) {
      if (value.version !== packageVersion) {
        value.version = packageVersion;
        const destination = path.join(repositoryRoot, manifestPath);
        await inspectSafePath(repositoryRoot, destination, {
          expected: "file",
          label: "插件清单 / Plugin manifest",
        });
        await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
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
      throw new Error("未知参数 / Unknown argument");
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
