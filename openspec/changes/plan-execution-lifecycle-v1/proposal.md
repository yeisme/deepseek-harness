# Plan Execution Lifecycle

## Why

当前 dsh 的 plan mode 是 Copilot 式“只读建议”：模型可以只读探索而不产出计划，批准后只退出 plan mode，不会自动进入执行。Codex/Claude 式 plan 的关键差异是：**plan 是持久化产物，批准后自动开始执行，执行状态可投影、可追踪**。

本 change 在已落地的 `plan/document`、`plan_form`、`plan-spec`、`task-basis` 之上补齐执行生命周期，不改变 plan mode 作为软引导的边界，也不让 plan mode 直接读写沙箱或审批策略。

## What Changes

- 扩展 `plan/document` 状态机：`executing`、`completed`、`superseded`。
- `exit_plan_mode` 批准后追加 `approved` 与 `executing` 两个文档事件，并注入执行指令。
- 新增 `plan_complete` 工具，模型在完成计划后调用。
- plan mode 增加轻量强制产出检查：只读探索且未提交计划时注入提醒。
- `plan-spec` 新增 `spec_write` / `spec_read` 工具，并校验计划处于可执行状态。
- `task-basis` 暴露 capture/check 服务，供 subagent/workflow/goal 接入。
- Web UI 与 omdsh TUI 消费新投影与状态。

## Capabilities

### New Capabilities

- `plan-execution-lifecycle`: plan 从 proposed 到 completed 的执行生命周期状态与自动执行衔接。
- `plan-spec-tools`: `spec_write` / `spec_read` 模型工具。
- `plan-task-basis`: 长期任务 basis 捕获与冲突检测服务。

### Modified Capabilities

- `plan-mode`: `plan/document` 状态与 `exit_plan_mode` 行为扩展。
- `plan-form` 与 `plan-review` 交互保持兼容。

## Impact

- 主要影响 `packages/plan/plan-mode`、`packages/plan/plan-spec`、`packages/plan/task-basis`、`packages/client/ui-plan`、`packages/client/ui-user-questions`。
- 新工具会改变 tool catalog，需重新生成 `docs/tool-catalog.md`。
- `exit_plan_mode` 批准后自动执行是行为变更；用插件来源用户消息承载执行指令，不改变 session schema。
- Harness Plugins 仓库的 omdsh TUI 作为消费端，不在本仓库修改范围内。
