/** Public workspace layout contract and its single-owner external store. */

export type WorkspaceRegion = 'right' | 'bottom'
export type WorkspaceRegionMode = 'hidden' | 'rail' | 'dock' | 'sheet' | 'maximized'
export type WorkspaceAuxiliarySurface = 'workspace' | 'details'

export interface WorkspaceLayoutPreference {
  readonly rightVisible?: boolean
  readonly bottomVisible?: boolean
  readonly rightWidth?: number
  readonly bottomRatio?: number
  readonly activeRegion?: WorkspaceRegion
  readonly maximizedRegion?: WorkspaceRegion
}

export interface WorkspaceLayoutSnapshot {
  readonly attached: boolean
  readonly ownerId?: string
  readonly rightVisible: boolean
  readonly bottomVisible: boolean
  readonly rightWidth: number
  readonly bottomRatio: number
  readonly activeRegion: WorkspaceRegion
  readonly maximizedRegion: WorkspaceRegion | undefined
  readonly auxiliaryPriority: WorkspaceAuxiliarySurface
}

export interface WorkspaceLayoutHandle {
  update(next: WorkspaceLayoutPreference): void
  getSnapshot(): WorkspaceLayoutSnapshot
  subscribe(listener: () => void): () => void
  dispose(): void
}

export interface WorkspaceRightOwnerProps {
  readonly region: 'right'
  readonly mode: WorkspaceRegionMode
  readonly width: number
  readonly height: number
  readonly visible: boolean
  readonly maximized: boolean
}

export interface WorkspaceBottomOwnerProps {
  readonly region: 'bottom'
  readonly mode: WorkspaceRegionMode
  readonly width: number
  readonly height: number
  readonly visible: boolean
  readonly maximized: boolean
}

export interface IWorkspaceLayout {
  attach(ownerId: string, initialPreference?: WorkspaceLayoutPreference): WorkspaceLayoutHandle
}

export const WORKSPACE_RIGHT_DEFAULT = 480
export const WORKSPACE_BOTTOM_DEFAULT_RATIO = 0.34

const DETACHED_SNAPSHOT: WorkspaceLayoutSnapshot = Object.freeze({
  attached: false,
  rightVisible: false,
  bottomVisible: false,
  rightWidth: WORKSPACE_RIGHT_DEFAULT,
  bottomRatio: WORKSPACE_BOTTOM_DEFAULT_RATIO,
  activeRegion: 'right',
  maximizedRegion: undefined,
  auxiliaryPriority: 'workspace',
})

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalize(
  ownerId: string,
  input: WorkspaceLayoutPreference,
  previous: WorkspaceLayoutSnapshot = DETACHED_SNAPSHOT,
): WorkspaceLayoutSnapshot {
  return Object.freeze({
    attached: true,
    ownerId,
    rightVisible: input.rightVisible ?? previous.rightVisible,
    bottomVisible: input.bottomVisible ?? previous.bottomVisible,
    rightWidth: finite(input.rightWidth) ? input.rightWidth : previous.rightWidth,
    bottomRatio: finite(input.bottomRatio) ? input.bottomRatio : previous.bottomRatio,
    activeRegion: input.activeRegion ?? previous.activeRegion,
    maximizedRegion: Object.prototype.hasOwnProperty.call(input, 'maximizedRegion')
      ? input.maximizedRegion
      : previous.maximizedRegion,
    auxiliaryPriority: previous.auxiliaryPriority,
  })
}

/**
 * Concrete provider behind `ctx.workspaceLayout`. AppFrame also consumes this
 * instance directly so attach/dispose changes tracks without a second store.
 */
export class WorkspaceLayoutController implements IWorkspaceLayout {
  #snapshot: WorkspaceLayoutSnapshot = DETACHED_SNAPSHOT
  #listeners = new Set<() => void>()
  #generation = 0

  readonly getSnapshot = (): WorkspaceLayoutSnapshot => this.#snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  attach(ownerId: string, initialPreference: WorkspaceLayoutPreference = {}): WorkspaceLayoutHandle {
    if (ownerId.trim().length === 0) throw new Error('workspaceLayout: ownerId must be non-empty')
    if (this.#snapshot.attached) {
      throw new Error(`workspaceLayout: owner already attached (${this.#snapshot.ownerId ?? 'unknown'}); dispose it before attaching ${ownerId}`)
    }
    const generation = ++this.#generation
    this.#snapshot = normalize(ownerId, initialPreference)
    this.#emit()
    let disposed = false
    const requireLive = (): boolean => !disposed && generation === this.#generation && this.#snapshot.ownerId === ownerId
    return {
      update: (next) => {
        if (!requireLive()) return
        this.#update(next, true)
      },
      getSnapshot: () => this.#snapshot,
      subscribe: listener => this.subscribe(listener),
      dispose: () => {
        if (!requireLive()) return
        disposed = true
        this.#snapshot = DETACHED_SNAPSHOT
        this.#emit()
      },
    }
  }

  /** Internal AppFrame resize path; size commits are not an explicit open. */
  updateGeometry(next: Pick<WorkspaceLayoutPreference, 'rightWidth' | 'bottomRatio'>): void {
    if (!this.#snapshot.attached) return
    this.#update(next, false)
  }

  /** `ctx.layout.openDetails()` calls this to resolve a constrained frame. */
  noteDetailsOpened(): void {
    if (this.#snapshot.auxiliaryPriority === 'details') return
    this.#snapshot = Object.freeze({ ...this.#snapshot, auxiliaryPriority: 'details' })
    this.#emit()
  }

  restoreMaximized(): void {
    if (!this.#snapshot.attached || this.#snapshot.maximizedRegion === undefined) return
    this.#snapshot = Object.freeze({ ...this.#snapshot, maximizedRegion: undefined })
    this.#emit()
  }

  #update(next: WorkspaceLayoutPreference, explicit: boolean): void {
    const ownerId = this.#snapshot.ownerId
    if (ownerId === undefined) return
    const normalized = normalize(ownerId, next, this.#snapshot)
    const marksWorkspace = explicit && (
      next.rightVisible === true
      || next.bottomVisible === true
      || next.maximizedRegion !== undefined
      || next.activeRegion !== undefined
    )
    this.#snapshot = marksWorkspace
      ? Object.freeze({ ...normalized, auxiliaryPriority: 'workspace' })
      : normalized
    this.#emit()
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}
