# dsh-agent-composition-preview

English | [中文](README.zh.md)

Read-only, mount-level projection of one agent preset's composition facts. A preset decides everything a session's model sees — which tools, which prompt sections, which projection units, what permission tier — but that answer used to exist only once a session existed. This package answers it with **no agent, no session, and no turn**: it ensures the preset's standing mount (the same `standingKeyFor` cold reads use), reads the `dsh-tools` / `dsh-system-prompt` / `dsh-session-projection` registries through that scope key, and emits digested facts with three-layer health and copy-lineage drift.

Facts only. Risk classification, maturity, qualification, and receipts belong to the Ordo owner (split-owner handoff: the root repository's `openspec/changes/agent-composition-preview-v1/` change); this package neither computes nor implies them.

## Service: `AgentCompositionPreview` (ctx key: `agentCompositionPreview`)

- `ctx.agentCompositionPreview.project(id?): Promise<CompositionProjection>` Resolve a preset (the roster's default when `id` is omitted), ensure its standing mount, and project its composition facts. Throws `CompositionInvalidError` (`code: 'composition_invalid'`, path-redacted `reason`) when the preset is broken or its composition cannot mount; the roster's `UnknownPresetError` propagates unchanged for an unknown id.
- `ctx.agentCompositionPreview.smoke(id?): Promise<SmokeReport>` The same projection plus a cleanup verdict: `residue` compares the process's global registry surface (globally visible tool names, section names, projection-unit keys, provided service names) before and after. The standing mount is warmed first — a mount is legitimate shared state, not residue — so `residue: 'detected'` means the projection READ itself left a registration behind.

The service is pure read: no subscription, no durable write, no per-call registration. Every call re-reads the roster, so a preset authored, edited, or deleted while the process runs is answered by the next call.

## Envelope: `dsh.composition.preview.v0`

```yaml
schema: dsh.composition.preview.v0
preset:
  id: standard
  trust: system                    # from the root the preset was discovered under
  composition_stamp: { mtime_ms: 0, size: 0 }
  generation: 1                    # which mount of this id, from 1, in this process
health:
  shape_ok: true                   # discovery parsed a named-row composition
  mount_ok: true                   # the standing mount composed with no agent
  provable_mount_ref: standing:standard:1
drift:                             # how a copy relates to its source
  state: none | unknown | diverged
  source_id: standard              # present when lineage was read
  source_digest: <sha256>          # the source's composition digest at copy time
  copy_digest: <sha256>            # present when the copy's text was readable
composition:
  tools:
    - name: bash
      schema_digest: <sha256>      # canonical JSON of {name, description, parameters}
      source: preset | global | transport
  prompt_sections:
    - id: preset:alpha
      section_digest: <sha256>     # the section's resolved text
      source: preset | global
  projection_units:
    - key: permissions
      source: preset | global      # units only other scopes registered are omitted
  permissions:
    sandbox_mode: workspace-write  # or unknown_reason — never defaulted
    approval_policy: ask
    contrib_source: host           # permission knobs are host-plane facts
capability_digest: <sha256>        # canonical JSON of the composition section
generated_at: <ISO-8601 UTC>
```

Digests use canonical JSON (object keys sorted ascending, no whitespace) pinned by a fixed-vector test; changing the canonicalization or the digested fields is a deliberate decision that changes every digest. Failure reasons are path-redacted: the envelope crosses to pickers and machine consumers, and a host path is a fact about the machine, not the composition.

`dsh.composition.smoke.v0` carries the redacted summary — preset, health, counts, `permissions_known`, drift, `capability_digest`, `residue`, `elapsed_ms` — and no schema bodies, section text, prompts, or host paths.

## CLI

`dsh composition preview --preset <id> --json` and `dsh composition smoke --preset <id> --json` boot the real web profile (the in-box profile composing the roster), project, print exactly one envelope on stdout, and exit; see [`apps/cli`](../../../apps/cli/README.md). Exit 0 for a successful projection (and, for smoke, a clean residue); 1 for any refusal, failure, or detected residue. Machine consumers validate the envelope against the fields above.

## Lineage and drift

`dsh-agent-presets`' `copy()` writes a `lineage.yml` beside the copy's composition (`dsh.preset_lineage.v0`: `source_id`, the source's composition-text digest at copy time, `copied_at`). Drift compares the frozen digest against both sides' current composition texts: `none` while copy and source both match it, `diverged` once either edits, and `unknown` when there is no lineage, the source is gone, or either text is unreadable — an unanswerable question is never reported as a match. Drift is reported, never repaired.

## Config

None. The service injects `agentPresets`, `tools`, and `systemPrompt`; `sessionProjections`, `shell`, and `approval` are optional reads the projection degrades around (units omitted, permissions `unknown_reason`).

## Model Experience

No effect on any model request: the service mounts no model-visible rows, adds no session events, and is never part of a session's composition. It reads the same standing mounts sessions share.

## Known Limitations and Deferred Work

- The preset picker's read-only Preview panel and the `ToolView` display contract are deferred to the client slice (`dsh-agent-composition-preview-v1` task 3.x): the envelope types ship client-safe in `./types`, but no browser surface renders them yet.
- The session-projection registry serves every registered unit to every session, process-wide; the envelope therefore reports the preset's own and the context-global units, and a unit registered only by ANOTHER preset is omitted rather than attributed. Per-session unit scoping would be a `dsh-session-projection` change.
- A model-visible `agent_preview` tool is retain-next: if implemented, it must satisfy model-visible ⟺ logged and add a session event.
- Risk, maturity, and qualification are Ordo owner fields and will never appear in this envelope.
