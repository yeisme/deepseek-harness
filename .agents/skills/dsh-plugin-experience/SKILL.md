---
name: dsh-plugin-experience
description: Use when creating or reviewing a DeepSeek Harness plugin that adds a Web client module, profile bundle, sidebar panel, Conversation Node, ToolView, settings surface, or accessible operational UI.
---

# DSH Plugin Experience

This skill is guidance for composing DSH UI from official plugin seams. It does not authorize a core fork, a browser-side domain store, or an arbitrary iframe bridge.

## Package faces

Treat the contribution as a complete capability seam:

- **Host face:** Cordis services, events, commands, tools, settings, transport, and disposal.
- **Client face:** `dsh.client` bundle, reviewed slot or Conversation Node, typed render state, focus management, and localized visible strings.
- **Composition face:** profile/bundle patch, dependency declarations, build exports, compatibility metadata, and install/remove behavior.
- **Observation face:** ToolView or session/event rendering for one operation; it must show the authoritative result, not a client-generated success.

The package README owns configuration and runtime semantics. The client module owns layout and interaction. The host service owns transport and authorization. Keep these responsibilities separate.

## Design workflow

1. State the user task and the owner of each fact. Put tenant, run, asset, approval, and receipt state behind the owning service; let the UI own only layout, selection, viewport, and ephemeral dialog state.
2. Select the narrowest official seam. Use a Conversation Node for durable conversation entries, a reviewed client slot for a persistent panel, ToolView for one tool call, and `ctx.commands` for a human action that does not need a model turn.
3. Define the UI states before the components: ready, running, attention required, approval required, stale, offline, permission denied, contract mismatch, unknown, and reconcile required. Every state needs text, an accessible name, and an allowed-action decision.
4. Keep the host boundary typed. The browser receives safe refs, bounded summaries, versions, freshness, evidence refs, and server-authored action descriptors. It does not receive cookies, generic tokens, raw URLs, filesystem paths, or arbitrary fetch functions.
5. Make loading and teardown symmetric. A client bundle must tolerate unload/HMR; remove event listeners, timers, pending requests, DOM effects, and focus traps before the fiber settles.
6. Test the assembled path. Add a package test for pure state/render behavior, a host test for lifecycle and redaction, and a Web/profile test for the real Loader composition. Add a snapshot when the model-visible or user-visible transcript changes.
7. Document how to install, configure, inspect, remove, and validate the plugin. Use real commands and link to the owning package or OpenSpec; do not put a temporary design checklist in a README.

## UI acceptance rules

- Tenant/workspace context remains visible or discoverable on every operational view.
- Color is never the only status signal. Keyboard navigation, focus return, screen-reader labels, reduced motion, narrow layout, and error recovery are first-class states.
- A stale or unknown view never enables an action merely because a button was previously enabled.
- A deep link to Workbench is navigation only. The destination revalidates tenant, principal, installation, resource version, and permission.
- Large DAGs and event feeds use pagination, coalescing, or virtualization. The first paint does not fetch complete logs or evidence.

## Validation commands

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run doc-sync
pnpm run verify-skill-invocation-metadata
git diff --check
```

When a paired document changes, also run the scoped pairing command documented in `docs/i18n/README.md`. Never claim a UI behavior is verified from a hand-mounted component alone when profile or browser composition can fail.
