import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PlanDocumentProjection,
  PlanDocumentProjectionValue,
  PlanMode,
  PlanOptionsProjectionValue,
  PlanTask,
  PlanTasksProjectionValue,
} from '@deepseek-ai/dsh-plan-mode/client'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import type { PlanEditResult } from './PlanDocumentPanel.tsx'
import css from './PlanSidebar.module.css'

/** User actions exposed to the contextual Plan workspace view. */
export interface PlanSidebarActions {
  /** Select one proposed plan option and promote it into the current plan. */
  onSelectOption: (optionId: string) => Promise<PlanEditResult>
}

/** Framework-neutral content props so the Plan body can live inside a Pane. */
export interface PlanWorkspaceViewProps extends PlanSidebarActions {
  useProjection: (key: string) => unknown
  t: PropsLocale<'plan'>['t']
}

interface OptionSelectionState {
  key: string
  optionId: string
  phase: 'pending' | 'selected' | 'error'
  error?: string
}

/** Localized plan status labels. */
function statusLabel(status: PlanDocumentProjection['status'], t: PlanWorkspaceViewProps['t']): string {
  switch (status) {
    case 'proposed': return t('status.proposed')
    case 'approved': return t('status.approved')
    case 'executing': return t('status.executing')
    case 'completed': return t('status.completed')
    case 'superseded': return t('status.superseded')
    case 'rejected': return t('status.rejected')
  }
}

function modeLabel(mode: PlanMode, t: PlanWorkspaceViewProps['t']): string {
  switch (mode) {
    case 'linear': return t('mode.linear')
    case 'goal': return t('mode.goal')
    case 'dag': return t('mode.dag')
  }
}

function goalPhaseLabel(phase: GoalProjection['goal']['phase'], t: PlanWorkspaceViewProps['t']): string {
  switch (phase) {
    case 'active': return t('goal.phase.active')
    case 'paused': return t('goal.phase.paused')
    case 'blocked': return t('goal.phase.blocked')
    case 'complete': return t('goal.phase.complete')
  }
}

function taskStatusLabel(status: PlanTask['status'], t: PlanWorkspaceViewProps['t']): string {
  switch (status) {
    case 'pending': return t('tasks.status.pending')
    case 'ready': return t('tasks.status.ready')
    case 'in_progress': return t('tasks.status.inProgress')
    case 'blocked': return t('tasks.status.blocked')
    case 'completed': return t('tasks.status.completed')
  }
}

/** Avoid repeating the plan title when the markdown starts with the same heading. */
function withoutRepeatedTitle(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex(line => line.trim() !== '')
  if (headingIndex < 0) return ''
  const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[headingIndex] ?? '')
  if (match?.[1]?.trim().toLocaleLowerCase() !== title.trim().toLocaleLowerCase()) return markdown
  let bodyIndex = headingIndex + 1
  while (bodyIndex < lines.length && lines[bodyIndex]?.trim() === '') bodyIndex += 1
  return lines.slice(bodyIndex).join('\n')
}

/** Plan/goal/options/tasks content rendered inside the shared Pane Workbench. */
export function PlanWorkspaceView({ useProjection, t, onSelectOption }: PlanWorkspaceViewProps) {
  const value = useProjection('plan-document') as PlanDocumentProjectionValue | undefined
  const optionsValue = useProjection('plan-options') as PlanOptionsProjectionValue | undefined
  const goal = useProjection('goal') as GoalProjection | null | undefined
  const tasksValue = useProjection('plan-tasks') as PlanTasksProjectionValue | undefined
  const [selection, setSelection] = useState<OptionSelectionState | null>(null)
  if (value?.latest === undefined) return null

  const latest = value.latest
  const options = optionsValue?.latest
  const tasks = tasksValue?.latest?.nodes ?? []
  const completedTasks = tasks.filter(task => task.status === 'completed').length
  const taskProgress = tasks.length === 0 ? 0 : Math.round((completedTasks / tasks.length) * 100)
  const optionSetKey = options === undefined ? undefined : `${options.planId}:${String(options.round)}`
  const currentSelection = optionSetKey !== undefined && selection?.key === optionSetKey ? selection : null
  const selectedOptionId = options?.selectedOptionId
    ?? latest.selectedOptionId
    ?? (currentSelection?.phase === 'selected' ? currentSelection.optionId : undefined)
  const selectionLocked = options?.status !== 'proposed' || selectedOptionId !== undefined
  const documentMarkdown = withoutRepeatedTitle(latest.markdown, latest.title)

  const selectOption = async (optionId: string) => {
    if (optionSetKey === undefined || currentSelection?.phase === 'pending' || selectionLocked) return
    setSelection({ key: optionSetKey, optionId, phase: 'pending' })
    const result = await onSelectOption(optionId)
    if (result.ok) {
      setSelection({ key: optionSetKey, optionId, phase: 'selected' })
    } else {
      setSelection({ key: optionSetKey, optionId, phase: 'error', error: result.error })
    }
  }

  return (
    <section className={css.workspace} data-plan-workspace-view="">
      <header className={css.summary} data-status={latest.status}>
        <div className={css.summaryMeta}>
          <span className={css.statusDot} aria-hidden="true" />
          <span className={css.status}>{statusLabel(latest.status, t)}</span>
          <span className={css.metaItem}>{t('meta.round')} {latest.round}</span>
          {latest.mode !== undefined && (
            <span className={css.metaItem}>{t('meta.mode')} {modeLabel(latest.mode, t)}</span>
          )}
        </div>
        <h2 className={css.planTitle}>{latest.title}</h2>
        {latest.feedback !== undefined && (
          <p className={css.planFeedback} role="status">{latest.feedback}</p>
        )}
      </header>

      <div className={css.body}>
        {tasks.length > 0 && (
          <section className={css.section} data-plan-tasks="">
            <div className={css.sectionHeader}>
              <h3 className={css.sectionTitle}>{t('tasks.title')}</h3>
              <span className={css.sectionMeta}>{completedTasks}/{tasks.length} {t('tasks.completed')}</span>
            </div>
            <div
              className={css.progressTrack}
              role="progressbar"
              aria-label={t('tasks.progress')}
              aria-valuemin={0}
              aria-valuemax={tasks.length}
              aria-valuenow={completedTasks}
            >
              <span className={css.progressFill} style={{ width: `${String(taskProgress)}%` }} />
            </div>
            <ul className={css.taskList}>
              {tasks.map(task => (
                <li key={task.id} className={css.taskItem} data-status={task.status}>
                  <span className={css.taskMarker} aria-hidden="true" />
                  <span className={css.taskTitle}>{task.title}</span>
                  <span className={css.taskStatus}>{taskStatusLabel(task.status, t)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {options !== undefined && options.options.length > 0 && (
          <section className={css.section} data-plan-options="">
            <div className={css.sectionHeader}>
              <h3 className={css.sectionTitle}>{t('options.title')}</h3>
              {selectedOptionId !== undefined && <span className={css.sectionMeta}>{t('options.selected')}</span>}
            </div>
            <ul className={css.optionList}>
              {options.options.map((option) => {
                const selected = option.optionId === selectedOptionId
                const pending = currentSelection?.phase === 'pending' && currentSelection.optionId === option.optionId
                const failed = currentSelection?.phase === 'error' && currentSelection.optionId === option.optionId
                return (
                  <li
                    key={option.optionId}
                    className={css.optionItem}
                    data-state={selected ? 'selected' : pending ? 'pending' : 'idle'}
                  >
                    <div className={css.optionHeader}>
                      <span className={css.optionTitle}>{option.title}</span>
                      {selected && <span className={css.selectedBadge} aria-live="polite">{t('options.selected')}</span>}
                      {!selected && option.recommended === true && (
                        <span className={css.recommended}>{t('options.recommended')}</span>
                      )}
                    </div>
                    <p className={css.optionSummary}>{option.summary}</p>
                    {(option.estimatedSteps !== undefined || (option.tradeoffs?.length ?? 0) > 0) && (
                      <div className={css.optionMeta}>
                        {option.estimatedSteps !== undefined && (
                          <span>{t('options.steps')} {option.estimatedSteps}</span>
                        )}
                        {(option.tradeoffs?.length ?? 0) > 0 && (
                          <span>{t('options.tradeoffs')} {option.tradeoffs?.join(' · ')}</span>
                        )}
                      </div>
                    )}
                    {!selectionLocked && (
                      <button
                        type="button"
                        className={css.selectButton}
                        disabled={currentSelection?.phase === 'pending'}
                        aria-busy={pending}
                        onClick={() => { void selectOption(option.optionId) }}
                      >
                        {pending ? t('options.selecting') : t('options.select')}
                      </button>
                    )}
                    {failed && currentSelection.error !== undefined && (
                      <p className={css.optionError} role="alert">{currentSelection.error}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section className={css.section} data-plan-document="">
          <h3 className={css.sectionTitle}>{t('document.content')}</h3>
          <div className={css.markdown}>
            {documentMarkdown.trim() === ''
              ? <p className={css.empty}>{t('document.empty')}</p>
              : <MarkdownText text={documentMarkdown} />}
          </div>
        </section>

        {goal !== undefined && goal !== null && (
          <section className={css.section} data-plan-goal="">
            <div className={css.sectionHeader}>
              <h3 className={css.sectionTitle}>{t('goal.title')}</h3>
              <span className={css.sectionMeta} data-goal-phase={goal.goal.phase}>
                {goalPhaseLabel(goal.goal.phase, t)} · {t('goal.rounds')} {goal.roundsStarted}
              </span>
            </div>
            <p className={css.goalObjective}>{goal.goal.objective}</p>
            {goal.goal.blockedReason !== undefined && (
              <p className={css.goalBlocked}>{goal.goal.blockedReason.message}</p>
            )}
          </section>
        )}

        {value.revisions.length > 0 && (
          <details className={css.history}>
            <summary className={css.historySummary}>
              <span>{t('history.title')}</span>
              <span className={css.historyCount}>{value.revisions.length}</span>
            </summary>
            <ol className={css.revisions}>
              {[...value.revisions].reverse().map((revision, index) => (
                <li
                  key={`${revision.planId}-${revision.status}-${String(revision.round)}-${String(index)}`}
                  className={css.revision}
                  data-status={revision.status}
                >
                  <span className={css.revisionDot} aria-hidden="true" />
                  <div className={css.revisionBody}>
                    <div className={css.revisionHeader}>
                      <span className={css.revisionTitle}>{revision.title}</span>
                      <span className={css.revisionStatus}>{statusLabel(revision.status, t)}</span>
                    </div>
                    <div className={css.revisionMeta}>
                      <span>{t('meta.round')} {revision.round}</span>
                      {revision.mode !== undefined && <span>{modeLabel(revision.mode, t)}</span>}
                    </div>
                    {revision.feedback !== undefined && <p className={css.revisionFeedback}>{revision.feedback}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </section>
  )
}
