import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runTui } from '../src/tui.ts'

function streams(): { input: PassThrough & { isTTY: boolean }; output: PassThrough & { isTTY: boolean }; stderr: PassThrough } {
  const input = Object.assign(new PassThrough(), { isTTY: false })
  const output = Object.assign(new PassThrough(), { isTTY: false })
  return { input, output, stderr: new PassThrough() }
}

function read(stream: PassThrough): string {
  return stream.read()?.toString() ?? ''
}

describe('runTui', () => {
  it('runs a deterministic one-shot loopback frame without a TTY', async () => {
    const io = streams()
    await expect(runTui({ args: ['--demo', '--once', 'hello'], io })).resolves.toBe(0)
    const output = read(io.output)
    expect(output).toContain('dsh · local · idle · connected')
    expect(output).toContain('dsh  loopback · hello')
  })

  it('fails honestly when a service adapter is not configured', async () => {
    const io = streams()
    await expect(runTui({ args: ['--once', 'hello'], io })).resolves.toBe(2)
    expect(read(io.output)).toContain('you  hello')
    expect(read(io.stderr)).toContain('TUI service adapter is not configured')
  })

  it('prints help for a non-TTY with no prompt', async () => {
    const io = streams()
    await expect(runTui({ args: [], io })).resolves.toBe(0)
    expect(read(io.output)).toContain('Usage:')
  })
})
