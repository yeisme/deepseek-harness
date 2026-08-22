/** Four-column/two-row DSH frame with official right and bottom workspaces. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import { computeWorkspaceGeometry } from './workspace-geometry.ts'
import type { WorkspaceBottomOwnerProps, WorkspaceRightOwnerProps } from './workspace-layout.ts'
import { WorkspaceLayoutController } from './workspace-layout.ts'
import css from './AppFrame.module.css'

export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'shell.workspace.right' | 'shell.workspace.bottom' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & { workspaceLayout: WorkspaceLayoutController }

function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

interface ResizeHandleProps {
  readonly side: 'sidebar' | 'right' | 'bottom' | 'details'
  readonly axis: 'x' | 'y'
  readonly position: number
  readonly crossStart?: number
  readonly crossSize?: number
  readonly value: number
  readonly min: number
  readonly max: number
  readonly onStart: () => void
  readonly onDrag: (delta: number) => void
  readonly onEnd: () => void
  readonly onKeyboard: (direction: -1 | 1) => void
}

/** Pointer/rAF and keyboard-equivalent separator shared by every AppFrame track. */
function ResizeHandle(props: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props

  const coordinate = (event: React.PointerEvent<HTMLDivElement>): number => props.axis === 'x' ? event.clientX : event.clientY
  const flush = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    callbacks.current.onDrag(latest.current - origin.current)
  }, [])
  const finish = useCallback(() => {
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const next = coordinate(event)
    origin.current = next
    latest.current = next
    callbacks.current.onStart()
    setDragging(true)
  }, [props.axis])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = coordinate(event)
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [props.axis])
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    flush()
    finish()
  }, [finish, flush])
  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    finish()
  }, [finish])
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = props.axis === 'x'
      ? event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : undefined
      : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : undefined
    if (direction === undefined) return
    event.preventDefault()
    callbacks.current.onKeyboard(direction)
  }, [props.axis])
  const style: CSSProperties = props.axis === 'x'
    ? { left: props.position, top: props.crossStart ?? 0, height: props.crossSize }
    : { top: props.position, left: props.crossStart ?? 0, width: props.crossSize }

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
  }, [])

  return (
    <div
      className={css.handle}
      style={style}
      data-side={props.side}
      data-axis={props.axis}
      data-dragging={dragging || undefined}
      role="separator"
      aria-orientation={props.axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  )
}

export function AppFrame({ useStore, useSessions, actions, renderSlot, workspaceLayout }: AppFrameProps) {
  const panels = useStore(state => state)
  const workspace = useSyncExternalStore(workspaceLayout.subscribe, workspaceLayout.getSnapshot, workspaceLayout.getSnapshot)
  const detailsSession = useSessions((state) => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) actions.closeDetails()
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  useEffect(() => {
    const element = frameRef.current
    /* v8 ignore next -- frame is rendered unconditionally. */
    if (element === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const rect = element.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) setViewport({ width: rect.width, height: rect.height })
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    if (workspace.maximizedRegion === undefined) return
    const restore = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') workspaceLayout.restoreMaximized()
    }
    window.addEventListener('keydown', restore)
    return () => window.removeEventListener('keydown', restore)
  }, [workspace.maximizedRegion, workspaceLayout])

  const narrow = viewport.width < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed ? 0 : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const geometry = computeWorkspaceGeometry({
    width: viewport.width,
    height: viewport.height,
    sidebar: sidebarPreference,
    details: detailsSession === undefined ? 0 : panels.details,
    workspace,
  })
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry

  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const rightBase = useRef(0)
  const bottomBase = useRef(0)
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])

  const rightOwner: WorkspaceRightOwnerProps = {
    region: 'right',
    mode: geometry.rightMode,
    width: geometry.coverRegion === 'right' ? Math.max(0, viewport.width - geometry.sidebar) : geometry.rightWidth,
    height: viewport.height,
    visible: geometry.rightMode !== 'hidden',
    maximized: geometry.rightMode === 'maximized',
  }
  const bottomOwner: WorkspaceBottomOwnerProps = {
    region: 'bottom',
    mode: geometry.bottomMode,
    width: geometry.coverRegion === 'bottom' ? Math.max(0, viewport.width - geometry.sidebar) : geometry.conversationWidth,
    height: geometry.coverRegion === 'bottom' ? viewport.height : geometry.bottomHeight,
    visible: geometry.bottomMode !== 'hidden',
    maximized: geometry.bottomMode === 'maximized',
  }

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns: `${geometry.sidebar}px minmax(0, ${geometry.conversationWidth}px) ${geometry.rightWidth}px ${geometry.detailsWidth}px`,
        gridTemplateRows: `${geometry.conversationHeight}px ${geometry.bottomHeight}px`,
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={geometry.detailsWidth === 0 || undefined}
      data-right-mode={geometry.rightMode}
      data-bottom-mode={geometry.bottomMode}
      data-workspace-cover={geometry.coverRegion}
      data-dragging={dragging || undefined}
    >
      <div className={css.sidebarCol}>
        {renderSlot('sidebar', { collapsed: sidebarCollapsed, width: geometry.sidebar })}
      </div>
      <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
      <div className={css.rightWorkspaceCol} data-workspace-region="right" data-mode={geometry.rightMode}>
        {renderSlot('shell.workspace.right', rightOwner)}
      </div>
      <div className={css.bottomWorkspaceCol} data-workspace-region="bottom" data-mode={geometry.bottomMode}>
        {renderSlot('shell.workspace.bottom', bottomOwner)}
      </div>
      <DetailsColumn>{renderSlot('details', {})}</DetailsColumn>
      <div className={css.overlayLayer} data-shell-overlay>{renderSlot('shell.overlay', {})}</div>

      {!sidebarCollapsed && <ResizeHandle
        side="sidebar" axis="x" position={geometry.sidebar}
        value={geometry.sidebar} min={264} max={420}
        onStart={() => { sidebarBase.current = geometryRef.current.sidebar; setDragging(true) }}
        onDrag={delta => actions.setSidebar(sidebarBase.current + delta)}
        onEnd={onDragEnd}
        onKeyboard={direction => actions.setSidebar(geometryRef.current.sidebar + direction * 16)}
      />}
      {geometry.rightMode === 'dock' && <ResizeHandle
        side="right" axis="x" position={geometry.sidebar + geometry.conversationWidth}
        value={geometry.rightWidth} min={360} max={840}
        onStart={() => { rightBase.current = geometryRef.current.rightWidth; setDragging(true) }}
        onDrag={delta => workspaceLayout.updateGeometry({ rightWidth: rightBase.current - delta })}
        onEnd={onDragEnd}
        onKeyboard={direction => workspaceLayout.updateGeometry({ rightWidth: geometryRef.current.rightWidth - direction * 16 })}
      />}
      {geometry.bottomMode === 'dock' && <ResizeHandle
        side="bottom" axis="y" position={geometry.conversationHeight}
        crossStart={geometry.sidebar} crossSize={geometry.conversationWidth}
        value={geometry.bottomHeight} min={180} max={Math.floor(viewport.height * 0.65)}
        onStart={() => { bottomBase.current = geometryRef.current.bottomHeight; setDragging(true) }}
        onDrag={delta => workspaceLayout.updateGeometry({ bottomRatio: (bottomBase.current - delta) / Math.max(1, viewport.height) })}
        onEnd={onDragEnd}
        onKeyboard={direction => workspaceLayout.updateGeometry({ bottomRatio: (geometryRef.current.bottomHeight - direction * 16) / Math.max(1, viewport.height) })}
      />}
      {geometry.detailsWidth > 0 && <ResizeHandle
        side="details" axis="x" position={viewport.width - geometry.detailsWidth}
        value={geometry.detailsWidth} min={300} max={520}
        onStart={() => { detailsBase.current = geometryRef.current.detailsWidth; setDragging(true) }}
        onDrag={delta => actions.setDetails(detailsBase.current - delta)}
        onEnd={onDragEnd}
        onKeyboard={direction => actions.setDetails(geometryRef.current.detailsWidth - direction * 16)}
      />}
    </div>
  )
}
