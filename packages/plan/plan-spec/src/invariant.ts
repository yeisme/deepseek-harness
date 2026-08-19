/** Package-owned durable plan-spec invariants. @module @deepseek-ai/dsh-plan-spec/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-plan-spec'

/** Cordis companion plugin name. */
export const name = 'plan-spec-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one `spec/document` event before it reaches the durable log.
 * `spec/document` is a standalone whole-value event; only its payload shape
 * is checkable.
 */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'spec/document') return
  const data = event.data as {
    specId?: unknown
    planId?: unknown
    revision?: unknown
    title?: unknown
    content?: unknown
    status?: unknown
    basisPlanRevision?: unknown
    basisSpecVersions?: unknown
  }
  if (typeof data.specId !== 'string' || data.specId === '') {
    fail(`spec/document carries invalid specId ${JSON.stringify(data.specId)}`)
  }
  if (typeof data.planId !== 'string' || data.planId === '') {
    fail(`spec/document carries invalid planId ${JSON.stringify(data.planId)}`)
  }
  if (typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 1) {
    fail(`spec/document carries invalid revision ${JSON.stringify(data.revision)}`)
  }
  if (typeof data.title !== 'string' || typeof data.content !== 'string') {
    fail('spec/document carries invalid title or content; expected strings')
  }
  if (data.status !== 'draft' && data.status !== 'active' && data.status !== 'superseded') {
    fail(`spec/document carries invalid status ${JSON.stringify(data.status)}`)
  }
  if (typeof data.basisPlanRevision !== 'number' || !Number.isSafeInteger(data.basisPlanRevision) || data.basisPlanRevision < 1) {
    fail(`spec/document carries invalid basisPlanRevision ${JSON.stringify(data.basisPlanRevision)}`)
  }
  if (typeof data.basisSpecVersions !== 'object' || data.basisSpecVersions === null || Array.isArray(data.basisSpecVersions)) {
    fail('spec/document carries invalid basisSpecVersions; expected a version record')
  }
}

/** Install validation for loaded and newly appended spec state. */
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

/**
 * Register the plan-spec invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
