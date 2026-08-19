import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import { apply as applySpecInvariant } from '../src/invariant.ts'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Invariants)
  await applySpecInvariant(ctx)
  return ctx
}

describe('plan-spec invariant', () => {
  it('accepts a valid spec/document event', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    expect(() => session.append('spec/document', {
      specId: 'api',
      planId: 'plan-1',
      revision: 1,
      title: 'API',
      content: '# API',
      status: 'draft',
      basisPlanRevision: 1,
      basisSpecVersions: {},
    })).not.toThrow()
  })

  it('rejects invalid spec/document payloads', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    expect(() => session.append('spec/document', {
      specId: '', planId: 'plan-1', revision: 1, title: 'API', content: '# API', status: 'draft', basisPlanRevision: 1, basisSpecVersions: {},
    } as never)).toThrow('specId')
    expect(() => session.append('spec/document', {
      specId: 'api', planId: 'plan-1', revision: 0, title: 'API', content: '# API', status: 'draft', basisPlanRevision: 1, basisSpecVersions: {},
    } as never)).toThrow('revision')
  })
})
