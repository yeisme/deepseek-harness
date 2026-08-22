/**
 * Pure types of the plan domain: the ONE home of the `plan` projection-key
 * declaration, free of this package's host-side value imports (cordis
 * service, dsh-tools, dsh-agent). Two namespace projections serve it —
 * `./types` for host consumers, `./client` for client aggregates — with zero
 * content duplication.
 *
 * @module @deepseek-ai/dsh-plan-mode/types
 */

/**
 * The plan projection's wire value. `active` is the logged state in force
 * (the last `plan/mode`, inactive before the first); `pending` is true while
 * a logged `/plan` selection (`command/run`) targets a state other than
 * `active` and no later `plan/mode` event has recorded that state. Capability
 * absence (plan-mode not composed) is the key's absence, never a value.
 */
export interface PlanProjection {
  active: boolean
  pending: boolean
}

/** Execution mode selected for an approved plan. */
export type PlanMode = 'linear' | 'goal' | 'dag'

/** One candidate plan option proposed by the model. */
export interface PlanOption {
  optionId: string
  title: string
  summary: string
  markdown: string
  tradeoffs?: string[] | undefined
  estimatedSteps?: number | undefined
  recommended?: boolean | undefined
}

/** One persisted plan document's projection view (the latest `plan/document`). */
export interface PlanDocumentProjection {
  planId: string
  title: string
  markdown: string
  status: 'proposed' | 'approved' | 'executing' | 'completed' | 'superseded' | 'rejected'
  round: number
  feedback?: string | undefined
  mode?: PlanMode | undefined
  goalId?: string | undefined
  selectedOptionId?: string | undefined
}

/** The `plan-document` projection's wire value. */
export interface PlanDocumentProjectionValue {
  /** Latest persisted plan document, or absent before the first one. */
  latest?: PlanDocumentProjection | undefined
  /** Every persisted plan document in log order (proposed/approved/rejected revisions included). */
  revisions: PlanDocumentProjection[]
}

/** One persisted candidate-option set for a plan. */
export interface PlanOptionsProjection {
  planId: string
  round: number
  options: PlanOption[]
  selectedOptionId?: string | undefined
  status: 'proposed' | 'selected' | 'superseded'
}

/** The `plan-options` projection's wire value. */
export interface PlanOptionsProjectionValue {
  /** Latest persisted options, or absent before the first proposal. */
  latest?: PlanOptionsProjection | undefined
  /** Every persisted options set in log order. */
  revisions: PlanOptionsProjection[]
}

/** One task node in a plan DAG. */
export interface PlanTask {
  id: string
  title: string
  description?: string | undefined
  status: 'pending' | 'ready' | 'in_progress' | 'blocked' | 'completed'
  dependencies: string[]
  lane?: string | undefined
  result?: string | undefined
}

/** One persisted DAG snapshot for a plan. */
export interface PlanTasksProjection {
  planId: string
  round: number
  nodes: PlanTask[]
}

/** The `plan-tasks` projection's wire value. */
export interface PlanTasksProjectionValue {
  /** Latest persisted DAG snapshot, or absent before the first write. */
  latest?: PlanTasksProjection | undefined
  /** Every persisted DAG snapshot in log order. */
  revisions: PlanTasksProjection[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Plan collaboration state folded from `command/run` (name `plan`) and `plan/mode` events. */
    plan: PlanProjection
    /** Latest persisted plan document folded from whole-value `plan/document` events. */
    'plan-document': PlanDocumentProjectionValue
    /** Latest persisted candidate plan options folded from `plan/options` events. */
    'plan-options': PlanOptionsProjectionValue
    /** Latest persisted plan DAG folded from `plan/tasks` events. */
    'plan-tasks': PlanTasksProjectionValue
  }
}
