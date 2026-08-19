# Agent Note: Web trace visual distinction and category filtering

Status: implemented

## Problem

In the dsh web GUI, Think rows and tool rows used nearly identical neutral chrome, and the trajectory ledger only had free-text search. Users could not visually tell a reasoning step from a read/write/MCP call, nor filter a long history to the moments they cared about (e.g. when a workspace write happened or an MCP tool was called).

## Decision

- `ReasoningRow` now has a blue-tinted header with a stronger "Think" title, so reasoning is distinct from tool rows.
- `ToolRow` now emits `data-category` (`read`, `write`, `shell`, `web`, `mcp`, or the row variant). CSS tints reads green, writes amber, web/MCP blue/violet, and keeps shell rows neutral.
- The trajectory ledger reuses the same category model. Tool/subtool cells carry `toolName` through `TrajectoryCellProps`, and the toolbar gains multi-select category filters (All/Think/Read/Write/Shell/Web/MCP/Other). Category selection combines with existing search (intersection) and feeds the same ledger filtering / timeline dimming path used by search.
- Trajectory tool tags use category colors so the official trace view is scannable at a glance.

## Testing

- `TrajectoryView` tests cover toggling Read, Write, and MCP filters (single, combined, and clear-all).
- `ToolRow` tests assert `data-category` for MCP, web, and read rows.
- Existing trajectory/table, tool-row, and reasoning-row focused suites pass.
- Web trajectory pane snapshot updated for the new filter group.

## Alternatives considered

**Single-select dropdown filter.** Rejected because multi-select toggles let users compare read+write or web+MCP in one view without repeated trips.

**Put the classification in `ui-tool` and import it from `ui-trajectory`.** Rejected to avoid a new cross-package dependency; each package keeps a tiny local category map while sharing the same `mcp__` naming rule.

## Consequences

- Users can visually separate Think from tool calls and filter the trajectory by operation class.
- No session/event/log schema changed; the UI derives categories from existing wire tool names and record data.
