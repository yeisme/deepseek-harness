# Agent Note: session.forkBeforeMessage

Status: proposed

English | [中文](2026-08-22-session-fork-before-message.zh.md)

## Problem

`session.fork` only cuts at a completed `turn/end` at or after an anchor. The first user message has no prior completed turn, so Edit/Retry plugins cannot create a child that excludes that message. Using the existing fork would either fail with `fork-unavailable` or keep the original first-round answer in the seed.

## Proposal

Add additive RPC `session.forkBeforeMessage`:

```ts
request: { sessionId: SessionId; atMessageSeq: number }
response: { sessionId: SessionId }
```

Semantics:

- Locate the event with `seq === atMessageSeq`.
- Seed the child with the last completed `turn/end` strictly before that seq.
- If there is no prior `turn/end`, create a `seedLength: 0` child.
- Inherit cwd, `parentSession`, composition, and workspace attachment exactly as `session.fork` does.
- Unknown seqs fail with `fork-unavailable`; they must not clip to an arbitrary earlier turn.

Clients keep sending the edited or retried prompt through existing `session.prompt`. The new RPC is only the fork primitive.

## Alternatives considered

**Extend `session.fork` with `atSeq: 'before-message'`.** Rejected. It would overload a completed-turn cut with a before-message cut and change an existing method's meaning.

**A combined `session.rewriteAt` that forks and prompts.** Rejected. Prompt admission, attachments, and slash commands already belong to `session.prompt`; coupling them into fork would duplicate send policy.

**Create a brand-new empty session without lineage.** Rejected. First-round rewrite still needs `parentSession`, cwd, and workspace attachment so the child remains a branch of the source.

## Acceptance criteria

- First-round `atMessageSeq` produces a child with `seedLength: 0`, inherited cwd/parentSession, and workspace attach.
- A later message cuts at the last completed turn before that seq and excludes the addressed message.
- Unknown seq returns `fork-unavailable`.
- Existing `session.fork` behavior is unchanged.
- Focused host and client specs stay green.

## Risks

An empty first-round child is blank until the plugin prompts. UIs that treat blank children as disposable drafts must not delete a rewrite branch before the prompt lands.

The RPC is additive. Older clients ignore it; newer plugins must probe before calling it.
