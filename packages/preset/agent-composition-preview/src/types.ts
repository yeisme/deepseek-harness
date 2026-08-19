/**
 * Client-safe composition-projection types. Pure types only — no runtime
 * code — so a browser bundle can consume the envelope's fields without
 * importing the service that produces them. The schema strings live here as
 * literal types; the runtime constants are exported from the package root.
 *
 * @module @deepseek-ai/dsh-agent-composition-preview/types
 */

/** Where one projected tool came from. */
export type CompositionToolSource = 'global' | 'preset' | 'transport'

/** Where one projected prompt section came from. */
export type CompositionSectionSource = 'global' | 'preset'

/** Where one projected session-projection unit came from. */
export type CompositionUnitSource = 'global' | 'preset'

/** One model-visible tool, named and digested, never serialized in full. */
export interface CompositionToolFact {
  /** The tool's registered name. */
  readonly name: string
  /** SHA-256 over the canonical JSON of the tool's name, description, and parameters. */
  readonly schema_digest: string
  /** The registry layer that supplied the tool for this composition. */
  readonly source: CompositionToolSource
}

/** One system-prompt section, named and digested, with no section text. */
export interface CompositionSectionFact {
  /** The section's registered name. */
  readonly id: string
  /** SHA-256 over the section's resolved text. */
  readonly section_digest: string
  /** The registry layer that supplied the section for this composition. */
  readonly source: CompositionSectionSource
}

/** One session-projection unit key this composition contributes or shares. */
export interface CompositionUnitFact {
  /** The unit's registered key. */
  readonly key: string
  /** Whether the preset's standing mount contributed the unit, or the host did. */
  readonly source: CompositionUnitSource
}

/**
 * The permission facts one composition runs under, or the reason they cannot
 * be read. Never defaulted: a deployment without a confining executor reports
 * unknown rather than implying a sandbox.
 */
export type CompositionPermissions =
  | {
    /** The host shell executor's sandbox mode. */
    readonly sandbox_mode: string
    /** The approval policy sessions on this composition start under. */
    readonly approval_policy: string
    /** Permission knobs are host-plane facts; a preset never overrides them. */
    readonly contrib_source: 'host'
  }
  | {
    /** Why no permission facts could be read. */
    readonly unknown_reason: string
  }

/** How a copy relates to the preset it was copied from. */
export interface CompositionDrift {
  /** `none` when copy and source still match the frozen copy-time digest. */
  readonly state: 'none' | 'unknown' | 'diverged'
  /** The lineage-recorded source id, present whenever lineage was read. */
  readonly source_id?: string
  /** The digest the source carried at copy time, present whenever lineage was read. */
  readonly source_digest?: string
  /** The copy's current composition digest, present when it was readable. */
  readonly copy_digest?: string
}

/** The preset identity one projection is about. */
export interface CompositionPresetFact {
  /** The preset's roster id. */
  readonly id: string
  /** Trust recorded from the root the preset was discovered under. */
  readonly trust: 'system' | 'user'
  /** Stamp of the composition file the mounted generation was read from. */
  readonly composition_stamp: { readonly mtime_ms: number; readonly size: number }
  /** Which mount of this preset id this generation is, from 1. */
  readonly generation: number
}

/** The three-layer health one projection proved. */
export interface CompositionHealth {
  /** The roster's own shape check passed: discovery parsed a named-row composition. */
  readonly shape_ok: boolean
  /** The standing mount succeeded: `standingKeyFor` composed plugins with no agent. */
  readonly mount_ok: boolean
  /** Traceable reference to the proved standing mount, `standing:<preset>:<generation>`. */
  readonly provable_mount_ref: string
}

/**
 * One preset's mount-level composition facts: the `dsh.composition.preview.v0`
 * envelope a picker panel or a machine consumer (Ordo's agent preview) reads.
 * Facts only — no risk, maturity, or qualification judgement, which belong to
 * the Ordo owner.
 */
export interface CompositionProjection {
  readonly schema: 'dsh.composition.preview.v0'
  readonly preset: CompositionPresetFact
  readonly health: CompositionHealth
  readonly drift: CompositionDrift
  readonly composition: {
    readonly tools: readonly CompositionToolFact[]
    readonly prompt_sections: readonly CompositionSectionFact[]
    readonly projection_units: readonly CompositionUnitFact[]
    readonly permissions: CompositionPermissions
  }
  /** SHA-256 over the canonical JSON of the composition section above. */
  readonly capability_digest: string
  /** When the projection was taken, ISO-8601 UTC. */
  readonly generated_at: string
}

/**
 * The redacted `dsh.composition.smoke.v0` summary a keyless smoke run prints:
 * health, counts, drift, and cleanup evidence, with no schema bodies, section
 * text, prompts, or host paths.
 */
export interface SmokeReport {
  readonly schema: 'dsh.composition.smoke.v0'
  readonly preset: { readonly id: string; readonly trust: 'system' | 'user' }
  readonly health: CompositionHealth
  readonly counts: {
    readonly tools: number
    readonly prompt_sections: number
    readonly projection_units: number
  }
  readonly permissions_known: boolean
  readonly drift: CompositionDrift
  readonly capability_digest: string
  /** Whether projecting left the process's global registry views unchanged. */
  readonly residue: 'none' | 'detected'
  readonly elapsed_ms: number
}
