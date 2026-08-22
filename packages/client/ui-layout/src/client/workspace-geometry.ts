/** Pure AppFrame workspace geometry solver. */
import {
  clampWidth,
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_COLLAPSED,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from './columns.ts'
import type { WorkspaceLayoutSnapshot, WorkspaceRegion, WorkspaceRegionMode } from './workspace-layout.ts'

export const CONVERSATION_MIN_WIDTH = 420
export const CONVERSATION_MIN_HEIGHT = 320
export const WORKSPACE_RAIL_WIDTH = 44
export const WORKSPACE_RIGHT_MIN = 360
export const WORKSPACE_RIGHT_MAX = 840
export const WORKSPACE_RIGHT_MAX_RATIO = 0.6
export const WORKSPACE_BOTTOM_MIN = 180
export const WORKSPACE_BOTTOM_MAX_RATIO = 0.65

export interface WorkspaceGeometryInput {
  readonly width: number
  readonly height: number
  readonly sidebar: number
  readonly details: number
  readonly workspace: WorkspaceLayoutSnapshot
}

export interface WorkspaceGeometry {
  readonly sidebar: number
  readonly conversationWidth: number
  readonly conversationHeight: number
  readonly rightWidth: number
  readonly bottomHeight: number
  readonly detailsWidth: number
  readonly rightMode: WorkspaceRegionMode
  readonly bottomMode: WorkspaceRegionMode
  readonly coverRegion?: WorkspaceRegion
}

function sidebarWidth(preference: number): number {
  return preference === 0 ? SIDEBAR_COLLAPSED : clampWidth(preference, SIDEBAR_MIN, SIDEBAR_MAX)
}

function clampRatio(value: number): number {
  return Math.min(WORKSPACE_BOTTOM_MAX_RATIO, Math.max(0, value))
}

function covered(
  input: WorkspaceGeometryInput,
  sidebar: number,
  region: WorkspaceRegion,
  mode: 'sheet' | 'maximized',
): WorkspaceGeometry {
  const available = Math.max(0, input.width - sidebar)
  return {
    sidebar,
    conversationWidth: available,
    conversationHeight: Math.max(0, input.height),
    rightWidth: 0,
    bottomHeight: 0,
    detailsWidth: 0,
    rightMode: region === 'right' ? mode : input.workspace.attached ? 'rail' : 'hidden',
    bottomMode: region === 'bottom' ? mode : 'hidden',
    coverRegion: region,
  }
}

/** Preferences remain untouched; every concession here is derived and reversible. */
export function computeWorkspaceGeometry(input: WorkspaceGeometryInput): WorkspaceGeometry {
  const width = Math.max(0, Math.round(input.width))
  const height = Math.max(0, Math.round(input.height))
  const sidebar = sidebarWidth(input.sidebar)
  const available = Math.max(0, width - sidebar)
  const workspace = input.workspace

  if (workspace.attached && workspace.maximizedRegion !== undefined) {
    return covered({ ...input, width, height }, sidebar, workspace.maximizedRegion, 'maximized')
  }

  const rightPreferredOpen = workspace.attached && workspace.rightVisible
  const bottomPreferredOpen = workspace.attached && workspace.bottomVisible
  const rail = workspace.attached ? WORKSPACE_RAIL_WIDTH : 0
  const maxRightByRatio = Math.floor(available * WORKSPACE_RIGHT_MAX_RATIO)
  let rightWidth = rightPreferredOpen
    ? Math.min(WORKSPACE_RIGHT_MAX, Math.max(WORKSPACE_RIGHT_MIN, Math.round(workspace.rightWidth)), maxRightByRatio)
    : rail
  let rightMode: WorkspaceRegionMode = workspace.attached ? (rightPreferredOpen ? 'dock' : 'rail') : 'hidden'
  let detailsWidth = input.details === 0 ? 0 : clampWidth(input.details, DETAILS_MIN, DETAILS_MAX)

  if (rightPreferredOpen && maxRightByRatio < WORKSPACE_RIGHT_MIN) {
    if (workspace.activeRegion === 'right') return covered({ ...input, width, height }, sidebar, 'right', 'sheet')
    rightWidth = rail
    rightMode = 'rail'
  }

  if (detailsWidth > 0 && rightPreferredOpen && rightMode === 'dock' && rightWidth + detailsWidth + CONVERSATION_MIN_WIDTH > available) {
    if (workspace.auxiliaryPriority === 'details') {
      rightWidth = rail
      rightMode = 'rail'
    } else {
      detailsWidth = 0
    }
  }

  if (detailsWidth > 0) {
    const detailsAvailable = available - rightWidth - CONVERSATION_MIN_WIDTH
    if (detailsAvailable >= DETAILS_MIN) detailsWidth = Math.min(detailsWidth, detailsAvailable)
    else detailsWidth = 0
  }

  if (rightMode === 'dock' && rightWidth + CONVERSATION_MIN_WIDTH > available) {
    if (workspace.activeRegion === 'right') return covered({ ...input, width, height }, sidebar, 'right', 'sheet')
    rightWidth = rail
    rightMode = 'rail'
  }

  let conversationWidth = Math.max(0, available - rightWidth - detailsWidth)
  let bottomHeight = 0
  let bottomMode: WorkspaceRegionMode = 'hidden'
  if (bottomPreferredOpen) {
    const desired = Math.max(WORKSPACE_BOTTOM_MIN, Math.round(height * clampRatio(workspace.bottomRatio)))
    bottomHeight = Math.min(desired, Math.floor(height * WORKSPACE_BOTTOM_MAX_RATIO))
    if (height - bottomHeight < CONVERSATION_MIN_HEIGHT) {
      if (workspace.activeRegion === 'bottom') return covered({ ...input, width, height }, sidebar, 'bottom', 'sheet')
      bottomHeight = 0
    } else {
      bottomMode = 'dock'
    }
  }

  conversationWidth = Math.max(0, conversationWidth)
  return {
    sidebar,
    conversationWidth,
    conversationHeight: Math.max(0, height - bottomHeight),
    rightWidth,
    bottomHeight,
    detailsWidth,
    rightMode,
    bottomMode,
  }
}
