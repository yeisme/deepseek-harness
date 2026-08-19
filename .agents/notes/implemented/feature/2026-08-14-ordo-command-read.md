# Agent Note: Read-only Ordo slash command uses the owner snapshot

Status: implemented

English | [中文](2026-08-14-ordo-command-read.zh.md)

## Problem

The Web profile mounted a read-only Ordo Agent Ops gateway, but an interactive operator had no command-plane entry point for its already-authorized snapshot. Adding a command without preserving that gateway as the sole fact source would risk a second projection, fabricated runtime details, or an action path disguised as a read.

## Decision

`@deepseek-ai/dsh-host-ordo-commands` registers one `/ordo` command only with the existing `commands` runtime and `ordoAgentOps` gateway mounted. `/ordo`, `help`, `status`, and `capacity` render a fixed four-part summary from `ordoAgentOps.snapshot()`; non-readable states expose no run or capacity facts. `preview` returns `needs_contract` until an owner-owned composition-preview source exists.

The parser accepts only the four read forms and a narrow opaque reference token. It rejects empty or undefined values, whitespace-bearing input, paths, URL forms, schemes, control characters, and extra arguments without reflecting unsafe input. The command creates no SessionEventMap member and relies on `dsh-commands` for its ordinary `command/run` and `command/done` lifecycle pair.

The Web bundle mounts the command beside the existing Ordo Agent Ops row. Base and headless profiles remain unchanged.

## Testing

The package test covers parser acceptance and rejection, read-ready and fail-closed state summaries, safe-text suppression, capacity, missing composition preview, registration disposal, the package invariant, command lifecycle, and a Loader-composed Host configuration.

## Alternatives considered

**Read the owner source directly.** Rejected because the Agent Ops gateway already validates expected context and redacts owner data; bypassing it would duplicate an authorization-sensitive read path.

**Add a local preview, scheduler, or cache.** Rejected because none is an owner-authored projection. A truthful `needs_contract` response preserves the future composition owner boundary.

**Mount the command in the base profile.** Rejected because the only current source is Web Host composition, and adding it to defaults would widen the command surface without an owner source.

## Consequences

- Operators can inspect the existing safe snapshot without a model request, provider call, launch, reservation, reconciliation, or ticket parsing.
- The command is deliberately unable to preview composition until the owning service supplies a typed source.
- The package keeps a runtime invariant that the registered command effect and snapshot source coexist, including HMR disposal.
