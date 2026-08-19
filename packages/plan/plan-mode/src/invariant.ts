/** Package-owned durable plan-mode invariants. @module @deepseek-ai/dsh-plan-mode/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-plan-mode'

/** Cordis companion plugin name. */
export const name = 'plan-mode-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one plan-domain event before it reaches the durable log.
 * `plan/mode`, `plan/form/request`, `plan/form/answer`, and `plan/document`
 * are standalone log-only events: they carry whole values and no
 * turn-enclosure relation, so only their payload shapes are checkable.
 */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  switch (event.type) {
    case 'plan/mode': {
      const active = (event.data as { active?: unknown }).active
      if (typeof active !== 'boolean') {
        fail(`plan/mode carries invalid active state ${JSON.stringify(active)}; expected a boolean`)
      }
      return
    }
    case 'plan/form/request': {
      const data = event.data as { requestId?: unknown; round?: unknown; questions?: unknown }
      if (typeof data.requestId !== 'string' || data.requestId === '') {
        fail(`plan/form/request carries invalid requestId ${JSON.stringify(data.requestId)}`)
      }
      if (typeof data.round !== 'number' || !Number.isSafeInteger(data.round) || data.round < 1) {
        fail(`plan/form/request carries invalid round ${JSON.stringify(data.round)}`)
      }
      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        fail('plan/form/request carries no questions')
      }
      return
    }
    case 'plan/form/answer': {
      const data = event.data as { requestId?: unknown; outcome?: unknown; answers?: unknown }
      if (typeof data.requestId !== 'string' || data.requestId === '') {
        fail(`plan/form/answer carries invalid requestId ${JSON.stringify(data.requestId)}`)
      }
      if (data.outcome !== 'answered' && data.outcome !== 'dismissed' && data.outcome !== 'aborted') {
        fail(`plan/form/answer carries invalid outcome ${JSON.stringify(data.outcome)}`)
      }
      if (!Array.isArray(data.answers)) {
        fail('plan/form/answer carries invalid answers; expected an array')
      }
      return
    }
    case 'plan/document': {
      const data = event.data as { planId?: unknown; title?: unknown; markdown?: unknown; status?: unknown; round?: unknown; sourceEventSeqs?: unknown }
      if (typeof data.planId !== 'string' || data.planId === '') {
        fail(`plan/document carries invalid planId ${JSON.stringify(data.planId)}`)
      }
      if (typeof data.title !== 'string' || typeof data.markdown !== 'string') {
        fail('plan/document carries invalid title or markdown; expected strings')
      }
      if (data.status !== 'proposed' && data.status !== 'approved' && data.status !== 'executing' && data.status !== 'completed' && data.status !== 'superseded' && data.status !== 'rejected') {
        fail(`plan/document carries invalid status ${JSON.stringify(data.status)}`)
      }
      if (typeof data.round !== 'number' || !Number.isSafeInteger(data.round) || data.round < 1) {
        fail(`plan/document carries invalid round ${JSON.stringify(data.round)}`)
      }
      if (!Array.isArray(data.sourceEventSeqs) || data.sourceEventSeqs.some(seq => typeof seq !== 'number')) {
        fail('plan/document carries invalid sourceEventSeqs; expected a number array')
      }
      return
    }
  }
}

/** Install validation for loaded and newly appended plan-mode state. */
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
 * Register the plan-mode invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
