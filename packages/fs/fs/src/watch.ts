/**
 * Additive FileWatchCapabilityV1 for ctx.fs.
 *
 * Watch handles publish opaque entry refs only. Absolute paths, file:// URLs,
 * tokens, and credentials must stay on the Host side of the handle.
 *
 * @module @deepseek-ai/dsh-fs/watch
 */

export const FILE_WATCH_CAPABILITY = 'FileWatchCapabilityV1' as const

export type FileWatchOp = 'created' | 'changed' | 'deleted' | 'renamed'

export interface FileWatchEventV1 {
  readonly cursor: string
  readonly sequence: number
  readonly op: FileWatchOp
  readonly entryRef: string
  readonly parentRef?: string
  readonly occurredAt: string
}

export interface FileWatchHandle {
  readonly capability: typeof FILE_WATCH_CAPABILITY
  subscribe(listener: (event: FileWatchEventV1) => void): () => void
  snapshotCursor(): string
}

export interface FileWatchSource {
  readonly capabilities?: readonly string[]
  watch?(parentRef?: string): FileWatchHandle
}

const FORBIDDEN = /^(?:\/|[A-Za-z]:\\|file:|https?:|bearer\s)/i

export function isOpaqueWatchRef(value: string): boolean {
  return value.length > 0 && !FORBIDDEN.test(value) && !value.includes('://')
}

export function hasFileWatchCapability(source: FileWatchSource | undefined): boolean {
  return source?.capabilities?.includes(FILE_WATCH_CAPABILITY) === true
    && typeof source.watch === 'function'
}

export function assertWatchEvent(event: FileWatchEventV1): void {
  if (!isOpaqueWatchRef(event.entryRef)) {
    throw new Error('FileWatchEventV1.entryRef must be an opaque host ref')
  }
  if (event.parentRef !== undefined && !isOpaqueWatchRef(event.parentRef)) {
    throw new Error('FileWatchEventV1.parentRef must be an opaque host ref')
  }
}
