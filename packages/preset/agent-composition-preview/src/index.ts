/**
 * Agent composition preview: a read-only, mount-level projection of one agent
 * preset's composition facts.
 *
 * A session's model-facing surface is decided by its preset — which tools,
 * which prompt sections, which projection units, what permission tier — but
 * that answer existed only once a session existed. This service answers it
 * with no agent, no session, and no turn: it ensures the preset's standing
 * mount (the same `standingKeyFor` cold reads use), reads the registries
 * through that scope key, and emits digested facts with three-layer health
 * and copy lineage drift.
 *
 * Facts only. Risk classification, maturity, qualification, and receipts
 * belong to the Ordo owner; this package neither computes nor implies them.
 *
 * @module @deepseek-ai/dsh-agent-composition-preview
 */

import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Context, Service } from '@deepseek-ai/cordis'
import { compositionTextDigest, readPresetLineage } from '@deepseek-ai/dsh-agent-presets'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
// Type-only: resolves the `tools` and `systemPrompt` services this service
// injects, and the optional `shell`, `approval`, and `sessionProjections`
// reads it degrades around, without runtime edges to their packages.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-session-projection'
import { digestOfJson, digestOfText } from './digest.ts'
import type {
  CompositionDrift, CompositionPermissions, CompositionProjection, CompositionSectionFact,
  CompositionToolFact, CompositionUnitFact, SmokeReport,
} from './types.ts'

export { canonicalJson, digestOfJson, digestOfText } from './digest.ts'
export type {
  CompositionDrift, CompositionHealth, CompositionPermissions, CompositionPresetFact,
  CompositionProjection, CompositionSectionFact, CompositionSectionSource, CompositionToolFact,
  CompositionToolSource, CompositionUnitFact, CompositionUnitSource, SmokeReport,
} from './types.ts'

/** Schema string of the {@link CompositionProjection} envelope. */
export const COMPOSITION_PREVIEW_SCHEMA = 'dsh.composition.preview.v0'

/** Schema string of the {@link SmokeReport} envelope. */
export const COMPOSITION_SMOKE_SCHEMA = 'dsh.composition.smoke.v0'

/** A preset exists but its composition cannot be projected. */
export class CompositionInvalidError extends Error {
  /** Stable machine-readable failure code. */
  readonly code = 'composition_invalid'

  constructor(
    /** The preset whose composition failed. */
    readonly presetId: string,
    /** Why it failed, without this package's message prefix. */
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`agent-composition-preview: preset "${presetId}" cannot be projected: ${reason}`, options)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentCompositionPreview: AgentCompositionPreview
  }
}

/** Map a registry tool origin onto the envelope's preset-relative source. */
function toolSourceOf(origin: 'global' | 'scoped' | 'transport'): CompositionToolFact['source'] {
  // A standing scope's chain holds exactly its own layer, so 'scoped' names
  // the preset's contribution for every read this service makes.
  return origin === 'scoped' ? 'preset' : origin
}

/** Absolute filesystem paths, POSIX or Windows, wherever they appear in text. */
const ABSOLUTE_PATH = /(?:[/\\][\w.@+-]+){2,}|[A-Za-z]:\\(?:[\w.@+-]+\\)*[\w.@+-]+/g

/**
 * Replace absolute host paths in a failure reason. Mount diagnostics quote
 * the composition file's location; the projection crosses to pickers and
 * machine consumers, and a host path is a fact about the machine, not the
 * composition.
 * @param reason - the raw diagnostic text.
 * @returns the text with every absolute path reduced to `<path>`.
 */
function redactPaths(reason: string): string {
  return reason.replace(ABSOLUTE_PATH, '<path>')
}

/**
 * Read one preset's composition text, or undefined when it cannot be read.
 * @param preset - the preset whose composition file to read.
 * @returns the file's exact text, or undefined on any read failure.
 */
async function compositionTextOf(preset: AgentPreset): Promise<string | undefined> {
  try {
    return await readFile(preset.path, 'utf8')
  } catch {
    // Deleted or unreadable between discovery and this read: drift cannot be
    // decided, and the caller reports `unknown` rather than guessing.
    return undefined
  }
}

/**
 * Compute one preset's drift against its copy lineage.
 *
 * No lineage (a shipped preset, a hand-authored one, a copy from before
 * lineage existed) or an unreadable source reports `unknown` — an
 * unanswerable question, never an implied match.
 * @param ctx - the service's own context, for roster reads.
 * @param preset - the preset whose drift is being reported.
 * @returns the drift state with every digest that could be read.
 */
async function driftOf(ctx: Context, preset: AgentPreset): Promise<CompositionDrift> {
  const lineage = await readPresetLineage(dirname(preset.path))
  if (lineage === undefined) return { state: 'unknown' }
  const driftBase = { state: 'unknown' as const, source_id: lineage.source_id, source_digest: lineage.source_digest }
  const source = (await ctx.agentPresets.list()).find(row => row.id === lineage.source_id)
  const sourceText = source === undefined ? undefined : await compositionTextOf(source)
  const copyText = await compositionTextOf(preset)
  if (sourceText === undefined) return driftBase
  const copyDigest = copyText === undefined ? undefined : compositionTextDigest(copyText)
  const sourceNow = compositionTextDigest(sourceText)
  // The copy drifted when either side moved off the digest the copy froze:
  // an edited source no longer describes the copy, and an edited copy no
  // longer matches its frozen origin.
  const diverged = sourceNow !== lineage.source_digest || copyDigest !== lineage.source_digest
  return {
    state: diverged ? 'diverged' : 'none',
    source_id: lineage.source_id,
    source_digest: lineage.source_digest,
    ...copyDigest === undefined ? {} : { copy_digest: copyDigest },
  }
}

/**
 * Read the host-plane permission facts one composition runs under.
 *
 * Read-only and never defaulted: without a confining shell executor there is
 * no sandbox mode to report, and inventing one would mislabel every session
 * on the preset.
 * @param ctx - the service's own context.
 * @returns the sandbox and approval facts, or the reason they are unknown.
 */
function permissionsOf(ctx: Context): CompositionPermissions {
  const shell = ctx.get('shell')
  const approval = ctx.get('approval')
  const sandboxMode = shell?.sandboxMode
  if (sandboxMode === undefined) {
    return {
      unknown_reason: 'the host composition mounts no confining shell executor, so no sandbox mode applies',
    }
  }
  return {
    sandbox_mode: sandboxMode,
    approval_policy: approval?.config.policy ?? 'ask',
    contrib_source: 'host',
  }
}

/** One line of reason text from a thrown value, for typed failure envelopes. */
function reasonOf(error: unknown): string {
  return redactPaths(error instanceof Error ? error.message : String(error))
}

/**
 * The read-only composition projection service.
 *
 * Pure read: no subscription, no durable write, no per-call registration. Each
 * call re-reads the roster (the preset registry's own unmemoized convention),
 * so a preset authored, edited, or deleted while the process runs is answered
 * by the next call. The standing mount it ensures is shared with every cold
 * read and every session on the preset — projecting neither creates nor leaks
 * one.
 */
export class AgentCompositionPreview extends Service {
  static inject = ['agentPresets', 'tools', 'systemPrompt']

  /**
   * The service's own untraced context, so registry reads never inherit a
   * caller's scope the way the traceable proxy would rebind `this.ctx`.
   */
  private readonly selfCtx: Context

  constructor(ctx: Context) {
    super(ctx, 'agentCompositionPreview')
    this.selfCtx = ctx
  }

  /**
   * Project one preset's mount-level composition facts without creating an
   * agent, session, or turn.
   *
   * The projection digests only: tool schemas and section text never leave
   * this service, so the envelope carries no raw prompt, schema body, private
   * tool arguments, host path, or credential.
   * @param id - the preset id, or `undefined` for the roster's default.
   * @returns the `dsh.composition.preview.v0` envelope.
   * @throws {@link CompositionInvalidError} when the preset is broken or its
   * composition cannot mount; the roster's `UnknownPresetError` when the id
   * resolves to nothing.
   */
  async project(id?: string): Promise<CompositionProjection> {
    const presets = this.selfCtx.agentPresets
    const preset = await presets.resolve(id)
    if (preset.broken !== undefined) {
      throw new CompositionInvalidError(preset.id, redactPaths(preset.broken))
    }
    let facts
    try {
      facts = await presets.standingFactsFor(preset.id)
    } catch (error) {
      throw new CompositionInvalidError(preset.id, reasonOf(error), { cause: error })
    }
    const tools = this.toolFacts(facts.key)
    const promptSections = await this.sectionFacts(facts.key)
    const projectionUnits = this.unitFacts(facts.key)
    const permissions = permissionsOf(this.selfCtx)
    const composition = {
      tools,
      prompt_sections: promptSections,
      projection_units: projectionUnits,
      permissions,
    }
    return {
      schema: COMPOSITION_PREVIEW_SCHEMA,
      preset: {
        id: preset.id,
        trust: preset.trust,
        composition_stamp: { mtime_ms: facts.stamp.mtimeMs, size: facts.stamp.size },
        generation: facts.generation,
      },
      health: {
        shape_ok: true,
        mount_ok: true,
        provable_mount_ref: `standing:${preset.id}:${facts.generation}`,
      },
      drift: await driftOf(this.selfCtx, preset),
      composition,
      capability_digest: digestOfJson(composition),
      generated_at: new Date().toISOString(),
    }
  }

  /**
   * Project one preset and prove the projection left nothing behind.
   *
   * The report is redacted by construction — counts, digests, health, drift,
   * and a residue verdict, never schema bodies or section text — so a keyless
   * canary can print it without a redaction pass. `residue` compares the
   * process's global registry views and provided services before and after
   * the projection: a projection that registered anything fails its own smoke.
   * @param id - the preset id, or `undefined` for the roster's default.
   * @returns the `dsh.composition.smoke.v0` report.
   * @throws exactly what {@link project} throws.
   */
  async smoke(id?: string): Promise<SmokeReport> {
    // Warm the standing mount before the fingerprint window opens: the mount
    // is legitimate shared state that lives until whole-tree teardown, not
    // residue, so the before/after comparison must not count its creation. A
    // warm-up rejection is swallowed here only because `project()` re-attempts
    // the same work and reports it as the typed failure it is.
    try {
      await this.selfCtx.agentPresets.standingKeyFor(id)
    } catch {
      // `project()` below owns the typed rejection for this same cause.
    }
    const before = this.residueSignature()
    const startedAt = performance.now()
    const projection = await this.project(id)
    const elapsedMs = performance.now() - startedAt
    const residue = this.residueSignature() === before ? 'none' : 'detected'
    return {
      schema: COMPOSITION_SMOKE_SCHEMA,
      preset: { id: projection.preset.id, trust: projection.preset.trust },
      health: projection.health,
      counts: {
        tools: projection.composition.tools.length,
        prompt_sections: projection.composition.prompt_sections.length,
        projection_units: projection.composition.projection_units.length,
      },
      permissions_known: 'contrib_source' in projection.composition.permissions,
      drift: projection.drift,
      capability_digest: projection.capability_digest,
      residue,
      elapsed_ms: Math.round(elapsedMs),
    }
  }

  /**
   * The tool facts one standing scope resolves: one entry per visible tool,
   * digested over its projected schema and attributed to its supplying layer.
   * @param key - the preset's standing scope key.
   * @returns tool facts in registry visibility order.
   */
  private toolFacts(key: ScopeKey): CompositionToolFact[] {
    const tools = this.selfCtx.tools
    const origins = tools.sources(key)
    return tools.schemas(key).map(schema => ({
      name: schema.name,
      schema_digest: digestOfJson({ name: schema.name, description: schema.description, parameters: schema.parameters }),
      source: toolSourceOf(origins.get(schema.name) ?? 'global'),
    }))
  }

  /**
   * The prompt-section facts one standing scope assembles: one entry per
   * effective section, digested over its resolved text and attributed to its
   * supplying layer. Section text itself never leaves this method.
   * @param key - the preset's standing scope key.
   * @returns section facts in the assembly's canonical order.
   */
  private async sectionFacts(key: ScopeKey): Promise<CompositionSectionFact[]> {
    const systemPrompt = this.selfCtx.systemPrompt
    const origins = systemPrompt.sectionSources(key)
    const assembly = await systemPrompt.assemble({ scope: key })
    return assembly.sections.map(section => ({
      id: section.name,
      section_digest: digestOfText(section.text),
      source: origins.get(section.name) === 'scoped' ? 'preset' : 'global',
    }))
  }

  /**
   * The projection-unit facts one composition contributes or shares: units
   * whose registration the preset's standing scope made, plus the
   * context-global units every session folds. Units only OTHER scopes
   * registered are not this composition's facts and are omitted.
   * @param key - the preset's standing scope key.
   * @returns unit facts keyed in registry order.
   */
  private unitFacts(key: ScopeKey): CompositionUnitFact[] {
    const projections = this.selfCtx.get('sessionProjections')
    if (projections === undefined) return []
    const units: CompositionUnitFact[] = []
    for (const [unitKey, scopes] of projections.attributions()) {
      if (scopes.has(key)) units.push({ key: unitKey, source: 'preset' })
      else if (scopes.has(undefined)) units.push({ key: unitKey, source: 'global' })
    }
    return units
  }

  /**
   * A comparable fingerprint of the process's global registry surface: the
   * globally visible tool names, section names, projection-unit keys, and
   * provided service names. Two equal fingerprints bound a read that changed
   * none of them.
   * @returns the fingerprint, canonical JSON.
   */
  private residueSignature(): string {
    const ctx = this.selfCtx
    const projections = ctx.get('sessionProjections')
    return digestOfJson({
      tools: [...ctx.tools.sources().keys()].sort(),
      sections: [...ctx.systemPrompt.sectionSources().keys()].sort(),
      units: projections === undefined ? [] : [...projections.attributions().keys()].sort(),
      services: Object.getOwnPropertySymbols(ctx.reflect.store)
        .map(symbol => ctx.reflect.store[symbol]?.name)
        .filter((name): name is string => name !== undefined)
        .sort(),
    })
  }
}

export default AgentCompositionPreview
