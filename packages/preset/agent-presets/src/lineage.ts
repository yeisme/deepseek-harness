/**
 * A preset copy's lineage: which preset it was copied from, and the composition
 * digest that source carried at copy time.
 *
 * Written only by this package's `copy()` — a person or an agent never authors
 * it — so a projection can report drift between a copy and its source without
 * guessing at hand-written claims. Absent, unparsable, and wrongly-shaped files
 * all read as "no lineage": presentation of drift degrades to `unknown`, and a
 * preset still mounts, because lineage is a read-side fact, never a capability.
 *
 * @module @deepseek-ai/dsh-agent-presets/lineage
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { PRESET_ID } from './preset.ts'

/** The lineage file a `copy()` writes beside the composition. */
export const LINEAGE_FILE = 'lineage.yml'

/** The one schema string a lineage file carries. */
export const LINEAGE_SCHEMA = 'dsh.preset_lineage.v0'

/** A copy's frozen relationship to the preset it was copied from. */
export interface PresetLineage {
  /** Always {@link LINEAGE_SCHEMA}. */
  readonly schema: typeof LINEAGE_SCHEMA
  /** The source preset's id at copy time. */
  readonly source_id: string
  /** SHA-256 of the source's composition text at copy time. */
  readonly source_digest: string
  /** When the copy happened, ISO-8601 UTC. */
  readonly copied_at: string
}

/**
 * The content identity of a preset composition text.
 *
 * One function for both write paths (the digest a `copy()` freezes) and read
 * paths (the digest a drift check recomputes), so the two can never disagree
 * about what is being compared.
 * @param content - the composition file's exact text.
 * @returns lowercase SHA-256 digest in hexadecimal form.
 */
export function compositionTextDigest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** A lowercase 64-character hexadecimal digest. */
const DIGEST = /^[0-9a-f]{64}$/

/**
 * Read one preset directory's lineage.
 *
 * Tolerant by design: the file is optional, hand-edits are possible, and a
 * wrong answer must degrade the drift report rather than the preset.
 * @param directory - the preset directory.
 * @returns the recorded lineage, or undefined when it is absent or unusable.
 */
export async function readPresetLineage(directory: string): Promise<PresetLineage | undefined> {
  let raw: string
  try {
    raw = await readFile(join(directory, LINEAGE_FILE), 'utf8')
  } catch {
    // Absent is the common case: every preset authored before lineage, and
    // every shipped preset, carries none.
    return undefined
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    // A malformed file is a drifted fact about provenance, not about mounting.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  if (record.schema !== LINEAGE_SCHEMA) return undefined
  if (typeof record.source_id !== 'string' || !PRESET_ID.test(record.source_id)) return undefined
  if (typeof record.source_digest !== 'string' || !DIGEST.test(record.source_digest)) return undefined
  if (typeof record.copied_at !== 'string' || record.copied_at === '') return undefined
  return {
    schema: LINEAGE_SCHEMA,
    source_id: record.source_id,
    source_digest: record.source_digest,
    copied_at: record.copied_at,
  }
}

/**
 * Render lineage as the file's contents.
 * @param lineage - the provenance record to store.
 * @returns the YAML document.
 */
export function renderLineage(lineage: PresetLineage): string {
  return yaml.dump({
    schema: lineage.schema,
    source_id: lineage.source_id,
    source_digest: lineage.source_digest,
    copied_at: lineage.copied_at,
  }, { lineWidth: -1 })
}
