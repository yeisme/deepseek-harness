# Agent Note: Plan sidebar, fullscreen, multi-option and goal collaboration

Status: proposed

[English](2026-08-19-plan-sidebar-fullscreen-m2.md) | 中文

> 本提案已于 2026-08-20 被共享 Pane Workbench 方案取代，现行决策见
> [Plan dock 与 Pane 工作区信息设计](../../implemented/feature/2026-08-19-plan-dock-inline-edit-and-visual-polish.md)。
> 持久化方案/任务/目标投影与 `/plan-select` 路径继续有效；第二套
> `conversation.sidebar` 与 Plan 自有 fullscreen overlay 不再采用。

## Problem

计划体验目前局限于输入框上方的紧凑 dock 条。该条可以显示标题、状态、展开的 Markdown 和简单内联编辑，但无法承载多方案对比、DAG 任务进度、Goal 关联或长计划评审等更丰富的视图。Web 客户端没有持久侧边栏，因此没有地方放置类似 Codex Desktop 的计划面板。仅靠当前 surface 无法推进 M2 和 M3。

## Proposal

增加一个计划工作区 surface，包含三种展示模式，以及 M2 所需的数据与 UI 契约：

- **Dock**：保留现有紧凑条作为始终可见的摘要入口。
- **Sidebar**：从 dock 打开的右侧计划面板，在会话期间保持打开，支持缩放/折叠，承载完整计划详情、方案、Goal 与任务视图。
- **Fullscreen**：从 dock 或 sidebar 打开的聚焦浮层，用于阅读、比较方案和评审长计划。

该 surface 是纯投影消费者。它读取 `plan-document`、`plan-options`、`plan-tasks` 与 `goal` 投影，并通过命令或未来的 `remote.plans` 命名空间发送用户动作。它不持有业务状态。

### Sidebar slot

Web 客户端需要一个通用的、按 session 生效的侧边栏 slot。最小核心改动是在 `packages/client/ui-conversation` 中新增 `conversation.sidebar` 列表 slot，由会话布局拥有。计划插件向其中注册 `PlanSidebar`。该 slot 契约与 `conversation.input.dock` 对齐：

```ts
'conversation.sidebar': { kind: 'list'; scope: 'session'; owner: ConversationLayout }
```

没有侧边栏布局的 host 不渲染任何内容。支持侧边栏的布局提供折叠、缩放和关闭操作；计划面板不自行实现布局引擎。

如果已组合 `agent/harness-plugins` Pane Workbench 的 `shell.overlay`，计划侧边栏也可以挂载到那里。本方案仍以核心 slot 为默认路径，因为它不依赖独立的 Pane Workbench bundle。

### Fullscreen overlay

`PlanFullscreen` 是由 `dsh-client-ui-plan` 注册的产品自有浮层。它由 dock/sidebar 动作打开，渲染在会话上方，通过 `Esc` 或关闭按钮关闭。它使用与 sidebar 相同的标签页，并保持投影实时更新，因此打开期间状态与任务进度仍会变化。

### M2 multi-option

新增持久化 `plan/options` 事件与 `plan-options` 投影：

```ts
interface PlanOption {
  optionId: string
  title: string
  summary: string
  markdown: string
  tradeoffs?: string[]
  estimatedSteps?: number
  recommended?: boolean
}

'plan/options': {
  planId: string
  round: number
  options: PlanOption[]
  selectedOptionId?: string
  status: 'proposed' | 'selected' | 'superseded'
}
```

模型可通过扩展后的 `exit_plan_mode` `options` 参数或新的 `plan_propose_options` 工具提交方案。sidebar/fullscreen 的方案标签页渲染方案卡，支持展开/对比，并调用 `remote.plans.selectOption`（或 `/plan-select` 命令）将所选方案提升为 `plan/document`。

### Goal collaboration

为 `plan/document` 增加可选 `mode` 与 `goalId` 字段：

```ts
mode?: 'linear' | 'goal' | 'dag'
goalId?: string
```

当计划以 `goal` 模式批准时，`PlanWorkspaceService` 通过 `ctx.goals.create` 创建 Goal，并追加带 `goalId` 的更新 `plan/document`。计划 sidebar 显示关联 Goal 卡片，包含 phase、rounds、pause/resume/edit/clear 操作。计划完成时调用 `ctx.goals.complete`；Goal 被阻塞时 UI 将计划标记为 blocked。

## Task breakdown

- T1：在 `packages/client/ui-conversation` 中新增 `conversation.sidebar` slot，并在会话布局中渲染。
- T2：在 `packages/client/ui-plan` 中新增 `PlanSidebar` 组件，包含 dock 到 sidebar 的打开动作与折叠/缩放行为。
- T3：新增 `PlanFullscreen` 浮层，包含标签页（概览、方案、Goal、任务、修订）与键盘关闭。
- T4：新增 `plan/options` 事件、`plan-options` 投影与 invariant 覆盖。
- T5：新增多方案 UI（方案卡、对比、选择）以及 `plan-select` 命令或 `remote.plans.selectOption`。
- T6：为 `plan/document` 增加 `mode`/`goalId`，批准时创建 Goal，并同步计划与 Goal 状态。
- T7：为 sidebar/fullscreen/options/goal 增加组件测试，为新增事件增加 host 测试，并更新 README/Agent Notes。

## Alternatives considered

### 仅复用 composer dock

dock 太小，无法承载多方案对比与长计划评审。它保留为摘要入口，但不是工作区。

### 不增加核心 slot，构建计划专用右面板

计划专用面板更快，但会制造第二套布局系统，并阻碍未来工具（任务、终端、Git）复用同一侧边栏。通用 `conversation.sidebar` slot 是更小长期成本的方案。

### 引入第三方布局库

一个可缩放 sidebar 和一个浮层不需要重型布局库。现有 DSH 布局 token 加简单 split/overlay 组件足够。

## Acceptance criteria

- 用户可以从 dock 将计划打开到右侧 sidebar 和 fullscreen，再返回 dock，且不丢失计划状态。
- sidebar 与 fullscreen 渲染同一份投影数据，并在执行期间保持实时。
- 模型可以提出多个计划方案；用户可以对比、选择其中一个，所选方案成为当前 `plan/document`。
- 批准 `goal` 模式计划会创建或关联 Goal；计划与 Goal 状态在完成前保持同步。
- 现有紧凑 dock 行为与测试继续通过。

## Risks

- 新增核心 `conversation.sidebar` slot 会触及共享布局代码；改动必须保证没有侧边栏的 host 不受影响。
- 多方案数据会增加会话日志体积；`plan/options` 事件应保持 whole-value 但体积小，并记录大小上限。
- Goal 模式依赖 `dsh-goal` 的单 Goal 限制；在 goal 域支持并行 Goal 之前，并行 Goal 不在范围内。
