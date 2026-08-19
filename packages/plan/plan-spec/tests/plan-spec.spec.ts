import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import PlanSpecService, { foldSpec, foldSpecRevision, foldSpecsByPlan } from '../src/index.ts'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PlanSpecService)
  return ctx
}

const BASE = {
  specId: 'api',
  planId: 'plan-1',
  title: 'API spec',
  content: '# API\n\nGET /v1/things',
  basisPlanRevision: 1,
}

describe('plan-spec tools', () => {
  it('registers spec_write and spec_read model tools', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(PlanSpecService)
    const names = ctx.tools.schemas().map(tool => tool.name)
    expect(names).toContain('spec_write')
    expect(names).toContain('spec_read')
  })
})

describe('plan-spec service', () => {
  it('appends whole-value spec revisions and folds the latest by specId', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    const first = ctx.planSpec.write(session, BASE)
    expect(first.revision).toBe(1)
    const second = ctx.planSpec.write(session, { ...BASE, content: '# API\n\nGET /v2/things', status: 'active' })
    expect(second.revision).toBe(2)
    expect(foldSpec(session.events, 'api')).toMatchObject({ revision: 2, status: 'active' })
    expect(foldSpecRevision(session.events, 'api')).toBe(3)
    expect(ctx.planSpec.current(session, 'api')).toMatchObject({ content: '# API\n\nGET /v2/things' })
  })

  it('groups latest specs by plan and specId', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    ctx.planSpec.write(session, BASE)
    ctx.planSpec.write(session, { ...BASE, specId: 'db', title: 'DB spec', content: '# DB' })
    ctx.planSpec.write(session, { ...BASE, planId: 'plan-2', specId: 'api', title: 'Plan 2 API', content: '# P2' })
    const byPlan = ctx.planSpec.list(session)
    expect(Object.keys(byPlan)).toEqual(['plan-1', 'plan-2'])
    expect(Object.keys(byPlan['plan-1'] ?? {})).toEqual(['api', 'db'])
    expect(byPlan['plan-2']?.['api']?.title).toBe('Plan 2 API')
    expect(foldSpecsByPlan(session.events, 'plan-2')['plan-2']?.['api']?.title).toBe('Plan 2 API')
  })

  it('rejects invalid input before appending', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    expect(() => ctx.planSpec.write(session, { ...BASE, specId: '' })).toThrow('specId')
    expect(() => ctx.planSpec.write(session, { ...BASE, basisPlanRevision: 0 })).toThrow('basisPlanRevision')
    expect(session.events.some(event => event.type === 'spec/document')).toBe(false)
  })

  it('serves the spec-document projection and drops it with the fiber', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    expect(ctx.sessionProjections.snapshot(session).values['spec-document']).toEqual({ latest: undefined, revisions: [], byPlan: {} })
    ctx.planSpec.write(session, BASE)
    const value = ctx.sessionProjections.snapshot(session).values['spec-document']
    expect(value).toMatchObject({
      latest: { specId: 'api', revision: 1, status: 'draft' },
      byPlan: { 'plan-1': { api: { specId: 'api', revision: 1 } } },
    })
    expect(value?.revisions).toHaveLength(1)
  })
})
