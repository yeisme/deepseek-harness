# Agent Note：Ordo Agent Ops 紧凑消费方保持 owner-gated

Status: implemented

[English](2026-08-14-ordo-agent-ops-compact-consumer.md) | 中文

## 问题

DSH 需要一个在当前上下文内可见的本地 Agent Ops 入口，但 Ordo 的 canonical snapshot 与 event owner 合同仍位于本子项目之外。浏览器 projection 或本地自造的 run 状态都会形成第二 scheduler 真相，并可能把不可用的 owner 显示成健康状态。

## 决策

DSH 本切片拆成两个可替换的消费方：

- `packages/host/ordo-agent-ops` 暴露一个只读 `ordoAgentOps/snapshot` Remote。它读取可选的 `ordoAgentOpsOwner` source；未挂载时返回不含 run、lease、worktree、capacity 或 evidence 事实的安全 `needs_contract` snapshot。
- `packages/client/ui-ordo-agent-ops` 注册紧凑侧栏动作。控制器只保留一个进行中读取，在 reset/dispose 时推进 generation，并忽略迟到结果。浏览器只接收 typed safe projection；在重新鉴权的深链合同存在前，Workbench 按钮保持禁用。

Host 包不连接 Ordo、不观察进程、不预留容量、不启动 runtime，也不派发动作。事件 cursor、租户授权、owner receipt、ToolView 与 reconcile 仍属于外部 owner handoff。

## 曾考虑的替代方案

- **在本地发明 Ordo snapshot** —— 否决，因为 DSH 会成为 run、lease 或 capacity 的第二 owner。
- **让浏览器直接调用 Ordo** —— 否决，因为 credential、audience、租户授权与脱敏属于 Host/Control Plane 边界。
- **把空状态显示成成功** —— 否决，因为 owner 合同缺失不能证明 run 健康或存在可用容量。

## 证据

Host focused typecheck 与 gateway tests 通过。Client 包 focused typecheck、controller/browser tests 与 `build:lib:client` 通过。这只属于 implemented 加 focused/local 与 browser/consumer 证据，不代表 Ordo provider、部署、云 Agent 或生产证据。

## 结果

- 在 owner 合同缺失期间，DSH 已拥有真实可安装的 Host/Client seam 与诚实的浏览器 fallback。
- 在 Ordo 与 Harness Control Plane 发布 typed owner contract 前，面板不能回答 run、event、approval、reconcile 或 launch 问题。
- 后续工作保持 additive：挂载 owner source 并扩展 Remote 合同，不把 canonical state 移入 DSH。
