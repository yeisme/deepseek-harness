import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the input.plan seat and
// its {locked} owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PlanChipInjected } from './index.ts'
import css from './PlanModeControl.module.css'

/** Full plan-seat component props: runtime share (standard kit + locked owner prop) & injected share & the locale seat. */
export type PlanChipProps =
  PropsRuntime<'conversation.input.plan'> & InjectFace<PlanChipInjected> & PropsLocale<'plan'>

/**
 * Plan-mode status over the host-computed `plan` projection. The seat renders
 * an active warn chip while the effective target is plan mode
 * (`pending ? !active : active` — a folded host value, not client optimism)
 * and a neutral entry chip while the effective target is the default mode.
 * A pending exit leaves no control until the projection confirms the switch.
 */
export function PlanChip({ useProjection, locked, exitPlanMode, enterPlanMode, t }: PlanChipProps) {
  const plan = useProjection('plan')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorLabel, setErrorLabel] = useState('')
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  if (plan === undefined) return null
  const target = plan.pending ? !plan.active : plan.active
  // A pending exit is an in-flight /plan off; keep the seat empty until the
  // projection lands so the user cannot fight the switch they just requested.
  if (plan.pending && !target) return null

  const run = (action: () => Promise<string | null>, failureLabel: string): void => {
    // No busy/locked guard: both disable the button, so no click arrives.
    setBusy(true)
    setError(null)
    void action().then((failure) => {
      if (!aliveRef.current) return
      setBusy(false)
      if (failure !== null) {
        setError(failure)
        setErrorLabel(failureLabel)
      }
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
      setErrorLabel(failureLabel)
    })
  }

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={target ? css.chip : `${css.chip} ${css.chipOff}`}
        aria-label={target ? t('chip.on.aria') : t('chip.off.aria')}
        title={target ? t('chip.on.title') : t('chip.off.title')}
        disabled={locked || busy}
        onClick={() => {
          if (target) run(exitPlanMode, 'failed to exit plan mode')
          else run(enterPlanMode, 'failed to enter plan mode')
        }}
      >
        {/* Design literal, not copy: the chip wordmark stays 'Plan' in every locale. */}
        Plan
        {target && (
          <span className={css.close} aria-hidden>
            <IconCloseFill14 size={12} />
          </span>
        )}
      </button>
      {/* Failure copy stays English (error-surface policy: not localized). */}
      {error !== null && <span className={css.error} role="status" title={error}>{errorLabel}</span>}
    </span>
  )
}
