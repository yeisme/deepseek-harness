# Agent Note: Renderer-independent TUI runtime vertical slice

Status: implemented

English | [中文](2026-08-16-tui-runtime-vertical-slice.zh.md)

## Problem

The first DSH TUI client needs a testable interaction core before a terminal renderer can own raw mode, alternate-screen cleanup, or key decoding. Existing SDK notifications already carry session status, session events, and subagent lifecycle facts, but no client package turns those facts into queue/steer input, replay effects, semantic rows, and disposable plugin contributions.

## Decision

The repository ships `@deepseek-ai/dsh-tui-runtime` under `packages/tui/runtime`. Its `update(state, event)` transition is pure and returns immutable state plus explicit `send-prompt`, `cancel-run`, and `request-replay` effects. `reduceHarnessNotification()` adapts the existing structural SDK notification format at the wire boundary and ignores malformed or unrelated sessions.

The runtime tracks prompt receipts, queue versus steer mode, connection recovery, durable event cursors, event gaps, detached unread counts, and replay completion. It normalizes only user, assistant, tool, and error text into `TuiBlock`; provider payloads do not cross into renderer rows. `render(state, width, height)` returns ANSI-free semantic rows and truncation metadata, keeping terminal lifecycle and Pi/OMP APIs outside this package.

`TuiController` is the stateful shell around the transition function. It accepts the existing SDK notification structure, serializes injected prompt/cancel/replay service calls, applies receipts and replay results, and converts service failures into a user-visible notice. Disposing the controller stops future effects and releases listeners.

`TuiPluginRegistry` owns trusted renderer-neutral command and panel contributions. Plugin ids namespace their commands and panels, duplicate ids fail at registration, snapshots are sorted and copied, and each registration returns an idempotent disposer for teardown and HMR.

## Alternatives considered

**Embedding the state machine in a Pi renderer** was rejected because raw-mode lifecycle, drawing, and service behavior would become one untestable loop and would prevent an OMP or headless renderer from consuming the same interaction contract.

**Adding a second TUI-specific service protocol** was rejected because the existing SDK JSON-RPC notification types already provide the session and subagent facts; this slice adds a client projection without duplicating Host ownership or durable state.

**Accepting arbitrary plugin render callbacks** was rejected because callbacks would couple plugins to terminal libraries and make replay/snapshot behavior renderer-dependent. The first registry exposes namespaced data contributions; interactive command routing remains a later extension.

## Consequences

The first vertical slice is usable from unit tests and can be consumed by a future Pi adapter without changing its state model. Replay effects are explicit but require the next service endpoint to answer a cursor request. The package does not start a service, open a socket, load untrusted plugins, or enter terminal raw mode; those responsibilities remain in the service and app slices described by the [TUI delivery DAG](../../proposed/architecture/2026-08-16-tui-service-delivery-dag.md).

The package is TypeScript-only because it owns control-plane state, plugin metadata, and renderer glue; no measured system or distribution boundary requires Go or Rust at this stage. Focused tests cover prompt receipts, steer mode, event-gap replay, deterministic replay ordering, bounded semantic rendering, and disposer cleanup.
