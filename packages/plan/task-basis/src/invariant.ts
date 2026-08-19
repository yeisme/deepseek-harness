/** Package-owned durable task-basis invariants. @module @deepseek-ai/dsh-task-basis/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-task-basis'

export const name = 'task-basis-invariant'
export const inject = ['invariants']

function validateBasis(data: Record<string, unknown>, fail: InvariantFailure): void {
  if (typeof data['taskId'] !== 'string' || data['taskId'] === '') {
    fail(`task/basis carries invalid taskId ${JSON.stringify(data['taskId'])}`)
  }
  if (typeof data['planSeq'] !== 'number' || !Number.isSafeInteger(data['planSeq']) || (data['planSeq'] as number) < 0) {
    fail(`task/basis carries invalid planSeq ${JSON.stringify(data['planSeq'])}`)
  }
  if (typeof data['specSeqs'] !== 'object' || data['specSeqs'] === null || Array.isArray(data['specSeqs'])) {
    fail('task/basis carries invalid specSeqs; expected a record')
  }
  if (typeof data['capturedAtEventSeq'] !== 'number' || !Number.isSafeInteger(data['capturedAtEventSeq']) || (data['capturedAtEventSeq'] as number) < 0) {
    fail(`task/basis carries invalid capturedAtEventSeq ${JSON.stringify(data['capturedAtEventSeq'])}`)
  }
}

function validateConflict(data: Record<string, unknown>, fail: InvariantFailure): void {
  if (typeof data['taskId'] !== 'string' || data['taskId'] === '') {
    fail(`task/conflict carries invalid taskId ${JSON.stringify(data['taskId'])}`)
  }
  if (data['verdict'] !== 'safe' && data['verdict'] !== 'needs-merge' && data['verdict'] !== 'blocked') {
    fail(`task/conflict carries invalid verdict ${JSON.stringify(data['verdict'])}`)
  }
  if (typeof data['reason'] !== 'string') {
    fail('task/conflict carries invalid reason; expected a string')
  }
  if (!Array.isArray(data['changedSpecs'])) {
    fail('task/conflict carries invalid changedSpecs; expected an array')
  }
}

function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'task/basis') validateBasis(event.data as Record<string, unknown>, fail)
  if (event.type === 'task/conflict') validateConflict(event.data as Record<string, unknown>, fail)
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const seed = (session: Session): void => {
    for (const event of session.events) validateEvent(event, fail)
  }
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
