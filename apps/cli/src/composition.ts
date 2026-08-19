/**
 * `dsh composition preview|smoke` — project one agent preset's composition
 * facts from a real profile boot, then exit. Machine consumers (Ordo's agent
 * preview/qualify adapters) read the `--json` envelope from stdout; people
 * get a summary. The projection service itself lives in
 * `@deepseek-ai/dsh-agent-composition-preview`; this module only boots a
 * tree, calls it, prints, and shuts the tree down.
 *
 * The boot is the launcher's own profile boot with one app argument,
 * `--port 0`: the composition command owns no server lifecycle, so the web
 * app's surface must activate (the boot audit rejects a tree whose rows wait
 * forever) but binds an OS-assigned port that dies with the process. The
 * projection itself never reaches a model — no provider call, no token spend.
 *
 * @module @deepseek-ai/dsh/composition
 */

import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { CompositionInvalidError } from '@deepseek-ai/dsh-agent-composition-preview'
import type { CompositionProjection, SmokeReport } from '@deepseek-ai/dsh-agent-composition-preview'
import { runProfile } from './profile-boot.ts'

const NAME = 'dsh'

/** What one `dsh composition` invocation resolved to, from the args adapter. */
export interface CompositionOptions {
  /** Which projection command ran. */
  command: 'preview' | 'smoke'
  /** The profile whose roster to project. */
  profile: string
  /** The preset to project, or the roster's default when omitted. */
  preset?: string
  /** `--patch` overlay paths, in argv order. */
  patches: string[]
  /** Whether the machine envelope was requested. */
  json: boolean
}

/** The streams output is written to; production writes to the process. */
export const internals: { stdout: { write(chunk: string): unknown }; stderr: { write(chunk: string): unknown } } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/**
 * Run one composition invocation: boot the profile, project, print, shut down.
 * @param options - the resolved invocation.
 * @returns the process exit code: 0 for a successful (and, for smoke, clean)
 * projection; 1 for any refusal, projection failure, or detected residue.
 */
export async function runComposition(options: CompositionOptions): Promise<number> {
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: options.profile,
    patchFiles: options.patches,
    // The web app's own flag family: an ephemeral port for the surface its
    // rows need to activate. A profile whose app parses a different family
    // fails its boot, which is the honest answer for a composition command
    // that owns no per-app flag knowledge.
    args: ['--port', '0'],
    // The URL line is the interactive server's readiness signal; on a
    // one-shot projection stdout belongs to the envelope alone.
    inlineOverlays: [
      { insert: [{ id: 'agent-composition-preview', name: '@deepseek-ai/dsh-agent-composition-preview' }] },
      { id: 'web-runtime', config: { printUrl: false } },
    ],
  })
  let code: number
  try {
    code = await projectAndReport(ctx, options)
  } catch (error) {
    writeFailure(options, error)
    code = 1
  } finally {
    // Natural completion records the code and lets the process drain.
    await shutdown.shutdown(0)
  }
  return code
}

/**
 * Resolve the projection service, run the command, and print its result.
 * @param ctx - the booted profile tree.
 * @param options - the resolved invocation.
 * @returns the exit code the invocation earned.
 */
async function projectAndReport(ctx: Context, options: CompositionOptions): Promise<number> {
  const service = ctx.get('agentCompositionPreview')
  if (service === undefined) {
    internals.stderr.write(
      `${NAME}: profile "${options.profile}" composes no agent-composition-preview service — `
      + 'project a profile whose bundles include the preset roster (the web profile does)\n',
    )
    return 1
  }
  if (options.command === 'preview') {
    const projection = await service.project(options.preset)
    writeResult(options, projection)
    return 0
  }
  const report = await service.smoke(options.preset)
  writeResult(options, report)
  // Exit 0 states mount + projection + cleanup all passed; residue is the
  // cleanup half of that claim, so a dirty read fails the smoke.
  return report.residue === 'none' ? 0 : 1
}

/**
 * Print one successful result: the exact envelope under `--json`, a digest-
 * level human summary otherwise.
 * @param options - the resolved invocation.
 * @param result - the projection or smoke report.
 */
function writeResult(options: CompositionOptions, result: CompositionProjection | SmokeReport): void {
  if (options.json) {
    internals.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  const lines: string[] = []
  lines.push(`preset ${result.preset.id} (${result.preset.trust})`)
  lines.push(`health shape_ok=${String(result.health.shape_ok)} mount_ok=${String(result.health.mount_ok)} ref=${result.health.provable_mount_ref}`)
  if ('composition' in result) {
    lines.push(`tools ${String(result.composition.tools.length)} (${String(result.composition.tools.filter(tool => tool.source === 'preset').length)} from the preset)`)
    lines.push(`prompt sections ${String(result.composition.prompt_sections.length)} (${String(result.composition.prompt_sections.filter(section => section.source === 'preset').length)} from the preset)`)
    lines.push(`projection units ${String(result.composition.projection_units.length)}`)
    lines.push(`permissions ${permissionsLine(result.composition.permissions)}`)
  } else {
    lines.push(`tools ${String(result.counts.tools)}, prompt sections ${String(result.counts.prompt_sections)}, projection units ${String(result.counts.projection_units)}`)
    lines.push(`permissions ${result.permissions_known ? 'known' : 'unknown'}, residue ${result.residue}, ${String(result.elapsed_ms)}ms`)
  }
  lines.push(`drift ${driftLine(result.drift)}`)
  lines.push(`capability_digest ${result.capability_digest.slice(0, 12)} (dsh.composition.${'composition' in result ? 'preview' : 'smoke'}.v0)`)
  internals.stdout.write(`${lines.join('\n')}\n`)
}

/**
 * Print one refusal or failure: a typed composition failure renders its code,
 * preset, and path-redacted reason; anything else renders the error's message.
 * @param options - the resolved invocation.
 * @param error - the thrown value.
 */
function writeFailure(options: CompositionOptions, error: unknown): void {
  if (error instanceof CompositionInvalidError) {
    if (options.json) {
      internals.stderr.write(`${JSON.stringify({
        code: error.code,
        preset: error.presetId,
        reason: error.reason,
      }, null, 2)}\n`)
      return
    }
    internals.stderr.write(`${NAME}: preset "${error.presetId}" cannot be projected: ${error.reason}\n`)
    return
  }
  internals.stderr.write(`${NAME}: composition ${options.command} failed: ${error instanceof Error ? error.message : String(error)}\n`)
}

/** One human line for the permission facts, never implying an unreadable sandbox. */
function permissionsLine(permissions: CompositionProjection['composition']['permissions']): string {
  return 'contrib_source' in permissions
    ? `${permissions.sandbox_mode} sandbox, ${permissions.approval_policy} approval (host)`
    : `unknown (${permissions.unknown_reason})`
}

/** One human line for the drift state, naming the source when lineage was read. */
function driftLine(drift: CompositionProjection['drift']): string {
  const source = drift.source_id === undefined ? '' : ` from ${drift.source_id}`
  return `${drift.state}${source}`
}
