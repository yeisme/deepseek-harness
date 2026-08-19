# @deepseek-ai/dsh-plan-spec

[English](README.md) | 中文

持久的 plan-spec 文档。`spec/document` 是仅记日志、整值替换的 `SessionEventMap` 成员，以 `specId` 为键、由 `planId` 所有；最新写入 wins，历史写入保留修订记录。`ctx.planSpec` 拥有写入路径，可选的 `spec-document` 投影单元在组合 `ctx.sessionProjections` 时提供 `{ latest, revisions, byPlan }`。

spec 不是文件系统产物：它存在会话日志中，因此恢复、fork 和压缩都能像 plan 文档一样恢复。每个修订都记录 `basisPlanRevision` 与 `basisSpecVersions`，为未来的 task-basis 检查提供长期任务冲突检测所需的事实。

## API

- `ctx.planSpec.write(session, input)`：追加下一个修订；`input` 需要 `specId`、`planId`、`title`、`content`、`basisPlanRevision`，可选 `status`/`basisSpecVersions`。
- `ctx.planSpec.current(session, specId)`：折叠单个 spec 的最新修订。
- `ctx.planSpec.list(session, planId?)`：按 plan 再按 specId 分组折叠最新 spec。

## 模型体验

spec 事件仅记日志，绝不进入模型历史。模型只通过工具或由投影构建的注入上下文读写 spec，因此新增 spec 本身不增加提示词 token。

#### KV Cache 影响

不会直接失效；渲染 spec 上下文的消费方负责任何请求前缀变更。

## 已知限制与暂缓事项

- **没有 plan 所有权校验**：`write` 不要求引用的 `planId` 已存在于 `plan/document`；未来的 task-basis 层可以补上。
- **尚无冲突引擎**：basis 事实已持久化，但消费方需要自行比较。
