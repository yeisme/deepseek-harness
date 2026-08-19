/**
 * AgentCompositionPreview.smoke(): the same projection with a cleanup verdict.
 * A clean run reports `residue: 'none'`; a composition whose evaluation
 * leaves a global registration behind fails its own smoke, which is the
 * keyless canary's exit signal.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { beforeEach, describe, expect, it } from 'vitest'
import AgentPresets, { COMPOSITION_FILE } from '@deepseek-ai/dsh-agent-presets'
import AgentCompositionPreview, { CompositionInvalidError } from '@deepseek-ai/dsh-agent-composition-preview'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

let ctx: Context
let userRoot: string

/** The projection harness: every registry, the roster, the service. */
async function harness(): Promise<Context> {
  const booted = new Context()
  booted.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await booted.plugin(Loader)
  booted.loader.builtins.include = Include
  await booted.plugin(LlmRuntime)
  await booted.plugin(SessionStore)
  await booted.plugin(SystemPrompt, { persona: '' })
  await booted.plugin(ToolRuntime)
  await booted.plugin(AgentRegistry)
  await booted.plugin(AgentLoop, { agents: [] })
  await booted.plugin(SessionProjectionRegistry)
  await booted.plugin(AgentPresets, {
    default: 'standard',
    roots: [
      { path: join(FIXTURES, 'system'), trust: 'system' as const },
      { path: userRoot, trust: 'user' as const },
    ],
    includeUserRoot: false,
  })
  await booted.plugin(AgentCompositionPreview)
  return booted
}

beforeEach(async () => {
  userRoot = await mkdtemp(join(tmpdir(), 'dsh-composition-smoke-'))
  ctx = await harness()
})

describe('smoking a composition', () => {
  it('reports redacted counts and a clean residue for a well-formed preset', async () => {
    const report = await ctx.agentCompositionPreview.smoke('standard')
    const projection = await ctx.agentCompositionPreview.project('standard')

    expect(report.schema).toBe('dsh.composition.smoke.v0')
    expect(report.preset).toEqual({ id: 'standard', trust: 'system' })
    expect(report.health.provable_mount_ref).toBe('standing:standard:1')
    expect(report.counts).toEqual({
      tools: projection.composition.tools.length,
      prompt_sections: projection.composition.prompt_sections.length,
      projection_units: projection.composition.projection_units.length,
    })
    expect(report.permissions_known).toBe(false)
    expect(report.capability_digest).toBe(projection.capability_digest)
    expect(report.residue).toBe('none')
    expect(report.elapsed_ms).toBeGreaterThanOrEqual(0)
    // Redaction is structural: the report type carries no schema bodies or
    // section text, and the serialized output names no host paths.
    const printed = JSON.stringify(report)
    expect(printed).not.toContain('description')
    expect(printed).not.toContain(tmpdir())
  })

  it('fails its own smoke when projecting leaves a global registration behind', async () => {
    // A section whose evaluation registers a global tool: the exact class of
    // side effect the residue verdict exists to catch, planted in the one
    // evaluation window the projection opens.
    let armed = false
    ctx.systemPrompt.section({
      name: 'host:dirty',
      order: 30,
      text: () => {
        if (armed) {
          armed = false
          ctx.tools.register({
            name: 'smuggled',
            description: 'registered mid-projection',
            parameters: { type: 'object', properties: {} },
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
            execute: () => Promise.resolve('smuggled'),
          })
        }
        return 'dirty section'
      },
    })
    armed = true

    const report = await ctx.agentCompositionPreview.smoke('standard')

    expect(report.residue).toBe('detected')
  })

  it('rejects a broken composition rather than reporting a partial smoke', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(userRoot, 'broken'))
    await writeFile(join(userRoot, 'broken', COMPOSITION_FILE), 'rows: not-a-list\n')

    await expect(ctx.agentCompositionPreview.smoke('broken'))
      .rejects.toBeInstanceOf(CompositionInvalidError)
  })
})
