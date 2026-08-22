# Agent Note: Conversation user-actions slot

Status: proposed

English | [中文](2026-08-20-conversation-user-actions-slot.zh.md)

## Problem

The conversation chat surface exposes exactly one per-message action slot, `conversation.chat.assistant-actions`, addressed by a finalized assistant `messageId`. User messages have no equivalent extension point: their IconActions row is hard-wired to copy + clock, so a plugin cannot contribute actions addressing a specific user message — the primitives needed for "edit and resend this message", "retry from before this message", or per-message provenance affordances. The historical result was either a dead UI stub (an edit button with no backend) or no surface at all.

## Proposal

Add the symmetric slot in `packages/client/ui-conversation`:

```ts
'conversation.chat.user-actions': {
  kind: 'list'
  scope: 'session'
  owner: UserActionOwnerProps
}
```

```ts
export interface UserActionOwnerProps {
  /** Stable identity carried from the `user/message` event; absent on plain user nodes. */
  messageId?: MessageId | undefined
  /** Engine-owned node seq; the durable fork-addressing currency for user nodes. */
  seq: number
}
```

`UserMessageNodeView` (keys `user` and `steering`) declares the slot as a child and renders it into `MessageIconActions.extraActions`, between the built-in copy and clock controls — the same site discipline as the assistant strip. Two addressing facts fall out of the event grammar and are frozen into the owner type:

- Plain user nodes carry no durable `messageId`; the engine-owned `seq` is the addressing currency (it is also what session forking addresses).
- Admitted steering nodes do carry the `user/message` id, so `messageId` is optional and present only for them.

`UserMessageNodeView` already receives `ChatNodeOwnerProps` from the keyed `conversation.chat.node` seat. This change only adds the child-slot render share; it does not give the user-actions strip `openFile` / `inspectCall` / `forkAt`. Mutation stays with the plugin that consumes the slot.

## Alternatives considered

**Addressing by `messageId` only.** Impossible for plain user nodes, which have none; would force contributors to guess or re-derive seqs.

**A single message-agnostic slot with a `role` field.** Widens every existing contributor's match surface for no current consumer; the assistant strip's "finalized message" invariant would be diluted.

**No slot; ship edit/retry inside dsh core.** The mutation semantics (fork-and-resend) are already composable from `session.fork` + `session.prompt` by an independent plugin; only the render site is missing, and that is exactly what a slot is for.

**Make `renderSlot` optional on `UserMessageNodeView`.** Rejected. The renderer always owns a child site; fixtures and ChatView's keyed dispatcher must pass a typed empty stub, the same way `TurnTailNodeView` already requires `renderSlot` / `renderSlotChain`.

## Acceptance criteria

- A contributed `conversation.chat.user-actions` entry renders inside the user IconActions row, between copy and clock, without importing the conversation implementation.
- A plain user owner is `{ seq }`; an admitted steering owner is `{ messageId, seq }`.
- An empty contributor list renders no extra markup; copy and clock stay.
- An in-flight turn is non-addressable: contributors disable the action rather than hide it silently.
- `pnpm run typecheck` and the focused ui-conversation specs stay green, including ChatView's keyed dispatcher and the MessageItem fixture adapter.

## Risks

The slot is only a render site. A plugin that ignores the in-flight rule can still show a dead edit/retry button; the core does not enforce disablement beyond the documented policy.

Zero contributors must stay byte-identical to today's chrome. Any extra wrapper around an empty list would change snapshot and layout tests that currently assume copy + clock only.

`seq` is durable for forking but not a user-facing identity. Plugins that persist or display it as a message id will break on rewind, fork, and steering admission.
