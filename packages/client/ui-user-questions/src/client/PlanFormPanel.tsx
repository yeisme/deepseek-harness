import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import { Button, IconCheckOutline14, IconCloseOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { PendingQuestion, type PlanForm, type QuestionAnswer } from './contract/slots.ts'
import { parseRecommendedLabel } from './QuestionComposer.tsx'
import css from './PlanFormPanel.module.css'

interface FieldDraft {
  selected: string[]
  custom: string
}

/** Local validation feedback: a dictionary key translated at render. */
type Feedback = { key: 'error.incomplete' } | { text: string }

/**
 * One-page planning form: every question is a field in a single scrollable
 * card, so the user fills the whole form before submitting one answer batch.
 * This is the `plan-form` intent surface, distinct from the paged generic
 * question flow and the one-decision plan-review card.
 */
export function PlanFormPanel({ pending, form, t }: { pending: PendingQuestion; form: PlanForm } & { t: import('@deepseek-ai/dsh-client-ui-slots').TranslateNS<'question'> }) {
  const questions = pending.questions
  const [drafts, setDrafts] = useState<FieldDraft[]>(() => questions.map(() => ({ selected: [], custom: '' })))
  const [busy, setBusy] = useState<'submit' | 'cancel' | null>(null)
  const [error, setError] = useState<Feedback | null>(null)

  const answered = (draft: FieldDraft): boolean => draft.selected.length > 0 || draft.custom.trim() !== ''

  const updateDraft = (index: number, update: (current: FieldDraft) => FieldDraft): void => {
    setDrafts(current => current.map((item, itemIndex) => itemIndex === index ? update(item) : item))
    setError(null)
  }

  const choose = (index: number, question: PendingQuestion['questions'][number], label: string): void => {
    updateDraft(index, (current) => {
      if (question.multiSelect === true) {
        const selected = current.selected.includes(label)
          ? current.selected.filter(item => item !== label)
          : [...current.selected, label]
        return { ...current, selected }
      }
      return { selected: [label], custom: '' }
    })
  }

  const draftCustom = (index: number, question: PendingQuestion['questions'][number], event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value
    updateDraft(index, current => ({
      ...current,
      selected: question.multiSelect === true ? current.selected : [],
      custom: value,
    }))
  }

  const continueFromCustom = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  const submit = (): void => {
    const missing = drafts.findIndex(item => !answered(item))
    if (missing >= 0) {
      setError({ key: 'error.incomplete' })
      return
    }
    const answer: QuestionAnswer = {
      answers: questions.map((question, index) => {
        const draft = drafts[index] as FieldDraft
        const custom = draft.custom.trim()
        return {
          id: question.id,
          selected: custom === '' || question.multiSelect === true ? draft.selected : [],
          ...custom === '' ? {} : { custom },
        }
      }),
    }
    setBusy('submit')
    setError(null)
    void pending.answer(answer).catch((cause: unknown) => {
      setBusy(null)
      setError({ text: cause instanceof Error ? cause.message : String(cause) })
    })
  }

  const cancel = (): void => {
    setBusy('cancel')
    setError(null)
    void pending.cancel().catch((cause: unknown) => {
      setBusy(null)
      setError({ text: cause instanceof Error ? cause.message : String(cause) })
    })
  }

  const title = useMemo(() => form.title ?? t('form.title'), [form.title, t])

  return (
    <div className={css.frame} data-plan-form-key={pending.key}>
      <section className={css.card} aria-label={title}>
        <header className={css.header}>
          <div className={css.headingBlock}>
            <div className={css.eyebrow}>{title}</div>
            <h2 className={css.title}>{t('form.subtitle')}</h2>
          </div>
          <button
            type="button" className={css.iconButton} aria-label={t('nav.cancel')}
            title={t('nav.cancel')}
            disabled={busy !== null} onClick={cancel}
          >
            <IconCloseOutline16 />
          </button>
        </header>

        <div className={css.body} data-plan-form-scroll>
          {questions.map((question, index) => {
            const draft = drafts[index] as FieldDraft
            const options = question.options ?? []
            const hasOptions = options.length > 0
            return (
              <div className={css.field} key={question.id}>
                <div className={css.fieldHeader}>
                  <label className={css.label} htmlFor={`plan-form-${pending.key}-${question.id}`}>{question.question}</label>
                  {question.header !== undefined && <span className={css.eyebrow}>{question.header}</span>}
                </div>
                {question.detail !== undefined && (
                  <div className={css.detail}><MarkdownText text={question.detail} /></div>
                )}
                {hasOptions
                  ? (
                    <div className={css.options} role={question.multiSelect === true ? 'group' : 'radiogroup'}>
                      {options.map((option, optionIndex) => {
                        const selected = draft.selected.includes(option.label)
                        const display = parseRecommendedLabel(option.label)
                        return (
                          <button
                            type="button"
                            key={`${option.label}-${String(optionIndex)}`}
                            className={clsx(css.option, selected && question.multiSelect !== true && css.optionSelected)}
                            role={question.multiSelect === true ? 'checkbox' : 'radio'}
                            aria-checked={selected}
                            aria-label={display.label}
                            disabled={busy !== null}
                            onClick={() => { choose(index, question, option.label) }}
                          >
                            {question.multiSelect === true
                              ? (
                                <span className={clsx(css.checkbox, selected && css.checkboxChecked)} aria-hidden="true">
                                  {selected && <IconCheckOutline14 size={12} />}
                                </span>
                              )
                              : <span className={css.number}>{optionIndex + 1}</span>}
                            <span className={css.optionCopy}>
                              <span className={css.optionLine}>
                                <span className={css.optionLabel}>{display.label}</span>
                                {display.recommended && <span className={css.recommended}>{t('option.recommended')}</span>}
                              </span>
                              {option.description !== undefined && (
                                <span className={css.optionDescription}>{option.description}</span>
                              )}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )
                  : (
                    <textarea
                      id={`plan-form-${pending.key}-${question.id}`}
                      autoFocus={index === 0}
                      className={css.customTextarea}
                      value={draft.custom}
                      disabled={busy !== null}
                      rows={question.detail === undefined ? 3 : 2}
                      placeholder={t('custom.placeholder')}
                      onChange={event => { draftCustom(index, question, event) }}
                      onKeyDown={continueFromCustom}
                    />
                  )}
              </div>
            )
          })}
        </div>

        <footer className={css.footer}>
          <div className={css.feedback} role="status">
            {error === null ? null : 'key' in error ? t(error.key) : error.text}
          </div>
          <div className={css.footerActions}>
            <Button variant="outline" disabled={busy !== null} onClick={cancel}>
              {t('nav.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={busy !== null || drafts.some(item => !answered(item))}
              onClick={submit}
            >
              {busy === 'submit' ? t('submitting') : t('form.submit')}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  )
}
