import { describe, expect, it } from 'vitest'
import {
  TuiController,
  TuiPluginRegistry,
  createTuiState,
  reduceHarnessNotification,
  render,
  update,
} from '../src/index.ts'

describe('dsh TUI runtime state', () => {
  it('queues a prompt and keeps the receipt pending until the service answers', () => {
    const initial = createTuiState('session-1')
    const submitted = update(update(initial, { type: 'composer/change', value: ' inspect the repo ' }).state, {
      type: 'key/submit',
      requestId: 'request-1',
    })

    expect(submitted.effects).toEqual([{
      type: 'send-prompt',
      sessionId: 'session-1',
      requestId: 'request-1',
      text: 'inspect the repo',
      mode: 'queue',
    }])
    expect(submitted.state.blocks).toEqual([{ id: 'local:request-1', kind: 'user', text: 'inspect the repo' }])
    expect(submitted.state.pending).toMatchObject([{ requestId: 'request-1', status: 'pending' }])

    const accepted = update(submitted.state, { type: 'prompt/accepted', requestId: 'request-1', messageId: 'message-1' })
    expect(accepted.state.pending).toMatchObject([{ requestId: 'request-1', status: 'accepted', messageId: 'message-1' }])

    const durable = reduceHarnessNotification(accepted.state, {
      method: 'session.event',
      params: { sessionId: 'session-1', event: { seq: 0, type: 'user/message', data: { text: 'inspect the repo' } } },
    })
    expect(durable.state.blocks).toEqual([{ id: 'event:0', kind: 'user', text: 'inspect the repo', seq: 0 }])
  })

  it('uses steer only during a running turn and requests replay after an event gap', () => {
    let state = createTuiState('session-1')
    state = update(state, { type: 'connection/state', state: 'connected' }).state
    state = update(state, { type: 'notification', notification: {
      method: 'session.status', params: { sessionId: 'session-1', status: 'running' },
    } }).state
    state = update(state, { type: 'composer/mode', mode: 'steer' }).state
    state = update(state, { type: 'composer/change', value: 'stop after the current tool' }).state
    const submitted = update(state, { type: 'key/submit', requestId: 'request-2' })
    expect(submitted.effects[0]).toMatchObject({ type: 'send-prompt', mode: 'steer' })

    const gap = reduceHarnessNotification(submitted.state, {
      method: 'session.event',
      params: { sessionId: 'session-1', event: { seq: 4, type: 'assistant/message', data: { text: 'late' } } },
    })
    expect(gap.state.connection).toBe('reconnecting')
    expect(gap.effects).toEqual([{ type: 'request-replay', sessionId: 'session-1', fromSeq: 0 }])
  })

  it('replays events deterministically and renders bounded semantic rows', () => {
    const state = createTuiState('session-1')
    const replayed = update(state, {
      type: 'replay/complete',
      cursor: 1,
      events: [
        { seq: 1, type: 'assistant/message', data: { text: 'second' } },
        { seq: 0, type: 'user/message', data: { content: [{ type: 'text', text: 'first' }] } },
      ],
    }).state
    const frame = render(replayed, 24, 4)
    expect(replayed.cursor).toBe(1)
    expect(replayed.blocks.map(block => block.text)).toEqual(['first', 'second'])
    expect(frame.rows).toHaveLength(4)
    expect(frame.truncated).toBe(true)
    expect(frame.rows.at(-1)?.text).toContain('Ctrl+C')
  })
})

describe('dsh TUI plugin registry', () => {
  it('namespaces contributions and removes them through the disposer', () => {
    const registry = new TuiPluginRegistry()
    const dispose = registry.register({
      id: 'review',
      version: '1.0.0',
      commands: [{ id: 'review.approve', shortcut: 'A', label: 'Approve' }],
      panels: [{ id: 'review.status', title: 'Review', rows: ['ready'] }],
    })
    expect(registry.snapshot()).toMatchObject([{ id: 'review', commands: [{ id: 'review.approve' }] }])
    dispose()
    dispose()
    expect(registry.snapshot()).toEqual([])
  })
})

describe('dsh TUI controller', () => {
  it('executes service effects in order and applies the prompt receipt', async () => {
    const calls: string[] = []
    const controller = new TuiController({
      async sendPrompt(request) {
        calls.push(`${request.mode}:${request.text}`)
        return { messageId: 'message-3' }
      },
      async cancelRun() { calls.push('cancel') },
      async replay() { calls.push('replay'); return { cursor: 0, events: [] } },
    }, createTuiState('session-1'))

    controller.dispatch({ type: 'composer/change', value: 'hello' })
    controller.dispatch({ type: 'key/submit', requestId: 'request-3' })
    await controller.whenIdle()

    expect(calls).toEqual(['queue:hello'])
    expect(controller.state.pending).toMatchObject([{ requestId: 'request-3', status: 'accepted', messageId: 'message-3' }])
    controller.dispose()
  })

  it('converts service failures into a visible notice', async () => {
    const controller = new TuiController({
      async sendPrompt() { throw new Error('service unavailable') },
      async cancelRun() {},
      async replay() { return { cursor: 0, events: [] } },
    }, createTuiState('session-1'))
    controller.dispatch({ type: 'composer/change', value: 'hello' })
    controller.dispatch({ type: 'key/submit', requestId: 'request-4' })
    await controller.whenIdle()
    expect(controller.state.notice).toBe('service unavailable')
    controller.dispose()
  })
})
