/**
 * Task-basis conflict detection over the session log. A long-running task
 * captures the latest `plan/document` seq and `spec/document` seqs before it
 * starts, then checks them again before committing. Versions are event seqs —
 * already monotonic, whole-log, and reconstructable without a revision field
 * on every document type.
 *
 * @module @deepseek-ai/dsh-task-basis
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-plan-spec'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Long-running task basis: the plan/spec seqs the task was based on. */
    'task/basis': {
      taskId: string
      planSeq: number
      specSeqs: Record<string, number>
      capturedAtEventSeq: number
    }

    /** Derived conflict between a task basis and the current plan/spec fold. */
    'task/conflict': {
      taskId: string
      basisPlanSeq: number
      currentPlanSeq: number
      changedSpecs: { specId: string; fromSeq: number; toSeq: number }[]
      verdict: 'safe' | 'needs-merge' | 'blocked'
      reason: string
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskBasis: TaskBasisService
  }
}

/** Captured basis for one task. */
export interface TaskBasis {
  taskId: string
  planSeq: number
  specSeqs: Record<string, number>
  capturedAtEventSeq: number
}

/** Conflict verdict derived from one basis vs the current fold. */
export interface TaskConflict {
  taskId: string
  basisPlanSeq: number
  currentPlanSeq: number
  changedSpecs: { specId: string; fromSeq: number; toSeq: number }[]
  verdict: 'safe' | 'needs-merge' | 'blocked'
  reason: string
}

/** Fold the latest `plan/document` seq, or undefined before the first. */
export function foldPlanSeq(events: readonly SessionEvent[]): number | undefined {
  let seq: number | undefined
  for (const event of events) {
    if (event.type === 'plan/document') seq = event.seq
  }
  return seq
}

/** Fold the latest `spec/document` seq per specId. */
export function foldSpecSeqs(events: readonly SessionEvent[]): Record<string, number> {
  const seqs: Record<string, number> = {}
  for (const event of events) {
    if (event.type === 'spec/document') seqs[event.data.specId] = event.seq
  }
  return seqs
}

/** Fold the latest basis for one taskId, or undefined. */
export function foldTaskBasis(events: readonly SessionEvent[], taskId: string): TaskBasis | undefined {
  let basis: TaskBasis | undefined
  for (const event of events) {
    if (event.type === 'task/basis' && event.data.taskId === taskId) {
      basis = {
        taskId: event.data.taskId,
        planSeq: event.data.planSeq,
        specSeqs: event.data.specSeqs,
        capturedAtEventSeq: event.data.capturedAtEventSeq,
      }
    }
  }
  return basis
}

/** Fold the latest conflict for one taskId, or undefined. */
export function foldTaskConflict(events: readonly SessionEvent[], taskId: string): TaskConflict | undefined {
  let conflict: TaskConflict | undefined
  for (const event of events) {
    if (event.type === 'task/conflict' && event.data.taskId === taskId) {
      conflict = {
        taskId: event.data.taskId,
        basisPlanSeq: event.data.basisPlanSeq,
        currentPlanSeq: event.data.currentPlanSeq,
        changedSpecs: event.data.changedSpecs,
        verdict: event.data.verdict,
        reason: event.data.reason,
      }
    }
  }
  return conflict
}

/**
 * `ctx.taskBasis`: captures the plan/spec basis a long task is based on and
 * derives a conflict verdict from the current fold before commit.
 */
export class TaskBasisService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'taskBasis')
  }

  /**
   * Capture the current plan seq and latest spec seqs as one task's basis.
   * @param session The session log the task runs in.
   * @param taskId The task id to key the basis by.
   * @returns The appended basis.
   */
  capture(session: Session, taskId: string): TaskBasis {
    const planSeq = foldPlanSeq(session.events)
    if (planSeq === undefined) {
      throw new Error('task-basis: capture requires an existing plan/document')
    }
    const basis: TaskBasis = {
      taskId,
      planSeq,
      specSeqs: foldSpecSeqs(session.events),
      capturedAtEventSeq: session.events.length,
    }
    session.append('task/basis', basis)
    return basis
  }

  /**
   * Compare the captured basis with the current plan/spec fold and append a
   * `task/conflict` verdict.
   * @param session The session log the task runs in.
   * @param taskId The task id whose basis should be checked.
   * @returns The appended conflict.
   */
  check(session: Session, taskId: string): TaskConflict {
    const basis = foldTaskBasis(session.events, taskId)
    if (basis === undefined) {
      throw new Error(`task-basis: no captured basis for task "${taskId}"`)
    }
    const currentPlanSeq = foldPlanSeq(session.events) ?? basis.planSeq
    const currentSpecSeqs = foldSpecSeqs(session.events)
    const changedSpecs = Object.entries(currentSpecSeqs)
      .filter(([specId, toSeq]) => basis.specSeqs[specId] !== toSeq)
      .map(([specId, toSeq]) => ({ specId, fromSeq: basis.specSeqs[specId] ?? 0, toSeq }))
    const removedSpecs = Object.keys(basis.specSeqs).filter(specId => currentSpecSeqs[specId] === undefined)
      .map(specId => ({ specId, fromSeq: basis.specSeqs[specId] ?? 0, toSeq: 0 }))
    const allChanged = [...changedSpecs, ...removedSpecs]

    let verdict: TaskConflict['verdict']
    let reason: string
    if (currentPlanSeq === basis.planSeq && allChanged.length === 0) {
      verdict = 'safe'
      reason = 'the task basis matches the current plan and spec fold'
    } else if (currentPlanSeq !== basis.planSeq && allChanged.length > 0) {
      verdict = 'blocked'
      reason = `plan advanced from seq ${String(basis.planSeq)} to seq ${String(currentPlanSeq)} and ${String(allChanged.length)} spec(s) changed; a merge decision is required`
    } else {
      verdict = 'needs-merge'
      reason = currentPlanSeq !== basis.planSeq
        ? `plan advanced from seq ${String(basis.planSeq)} to seq ${String(currentPlanSeq)}`
        : `${String(allChanged.length)} spec(s) changed since the task basis`
    }
    const conflict: TaskConflict = {
      taskId,
      basisPlanSeq: basis.planSeq,
      currentPlanSeq,
      changedSpecs: allChanged,
      verdict,
      reason,
    }
    session.append('task/conflict', conflict)
    return conflict
  }
}

export default TaskBasisService
