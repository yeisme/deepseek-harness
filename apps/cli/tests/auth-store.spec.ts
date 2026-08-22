/** User-level token store behavior. */

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authStorePath,
  createAuthToken,
  listAuthTokens,
  revokeAuthToken,
  verifyAuthToken,
} from '../src/auth-store.ts'

const dirs: string[] = []

function envFor(dir: string): Record<string, string> {
  return { DSH_HOME: dir }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      // Keep the temporary directory; Node cleans OS temp on reboot.
      void dir
    } catch {
      // ignore cleanup failures in tests
    }
  }
})

describe('auth store', () => {
  it('creates tokens with hashed persistence and verifies plaintext', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-auth-store-'))
    dirs.push(dir)
    const env = envFor(dir)
    const { token, record } = await createAuthToken({ name: 'admin', scopes: ['admin'], env })
    expect(token.startsWith('dsh_')).toBe(true)
    expect(record.name).toBe('admin')
    const stored = JSON.parse(readFileSync(authStorePath(env), 'utf8')) as { tokens: { tokenHash: string }[] }
    expect(stored.tokens[0]?.tokenHash).not.toContain(token)
    expect(await verifyAuthToken(token, env)).toMatchObject({ id: record.id, name: 'admin' })
    expect(await verifyAuthToken('wrong', env)).toBeUndefined()
  })

  it('lists metadata without hashes and revokes tokens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-auth-store-'))
    dirs.push(dir)
    const env = envFor(dir)
    const { token, record } = await createAuthToken({ name: 'one', env })
    expect(await listAuthTokens(env)).toEqual([record])
    expect(await revokeAuthToken(record.id, env)).toBe(true)
    expect(await revokeAuthToken('missing', env)).toBe(false)
    expect(await verifyAuthToken(token, env)).toBeUndefined()
    const listed = await listAuthTokens(env)
    expect(listed[0]?.revokedAt).toBeDefined()
  })
})
