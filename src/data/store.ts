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

  get recoveryEpoch(): number { return this.recoverySequence }

  restore(expectedVersion: number, nextData: AtlasDataSnapshot): void {
    this.commit(expectedVersion, nextData)
    this.recoverySequence += 1
  }

  constructor(seed: AtlasDataSnapshot) {
    assertValidSnapshot(seed)
    this.data = cloneAndFreeze(seed)
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
    if (expectedVersion !== this.version) {
      throw new StaleSnapshotError(expectedVersion, this.version)
    }

    assertValidSnapshot(nextData)
    this.data = cloneAndFreeze(nextData)
    this.version += 1
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
