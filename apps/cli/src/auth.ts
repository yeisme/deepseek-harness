/**
 * `dsh auth` — local DSH access-token management.
 *
 * Tokens are stored as SHA-256 hashes in the DSH home. The plaintext token is
 * printed exactly once at creation; the store never persists it.
 * @module @deepseek-ai/dsh/auth
 */

import { Command, CommanderError } from 'commander'
import {
  createAuthToken,
  listAuthTokens,
  revokeAuthToken,
  type DshTokenScope,
} from './auth-store.ts'

/** Streams used for command output; tests can substitute them. */
export const internals: { stdout: { write(chunk: string): unknown }; stderr: { write(chunk: string): unknown } } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

function printToken(token: string): void {
  internals.stdout.write(`${token}\n`)
}

function printSummary(summary: { id: string; name: string; scopes: readonly string[]; createdAt: string; expiresAt?: string; revokedAt?: string }): void {
  const parts = [
    `id=${summary.id}`,
    `name=${summary.name}`,
    `scopes=${summary.scopes.join(',')}`,
    `created=${summary.createdAt}`,
    ...summary.expiresAt === undefined ? [] : [`expires=${summary.expiresAt}`],
    ...summary.revokedAt === undefined ? [] : [`revoked=${summary.revokedAt}`],
  ]
  internals.stdout.write(`${parts.join(' ')}\n`)
}

function parseExpires(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const match = /^(\d+)([smhd])$/.exec(value)
  if (match === null) throw new Error(`invalid --expires ${JSON.stringify(value)}; use a duration like 30d or 12h`)
  const amount = Number(match[1])
  const unit = match[2]
  const multiplier = unit === 's' ? 1_000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return new Date(Date.now() + amount * multiplier).toISOString()
}

/**
 * Run one `dsh auth` invocation.
 * @param argv - arguments after `auth`.
 * @returns process exit code.
 */
export async function runAuth(argv: readonly string[]): Promise<number> {
  const program = new Command()
    .name('dsh auth')
    .description('Manage DSH remote access tokens.')
    .helpOption('-h, --help', 'show this help')
    .exitOverride()

  const token = program.command('token')
    .description('Manage access tokens.')
    .helpOption('-h, --help', 'show this help')

  token.command('create')
    .description('Create a token and print its plaintext value once.')
    .option('--name <name>', 'human-readable token name')
    .option('--scope <scope>', 'comma-separated scopes (web,tui,admin)', 'admin')
    .option('--expires <duration>', 'optional lifetime (e.g. 30d, 12h, 30m)')
    .action(async (options: { name?: string; scope: string; expires?: string }) => {
      const scopes = options.scope.split(',').map(scope => scope.trim()).filter(Boolean) as DshTokenScope[]
      for (const scope of scopes) {
        if (scope !== 'web' && scope !== 'tui' && scope !== 'admin') {
          program.error(`error: invalid scope ${JSON.stringify(scope)}; expected web, tui, or admin`)
        }
      }
      let expiresAt: string | undefined
      try {
        expiresAt = parseExpires(options.expires)
      } catch (error) {
        program.error(error instanceof Error ? error.message : String(error))
      }
      const { token, record } = await createAuthToken({
        ...options.name === undefined ? {} : { name: options.name },
        scopes,
        ...expiresAt === undefined ? {} : { expiresAt },
      })
      printToken(token)
      printSummary(record)
    })

  token.command('list')
    .description('List stored token metadata (never hashes).')
    .action(async () => {
      const records = await listAuthTokens()
      if (records.length === 0) internals.stdout.write('no tokens\n')
      for (const record of records) printSummary(record)
    })

  token.command('revoke <id>')
    .description('Revoke a token by id.')
    .action(async (id: string) => {
      const revoked = await revokeAuthToken(id)
      if (!revoked) program.error(`error: token ${JSON.stringify(id)} not found`)
      internals.stdout.write(`revoked ${id}\n`)
    })

  try {
    await program.parseAsync(argv, { from: 'user' })
    return 0
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode
    internals.stderr.write(`dsh auth: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
