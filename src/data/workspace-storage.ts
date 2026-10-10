import type { AtlasDataSnapshot, VersionedSnapshot } from './snapshot'
import { assertSnapshotShape } from './snapshot-schema'
import { backupByteLimit } from './workspace-backup'

export const workspaceStorageKey = 'taskora:workspace'
export interface PersistedSnapshot extends VersionedSnapshot { readonly recoveryEpoch: number }
export interface SnapshotPersistence {
  readonly needsMigration: boolean
  load(): PersistedSnapshot | null
  save(expectedVersion: number, snapshot: PersistedSnapshot): void
  exclusive<T>(action: () => T): Promise<T>
}
export interface WorkspaceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface WorkspaceLocks { request<T>(name: string, callback: () => T): Promise<T> }

export class StorageConflictError extends Error {}
export class WorkspaceStorageError extends Error {}

function checksum(content: string): string {
  // Detect accidental corruption; this is not a signature or protection against same-origin scripts.
  let hash = 2166136261
  for (let i = 0; i < content.length; i += 1) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}
function payload(snapshot: PersistedSnapshot) {
  return { format: 'taskora.local', schemaVersion: 2, version: snapshot.version, recoveryEpoch: snapshot.recoveryEpoch, data: snapshot.data } as const
}
export function encodeStoredSnapshot(snapshot: PersistedSnapshot): string {
  const body = payload(snapshot)
  const content = JSON.stringify({ ...body, checksum: checksum(JSON.stringify(body)) })
  if (new TextEncoder().encode(content).byteLength > backupByteLimit) throw new WorkspaceStorageError('Workspace exceeds the 10 MiB storage limit. Export a backup before reducing its size.')
  return content
}
export function decodeStoredSnapshot(content: string): { snapshot: PersistedSnapshot; migrated: boolean } {
  try {
    if (content.length > backupByteLimit || new TextEncoder().encode(content).byteLength > backupByteLimit) throw new Error('Saved workspace is too large.')
    const value: unknown = JSON.parse(content)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid saved workspace.')
    const root = value as Record<string, unknown>
    const version = root['version']
    const schemaVersion = root['schemaVersion']
    if (root['format'] !== 'taskora.local' || (schemaVersion !== 1 && schemaVersion !== 2)) throw new Error('Unsupported saved workspace schema. Use a compatible Taskora version.')
    const keys = schemaVersion === 1 ? ['format', 'schemaVersion', 'version', 'data'] : ['format', 'schemaVersion', 'version', 'recoveryEpoch', 'data', 'checksum']
    if (Object.keys(root).length !== keys.length || keys.some((key) => !Object.hasOwn(root, key))) throw new Error('Invalid saved workspace fields.')
    const recoveryEpoch = schemaVersion === 1 ? 0 : root['recoveryEpoch']
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0 ||
      typeof recoveryEpoch !== 'number' || !Number.isSafeInteger(recoveryEpoch) || recoveryEpoch < 0 || recoveryEpoch > version) throw new Error('Invalid saved workspace revision.')
    const data = root['data']
    assertSnapshotShape(data)
    const snapshot = { version, recoveryEpoch, data }
    if (schemaVersion === 2 && root['checksum'] !== checksum(JSON.stringify(payload(snapshot)))) throw new Error('Saved workspace checksum does not match.')
    return { snapshot, migrated: schemaVersion === 1 }
  } catch (cause) {
    throw new WorkspaceStorageError(cause instanceof Error ? cause.message : 'Saved workspace is corrupt.')
  }
}

export class BrowserWorkspacePersistence implements SnapshotPersistence {
  private lastRaw: string | null = null
  private lastVersion = 0
  private migration = false
  get needsMigration(): boolean { return this.migration }

  private readonly storage: WorkspaceStorage
  private readonly locks: WorkspaceLocks

  constructor(storage: WorkspaceStorage, locks: WorkspaceLocks) {
    this.storage = storage
    this.locks = locks
  }

  load(): PersistedSnapshot | null {
    const raw = this.readRaw()
    if (raw === null) {
      this.lastRaw = null; this.lastVersion = 0; this.migration = false
      return null
    }
    const decoded = decodeStoredSnapshot(raw)
    this.lastRaw = raw; this.lastVersion = decoded.snapshot.version; this.migration = decoded.migrated
    return decoded.snapshot
  }

  save(expectedVersion: number, snapshot: PersistedSnapshot): void {
    if (this.readRaw() !== this.lastRaw || expectedVersion !== this.lastVersion) {
      throw new StorageConflictError('Saved workspace changed. Refresh before retrying.')
    }
    const content = encodeStoredSnapshot(snapshot)
    try { this.storage.setItem(workspaceStorageKey, content) } catch {
      throw new WorkspaceStorageError('Workspace could not be saved. Storage may be full or blocked. No changes were committed; free browser storage and retry.')
    }
    this.lastRaw = content; this.lastVersion = snapshot.version; this.migration = false
  }

  exclusive<T>(action: () => T): Promise<T> {
    return this.locks.request(workspaceStorageKey, action)
  }

  private readRaw(): string | null {
    try { return this.storage.getItem(workspaceStorageKey) } catch {
      throw new WorkspaceStorageError('Browser storage is unavailable. Workspace data has not been replaced.')
    }
  }
}

export function initialStoredSnapshot(data: AtlasDataSnapshot): PersistedSnapshot {
  return { data, version: 0, recoveryEpoch: 0 }
}
