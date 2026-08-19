/**
 * Canonical serialization and content digests for composition projection.
 *
 * Digests cross a trust boundary (a picker panel, an Ordo adapter comparing a
 * preset against a frozen lineage), so the serialization is canonical: object
 * keys sorted, no insignificant whitespace, one JSON grammar — the same value
 * always digests identically on every machine.
 *
 * @module @deepseek-ai/dsh-agent-composition-preview/digest
 */

import { createHash } from 'node:crypto'

/**
 * Serialize a JSON value canonically: object keys sorted ascending (code-unit
 * order, matching `Array.prototype.sort` on strings), no whitespace, arrays
 * kept in order.
 *
 * Input is a lossless JSON value (whatever the registries snapshotted); a
 * non-JSON input serializes through `JSON.stringify`'s own rules and is a
 * caller bug, not a canonicalization decision.
 * @param value - the JSON value to serialize.
 * @returns the canonical JSON document.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value) ?? 'null'
}

/** Recursive canonical writer; undefined (an impossible JSON value) reads as null. */
function serialize(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (Array.isArray(value)) return `[${value.map(entry => serialize(entry) ?? 'null').join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const members = keys.map(key => `${JSON.stringify(key)}:${serialize(record[key]) ?? 'null'}`)
  return `{${members.join(',')}}`
}

/**
 * Digest a JSON value by its canonical serialization.
 * @param value - the JSON value to digest.
 * @returns lowercase SHA-256 digest in hexadecimal form.
 */
export function digestOfJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/**
 * Digest one exact text, such as a resolved prompt section.
 * @param text - the section's resolved text.
 * @returns lowercase SHA-256 digest in hexadecimal form.
 */
export function digestOfText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
