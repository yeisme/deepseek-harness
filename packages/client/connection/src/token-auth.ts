/**
 * First-party bearer-token authentication for the DSH web transport.
 *
 * This is a local transport-admission layer: it verifies an opaque token the
 * deployment operator created, grants remote clients access to the /api bridge
 * and its two WebSocket downlinks, and lets an authenticated admin reach the
 * methods that remain loopback-only without authentication.
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

/** Scopes a DSH access token can carry. */
export type DshTokenScope = 'web' | 'tui' | 'admin'

/** One accepted opaque token and the scopes it grants. */
export interface DshTokenAuthToken {
  /** Opaque token value; DSH never logs or persists the plaintext. */
  readonly token: string
  /** Scopes granted by this token. Defaults to `['admin']`. */
  readonly scopes?: readonly DshTokenScope[]
}

/** Explicit configuration for the built-in token gate. */
export interface DshTokenAuthConfig {
  /** Accepted tokens, in configuration order. */
  readonly tokens: readonly DshTokenAuthToken[]
}

/** The transport facts the gate reads from either HTTP representation. */
export interface DshTokenAuthRequest {
  readonly headers: IncomingHttpHeaders | Headers
}

/** Successful authentication result. */
export interface DshTokenAuthResult {
  /** Scopes granted by the matched token. */
  readonly scopes: ReadonlySet<DshTokenScope>
}

/** Default cookie name carrying the browser token. */
export const DSH_ACCESS_TOKEN_COOKIE = '__Host-dsh-access-token'

/** Fallback cookie name used when the deployment is not on HTTPS. */
export const DSH_ACCESS_TOKEN_COOKIE_FALLBACK = 'dsh-access-token'

/** Default header carrying the token for non-browser clients. */
export const DSH_ACCESS_TOKEN_HEADER = 'x-dsh-access-token'

function header(headers: IncomingHttpHeaders | Headers, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name.toLowerCase()]
  return typeof value === 'string' ? value : undefined
}

function readCookie(headers: IncomingHttpHeaders | Headers, name: string): string | undefined {
  const cookie = header(headers, 'cookie')
  if (cookie === undefined) return undefined
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

function readToken(headers: IncomingHttpHeaders | Headers): string | undefined {
  const authorization = header(headers, 'authorization')
  if (authorization !== undefined) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
    if (match !== null) return match[1]?.trim()
  }
  return header(headers, DSH_ACCESS_TOKEN_HEADER)
    ?? readCookie(headers, DSH_ACCESS_TOKEN_COOKIE)
    ?? readCookie(headers, DSH_ACCESS_TOKEN_COOKIE_FALLBACK)
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function normalizeScopes(scopes: readonly DshTokenScope[] | undefined): ReadonlySet<DshTokenScope> {
  const values: readonly DshTokenScope[] = scopes === undefined || scopes.length === 0 ? ['admin'] : scopes
  const result = new Set<DshTokenScope>(values)
  if (result.size === 0) result.add('admin')
  return result
}

/**
 * Verifies opaque bearer tokens for HTTP and WebSocket admission.
 *
 * The gate is deliberately stateless: token revocation and expiry are handled
 * by the token store/operator before a token is placed in configuration, or by
 * a future persistent store. It never writes token values to logs.
 */
export class DshTokenGate {
  private readonly entries: { readonly token: string; readonly scopes: ReadonlySet<DshTokenScope> }[]

  /** @param config - accepted tokens and their scopes. */
  constructor(config: DshTokenAuthConfig) {
    if (!Array.isArray(config.tokens) || config.tokens.length === 0) {
      throw new Error('client-connection: tokenAuth.tokens must contain at least one token')
    }
    this.entries = config.tokens.map((entry) => {
      if (typeof entry.token !== 'string' || entry.token.length === 0) {
        throw new Error('client-connection: tokenAuth token must be a non-empty opaque value')
      }
      return { token: entry.token, scopes: normalizeScopes(entry.scopes) }
    })
  }

  /**
   * Authenticate one request and return its granted scopes.
   * @param request - request headers.
   * @returns matched scopes, or undefined when no token is valid.
   */
  authenticate(request: DshTokenAuthRequest): DshTokenAuthResult | undefined {
    return this.authenticateToken(readToken(request.headers) ?? '')
  }

  /**
   * Authenticate one raw token value.
   * @param token - presented opaque token.
   * @returns matched scopes, or undefined when the token is invalid.
   */
  authenticateToken(token: string): DshTokenAuthResult | undefined {
    if (token === '') return undefined
    for (const entry of this.entries) {
      if (safeEqual(entry.token, token)) return { scopes: entry.scopes }
    }
    return undefined
  }

  /**
   * Whether an HTTP request may enter the authenticated API bridge.
   * @param request - request headers.
   * @returns true for any valid token.
   */
  authorizeHttp(request: DshTokenAuthRequest): boolean {
    return this.authenticate(request) !== undefined
  }

  /**
   * Whether a WebSocket upgrade may open an event downlink.
   * @param request - upgrade request headers.
   * @returns true for any valid token.
   */
  authorizeWebSocket(request: DshTokenAuthRequest): boolean {
    return this.authenticate(request) !== undefined
  }

  /**
   * Whether the request carries a token with the `admin` scope.
   * @param request - request headers.
   * @returns true when an admin-scoped token is present.
   */
  authorizeAdmin(request: DshTokenAuthRequest): boolean {
    return this.authenticate(request)?.scopes.has('admin') ?? false
  }
}
