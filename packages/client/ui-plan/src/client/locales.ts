/** `plan` namespace dictionaries (the composer plan chip's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.on.aria': 'plan mode 已开启，按下关闭',
  'chip.on.title': 'plan mode 已开启 — 点击关闭（/plan off）',
  'chip.off.aria': 'plan mode 已关闭，按下开启',
  'chip.off.title': 'plan mode 已关闭 — 点击开启（/plan）',
  'document.title': '计划文档',
  'document.expand': '展开计划文档',
  'document.collapse': '收起计划文档',
  'status.proposed': '待审',
  'status.approved': '已批准',
  'status.executing': '执行中',
  'status.completed': '已完成',
  'status.superseded': '已取代',
  'status.rejected': '已拒绝',
  'history.title': '修订记录',
} satisfies Record<string, string>

/** The plan namespace key union. */
export type PlanKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.on.aria': 'Plan mode on, press to turn off',
  'chip.on.title': 'Plan mode on — click to turn off (/plan off)',
  'chip.off.aria': 'Plan mode off, press to turn on',
  'chip.off.title': 'Plan mode off — click to turn on (/plan)',
  'document.title': 'Plan document',
  'document.expand': 'Expand plan document',
  'document.collapse': 'Collapse plan document',
  'status.proposed': 'Proposed',
  'status.approved': 'Approved',
  'status.executing': 'Executing',
  'status.completed': 'Completed',
  'status.superseded': 'Superseded',
  'status.rejected': 'Rejected',
  'history.title': 'Revision history',
} satisfies Record<PlanKey, string>
