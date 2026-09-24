import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FORMATS = new Set(["auto", "claude", "codex"]);
const CODEX_METADATA_TYPES = new Set(["session_meta", "turn_context", "event_msg", "world_state"]);
const CODEX_TOOL_TYPES = new Set(["function_call", "tool_call", "custom_tool_call"]);
const SENSITIVE_QUERY_KEYS = [
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  "x-goog-signature",
  "credential",
  "signature",
  "sig",
  "access_token",
  "refresh_token",
  "token",
  "api_key",
  "apikey",
  "auth",
];

function replaceMatches(value, pattern, replacement, state) {
  return value.replace(pattern, (...argumentsList) => {
    state.redactions += 1;
    return typeof replacement === "function" ? replacement(...argumentsList) : replacement;
  });
}

export function redactText(text) {
  const state = { redactions: 0 };
  let redacted = String(text);
  const queryKeys = SENSITIVE_QUERY_KEYS.map((key) => key.replaceAll("-", "\\-")).join("|");

  redacted = replaceMatches(
    redacted,
    new RegExp(`([?&](?:${queryKeys})=)([^&#\\s]*)`, "gi"),
    (_match, prefix, value) => value === "[REDACTED]" ? `${prefix}${value}` : `${prefix}[REDACTED]`,
    state,
  );
  redacted = replaceMatches(
    redacted,
    /\b(Authorization\s*[:=]\s*(?:Bearer|Basic)\s+)([^\s,;]+)/gi,
    (_match, prefix) => `${prefix}[REDACTED]`,
    state,
  );
  redacted = replaceMatches(
    redacted,
    /\b((?:Set-)?Cookie\s*[:=]\s*)([^\r\n]+)/gi,
    (_match, prefix) => `${prefix}[REDACTED]`,
    state,
  );
  redacted = replaceMatches(
    redacted,
    /(?<![?&])\b((?:api[_-]?key|password|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*)(["']?)([^\s,"';&}\]]+)(["']?)/gi,
    (_match, prefix, openingQuote, _value, closingQuote) => `${prefix}${openingQuote}[REDACTED]${closingQuote}`,
    state,
  );
  redacted = replaceMatches(redacted, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]", state);
  redacted = replaceMatches(redacted, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]", state);
  redacted = replaceMatches(redacted, /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]", state);
  redacted = replaceMatches(redacted, /\bxox[a-zA-Z]?-[A-Za-z0-9-]{20,}\b/g, "[REDACTED]", state);
  redacted = replaceMatches(redacted, /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]", state);

  return { text: redacted, redactions: state.redactions };
}

function parseRecords(text) {
  const records = [];
  let malformedLines = 0;
  for (const line of String(text).split(/\r?\n/u)) {
    if (line.trim() === "") {
      continue;
    }
    try {
      records.push(JSON.parse(line));
    } catch {
      malformedLines += 1;
    }
  }
  return { records, malformedLines };
}

function detectFormat(records) {
  let hasClaude = false;
  let hasCodex = false;
  for (const record of records) {
    if (record !== null && typeof record === "object" && !Array.isArray(record)) {
      hasClaude ||= record.type === "user" || record.type === "assistant";
      hasCodex ||= record.type === "response_item";
    }
  }
  if (hasClaude && hasCodex) {
    throw new Error("检测到混合会话格式 / mixed session formats are not supported");
  }
  if (!hasClaude && !hasCodex) {
    throw new Error("不支持或无法识别的会话格式 / unsupported or unrecognized session format");
  }
  return hasClaude ? "claude" : "codex";
}

function textBlocks(content, allowedTypes) {
  if (typeof content === "string") {
    return content.trim() === "" ? [] : [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const texts = [];
  for (const block of content) {
    if (
      block !== null
      && typeof block === "object"
      && allowedTypes.has(block.type)
      && typeof block.text === "string"
      && block.text.trim() !== ""
    ) {
      texts.push(block.text);
    }
  }
  return texts;
}

function selectedPath(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  for (const key of ["path", "file_path", "filePath"]) {
    if (typeof input[key] === "string" && input[key].trim() !== "") {
      return input[key];
    }
  }
  return undefined;
}

function parseToolArguments(argumentsValue) {
  if (argumentsValue !== null && typeof argumentsValue === "object" && !Array.isArray(argumentsValue)) {
    return argumentsValue;
  }
  if (typeof argumentsValue !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(argumentsValue);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeToolName(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = value.trim().slice(0, 128).replace(/[^A-Za-z0-9_.:/-]+/gu, "_");
  return sanitized === "" ? undefined : sanitized;
}

function sanitizeToolPath(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const withoutQuery = value.split(/[?#]/u, 1)[0];
  const sanitized = withoutQuery
    .replace(/[\u0000-\u001f\u007f\[\]]/gu, "_")
    .trim()
    .slice(0, 1024);
  return sanitized === "" ? undefined : sanitized;
}

function redactFragment(text, stats) {
  const result = redactText(text);
  stats.redactions += result.redactions;
  return result.text;
}

function toolSummary(name, argumentsValue, stats) {
  const safeName = sanitizeToolName(name);
  if (safeName === undefined) {
    return undefined;
  }
  const redactedName = redactFragment(safeName, stats);
  const safePath = sanitizeToolPath(selectedPath(argumentsValue));
  if (safePath === undefined) {
    return `[tool: ${redactedName}]`;
  }
  return `[tool: ${redactedName} → ${redactFragment(safePath, stats)}]`;
}

function normalizeClaudeRecord(record, stats) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { recognized: false };
  }
  if (record.type !== "user" && record.type !== "assistant") {
    return { recognized: false };
  }
  const role = record.type === "user" ? "User" : "Assistant";
  const message = record.message;
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return { recognized: true };
  }
  const content = message.content;
  const fragments = textBlocks(content, new Set(["text"]));
  const hadMessage = fragments.length > 0;
  if (record.type === "assistant" && Array.isArray(content)) {
    for (const block of content) {
      if (block !== null && typeof block === "object" && block.type === "tool_use") {
        const summary = toolSummary(block.name, block.input, stats);
        if (summary !== undefined) {
          fragments.push(summary);
        }
      }
    }
  }
  return {
    recognized: true,
    role,
    fragments: fragments.map((fragment) => fragment.startsWith("[tool: ") ? fragment : redactFragment(fragment, stats)),
    hadMessage,
  };
}

function codexPayload(record) {
  if (record.payload !== null && typeof record.payload === "object" && !Array.isArray(record.payload)) {
    return record.payload;
  }
  if (record.item !== null && typeof record.item === "object" && !Array.isArray(record.item)) {
    return record.item;
  }
  return undefined;
}

function normalizeCodexRecord(record, stats) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { recognized: false };
  }
  if (CODEX_METADATA_TYPES.has(record.type)) {
    return { recognized: true };
  }
  if (record.type !== "response_item") {
    return { recognized: false };
  }
  const payload = codexPayload(record);
  if (payload === undefined) {
    return { recognized: false };
  }
  if (payload.role === "user" || payload.role === "assistant") {
    const fragments = textBlocks(payload.content, new Set(["input_text", "output_text", "text"]));
    return {
      recognized: true,
      role: payload.role === "user" ? "User" : "Assistant",
      fragments: fragments.map((fragment) => redactFragment(fragment, stats)),
      hadMessage: fragments.length > 0,
    };
  }
  if (CODEX_TOOL_TYPES.has(payload.type)) {
    const summary = toolSummary(payload.name, parseToolArguments(payload.arguments), stats);
    return {
      recognized: true,
      role: "Assistant",
      fragments: summary === undefined ? [] : [summary],
      hadMessage: false,
    };
  }
  return { recognized: false };
}

function renderSections(sections) {
  let output = "# 规范化代理会话\n";
  for (const section of sections) {
    if (section.fragments.length > 0) {
      output += `\n## ${section.role}\n${section.fragments.join("\n")}\n`;
    }
  }
  return output;
}

export function normalizeSession(text, { format = "auto" } = {}) {
  if (!FORMATS.has(format)) {
    throw new Error(`不支持的格式 / unsupported format: ${format}`);
  }
  const parsed = parseRecords(text);
  const resolvedFormat = format === "auto" ? detectFormat(parsed.records) : format;
  const stats = {
    format: resolvedFormat,
    records: parsed.records.length,
    messages: 0,
    unknownRecords: 0,
    malformedLines: parsed.malformedLines,
    redactions: 0,
  };
  const sections = [];
  for (const record of parsed.records) {
    const normalized = resolvedFormat === "claude"
      ? normalizeClaudeRecord(record, stats)
      : normalizeCodexRecord(record, stats);
    if (!normalized.recognized) {
      stats.unknownRecords += 1;
      continue;
    }
    if (normalized.hadMessage) {
      stats.messages += 1;
    }
    if (normalized.fragments?.length > 0) {
      sections.push({ role: normalized.role, fragments: normalized.fragments });
    }
  }
  return { output: renderSections(sections), stats };
}

function parseArguments(argumentsList) {
  let format = "auto";
  let formatSeen = false;
  let file;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--format") {
      if (formatSeen) {
        throw new Error("--format 不能重复 / --format may only be specified once");
      }
      const value = argumentsList[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--format 缺少参数 / --format requires a value");
      }
      if (!FORMATS.has(value)) {
        throw new Error(`不支持的格式 / unsupported format: ${value}`);
      }
      format = value;
      formatSeen = true;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`未知参数 / unknown argument: ${argument}`);
    } else if (file !== undefined) {
      throw new Error(`多余参数 / unexpected argument: ${argument}`);
    } else {
      file = argument;
    }
  }
  if (file === undefined) {
    throw new Error("缺少明确的会话文件 / an explicit session file is required");
  }
  return { file, format };
}

async function main() {
  try {
    const { file, format } = parseArguments(process.argv.slice(2));
    let input;
    try {
      input = await readFile(file, "utf8");
    } catch (error) {
      throw new Error(`无法读取会话文件 / unable to read session file: ${file}`, { cause: error });
    }
    const result = normalizeSession(input, { format });
    if (result.stats.messages === 0) {
      throw new Error("未找到可安全提取的消息 / no safely extractable messages");
    }
    process.stdout.write(result.output);
    process.stderr.write(
      `[normalize-session] format=${result.stats.format} records=${result.stats.records} messages=${result.stats.messages} unknown=${result.stats.unknownRecords} malformed=${result.stats.malformedLines} redactions=${result.stats.redactions}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
