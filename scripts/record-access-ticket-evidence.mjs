import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { arch, platform, release, version } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runId = `${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}-dsh-access-ticket`
const evidenceRoot = join(repoRoot, 'temp', 'integration-test-runs', runId)
const artifactsRoot = join(evidenceRoot, 'artifacts')

const commands = [
  'CI=1 pnpm exec vitest run packages/client/connection/tests/access-ticket*.spec.ts',
  'CI=1 pnpm run typecheck',
  'CI=1 pnpm exec vitest run packages/client packages/host --testTimeout=30000',
]

function redact(value) {
  return value
    .replace(/((?:authorization|cookie|x-dsh-access-ticket|access[-_]?ticket|api[-_]?key|secret|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^\s]+)(?:[?&](?:token|sig|signature|key)=[^\s&]+)/gi, '$1[REDACTED]')
}

function run(command) {
  return new Promise((resolveResult) => {
    const startedAt = Date.now()
    const child = spawn(command, {
      cwd: repoRoot,
      env: { ...process.env, CI: '1' },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('close', (code, signal) => {
      resolveResult({
        command,
        exitCode: code ?? 1,
        signal: signal ?? null,
        durationMs: Date.now() - startedAt,
        status: code === 0 ? 'passed' : 'failed',
        stdout: redact(stdout),
        stderr: redact(stderr),
      })
    })
    child.on('error', error => {
      resolveResult({
        command,
        exitCode: 1,
        signal: null,
        durationMs: Date.now() - startedAt,
        status: 'failed',
        stdout: redact(stdout),
        stderr: redact(`${stderr}\n${error.message}`),
      })
    })
  })
}

await mkdir(artifactsRoot, { recursive: true })
const results = []
let stdoutLog = ''
let stderrLog = ''
for (const command of commands) {
  const result = await run(command)
  results.push({
    command: result.command,
    exit_code: result.exitCode,
    signal: result.signal,
    duration_ms: result.durationMs,
    status: result.status,
  })
  stdoutLog += `\n$ ${command}\n${result.stdout}\n`
  stderrLog += `\n$ ${command}\n${result.stderr}\n`
}

const passed = results.every(result => result.status === 'passed')
const summary = {
  schema_version: 'dsh.local.integration-evidence.v1',
  run_id: runId,
  status: passed ? 'passed' : 'failed',
  evidence_level: 'focused/local',
  owner: 'client/deepseek-harness',
  change: 'dsh-enterprise-access-ticket-transport-v1',
  provider_calls: false,
  external_egress: false,
  commands: results,
  notes: [
    'The GUI suite uses an explicit 30 second per-test timeout to avoid the known default 5 second ui-trajectory timeout under the shared dirty checkout.',
    'This evidence does not establish OAuth provider, OCI/Kubernetes sandbox, cloud Agent, deployment, or production acceptance.',
  ],
}
const safeEnv = {
  evidence_level: 'focused/local',
  ci: '1',
  cwd: repoRoot,
  node: process.version,
  platform: platform(),
  arch: arch(),
  os_release: release(),
  runtime: version(),
}

await writeFile(join(evidenceRoot, 'command.txt'), `${commands.map(command => `$ ${command}`).join('\n')}\n`, 'utf8')
await writeFile(join(evidenceRoot, 'stdout.log'), redact(stdoutLog), 'utf8')
await writeFile(join(evidenceRoot, 'stderr.log'), redact(stderrLog), 'utf8')
await writeFile(join(evidenceRoot, 'env.json'), `${JSON.stringify(safeEnv, null, 2)}\n`, 'utf8')
await writeFile(join(evidenceRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ run_id: runId, status: summary.status, evidence_root: evidenceRoot }))
if (!passed) process.exitCode = 1
