/**
 * Plan mode is logged per-agent collaboration state: while active, a
 * deployment-owned guidance section is included in each model request, and
 * `exit_plan_mode` presents the completed plan for user review, while the
 * `/plan off` command lets a user leave directly. Sandbox mode and approval
 * policy enforce restrictions independently and do not read or write plan
 * state.
 *
 * The state in force is folded from the session log (`plan/mode`, last one
 * wins), so resume and fork restore it without a live mirror. User selections
 * remain pending until the next accepted in-turn pre-step. The service includes
 * the selected state in the proposed step assembly, then appends `plan/mode`
 * from `agent/pre-step` only when the step is accepted. Same-step request
 * retries reuse their assembly.
 *
 * The exit tool remains registered while plan mode is inactive, so entering
 * or leaving plan mode changes only the prompt section, not the request tool
 * catalog.
 *
 * Agent Note:
 * - .agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md
 *
 * @module @deepseek-ai/dsh-plan-mode
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswerItem, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
// Type-only edge: resolves `ctx.commands` for the optional command child.
import type {} from '@deepseek-ai/dsh-commands'
// Type-only: resolves ctx.sessionProjections for the optional unit child.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: resolves ctx.permissionPresets for the optional /plan-readonly bridge.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { PlanDocumentProjection, PlanDocumentProjectionValue, PlanProjection } from './types.ts'
// The `plan` projection-key declaration lives in src/types.ts (its one home);
// this re-export projects the type face onto the package root AND keeps the
// module edge in the emitted index.d.ts, so aggregate programs consuming the
// declarations still receive the SessionProjectionMap merge.
export type * from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whether plan mode is in force from this point on: log-only, non-surface,
     * whole-value replace. The last `plan/mode` wins; a log with none folds to
     * inactive through {@link foldPlanMode}.
     */
    'plan/mode': { active: boolean }

    /**
     * One planning-form request sent by `plan_form`: log-only, append-only
     * interaction record. `requestId` is stable and echoed by its answer.
     */
    'plan/form/request': {
      requestId: string
      /** The plan document this form contributes to, once one exists. */
      planId?: string
      /** 1-based clarification round. */
      round: number
      questions: AskUserQuestionItem[]
    }

    /**
     * The final outcome of one planning form: log-only, append-only. Its
     * `requestId` pairs it with the matching `plan/form/request`.
     */
    'plan/form/answer': {
      requestId: string
      planId?: string
      outcome: 'answered' | 'dismissed' | 'aborted'
      answers: AskUserQuestionAnswerItem[]
      feedback?: string
    }

    /**
     * The current plan document, whole-value replace. The latest event wins;
     * earlier events of the same `planId` retain the submit/review history.
     */
    'plan/document': {
      planId: string
      title: string
      markdown: string
      status: 'proposed' | 'approved' | 'executing' | 'completed' | 'superseded' | 'rejected'
      round: number
      /** Seqs of the `plan/form/request` and `plan/form/answer` events this plan cites. */
      sourceEventSeqs: number[]
      /** The `exit_plan_mode` tool call that submitted this document, when known. */
      sourceToolCallId?: string
      feedback?: string
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    planMode: PlanModeController
  }
}

/**
 * The model-facing exit tool's name. It stays registered while plan mode is
 * inactive so the request tool catalog is stable across transitions.
 */
export const EXIT_PLAN_MODE = 'exit_plan_mode'

/** The model-facing planning-form tool's name. Always registered; execute only in plan mode. */
export const PLAN_FORM_TOOL = 'plan_form'

/** The model-facing plan-completion tool's name. Always registered; execute only when a plan is executing. */
export const PLAN_COMPLETE_TOOL = 'plan_complete'

/** Deployment-owned plan guidance. */
export interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
}

/** The review question's id, echoed in the answer this tool reads. */
const REVIEW_ID = 'plan-review'

/** The review question's approve option label. */
const APPROVE_LABEL = 'Approve'

/** The review question's keep-planning option label. */
const KEEP_PLANNING_LABEL = 'Keep planning'

const EXIT_DESCRIPTION
  = 'Use only in plan mode. Present your plan for the user\'s review and, on approval, leave plan mode. '
  + 'Send the COMPLETE plan as markdown, starting with a # heading that names it. '
  + 'The user may approve (carry out the plan from your next step) or keep '
  + 'planning — their feedback comes back in the tool result; revise and present again.'

/** The plan's first markdown heading (any level), or `undefined` when it has none. */
function firstHeading(plan: string): string | undefined {
  for (const line of plan.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

/**
 * Validate deployment-owned plan guidance. Missing, blank, non-string, or
 * unknown fields fail at plugin load rather than being ignored.
 *
 * @param config Raw plugin config.
 * @returns A detached validated config.
 */
export function resolveConfig(config: PlanModeConfig): PlanModeConfig {
  const section = (config as Partial<PlanModeConfig>).section
  if (typeof section !== 'string') {
    throw new Error('PlanModeConfig needs a string `section`')
  }
  if (section.trim() === '') {
    throw new Error('PlanModeConfig needs a non-empty `section`')
  }
  const unknown = Object.keys(config).filter(key => key !== 'section')
  if (unknown.length > 0) {
    throw new Error(`PlanModeConfig has unknown key(s) ${unknown.join(', ')} — config is { section }`)
  }
  return { section }
}

/**
 * Whether plan mode is active after the first `end` events. The last
 * `plan/mode` wins; a prefix with none is inactive.
 *
 * @param events The session log or any prefix of it.
 * @param end Fold `events[0, end)`; defaults to the whole log.
 * @returns Whether plan mode is active.
 */
export function foldPlanMode(events: readonly SessionEvent[], end = events.length): boolean {
  let active = false
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'plan/mode') active = event.data.active
  }
  return active
}

/**
 * Fold the latest persisted plan document from the first `end` events, or
 * `undefined` before the first `plan/document`. The latest whole-value event
 * wins, so the fold is pure replay.
 *
 * @param events The session log or any prefix of it.
 * @param end Fold `events[0, end)`; defaults to the whole log.
 * @returns The latest plan document, or `undefined`.
 */
export function foldPlanDocument(events: readonly SessionEvent[], end = events.length): PlanDocumentProjection | undefined {
  let document: PlanDocumentProjection | undefined
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'plan/document') {
      document = {
        planId: event.data.planId,
        title: event.data.title,
        markdown: event.data.markdown,
        status: event.data.status,
        round: event.data.round,
        ...event.data.feedback === undefined ? {} : { feedback: event.data.feedback },
      }
    }
  }
  return document
}

/**
 * The stable plan id for a session's current planning flow. The first
 * submitted document owns `plan-<seq>` (its append-time seq); later
 * submissions reuse the log's first `plan/document` id, so the id survives
 * resume and fork as pure log derivation.
 *
 * @param events The session log before the next append.
 * @returns The existing plan id, or the id the next document would own.
 */
export function planIdForSession(events: readonly SessionEvent[]): string {
  let planId: string | undefined
  for (const event of events) {
    if (event.type === 'plan/mode') {
      // Leaving plan mode closes the planning session; the next entry owns a
      // fresh plan id derived from its own append-time seq.
      if (!event.data.active) planId = undefined
    } else if (event.type === 'plan/document') {
      planId = event.data.planId
    }
  }
  return planId ?? `plan-${events.length}`
}

/**
 * The 1-based planning round for the current planning session: one plus the
 * number of `plan/document` events since the latest `plan/mode` entry.
 * Leaving plan mode resets the round for the next session.
 *
 * @param events The session log before the next submit.
 * @returns The round number for the next proposed plan document.
 */
export function planRoundForSession(events: readonly SessionEvent[]): number {
  let round = 0
  for (const event of events) {
    if (event.type === 'plan/mode') {
      round = 0
    } else if (event.type === 'plan/document') {
      round += 1
    }
  }
  return round + 1
}

/**
 * Seqs of every planning-form interaction and prior plan document this plan
 * cites, in ascending log order. A later revision keeps earlier form rounds:
 * they shaped the current plan too. Pure log derivation keeps the association
 * reconstructable after resume.
 *
 * @param events The session log before the next document append.
 * @returns Cited event seqs, in ascending log order.
 */
export function planSourceEventSeqs(events: readonly SessionEvent[]): number[] {
  const seqs: number[] = []
  for (const event of events) {
    if (event.type === 'plan/form/request'
      || event.type === 'plan/form/answer'
      || event.type === 'plan/document') {
      seqs.push(event.seq)
    }
  }
  return seqs
}

/**
 * Projection unit state: the logged mode plus the latest logged `/plan`
 * selection (`command/run`) not yet resolved by a `plan/mode` commit. Plain
 * JSON (persisted-cache precondition).
 */
interface PlanUnitState {
  active: boolean
  /** The selection's target mode; null when no selection is outstanding. */
  wanted: boolean | null
}

/** Projection unit state for the `plan-document` key: latest plus full revision history. */
interface PlanDocumentUnitState {
  latest: PlanDocumentProjection | undefined
  revisions: PlanDocumentProjection[]
}

/** Wire payload schema of the `plan` projection. */
const planProjectionSchema: ZodType<PlanProjection> = zod.object({
  active: zod.boolean(),
  pending: zod.boolean(),
})

/** Wire payload schema of the `plan-document` projection. */
const planDocumentSchema = zod.object({
  planId: zod.string(),
  title: zod.string(),
  markdown: zod.string(),
  status: zod.union([zod.literal('proposed'), zod.literal('approved'), zod.literal('executing'), zod.literal('completed'), zod.literal('superseded'), zod.literal('rejected')]),
  round: zod.number(),
  feedback: zod.string().optional(),
})

/** Wire payload schema of the `plan-document` projection. */
const planDocumentProjectionSchema: ZodType<PlanDocumentProjectionValue> = zod.object({
  latest: planDocumentSchema.optional(),
  revisions: zod.array(planDocumentSchema),
})

/** Whether the log holds an opened turn without its closing `turn/end`. */
function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

/** Plan state at the last logged request header, or `undefined` before the first header. */
function planModeAtLastHeader(events: readonly SessionEvent[]): boolean | undefined {
  let lastHeader = -1
  let index = 0
  for (const event of events) {
    if (event.type === 'request/header') lastHeader = index
    index++
  }
  if (lastHeader < 0) return undefined
  return foldPlanMode(events, lastHeader + 1)
}

/**
 * `ctx.planMode`: owns logged plan state, applies and narrates selected state at step start,
 * the `plan:policy` section, the `/plan` command, and the stable exit tool.
 * UIs observe committed flips through `session/event`; there is no live mirror.
 */
export class PlanModeController extends Service {
  static inject = ['tools', 'systemPrompt']

  /** Validated deployment-owned guidance. */
  private readonly section: string

  /**
   * Latest selection per session awaiting the next accepted in-turn pre-step.
   * `narrate` is true for user selections and false for the exit tool, whose
   * result already narrates the transition.
   */
  private readonly pendingIntents = new WeakMap<Session, { active: boolean; narrate: boolean }>()

  /** Last turn in which the plan-mode forced-output reminder was injected. */
  private readonly lastReminderTurn = new WeakMap<Session, number>()

  constructor(ctx: Context, config: PlanModeConfig = { section: '' }) {
    super(ctx, 'planMode')
    this.section = resolveConfig(config).section
    let disposed = false
    // Pre-step is outside Session.append publication, so it can append the
    // log-only mode event inside an open turn without re-entering the session.
    // A failed append remains pending for a later accepted in-turn pre-step,
    // and policy cannot block the step.
    ctx.on('agent/pre-step', async (
      { agent, signal, turn },
      next,
    ): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      const pending = this.pendingIntents.get(agent.session)
      let result = decision
      if (pending !== undefined) {
        const narration = this.narration(agent.session, pending.active)
        try {
          this.onBoundary(agent.session)
        } catch (error) {
          ctx.logger.warn('dsh-plan-mode: failed to append selected plan mode at step start: %o', error)
          return decision
        }
        if (pending.narrate && narration !== undefined) {
          result = { ...result, messages: [...result.messages, narration] }
        }
      }
      // Forced-output check: in plan mode, if no submittable plan document has
      // been created (or the latest was rejected), remind the model once per
      // turn that prose is not a plan.
      const active = foldPlanMode(agent.session.events)
      const latest = foldPlanDocument(agent.session.events)
      const needsReminder = active && (latest === undefined || latest.status === 'rejected')
      if (needsReminder && this.lastReminderTurn.get(agent.session) !== turn) {
        this.lastReminderTurn.set(agent.session, turn)
        const reminder = createUserMessage({
          content: [{ type: 'text', text: 'You are still in plan mode. Submit a complete plan through exit_plan_mode; prose is not a plan.' }],
          source: { kind: 'plugin', plugin: 'plan-mode', form: 'notice', summary: 'Submit a complete plan through exit_plan_mode.' },
        })
        result = { ...result, messages: [...result.messages, reminder] }
      }
      return result
    })
    ctx.effect(() => () => { disposed = true }, 'dsh-plan-mode: close service lifetime')

    ctx.systemPrompt.section({
      name: 'plan:policy',
      order: 50,
      text: (context) => {
        if (context.agent === undefined) return ''
        const pending = this.pendingIntents.get(context.agent.session)
        return (pending?.active ?? foldPlanMode(context.agent.session.events)) ? this.section : ''
      },
    })

    // The plan projection unit (session-projection RFC): a pure double-event
    // fold serving clients the whole {active, pending} value. `command/run`
    // records the user's logged /plan selection (the handler calls `set()`
    // before any failing path, so a failed handler cannot leave the recorded
    // command without its plan selection); `plan/mode` records that selection
    // and clears it. Pending is thereby a pure
    // replay quantity: host restarts, other tabs, and cold reads all recover
    // it from the log alone. The unit child activates only when a projection
    // registry is composed (headless assemblies stay unaffected).
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'plan', PlanUnitState>({
        key: 'plan',
        schema: planProjectionSchema,
        init: () => ({ active: false, wanted: null }),
        apply: (state, event) => {
          if (event.type === 'command/run' && event.data.name === 'plan') {
            if (event.data.args === undefined) return state
            const wanted = event.data.args.trim() !== 'off'
            return wanted === state.wanted ? state : { active: state.active, wanted }
          }
          if (event.type === 'plan/mode') {
            return { active: event.data.active, wanted: null }
          }
          return state
        },
        view: state => ({
          active: state.active,
          pending: state.wanted !== null && state.wanted !== state.active,
        }),
        stateVersion: 1,
      })

      projectionCtx.sessionProjections.register<'plan-document', PlanDocumentUnitState>({
        key: 'plan-document',
        schema: planDocumentProjectionSchema,
        init: () => ({ latest: undefined, revisions: [] }),
        apply: (state, event) => event.type === 'plan/document'
          ? {
            latest: {
              planId: event.data.planId,
              title: event.data.title,
              markdown: event.data.markdown,
              status: event.data.status,
              round: event.data.round,
              ...event.data.feedback === undefined ? {} : { feedback: event.data.feedback },
            },
            revisions: [...state.revisions, {
              planId: event.data.planId,
              title: event.data.title,
              markdown: event.data.markdown,
              status: event.data.status,
              round: event.data.round,
              ...event.data.feedback === undefined ? {} : { feedback: event.data.feedback },
            }],
          }
          : state,
        view: state => ({ latest: state.latest, revisions: state.revisions }),
        stateVersion: 2,
      })
    })

    // The command child activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'plan',
        description: 'Enter or leave plan mode',
        input: { hint: '[off|message]' },
        handler: ({ agent, rawInput }) => {
          const message = rawInput.trim()
          if (message === 'off') {
            switch (this.set(agent, false)) {
              case 'committed':
                return { kind: 'success', text: 'Plan mode off.' }
              case 'queued':
                return { kind: 'success', text: 'Leaving plan mode (applies from the next step).' }
              case 'cancelled':
                return { kind: 'success', text: 'Plan mode entry cancelled.' }
              case 'noop':
                // Repeat the queued wording while an exit still awaits the
                // next accepted pre-step; only a truly inactive session reads
                // idempotent.
                return foldPlanMode(agent.session.events)
                  ? { kind: 'success', text: 'Leaving plan mode (applies from the next step).' }
                  : { kind: 'success', text: 'Plan mode is already inactive.' }
            }
          }
          const outcome = this.set(agent, true)
          if (message !== '') agent.steer(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
          return {
            kind: 'success',
            text: outcome === 'committed'
              ? 'Plan mode on. Use /plan off to leave.'
              : 'Entering plan mode (applies from the next step). Use /plan off to leave.',
          }
        },
      })
    })

    // Optional one-key bridge: register /plan-readonly only when both the
    // command registry and the permission-presets service are composed. Plan
    // state still comes from `this.set`; the file policy comes from the
    // permission-presets owner, never from plan state itself.
    ctx.inject(['commands', 'permissionPresets'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'plan-readonly',
        description: 'Enter plan mode with read-only file policy',
        input: { hint: '[message]' },
        handler: ({ agent, rawInput }) => {
          const message = rawInput.trim()
          const outcome = this.set(agent, true)
          try {
            commandCtx.permissionPresets.set(agent.session, 'read-only')
          } catch (error) {
            return { kind: 'error', text: `plan-readonly: ${error instanceof Error ? error.message : String(error)}` }
          }
          if (message !== '') agent.steer(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
          return {
            kind: 'success',
            text: outcome === 'committed'
              ? 'Plan mode on with read-only file policy. Use /plan off to leave plan mode; use /permission workspace-write to restore writes.'
              : 'Entering plan mode with read-only file policy (applies from the next step).',
          }
        },
      })
    })

    ctx.tools.register(defineTool({
      name: EXIT_PLAN_MODE,
      description: EXIT_DESCRIPTION,
      parameters: {
        plan: { type: 'string', required: true, description: 'The complete plan, as markdown, starting with a # heading that names it.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            approved: { type: 'boolean', const: true, required: true },
          },
        },
        render: () => [{ type: 'text', text: 'Plan approved — plan mode exited; carry out the plan starting with your next step.' }],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error(`${EXIT_PLAN_MODE} requires a calling agent (no session to switch)`)
        if (!foldPlanMode(agent.session.events)) {
          throw new Error(`${EXIT_PLAN_MODE} is only available in plan mode`)
        }
        if (!/^#\s+\S/.test(args.plan.trim())) {
          throw new Error(`${EXIT_PLAN_MODE} requires a non-empty markdown plan starting with a # heading`)
        }
        const interaction = ctx.get('userQuestions')
        if (interaction === undefined) {
          throw new Error('no user-questions channel is available to review the plan; ask the user to switch the session mode instead')
        }
        const planId = planIdForSession(agent.session.events)
        const round = planRoundForSession(agent.session.events)
        const sourceEventSeqs = planSourceEventSeqs(agent.session.events)
        const document = {
          planId,
          title: firstHeading(args.plan) ?? 'Plan',
          markdown: args.plan,
          status: 'proposed' as const,
          round,
          sourceEventSeqs,
          sourceToolCallId: String(exec.callId),
        }
        agent.session.append('plan/document', document)
        const answer = await interaction.ask({
          questions: [{
            id: REVIEW_ID,
            header: 'Plan review',
            question: 'Approve this plan and leave plan mode?',
            detail: args.plan,
            options: [
              { label: APPROVE_LABEL, description: 'Leave plan mode; the plan is carried out from the next step.' },
              { label: KEEP_PLANNING_LABEL, description: 'Stay in plan mode; feedback goes back to the model.' },
            ],
            // Presentation only: a capable UI renders the plan as a review
            // decision instead of a generic question, and answers with one of
            // the labels above either way.
            intent: { kind: 'plan-review', approve: APPROVE_LABEL },
          }],
          agent,
          signal: exec.signal,
        }).catch((cause: unknown) => {
          // A dismissed review is not a failed one: the user took the turn back
          // to say something the two options do not cover. Say so, because the
          // generic channel message names ask_user_question, which the model
          // never called. An abort (turn cancel, provider teardown) keeps its
          // own message — there is no user to wait for.
          if (cause instanceof UserQuestionError && cause.code === 'ASK_CANCELLED') {
            agent.session.append('plan/document', { ...document, status: 'rejected', sourceEventSeqs: planSourceEventSeqs(agent.session.events), feedback: 'review dismissed' })
            throw new Error('The user dismissed the plan review to speak instead; '
              + 'stay in plan mode, stop here, and wait for their message.')
          }
          throw cause
        })
        // A review may outlive this plugin fiber. Without its pre-step listener,
        // an approved selection could never be appended, so fail and keep planning.
        if (disposed) {
          throw new Error('the plan-mode service was reloaded while the plan was under review; present the plan again')
        }
        const reviewItems = answer.answers.filter(entry => entry.id === REVIEW_ID)
        const item = reviewItems.length === 1 ? reviewItems[0] : undefined
        if (item?.selected.length !== 1 || item.selected[0] !== APPROVE_LABEL || item.custom !== undefined) {
          const feedback = item?.custom ?? ''
          agent.session.append('plan/document', { ...document, status: 'rejected', sourceEventSeqs: planSourceEventSeqs(agent.session.events), ...feedback === '' ? {} : { feedback } })
          throw new Error(feedback === ''
            ? 'The user chose to keep planning; revise the plan and present it again.'
            : `The user chose to keep planning; their feedback: ${feedback}`)
        }
        const approved = {
          ...document,
          status: 'approved' as const,
          sourceEventSeqs: planSourceEventSeqs(agent.session.events),
        }
        agent.session.append('plan/document', approved)
        agent.session.append('plan/document', { ...approved, status: 'executing' as const })
        // Keep plan guidance for the rest of this assistant tool batch. The
        // silent selection is appended at the next accepted in-turn pre-step,
        // before its request assembly.
        this.pendingIntents.set(agent.session, { active: false, narrate: false })
        agent.steer(createUserMessage({
          content: [{ type: 'text', text: 'Execute the approved plan. Start with the first task.' }],
          source: { kind: 'plugin', plugin: 'plan-mode', form: 'notice', summary: 'Execute the approved plan.' },
        }))
        return { approved: true }
      },
      presentCall: args => ({
        card: 'generic',
        title: firstHeading(args.plan) ?? 'Plan',
        kind: 'other',
        content: [{ type: 'text', text: args.plan }],
      }),
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'Plan review',
        content: result.content,
      }),
    }))

    ctx.tools.register(defineTool({
      name: PLAN_FORM_TOOL,
      description:
        'Use only in plan mode. Ask the user a structured planning form before drafting or revising a plan. '
        + 'Send one or more questions in a single form; prefer grouped, decision-relevant questions over repeated small prompts. '
        + 'The answers come back as structured text for the next step.',
      parameters: {
        questions: {
          type: 'array',
          required: true,
          description: 'Questions to ask the user before continuing the plan.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: { type: 'string', required: true, description: 'Stable id for this question; echoed in the answer.' },
              question: { type: 'string', required: true, description: 'The specific question to ask the user.' },
              header: { type: 'string', description: 'Optional short heading for the question.' },
              detail: { type: 'string', description: 'Optional supporting detail rendered with the question.' },
              options: {
                type: 'array',
                description: 'Optional choices to show the user.',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    label: { type: 'string', required: true, description: 'Short user-facing option label.' },
                    description: { type: 'string', description: 'One sentence explaining the tradeoff or impact.' },
                  },
                },
              },
              multi_select: { type: 'boolean', description: 'Whether the user may select more than one option. Defaults to false.' },
            },
          },
        },
        header: { type: 'string', description: 'Optional form title; defaults to "Planning form".' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            requestId: { type: 'string', required: true },
            answers: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  selected: { type: 'array', required: true, items: { type: 'string' } },
                  custom: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error(`${PLAN_FORM_TOOL} requires a calling agent (no session to ask)`)
        if (!foldPlanMode(agent.session.events)) {
          throw new Error(`${PLAN_FORM_TOOL} is only available in plan mode`)
        }
        const interaction = ctx.get('userQuestions')
        if (interaction === undefined) {
          throw new Error('no user-questions channel is available for the planning form; ask the user to switch the session mode instead')
        }
        const form = args as { questions: AskUserQuestionItem[]; header?: string }
        if (!Array.isArray(form.questions) || form.questions.length === 0) {
          throw new Error(`${PLAN_FORM_TOOL} requires at least one question`)
        }
        const requestId = `plan-form-${agent.session.events.length}`
        const existing = foldPlanDocument(agent.session.events)
        const planId = existing?.planId
        const round = planRoundForSession(agent.session.events)
        const intent = {
          kind: 'plan-form' as const,
          ...form.header === undefined ? {} : { title: form.header },
          ...planId === undefined ? {} : { planId },
        }
        const questions = form.questions.map(question => ({
          ...question,
          // A planning form is a form, never a final plan review.
          intent,
        }))
        agent.session.append('plan/form/request', {
          requestId,
          ...planId === undefined ? {} : { planId },
          round,
          questions,
        })
        try {
          const answer = await interaction.ask({ questions, agent, signal: exec.signal })
          agent.session.append('plan/form/answer', {
            requestId,
            ...planId === undefined ? {} : { planId },
            outcome: 'answered',
            answers: answer.answers,
          })
          return { requestId, answers: answer.answers }
        } catch (cause) {
          if (cause instanceof UserQuestionError && cause.code === 'ASK_CANCELLED') {
            agent.session.append('plan/form/answer', {
              requestId,
              ...planId === undefined ? {} : { planId },
              outcome: 'dismissed',
              answers: [],
            })
            throw new Error('The user dismissed the planning form to speak instead; '
              + 'stay in plan mode, stop here, and wait for their message.')
          }
          agent.session.append('plan/form/answer', {
            requestId,
            ...planId === undefined ? {} : { planId },
            outcome: 'aborted',
            answers: [],
          })
          throw cause
        }
      },
      presentCall: (args) => {
        const form = args as { questions: AskUserQuestionItem[]; header?: string }
        return {
          card: 'generic',
          title: form.header ?? 'Planning form',
          kind: 'other',
          content: [{ type: 'text', text: `${form.questions.length} question(s) to answer before drafting the plan.` }],
        }
      },
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'Planning form answers',
        content: result.content,
      }),
    }))

    ctx.tools.register(defineTool({
      name: PLAN_COMPLETE_TOOL,
      description:
        'Mark the currently executing plan as completed. Use only after the approved plan has been fully carried out.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            planId: { type: 'string', required: true },
            completed: { type: 'boolean', const: true, required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (_args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error(`${PLAN_COMPLETE_TOOL} requires a calling agent (no session to complete)`)
        const latest = foldPlanDocument(agent.session.events)
        if (latest === undefined || latest.status !== 'executing') {
          throw new Error(`${PLAN_COMPLETE_TOOL} is only available while a plan is executing`)
        }
        agent.session.append('plan/document', {
          planId: latest.planId,
          title: latest.title,
          markdown: latest.markdown,
          status: 'completed',
          round: latest.round,
          sourceEventSeqs: [],
          ...latest.feedback === undefined ? {} : { feedback: latest.feedback },
        })
        return { planId: latest.planId, completed: true }
      },
      presentCall: () => ({
        card: 'generic',
        title: 'Plan completion',
        kind: 'other',
        content: [],
      }),
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'Plan completed',
        content: result.content,
      }),
    }))
  }

  /**
   * Read the logged plan state and any selected state awaiting the next
   * accepted in-turn pre-step.
   *
   * @param agent The agent to read.
   * @returns Current logged state plus a pending selection, when present.
   */
  get(agent: Agent): { active: boolean; pending?: boolean } {
    const active = foldPlanMode(agent.session.events)
    const pending = this.pendingIntents.get(agent.session)
    return pending === undefined ? { active } : { active, pending: pending.active }
  }

  /**
   * Select whether plan mode should be active. Between turns the method
   * appends the change immediately because no in-turn pre-step will run until
   * another prompt starts a turn. The open-turn fold is the idle signal:
   * agent status stays `running` through post-turn checkpointing, when no
   * further in-turn pre-step runs. During an open turn the selection remains
   * pending until the next accepted in-turn pre-step. Repeated selection of
   * the current or already-pending state is a no-op.
   *
   * @param agent The agent to switch.
   * @param active Whether plan mode should be active.
   * @returns what happened: `committed` (logged now), `queued` (awaiting the
   * next accepted in-turn pre-step), `cancelled` (an opposite pending selection
   * was cleared; the logged state already matches), or `noop` (already in that
   * state).
   */
  set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop' {
    const session = agent.session
    const pending = this.pendingIntents.get(session)
    const target = pending?.active ?? foldPlanMode(session.events)
    if (active === target) return 'noop'
    if (hasOpenTurn(session.events)) {
      this.pendingIntents.set(session, { active, narrate: true })
      return foldPlanMode(session.events) === active ? 'cancelled' : 'queued'
    }
    // No open turn: commit now. Delete only after append succeeds so a
    // failed durable write leaves the selection retryable, not dropped.
    if (active === foldPlanMode(session.events)) {
      this.pendingIntents.delete(session)
      return 'cancelled'
    }
    session.append('plan/mode', { active })
    this.pendingIntents.delete(session)
    const narration = this.narration(session, active)
    if (narration !== undefined) agent.inject(narration)
    return 'committed'
  }

  /** Append one pending selection before the next request assembly. */
  private onBoundary(session: Session): void {
    const pending = this.pendingIntents.get(session)
    if (pending === undefined) return
    const target = pending.active
    if (target === foldPlanMode(session.events)) {
      this.pendingIntents.delete(session)
      return
    }
    session.append('plan/mode', { active: target })
    // Delete only after append succeeds so a later accepted in-turn pre-step
    // can retry a failed durable write.
    this.pendingIntents.delete(session)
  }

  /** Build a user-switch notice when the last logged header described the other mode. */
  private narration(session: Session, target: boolean): UserMessage | undefined {
    const told = planModeAtLastHeader(session.events)
    if (told === undefined || told === target) return
    const text = target
      ? 'The user switched this session to plan mode.'
      : 'The user switched this session back to the default mode.'
    return createUserMessage({
      content: [{ type: 'text', text }],
      // The narration is already one sentence, so it is its own summary.
      source: { kind: 'plugin', plugin: 'plan-mode', form: 'notice', summary: text },
    })
  }
}

export default PlanModeController
