/**
 * User-level DSH access-token store.
 *
 * The store keeps only SHA-256 token hashes. Plaintext tokens are printed once
 * at creation and never persisted or logged.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Scopes a DSH access token can carry; kept local to the CLI auth store. */
export type DshTokenScope = 'web' | 'tui' | 'admin'

/** One stored token record; never contains the plaintext token. */
export interface StoredDshToken {
  readonly id: string
  readonly name: string
  readonly tokenHash: string
  readonly scopes: readonly DshTokenScope[]
  readonly createdAt: string
  readonly expiresAt?: string
  readonly revokedAt?: string
}

/** Public token metadata returned by list operations. */
export type DshTokenSummary = Omit<StoredDshToken, 'tokenHash'>

interface AuthStoreFile {
  readonly version: 1
  readonly tokens: StoredDshToken[]
}

const STORE_VERSION = 1 as const
const TOKEN_PREFIX = 'dsh_'
const AUTH_FILE_NAME = 'auth.json'

/** Resolve the auth store path from the DSH home environment. */
export function authStorePath(env: Record<string, string | undefined> = process.env): string {
  const home = env.DSH_HOME !== undefined && env.DSH_HOME.trim() !== ''
    ? resolve(env.DSH_HOME)
    : join(homedir(), '.dsh')
  return join(home, AUTH_FILE_NAME)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function readStore(path: string): Promise<AuthStoreFile> {
  try {
    const content = await readFile(path, 'utf8')
    const parsed = JSON.parse(content) as Partial<AuthStoreFile>
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.tokens)) {
      throw new Error(`dsh auth: unsupported token store at ${path}`)
    }
    return { version: STORE_VERSION, tokens: parsed.tokens }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return { version: STORE_VERSION, tokens: [] }
    }
    throw error
  }
}

async function writeStore(path: string, store: AuthStoreFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}

function toSummary(record: StoredDshToken): DshTokenSummary {
  const { tokenHash: _tokenHash, ...summary } = record
  return summary
}

/** Create a new token, persist its hash, and return the plaintext once. */
export async function createAuthToken(options: {
  name?: string
  scopes?: readonly DshTokenScope[]
  expiresAt?: string
  env?: Record<string, string | undefined>
}): Promise<{ token: string; record: DshTokenSummary }> {
  const path = authStorePath(options.env)
  const store = await readStore(path)
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  const scopes = options.scopes === undefined || options.scopes.length === 0
    ? ['admin' as const]
    : options.scopes
  const record: StoredDshToken = {
    id: randomUUID(),
    name: options.name ?? 'default',
    tokenHash: hashToken(token),
    scopes,
    createdAt: new Date().toISOString(),
    ...options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt },
  }
  store.tokens.push(record)
  await writeStore(path, store)
  return { token, record: toSummary(record) }
}

/** List stored token metadata without hashes. */
export async function listAuthTokens(env?: Record<string, string | undefined>): Promise<DshTokenSummary[]> {
  const store = await readStore(authStorePath(env))
  return store.tokens.map(toSummary)
}

/** Revoke a token by id. Returns false when the id is unknown. */
export async function revokeAuthToken(id: string, env?: Record<string, string | undefined>): Promise<boolean> {
  const path = authStorePath(env)
  const store = await readStore(path)
  const index = store.tokens.findIndex(token => token.id === id)
  if (index === -1) return false
  const record = store.tokens[index]
  if (record === undefined) return false
  store.tokens[index] = { ...record, revokedAt: new Date().toISOString() }
  await writeStore(path, store)
  return true
}

/** Verify a plaintext token against the store. */
export async function verifyAuthToken(
  token: string,
  env?: Record<string, string | undefined>,
): Promise<DshTokenSummary | undefined> {
  const store = await readStore(authStorePath(env))
  const hash = hashToken(token)
  const now = Date.now()
  const record = store.tokens.find(candidate =>
    candidate.tokenHash === hash
    && candidate.revokedAt === undefined
    && (candidate.expiresAt === undefined || Date.parse(candidate.expiresAt) > now))
  return record === undefined ? undefined : toSummary(record)
}
