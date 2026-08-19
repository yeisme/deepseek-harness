# Agent Note: Inactive Plan entry control in the Web composer

Status: implemented

English | [中文](2026-08-15-ui-plan-inactive-entry-control.zh.md)

## Problem

The Web composer only exposed Plan mode through the shared `/plan` slash command or the `+` Command menu. A session with the plan capability but inactive mode had no direct tool-row affordance, so entering plan mode was one extra discovery step and the existing `chip.off.*` locale keys were unused.

## Decision

`@deepseek-ai/dsh-client-ui-plan` now renders a neutral "Plan" entry chip whenever the host-computed `plan` projection is present and its effective target is the steady default mode (`active: false, pending: false`). Clicking it executes `/plan` through the same `remote.commands.execute` channel as the existing active chip. The active warn chip is unchanged; a pending exit (`active: true, pending: true`) still leaves the seat empty so a user cannot fight an in-flight `/plan off`.

The injected face gains `enterPlanMode` beside `exitPlanMode`; both fold admission/transport failures into a user-visible failure line. The inactive control reuses the neutral composer chip chrome (`--dsw-alias-label-secondary` / `--dsw-alias-interactive-bg-hover`) and keeps the existing locale keys.

## Testing

- Component tests cover absent capability, steady inactive, pending-entry, active, pending-exit, single-click admission, locked state, failure visibility, and unmount safety for both entry and exit.
- Browser-plugin tests cover the injected `/plan` and `/plan off` faces, business failure folding, and teardown.
- Web snapshots updated to include the inactive Plan control in every steady composer state.

## Alternatives considered

**Keep entry only in the slash command menu.** Rejected because the locale keys and the single seat already anticipated a direct control, and a visible entry chip removes the discovery cost without adding client-side plan state.

**Render an inactive control during a pending exit.** Rejected because the user already requested `/plan off`; an extra control would fight the in-flight switch.

## Consequences

- Users can enter plan mode directly from the composer tool row.
- The seat still renders no control when plan capability is absent, in a Draft, or during a pending exit.
- No plan state or command semantics change; the host `/plan` command remains the single write path.
