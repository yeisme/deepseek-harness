#!/usr/bin/env node

import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshRoot = resolve(packageRoot, '../../..')
const evidenceProjectRoot = resolve(process.env.DSH_BROWSER_EVIDENCE_PROJECT_ROOT ?? dshRoot)
const projectLabel = process.env.DSH_BROWSER_EVIDENCE_PROJECT ?? 'client/deepseek-harness'
const baseUrl = process.env.DSH_BROWSER_URL ?? 'http://127.0.0.1:3802'
const requireFromWeb = createRequire(resolve(dshRoot, 'apps/web/package.json'))
const { chromium } = requireFromWeb('playwright')
const startedAt = new Date()
const runId = `${startedAt.toISOString().replace(/[:.]/gu, '-')}-${process.pid}-pane-browser`
const evidenceRoot = resolve(evidenceProjectRoot, 'temp/integration-test-runs', runId)
const artifactsRoot = resolve(evidenceRoot, 'artifacts')
const checks = []
const errors = []
let browser
let status = 'passed'

await mkdir(artifactsRoot, { recursive: true })

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
    args: ['--no-sandbox'],
  })
  await verifyRightBottomAndReload()
  await verifyDetailsPriority()
  await verifyNarrowSheet()
} catch (error) {
  status = 'failed'
  errors.push(redact(error instanceof Error ? error.stack ?? error.message : String(error)))
} finally {
  await browser?.close()
}

const finishedAt = new Date()
const summary = {
  schema_version: 'yeisme.integration_test_evidence.v1',
  project: projectLabel,
  run_id: runId,
  layer: 'browser-e2e',
  command: 'dsh --profile web --port 3802',
  status,
  exit_code: status === 'passed' ? 0 : 1,
  started_at: startedAt.toISOString(),
  finished_at: finishedAt.toISOString(),
  duration_ms: finishedAt.getTime() - startedAt.getTime(),
  checks,
  failure: errors[0] ?? null,
  redaction: {
    enabled: true,
    policy: 'yeisme.integration-test-redaction.v1',
    aria_scope: 'workspace chrome and geometry only',
  },
  evidence: {
    summary: relative(evidenceProjectRoot, resolve(evidenceRoot, 'summary.json')),
    command: relative(evidenceProjectRoot, resolve(evidenceRoot, 'command.txt')),
    stdout: relative(evidenceProjectRoot, resolve(evidenceRoot, 'stdout.log')),
    stderr: relative(evidenceProjectRoot, resolve(evidenceRoot, 'stderr.log')),
    env: relative(evidenceProjectRoot, resolve(evidenceRoot, 'env.json')),
    artifacts: relative(evidenceProjectRoot, artifactsRoot),
  },
}

await Promise.all([
  writeJson(resolve(evidenceRoot, 'summary.json'), summary),
  writeFile(resolve(evidenceRoot, 'command.txt'), `dsh --profile web --port 3802\nnode packages/client/ui-layout/scripts/run-workspace-browser-evidence.mjs\n`, 'utf8'),
  writeFile(resolve(evidenceRoot, 'stdout.log'), `${JSON.stringify(checks, null, 2)}\n`, 'utf8'),
  writeFile(resolve(evidenceRoot, 'stderr.log'), errors.length === 0 ? '' : `${errors.join('\n')}\n`, 'utf8'),
  writeJson(resolve(evidenceRoot, 'env.json'), {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    url_origin: new URL(baseUrl).origin,
    chromium: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE === undefined ? 'playwright-managed' : 'explicit-local-binary',
  }),
])

process.stdout.write(`Workspace browser evidence: ${summary.evidence.summary}\n`)
if (errors.length > 0) process.stderr.write(`${errors.join('\n')}\n`)
process.exitCode = summary.exit_code

async function pageAt(width, height) {
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  const pageErrors = []
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', error => { pageErrors.push(`pageerror: ${error.message}`) })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await page.locator('.pwr-root').first().waitFor({ timeout: 20_000 })
  return { context, page, pageErrors }
}

async function openPickerView(page, label) {
  const right = page.locator('.pwr-root[data-region="right"]')
  await right.getByRole('button', { name: 'Open workspace view' }).first().click()
  const picker = page.getByRole('dialog', { name: 'Open workspace view' })
  await picker.getByRole('button', { name: new RegExp(label, 'u') }).click()
}

async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect === undefined ? null : {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
        right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      }
    }
    const frame = document.querySelector('[data-right-mode]')
    return {
      sidebar: box('[class*="sidebarCol"]'),
      conversation: box('[class*="centerCol"]'),
      right: box('[data-workspace-region="right"]'),
      bottom: box('[data-workspace-region="bottom"]'),
      details: box('[class*="detailsCol"]'),
      rightMode: frame?.getAttribute('data-right-mode') ?? null,
      bottomMode: frame?.getAttribute('data-bottom-mode') ?? null,
      cover: frame?.getAttribute('data-workspace-cover') ?? null,
    }
  })
}

async function workspaceAria(page) {
  return page.locator('.pwr-root').evaluateAll(roots => roots.map(root => ({
    region: root.getAttribute('data-region'),
    mode: root.getAttribute('data-mode'),
    label: root.getAttribute('aria-label'),
    controls: [...root.querySelectorAll('button,[role="tab"]')].map(control => ({
      role: control.getAttribute('role') ?? control.tagName.toLowerCase(),
      label: control.getAttribute('aria-label') ?? control.getAttribute('title') ?? control.textContent?.trim().slice(0, 80) ?? '',
      selected: control.getAttribute('aria-selected'),
      expanded: control.getAttribute('aria-expanded'),
    })),
  })))
}

async function verifyRightBottomAndReload() {
  const { context, page, pageErrors } = await pageAt(1440, 900)
  try {
    await openPickerView(page, '文件')
    await page.waitForFunction(() => document.querySelector('[data-right-mode]')?.getAttribute('data-right-mode') === 'dock')
    await openPickerView(page, '终端')
    await page.waitForFunction(() => document.querySelector('[data-bottom-mode]')?.getAttribute('data-bottom-mode') === 'dock')
    await page.waitForTimeout(350)
    const bottom = page.locator('.pwr-root[data-region="bottom"]')
    await bottom.getByRole('tab', { name: '终端' }).press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Move to Right' }).click()
    await page.locator('.pwr-root[data-region="right"]').getByRole('tab', { name: '终端' }).waitFor()
    const crossRegion = await geometry(page)
    assertBoundary(crossRegion, 'cross-region move')
    await page.screenshot({ path: resolve(artifactsRoot, 'terminal-moved-right.png'), fullPage: true })
    await page.locator('.pwr-root[data-region="right"]').getByRole('tab', { name: '终端' }).press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Move to Bottom' }).click()
    await bottom.getByRole('tab', { name: '终端' }).waitFor()
    await page.waitForFunction(() => document.querySelector('[data-bottom-mode]')?.getAttribute('data-bottom-mode') === 'dock')
    await openPickerView(page, '文档')
    await page.waitForFunction(() => {
      const groups = [...document.querySelectorAll('.pwr-root[data-region="right"] .pwr-group')]
        .map(group => group.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0)
      return groups.length >= 2 && groups.every(rect => rect.width >= 280 && rect.height >= 180)
    })
    await page.waitForTimeout(350)
    const paneMinimums = await page.locator('.pwr-root[data-region="right"] .pwr-group').evaluateAll(groups => groups
      .map(group => group.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .map(rect => ({ width: Math.round(rect.width), height: Math.round(rect.height) })))
    const docked = await geometry(page)
    assertBoundary(docked, 'right/bottom dock')
    assert(docked.right?.width === 480, `Right dock width was ${docked.right?.width ?? 'missing'}, expected 480`)
    assert(docked.bottom?.height === 306, `Bottom dock height was ${docked.bottom?.height ?? 'missing'}, expected 306`)
    await page.screenshot({ path: resolve(artifactsRoot, 'right-bottom-docked.png'), fullPage: true })
    await writeJson(resolve(artifactsRoot, 'right-bottom-aria.json'), await workspaceAria(page))

    const right = page.locator('.pwr-root[data-region="right"]')
    await right.getByRole('button', { name: /Open 文件/u }).click()
    const fileGroup = right.locator('.pwr-group:has([role="tab"][title="文件"])')
    await fileGroup.getByRole('button', { name: 'Maximize pane' }).click()
    await page.waitForFunction(() => document.querySelector('[data-right-mode]')?.getAttribute('data-right-mode') === 'maximized')
    await page.waitForTimeout(250)
    const maximized = await geometry(page)
    assertBoundary(maximized, 'maximized')
    assert(maximized.cover === 'right', 'Maximized Right workspace did not become the main-region cover')
    await page.screenshot({ path: resolve(artifactsRoot, 'right-maximized.png'), fullPage: true })

    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelector('[data-right-mode]')?.getAttribute('data-right-mode') === 'dock')
    await fileGroup.getByRole('button', { name: 'Maximize pane' }).click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.pwr-root').first().waitFor()
    await page.waitForFunction(() => document.querySelector('[data-right-mode]')?.getAttribute('data-right-mode') === 'dock')
    await page.waitForFunction(() => document.querySelector('[data-bottom-mode]')?.getAttribute('data-bottom-mode') === 'dock')
    await page.waitForFunction(() => {
      const tabs = [...document.querySelectorAll('.pwr-tab')].map(tab => tab.textContent?.trim())
      return tabs.includes('文件') && tabs.includes('文档') && tabs.includes('终端')
    })
    await page.waitForFunction(() => (document.querySelector('[data-workspace-region="bottom"]')?.getBoundingClientRect().height ?? 0) >= 305)
    await page.waitForTimeout(250)
    const restored = await geometry(page)
    assert(restored.cover === null, 'Reload restored the temporary maximized state')
    assert((await page.locator('.pwr-tab', { hasText: '文件' }).count()) === 1, 'Reload did not restore the File tab')
    assert((await page.locator('.pwr-tab', { hasText: '文档' }).count()) === 1, 'Reload did not restore the Document tab')
    assert((await page.locator('.pwr-tab', { hasText: '终端' }).count()) === 1, 'Reload did not restore the Terminal tab')
    await page.screenshot({ path: resolve(artifactsRoot, 'reload-restored.png'), fullPage: true })
    assertNoPageErrors(pageErrors, 'right/bottom/reload')
    checks.push({ scenario: 'right-bottom-cross-region-maximize-reload', crossRegion, paneMinimums, docked, maximized, restored, console_errors: 0 })
  } finally {
    await context.close()
  }
}

async function verifyDetailsPriority() {
  const { context, page, pageErrors } = await pageAt(1440, 900)
  try {
    await page.locator('button[aria-label^="Session actions for "]').first().waitFor({ state: 'attached', timeout: 20_000 })
    const showMore = page.getByRole('button', { name: /Show \d+ more sessions/u })
    if (await showMore.count() > 0) {
      await showMore.click()
      await page.waitForTimeout(250)
    }
    const sessions = page.locator('[role="treeitem"]:has(button[aria-label^="Session actions for "])')
    let foundToolSession = false
    const sessionCount = Math.min(await sessions.count(), 16)
    for (let index = 0; index < sessionCount; index += 1) {
      await sessions.nth(index).click()
      await page.waitForTimeout(700)
      if (await page.locator('[data-chat-call-id] [role="button"]').count() > 0) {
        foundToolSession = true
        break
      }
    }
    assert(foundToolSession, 'No loaded session exposed a Tool row for Details verification')
    await page.getByRole('button', { name: '工作区' }).click()
    await page.waitForFunction(() => document.querySelector('[data-right-mode]')?.getAttribute('data-right-mode') === 'dock')
    await page.locator('[data-chat-call-id] [role="button"]').last().click()
    await page.waitForFunction(() => (document.querySelector('[class*="detailsCol"]')?.getBoundingClientRect().width ?? 0) >= 300)
    await page.waitForTimeout(250)
    const detailsPriority = await geometry(page)
    assertBoundary(detailsPriority, 'Details priority')
    assert(detailsPriority.rightMode === 'rail', 'Details did not derive the conflicting Right workspace to its rail')
    await page.screenshot({ path: resolve(artifactsRoot, 'details-priority.png'), fullPage: true })

    await page.locator('.pwr-root[data-region="right"]').getByRole('button', { name: /Open 文件/u }).click()
    await page.waitForFunction(() => document.querySelector('[data-right-mode]')?.getAttribute('data-right-mode') === 'dock')
    await page.waitForFunction(() => (document.querySelector('[class*="detailsCol"]')?.getBoundingClientRect().width ?? 0) <= 1)
    const workspacePriority = await geometry(page)
    assert((workspacePriority.details?.width ?? 0) <= 1, 'Explicit workspace activation did not derive Details closed')

    await page.locator('.pwr-root[data-region="right"]').getByRole('button', { name: 'Hide right workspace' }).click()
    await page.waitForFunction(() => {
      const detailsWidth = document.querySelector('[class*="detailsCol"]')?.getBoundingClientRect().width ?? 0
      const railWidth = document.querySelector('[data-workspace-region="right"]')?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY
      return detailsWidth >= 359 && railWidth <= 45
    })
    await page.waitForTimeout(250)
    const detailsRestored = await geometry(page)
    assert(detailsRestored.rightMode === 'rail', 'Hiding Right workspace did not retain the activity rail')
    assertNoPageErrors(pageErrors, 'Details priority')
    await writeJson(resolve(artifactsRoot, 'details-aria.json'), {
      workspace: await workspaceAria(page),
      details_heading: await page.locator('[class*="detailsCol"] [class*="title"]').first().textContent(),
      raw_tool_payload_persisted: false,
    })
    checks.push({ scenario: 'details-priority-and-restoration', detailsPriority, workspacePriority, detailsRestored, console_errors: 0 })
  } finally {
    await context.close()
  }
}

async function verifyNarrowSheet() {
  const { context, page, pageErrors } = await pageAt(390, 844)
  try {
    await openPickerView(page, '文件')
    await page.waitForFunction(() => document.querySelector('[data-right-mode]')?.getAttribute('data-right-mode') === 'sheet')
    await page.waitForTimeout(250)
    const sheet = await geometry(page)
    assertBoundary(sheet, '390px Sheet')
    assert(sheet.sidebar?.width === 56, `Narrow sidebar rail was ${sheet.sidebar?.width ?? 'missing'}, expected 56`)
    assert(sheet.right?.x === 56, `Narrow Sheet started at ${sheet.right?.x ?? 'missing'}, expected the 56px sidebar edge`)
    await page.screenshot({ path: resolve(artifactsRoot, 'narrow-390-sheet.png'), fullPage: true })
    await writeJson(resolve(artifactsRoot, 'narrow-aria.json'), await workspaceAria(page))
    assertNoPageErrors(pageErrors, '390px Sheet')
    checks.push({ scenario: 'narrow-sheet', sheet, console_errors: 0 })
  } finally {
    await context.close()
  }
}

function assertBoundary(value, scenario) {
  assert(value.sidebar !== null && value.right !== null, `${scenario}: sidebar or workspace geometry missing`)
  assert(value.right.x >= value.sidebar.right, `${scenario}: workspace crossed the actual sidebar boundary`)
}

function assertNoPageErrors(pageErrors, scenario) {
  if (pageErrors.length > 0) throw new Error(`${scenario}: ${pageErrors.map(redact).join(' | ')}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function redact(value) {
  return String(value)
    .replaceAll(dshRoot, '<dsh-root>')
    .replaceAll(evidenceProjectRoot, '<project-root>')
    .replace(/(api[-_]?key|authorization|password|secret|token)\s*[:=]\s*[^,\s]+/giu, '$1=<redacted>')
    .replace(/https?:\/\/[^\s)]+/giu, '<url>')
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
