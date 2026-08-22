import { describe, expect, it } from 'vitest'
import {
  COOKIE_JARS_CAPABILITY,
  hasCookieJarsCapability,
  isSafeCookieJarProfile,
  redactCookieJarReceipt,
} from '../src/cookie-jars.ts'

describe('WebCookieJarsV1', () => {
  it('accepts profile refs and rejects credential-shaped ids', () => {
    expect(isSafeCookieJarProfile({ profileRef: 'acct-42', siteScope: 'example.com' })).toBe(true)
    expect(isSafeCookieJarProfile({ profileRef: 'token=abc', siteScope: 'example.com' })).toBe(false)
  })

  it('requires apply/switch/clear before advertising the capability', () => {
    expect(hasCookieJarsCapability({ capabilities: [COOKIE_JARS_CAPABILITY] })).toBe(false)
    expect(hasCookieJarsCapability({
      capabilities: [COOKIE_JARS_CAPABILITY],
      applyJar: async () => ({ action: 'apply', profileRef: 'acct-42', status: 'accepted' }),
      switchJar: async () => ({ action: 'switch', profileRef: 'acct-42', status: 'accepted' }),
      clearJar: async () => ({ action: 'clear', profileRef: 'acct-42', status: 'accepted' }),
    })).toBe(true)
  })

  it('redacts credential words from receipts', () => {
    expect(redactCookieJarReceipt({
      action: 'apply',
      profileRef: 'acct-42',
      status: 'rejected',
      reason: 'cookie header missing',
    }).reason).toBe('redacted')
  })
})
