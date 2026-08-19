# Agent composition preview: projecting a preset before a session exists

English | [中文](agent-composition-preview.zh.md)

A preset decides a session's whole model-facing surface, but before composition preview (the `dsh-agent-composition-preview` package, now under `agent/harness-plugins`) the only way to learn what a preset mounts was to create a session. The `AgentCompositionPreview` service answers the picker's three questions with no agent, no session, and no turn: what does this preset actually mount, how healthy is it, and has a copy drifted from its source.

## Reading a projection

```sh
dsh composition preview --preset standard --json
dsh composition smoke --preset minimal
```

`preview` prints exactly one `dsh.composition.preview.v0` envelope on stdout; `smoke` prints the redacted `dsh.composition.smoke.v0` report and exits nonzero when the projection left any global registration behind. Both boot the real web profile, never call a model, and cost no tokens. Machine consumers (an Ordo `agent preview` adapter) validate the envelope fields and treat exit 1 as a refusal, never as an empty composition.

Inside a host composition, the same facts come from the service:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-composition-preview'  // loads the ctx.get typing

export const inject = ['agentCompositionPreview']

export async function apply(ctx: Context) {
  const preview = ctx.get('agentCompositionPreview')
  if (preview === undefined) return
  const projection = await preview.project('standard')
  // projection.composition.tools: [{ name, schema_digest, source: 'preset' | 'global' | 'transport' }]
  // projection.health.provable_mount_ref: 'standing:standard:1'
}
```

## What the projection guarantees

- **Mount-level, not shape-level.** `shape_ok` is the roster's discovery check; `mount_ok` means the standing mount really composed. `provable_mount_ref` names the mount that answered, and a broken or unmountable preset is a typed `composition_invalid` refusal, not a projection with flags flipped off.
- **Digests, never bodies.** Tool schemas and section text never leave the service; the envelope carries SHA-256 digests over canonical JSON (sorted keys, no whitespace), and failure reasons are path-redacted.
- **Attribution, not guesswork.** Each tool, section, and projection unit names the layer that supplied it (`preset`, `global`, or the Code Mode `transport`), read from the registries' own attribution seams — never inferred by set subtraction.
- **Drift is reported, never repaired.** Copies carry a service-written `lineage.yml`; `none` / `diverged` / `unknown` compare the frozen digest against both sides' current composition texts, and an unanswerable comparison reads `unknown`.

## What the projection does not decide

Risk, maturity, qualification, and receipts are Ordo owner fields (split-owner handoff: the root `openspec/changes/agent-composition-preview-v1/` change). A smoke pass proves mount + projection + cleanup in this process; it does not qualify an agent composition, and no DSH surface may present it as one.
