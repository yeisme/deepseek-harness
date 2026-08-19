# Agent Note: Standing-Scope Composition Projection for Agent Presets

Status: proposed

English | [中文](2026-08-14-agent-composition-preview-projection.zh.md)

## Problem

A preset decides a session's entire model-facing surface, but before this change the only proof of "what does this preset actually mount" was creating a session: the roster's health check proved shape only, `trust` was display-only, and a copied preset had no lineage, so drift was invisible. The root `agent-composition-preview-v1` handoff froze the split owner: composition facts are DSH's to project; risk, maturity, qualification, and receipts are Ordo's.

## Proposal

`@deepseek-ai/dsh-agent-composition-preview` projects a preset by reusing the cold-read machinery: `standingFactsFor(id)` (the read-side identity added behind `standingKeyFor`) ensures the standing mount and returns its scope key, composition-file stamp, and generation. The projection then reads the registries through that scope key — `tools.schemas(key)`/`tools.sources(key)`, `systemPrompt.assemble({scope: key})`/`sectionSources(key)`, `sessionProjections.attributions()` — with no agent, session, or turn, and emits digested facts (`dsh.composition.preview.v0`) plus a redacted smoke report.

### Standing-scope read openings

The registries could already be ADDRESSED by a scope key (schemas, assemble, cold presenter reads) but could not say WHICH LAYER supplied an entry, so attribution would have been set-subtraction guesswork that misses scoped shadows. Three minimal additive read openings close that: `ToolRuntime.sources()` (built inside `view()`'s existing walk: global → scoped shadowing → reserved Code Mode `transport`), `SystemPrompt.sectionSources()` (the same nearest-wins rule as the assembly's shadow merge), and `SessionProjectionRegistry.attributions()` (per-registrant scope bookkeeping beside the existing ref count; a key maps to the set of scopes holding it, an absent scope meaning a context-global registrant). All three are read-only, keyed exactly like their sibling views, and covered by focused tests including disposal.

### Digest normalization

Tool digests are SHA-256 over a canonical JSON of `{name, description, parameters}`; section digests hash the resolved text; `capability_digest` hashes the canonical composition section. Canonical JSON sorts object keys ascending (code-unit order), keeps arrays in order, and emits no whitespace — implemented in the package (`digest.ts`) because no shared canonicalizer existed, and pinned by a fixed-vector test so any change to the rule or the digested fields is a deliberate digest break. Failure reasons are path-redacted at the service boundary: the envelope crosses to pickers and machine consumers, and a host path is a fact about the machine, not the composition.

### Lineage and drift

`copy()` writes a service-generated `lineage.yml` (`dsh.preset_lineage.v0`) freezing the source id, the source's composition-TEXT digest at copy time, and the copy timestamp; it overwrites whatever the directory copy carried so a copy of a copy points at its own source. Drift compares that frozen digest against BOTH sides' current composition texts — `none` while both match, `diverged` once either edits, `unknown` when lineage is absent, malformed, or the source is gone. The design draft compared mount-level `capability_digest`; the text digest was chosen instead because it is computable inside `dsh-agent-presets` at copy time (no service-ordering dependency), detects edits that mount identically, and stays meaningful before any mount exists. Drift is reported, never repaired.

### CLI

`dsh composition preview|smoke` boots the REAL web profile through `runProfile` with the web app's own `--port 0` and an inline overlay silencing the URL line, so stdout carries exactly one envelope. App rows must activate (the boot audit rejects a tree whose rows wait forever), so "dormant app" booting was rejected; an ephemeral OS-assigned port keeps the one-shot off every fixed port. Smoke warms the standing mount before its residue window — a mount is legitimate shared state until whole-tree teardown, not residue — so `residue: 'detected'` indicts the projection read itself.

## Alternatives considered

**Project from the roster's file text alone.** Rejected: file shape is not mount truth; unscoped-target, unusable-row, and root-realm refusals only happen at mount, which is exactly the proof the picker lacks.

**Infer attribution by comparing scope and global views.** Rejected: a scoped tool shadowing a global name is indistinguishable by set subtraction; the registries' own layers are the only authority.

**Compute mount-level digests in lineage.** Rejected: it would couple `dsh-agent-presets` to the projection service for a fact the composition text already pins deterministically.

**A dedicated profile for the CLI command.** Rejected: the roster ships in the web-app bundle; a parallel composition would be a second answer to "what does this deployment mount". Booting the real profile is the same machine a session gets.

## Acceptance criteria

- Projection digests equal what a joined agent on the same preset sees (focused cross-check against `schemas(agent)` and `assemble(agent)`).
- Broken presets refuse with typed `composition_invalid` and path-redacted reasons; unknown ids propagate the roster error.
- `smoke` reports `residue: 'none'` on a clean read and `detected` when a section evaluation smuggles a global registration (focused negative test).
- The built bin prints exactly one envelope on stdout and exits 1 on refusal; verified against the real web profile (`composition.e2e.ts` plus manual built-bin runs).
- No risk, maturity, or qualification field ever appears in a DSH envelope.

## Risks

**The envelope can be mistaken for a qualification.** Ordo owns risk/maturity/receipts; the README and cookbook state the boundary, and the smoke report deliberately carries no classification fields.

**Attribution seams grow the registries' public surface.** Each is one read method keyed like its sibling view; if a future consumer needs richer attribution (plugin identity), that is a new decision with its own evidence.

**The picker panel is not shipped yet.** The client-safe envelope types land in `./types` now; rendering them is the next slice and must keep the maturity slot owner-injected or hidden.
