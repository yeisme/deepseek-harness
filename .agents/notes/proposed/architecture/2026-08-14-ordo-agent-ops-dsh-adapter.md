# Agent Note: Keep Ordo Agent Ops as a DSH adapter

Status: proposed

English | [中文](2026-08-14-ordo-agent-ops-dsh-adapter.zh.md)

## Problem

DeepSeek Harness needs an enterprise Agent Operations view for Ordo-backed runs, but DSH does not own Ordo scheduling, writer leases, durable reservations, approvals, verification, or domain receipts. Putting those facts into a DSH plugin would create a second state owner and would make a single DSH process look like a multi-tenant control plane.

## Proposal

The DSH implementation stays in the Ordo Agent Ops OpenSpec (relocated with the plugin to `agent/harness-plugins/openspec/changes/ordo-dsh-plugin-visualization-v1/`). It provides a Cordis host plugin, typed client service, Web client module, profile/bundle composition, and ToolView presentation. The host binds one runtime generation to one tenant, workspace, and runtime subject; the browser consumes safe projections; Ordo remains the source of run, task, session, runtime, lease, worktree, approval, verification, evidence, and closeout facts.

The first DSH slice is read-only snapshot, cursor-based events, attention/approval display, and owner-authored reconciliation. Launch, cancel, redispatch, takeover, and durable capacity reservation remain disabled until Ordo supplies their authoritative contracts.

## Alternatives considered

**Make DSH the Agent Operations owner.** Rejected: DSH session events and plugin lifecycle do not replace Ordo's DAG, lease, worktree, verification, or reservation authority.

**Put the full Studio in DSH Web.** Rejected: DSH is a single-tenant Harness runtime; full multi-tenant navigation, installation management, and cross-run operations belong to Workbench.

**Let the browser call Ordo directly.** Rejected: the browser cannot own tenant authorization, audience-scoped credentials, cursor lifecycle, or redaction. The host or BFF must return typed safe projections.

**Open launch and redispatch in the first plugin slice.** Rejected: the current Ordo capacity projection is read-only and does not create durable reservations or prove process liveness. Unknown outcomes would permit duplicate writers.

**Wait for the owner event contract before any cursor logic.** Rejected for the snapshot axis: the browser controller already consumes versioned whole snapshots, so it tracks a snapshot-axis cursor over `snapshotRef`/`snapshotVersion` — duplicates are ignored idempotently, a ref rotation or version regression fails closed without facts, and the next read re-establishes the cursor from a fresh authoritative snapshot. Event-sequence cursors and gap detection still wait for the owner event contract, because only the owner can distinguish a legitimate stream rotation from a rollback.

## Acceptance criteria

- DSH packages use official Cordis plugin, `dsh.client`, profile/bundle, command, tool, and ToolView extension points.
- Tenant/workspace/runtime context changes clear subscriptions, cursors, cache, selections, and pending actions before loading the new context.
- Snapshot and event consumers fail closed on gaps, stale cursors, contract drift, membership revocation, and runtime generation changes.
- Unknown, partial, and cancel-unknown outcomes require reconciliation and never trigger automatic retry or replacement writer dispatch.
- Browser projections exclude credentials, generic bearer tokens, raw prompts, provider payloads, private tool arguments, absolute host paths, PIDs, and full reasoning.
- Package, profile, Web, accessibility, redaction, and disposal tests exercise the assembled entry path.

## Risks

**The DSH panel can be mistaken for a scheduler.** Keep the UI action list server-authored and show owner, receipt, freshness, and blocker state on every operational card.

**The shared contract can drift between DSH and Workbench.** Keep the action, receipt, reason-code, and safe-projection fixtures in the owner contracts and run conformance tests from both hosts.

**A future DSH runtime may be shared by multiple users.** Do not relax the one-tenant invariant until the host proves per-session authorization, storage isolation, credential isolation, and lifecycle teardown in a separate architecture decision.
