import { describe, expect, it } from 'vitest'
import { openBrowserWorkspace, resetBrowserWorkspace } from './browser-workspace'
import { workspaceStorageKey, type WorkspaceLocks } from '../data'

const locks: WorkspaceLocks = { request: <T,>(_name: string, action: () => T): Promise<T> => Promise.resolve(action()) }

describe('browser workspace lifecycle', () => {
  it('does not switch identities when the configured administrator is demoted', async () => {
    window.localStorage.removeItem(workspaceStorageKey)
    const first = openBrowserWorkspace(window.localStorage, locks)
    const actorId = first.services.session.user.id
    await first.store.exclusive(() => {
      const current = first.store.read()
      first.store.commit(current.version, { ...current.data, memberships: current.data.memberships.map((row) =>
        row.userId === actorId ? { ...row, role: 'member', revision: row.revision + 1 } : row) })
    })
    const reopened = openBrowserWorkspace(window.localStorage, locks)
    expect(reopened.services.session.user.id).toBe(actorId)
    expect(reopened.services.session.workspaceMembership.role).toBe('member')
    await expect(reopened.services.gateway.exportWorkspaceBackup(reopened.services.workspaceId)).rejects.toMatchObject({ code: 'forbidden' })
    window.localStorage.removeItem(workspaceStorageKey)
  })

  it('requires cross-tab locking instead of silently accepting unsafe writes', () => {
    expect(() => openBrowserWorkspace(window.localStorage, undefined)).toThrow('Web Locks')
  })
  it('preserves a corrupt file until an explicit reset and refuses a stale reset', async () => {
    window.localStorage.setItem(workspaceStorageKey, '{damaged')
    expect(() => openBrowserWorkspace(window.localStorage, locks)).toThrow()
    expect(window.localStorage.getItem(workspaceStorageKey)).toBe('{damaged')
    await expect(resetBrowserWorkspace(window.localStorage, locks, '{older')).rejects.toThrow('changed')
    expect(window.localStorage.getItem(workspaceStorageKey)).toBe('{damaged')
    await resetBrowserWorkspace(window.localStorage, locks, '{damaged')
    const reopened = openBrowserWorkspace(window.localStorage, locks)
    expect(reopened.store.read().version).toBeGreaterThan(0)
    expect(reopened.store.recoveryEpoch).toBe(reopened.store.read().version)
    expect(reopened.store.read().data.issues[0]?.revision).toBe(reopened.store.read().version)
    window.localStorage.removeItem(workspaceStorageKey)
  })
})
