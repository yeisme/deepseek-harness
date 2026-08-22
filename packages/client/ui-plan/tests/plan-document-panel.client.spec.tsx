// @vitest-environment jsdom
/**
 * PlanDocumentDock over the `plan-document` projection: absent capability or
 * no document renders nothing; the latest document renders a status line and
 * expands into markdown plus the full revision history.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PlanDocumentProjectionValue } from '@deepseek-ai/dsh-plan-mode/client'
import { PlanDocumentDock, PlanDocumentPanel, type PlanDocumentDockProps } from '../src/client/PlanDocumentPanel.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: PlanDocumentDockProps['t'] = makeTranslate(zh, commonZh)

const VALUE: PlanDocumentProjectionValue = {
  latest: {
    planId: 'plan-1',
    title: 'Fix the flaky test',
    markdown: '# Fix the flaky test\n\nAdd a retry.',
    status: 'approved',
    round: 1,
  },
  revisions: [
    {
      planId: 'plan-1',
      title: 'Fix the flaky test',
      markdown: '# Fix the flaky test',
      status: 'proposed',
      round: 1,
    },
    {
      planId: 'plan-1',
      title: 'Fix the flaky test',
      markdown: '# Fix the flaky test\n\nAdd a retry.',
      status: 'approved',
      round: 1,
    },
  ],
}

function setup(value: PlanDocumentProjectionValue | undefined) {
  const store = createSnapshotStore<{ value: PlanDocumentProjectionValue | undefined }>({ value })
  const subscribe = (onStoreChange: () => void) => store.subscribe(onStoreChange)
  const getSnapshot = () => store.getSnapshot().value
  const useProjection = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const onUpdate = vi.fn<PlanDocumentDockProps['onUpdate']>(async () => ({ ok: true }))
  const onOpenWorkspace = vi.fn()
  const props = { useProjection, t, onUpdate, onOpenWorkspace } as unknown as PlanDocumentDockProps
  const view = render(<PlanDocumentDock {...props} />)
  return { store, view, onUpdate, onOpenWorkspace }
}

describe('PlanDocumentDock', () => {
  it('renders nothing while capability or latest document is absent', () => {
    const absent = setup(undefined)
    expect(absent.view.container.innerHTML).toBe('')
    cleanup()
    const empty = setup({ latest: undefined, revisions: [] })
    expect(empty.view.container.innerHTML).toBe('')
  })

  it('shows the latest document status and title, then expands markdown and revision history', () => {
    setup(VALUE)
    expect(screen.getByText('计划文档')).toBeTruthy()
    expect(screen.getByText('已批准')).toBeTruthy()
    expect(screen.getByText('Fix the flaky test')).toBeTruthy()
    expect(screen.queryByText('Add a retry.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开计划文档' }))

    expect(screen.getByText('Add a retry.')).toBeTruthy()
    expect(screen.getByText('修订记录')).toBeTruthy()
    expect(screen.getAllByText('Fix the flaky test').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('待审')).toBeTruthy()
    expect(screen.getAllByText('已批准').length).toBeGreaterThanOrEqual(2)
  })

  it('opens the contextual Plan Pane from one dock action', () => {
    const { onOpenWorkspace } = setup(VALUE)
    fireEvent.click(screen.getByRole('button', { name: '在工作区打开计划' }))
    expect(onOpenWorkspace).toHaveBeenCalledExactlyOnceWith()
    expect(screen.queryByRole('button', { name: '最大化打开计划' })).toBeNull()
  })

  it('shows rejection feedback in the revision list', () => {
    render(
      <PlanDocumentPanel
        t={t}
        onUpdate={async () => ({ ok: true })}
        value={{
          latest: { planId: 'plan-2', title: 'Retry', markdown: '# Retry', status: 'rejected', round: 2, feedback: 'narrow the scope' },
          revisions: [
            { planId: 'plan-2', title: 'First', markdown: '# First', status: 'proposed', round: 1 },
            { planId: 'plan-2', title: 'Retry', markdown: '# Retry', status: 'rejected', round: 2, feedback: 'narrow the scope' },
          ],
        }}
      />,
    )
    expect(screen.getByText('已拒绝')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开计划文档' }))
    expect(screen.getByText('narrow the scope')).toBeTruthy()
  })

  it('edits the latest plan and calls onUpdate with the new markdown', async () => {
    const { onUpdate } = setup(VALUE)
    fireEvent.click(screen.getByRole('button', { name: '编辑计划文档' }))

    const titleInput = screen.getByRole('textbox', { name: '计划标题' }) as HTMLInputElement
    const markdownInput = screen.getByRole('textbox', { name: '计划 Markdown 内容' }) as HTMLTextAreaElement
    fireEvent.change(titleInput, { target: { value: 'Retry with backoff' } })
    fireEvent.change(markdownInput, { target: { value: '# Retry with backoff\n\nAdd exponential backoff.' } })
    fireEvent.click(screen.getByRole('button', { name: '保存计划文档' }))

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(
      'Retry with backoff',
      '# Retry with backoff\n\nAdd exponential backoff.',
    )
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: '计划 Markdown 内容' })).toBeNull()
    })
  })

  it('keeps the editor open and surfaces a failed update', async () => {
    const { onUpdate } = setup(VALUE)
    onUpdate.mockResolvedValueOnce({ ok: false, error: 'plan.edit failed' })
    fireEvent.click(screen.getByRole('button', { name: '编辑计划文档' }))

    const markdownInput = screen.getByRole('textbox', { name: '计划 Markdown 内容' }) as HTMLTextAreaElement
    fireEvent.change(markdownInput, { target: { value: '# Changed' } })
    fireEvent.click(screen.getByRole('button', { name: '保存计划文档' }))

    expect(await screen.findByText('plan.edit failed')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '计划 Markdown 内容' })).toBeTruthy()
  })
})
