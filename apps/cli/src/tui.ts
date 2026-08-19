#!/usr/bin/env node
/** Minimal terminal adapter for the renderer-neutral DSH TUI runtime. */

import { randomUUID } from 'node:crypto'
import * as readline from 'node:readline'
import { TuiController, createTuiState, render } from '@deepseek-ai/dsh-tui-runtime'
import type { TuiHarnessNotification, TuiServicePort } from '@deepseek-ai/dsh-tui-runtime'
import { parseTuiCommand } from './tui-commands.ts'
import { TUI_HELP, TuiCliUsageError, parseTuiArgs } from './tui-args.ts'

/** Narrow terminal input surface used by the adapter and its tests. */
export interface TuiInput extends NodeJS.ReadableStream {
  isTTY?: boolean
  setRawMode?: (mode: boolean) => TuiInput
}

/** Narrow terminal output surface used by the adapter and its tests. */
export interface TuiOutput extends NodeJS.WritableStream {
  isTTY?: boolean
  columns?: number
  rows?: number
}

/** Injectable streams make the non-TTY path deterministic in command tests. */
export interface TuiIo {
  readonly input: TuiInput
  readonly output: TuiOutput
  readonly stderr: NodeJS.WritableStream
}

/** Options accepted by the CLI-to-TUI boundary. */
export interface RunTuiOptions {
  readonly args: readonly string[]
  readonly patches?: readonly string[]
  readonly io?: TuiIo
}

/**
 * Start the DSH TUI.
 *
 * The first executable slice deliberately uses a local loopback service behind
 * `--demo`. It validates keyboard, state, rendering, interruption, and cleanup
 * behavior without reading credentials or pretending that a production IPC
 * adapter is already configured.
 * @param options - launcher arguments, optional patch overlays, and streams.
 * @returns a process-style exit code.
 */
export async function runTui(options: RunTuiOptions): Promise<number> {
  const io = options.io ?? { input: process.stdin, output: process.stdout, stderr: process.stderr }
  let parsed
  try {
    parsed = parseTuiArgs(options.args)
  } catch (error) {
    const message = error instanceof TuiCliUsageError ? error.message : String(error)
    io.stderr.write(`${message}\n`)
    return 2
  }
  if (parsed.help) {
    io.output.write(`${TUI_HELP.trimStart()}\n`)
    return 0
  }
  if ((options.patches?.length ?? 0) > 0) {
    io.stderr.write('dsh tui: --patch is reserved for the service-backed adapter and is not active yet\n')
    return 2
  }

  const timers = new Set<ReturnType<typeof setTimeout>>()
  let active = true
  let demoSequence = -1
  let controller: TuiController | undefined

  const notify = (notification: TuiHarnessNotification): void => {
    if (!active || controller === undefined) return
    controller.notify(notification)
  }

  const service: TuiServicePort = {
    async sendPrompt(request) {
      if (!parsed.demo) throw new Error('TUI service adapter is not configured; retry with --demo')
      const messageId = `local-${randomUUID()}`
      const userSeq = ++demoSequence
      queueMicrotask(() => {
        notify({ method: 'session.status', params: { sessionId: request.sessionId, status: 'running' } })
        notify({
          method: 'session.event',
          params: { sessionId: request.sessionId, event: { seq: userSeq, type: 'user/message', data: { text: request.text } } },
        })
        const timer = setTimeout(() => {
          timers.delete(timer)
          const assistantSeq = ++demoSequence
          notify({
            method: 'session.event',
            params: {
              sessionId: request.sessionId,
              event: { seq: assistantSeq, type: 'assistant/message', data: { text: `loopback · ${request.text}` } },
            },
          })
          notify({ method: 'session.status', params: { sessionId: request.sessionId, status: 'idle' } })
        }, 10)
        timers.add(timer)
      })
      return { messageId }
    },
    async cancelRun(sessionId) {
      notify({ method: 'session.status', params: { sessionId, status: 'idle' } })
    },
    async replay() {
      return { cursor: demoSequence, events: [] }
    },
  }

  controller = new TuiController(service, createTuiState(parsed.sessionId))
  const interactive = parsed.once === undefined && io.input.isTTY === true && io.output.isTTY === true
  const unsubscribe = controller.subscribe(() => {
    if (interactive) draw()
  })
  if (parsed.demo) controller.dispatch({ type: 'connection/state', state: 'connected' })

  if (parsed.once !== undefined) {
    controller.dispatch({ type: 'composer/change', value: parsed.once })
    controller.dispatch({ type: 'key/submit', requestId: randomUUID() })
    await controller.whenIdle()
    if (parsed.demo) await delay(20)
    await controller.whenIdle()
    io.output.write(frameText(controller, io.output) + '\n')
    const failed = controller.state.notice?.includes('not configured') === true
    if (failed) io.stderr.write(`${controller.state.notice}\n`)
    cleanup()
    return failed ? 2 : 0
  }
  if (!interactive) {
    io.output.write(`${TUI_HELP.trimStart()}\n`)
    cleanup()
    return 0
  }

  return await runInteractive(controller, parsed.noAlternateScreen, io, draw, cleanup)

  function draw(): void {
    if (controller === undefined) return
    const frame = render(controller.state, io.output.columns ?? 80, io.output.rows ?? 24)
    const text = frame.rows.map(row => row.text).join('\n')
    io.output.write(`\u001b[2J\u001b[H${text}`)
  }

  function cleanup(): void {
    active = false
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    unsubscribe()
    controller?.dispose()
  }
}

async function runInteractive(
  controller: TuiController,
  noAlternateScreen: boolean,
  io: TuiIo,
  draw: () => void,
  cleanup: () => void,
): Promise<number> {
  let draft = controller.state.composer.draft
  let finished = false
  let resolveExit: ((code: number) => void) | undefined
  let pendingExit: number | undefined
  const exit = (code: number): void => {
    if (finished) return
    finished = true
    io.input.off('keypress', onKeypress)
    io.input.setRawMode?.(false)
    io.input.pause()
    if (!noAlternateScreen) io.output.write('\u001b[?25h\u001b[?1049l')
    else io.output.write('\u001b[?25h\n')
    cleanup()
    if (resolveExit === undefined) pendingExit = code
    else resolveExit(code)
  }

  const onKeypress = (text: string, key: readline.Key): void => {
    if (key.ctrl && key.name === 'c') {
      if (controller.state.run !== 'idle') controller.dispatch({ type: 'key/interrupt' })
      else exit(130)
      return
    }
    if (key.ctrl && key.name === 'd') {
      if (draft.length === 0) exit(0)
      return
    }
    if (key.ctrl && key.name === 'g') {
      controller.dispatch({ type: 'view/detach' })
      draw()
      return
    }
    if (key.ctrl && key.name === 'l') {
      draw()
      return
    }
    if (key.name === 'backspace') {
      draft = draft.slice(0, -1)
      controller.dispatch({ type: 'composer/change', value: draft })
      return
    }
    if (key.name === 'return' || key.name === 'enter') {
      const command = parseTuiCommand(draft)
      if (command.kind === 'quit') {
        exit(0)
        return
      }
      if (command.kind === 'help') {
        controller.dispatch({ type: 'effect/error', message: TUI_HELP.trim() })
      } else if (command.kind === 'clear') {
        draft = ''
        controller.dispatch({ type: 'composer/change', value: '' })
      } else if (command.kind === 'detach') {
        controller.dispatch({ type: 'view/detach' })
      } else if (command.kind === 'reattach') {
        controller.dispatch({ type: 'view/reattach' })
      } else if (command.kind === 'mode') {
        controller.dispatch({ type: 'composer/mode', mode: command.mode })
        draft = ''
        controller.dispatch({ type: 'composer/change', value: '' })
      } else if (command.kind === 'error') {
        controller.dispatch({ type: 'effect/error', message: command.message })
      } else {
        controller.dispatch({ type: 'key/submit', requestId: randomUUID() })
        draft = ''
      }
      draw()
      return
    }
    if (!key.ctrl && !key.meta && text.length > 0) {
      draft += text
      controller.dispatch({ type: 'composer/change', value: draft })
    }
  }

  const exitPromise = new Promise<number>(resolve => { resolveExit = resolve })
  try {
    readline.emitKeypressEvents(io.input)
    io.input.on('keypress', onKeypress)
    io.input.setRawMode?.(true)
    io.input.resume()
    if (!noAlternateScreen) io.output.write('\u001b[?1049h')
    io.output.write('\u001b[?25l')
    draw()
  } catch (error) {
    io.input.off('keypress', onKeypress)
    io.input.setRawMode?.(false)
    if (!noAlternateScreen) io.output.write('\u001b[?25h\u001b[?1049l')
    else io.output.write('\u001b[?25h\n')
    cleanup()
    io.stderr.write(`dsh tui: failed to start terminal loop: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  const settle = resolveExit
  if (pendingExit !== undefined && settle !== undefined) settle(pendingExit)
  return await exitPromise
}

function frameText(controller: TuiController, output: TuiOutput): string {
  return render(controller.state, output.columns ?? 80, output.rows ?? 24).rows.map(row => row.text).join('\n')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
