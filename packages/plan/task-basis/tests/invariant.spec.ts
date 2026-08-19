import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import { apply as applyTaskBasisInvariant } from '../src/invariant.ts'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Invariants)
  await applyTaskBasisInvariant(ctx)
  return ctx
}

describe('task-basis invariant', () => {
  it('accepts valid task/basis and task/conflict events', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    expect(() => session.append('task/basis', {
      taskId: 'task-1', planSeq: 1, specSeqs: {}, capturedAtEventSeq: 0,
    })).not.toThrow()
    expect(() => session.append('task/conflict', {
      taskId: 'task-1', basisPlanSeq: 1, currentPlanSeq: 1, changedSpecs: [], verdict: 'safe', reason: 'unchanged',
    })).not.toThrow()
  })

  it('rejects invalid task/basis and task/conflict payloads', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    expect(() => session.append('task/basis', {
      taskId: '', planSeq: 1, specSeqs: {}, capturedAtEventSeq: 0,
    } as never)).toThrow('taskId')
    expect(() => session.append('task/conflict', {
      taskId: 'task-1', basisPlanSeq: 1, currentPlanSeq: 1, changedSpecs: [], verdict: 'wat', reason: 'x',
    } as never)).toThrow('verdict')
  })
})
