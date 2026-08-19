import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import PlanSpecService from '@deepseek-ai/dsh-plan-spec'
import TaskBasisService, { foldSpecSeqs, foldTaskBasis, foldTaskConflict } from '../src/index.ts'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(PlanSpecService)
  await ctx.plugin(TaskBasisService)
  return ctx
}

function appendPlan(session: ReturnType<SessionStore['create']>): number {
  const event = session.append('plan/document', {
    planId: 'plan-1',
    title: 'Plan',
    markdown: '# Plan',
    status: 'approved',
    round: 1,
    sourceEventSeqs: [],
  })
  return event.seq
}

describe('task-basis service', () => {
  it('captures a basis and returns safe when the plan and specs are unchanged', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    const planSeq = appendPlan(session)
    ctx.planSpec.write(session, {
      specId: 'api', planId: 'plan-1', title: 'API', content: '# API', basisPlanRevision: 1,
    })

    const basis = ctx.taskBasis.capture(session, 'task-1')
    expect(basis).toMatchObject({ taskId: 'task-1', planSeq })
    expect(foldTaskBasis(session.events, 'task-1')).toMatchObject({ planSeq })

    const conflict = ctx.taskBasis.check(session, 'task-1')
    expect(conflict.verdict).toBe('safe')
    expect(foldTaskConflict(session.events, 'task-1')?.verdict).toBe('safe')
  })

  it('returns needs-merge when the plan or a spec advanced after capture', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    appendPlan(session)
    ctx.planSpec.write(session, {
      specId: 'api', planId: 'plan-1', title: 'API', content: '# API v1', basisPlanRevision: 1,
    })

    ctx.taskBasis.capture(session, 'task-2')
    ctx.planSpec.write(session, {
      specId: 'api', planId: 'plan-1', title: 'API', content: '# API v2', basisPlanRevision: 1, status: 'active',
    })

    const conflict = ctx.taskBasis.check(session, 'task-2')
    expect(conflict.verdict).toBe('needs-merge')
    expect(conflict.changedSpecs).toEqual([{ specId: 'api', fromSeq: expect.any(Number) as unknown, toSeq: expect.any(Number) as unknown }])
  })

  it('returns blocked when both the plan and a spec advanced after capture', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    appendPlan(session)
    ctx.planSpec.write(session, {
      specId: 'api', planId: 'plan-1', title: 'API', content: '# API v1', basisPlanRevision: 1,
    })

    ctx.taskBasis.capture(session, 'task-3')
    appendPlan(session)
    ctx.planSpec.write(session, {
      specId: 'api', planId: 'plan-1', title: 'API', content: '# API v2', basisPlanRevision: 1, status: 'active',
    })

    const conflict = ctx.taskBasis.check(session, 'task-3')
    expect(conflict.verdict).toBe('blocked')
    expect(conflict.reason).toMatch(/merge decision is required/)
  })

  it('fails closed when checking a task without a captured basis', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    appendPlan(session)
    expect(() => ctx.taskBasis.check(session, 'missing')).toThrow('no captured basis')
  })

  it('folds spec seqs per specId', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    ctx.planSpec.write(session, { specId: 'api', planId: 'plan-1', title: 'API', content: '# API', basisPlanRevision: 1 })
    ctx.planSpec.write(session, { specId: 'db', planId: 'plan-1', title: 'DB', content: '# DB', basisPlanRevision: 1 })
    const seqs = foldSpecSeqs(session.events)
    expect(Object.keys(seqs)).toEqual(['api', 'db'])
    expect(Object.values(seqs).every(seq => typeof seq === 'number')).toBe(true)
  })
})
