import { describe, expect, it } from 'vitest'
import {
  validateGitTypedAction,
  worktreeRemoveReleasesOrdoLease,
} from '../src/typed-actions.ts'

describe('GitTypedActionsCapabilityV1', () => {
  it('rejects arbitrary argv and unknown actions', () => {
    expect(validateGitTypedAction({ action: 'status', argv: ['-c', 'core.foo=1'] }).status).toBe('rejected')
    expect(validateGitTypedAction({ action: 'push' }).reason).toBe('unknown action')
  })

  it('requires preview fields for mutating actions', () => {
    expect(validateGitTypedAction({ action: 'commit' }).status).toBe('rejected')
    expect(validateGitTypedAction({
      action: 'worktree.remove',
      previewDigest: 'abc',
      expectedRevision: 'def',
      idempotencyKey: 'k1',
    }).status).toBe('accepted')
  })

  it('never maps worktree.remove to an Ordo lease release', () => {
    expect(worktreeRemoveReleasesOrdoLease()).toBe(false)
  })
})
