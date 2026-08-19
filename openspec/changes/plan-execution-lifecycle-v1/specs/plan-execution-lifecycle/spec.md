# Spec — Plan Execution Lifecycle

## `plan/document` 生命周期

`plan/document` SHALL 支持以下状态：

- `proposed`
- `approved`
- `executing`
- `completed`
- `superseded`
- `rejected`

`plan-document` projection SHALL 返回 `{ latest, revisions }`，其中 `latest` 是日志中最后一条 `plan/document`，`revisions` 是全部文档。

## `exit_plan_mode` 行为

- plan mode 外执行 SHALL fail。
- 提交 plan SHALL append `plan/document: proposed`。
- 用户批准 SHALL append `plan/document: approved`，随后 append `plan/document: executing`。
- 批准后 SHALL 注入 plugin 来源执行指令，并保持 pending exit 的既有行为。
- 用户拒绝 SHALL append `plan/document: rejected`，plan mode 保持激活。

## `plan_complete` 行为

- `plan_complete` SHALL 始终注册，执行仅在存在 `executing` 状态 `plan/document` 时成功。
- 成功后 SHALL append `plan/document: completed`。

## plan mode 强制产出

- plan mode 激活且当前 turn 未新增 `proposed/approved/executing` 的 `plan/document` 时，下一步 SHALL 收到一次 plugin 来源提醒。
- 该提醒 SHALL NOT 阻塞 step。

## spec 工具

- `spec_write` SHALL 在当前 plan 处于 `approved` 或 `executing` 状态时成功，否则失败。
- `spec_write` SHALL append whole-value `spec/document` 事件。
- `spec_read` SHALL 返回 latest spec 或按 planId 列出 spec。

## task-basis

- `task/basis` SHALL 记录任务启动时的 `planSeq` 与 `specSeqs`。
- `task/conflict` SHALL 通过比较 basis 与当前 fold 生成 `safe`、`needs-merge` 或 `blocked`。
