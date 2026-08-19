/** Real Host composition test for enterprise-ticket WebSocket pairing. */

import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { WebRoute, WebServer, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  apply, inject,
  type AccessTicketBinding, type AccessTicketVerifier,
} from '../src/index.ts'

const running: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map(close => close()))
})

function accessTicketBinding(origin: string, overrides: Partial<AccessTicketBinding> = {}): AccessTicketBinding {
  return {
    sid: 'sid-1' as AccessTicketBinding['sid'],
    principal: 'principal-1' as AccessTicketBinding['principal'],
    tenant: 'tenant-1' as AccessTicketBinding['tenant'],
    workspace: 'workspace-1' as AccessTicketBinding['workspace'],
    runtimeRef: 'runtime-1' as AccessTicketBinding['runtimeRef'],
    runtimeGeneration: 'runtime-generation-1' as AccessTicketBinding['runtimeGeneration'],
    connectionGeneration: 'connection-generation-1' as AccessTicketBinding['connectionGeneration'],
    audience: 'dsh-web-canary',
    origin,
    expiresAt: Date.now() + 60_000,
    jti: 'jti-1' as AccessTicketBinding['jti'],
    ...overrides,
  }
}

function fakeHttpServer(
  routes: WebRoute[],
  upgrades: WebUpgradeRoute[],
): Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port'> {
  return {
    register(route) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
}

async function * waitForAbort(signal: AbortSignal): AsyncGenerator<never> {
  if (!signal.aborted) {
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
  }
}

describe('enterprise ticket WebSocket pairing', () => {
  it('closes an accepted mux generation and refuses a real host upgrade with a different generation', async () => {
    const routes: WebRoute[] = []
    const upgrades: WebUpgradeRoute[] = []
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer(routes, upgrades) as WebServer)
    ctx.provide('apiProxy', {
      events: {
        mux: (_request: unknown, signal: AbortSignal) => waitForAbort(signal),
        host: (_request: unknown, signal: AbortSignal) => waitForAbort(signal),
      },
    } as unknown as ApiProxy)

    let current!: AccessTicketBinding
    const verifier: AccessTicketVerifier = { verify: async () => ({ ok: true, binding: current }) }
    const fiber = ctx.plugin({ inject: [...inject], apply }, {
      accessTicket: { audience: 'dsh-web-canary', verifier },
    })
    await fiber.await()

    const server = createServer()
    server.on('upgrade', (request, socket, head) => {
      const handler = upgrades.find(route => route.path === new URL(request.url ?? '/', 'http://dsh.internal').pathname)?.handler
      if (handler === undefined) socket.destroy()
      else void handler(request, socket, head)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${String(port)}`
    current = accessTicketBinding(origin)
    const mux = new WebSocket(`ws://127.0.0.1:${String(port)}/api/events.mux`, {
      origin,
      headers: { 'x-dsh-access-ticket': 'ticket-mux' },
    })
    await once(mux, 'open')

    current = accessTicketBinding(origin, {
      connectionGeneration: 'connection-generation-2' as AccessTicketBinding['connectionGeneration'],
      jti: 'jti-2' as AccessTicketBinding['jti'],
    })
    const host = new WebSocket(`ws://127.0.0.1:${String(port)}/api/events.host`, {
      origin,
      headers: { 'x-dsh-access-ticket': 'ticket-host' },
    })
    const status = await new Promise<number>((resolve, reject) => {
      host.once('unexpected-response', (_request, response) => { resolve(response.statusCode ?? 0) })
      host.once('error', reject)
    })
    expect(status).toBe(403)
    await once(mux, 'close')

    running.push(async () => {
      await fiber.dispose()
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) { resolve() } else { reject(error) }
      }))
    })
  })

  it('closes both real downlinks at ticket expiry without another carrier request', async () => {
    const routes: WebRoute[] = []
    const upgrades: WebUpgradeRoute[] = []
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer(routes, upgrades) as WebServer)
    ctx.provide('apiProxy', {
      events: {
        mux: (_request: unknown, signal: AbortSignal) => waitForAbort(signal),
        host: (_request: unknown, signal: AbortSignal) => waitForAbort(signal),
      },
    } as unknown as ApiProxy)
    let current!: AccessTicketBinding
    const verifier: AccessTicketVerifier = { verify: async () => ({ ok: true, binding: current }) }
    const fiber = ctx.plugin({ inject: [...inject], apply }, {
      accessTicket: { audience: 'dsh-web-canary', verifier },
    })
    await fiber.await()
    const server = createServer()
    server.on('upgrade', (request, socket, head) => {
      const handler = upgrades.find(route => route.path === new URL(request.url ?? '/', 'http://dsh.internal').pathname)?.handler
      if (handler === undefined) socket.destroy()
      else void handler(request, socket, head)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${String(port)}`
    current = accessTicketBinding(origin, { expiresAt: Date.now() + 500 })
    const headers = { 'x-dsh-access-ticket': 'ticket-pair' }
    const mux = new WebSocket(`ws://127.0.0.1:${String(port)}/api/events.mux`, { origin, headers })
    const host = new WebSocket(`ws://127.0.0.1:${String(port)}/api/events.host`, { origin, headers })
    await Promise.all([once(mux, 'open'), once(host, 'open')])
    await Promise.all([once(mux, 'close'), once(host, 'close')])

    current = accessTicketBinding(origin, {
      expiresAt: Date.now() + 60_000,
      connectionGeneration: 'connection-generation-reopen' as AccessTicketBinding['connectionGeneration'],
    })
    const replay = new WebSocket(`ws://127.0.0.1:${String(port)}/api/events.mux`, { origin, headers })
    const status = await new Promise<number>((resolve, reject) => {
      replay.once('unexpected-response', (_request, response) => { resolve(response.statusCode ?? 0) })
      replay.once('error', reject)
    })
    expect(status).toBe(403)

    running.push(async () => {
      await fiber.dispose()
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) { resolve() } else { reject(error) }
      }))
    })
  }, 10_000)
})
