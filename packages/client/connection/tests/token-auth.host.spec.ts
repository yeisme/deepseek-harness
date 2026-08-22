/** Built-in token gate behavior without any provider dependency. */

import { describe, expect, it } from 'vitest'
import {
  DshTokenGate,
  type DshTokenAuthRequest,
} from '../src/token-auth.ts'

function request(headers: Record<string, string | undefined>): DshTokenAuthRequest {
  return { headers }
}

const CONFIG = {
  tokens: [
    { token: 'admin-token', scopes: ['admin' as const] },
    { token: 'tui-token', scopes: ['tui' as const] },
    { token: 'web-token', scopes: ['web' as const] },
  ],
}

describe('DshTokenGate', () => {
  it('accepts a bearer token', () => {
    const gate = new DshTokenGate(CONFIG)
    expect(gate.authorizeHttp(request({ authorization: 'Bearer admin-token' }))).toBe(true)
    expect(gate.authorizeAdmin(request({ authorization: 'Bearer admin-token' }))).toBe(true)
  })

  it('accepts the custom header and cookies', () => {
    const gate = new DshTokenGate(CONFIG)
    expect(gate.authorizeHttp(request({ 'x-dsh-access-token': 'tui-token' }))).toBe(true)
    expect(gate.authorizeHttp(request({ cookie: '__Host-dsh-access-token=web-token' }))).toBe(true)
    expect(gate.authorizeHttp(request({ cookie: 'dsh-access-token=web-token' }))).toBe(true)
    expect(gate.authenticateToken('admin-token')).toMatchObject({ scopes: new Set(['admin']) })
    expect(gate.authenticateToken('wrong')).toBeUndefined()
  })

  it('rejects missing, wrong, and malformed tokens', () => {
    const gate = new DshTokenGate(CONFIG)
    expect(gate.authorizeHttp(request({}))).toBe(false)
    expect(gate.authorizeHttp(request({ authorization: 'Bearer wrong' }))).toBe(false)
    expect(gate.authorizeHttp(request({ authorization: 'Basic abc' }))).toBe(false)
    expect(gate.authorizeWebSocket(request({ cookie: '__Host-dsh-access-token=wrong' }))).toBe(false)
  })

  it('grants admin only to admin-scoped tokens', () => {
    const gate = new DshTokenGate(CONFIG)
    expect(gate.authorizeAdmin(request({ authorization: 'Bearer admin-token' }))).toBe(true)
    expect(gate.authorizeAdmin(request({ authorization: 'Bearer tui-token' }))).toBe(false)
    expect(gate.authorizeAdmin(request({ authorization: 'Bearer web-token' }))).toBe(false)
  })

  it('defaults unspecified scopes to admin', () => {
    const gate = new DshTokenGate({ tokens: [{ token: 'default-token' }] })
    expect(gate.authorizeAdmin(request({ authorization: 'Bearer default-token' }))).toBe(true)
  })

  it('rejects empty token configuration at construction', () => {
    expect(() => new DshTokenGate({ tokens: [] })).toThrow(/at least one token/)
    expect(() => new DshTokenGate({ tokens: [{ token: '' }] })).toThrow(/non-empty/)
  })
})
