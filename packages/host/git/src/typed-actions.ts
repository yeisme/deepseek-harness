/**
 * Additive GitTypedActionsCapabilityV1.
 *
 * Closed action ids only. Arbitrary argv is rejected. worktree.remove must
 * not release an Ordo writer lease.
 *
 * @module @deepseek-ai/dsh-host-git/typed-actions
 */

export const GIT_TYPED_ACTIONS_CAPABILITY = 'GitTypedActionsCapabilityV1' as const

export const GIT_TYPED_ACTIONS = [
  'status',
  'diff',
  'stage',
  'unstage',
  'commit',
  'worktree.create',
  'worktree.remove',
] as const

export type GitTypedActionId = (typeof GIT_TYPED_ACTIONS)[number]

export interface GitTypedActionRequest {
  readonly action: string
  readonly argv?: readonly string[]
  readonly previewDigest?: string
  readonly expectedRevision?: string
  readonly idempotencyKey?: string
}

export interface GitTypedActionReceipt {
  readonly action: GitTypedActionId
  readonly status: 'accepted' | 'rejected'
  readonly reason?: string
}

const MUTATING = new Set<GitTypedActionId>(['commit', 'worktree.create', 'worktree.remove'])

export function isGitTypedActionId(action: string): action is GitTypedActionId {
  return (GIT_TYPED_ACTIONS as readonly string[]).includes(action)
}

export function validateGitTypedAction(request: GitTypedActionRequest): GitTypedActionReceipt {
  if (request.argv !== undefined && request.argv.length > 0) {
    return { action: 'status', status: 'rejected', reason: 'arbitrary argv is out of contract' }
  }
  if (!isGitTypedActionId(request.action)) {
    return { action: 'status', status: 'rejected', reason: 'unknown action' }
  }
  if (MUTATING.has(request.action)
    && (request.previewDigest === undefined
      || request.expectedRevision === undefined
      || request.idempotencyKey === undefined)) {
    return { action: request.action, status: 'rejected', reason: 'mutating actions require preview digest, expected revision, and idempotency key' }
  }
  return { action: request.action, status: 'accepted' }
}

export function worktreeRemoveReleasesOrdoLease(): false {
  return false
}
