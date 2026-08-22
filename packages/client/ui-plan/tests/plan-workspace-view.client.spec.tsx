// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { PlanWorkspaceView, type PlanWorkspaceViewProps } from '../src/client/PlanSidebar.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: PlanWorkspaceViewProps['t'] = makeTranslate(zh, commonZh)

function projectionFixture() {
  return {
    'plan-document': {
      latest: {
        planId: 'plan-1',
        title: '完善 Plan 侧边栏',
        markdown: '# 完善 Plan 侧边栏\n\n让进度比长文档更容易扫描。',
        status: 'executing',
        round: 3,
        mode: 'dag',
      },
      revisions: [
        {
          planId: 'plan-1',
          title: '初始方案',
          markdown: '# 初始方案',
          status: 'proposed',
          round: 1,
        },
      ],
    },
    'plan-options': {
      latest: {
        planId: 'plan-1',
        round: 3,
        status: 'proposed',
        options: [
          {
            optionId: 'calm',
            title: '安静工作区',
            summary: '用连续信息流承载计划状态和操作。',
            markdown: '# 安静工作区',
            estimatedSteps: 5,
            tradeoffs: ['扫描快', '层级少'],
            recommended: true,
          },
          {
            optionId: 'tabs',
            title: '标签页工作区',
            summary: '按正文、任务和方案拆分。',
            markdown: '# 标签页工作区',
          },
        ],
      },
      revisions: [],
    },
    goal: {
      goal: {
        id: 'goal-1',
        revision: 1,
        objective: '完成可扫描、可操作的 Plan 工作区',
        phase: 'active',
        maxGoalRounds: 6,
      },
      roundsStarted: 3,
      createdAt: 1,
      updatedAt: 2,
    },
    'plan-tasks': {
      latest: {
        planId: 'plan-1',
        round: 3,
        nodes: [
          { id: 'one', title: '盘点实现', status: 'completed', dependencies: [] },
          { id: 'two', title: '重构层级', status: 'in_progress', dependencies: ['one'] },
          { id: 'three', title: '视觉验证', status: 'ready', dependencies: ['two'] },
        ],
      },
      revisions: [],
    },
  } as const
}

function renderWorkspace(
  onSelectOption: PlanWorkspaceViewProps['onSelectOption'] = async () => ({ ok: true }),
) {
  const projections: Record<string, unknown> = projectionFixture()
  return render(
    <PlanWorkspaceView
      useProjection={key => projections[key]}
      t={t}
      onSelectOption={onSelectOption}
    />,
  )
}

describe('PlanWorkspaceView', () => {
  it('uses the Pane chrome once and puts localized progress before the document', () => {
    renderWorkspace()

    expect(screen.queryByText('计划文档')).toBeNull()
    expect(screen.getAllByText('完善 Plan 侧边栏')).toHaveLength(1)
    expect(screen.getByText('1/3 已完成')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('可开始')).toBeTruthy()
    expect(screen.queryByText('IN_PROGRESS')).toBeNull()

    const progress = screen.getByRole('progressbar', { name: '计划任务进度' })
    expect(progress.getAttribute('aria-valuenow')).toBe('1')
    const tasks = progress.closest('[data-plan-tasks]')
    const document = screen.getByText('计划内容').closest('[data-plan-document]')
    expect(tasks).not.toBeNull()
    expect(document).not.toBeNull()
    expect(tasks!.compareDocumentPosition(document!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const history = screen.getByText('修订记录').closest('details') as HTMLDetailsElement
    expect(history.open).toBe(false)
    fireEvent.click(screen.getByText('修订记录'))
    expect(history.open).toBe(true)
  })

  it('shows pending and selected feedback while choosing an option', async () => {
    let finish: ((value: { ok: true }) => void) | undefined
    const onSelectOption = vi.fn(() => new Promise<{ ok: true }>((resolve) => {
      finish = resolve
    }))
    renderWorkspace(onSelectOption)

    fireEvent.click(screen.getAllByRole('button', { name: '选择此方案' })[0]!)
    expect(screen.getByRole('button', { name: '选择中…' }).hasAttribute('disabled')).toBe(true)
    expect(onSelectOption).toHaveBeenCalledExactlyOnceWith('calm')

    finish?.({ ok: true })
    await waitFor(() => {
      expect(screen.getAllByText('已选择').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.queryByRole('button', { name: '选择此方案' })).toBeNull()
  })

  it('surfaces a failed option selection and allows retry', async () => {
    const onSelectOption = vi.fn(async () => ({ ok: false as const, error: 'plan.select failed' }))
    renderWorkspace(onSelectOption)

    fireEvent.click(screen.getAllByRole('button', { name: '选择此方案' })[0]!)
    expect((await screen.findByRole('alert')).textContent).toContain('plan.select failed')
    expect(screen.getAllByRole('button', { name: '选择此方案' })[0]?.hasAttribute('disabled')).toBe(false)
  })
})
