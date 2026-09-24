import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // -------- /wiki-ingest：将材料录入 wiki --------
  pi.registerCommand("wiki-ingest", {
    description:
      "将材料录入 LLM Wiki 知识库（论文、对话、代码、会话等）",
    async handler(args, _ctx) {
      const message = args
        ? `把 ${args} 录入wiki`
        : "把材料录入wiki（请说明要录入什么内容）";
      pi.sendUserMessage(message);
    },
  });

  // -------- /wiki-query：查询 wiki 中的知识 --------
  pi.registerCommand("wiki-query", {
    description:
      "查询 LLM Wiki 知识库中已有的内容",
    async handler(args, _ctx) {
      const message = args
        ? `wiki里关于${args}怎么说`
        : "wiki里有什么内容？（请说明要查询什么主题）";
      pi.sendUserMessage(message);
    },
  });

  // -------- /wiki-lint：检查 wiki 健康度 --------
  pi.registerCommand("wiki-lint", {
    description:
      "检查 LLM Wiki 知识库的健康度（孤立页面、过期内容等）",
    async handler(_args, _ctx) {
      pi.sendUserMessage("检查wiki");
    },
  });
}
