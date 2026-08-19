// @vitest-environment jsdom
/**
 * PlanChip over the `plan` projection: absent capability and pending-exit
 * targets render nothing; the steady default target renders an entry chip that
 * executes /plan; active and pending-entry targets render the warn chip that
 * executes /plan off. Failures stay visible until the projection confirms.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { PlanProjection } from '@deepseek-ai/dsh-plan-mode/client'
import { PlanChip, type PlanChipProps } from '../src/client/PlanModeControl.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: PlanChipProps['t'] = makeTranslate(zh, commonZh)

function setup(
  plan: PlanProjection | undefined,
  exitPlanMode = vi.fn(() => Promise.resolve<string | null>(null)),
  enterPlanMode = vi.fn(() => Promise.resolve<string | null>(null)),
  locked = false,
) {
  const store = createSnapshotStore<{ value: PlanProjection | undefined }>({ value: plan })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const props = { useProjection, locked, exitPlanMode, enterPlanMode, t } as unknown as PlanChipProps
  const view = render(<PlanChip {...props} />)
  return { store, exitPlanMode, enterPlanMode, view }
}

const activeChip = () => screen.getByRole('button', { name: 'plan mode 已开启，按下关闭' })
const offChip = () => screen.getByRole('button', { name: 'plan mode 已关闭，按下开启' })

describe('PlanChip', () => {
  it('renders nothing for an absent capability or a pending-exit target', () => {
    const absent = setup(undefined)
    expect(absent.view.container.innerHTML).toBe('')
    cleanup()
    const leaving = setup({ active: true, pending: true })
    expect(leaving.view.container.innerHTML).toBe('')
  })

  it('renders the inactive Plan entry for a steady default-mode target', () => {
    const { enterPlanMode } = setup({ active: false, pending: false })
    expect(offChip().textContent).toBe('Plan')
    expect(offChip().querySelector('span')).toBeNull()
    expect(enterPlanMode).not.toHaveBeenCalled()
  })

  it('renders the active Plan status for active and pending-entry targets', () => {
    setup({ active: true, pending: false })
    expect(activeChip().textContent).toBe('Plan')
    cleanup()
    setup({ active: false, pending: true })
    expect(activeChip().textContent).toBe('Plan')
  })

  it('executes /plan once and follows the projection up', async () => {
    let resolve!: (value: string | null) => void
    const enterPlanMode = vi.fn(() => new Promise<string | null>((done) => { resolve = done }))
    const { store } = setup({ active: false, pending: false }, vi.fn(), enterPlanMode)
    fireEvent.click(offChip())
    expect(enterPlanMode).toHaveBeenCalledTimes(1)
    fireEvent.click(offChip())
    expect(enterPlanMode).toHaveBeenCalledTimes(1)
    resolve(null)
    store.set({ value: { active: false, pending: true } })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'plan mode 已关闭，按下开启' })).toBeNull()
      expect(activeChip()).toBeTruthy()
    })
  })

  it('executes /plan off once and follows the projection down', async () => {
    let resolve!: (value: string | null) => void
    const exitPlanMode = vi.fn(() => new Promise<string | null>((done) => { resolve = done }))
    const { store } = setup({ active: true, pending: false }, exitPlanMode)
    fireEvent.click(activeChip())
    expect(exitPlanMode).toHaveBeenCalledTimes(1)
    fireEvent.click(activeChip())
    expect(exitPlanMode).toHaveBeenCalledTimes(1)
    resolve(null)
    store.set({ value: { active: true, pending: true } })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'plan mode 已开启，按下关闭' })).toBeNull()
    })
  })

  it('disables both controls under the locked owner prop', () => {
    setup({ active: true, pending: false }, vi.fn(), vi.fn(), true)
    expect((activeChip() as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    setup({ active: false, pending: false }, vi.fn(), vi.fn(), true)
    expect((offChip() as HTMLButtonElement).disabled).toBe(true)
  })

  it('surfaces exit admission and transport failures while staying visible', async () => {
    const exitPlanMode = vi.fn()
      .mockResolvedValueOnce('host said no')
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce('socket closed')
    setup({ active: true, pending: false }, exitPlanMode)
    fireEvent.click(activeChip())
    expect((await screen.findByText('failed to exit plan mode')).getAttribute('title')).toBe('host said no')
    expect(activeChip()).toBeTruthy()

    fireEvent.click(activeChip())
    expect(await screen.findByTitle('network down')).toBeTruthy()

    fireEvent.click(activeChip())
    expect(await screen.findByTitle('socket closed')).toBeTruthy()
  })

  it('surfaces entry admission and transport failures while staying visible', async () => {
    const enterPlanMode = vi.fn()
      .mockResolvedValueOnce('host said no')
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce('socket closed')
    setup({ active: false, pending: false }, vi.fn(), enterPlanMode)
    fireEvent.click(offChip())
    expect((await screen.findByText('failed to enter plan mode')).getAttribute('title')).toBe('host said no')
    expect(offChip()).toBeTruthy()

    fireEvent.click(offChip())
    expect(await screen.findByTitle('network down')).toBeTruthy()

    fireEvent.click(offChip())
    expect(await screen.findByTitle('socket closed')).toBeTruthy()
  })

  it('ignores in-flight fulfillment and rejection after unmount', () => {
    let resolve!: (value: string | null) => void
    const successful = setup(
      { active: true, pending: false },
      vi.fn(() => new Promise<string | null>((done) => { resolve = done })),
    )
    fireEvent.click(activeChip())
    successful.view.unmount()
    expect(() => { resolve(null) }).not.toThrow()

    let reject!: (reason: unknown) => void
    const exitPlanMode = vi.fn(() => new Promise<string | null>((_done, fail) => { reject = fail }))
    const { view } = setup({ active: true, pending: false }, exitPlanMode)
    fireEvent.click(activeChip())
    view.unmount()
    expect(() => { reject(new Error('late')) }).not.toThrow()

    let enterResolve!: (value: string | null) => void
    const entering = setup(
      { active: false, pending: false },
      vi.fn(),
      vi.fn(() => new Promise<string | null>((done) => { enterResolve = done })),
    )
    fireEvent.click(offChip())
    entering.view.unmount()
    expect(() => { enterResolve(null) }).not.toThrow()
  })
})
