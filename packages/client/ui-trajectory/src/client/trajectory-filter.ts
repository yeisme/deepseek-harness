/** Category classification for trajectory ledger filters and row styling. */

import type { TrajectoryCellProps } from './trajectory-record.ts'

/** User-selectable trajectory categories; an empty selection means all. */
export type TrajectoryCategory =
  | 'think'
  | 'read'
  | 'write'
  | 'shell'
  | 'web'
  | 'mcp'
  | 'tool'

/** Stable display order for the toolbar filter group. */
export const TRAJECTORY_CATEGORIES: readonly TrajectoryCategory[] = [
  'think',
  'read',
  'write',
  'shell',
  'web',
  'mcp',
  'tool',
]

function hasThinking(cell: TrajectoryCellProps): boolean {
  return (cell.thinkingDetail !== undefined && cell.thinkingDetail !== '')
    || (cell.sourceBlocks?.some(block => block.type === 'thinking') ?? false)
}

function toolCategory(toolName: string | undefined): TrajectoryCategory {
  const name = toolName ?? ''
  if (name.startsWith('mcp__')) return 'mcp'
  switch (name) {
    case 'read':
    case 'grep':
    case 'glob':
      return 'read'
    case 'write':
    case 'edit':
    case 'todo_write':
      return 'write'
    case 'bash':
    case 'pwsh':
    case 'run_code':
      return 'shell'
    case 'web_search':
    case 'web_fetch':
      return 'web'
    default:
      return 'tool'
  }
}

/**
 * Resolve the filter category of one trajectory record.
 * @param cell - Projected trajectory record.
 * @returns The category when the record belongs to a user-selectable filter,
 *   otherwise `null` (system/user/context/plain message records are not
 *   filtered by category).
 */
export function trajectoryCellCategory(
  cell: TrajectoryCellProps,
): TrajectoryCategory | null {
  if (cell.kind === 'message') {
    return hasThinking(cell) ? 'think' : null
  }
  if (cell.kind !== 'tool' && cell.kind !== 'subtool') return null
  return toolCategory(cell.toolName)
}
