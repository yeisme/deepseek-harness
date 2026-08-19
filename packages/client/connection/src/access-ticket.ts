/** Enterprise access-ticket verification seam for the Host web transport. */

import type { IncomingHttpHeaders } from 'node:http'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque session identifier asserted by an enterprise access-ticket authority. */
export type AccessTicketSessionId = Branded<'DshAccessTicketSessionId'>
/** Opaque principal identifier asserted by an enterprise access-ticket authority. */
export type AccessTicketPrincipalId = Branded<'DshAccessTicketPrincipalId'>
/** Opaque tenant identifier asserted by an enterprise access-ticket authority. */
export type AccessTicketTenantId = Branded<'DshAccessTicketTenantId'>
/** Opaque workspace identifier asserted by an enterprise access-ticket authority. */
export type AccessTicketWorkspaceId = Branded<'DshAccessTicketWorkspaceId'>
/** Opaque runtime reference asserted by an enterprise access-ticket authority. */
export type AccessTicketRuntimeRef = Branded<'DshAccessTicketRuntimeRef'>
/** Opaque runtime generation asserted by an enterprise access-ticket authority. */
export type AccessTicketRuntimeGeneration = Branded<'DshAccessTicketRuntimeGeneration'>
/** Opaque browser-connection generation asserted by an enterprise access-ticket authority. */
export type AccessTicketConnectionGeneration = Branded<'DshAccessTicketConnectionGeneration'>
/** Opaque access-ticket replay identifier asserted by an enterprise access-ticket authority. */
export type AccessTicketJti = Branded<'DshAccessTicketJti'>

/** The immutable scope that an accepted ticket binds to one browser connection. */
export interface AccessTicketBinding {
  /** Session that owns the request. */
  readonly sid: AccessTicketSessionId
  /** Authenticated human or service principal. */
  readonly principal: AccessTicketPrincipalId
  /** Tenant selected by the authoritative identity service. */
  readonly tenant: AccessTicketTenantId
  /** Workspace selected by the authoritative control plane. */
  readonly workspace: AccessTicketWorkspaceId
  /** Runtime installation selected by the authoritative control plane. */
  readonly runtimeRef: AccessTicketRuntimeRef
  /** Runtime generation that the ticket was minted for. */
  readonly runtimeGeneration: AccessTicketRuntimeGeneration
  /** Browser connection generation shared by the HTTP and both downlink paths. */
  readonly connectionGeneration: AccessTicketConnectionGeneration
  /** Exact audience expected by this deployment. */
  readonly audience: string
  /** Exact browser origin for this connection. */
  readonly origin: string
  /** Unix epoch milliseconds after which the ticket is not accepted. */
  readonly expiresAt: number
  /** Replay identifier whose uniqueness/revocation is owned by the verifier. */
  readonly jti: AccessTicketJti
}

/** The transport facts presented to an enterprise access-ticket verifier. */
export interface AccessTicketVerificationRequest {
  /** Opaque ticket value, never parsed or logged by this package. */
  readonly ticket: string
  /** Fixed enterprise Web transport profile understood by this package. */
  readonly transportProfile: 'dsh_web_v1'
  /** Exact DSH Web carrier. Generic WebSocket upgrades are never authorized. */
  readonly carrier: 'http' | 'events.mux' | 'events.host'
  /** Exact request pathname below the host web server. */
  readonly path: string
  /** HTTP method used by the carrier. */
  readonly method: string
  /** Host authority previously accepted by the browser-trust fence. */
  readonly host: string
  /** Browser Origin header; enterprise mode requires this exact value. */
  readonly origin: string
  /** Abort signal that ends when the HTTP peer disconnects where available. */
  readonly signal: AbortSignal | undefined
}

/** Result returned by an enterprise access-ticket verifier. */
export type AccessTicketVerificationResult =
  | {
    /** Accepted verification marker. */
    readonly ok: true
    /** Authoritative immutable binding returned by the verifier. */
    readonly binding: AccessTicketBinding
  }
  | {
    /** Indistinguishable denial marker that reveals no binding detail. */
    readonly ok: false
  }

/** Server-side authority that verifies opaque access tickets without provider calls in the DSH process. */
export interface AccessTicketVerifier {
  /**
   * Verify one opaque ticket and return its authoritative immutable binding.
   * The implementation owns signature checks, revocation, and distributed
   * replay prevention; the DSH transport only validates and correlates its
   * returned binding.
   * @param request - Opaque ticket plus the carrier facts it must bind.
   * @returns accepted binding or an indistinguishable denial.
   */
  verify(request: AccessTicketVerificationRequest): Promise<AccessTicketVerificationResult>
}

/** Explicit opt-in configuration for the enterprise access-ticket canary. */
export interface AccessTicketConfig {
  /** Expected token audience for this DSH web deployment. */
  readonly audience: string
  /** Request header carrying the opaque ticket. Defaults to `x-dsh-access-ticket`. */
  readonly header?: string
  /**
   * Cookie carrying the opaque ticket when no configured header is present.
   * Defaults to `__Host-dsh-access-ticket`; the upstream control plane owns
   * its Secure, HttpOnly, SameSite, and Path attributes.
   */
  readonly cookieName?: string
  /** Enterprise control-plane verifier supplied by the host composition. */
  readonly verifier: AccessTicketVerifier
}

type HeaderBag = IncomingHttpHeaders | Headers

interface TicketRequest {
  readonly headers: HeaderBag
  readonly url?: string | undefined
  readonly method?: string | undefined
  readonly signal?: AbortSignal | undefined
}

interface GenerationRecord {
  readonly fingerprint: string
  readonly binding: AccessTicketBinding
  readonly streams: Map<'mux' | 'host', () => void>
  readonly jtis: Set<AccessTicketJti>
  readonly expires: ReturnType<typeof setTimeout>
}

/** Read and validate enterprise tickets for HTTP and the two connection downlinks. */
export class AccessTicketGate {
  private readonly headerName: string
  private readonly cookieName: string
  private readonly generations = new Map<AccessTicketConnectionGeneration, GenerationRecord>()
  private readonly jtiGenerations = new Map<AccessTicketJti, AccessTicketConnectionGeneration>()
  private readonly consumedJtis = new Set<AccessTicketJti>()
  private readonly sidGenerations = new Map<AccessTicketSessionId, AccessTicketConnectionGeneration>()

  /** @param config - explicitly supplied enterprise verifier and expected audience. */
  constructor(private readonly config: AccessTicketConfig) {
    if (!isNonEmpty(config.audience)) throw new Error('client-connection: accessTicket audience must be a non-empty opaque value')
    const verifier = config.verifier as AccessTicketVerifier | null
    if (verifier === null || typeof verifier.verify !== 'function') {
      throw new Error('client-connection: accessTicket verifier must expose verify(request)')
    }
    this.headerName = config.header ?? 'x-dsh-access-ticket'
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(this.headerName)) {
      throw new Error('client-connection: accessTicket header must be an HTTP field name')
    }
    this.cookieName = config.cookieName ?? '__Host-dsh-access-ticket'
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(this.cookieName)) {
      throw new Error('client-connection: accessTicket cookieName must be an HTTP cookie name')
    }
  }

  /**
   * Verify one HTTP request before it reaches the API bridge.
   * @param request - Node request facts after the browser-trust fence passes.
   * @returns true only when the opaque ticket has an exact valid binding.
   */
  async authorizeHttp(request: TicketRequest): Promise<boolean> {
    const binding = await this.verify(request, 'http')
    return binding !== undefined && this.joinGeneration(binding)
  }

  /**
   * Reserve one downlink in the ticket's browser-connection generation.
   * A caller must attach `release` to the raw socket close path. Reusing a
   * downlink path or presenting different claims for one jti tears down the
   * established generation before the new upgrade is rejected.
   * @param request - Node upgrade facts after the browser-trust fence passes.
   * @param stream - downlink path being opened.
   * @param close - closes this raw transport if its sibling later fails.
   * @returns release callback when the upgrade may proceed, otherwise undefined.
   */
  async authorizeWebSocket(
    request: TicketRequest,
    stream: 'mux' | 'host',
    close: () => void,
  ): Promise<(() => void) | undefined> {
    const binding = await this.verify(request, stream === 'mux' ? 'events.mux' : 'events.host')
    if (binding === undefined) return undefined
    if (!this.joinGeneration(binding)) return undefined
    const record = this.generations.get(binding.connectionGeneration)
    if (record === undefined) return undefined
    if (record.streams.has(stream)) {
      this.failGeneration(binding.connectionGeneration)
      return undefined
    }
    record.streams.set(stream, close)
    let released = false
    return () => {
      if (released) return
      released = true
      // A pair is one connection generation: either downlink ending invalidates
      // the other rather than allowing a half-open or mixed-generation stream.
      this.failGeneration(binding.connectionGeneration)
    }
  }

  /** Close every tracked generation and release its hard-expiry timer. */
  close(): void {
    for (const generation of [...this.generations.keys()]) this.failGeneration(generation)
  }

  private async verify(
    request: TicketRequest,
    carrier: AccessTicketVerificationRequest['carrier'],
  ): Promise<AccessTicketBinding | undefined> {
    const ticket = readHeader(request.headers, this.headerName) ?? readCookie(request.headers, this.cookieName)
    const host = readHeader(request.headers, 'host')
    const origin = readHeader(request.headers, 'origin')
    if (!isNonEmpty(ticket) || !isNonEmpty(host) || !isNonEmpty(origin)) return undefined
    let result: AccessTicketVerificationResult
    try {
      result = await this.config.verifier.verify({
        ticket,
        transportProfile: 'dsh_web_v1',
        carrier,
        path: new URL(request.url ?? '/', 'http://dsh.internal').pathname,
        method: request.method ?? 'GET',
        host,
        origin,
        signal: request.signal,
      })
    } catch {
      return undefined
    }
    if (!result.ok || !validBinding(result.binding, this.config.audience, origin)) return undefined
    return result.binding
  }

  private joinGeneration(binding: AccessTicketBinding): boolean {
    this.expireGenerations()
    const generation = binding.connectionGeneration
    const fingerprint = bindingFingerprint(binding)
    const knownJtiGeneration = this.jtiGenerations.get(binding.jti)
    if (knownJtiGeneration === undefined && this.consumedJtis.has(binding.jti)) return false
    if (knownJtiGeneration !== undefined && knownJtiGeneration !== generation) {
      this.failGeneration(knownJtiGeneration)
      return false
    }
    const knownSidGeneration = this.sidGenerations.get(binding.sid)
    if (knownSidGeneration !== undefined && knownSidGeneration !== generation) {
      // The paired downlinks have no browser-supplied application data. Until
      // the carrier grows an authenticated pair nonce, fail closed to one live
      // browser generation per access-ticket session instead of letting a mux
      // from one generation combine with a host stream from another.
      this.failGeneration(knownSidGeneration)
      return false
    }
    const current = this.generations.get(generation)
    if (current !== undefined && current.fingerprint !== fingerprint) {
      this.failGeneration(generation)
      return false
    }
    const record = current ?? this.createGenerationRecord(binding, fingerprint)
    if (current === undefined) {
      this.generations.set(generation, record)
      this.sidGenerations.set(binding.sid, generation)
    }
    record.jtis.add(binding.jti)
    this.jtiGenerations.set(binding.jti, generation)
    return true
  }

  private failGeneration(generation: AccessTicketConnectionGeneration): void {
    const record = this.generations.get(generation)
    if (record === undefined) return
    this.generations.delete(generation)
    clearTimeout(record.expires)
    if (this.sidGenerations.get(record.binding.sid) === generation) this.sidGenerations.delete(record.binding.sid)
    for (const jti of record.jtis) {
      if (this.jtiGenerations.get(jti) === generation) this.jtiGenerations.delete(jti)
      this.consumedJtis.add(jti)
    }
    for (const close of record.streams.values()) {
      try {
        close()
      } catch {
        // The peer may have concurrently closed; its transport owns cleanup.
      }
    }
  }

  private expireGenerations(): void {
    const now = Date.now()
    for (const [generation, record] of this.generations) {
      if (record.binding.expiresAt <= now) this.failGeneration(generation)
    }
  }

  private createGenerationRecord(binding: AccessTicketBinding, fingerprint: string): GenerationRecord {
    const delay = binding.expiresAt - Date.now()
    // `validBinding()` rejects `delay <= 0`; this timeout enforces the same
    // boundary after admission even when no later request arrives.
    const expires = setTimeout(() => { this.failGeneration(binding.connectionGeneration) }, delay)
    return {
      fingerprint,
      binding,
      streams: new Map<'mux' | 'host', () => void>(),
      jtis: new Set<AccessTicketJti>(),
      expires,
    }
  }
}

function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name.toLowerCase()]
  return typeof value === 'string' ? value : undefined
}

function readCookie(headers: HeaderBag, name: string): string | undefined {
  const cookie = readHeader(headers, 'cookie')
  if (cookie === undefined) return undefined
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

function validBinding(binding: AccessTicketBinding, audience: string, origin: string): boolean {
  const unexpired = Number.isFinite(binding.expiresAt) && binding.expiresAt > Date.now()
  if (binding.audience !== audience || binding.origin !== origin || !unexpired) return false
  try {
    if (new URL(binding.origin).origin !== new URL(origin).origin) return false
  } catch {
    return false
  }
  return isNonEmpty(binding.sid)
    && isNonEmpty(binding.principal)
    && isNonEmpty(binding.tenant)
    && isNonEmpty(binding.workspace)
    && isNonEmpty(binding.runtimeRef)
    && isNonEmpty(binding.runtimeGeneration)
    && isNonEmpty(binding.connectionGeneration)
    && isNonEmpty(binding.jti)
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
}

function bindingFingerprint(binding: AccessTicketBinding): string {
  return JSON.stringify([
    binding.sid, binding.principal, binding.tenant, binding.workspace,
    binding.runtimeRef, binding.runtimeGeneration, binding.connectionGeneration,
    binding.audience, binding.origin, binding.expiresAt,
  ])
}
