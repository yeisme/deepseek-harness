import type { TuiBlock, TuiFrame, TuiRow, TuiState } from './types.ts'

/**
 * Produce a deterministic semantic frame for a fixed terminal size.
 * @param state - immutable state to present.
 * @param width - terminal width in columns.
 * @param height - terminal height in rows.
 * @returns rows without ANSI escapes for a Pi/OMP or test renderer.
 */
export function render(state: TuiState, width: number, height: number): TuiFrame {
  const safeWidth = Math.max(1, Math.floor(width))
  const safeHeight = Math.max(1, Math.floor(height))
  const rows: TuiRow[] = []
  rows.push({ text: headerText(state), tone: state.connection === 'connected' ? 'success' : 'warning', source: 'header' })
  for (const block of state.blocks) appendWrapped(rows, block, safeWidth)
  for (const plugin of state.plugins) {
    for (const panel of plugin.panels) {
      rows.push({ text: `${panel.title}:`, tone: 'accent', source: 'panel' })
      for (const panelRow of panel.rows) appendText(rows, panelRow, 'muted', 'panel', safeWidth)
    }
  }
  const notice = state.notice ?? (state.unread > 0 ? `${state.unread} unread event(s)` : undefined)
  if (notice !== undefined) appendText(rows, notice, 'muted', 'footer', safeWidth)
  appendText(rows, composerText(state), 'normal', 'composer', safeWidth)
  const footer = state.plugins.flatMap(plugin => plugin.commands)
    .map(command => command.shortcut === undefined ? command.label : `${command.shortcut} ${command.label}`)
  appendFitted(rows, footer.length === 0 ? 'Enter send · Ctrl+C interrupt · Ctrl+G detach' : footer.join(' · '), 'muted', 'footer', safeWidth)
  const truncated = rows.length > safeHeight
  if (!truncated) return { rows, truncated: false }
  const header = rows[0]
  const composer = rows.at(-2)
  const footerRow = rows.at(-1)
  if (header === undefined || composer === undefined || footerRow === undefined) return { rows: rows.slice(-safeHeight), truncated: true }
  if (safeHeight === 1) return { rows: [footerRow], truncated: true }
  if (safeHeight === 2) return { rows: [header, footerRow], truncated: true }
  const middle = rows.slice(1, -2)
  const bodyBudget = safeHeight - 3
  return { rows: [header, ...middle.slice(-bodyBudget), composer, footerRow], truncated: true }
}

function headerText(state: TuiState): string {
  const session = state.sessionId ?? 'no-session'
  const run = state.run === 'running' ? 'working' : state.run
  return `dsh · ${session} · ${run} · ${state.connection}`
}

function composerText(state: TuiState): string {
  const marker = state.composer.mode === 'steer' && state.run === 'running' ? 'steer' : 'queue'
  return `${marker}> ${state.composer.draft}`
}

function appendWrapped(rows: TuiRow[], block: TuiBlock, width: number): void {
  const prefix = block.kind === 'user' ? 'you  ' : block.kind === 'assistant' ? 'dsh  ' : `${block.kind.padEnd(5)} `
  const available = Math.max(1, width - prefix.length)
  const chunks = wrap(block.text, available)
  for (const [index, chunk] of chunks.entries()) {
    rows.push({
      text: `${index === 0 ? prefix : ' '.repeat(prefix.length)}${chunk}`,
      tone: block.kind === 'notice' ? 'error' : block.kind === 'assistant' ? 'normal' : 'accent',
      source: 'block',
    })
  }
}

function appendText(rows: TuiRow[], text: string, tone: TuiRow['tone'], source: TuiRow['source'], width: number): void {
  for (const chunk of wrap(text, width)) rows.push({ text: chunk, tone, source })
}

function appendFitted(rows: TuiRow[], text: string, tone: TuiRow['tone'], source: TuiRow['source'], width: number): void {
  rows.push({
    text: text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`,
    tone,
    source,
  })
}

function wrap(text: string, width: number): readonly string[] {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const lines: string[] = []
  for (const line of normalized.split('\n')) {
    if (line.length === 0) {
      lines.push('')
      continue
    }
    for (let offset = 0; offset < line.length; offset += width) lines.push(line.slice(offset, offset + width))
  }
  return lines.length === 0 ? [''] : lines
}
