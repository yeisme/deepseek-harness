/**
 * Published-entry acceptance for `dsh composition preview|smoke`: the built
 * bin boots the real web profile, prints exactly one envelope on stdout, and
 * exits by the cleanup semantics it documents. Keyless — no model is ever
 * called, so the suite runs without any provider credential.
 */

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')
/** Boot plus projection of the shipped web profile; generous for cold caches. */
const BIN_TIMEOUT_MS = 90_000

/** One invocation of the built bin with the telemetry exporter off. */
async function runComposition(args: readonly string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const result = await execa(process.execPath, [dshBin, 'composition', ...args], {
    input: '',
    timeout: BIN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    reject: false,
    env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
    extendEnv: false,
  })
  if (result.timedOut) {
    throw new Error(`dsh composition did not exit within ${String(BIN_TIMEOUT_MS)}ms. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return { stdout: result.stdout, stderr: result.stderr, code: result.exitCode ?? -1 }
}

describe('dsh composition (built bin)', () => {
  it('prints one dsh.composition.preview.v0 envelope and exits 0', async () => {
    const { stdout, stderr, code } = await runComposition(['preview', '--preset', 'standard', '--json'])

    expect(code).toBe(0)
    // Exactly one JSON document: no banner, no boot noise on stdout.
    const documents = stdout.split('\n').filter(line => line.trim() !== '')
    expect(documents[0]).toBe('{')
    const envelope = JSON.parse(stdout) as {
      schema: string
      preset: { id: string }
      health: { shape_ok: boolean; mount_ok: boolean; provable_mount_ref: string }
      composition: { tools: { name: string; source: string }[] }
      capability_digest: string
    }
    expect(envelope.schema).toBe('dsh.composition.preview.v0')
    expect(envelope.preset.id).toBe('standard')
    expect(envelope.health).toEqual({
      shape_ok: true, mount_ok: true, provable_mount_ref: 'standing:standard:1',
    })
    expect(envelope.composition.tools.length).toBeGreaterThan(10)
    expect(envelope.capability_digest).toMatch(/^[0-9a-f]{64}$/)
    // Nothing in the envelope leaks host paths or prompt text.
    expect(stdout).not.toContain(repoRoot)
    expect(stderr).toBe('')
  })

  it('smokes the minimal preset and exits 0 on a clean residue', async () => {
    const { stdout, code } = await runComposition(['smoke', '--preset', 'minimal', '--json'])

    expect(code).toBe(0)
    const report = JSON.parse(stdout) as {
      schema: string
      preset: { id: string }
      counts: { tools: number }
      residue: string
    }
    expect(report.schema).toBe('dsh.composition.smoke.v0')
    expect(report.preset.id).toBe('minimal')
    expect(report.counts.tools).toBeGreaterThan(0)
    expect(report.residue).toBe('none')
  })

  it('exits 1 with the roster error for an unknown preset', async () => {
    const { stdout, code } = await runComposition(['preview', '--preset', 'never-existed', '--json'])

    expect(code).toBe(1)
    expect(stdout).toBe('')
  })

  it('summarizes for a person without --json', async () => {
    const { stdout, code } = await runComposition(['preview', '--preset', 'minimal'])

    expect(code).toBe(0)
    expect(stdout).toContain('preset minimal (system)')
    expect(stdout).toContain('capability_digest ')
  })
})
