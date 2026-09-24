---
title:
identity:                  # 规范来源身份；不得含 Cookie、认证头或签名凭据
sha256:                    # 此版本实际注册内容的摘要
version: 1                 # 同一 identity 下单调递增
previous_version:          # 上一版本 snapshot/不可变 locator；首版留空
snapshot:                  # raw-sources/ 下此 digest 对应的不可变副本
locator:                   # 仅用于真正不可变的引用；snapshot 来源可省略
url:                       # 无凭据规范 URL（如有；不得保存临时签名 URL）
collected: YYYY-MM-DD
published: YYYY-MM-DD
authors: []
tags: []
---

# <来源标题>

<!--
以下是来源原文照录。清理格式噪音（导航、广告、
模板内容）。保留原文和观点——切勿在此处重写或
摘要。摘要应放在已汇编的 wiki 页面中。

对于 URL 来源，粘贴 markdown 格式（Obsidian Web Clipper 输出，或
fetch-to-markdown 转换结果）。对于 PDF，粘贴提取的文本。对于粘贴的
对话或临时文本，原文照录并在 `authors:` 中注明发言者和日期。

如果 `published:` 未知，设为 `Unknown`。

此模板用于保存可变来源的不可变版本。只有 content-addressed、commit-pinned、
带不可变版本 ID，或明确由外部系统保证 immutable 的 locator 才能只在
`raw-sources/index.md` 中引用而不复制。

普通工作区路径、可变外部文件、`latest` 或普通 URL，以及粘贴内容都必须按
实际内容 digest 保存 snapshot。同一 identity 出现新 digest 时创建新 snapshot，
递增 `version` 并用 `previous_version` 链接旧版；绝不修改旧 snapshot。

`raw-sources/index.md` 与本模板使用相同的 `identity`、`sha256`、`version`、
`previous_version` 和 `snapshot`／不可变 `locator`，使每个登记版本都可复核。
-->
