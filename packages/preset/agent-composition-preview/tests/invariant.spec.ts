/**
 * The invariant companion registers package ownership with the invariant
 * service and installs nothing else: the package owns no event stream or
 * mutable runtime data.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'

describe('@deepseek-ai/dsh-agent-composition-preview/invariant', () => {
  it('registers the package-owned empty companion', async () => {
    const register = vi.fn(() => vi.fn())
    const ctx = new Context()
    ctx.provide('invariants', { register })
    const dispose = await apply(ctx)
    expect(name).toBe('agent-composition-preview-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-agent-composition-preview', expect.any(Function))
    dispose()
  })
})
