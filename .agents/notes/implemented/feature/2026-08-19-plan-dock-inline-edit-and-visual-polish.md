# Agent Note: Plan dock and Pane workspace information design

Status: implemented

English | [中文](2026-08-19-plan-dock-inline-edit-and-visual-polish.zh.md)

## Problem

The plan-document dock originally exposed only a compact status line and expandable Markdown. The first contextual Plan Pane solved the space problem but introduced a second product header below the shared Pane toolbar/tab, put the long document before execution progress, rendered task enums such as `IN_PROGRESS`, and provided no pending/error/selected feedback for option selection.

The result was functional but did not match DSH's calm, compact workspace hierarchy.

## Decision

- Keep the dock as the compact summary and inline-edit surface. It shows semantic status color, title, edit/save/cancel, expand/collapse, revision history, and one “open in workspace” action.
- Let the shared Pane Workbench own docking, moving, maximizing, and closing. The production `PlanWorkspaceView` renders no duplicate product header, no second `conversation.sidebar`, and no page-covering fullscreen overlay.
- Order the Pane for execution scanning:
  1. plan status, title, round, and execution mode;
  2. task completion progress and localized task states;
  3. selectable plan options;
  4. plan Markdown;
  5. linked goal;
  6. collapsed revision history.
- Keep cards only for plan options because the card is the interaction. Tasks, plan content, goal, and revisions use one continuous low-border information flow.
- Report option selection as pending, failed, or selected immediately. `/plan-select` remains the durable owner; the client state only explains the in-flight action and clears naturally when a new option set arrives.
- Remove the first Markdown heading when it exactly repeats the persisted plan title.
- Use DSH theme tokens for status semantics, focus-visible outlines, and reduced-motion behavior. Proposed is warning, approved/executing is business accent, completed is success, rejected is error, and superseded stays neutral.
- Persist inline edits through `/plan-edit <json>`. When the current plan is approved/executing/completed, the old document is first marked `superseded` before the new proposed revision is appended.

## Tests

- `packages/client/ui-plan/tests/plan-document-panel.client.spec.tsx` covers the single workspace action, inline editing, successful save, failed save, status, Markdown, and revision history.
- `packages/client/ui-plan/tests/plan-workspace-view.client.spec.tsx` covers duplicate-heading removal, progress-before-document ordering, localized task states, option pending/success/failure, and the revision disclosure.
- `packages/client/ui-plan/tests/plan-pane-view.client.spec.ts` covers provider registration and the open request while leaving layout controls to Pane chrome.
- Focused verification:

  ```bash
  pnpm exec vitest run packages/client/ui-plan/tests/plan-document-panel.client.spec.tsx packages/client/ui-plan/tests/plan-workspace-view.client.spec.tsx packages/client/ui-plan/tests/plan-pane-view.client.spec.ts packages/client/ui-plan/tests/browser-plugin.client.spec.ts packages/client/ui-plan/tests/plan-mode-control.client.spec.tsx
  pnpm exec oxlint packages/client/ui-plan/src/client/PlanSidebar.tsx packages/client/ui-plan/src/client/PlanDocumentPanel.tsx packages/client/ui-plan/src/client/PlanPaneView.tsx packages/client/ui-plan/src/client/index.ts packages/client/ui-plan/src/client/locales.ts packages/client/ui-plan/tests/plan-workspace-view.client.spec.tsx packages/client/ui-plan/tests/plan-document-panel.client.spec.tsx packages/client/ui-plan/tests/browser-plugin.client.spec.ts
  pnpm run build:lib
  DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/plan-review.e2e.ts
  DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/shipped-composition.e2e.ts -t "assembles the shipped Web catalog"
  ```

## Alternatives considered

### Register a second conversation sidebar

Rejected. It would duplicate workspace geometry and prevent Plan, Files, Details, Terminal, and future tools from sharing one Pane contract.

### Keep a Plan-owned fullscreen overlay

Rejected for production. The shared Pane Workbench already owns maximize and restoration. A second overlay would duplicate navigation, focus, and responsive behavior.

### Split overview, options, tasks, and revisions into tabs

Rejected for the first delivery. The main Plan workflow is short enough to scan as one ordered stream, while tabs would hide progress and increase navigation cost. The option grid already adapts when a bottom or wider Pane provides more width.

### Put the Markdown document first

Rejected. During execution, users need status, progress, blockers, and decisions before long-form plan prose.

## Consequences

- Users can understand current execution state before reading the full plan.
- Plan controls no longer compete with the shared Pane chrome.
- Machine enums do not leak into the user interface.
- The dock and Pane remain projection consumers; durable plan, option, task, and goal state stays with their host owners.
- The obsolete `PlanSidebar`, `PlanFullscreen`, and module-level view store were removed; production mounts only `PlanWorkspaceView` through the Pane provider.
- `SESSION_FORMAT_VERSION` remains unchanged; the feature reuses existing plan events and commands.
