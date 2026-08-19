# @deepseek-ai/dsh-tui-runtime

English | [中文](README.zh.md)

`@deepseek-ai/dsh-tui-runtime` is the renderer-independent state machine for DSH terminal clients. It consumes normalized service notifications, emits explicit prompt/cancel/replay effects, and produces semantic rows that a Pi, OMP, or test renderer can draw. The package does not enter raw terminal mode, own durable session state, or parse provider payloads beyond the notification adapter.

## Runtime contract

`createTuiState()` creates a session-scoped state. `update(state, event)` is deterministic and returns a new state plus effects. `TuiController` serializes those effects through an injected service port and applies prompt receipts or replay results. `reduceHarnessNotification()` adapts the existing DSH SDK notification shape. `render(state, width, height)` returns ANSI-free rows and truncation metadata for a renderer.

`TuiPluginRegistry` accepts trusted renderer-neutral command and panel contributions. Every contribution is namespaced by its plugin id, and registration returns an idempotent disposer for HMR and shell teardown.

## Model Experience

### TUI state projection

#### What the model sees

Nothing. The renderer consumes `TuiState` and `render(...)` rows for a human client; this package never assembles or sends model prompts.

#### Token effect

None; state transitions and semantic rows do not add model-visible input.

#### KV Cache effect

None; the package does not call a provider or mutate a model context.

## Known Limitations and Deferred Work

- The package does not include a Pi/OMP renderer or terminal lifecycle adapter.
- Replay effects require a service endpoint that can return events from a durable sequence.
- Plugin panels currently contribute stable text rows; interactive panel actions remain a later command-router slice.
