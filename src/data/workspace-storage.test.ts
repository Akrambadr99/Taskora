import { describe, expect, it } from 'vitest'
import { BrowserWorkspacePersistence, decodeStoredSnapshot, encodeStoredSnapshot, initialStoredSnapshot, type WorkspaceLocks, type WorkspaceStorage } from './workspace-storage'
import { InMemoryDataStore } from './store'
import { createAtlasFixtures } from './fixtures'
import { MockAtlasGateway } from './gateway/mock-gateway'

class MemoryDisk implements WorkspaceStorage {
  value: string | null = null
  blocked = false
  getItem(): string | null { return this.value }
  setItem(_key: string, value: string): void {
    if (this.blocked) throw new Error('QuotaExceededError')
    this.value = value
  }
}
class SerialLocks implements WorkspaceLocks {
  private tail: Promise<unknown> = Promise.resolve()
  request<T>(_name: string, callback: () => T): Promise<T> {
    const next = this.tail.then(callback)
    this.tail = next.catch(() => undefined)
    return next
  }
}
function setup() {
  const data = createAtlasFixtures()
  const disk = new MemoryDisk()
  const locks = new SerialLocks()
  const persistence = new BrowserWorkspacePersistence(disk, locks)
  const store = new InMemoryDataStore(data, persistence)
  return { data, disk, locks, persistence, store }
}

describe('durable workspace transactions', () => {
  it('saves before publishing a mutation and reopens the exact version after restart', async () => {
    const c = setup()
    await c.store.exclusive(() => c.store.commit(0, c.data))
    const reopened = new InMemoryDataStore(c.data, new BrowserWorkspacePersistence(c.disk, c.locks))
    expect(reopened.read()).toEqual(c.store.read())
    expect(reopened.read().version).toBe(1)
    expect(JSON.parse(c.disk.value ?? '{}')).toMatchObject({ format: 'taskora.local', schemaVersion: 2, recoveryEpoch: 0 })
  })

  it('migrates legacy v1 under the lock without changing content or revision', async () => {
    const c = setup()
    c.disk.value = JSON.stringify({ format: 'taskora.local', schemaVersion: 1, version: 7, data: c.data })
    const store = new InMemoryDataStore(c.data, c.persistence)
    expect(c.persistence.needsMigration).toBe(true)
    await store.exclusive(() => undefined)
    expect(c.persistence.needsMigration).toBe(false)
    expect(decodeStoredSnapshot(c.disk.value).snapshot).toEqual({ data: c.data, version: 7, recoveryEpoch: 0 })
  })

  it('does not publish or overwrite the previous saved state when quota is exhausted', async () => {
    const c = setup()
    await c.store.exclusive(() => undefined)
    const before = c.store.read()
    const saved = c.disk.value
    c.disk.blocked = true
    await expect(c.store.exclusive(() => c.store.commit(0, c.data))).rejects.toThrow('No changes were committed')
    expect(c.store.read()).toEqual(before)
    expect(c.disk.value).toBe(saved)
    c.disk.blocked = false
    await c.store.exclusive(() => c.store.commit(0, c.data))
    expect(c.store.read().version).toBe(1)
  })

  it('rolls back recovery epoch, revisions and content when the durable write fails', async () => {
    const c = setup()
    await c.store.exclusive(() => undefined)
    c.disk.blocked = true
    await expect(c.store.exclusive(() => { c.store.restore(0, c.data) })).rejects.toThrow()
    expect(c.store.recoveryEpoch).toBe(0)
    expect(c.store.read().version).toBe(0)
    c.disk.blocked = false
    await c.store.exclusive(() => { c.store.restore(0, c.data) })
    expect(new InMemoryDataStore(c.data, new BrowserWorkspacePersistence(c.disk, c.locks)).recoveryEpoch).toBe(1)
  })

  it('serializes two tabs and rejects the stale write instead of losing the winner', async () => {
    const c = setup()
    const other = new InMemoryDataStore(c.data, new BrowserWorkspacePersistence(c.disk, c.locks))
    const results = await Promise.allSettled([
      c.store.exclusive(() => c.store.commit(0, c.data)),
      other.exclusive(() => other.commit(0, c.data)),
    ])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(decodeStoredSnapshot(c.disk.value ?? '').snapshot.version).toBe(1)
    expect(other.read().version).toBe(1)
  })

  it('fails closed on corruption, future schemas and invalid references without rewriting bytes', () => {
    const c = setup()
    const valid = encodeStoredSnapshot(initialStoredSnapshot(c.data))
    for (const raw of ['{broken', valid.replace('taskora.local', 'other'), valid.replace('"schemaVersion":2', '"schemaVersion":9'), valid.replace('"version":0', '"version":1')]) {
      c.disk.value = raw
      expect(() => new InMemoryDataStore(c.data, c.persistence)).toThrow()
      expect(c.disk.value).toBe(raw)
    }
    c.disk.value = JSON.stringify({ format: 'taskora.local', schemaVersion: 1, version: 0, data: { ...c.data, users: [] } })
    expect(() => new InMemoryDataStore(c.data, c.persistence)).toThrow()
  })

  it('does not silently recreate data removed by another tab', async () => {
    const c = setup()
    await c.store.exclusive(() => undefined)
    c.disk.value = null
    await expect(c.store.exclusive(() => c.store.commit(0, c.data))).rejects.toThrow('removed')
    expect(c.disk.value).toBeNull()
  })

  it('rejects direct writes outside the cross-tab transaction', () => {
    const c = setup()
    expect(() => c.store.commit(0, c.data)).toThrow('exclusive transaction')
    expect(c.disk.value).toBeNull()
  })

  it('detects intervening storage changes even when the version is unchanged', () => {
    const c = setup()
    c.persistence.load()
    c.disk.value = encodeStoredSnapshot(initialStoredSnapshot(c.data))
    expect(() => { c.persistence.save(0, initialStoredSnapshot(c.data)) }).toThrow('changed')
  })

  it('refreshes gateway reads and rejects stale issue revisions across tabs', async () => {
    const c = setup()
    const admin = c.data.memberships.find((row) => row.role === 'admin')
    const issue = c.data.issues[0]
    if (!admin || !issue) throw new Error('Expected fixtures')
    const other = new InMemoryDataStore(c.data, new BrowserWorkspacePersistence(c.disk, c.locks))
    const a = new MockAtlasGateway({ store: c.store, actorId: admin.userId })
    const b = new MockAtlasGateway({ store: other, actorId: admin.userId })
    await a.updateIssue({ id: issue.id, expectedRevision: issue.revision, changes: { title: 'Saved by first tab' } })
    await expect(b.updateIssue({ id: issue.id, expectedRevision: issue.revision, changes: { title: 'Stale second tab' } })).rejects.toMatchObject({ code: 'conflict' })
    expect((await b.getIssue(issue.id)).title).toBe('Saved by first tab')
    expect(c.disk.getItem()).not.toBeNull()
  })
})
