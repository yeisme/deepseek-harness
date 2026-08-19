# Agent Note: `omdsh` CLI entry and first runnable DSH TUI shell

Status: implemented

English | [中文](2026-08-16-omdsh-cli-tui-entry.zh.md)

## Problem

The renderer-neutral TUI runtime had deterministic state transitions and plugin capability types, but a user could not start it from the product command. The old `dsh --profile tui` example referred to a profile that was not shipped in this tree, so the first-use path was neither honest nor executable.

## Decision

`dsh tui` is now a first-class launcher mode, and `dsh --profile tui` resolves to the same mode without requiring a profile directory. The package publishes an `omdsh` bin alias; the launcher normalizes that executable name to `dsh tui` before parsing, so shell aliases and package-manager shims share one grammar.

The CLI owns only the terminal boundary. `apps/cli/src/tui.ts` creates a `TuiController`, renders semantic frames from `@deepseek-ai/dsh-tui-runtime`, and keeps raw-mode, alternate-screen, cursor, and listener cleanup inside a `try`-equivalent exit path. Input handling is intentionally small: printable text edits the composer, `Enter` submits, `Ctrl+C` interrupts or exits when idle, `Ctrl+G` detaches, and colon commands cover help, mode, clear, reattach, and quit.

The shipped service adapter is an explicit in-process loopback behind `--demo`. It emits the same structural `session.status` and `session.event` notifications as the runtime boundary, so event cursor, local-echo reconciliation, receipts, rendering, and interruption can be exercised without credentials or an external model. A real DSH IPC/service adapter remains a separate follow-up seam; `--patch` is parsed but rejected until that adapter can apply overlays honestly.

Non-TTY invocations print stable help or a deterministic frame. `--once` is the scriptable smoke path, while interactive TTYs use the raw keypress loop and the semantic renderer. This keeps the terminal shell thin and leaves the state machine testable without raw mode.

## Alternatives considered

- **Boot a nonexistent `tui` profile:** rejected because a documented command must work on a clean checkout and profile initialization would hide the actual service boundary.
- **Connect the TUI directly to a provider or read credentials in the CLI:** rejected because the client must consume a DSH service contract and must not become the owner of provider orchestration or secret persistence.
- **Make `omdsh` a shell-only alias:** rejected because a package `bin` alias is portable across npm, pnpm, and direct installs and can be tested as argv normalization.
- **Put business behavior in the keypress loop:** rejected because `update` and `render` remain the deterministic runtime contract; the loop only maps terminal events to semantic events and executes effects through the controller.

## Consequences

`dsh tui --demo`, `omdsh --demo`, and `omdsh --demo --once "hello"` are now usable local entry points. The package has a stable shortcut grammar and command tests for launcher normalization, TUI flags, colon commands, one-shot output, and the service-unavailable failure path. The next implementation slice can replace only `TuiServicePort` at the CLI boundary and leave the interaction model, plugin registry, renderer-neutral state, and smoke commands intact.
