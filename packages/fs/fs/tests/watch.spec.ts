import { describe, expect, it } from 'vitest'
import {
  FILE_WATCH_CAPABILITY,
  assertWatchEvent,
  hasFileWatchCapability,
  isOpaqueWatchRef,
} from '../src/watch.ts'

describe('FileWatchCapabilityV1', () => {
  it('rejects absolute paths and file URLs as refs', () => {
    expect(isOpaqueWatchRef('entry-1')).toBe(true)
    expect(isOpaqueWatchRef('/tmp/secret')).toBe(false)
    expect(isOpaqueWatchRef('file:///tmp/secret')).toBe(false)
    expect(isOpaqueWatchRef('C:\\Windows')).toBe(false)
  })

  it('requires both the capability id and a watch method', () => {
    expect(hasFileWatchCapability(undefined)).toBe(false)
    expect(hasFileWatchCapability({ capabilities: [FILE_WATCH_CAPABILITY] })).toBe(false)
    expect(hasFileWatchCapability({
      capabilities: [FILE_WATCH_CAPABILITY],
      watch: () => ({
        capability: FILE_WATCH_CAPABILITY,
        subscribe: () => () => {},
        snapshotCursor: () => '0',
      }),
    })).toBe(true)
  })

  it('rejects leaked path-shaped events', () => {
    expect(() => assertWatchEvent({
      cursor: '1',
      sequence: 1,
      op: 'changed',
      entryRef: '/etc/passwd',
      occurredAt: '2026-08-22T00:00:00.000Z',
    })).toThrow(/opaque host ref/)
  })
})
