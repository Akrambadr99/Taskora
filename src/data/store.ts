import type { SnapshotPersistence } from './workspace-storage'
import { WorkspaceStorageError } from './workspace-storage'
import { assertValidSnapshot } from './snapshot-validation'
import type { AtlasDataSnapshot, VersionedSnapshot } from './snapshot'

export class StaleSnapshotError extends Error {
  readonly expectedVersion: number
  readonly actualVersion: number

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Cannot commit snapshot version ${expectedVersion.toString()}; current version is ${actualVersion.toString()}.`,
    )
    this.name = 'StaleSnapshotError'
    this.expectedVersion = expectedVersion
    this.actualVersion = actualVersion
  }
}

export class InMemoryDataStore {
  private data: AtlasDataSnapshot
  private version = 0
  private recoverySequence = 0
  private transactionOpen = false
  private hasSavedState = false

  get recoveryEpoch(): number { return this.recoverySequence }

  restore(expectedVersion: number, nextData: AtlasDataSnapshot): void {
    this.commitSnapshot(expectedVersion, nextData, this.recoverySequence + 1)
  }

  private readonly persistence: SnapshotPersistence | undefined

  constructor(seed: AtlasDataSnapshot, persistence?: SnapshotPersistence) {
    this.persistence = persistence
    const saved = persistence?.load()
    assertValidSnapshot(saved?.data ?? seed)
    this.data = cloneAndFreeze(saved?.data ?? seed)
    this.version = saved?.version ?? 0
    this.recoverySequence = saved?.recoveryEpoch ?? 0
    this.hasSavedState = saved !== null && saved !== undefined
  }

  async exclusive<T>(action: () => T): Promise<T> {
    if (!this.persistence) return action()
    return this.persistence.exclusive(() => {
      const saved = this.persistence?.load()
      if (!saved && this.hasSavedState) throw new WorkspaceStorageError('Saved workspace was removed. Reload to choose a recovery action.')
      if (saved) {
        if (saved.version < this.version || saved.recoveryEpoch < this.recoverySequence) {
          throw new WorkspaceStorageError('Saved workspace moved backwards. Reload before continuing.')
        }
        this.data = cloneAndFreeze(saved.data)
        this.version = saved.version
        this.recoverySequence = saved.recoveryEpoch
      }
      if (!saved || this.persistence?.needsMigration) {
        this.persistence?.save(this.version, { ...this.read(), recoveryEpoch: this.recoverySequence })
      }
      this.hasSavedState = true
      this.transactionOpen = true
      try { return action() } finally { this.transactionOpen = false }
    })
  }

  read(): VersionedSnapshot {
    return Object.freeze({
      version: this.version,
      data: this.data,
    })
  }

  commit(
    expectedVersion: number,
    nextData: AtlasDataSnapshot,
  ): VersionedSnapshot {
    return this.commitSnapshot(expectedVersion, nextData, this.recoverySequence)
  }

  private commitSnapshot(expectedVersion: number, nextData: AtlasDataSnapshot, recoveryEpoch: number): VersionedSnapshot {
    if (this.persistence && !this.transactionOpen) throw new WorkspaceStorageError('Persistent writes require an exclusive transaction.')
    if (expectedVersion !== this.version) {
      throw new StaleSnapshotError(expectedVersion, this.version)
    }

    assertValidSnapshot(nextData)
    const nextVersion = this.version + 1
    if (!Number.isSafeInteger(nextVersion) || !Number.isSafeInteger(recoveryEpoch)) throw new WorkspaceStorageError('Workspace revision limit reached.')
    const frozen = cloneAndFreeze(nextData)
    this.persistence?.save(expectedVersion, { data: frozen, version: nextVersion, recoveryEpoch })
    this.data = frozen
    this.version = nextVersion
    this.recoverySequence = recoveryEpoch
    return this.read()
  }
}

function cloneAndFreeze(snapshot: AtlasDataSnapshot): AtlasDataSnapshot {
  return deepFreeze(structuredClone(snapshot))
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }

  Object.freeze(value)
  for (const nestedValue of Object.values(value)) deepFreeze(nestedValue)
  return value
}
