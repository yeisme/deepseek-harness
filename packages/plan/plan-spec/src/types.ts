/**
 * Pure types of the plan-spec domain: the ONE home of the `spec-document`
 * projection-key declaration, free of host-side value imports (cordis,
 * services). `./types` serves host consumers and `./client` serves client
 * aggregates with zero content duplication.
 *
 * @module @deepseek-ai/dsh-plan-spec/types
 */

/** One persisted spec document's projection view. */
export interface SpecDocumentProjection {
  specId: string
  planId: string
  revision: number
  title: string
  content: string
  status: 'draft' | 'active' | 'superseded'
  basisPlanRevision: number
  basisSpecVersions: Record<string, number>
}

/** The `spec-document` projection's wire value. */
export interface SpecDocumentProjectionValue {
  /** Latest spec document by log order, or absent before the first one. */
  latest?: SpecDocumentProjection | undefined
  /** Every spec document in log order. */
  revisions: SpecDocumentProjection[]
  /** Latest revision per specId, grouped by planId. */
  byPlan: Record<string, Record<string, SpecDocumentProjection>>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Spec documents folded from whole-value `spec/document` events. */
    'spec-document': SpecDocumentProjectionValue
  }
}
