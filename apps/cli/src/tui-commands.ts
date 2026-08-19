/** Colon-command parser for the DSH TUI composer. */

/** Semantic command understood by the terminal adapter. */
export type TuiCommand =
  | { readonly kind: 'prompt'; readonly text: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'quit' }
  | { readonly kind: 'detach' }
  | { readonly kind: 'reattach' }
  | { readonly kind: 'mode'; readonly mode: 'queue' | 'steer' }
  | { readonly kind: 'error'; readonly message: string }

/**
 * Parse one submitted composer line.
 * @param input - raw composer contents.
 * @returns a semantic command; ordinary text remains a prompt.
 */
export function parseTuiCommand(input: string): TuiCommand {
  const text = input.trim()
  if (!text.startsWith(':')) return { kind: 'prompt', text: input }
  const [name = '', value] = text.slice(1).split(/\s+/, 2)
  if (name === 'q' || name === 'quit' || name === 'exit') return { kind: 'quit' }
  if (name === 'h' || name === 'help') return { kind: 'help' }
  if (name === 'clear') return { kind: 'clear' }
  if (name === 'detach') return { kind: 'detach' }
  if (name === 'reattach') return { kind: 'reattach' }
  if (name === 'mode' && (value === 'queue' || value === 'steer')) return { kind: 'mode', mode: value }
  if (name === 'mode') return { kind: 'error', message: 'usage: :mode queue|steer' }
  return { kind: 'error', message: `unknown command :${name}` }
}
