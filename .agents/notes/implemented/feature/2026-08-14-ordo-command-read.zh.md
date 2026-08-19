# Agent Note: 只读 Ordo slash command 使用 owner snapshot

Status: implemented

[English](2026-08-14-ordo-command-read.md) | 中文

## 问题

Web profile 已挂载只读 Ordo Agent Ops gateway，但交互式 operator 尚无命令面入口读取其中已经授权的 snapshot。若新增命令却不把该 gateway 保持为唯一事实来源，就可能形成第二投影、伪造 runtime 细节，或把 action path 伪装成 read。

## 决策

`@deepseek-ai/dsh-host-ordo-commands` 只会在既有 `commands` runtime 与 `ordoAgentOps` gateway 都已挂载时注册唯一的 `/ordo` 命令。`/ordo`、`help`、`status` 和 `capacity` 从 `ordoAgentOps.snapshot()` 渲染固定四段式摘要；不可读状态不会暴露 run 或 capacity 事实。`preview` 在 owner-owned composition-preview source 存在之前返回 `needs_contract`。

parser 只接受四种 read 形式和狭窄的不透明 reference token。它拒绝空值或 undefined、含空白的输入、路径、URL 形式、scheme、控制字符和多余参数，并且不会回显不安全输入。命令不新增 SessionEventMap 成员，而是依赖 `dsh-commands` 正常记录 `command/run` 与 `command/done` 生命周期事件对。

Web bundle 会把该命令挂在既有 Ordo Agent Ops row 旁边。base 与 headless profile 保持不变。

## 测试

包测试覆盖 parser 的正反例、read-ready 与 fail-closed 状态摘要、安全文本抑制、capacity、缺失的 composition preview、注册 disposal、package invariant、命令生命周期以及通过 Loader 组合的 Host 配置。

## 考虑过的替代方案

**直接读取 owner source。** 否决，因为 Agent Ops gateway 已经校验 expected context 并脱敏 owner 数据；绕过它会复制一条对授权敏感的读取路径。

**新增本地 preview、scheduler 或 cache。** 否决，因为它们都不是 owner 编写的 projection。如实返回 `needs_contract` 能保留未来 composition owner 的边界。

**把命令挂到 base profile。** 否决，因为当前唯一的 source 属于 Web Host composition，加入默认 profile 会在没有 owner source 的情况下扩大命令面。

## 后果

- operator 可以读取既有安全 snapshot，不产生 model request、provider call、launch、reservation、reconciliation 或 ticket 解析。
- 在 owner service 提供 typed source 之前，命令刻意不能 preview composition。
- package 保留一条 runtime invariant，保证已注册的 command effect 与 snapshot source 同时存在，并覆盖 HMR disposal。
