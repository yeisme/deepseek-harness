/**
 * AgentCompositionPreview.project(): mount-level composition facts for one
 * preset, with digests, three-layer health, and lineage drift — and nothing
 * else. The digest cross-check against a live agent's own view is the load-
 * bearing assertion: the projection must equal what a session on the preset
 * actually gets, or the picker would be showing fiction.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { beforeEach, describe, expect, it } from 'vitest'
import AgentPresets, { COMPOSITION_FILE } from '@deepseek-ai/dsh-agent-presets'
import type { Config } from '@deepseek-ai/dsh-agent-presets'
import AgentCompositionPreview, {
  canonicalJson, CompositionInvalidError, digestOfJson, digestOfText,
} from '@deepseek-ai/dsh-agent-composition-preview'
import type { CompositionProjection } from '@deepseek-ai/dsh-agent-composition-preview'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'preview/host': null
  }
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const DIGEST = /^[0-9a-f]{64}$/

let ctx: Context
let userRoot: string

/**
 * A harness carrying every registry a preset contributes to, the roster, and
 * the projection service, plus one context-global tool, section, and unit the
 * preset does NOT own.
 */
async function harness(roster: Config = {
  default: 'standard',
  roots: [
    { path: join(FIXTURES, 'system'), trust: 'system' as const },
    { path: userRoot, trust: 'user' as const },
  ],
  includeUserRoot: false,
}): Promise<Context> {
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
  await booted.plugin(AgentPresets, roster)
  await booted.plugin(AgentCompositionPreview)
  booted.tools.register({
    name: 'host-tool',
    description: 'context-global fixture tool',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: () => Promise.resolve('host'),
  })
  booted.systemPrompt.section({ name: 'host:section', order: 20, text: 'host-owned section' })
  booted.sessionProjections.register<'preview/host', null>({
    key: 'preview/host',
    schema: z.null(),
    init: () => null,
    apply: state => state,
    view: () => null,
    stateVersion: 1,
  })
  return booted
}

/** One composition file row naming the fixture plugin, like the shipped one. */
const rowFor = (tool: string): string =>
  `- id: only\n  name: ${join(FIXTURES, 'plugins', 'contribute.js')}\n  config:\n    tool: ${tool}\n`

/** Seed a user preset directory carrying `composition`. */
async function seed(id: string, composition: string): Promise<void> {
  await mkdir(join(userRoot, id), { recursive: true })
  await writeFile(join(userRoot, id, COMPOSITION_FILE), composition)
}

beforeEach(async () => {
  userRoot = await mkdtemp(join(tmpdir(), 'dsh-composition-preview-'))
  ctx = await harness()
})

describe('projecting a preset without an agent', () => {
  it('reports mount-level facts: tools, sections, units, permissions, health, drift', async () => {
    const projection = await ctx.agentCompositionPreview.project('standard')

    expect(projection.schema).toBe('dsh.composition.preview.v0')
    expect(projection.preset).toMatchObject({ id: 'standard', trust: 'system', generation: 1 })
    expect(projection.preset.composition_stamp.size).toBeGreaterThan(0)
    expect(projection.health).toEqual({
      shape_ok: true, mount_ok: true, provable_mount_ref: 'standing:standard:1',
    })
    const tools = Object.fromEntries(projection.composition.tools.map(tool => [tool.name, tool.source]))
    expect(tools).toEqual({ alpha: 'preset', 'host-tool': 'global' })
    const sections = Object.fromEntries(projection.composition.prompt_sections.map(s => [s.id, s.source]))
    expect(sections['preset:alpha']).toBe('preset')
    expect(sections['host:section']).toBe('global')
    expect(sections['harness:identity']).toBe('global')
    expect(projection.composition.projection_units).toEqual([
      { key: 'preview/host', source: 'global' },
      { key: 'preview/alpha', source: 'preset' },
    ])
    const permissions = projection.composition.permissions
    if (!('unknown_reason' in permissions)) throw new Error('expected permissions to be unknown')
    expect(permissions.unknown_reason).toContain('no confining shell executor')
    // Shipped presets carry no lineage, so drift is an answered "unknown".
    expect(projection.drift).toEqual({ state: 'unknown' })
    expect(projection.capability_digest).toMatch(DIGEST)
    expect(projection.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The mount exists for the reader; no session or turn started.
    expect(ctx.sessions.list()).toEqual([])
  })

  it('digests exactly what a joined agent on the same preset sees', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('sess-parity'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'standard'),
    })
    const projection: CompositionProjection = await ctx.agentCompositionPreview.project('standard')

    const agentSchemas = ctx.tools.schemas(handle.agent)
    expect(projection.composition.tools.map(tool => tool.schema_digest)).toEqual(
      agentSchemas.map(schema => digestOfJson({ name: schema.name, description: schema.description, parameters: schema.parameters })),
    )
    const agentAssembly = await ctx.systemPrompt.assemble({ scope: handle.agent })
    expect(projection.composition.prompt_sections.map(section => section.section_digest)).toEqual(
      agentAssembly.sections.map(section => digestOfText(section.text)),
    )
  })

  it('reports the default preset when the caller names none', async () => {
    const projection = await ctx.agentCompositionPreview.project()

    expect(projection.preset.id).toBe('standard')
  })

  it('rejects a broken preset with the typed composition_invalid failure', async () => {
    await seed('broken', 'rows: not-a-list\n')

    const failure = await ctx.agentCompositionPreview.project('broken')
      .then(() => { throw new Error('expected a rejection') }, (error: unknown) => error)
    expect(failure).toBeInstanceOf(CompositionInvalidError)
    expect((failure as CompositionInvalidError).code).toBe('composition_invalid')
    expect((failure as CompositionInvalidError).reason).toMatch(/top-level list of plugin rows/)
  })

  it('propagates the roster error for an unknown preset', async () => {
    await expect(ctx.agentCompositionPreview.project('never-existed'))
      .rejects.toThrow(/not found/)
  })

  it('redacts host paths out of mount-failure reasons', async () => {
    await seed('unmountable', '- id: only\n  name: ./does-not-exist.js\n')

    const failure: CompositionInvalidError = await ctx.agentCompositionPreview.project('unmountable')
      .then(() => { throw new Error('expected a rejection') }, (error: unknown) => error as CompositionInvalidError)
    expect(failure).toBeInstanceOf(CompositionInvalidError)
    expect(failure.reason).toContain('<path>')
    expect(failure.reason).not.toContain(userRoot)
  })
})

describe('drift against copy lineage', () => {
  it('reports none for an untouched copy and diverged once a side edits', async () => {
    await seed('source', rowFor('source'))
    await ctx.agentPresets.copy('source', 'mine')

    const fresh = await ctx.agentCompositionPreview.project('mine')
    expect(fresh.drift).toMatchObject({ state: 'none', source_id: 'source' })
    expect(fresh.drift.source_digest).toMatch(DIGEST)
    expect(fresh.drift.copy_digest).toBe(fresh.drift.source_digest)

    await writeFile(join(userRoot, 'source', COMPOSITION_FILE), rowFor('edited'))

    const drifted = await ctx.agentCompositionPreview.project('mine')
    expect(drifted.drift.state).toBe('diverged')
    expect(drifted.drift.source_id).toBe('source')
    expect(drifted.drift.copy_digest).toBe(fresh.drift.source_digest)
  })

  it('reports unknown when the source is gone or lineage never existed', async () => {
    await seed('source', rowFor('source'))
    await ctx.agentPresets.copy('source', 'mine')
    await rm(join(userRoot, 'source'), { recursive: true, force: true })

    expect((await ctx.agentCompositionPreview.project('mine')).drift.state).toBe('unknown')
    // A preset the service never copied carries no lineage to compare.
    expect((await ctx.agentCompositionPreview.project('standard')).drift.state).toBe('unknown')
  })
})

describe('permission facts', () => {
  it('reads host-plane sandbox and approval once a confining executor is provided', async () => {
    ctx.provide('shell', { sandboxMode: 'workspace-write' })
    ctx.provide('approval', { config: { policy: 'never' } })

    const projection = await ctx.agentCompositionPreview.project('standard')

    expect(projection.composition.permissions).toEqual({
      sandbox_mode: 'workspace-write', approval_policy: 'never', contrib_source: 'host',
    })
  })
})

describe('canonical digests', () => {
  it('serializes object keys sorted, arrays ordered, no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: true }] })).toBe('{"a":[2,{"c":true,"d":null}],"b":1}')
  })

  it('pins the digest of one fixed composition fact', () => {
    // A stable expected value: any change to the canonicalization rule or the
    // digested fields changes this string and must be a deliberate decision.
    expect(digestOfJson({ name: 'alpha', description: 'tool alpha', parameters: {} }))
      .toBe('f07f4c7d48e0b1eacf7202d2f7d893438f243a0647912758adcd0052059fcbba')
  })
})
