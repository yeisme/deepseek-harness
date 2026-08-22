import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  openPlanPane,
  registerPlanPaneView,
  type PlanPaneWorkbenchFace,
} from '../src/client/PlanPaneView.tsx'

describe('Plan Pane provider', () => {
  it('registers one contextual content view', () => {
    const registerView = vi.fn(() => vi.fn())
    const pane = { registerView, openView: vi.fn() }
    const dispose = registerPlanPaneView({} as ClientContext, pane)
    expect(registerView).toHaveBeenCalledWith(expect.objectContaining({
      descriptor: expect.objectContaining({
        kind: 'plan.document',
        preferredRegion: 'right',
        role: 'content',
      }),
      component: expect.any(Function),
    }))
    expect(typeof dispose).toBe('function')
  })

  it('opens the Plan view and leaves layout controls to Pane chrome', () => {
    const openView = vi.fn()
    const pane: PlanPaneWorkbenchFace = {
      registerView: vi.fn(() => vi.fn()),
      openView,
    }
    openPlanPane(pane)
    expect(openView).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'plan.document',
      preferredRegion: 'right',
      viewId: 'plan-view:current',
    }))
  })
})
