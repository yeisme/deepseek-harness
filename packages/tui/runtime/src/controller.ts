import { createTuiState, update } from './state.ts'
import type {
  TuiEvent,
  TuiHarnessNotification,
  TuiServicePort,
  TuiState,
  TuiEffect,
} from './types.ts'

/**
 * Stateful bridge between the pure TUI transition function and a service
 * adapter. Effects execute in submission order; notifications can be applied
 * while an earlier effect is pending without losing durable cursor updates.
 */
export class TuiController {
  private stateValue: TuiState
  private effectQueue: Promise<void> = Promise.resolve()
  private disposed = false
  private readonly listeners = new Set<(state: TuiState) => void>()

  /**
   * @param service - service adapter for prompt, cancel, and replay operations.
   * @param initialState - optional initial state, normally from `createTuiState`.
   */
  constructor(
    private readonly service: TuiServicePort,
    initialState: TuiState = createTuiState(),
  ) {
    this.stateValue = initialState
  }

  /** Return the current immutable state. */
  get state(): TuiState {
    return this.stateValue
  }

  /**
   * Subscribe to committed state changes.
   * @param listener - callback invoked after each state transition.
   * @returns an idempotent disposer.
   */
  subscribe(listener: (state: TuiState) => void): () => void {
    if (this.disposed) throw new Error('TUI controller is disposed')
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Apply one terminal or service event and enqueue its effects.
   * @param event - deterministic input event.
   */
  dispatch(event: TuiEvent): void {
    this.ensureLive()
    const result = update(this.stateValue, event)
    this.commit(result.state)
    this.enqueue(result.effects)
  }

  /**
   * Apply one existing SDK notification.
   * @param notification - structural notification from a DSH service client.
   */
  notify(notification: TuiHarnessNotification): void {
    this.dispatch({ type: 'notification', notification })
  }

  /**
   * Wait until all effects already submitted to the controller settle.
   * @returns a promise that resolves after the current effect queue drains.
   */
  whenIdle(): Promise<void> {
    return this.effectQueue
  }

  /** Stop accepting events and release listeners. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private enqueue(effects: readonly TuiEffect[]): void {
    if (effects.length === 0) return
    this.effectQueue = this.effectQueue.then(async () => {
      for (const effect of effects) await this.runEffect(effect)
    })
  }

  private async runEffect(effect: TuiEffect): Promise<void> {
    if (this.disposed) return
    try {
      if (effect.type === 'send-prompt') {
        const receipt = await this.service.sendPrompt({
          sessionId: effect.sessionId,
          requestId: effect.requestId,
          text: effect.text,
          mode: effect.mode,
        })
        this.apply({ type: 'prompt/accepted', requestId: effect.requestId, messageId: receipt.messageId })
        return
      }
      if (effect.type === 'cancel-run') {
        await this.service.cancelRun(effect.sessionId)
        return
      }
      const replay = await this.service.replay(effect.sessionId, effect.fromSeq)
      this.apply({ type: 'replay/complete', cursor: replay.cursor, events: replay.events })
    } catch (error) {
      this.apply({ type: 'effect/error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  private apply(event: TuiEvent): void {
    const result = update(this.stateValue, event)
    this.commit(result.state)
    this.enqueue(result.effects)
  }

  private commit(state: TuiState): void {
    this.stateValue = state
    for (const listener of this.listeners) listener(state)
  }

  private ensureLive(): void {
    if (this.disposed) throw new Error('TUI controller is disposed')
  }
}
