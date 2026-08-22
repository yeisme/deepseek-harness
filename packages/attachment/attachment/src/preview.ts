/**
 * Additive PreviewResourceV1 for owner-issued preview refs.
 *
 * Hosts issue opaque refs, sniff MIME, and serve bounded range/rendition
 * reads. Clients never see filesystem paths.
 *
 * @module @deepseek-ai/dsh-attachment/preview
 */

export const PREVIEW_RESOURCE_CAPABILITY = 'PreviewResourceV1' as const

export interface PreviewResourceRef {
  readonly previewId: string
  readonly mediaType: string
  readonly bytes?: number
}

export interface PreviewReadRequest {
  readonly previewId: string
  readonly offset?: number
  readonly length?: number
  readonly rendition?: 'original' | 'thumbnail' | 'text'
  readonly signal?: AbortSignal
}

export interface PreviewReadResult {
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly complete: boolean
}

export interface PreviewResourceSource {
  readonly capabilities?: readonly string[]
  openPreview?(input: { mediaType?: string; bytes?: Uint8Array }): Promise<PreviewResourceRef>
  readPreview?(request: PreviewReadRequest): Promise<PreviewReadResult>
  releasePreview?(previewId: string): Promise<void>
}

const FORBIDDEN_ID = /^(?:\/|[A-Za-z]:\\|file:)/i

export function isOpaquePreviewId(previewId: string): boolean {
  return previewId.length > 0 && !FORBIDDEN_ID.test(previewId) && !previewId.includes('://')
}

export function sniffPreviewMediaType(bytes: Uint8Array, declared?: string): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44) {
    return 'application/pdf'
  }
  if (declared !== undefined && declared.includes('/') && !declared.includes(' ')) return declared
  return 'application/octet-stream'
}

export function hasPreviewResourceCapability(source: PreviewResourceSource | undefined): boolean {
  return source?.capabilities?.includes(PREVIEW_RESOURCE_CAPABILITY) === true
    && typeof source.openPreview === 'function'
    && typeof source.readPreview === 'function'
    && typeof source.releasePreview === 'function'
}
