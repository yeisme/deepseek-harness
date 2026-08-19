/**
 * Plan-spec persistence: spec documents are whole-value `spec/document` events
 * keyed by `specId` and owned by a `planId`. The service writes revisions and
 * the optional projection child serves the `spec-document` view for UI and
 * cold reads. Specs are durable, replayable session facts, never filesystem
 * artifacts.
 *
 * @module @deepseek-ai/dsh-plan-spec
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type { SpecDocumentProjection, SpecDocumentProjectionValue } from './types.ts'

// The `spec-document` projection-key declaration lives in src/types.ts (its one
// home); this re-export projects the type face onto the package root AND keeps
// the module edge in the emitted index.d.ts, so aggregate programs consuming
// the declarations still receive the SessionProjectionMap merge.
export type * from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The current spec document for one `specId`, whole-value replace. The
     * latest event per `specId` wins; earlier events retain the revision
     * history. Log-only, never derived history.
     */
    'spec/document': {
      specId: string
      planId: string
      revision: number
      title: string
      content: string
      status: 'draft' | 'active' | 'superseded'
      basisPlanRevision: number
      basisSpecVersions: Record<string, number>
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    planSpec: PlanSpecService
  }
}

/** Input for one spec revision. */
export interface SpecDocumentInput {
  specId: string
  planId: string
  title: string
  content: string
  /** Defaults to `draft`. */
  status?: 'draft' | 'active' | 'superseded'
  basisPlanRevision: number
  basisSpecVersions?: Record<string, number>
}

/** Build a projection view from one event payload. */
function toProjection(data: SessionEventMap['spec/document']): SpecDocumentProjection {
  return {
    specId: data.specId,
    planId: data.planId,
    revision: data.revision,
    title: data.title,
    content: data.content,
    status: data.status,
    basisPlanRevision: data.basisPlanRevision,
    basisSpecVersions: data.basisSpecVersions,
  }
}

type SessionEventMap = import('@deepseek-ai/dsh-session').SessionEventMap

/** Fold the next revision number for one specId (1 before the first write). */
export function foldSpecRevision(events: readonly SessionEvent[], specId: string): number {
  let revision = 0
  for (const event of events) {
    if (event.type === 'spec/document' && event.data.specId === specId) {
      revision = event.data.revision
    }
  }
  return revision + 1
}

/** Fold the latest spec document for one specId, or undefined. */
export function foldSpec(events: readonly SessionEvent[], specId: string): SpecDocumentProjection | undefined {
  let document: SpecDocumentProjection | undefined
  for (const event of events) {
    if (event.type === 'spec/document' && event.data.specId === specId) {
      document = toProjection(event.data)
    }
  }
  return document
}

/** Fold the latest spec document per specId for one plan, or every plan when omitted. */
export function foldSpecsByPlan(
  events: readonly SessionEvent[],
  planId?: string,
): Record<string, Record<string, SpecDocumentProjection>> {
  const byPlan: Record<string, Record<string, SpecDocumentProjection>> = {}
  for (const event of events) {
    if (event.type !== 'spec/document') continue
    if (planId !== undefined && event.data.planId !== planId) continue
    const specs = byPlan[event.data.planId] ?? {}
    specs[event.data.specId] = toProjection(event.data)
    byPlan[event.data.planId] = specs
  }
  return byPlan
}

/** Fold the latest plan status from `plan/document` events, or undefined. */
function foldLatestPlanStatus(events: readonly SessionEvent[]): string | undefined {
  let status: string | undefined
  for (const event of events) {
    if (event.type === 'plan/document') status = event.data.status
  }
  return status
}

/** Projection unit state for the `spec-document` key. */
interface SpecUnitState {
  revisions: SpecDocumentProjection[]
  byPlan: Record<string, Record<string, SpecDocumentProjection>>
}

/** Wire payload schema of the `spec-document` projection. */
const specDocumentSchema = zod.object({
  specId: zod.string(),
  planId: zod.string(),
  revision: zod.number(),
  title: zod.string(),
  content: zod.string(),
  status: zod.union([zod.literal('draft'), zod.literal('active'), zod.literal('superseded')]),
  basisPlanRevision: zod.number(),
  basisSpecVersions: zod.record(zod.string(), zod.number()),
})

const specDocumentProjectionSchema: ZodType<SpecDocumentProjectionValue> = zod.object({
  latest: specDocumentSchema.optional(),
  revisions: zod.array(specDocumentSchema),
  byPlan: zod.record(zod.string(), zod.record(zod.string(), specDocumentSchema)),
})

/**
 * `ctx.planSpec`: owns `spec/document` writes and the optional projection unit.
 * UIs observe committed writes through `session/event`; there is no live mirror.
 */
export class PlanSpecService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'planSpec')

    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'spec-document', SpecUnitState>({
        key: 'spec-document',
        schema: specDocumentProjectionSchema,
        init: () => ({ revisions: [], byPlan: {} }),
        apply: (state, event) => {
          if (event.type !== 'spec/document') return state
          const document = toProjection(event.data)
          const specs = { ...(state.byPlan[document.planId] ?? {}) }
          specs[document.specId] = document
          return {
            revisions: [...state.revisions, document],
            byPlan: { ...state.byPlan, [document.planId]: specs },
          }
        },
        view: state => ({
          latest: state.revisions.at(-1),
          revisions: state.revisions,
          byPlan: state.byPlan,
        }),
        stateVersion: 1,
      })
    })

    ctx.inject(['tools'], (toolCtx) => {
      toolCtx.tools.register(defineTool({
        name: 'spec_write',
        description: 'Write or revise a spec document for the current approved/executing plan.',
        parameters: {
          specId: { type: 'string', required: true },
          planId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          content: { type: 'string', required: true },
          status: { type: 'string', enum: ['draft', 'active', 'superseded'] },
          basisPlanRevision: { type: 'number', required: true },
          basisSpecVersions: { type: 'object', additionalProperties: true },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              specId: { type: 'string', required: true },
              revision: { type: 'number', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute: async (args, exec) => {
          const agent = exec.agent
          if (agent === undefined) throw new Error('spec_write requires a calling agent')
          const status = foldLatestPlanStatus(agent.session.events)
          if (status !== 'approved' && status !== 'executing') {
            throw new Error('spec_write is only available while a plan is approved or executing')
          }
          const form = args as {
            specId: string
            planId: string
            title: string
            content: string
            status?: 'draft' | 'active' | 'superseded'
            basisPlanRevision: number
            basisSpecVersions?: Record<string, number>
          }
          const document = this.write(agent.session, form)
          return { specId: document.specId, revision: document.revision }
        },
      }))

      toolCtx.tools.register(defineTool({
        name: 'spec_read',
        description: 'Read the latest spec document(s) for the current plan.',
        parameters: {
          specId: { type: 'string' },
          planId: { type: 'string' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
          },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute: async (args, exec) => {
          const agent = exec.agent
          if (agent === undefined) throw new Error('spec_read requires a calling agent')
          const form = args as { specId?: string; planId?: string }
          if (form.specId !== undefined) {
            const document = this.current(agent.session, form.specId)
            if (document === undefined) throw new Error(`spec_read: no spec "${form.specId}"`)
            return { result: JSON.parse(JSON.stringify(document)) }
          }
          return { result: JSON.parse(JSON.stringify(this.list(agent.session, form.planId))) }
        },
      }))
    })
  }

  /**
   * Append the next revision of one spec document.
   *
   * @param session The session log to append to.
   * @param input The spec content and basis facts.
   * @returns The appended spec document projection.
   */
  write(session: Session, input: SpecDocumentInput): SpecDocumentProjection {
    if (input.specId === '') throw new Error('plan-spec: specId must be non-empty')
    if (input.planId === '') throw new Error('plan-spec: planId must be non-empty')
    if (input.title === '') throw new Error('plan-spec: title must be non-empty')
    if (!Number.isSafeInteger(input.basisPlanRevision) || input.basisPlanRevision < 1) {
      throw new Error('plan-spec: basisPlanRevision must be a positive safe integer')
    }
    const basisSpecVersions = input.basisSpecVersions ?? {}
    for (const [specId, version] of Object.entries(basisSpecVersions)) {
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error(`plan-spec: basisSpecVersions.${specId} must be a positive safe integer`)
      }
    }
    const revision = foldSpecRevision(session.events, input.specId)
    const document = {
      specId: input.specId,
      planId: input.planId,
      revision,
      title: input.title,
      content: input.content,
      status: input.status ?? 'draft',
      basisPlanRevision: input.basisPlanRevision,
      basisSpecVersions,
    }
    session.append('spec/document', document)
    return toProjection(document)
  }

  /**
   * Read the latest spec document for one specId.
   *
   * @param session The session log to fold.
   * @param specId The spec id to read.
   * @returns The latest spec document, or undefined.
   */
  current(session: Session, specId: string): SpecDocumentProjection | undefined {
    return foldSpec(session.events, specId)
  }

  /**
   * Read the latest spec document per specId, optionally narrowed to one plan.
   *
   * @param session The session log to fold.
   * @param planId Optional owning plan filter.
   * @returns Latest specs grouped by planId then specId.
   */
  list(session: Session, planId?: string): Record<string, Record<string, SpecDocumentProjection>> {
    return foldSpecsByPlan(session.events, planId)
  }
}

export default PlanSpecService
