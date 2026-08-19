import type {
  TuiBlock,
  TuiComposerMode,
  TuiEffect,
  TuiEvent,
  TuiHarnessNotification,
  TuiPluginSnapshot,
  TuiRunState,
  TuiSessionEvent,
  TuiState,
  TuiUpdateResult,
} from './types.ts'

/**
 * Create an empty state for one shell-selected session.
 * @param sessionId - optional session selected by the shell.
 * @returns a disconnected, idle TUI state.
 */
export function createTuiState(sessionId?: string): TuiState {
  return {
    sessionId,
    connection: 'disconnected',
    run: 'idle',
    composer: { draft: '', mode: 'queue' },
    blocks: [],
    pending: [],
    // Session events start at sequence 0; -1 means that no event is applied.
    cursor: -1,
    unread: 0,
    notice: undefined,
    detached: false,
    plugins: [],
  }
}

/**
 * Apply one terminal or service event without side effects.
 * @param state - current immutable TUI state.
 * @param event - normalized input or service event.
 * @returns next state plus effects for the outer adapter.
 */
export function update(state: TuiState, event: TuiEvent): TuiUpdateResult {
  switch (event.type) {
    case 'composer/change':
      return result({ ...state, composer: { ...state.composer, draft: event.value }, notice: undefined })
    case 'composer/mode':
      return result({ ...state, composer: { ...state.composer, mode: event.mode } })
    case 'key/submit':
      return submit(state, event.requestId)
    case 'key/interrupt':
      return interrupt(state)
    case 'connection/state':
      return connectionState(state, event.state)
    case 'notification':
      return notification(state, event.notification)
    case 'prompt/accepted':
      return receipt(state, event.requestId, 'accepted', event.messageId)
    case 'prompt/rejected':
      return receipt(state, event.requestId, 'rejected', undefined, event.error)
    case 'effect/error':
      return result({ ...state, notice: event.message })
    case 'replay/complete':
      return replay(state, event.cursor, event.events)
    case 'plugins/sync':
      return result({ ...state, plugins: clonePlugins(event.plugins) })
    case 'view/detach':
      return result({ ...state, detached: true, notice: 'detached; background events remain recoverable' })
    case 'view/reattach':
      if (state.sessionId === undefined) return result({ ...state, detached: false })
      return {
        state: { ...state, detached: false, notice: 'replaying missed events' },
        effects: [{ type: 'request-replay', sessionId: state.sessionId, fromSeq: state.cursor + 1 }],
      }
  }
}

/**
 * Adapt an existing SDK notification into a pure TUI transition.
 * @param state - current immutable TUI state.
 * @param notification - structural SDK notification from the service client.
 * @returns next state plus any replay or interaction effects.
 */
export function reduceHarnessNotification(state: TuiState, notification: TuiHarnessNotification): TuiUpdateResult {
  return update(state, { type: 'notification', notification })
}

function submit(state: TuiState, requestId: string): TuiUpdateResult {
  const text = state.composer.draft.trim()
  if (text.length === 0) return result({ ...state, notice: 'empty prompt' })
  if (state.sessionId === undefined) return result({ ...state, notice: 'select a session before sending' })
  const mode: TuiComposerMode = state.run === 'running' ? state.composer.mode : 'queue'
  const pending = [...state.pending, { requestId, mode, text, status: 'pending' as const }]
  const block: TuiBlock = { id: `local:${requestId}`, kind: 'user', text }
  return {
    state: { ...state, composer: { ...state.composer, draft: '' }, blocks: [...state.blocks, block], pending, notice: undefined },
    effects: [{ type: 'send-prompt', sessionId: state.sessionId, requestId, text, mode }],
  }
}

function interrupt(state: TuiState): TuiUpdateResult {
  if (state.sessionId === undefined || state.run === 'idle') return result({ ...state, notice: 'nothing is running' })
  return {
    state: { ...state, notice: 'interrupt requested' },
    effects: [{ type: 'cancel-run', sessionId: state.sessionId }],
  }
}

function connectionState(state: TuiState, next: TuiState['connection']): TuiUpdateResult {
  const notice = next === 'connected' && state.connection === 'reconnecting'
    ? 'connection restored; replay is required before new input'
    : next === 'disconnected' ? 'service disconnected' : state.notice
  const effects: readonly TuiEffect[] = next === 'connected' && state.connection === 'reconnecting' && state.sessionId !== undefined
    ? [{ type: 'request-replay', sessionId: state.sessionId, fromSeq: state.cursor + 1 }]
    : []
  return { state: { ...state, connection: next, notice }, effects }
}

function notification(state: TuiState, notification: TuiHarnessNotification): TuiUpdateResult {
  const params = notification.params
  const sessionId = stringField(params, 'sessionId')
  if (state.sessionId !== undefined && sessionId !== undefined && sessionId !== state.sessionId) return result(state)
  if (notification.method === 'session.status') {
    const status = stringField(params, 'status')
    if (status !== 'idle' && status !== 'running') return result({ ...state, notice: 'ignored unknown session status' })
    return result({ ...state, run: status as TuiRunState })
  }
  if (notification.method === 'session.event') {
    const event = sessionEvent(params['event'])
    if (event === undefined) return result({ ...state, notice: 'ignored malformed session event' })
    return appendSessionEvent(state, event)
  }
  if (notification.method === 'subagent.started' || notification.method === 'subagent.finished') {
    const parentSessionId = stringField(params, 'parentSessionId')
    const childSessionId = stringField(params, 'childSessionId')
    if (state.sessionId !== undefined && parentSessionId !== state.sessionId && childSessionId !== state.sessionId) return result(state)
  }
  if (notification.method === 'subagent.started') return result({ ...state, notice: 'subagent started' })
  if (notification.method === 'subagent.finished') return result({ ...state, notice: 'subagent finished' })
  return result(state)
}

function appendSessionEvent(state: TuiState, event: TuiSessionEvent): TuiUpdateResult {
  if (event.seq <= state.cursor) return result(state)
  if (event.seq > state.cursor + 1 && state.sessionId !== undefined) {
    return {
      state: { ...state, connection: 'reconnecting', notice: `event gap detected at ${state.cursor + 1}` },
      effects: [{ type: 'request-replay', sessionId: state.sessionId, fromSeq: state.cursor + 1 }],
    }
  }
  const block = blockFromEvent(event)
  const blocks = block === undefined ? state.blocks : reconcileLocalEcho(state.blocks, block)
  return result({
    ...state,
    cursor: event.seq,
    unread: state.detached ? state.unread + 1 : state.unread,
    blocks,
    notice: undefined,
  })
}

function replay(state: TuiState, cursor: number, events: readonly TuiSessionEvent[]): TuiUpdateResult {
  const sorted = [...events].sort((left, right) => left.seq - right.seq)
  let next = { ...state, connection: 'connected' as const, cursor: state.cursor, unread: 0, notice: undefined }
  for (const event of sorted) {
    if (event.seq <= next.cursor) continue
    const block = blockFromEvent(event)
    next = {
      ...next,
      cursor: event.seq,
      blocks: block === undefined ? next.blocks : reconcileLocalEcho(next.blocks, block),
    }
  }
  return result({ ...next, cursor: Math.max(next.cursor, cursor) })
}

function receipt(
  state: TuiState,
  requestId: string,
  status: 'accepted' | 'rejected',
  messageId: string | undefined,
  error?: string,
): TuiUpdateResult {
  let found = false
  const pending = state.pending.map((item) => {
    if (item.requestId !== requestId) return item
    found = true
    return {
      ...item,
      status,
      ...(messageId === undefined ? {} : { messageId }),
      ...(error === undefined ? {} : { error }),
    }
  })
  return result(found ? { ...state, pending, notice: error } : { ...state, notice: `unknown prompt receipt: ${requestId}` })
}

function blockFromEvent(event: TuiSessionEvent): TuiBlock | undefined {
  const kind = event.type === 'user/message' ? 'user'
    : event.type.startsWith('assistant/') ? 'assistant'
      : event.type.startsWith('tool/') ? 'tool'
        : event.type.startsWith('turn/error') ? 'notice'
          : undefined
  if (kind === undefined) return undefined
  const text = textFromData(event.data)
  if (text === undefined) return undefined
  return { id: `event:${event.seq}`, kind, text, seq: event.seq }
}

function sessionEvent(value: unknown): TuiSessionEvent | undefined {
  if (!isRecord(value)) return undefined
  const seq = value['seq']
  const type = value['type']
  if (!Number.isSafeInteger(seq) || typeof type !== 'string' || type.length === 0) return undefined
  return { seq: seq as number, type, ...(Object.hasOwn(value, 'data') ? { data: value['data'] } : {}) }
}

function textFromData(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (!isRecord(value)) return undefined
  for (const key of ['text', 'message', 'content']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
  }
  if (Array.isArray(value['content'])) {
    const text = value['content']
      .filter(isRecord)
      .map(block => block['text'])
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .join('')
    if (text.length > 0) return text
  }
  return undefined
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key]
  return typeof candidate === 'string' ? candidate : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clonePlugins(plugins: readonly TuiPluginSnapshot[]): readonly TuiPluginSnapshot[] {
  return plugins.map(plugin => ({
    ...plugin,
    commands: [...plugin.commands],
    panels: plugin.panels.map(panel => ({ ...panel, rows: [...panel.rows] })),
  }))
}

function reconcileLocalEcho(blocks: readonly TuiBlock[], next: TuiBlock): readonly TuiBlock[] {
  const previous = blocks.at(-1)
  if (next.kind === 'user' && previous?.id.startsWith('local:') && previous.text === next.text) {
    return [...blocks.slice(0, -1), next]
  }
  return [...blocks, next]
}

function result(state: TuiState): TuiUpdateResult {
  return { state, effects: [] }
}
