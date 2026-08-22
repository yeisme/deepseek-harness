# Agent Note: Plan sidebar, fullscreen, multi-option and goal collaboration

Status: proposed

English | [中文](2026-08-19-plan-sidebar-fullscreen-m2.zh.md)

> Superseded on 2026-08-20 by the shared Pane Workbench design documented in
> [Plan dock and Pane workspace information design](../../implemented/feature/2026-08-19-plan-dock-inline-edit-and-visual-polish.md).
> The durable option/task/goal projections and `/plan-select` path remain valid;
> the second `conversation.sidebar` and Plan-owned fullscreen overlay do not.

## Problem

The plan experience is currently limited to a compact dock strip above the composer. The strip can show a title, status, expanded markdown, and a simple inline editor, but it cannot host the richer views needed for multi-option comparison, DAG task progress, goal linkage, or long-form plan review. There is no persistent sidebar surface in the Web client, so there is nowhere to place a Codex-desktop-style plan panel. M2 and M3 cannot proceed on the current surface alone.

## Proposal

Add a plan workspace surface with three presentation modes and the M2 data/UI contracts:

- **Dock**: the existing compact strip remains the always-visible summary.
- **Sidebar**: a right-side plan panel that opens from the dock, stays open while the session is active, supports resize/collapse, and hosts the full plan detail, options, goal, and task views.
- **Fullscreen**: a focused overlay opened from the dock or sidebar for reading, comparing options, and reviewing long plans.

The surface is a pure projection consumer. It reads `plan-document`, `plan-options`, `plan-tasks`, and `goal` projections and sends user actions through commands or a future `remote.plans` namespace. It owns no business state.

### Sidebar slot

The Web client needs a generic, session-scoped sidebar slot. The minimal core change is a new `conversation.sidebar` list slot in `packages/client/ui-conversation`, owned by the conversation layout. The plan plugin registers `PlanSidebar` into it. The slot contract mirrors `conversation.input.dock`:

```ts
'conversation.sidebar': { kind: 'list'; scope: 'session'; owner: ConversationLayout }
```

A host without a sidebar layout renders nothing. A sidebar-capable layout provides collapse, resize, and close affordances; the plan panel does not implement its own layout engine.

If the existing `shell.overlay` from `agent/harness-plugins` Pane Workbench is composed, the plan sidebar can alternatively mount there. The proposal keeps the core slot as the default path because it does not depend on the separate Pane Workbench bundle.

### Fullscreen overlay

`PlanFullscreen` is a product-owned modal/overlay registered by `dsh-client-ui-plan`. It is opened by a dock/sidebar action, rendered above the conversation, and closed with `Esc` or a close button. It uses the same tabs as the sidebar and keeps the projection live, so status and task progress update while open.

### M2 multi-option

Add a durable `plan/options` event and `plan-options` projection:

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

The model can submit options through an extended `exit_plan_mode` `options` parameter or a new `plan_propose_options` tool. The sidebar/fullscreen option tab renders option cards, supports expand/compare, and calls `remote.plans.selectOption` (or `/plan-select` command) to promote the chosen option into a `plan/document`.

### Goal collaboration

Extend `plan/document` with optional `mode` and `goalId` fields:

```ts
mode?: 'linear' | 'goal' | 'dag'
goalId?: string
```

When a plan is approved in `goal` mode, `PlanWorkspaceService` creates a goal through `ctx.goals.create` and appends an updated `plan/document` with `goalId`. The plan sidebar shows the linked goal card with phase, rounds, pause/resume/edit/clear actions. Plan completion calls `ctx.goals.complete`; a blocked goal marks the plan as blocked in the UI.

## Task breakdown

- T1: Add `conversation.sidebar` slot to `packages/client/ui-conversation` and render it in the conversation layout.
- T2: Add `PlanSidebar` component to `packages/client/ui-plan` with dock-to-sidebar open action and collapse/resize behavior.
- T3: Add `PlanFullscreen` overlay with tabs (overview, options, goal, tasks, revisions) and keyboard close.
- T4: Add `plan/options` event, `plan-options` projection, and invariant coverage.
- T5: Add multi-option UI (option cards, compare, select) and a `plan-select` command or `remote.plans.selectOption`.
- T6: Add `mode`/`goalId` to `plan/document`, goal creation on approval, and plan-goal status sync.
- T7: Add component tests for sidebar/fullscreen/options/goal, host tests for new events, and update README/Agent Notes.

## Alternatives considered

### Reuse only the composer dock

The dock is too small for multi-option comparison and long-form review. It stays as the summary entry point, but it is not the workspace.

### Build a plan-specific right panel without a core slot

A plan-only panel would be faster but would create a second layout system and block future tools (tasks, terminal, git) from using the same sidebar. A generic `conversation.sidebar` slot is the smaller long-term surface.

### Add a third-party layout library

A heavy layout library is unnecessary for one resizable sidebar and one overlay. The existing DSH layout tokens and a simple split/overlay component are sufficient.

## Acceptance criteria

- A user can open the plan from the dock into a right sidebar and into fullscreen, then return to the dock without losing plan state.
- The sidebar and fullscreen render the same projection data and stay live during execution.
- The model can propose multiple plan options; the user can compare, select one, and the selected option becomes the current `plan/document`.
- Approving a `goal`-mode plan creates or links a goal; plan and goal statuses stay synchronized through completion.
- Existing compact dock behavior and tests continue to pass.

## Risks

- Adding a core `conversation.sidebar` slot touches shared layout code; the change must keep hosts without a sidebar unaffected.
- Multi-option data increases session log size; the `plan/options` event should remain whole-value but small, with a documented size cap.
- Goal mode depends on the single-goal limitation of `dsh-goal`; parallel goals are out of scope until the goal domain supports them.
