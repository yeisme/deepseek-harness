import { describe, expect, it } from 'vitest'
import {
  PREVIEW_RESOURCE_CAPABILITY,
  hasPreviewResourceCapability,
  isOpaquePreviewId,
  sniffPreviewMediaType,
} from '../src/preview.ts'

describe('PreviewResourceV1', () => {
  it('rejects path-shaped preview ids', () => {
    expect(isOpaquePreviewId('prv_1')).toBe(true)
    expect(isOpaquePreviewId('/tmp/a.pdf')).toBe(false)
    expect(isOpaquePreviewId('file:///tmp/a.pdf')).toBe(false)
  })

  it('sniffs png and pdf magic, otherwise uses a declared MIME', () => {
    expect(sniffPreviewMediaType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(sniffPreviewMediaType(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBe('application/pdf')
    expect(sniffPreviewMediaType(Uint8Array.from([1, 2, 3]), 'text/plain')).toBe('text/plain')
  })

  it('requires open/read/release before advertising the capability', () => {
    expect(hasPreviewResourceCapability({
      capabilities: [PREVIEW_RESOURCE_CAPABILITY],
    })).toBe(false)
    expect(hasPreviewResourceCapability({
      capabilities: [PREVIEW_RESOURCE_CAPABILITY],
      openPreview: async () => ({ previewId: 'prv_1', mediaType: 'text/plain' }),
      readPreview: async () => ({ mediaType: 'text/plain', bytes: new Uint8Array(), complete: true }),
      releasePreview: async () => {},
    })).toBe(true)
  })
})
