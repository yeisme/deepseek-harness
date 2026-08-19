import { describe, expect, it } from 'vitest'
import { parseTuiArgs, TuiCliUsageError } from '../src/tui-args.ts'
import { parseTuiCommand } from '../src/tui-commands.ts'

describe('parseTuiArgs', () => {
  it('parses demo, one-shot, session, and screen options', () => {
    expect(parseTuiArgs(['--demo', '--once', 'hello', '--session', 's1', '--no-alt-screen']))
      .toEqual({ demo: true, once: 'hello', sessionId: 's1', noAlternateScreen: true, help: false })
    expect(parseTuiArgs(['--once=hello'])).toEqual({ demo: false, once: 'hello', sessionId: 'local', noAlternateScreen: false, help: false })
    expect(parseTuiArgs(['--help'])).toEqual({ demo: false, sessionId: 'local', noAlternateScreen: false, help: true })
  })

  it('rejects missing values and unknown flags', () => {
    expect(() => parseTuiArgs(['--once'])).toThrow(TuiCliUsageError)
    expect(() => parseTuiArgs(['--session='])).toThrow('--session needs a value')
    expect(() => parseTuiArgs(['--bogus'])).toThrow('unknown option')
  })
})

describe('parseTuiCommand', () => {
  it('keeps ordinary text as a prompt and recognizes shortcuts', () => {
    expect(parseTuiCommand('hello')).toEqual({ kind: 'prompt', text: 'hello' })
    expect(parseTuiCommand(':q')).toEqual({ kind: 'quit' })
    expect(parseTuiCommand(':help')).toEqual({ kind: 'help' })
    expect(parseTuiCommand(':clear')).toEqual({ kind: 'clear' })
    expect(parseTuiCommand(':detach')).toEqual({ kind: 'detach' })
    expect(parseTuiCommand(':reattach')).toEqual({ kind: 'reattach' })
    expect(parseTuiCommand(':mode steer')).toEqual({ kind: 'mode', mode: 'steer' })
    expect(parseTuiCommand(':mode nope')).toEqual({ kind: 'error', message: 'usage: :mode queue|steer' })
  })
})
