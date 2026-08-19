# Agent Note: Ordo Agent Ops compact consumer is owner-gated

Status: implemented

English | [中文](2026-08-14-ordo-agent-ops-compact-consumer.zh.md)

## Problem

DSH needs a local, in-context Agent Ops entry point while Ordo's canonical snapshot and event owner contract is still outside this subproject. A browser-only projection or a locally invented run state would create a second scheduler truth and could make an unavailable owner look healthy.

## Decision

The DSH slice is split into two replaceable consumers:

- `packages/host/ordo-agent-ops` exposes one read-only `ordoAgentOps/snapshot` Remote. It reads an optional `ordoAgentOpsOwner` source and otherwise returns a safe `needs_contract` snapshot with no run, lease, worktree, capacity, or evidence facts.
- `packages/client/ui-ordo-agent-ops` registers a compact sidebar action. Its controller keeps one in-flight read, advances a generation on reset/disposal, and ignores late answers. The browser receives only the typed safe projection; the Workbench button stays disabled until a re-authenticated deep-link contract exists.

The Host package does not connect to Ordo, inspect processes, reserve capacity, launch runtimes, or dispatch actions. Event cursors, tenant authorization, owner receipts, ToolView, and reconciliation remain external owner handoffs.

## Alternatives considered

- **Invent a local Ordo snapshot** — rejected because DSH would become a second owner of run, lease, or capacity state.
- **Call Ordo directly from the browser** — rejected because credentials, audience, tenant authorization, and redaction belong at the Host/control-plane boundary.
- **Show a successful empty state** — rejected because an absent owner contract is not evidence that a run is healthy or that capacity is available.

## Evidence

Focused Host typecheck and gateway tests pass. The Client package passes its focused typecheck, controller/browser tests, and `build:lib:client`. This is implemented plus focused/local and browser/consumer evidence only; it is not Ordo provider, deployment, cloud Agent, or production evidence.

## Consequences

- DSH has a real installable Host/Client seam and a truthful browser fallback while the owner contract is absent.
- The panel cannot answer run, event, approval, reconcile, or launch questions until Ordo and Harness Control Plane publish their typed owner contracts.
- The remaining work is additive: mount an owner source and extend the Remote contract without moving canonical state into DSH.
