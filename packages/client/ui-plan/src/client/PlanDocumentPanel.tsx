import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14,
  IconCloseOutline16, IconEditOutline16, IconPanelLeftOutline16, MarkdownText,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the `plan-document` projection key merge (host-computed value).
import type {} from '@deepseek-ai/dsh-plan-mode/client'
import type { PlanDocumentProjectionValue } from '@deepseek-ai/dsh-plan-mode/client'
import css from './PlanDocumentPanel.module.css'

/** Result of a user-initiated plan document update. */
export type PlanEditResult = { ok: true } | { ok: false; error: string }

/** User actions exposed to the plan-document dock entry. */
export interface PlanDocumentActions {
  /** Persist an edited plan title/markdown and return success or a user-visible failure. */
  onUpdate: (title: string, markdown: string) => Promise<PlanEditResult>
  /** Open the contextual Plan Pane; its own chrome owns layout controls. */
  onOpenWorkspace?: () => void
}

/** Full dock-entry props: InputZone owner share + session standard kit + injected actions + the locale seat. */
export type PlanDocumentDockProps = PropsRuntime<'conversation.input.dock'> & PlanDocumentActions & PropsLocale<'plan'>

/** Dock adapter: reads the host-computed `plan-document` projection; absent renders nothing. */
export function PlanDocumentDock({ useProjection, t, onUpdate, onOpenWorkspace }: PlanDocumentDockProps) {
  const value = useProjection('plan-document')
  if (value?.latest === undefined) return null
  return <PlanDocumentPanel
    value={value}
    t={t}
    onUpdate={onUpdate}
    {...(onOpenWorkspace === undefined ? {} : { onOpenWorkspace })}
  />
}

/** Localized status labels over the closed plan-document status union. */
function statusLabel(status: 'proposed' | 'approved' | 'executing' | 'completed' | 'superseded' | 'rejected', t: PlanDocumentDockProps['t']): string {
  switch (status) {
    case 'proposed': return t('status.proposed')
    case 'approved': return t('status.approved')
    case 'executing': return t('status.executing')
    case 'completed': return t('status.completed')
    case 'superseded': return t('status.superseded')
    case 'rejected': return t('status.rejected')
  }
}

/** First markdown heading, used as the title when the user leaves it blank. */
function firstHeading(markdown: string): string | undefined {
  for (const line of markdown.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

/**
 * Compact plan-document strip in the input dock: latest status + title, with
 * an expandable body showing the latest markdown, inline editing, and the
 * full revision list.
 */
export function PlanDocumentPanel({
  value, t, onUpdate, onOpenWorkspace,
}: { value: PlanDocumentProjectionValue } & Pick<PlanDocumentDockProps, 't' | 'onUpdate' | 'onOpenWorkspace'>) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftMarkdown, setDraftMarkdown] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const latest = value.latest
  if (latest === undefined) return null
  const revisions = [...value.revisions].reverse()

  const startEditing = () => {
    setDraftTitle(latest.title)
    setDraftMarkdown(latest.markdown)
    setEditError(null)
    setEditing(true)
    setOpen(true)
  }

  const save = async () => {
    if (draftMarkdown.trim() === '') return
    setSaving(true)
    setEditError(null)
    const result = await onUpdate(draftTitle.trim() || (firstHeading(draftMarkdown) ?? 'Plan'), draftMarkdown)
    setSaving(false)
    if (result.ok) {
      setEditing(false)
    } else {
      setEditError(result.error)
    }
  }

  return (
    <section className={css.frame} data-plan-document-key={latest.planId} data-status={latest.status}>
      <div className={css.header}>
        <span className={css.dot} aria-hidden />
        <span className={css.title}>{t('document.title')}</span>
        {editing ? (
          <input
            className={css.titleInput}
            type="text"
            aria-label={t('edit.title.aria')}
            value={draftTitle}
            onChange={(event) => { setDraftTitle(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save()
              if (event.key === 'Escape') setEditing(false)
            }}
            autoFocus
          />
        ) : (
          <>
            <span className={css.status}>{statusLabel(latest.status, t)}</span>
            <span className={css.planTitle}>{latest.title}</span>
          </>
        )}
        <div className={css.actions}>
          {editing ? (
            <>
              <Tooltip label={t('action.save')} side="bottom" delayMs={500}>
                <button
                  type="button"
                  className={css.iconBtn}
                  aria-label={t('action.save')}
                  disabled={saving || draftMarkdown.trim() === ''}
                  onClick={() => { void save() }}
                >
                  <IconCheckOutline16 size={14} />
                </button>
              </Tooltip>
              <Tooltip label={t('action.cancel')} side="bottom" delayMs={500}>
                <button
                  type="button"
                  className={css.iconBtn}
                  aria-label={t('action.cancel')}
                  disabled={saving}
                  onClick={() => { setEditing(false) }}
                >
                  <IconCloseOutline16 size={14} />
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              {onOpenWorkspace !== undefined && (
                <Tooltip label={t('action.open.sidebar')} side="bottom" delayMs={500}>
                  <button
                    type="button"
                    className={css.iconBtn}
                    aria-label={t('action.open.sidebar')}
                    onClick={() => { onOpenWorkspace() }}
                  >
                    <IconPanelLeftOutline16 size={14} />
                  </button>
                </Tooltip>
              )}
              <Tooltip label={t('action.edit')} side="bottom" delayMs={500}>
                <button
                  type="button"
                  className={css.iconBtn}
                  aria-label={t('action.edit')}
                  onClick={startEditing}
                >
                  <IconEditOutline16 size={14} />
                </button>
              </Tooltip>
              <Tooltip label={open ? t('document.collapse') : t('document.expand')} side="bottom" delayMs={500}>
                <button
                  type="button"
                  className={css.iconBtn}
                  aria-label={open ? t('document.collapse') : t('document.expand')}
                  aria-expanded={open}
                  onClick={() => { setOpen(!open) }}
                >
                  {open ? <IconChevronUpOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      {(open || editing) && (
        <div className={css.body}>
          {editing ? (
            <>
              <textarea
                className={css.markdownEditor}
                aria-label={t('edit.markdown.aria')}
                value={draftMarkdown}
                onChange={(event) => { setDraftMarkdown(event.target.value) }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void save()
                  if (event.key === 'Escape') setEditing(false)
                }}
              />
              {editError !== null && <span className={css.error} role="alert">{editError}</span>}
            </>
          ) : (
            <>
              <div className={css.markdown}><MarkdownText text={latest.markdown} /></div>
              <div className={css.historyTitle}>{t('history.title')}</div>
              <ol className={css.revisions}>
                {revisions.map((revision, index) => (
                  <li key={`${revision.planId}-${revision.status}-${String(index)}`} className={css.revision}>
                    <span className={css.revisionStatus}>{statusLabel(revision.status, t)}</span>
                    <span className={css.revisionTitle}>{revision.title}</span>
                    {revision.feedback !== undefined && (
                      <span className={css.feedback}>{revision.feedback}</span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  )
}
