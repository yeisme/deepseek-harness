/**
 * Additive web.cookieJars host seam.
 *
 * The host owns jar bytes. Plugins send profile refs and receive receipts.
 * Cookie values, tokens, and Set-Cookie headers never leave this module.
 *
 * @module @deepseek-ai/dsh-web/cookie-jars
 */

export const COOKIE_JARS_CAPABILITY = 'WebCookieJarsV1' as const

export type CookieJarAction = 'apply' | 'switch' | 'clear'

export interface CookieJarProfileRef {
  readonly profileRef: string
  readonly siteScope: string
}

export interface CookieJarReceipt {
  readonly action: CookieJarAction
  readonly profileRef: string
  readonly status: 'accepted' | 'rejected'
  readonly reason?: string
}

export interface CookieJarSource {
  readonly capabilities?: readonly string[]
  applyJar?(profile: CookieJarProfileRef): Promise<CookieJarReceipt>
  switchJar?(from: CookieJarProfileRef, to: CookieJarProfileRef): Promise<CookieJarReceipt>
  clearJar?(profile: CookieJarProfileRef): Promise<CookieJarReceipt>
}

const FORBIDDEN_KEY = /cookie|token|authorization|set-cookie|bearer/i

export function isSafeCookieJarProfile(profile: CookieJarProfileRef): boolean {
  return profile.profileRef.length > 0
    && profile.siteScope.length > 0
    && !FORBIDDEN_KEY.test(profile.profileRef)
    && !profile.profileRef.includes('=')
}

export function hasCookieJarsCapability(source: CookieJarSource | undefined): boolean {
  return source?.capabilities?.includes(COOKIE_JARS_CAPABILITY) === true
    && typeof source.applyJar === 'function'
    && typeof source.switchJar === 'function'
    && typeof source.clearJar === 'function'
}

export function redactCookieJarReceipt(receipt: CookieJarReceipt): CookieJarReceipt {
  if (receipt.reason !== undefined && FORBIDDEN_KEY.test(receipt.reason)) {
    return { ...receipt, reason: 'redacted' }
  }
  return receipt
}
