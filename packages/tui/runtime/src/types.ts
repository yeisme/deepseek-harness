/** Public types for the renderer-independent DSH TUI runtime. */

/** Connection lifecycle exposed to the semantic renderer. */
export type TuiConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** Agent activity lifecycle exposed to the semantic renderer. */
export type TuiRunState = 'idle' | 'running' | 'waiting' | 'error'

/** The composer delivery mode requested by the user. */
export type TuiComposerMode = 'queue' | 'steer'

/** A normalized transcript block that does not contain provider payloads. */
export interface TuiBlock {
  /** Stable local identity used by renderers and snapshots. */
  readonly id: string
  /** Semantic display category. */
  readonly kind: 'user' | 'assistant' | 'tool' | 'system' | 'notice'
  /** Plain text safe for a renderer to wrap. */
  readonly text: string
  /** Durable session sequence that produced this block, when known. */
  readonly seq?: number
}

/** One prompt awaiting the service receipt or a rejection. */
export interface TuiPendingPrompt {
  /** Client-generated id supplied by the input adapter. */
  readonly requestId: string
  /** The accepted delivery mode. */
  readonly mode: TuiComposerMode
  /** Text sent to the service. */
  readonly text: string
  /** Current receipt state. */
  readonly status: 'pending' | 'accepted' | 'rejected'
  /** Service message id after acceptance. */
  readonly messageId?: string
  /** Redacted user-facing failure text after rejection. */
  readonly error?: string
}

/** A renderer-neutral plugin command. */
export interface TuiCommandContribution {
  /** Stable command id, usually namespaced by the plugin id. */
  readonly id: string
  /** Human-readable key hint shown in command palettes and footers. */
  readonly shortcut?: string
  /** Short label shown by a renderer. */
  readonly label: string
}

/** A renderer-neutral plugin panel. */
export interface TuiPanelContribution {
  /** Stable panel id, usually namespaced by the plugin id. */
  readonly id: string
  /** Panel title. */
  readonly title: string
  /** Stable text rows produced by the plugin at render time. */
  readonly rows: readonly string[]
}

/** One trusted plugin registration accepted by the runtime registry. */
export interface TuiPluginDefinition {
  /** Stable plugin id. */
  readonly id: string
  /** Plugin version used for diagnostics and capability snapshots. */
  readonly version: string
  /** Commands contributed by the plugin. */
  readonly commands?: readonly TuiCommandContribution[]
  /** Panels contributed by the plugin. */
  readonly panels?: readonly TuiPanelContribution[]
}

/** Immutable plugin capability snapshot carried by TUI state. */
export interface TuiPluginSnapshot {
  /** Stable plugin id. */
  readonly id: string
  /** Plugin version. */
  readonly version: string
  /** Contributed commands. */
  readonly commands: readonly TuiCommandContribution[]
  /** Contributed panels. */
  readonly panels: readonly TuiPanelContribution[]
}

/** Minimal session event projection accepted at the wire adapter. */
export interface TuiSessionEvent {
  /** Monotonic durable sequence. */
  readonly seq: number
  /** Stable session event type. */
  readonly type: string
  /** Wire event data, retained only at the adapter boundary. */
  readonly data?: unknown
}

/** Structural notification accepted from an existing DSH SDK client. */
export interface TuiHarnessNotification {
  /** JSON-RPC notification method. */
  readonly method: string
  /** JSON-RPC params object. */
  readonly params: Record<string, unknown>
}

/** Events consumed by the pure TUI transition function. */
export type TuiEvent =
  | { readonly type: 'composer/change'; readonly value: string }
  | { readonly type: 'composer/mode'; readonly mode: TuiComposerMode }
  | { readonly type: 'key/submit'; readonly requestId: string }
  | { readonly type: 'key/interrupt' }
  | { readonly type: 'connection/state'; readonly state: TuiConnectionState }
  | { readonly type: 'notification'; readonly notification: TuiHarnessNotification }
  | { readonly type: 'prompt/accepted'; readonly requestId: string; readonly messageId: string }
  | { readonly type: 'prompt/rejected'; readonly requestId: string; readonly error: string }
  | { readonly type: 'effect/error'; readonly message: string }
  | { readonly type: 'replay/complete'; readonly cursor: number; readonly events: readonly TuiSessionEvent[] }
  | { readonly type: 'plugins/sync'; readonly plugins: readonly TuiPluginSnapshot[] }
  | { readonly type: 'view/detach' }
  | { readonly type: 'view/reattach' }

/** Commands returned by {@link update}; the terminal adapter executes them. */
export type TuiEffect =
  | {
    readonly type: 'send-prompt'
    readonly sessionId: string
    readonly requestId: string
    readonly text: string
    readonly mode: TuiComposerMode
  }
  | { readonly type: 'cancel-run'; readonly sessionId: string }
  | { readonly type: 'request-replay'; readonly sessionId: string; readonly fromSeq: number }

/** Immutable TUI state owned by the application shell. */
export interface TuiState {
  /** Session currently shown by the shell. */
  readonly sessionId: string | undefined
  /** Service connection state. */
  readonly connection: TuiConnectionState
  /** Agent activity state. */
  readonly run: TuiRunState
  /** Composer contents and delivery mode. */
  readonly composer: { readonly draft: string; readonly mode: TuiComposerMode }
  /** Normalized transcript rows in durable order. */
  readonly blocks: readonly TuiBlock[]
  /** Prompt receipts retained for the current interaction window. */
  readonly pending: readonly TuiPendingPrompt[]
  /** Last applied durable session sequence. */
  readonly cursor: number
  /** Number of events received after the visible cursor. */
  readonly unread: number
  /** Redacted status line shown below the transcript. */
  readonly notice: string | undefined
  /** Whether the shell has deliberately detached from live rendering. */
  readonly detached: boolean
  /** Trusted plugin capability snapshot. */
  readonly plugins: readonly TuiPluginSnapshot[]
}

/** Result of one deterministic state transition. */
export interface TuiUpdateResult {
  /** Next immutable state. */
  readonly state: TuiState
  /** Effects for the outer service/terminal adapter. */
  readonly effects: readonly TuiEffect[]
}

/** Narrow service face consumed by {@link TuiController}. */
export interface TuiServicePort {
  /** Send one prompt and return its durable service message id. */
  readonly sendPrompt: (request: {
    readonly sessionId: string
    readonly requestId: string
    readonly text: string
    readonly mode: TuiComposerMode
  }) => Promise<{ readonly messageId: string }>
  /** Request cancellation of the current run. */
  readonly cancelRun: (sessionId: string) => Promise<void>
  /** Replay durable events from a cursor, inclusive. */
  readonly replay: (sessionId: string, fromSeq: number) => Promise<{
    readonly cursor: number
    readonly events: readonly TuiSessionEvent[]
  }>
}

/** Tone used by semantic rows; renderers map tones to colors or attributes. */
export type TuiRowTone = 'normal' | 'muted' | 'accent' | 'success' | 'warning' | 'error'

/** One semantic terminal row. */
export interface TuiRow {
  /** Text without ANSI escape sequences. */
  readonly text: string
  /** Semantic style hint. */
  readonly tone: TuiRowTone
  /** Row origin used for snapshot assertions and renderer policy. */
  readonly source: 'header' | 'block' | 'composer' | 'footer' | 'panel'
}

/** A complete renderer-neutral frame. */
export interface TuiFrame {
  /** Rows in display order. */
  readonly rows: readonly TuiRow[]
  /** Whether the frame was truncated to fit the requested height. */
  readonly truncated: boolean
}
