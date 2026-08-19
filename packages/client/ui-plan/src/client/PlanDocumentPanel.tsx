import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, IconChevronUpOutline14, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the `plan-document` projection key merge (host-computed value).
import type {} from '@deepseek-ai/dsh-plan-mode/client'
import type { PlanDocumentProjectionValue } from '@deepseek-ai/dsh-plan-mode/client'
import css from './PlanDocumentPanel.module.css'

/** Full dock-entry props: InputZone owner share + session standard kit + the locale seat. */
export type PlanDocumentDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'plan'>

/** Dock adapter: reads the host-computed `plan-document` projection; absent renders nothing. */
export function PlanDocumentDock({ useProjection, t }: PlanDocumentDockProps) {
  const value = useProjection('plan-document')
  if (value?.latest === undefined) return null
  return <PlanDocumentPanel value={value} t={t} />
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

/**
 * Compact plan-document strip in the input dock: latest status + title, with
 * an expandable body showing the latest markdown and the full revision list.
 */
export function PlanDocumentPanel({ value, t }: { value: PlanDocumentProjectionValue } & Pick<PlanDocumentDockProps, 't'>) {
  const [open, setOpen] = useState(false)
  const latest = value.latest
  if (latest === undefined) return null
  const revisions = [...value.revisions].reverse()

  return (
    <section className={css.frame} data-plan-document-key={latest.planId}>
      <div className={css.header}>
        <span className={css.dot} aria-hidden />
        <span className={css.title}>{t('document.title')}</span>
        <span className={css.status}>{statusLabel(latest.status, t)}</span>
        <span className={css.planTitle}>{latest.title}</span>
        <button
          type="button"
          className={css.toggle}
          aria-label={open ? t('document.collapse') : t('document.expand')}
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          {open ? <IconChevronUpOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}
        </button>
      </div>
      {open && (
        <div className={css.body}>
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
        </div>
      )}
    </section>
  )
}
