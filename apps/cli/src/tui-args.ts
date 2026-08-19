/** Pure argument parsing for the built-in DSH terminal UI. */

/** Parsed TUI shell options. */
export interface TuiCliOptions {
  /** Show the command help and exit. */
  readonly help: boolean
  /** Use the local in-process loopback service. */
  readonly demo: boolean
  /** Send one prompt and print one frame, then exit. */
  readonly once?: string
  /** Keep the terminal in the current screen instead of using an alternate screen. */
  readonly noAlternateScreen: boolean
  /** Session identity displayed by the shell. */
  readonly sessionId: string
}

/** Stable usage text shared by TTY and non-TTY invocations. */
export const TUI_HELP = `
Usage:
  dsh tui [options]
  omdsh [options]

Options:
  --demo                    use the local loopback service (no credentials)
  --once <text>             send one prompt, print the resulting frame, and exit
  --session <id>            select the displayed session (default: local)
  --no-alt-screen           do not enter the terminal alternate screen
  -h, --help                show this help

Interactive shortcuts:
  Enter                     send the composer
  Ctrl+C                    interrupt a run, or quit when idle
  Ctrl+G                    detach the view; use :reattach to recover it
  :help                     show this help
  :mode queue|steer         select delivery mode while a run is active
  :clear                    clear the current composer
  :q, :quit                 quit the TUI
`

/** Error raised for a malformed TUI command line. */
export class TuiCliUsageError extends Error {
  override readonly name = 'TuiCliUsageError'
}

/**
 * Parse TUI-owned flags without touching process state.
 * @param argv - arguments after `tui` (or after the `omdsh` executable alias).
 * @returns normalized TUI options.
 */
export function parseTuiArgs(argv: readonly string[]): TuiCliOptions {
  let help = false
  let demo = false
  let once: string | undefined
  let noAlternateScreen = false
  let sessionId = 'local'

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? ''
    if (argument === '-h' || argument === '--help') {
      help = true
      continue
    }
    if (argument === '--demo') {
      demo = true
      continue
    }
    if (argument === '--no-alt-screen') {
      noAlternateScreen = true
      continue
    }
    if (argument === '--once' || argument === '--session') {
      const value = argv[index + 1]
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new TuiCliUsageError(`dsh tui: ${argument} needs a value`)
      }
      index += 1
      if (argument === '--once') once = value
      else sessionId = value
      continue
    }
    if (argument.startsWith('--once=')) {
      const value = argument.slice('--once='.length)
      if (value === '') throw new TuiCliUsageError('dsh tui: --once needs a value')
      once = value
      continue
    }
    if (argument.startsWith('--session=')) {
      const value = argument.slice('--session='.length)
      if (value === '') throw new TuiCliUsageError('dsh tui: --session needs a value')
      sessionId = value
      continue
    }
    throw new TuiCliUsageError(`dsh tui: unknown option ${JSON.stringify(argument)} (try --help)`)
  }

  return { help, demo, ...(once === undefined ? {} : { once }), noAlternateScreen, sessionId }
}
