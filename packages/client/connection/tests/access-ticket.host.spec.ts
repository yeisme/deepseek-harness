/** Enterprise access-ticket gate behavior without any OAuth/provider dependency. */

import { describe, expect, it, vi } from 'vitest'
import {
  AccessTicketGate,
  type AccessTicketBinding,
  type AccessTicketVerifier,
  type AccessTicketVerificationResult,
} from '../src/access-ticket.ts'

const now = Date.now()

function binding(overrides: Partial<AccessTicketBinding> = {}): AccessTicketBinding {
  return {
    sid: 'sid-1' as AccessTicketBinding['sid'],
    principal: 'principal-1' as AccessTicketBinding['principal'],
    tenant: 'tenant-1' as AccessTicketBinding['tenant'],
    workspace: 'workspace-1' as AccessTicketBinding['workspace'],
    runtimeRef: 'runtime-1' as AccessTicketBinding['runtimeRef'],
    runtimeGeneration: 'runtime-generation-1' as AccessTicketBinding['runtimeGeneration'],
    connectionGeneration: 'connection-generation-1' as AccessTicketBinding['connectionGeneration'],
    audience: 'dsh-web-canary',
    origin: 'https://harness.example',
    expiresAt: now + 60_000,
    jti: 'jti-1' as AccessTicketBinding['jti'],
    ...overrides,
  }
}

function request(overrides: Record<string, string | undefined> = {}) {
  return {
    headers: {
      host: 'harness.example',
      origin: 'https://harness.example',
      'x-dsh-access-ticket': 'opaque-ticket',
      ...overrides,
    },
    url: '/api/session.list',
    method: 'POST',
    signal: undefined,
  }
}

function gate(result: AccessTicketBinding | undefined = binding()): AccessTicketGate {
  const verifier: AccessTicketVerifier = {
    verify: vi.fn(async (): Promise<AccessTicketVerificationResult> =>
      result === undefined ? { ok: false } : { ok: true, binding: result }),
  }
  return new AccessTicketGate({ audience: 'dsh-web-canary', verifier })
}

describe('AccessTicketGate', () => {
  it('passes only an opaque verifier result that exactly binds HTTP to the configured audience and origin', async () => {
    const verify = vi.fn(async (): Promise<AccessTicketVerificationResult> => ({ ok: true, binding: binding() }))
    const access = new AccessTicketGate({ audience: 'dsh-web-canary', verifier: { verify } })
    await expect(access.authorizeHttp(request())).resolves.toBe(true)
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      ticket: 'opaque-ticket', transportProfile: 'dsh_web_v1', carrier: 'http', path: '/api/session.list',
      method: 'POST', host: 'harness.example', origin: 'https://harness.example',
    }))

    for (const candidate of [
      binding({ audience: 'other-audience' }),
      binding({ origin: 'https://other.example' }),
      binding({ expiresAt: now - 1 }),
      binding({ jti: '' as AccessTicketBinding['jti'] }),
    ]) {
      await expect(gate(candidate).authorizeHttp(request())).resolves.toBe(false)
    }
    await expect(gate().authorizeHttp(request({ origin: undefined }))).resolves.toBe(false)
    await expect(gate().authorizeHttp(request({ 'x-dsh-access-ticket': undefined }))).resolves.toBe(false)
  })

  it('accepts the opaque ticket from the configured host-only cookie when its header is absent', async () => {
    const verify = vi.fn(async (): Promise<AccessTicketVerificationResult> => ({ ok: true, binding: binding() }))
    const access = new AccessTicketGate({ audience: 'dsh-web-canary', verifier: { verify } })
    await expect(access.authorizeHttp(request({
      'x-dsh-access-ticket': undefined,
      cookie: '__Host-dsh-access-ticket=opaque-cookie; theme=dark',
    }))).resolves.toBe(true)
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ ticket: 'opaque-cookie' }))
  })

  it('pairs mux and host under one exact generation, and tears both down on a replay or sibling loss', async () => {
    let current = binding()
    const verifier: AccessTicketVerifier = { verify: async () => ({ ok: true, binding: current }) }
    const access = new AccessTicketGate({ audience: 'dsh-web-canary', verifier })
    const closed = { mux: 0, host: 0 }
    const releaseMux = await access.authorizeWebSocket(request(), 'mux', () => { closed.mux += 1 })
    const releaseHost = await access.authorizeWebSocket(request(), 'host', () => { closed.host += 1 })
    expect(releaseMux).toBeTypeOf('function')
    expect(releaseHost).toBeTypeOf('function')

    // A second mux path for the same generation is a replay. It invalidates
    // both existing downlinks before the new handshake may proceed.
    await expect(access.authorizeWebSocket(request(), 'mux', () => {})).resolves.toBeUndefined()
    expect(closed).toEqual({ mux: 1, host: 1 })
    releaseMux?.()
    releaseHost?.()

    const nextRequest = request({ 'x-dsh-access-ticket': 'opaque-ticket-2' })
    current = binding({ jti: 'jti-2' as AccessTicketBinding['jti'] })
    const nextMux = await access.authorizeWebSocket(nextRequest, 'mux', () => { closed.mux += 1 })
    const nextHost = await access.authorizeWebSocket(nextRequest, 'host', () => { closed.host += 1 })
    nextMux?.()
    expect(closed).toEqual({ mux: 2, host: 2 })
    nextHost?.()
  })

  it('rejects a mixed claim set sharing a jti and closes the established generation', async () => {
    let current = binding()
    const verifier: AccessTicketVerifier = { verify: vi.fn(async () => ({ ok: true, binding: current })) }
    const access = new AccessTicketGate({ audience: 'dsh-web-canary', verifier })
    let muxClosed = 0
    const releaseMux = await access.authorizeWebSocket(request(), 'mux', () => { muxClosed += 1 })
    current = binding({ tenant: 'tenant-2' as AccessTicketBinding['tenant'] })
    await expect(access.authorizeWebSocket(request(), 'host', () => {})).resolves.toBeUndefined()
    expect(muxClosed).toBe(1)
    releaseMux?.()
  })

  it('refuses different connection generations for one sid even when their jtis differ', async () => {
    let current = binding({ jti: 'jti-mux' as AccessTicketBinding['jti'] })
    const verifier: AccessTicketVerifier = { verify: vi.fn(async () => ({ ok: true, binding: current })) }
    const access = new AccessTicketGate({ audience: 'dsh-web-canary', verifier })
    let muxClosed = 0
    const releaseMux = await access.authorizeWebSocket(request(), 'mux', () => { muxClosed += 1 })
    current = binding({
      jti: 'jti-host' as AccessTicketBinding['jti'],
      connectionGeneration: 'connection-generation-2' as AccessTicketBinding['connectionGeneration'],
    })
    await expect(access.authorizeWebSocket(request(), 'host', () => {})).resolves.toBeUndefined()
    expect(muxClosed).toBe(1)
    releaseMux?.()
  })

  it('does not admit a consumed jti into a later connection generation', async () => {
    let current = binding()
    const verifier: AccessTicketVerifier = { verify: vi.fn(async () => ({ ok: true, binding: current })) }
    const access = new AccessTicketGate({ audience: 'dsh-web-canary', verifier })
    const release = await access.authorizeWebSocket(request(), 'mux', () => {})
    release?.()
    current = binding({
      connectionGeneration: 'connection-generation-2' as AccessTicketBinding['connectionGeneration'],
    })
    await expect(access.authorizeWebSocket(request(), 'mux', () => {})).resolves.toBeUndefined()
  })

  it('hard-expires a paired generation without a later request and rejects its consumed ticket', async () => {
    vi.useFakeTimers()
    try {
      let current = binding({ expiresAt: Date.now() + 1_000 })
      const verifier: AccessTicketVerifier = { verify: vi.fn(async () => ({ ok: true, binding: current })) }
      const access = new AccessTicketGate({ audience: 'dsh-web-canary', verifier })
      const closed = { mux: 0, host: 0 }
      const mux = await access.authorizeWebSocket(request(), 'mux', () => { closed.mux += 1 })
      const host = await access.authorizeWebSocket(request(), 'host', () => { closed.host += 1 })
      expect(mux).toBeTypeOf('function')
      expect(host).toBeTypeOf('function')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(closed).toEqual({ mux: 1, host: 1 })
      current = binding({
        expiresAt: Date.now() + 1_000,
        connectionGeneration: 'connection-generation-2' as AccessTicketBinding['connectionGeneration'],
      })
      await expect(access.authorizeWebSocket(request(), 'mux', () => {})).resolves.toBeUndefined()
      mux?.()
      host?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears scheduled hard expiry when the gate closes', async () => {
    vi.useFakeTimers()
    try {
      const access = gate(binding({ expiresAt: Date.now() + 1_000 }))
      let closed = 0
      await access.authorizeWebSocket(request(), 'mux', () => { closed += 1 })
      access.close()
      expect(closed).toBe(1)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(closed).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
