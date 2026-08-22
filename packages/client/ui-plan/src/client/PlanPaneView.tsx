import { createElement, useSyncExternalStore } from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { PlanWorkspaceView } from './PlanSidebar.tsx'

/** Optional external Pane service used through a narrow structural seam. */
export interface PlanPaneWorkbenchFace {
  registerView(input: unknown): () => void
  openView(request: unknown): void
}

const PLAN_KIND = 'plan.document'
const PLAN_RESOURCE = 'plan:current'
const PLAN_VIEW_ID = 'plan-view:current'
const EMPTY_SOURCE = {
  getSnapshot: (): undefined => undefined,
  subscribe: (_listener: () => void): (() => void) => () => {},
}

function useCurrentSession(ctx: ClientContext): SessionId | undefined {
  return useSyncExternalStore(
    listener => ctx.sessions.list.subscribe(listener),
    () => ctx.sessions.list.getSnapshot().current,
    () => ctx.sessions.list.getSnapshot().current,
  )
}

function usePlanProjection(ctx: ClientContext, sessionId: SessionId | undefined, key: string): unknown {
  const source = sessionId === undefined
    ? EMPTY_SOURCE
    : ctx.sessions.binding(sessionId)?.session.projections.faceOf(key) ?? EMPTY_SOURCE
  return useSyncExternalStore(
    listener => source.subscribe(listener),
    () => source.getSnapshot(),
    () => source.getSnapshot(),
  )
}

function PlanPaneRuntime({ ctx }: { readonly ctx: ClientContext }) {
  useSyncExternalStore(
    listener => ctx.locale.subscribe(listener),
    () => ctx.locale.getSnapshot().revision,
    () => ctx.locale.getSnapshot().revision,
  )
  const sessionId = useCurrentSession(ctx)
  const useProjection = (key: string): unknown => usePlanProjection(ctx, sessionId, key)
  const onSelectOption = async (optionId: string) => {
    if (sessionId === undefined) return { ok: false as const, error: 'no current session' }
    const result = await ctx.remote.commands.execute(
      sessionId,
      `/plan-select ${JSON.stringify({ optionId })}`,
      [],
    )
    if (!result.ok) return { ok: false as const, error: `${result.error.message} (${result.error.code})` }
    if (result.value === undefined) return { ok: false as const, error: 'unknown command: /plan-select' }
    return { ok: true as const }
  }
  return createElement(PlanWorkspaceView, {
    useProjection,
    t: ctx.locale.bind('plan'),
    onSelectOption,
  })
}

/** Register the Plan content as one contextual Pane provider. */
export function registerPlanPaneView(ctx: ClientContext, pane: PlanPaneWorkbenchFace): () => void {
  return pane.registerView({
    descriptor: {
      kind: PLAN_KIND,
      label: 'Plan',
      componentKey: 'plan-document',
      role: 'content',
      preferredRegion: 'right',
      retention: 'snapshot',
      singleton: true,
    },
    component: () => createElement(PlanPaneRuntime, { ctx }),
  })
}

/** Open the current session's Plan Pane; layout actions remain in Pane chrome. */
export function openPlanPane(pane: PlanPaneWorkbenchFace): void {
  pane.openView({
    viewId: PLAN_VIEW_ID,
    kind: PLAN_KIND,
    resourceKey: PLAN_RESOURCE,
    role: 'content',
    preferredRegion: 'right',
    retention: 'snapshot',
    singleton: true,
    pinned: true,
    title: 'Plan',
  })
}
