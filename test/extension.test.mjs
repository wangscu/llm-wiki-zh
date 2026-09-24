import assert from "node:assert/strict";
import test from "node:test";

import extension from "../llm-wiki-zh/extension.ts";

function loadExtension() {
  const commands = new Map();
  const messages = [];
  extension({
    registerCommand(name, command) {
      commands.set(name, command);
    },
    sendUserMessage(message) {
      messages.push(message);
    },
  });
  return { commands, messages };
}

test("wiki-ingest forwards nonempty material", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-ingest").handler("example.md", {});
  assert.deepEqual(messages, ["把 example.md 录入wiki"]);
});

test("wiki-ingest keeps the empty-argument prompt", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-ingest").handler("", {});
  assert.deepEqual(messages, ["把材料录入wiki（请说明要录入什么内容）"]);
});

test("wiki-query forwards a nonempty topic", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-query").handler("单写者契约", {});
  assert.deepEqual(messages, ["wiki里关于单写者契约怎么说"]);
});

test("wiki-query keeps the empty-argument prompt", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-query").handler("", {});
  assert.deepEqual(messages, ["wiki里有什么内容？（请说明要查询什么主题）"]);
});

test("wiki-lint forwards explicit check-only intent", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-lint").handler("--check", {});
  assert.deepEqual(messages, ["只检查wiki，不要修改任何文件"]);
});

test("wiki-lint recognizes an embedded whitespace-delimited check flag", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-lint").handler("wiki --check now", {});
  assert.deepEqual(messages, ["只检查wiki，不要修改任何文件"]);
});

test("wiki-lint recognizes 只检查", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-lint").handler("只检查链接", {});
  assert.deepEqual(messages, ["只检查wiki，不要修改任何文件"]);
});

test("wiki-lint recognizes 只报告", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-lint").handler("只报告问题", {});
  assert.deepEqual(messages, ["只检查wiki，不要修改任何文件"]);
});

test("wiki-lint keeps the existing repair behavior by default", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-lint").handler("", {});
  assert.deepEqual(messages, ["检查wiki"]);
});

test("wiki-lint keeps the default repair behavior for unrelated arguments", async () => {
  const { commands, messages } = loadExtension();
  await commands.get("wiki-lint").handler("--checker", {});
  assert.deepEqual(messages, ["检查wiki"]);
});
