# Agent Note: 结构化规划表单与持久化计划文档

Status: implemented

[English](2026-08-15-plan-form-durable-plan-document.md) | 中文

## 问题

Plan mode 只能通过 `/plan <message>` 一次性输入，再通过 `exit_plan_mode` 做最终评审。缺少澄清需求的结构化来回交互，提交的计划只存在于 `tool/call.arguments`。计划文档无法从会话日志持久恢复，交互也无法与最终计划关联。

## 决策

`@deepseek-ai/dsh-plan-mode` 现在在 `exit_plan_mode` 旁注册 `plan_form`。`plan_form` 始终对外可见，但只在激活的 plan mode 中执行；它通过 `ctx.userQuestions` 发送一张结构化规划表单，记录 `plan/form/request` 与 `plan/form/answer` 事件，并返回结构化答案。`exit_plan_mode` 现在会在提交（`proposed`）、批准（`approved`）或拒绝（`rejected`）时追加 whole-value `plan/document` 事件，使用相同 `planId`，并通过 `sourceEventSeqs` 引用塑造该计划的表单事件。

`plan-document` 会话投影把每条 `plan/document` 折叠为 `{ latest, revisions }`，供 UI 与冷读使用。首个文档的 `planId` 为 `plan-<seq>`，后续修订复用。`dsh-client-ui-plan` 在 `conversation.input.dock` 渲染可折叠的计划文档条，展示最新 markdown 与修订列表。`AskUserQuestionIntent` 增加仅用于呈现的 `plan-form` 变体；Web question composer 以表单装饰（标题、步骤进度、提交标签）渲染它，同时保持通用流程可回答。当组合 `dsh-permission-presets` 时，plan-mode 还会注册可选桥接命令 `/plan-readonly`，进入 plan mode 并把会话预设切换为 `read-only`。新增的 `dsh-plan-spec` 包以 whole-value `spec/document` 事件持久化 spec 文档，`dsh-task-basis` 则捕获 plan/spec seq 基准，用于长期任务冲突检查。

## 测试

- plan-mode 单元与集成测试覆盖表单请求/答案记录、dismissal、工具 schema，以及提交/批准时追加文档。
- 投影测试覆盖 `plan-document` key 与最新文档折叠。
- UI composer 测试覆盖 `plan-form` 路由、进度与提交。
- 工具目录测试已更新 `plan_form` schema。

## 考虑过的替代方案

**只复用 `ask_user_question`。** 否决，因为 plan mode 需要已记录且关联计划的交互事件，而不是仅在对话中的问题。

**把计划保存到文件。** 否决，因为会话日志是可重建协作状态的持久化归属。

## 后果

- plan mode 获得结构化澄清轮次，且不改变 `plan/mode` 语义。
- 计划可在 resume/fork 后存续，并通过 seq 与 id 关联其表单交互。
- Web composer 无需离开会话即可查看最新计划文档及其修订历史。
- 可选桥接命令 `/plan-readonly` 为部署提供只读规划的一键开关，且不让 plan 状态读写沙箱策略。
- 旧 reader 会跳过新的 `ignorable` 事件；`SESSION_FORMAT_VERSION` 保持为 `0`。
