import { BrowserWorkspacePersistence, InMemoryDataStore, createAtlasFixtures, encodeStoredSnapshot, workspaceStorageKey, type WorkspaceLocks, type WorkspaceStorage } from '../data'
import { createAppServices } from './services'
import { BrowserPreferenceStorage } from '../preferences/storage'

export function openBrowserWorkspace(storage: Storage, locks: WorkspaceLocks | undefined) {
  if (!locks) throw new Error('This browser does not support safe cross-tab storage. Open Taskora in a browser with Web Locks enabled.')
  const seed = createAtlasFixtures()
  const actorId = seed.memberships.find((row) => row.role === 'admin' && row.status === 'active')?.userId
  if (!actorId) throw new Error('The local application requires its configured actor.')
  const store = new InMemoryDataStore(seed, new BrowserWorkspacePersistence(storage, locks))
  const services = createAppServices({ actorId, dataStore: store, preferenceStorage: new BrowserPreferenceStorage(storage) })
  return { store, services }
}

export async function resetBrowserWorkspace(storage: WorkspaceStorage, locks: WorkspaceLocks, expectedRaw: string | null): Promise<void> {
  await locks.request(workspaceStorageKey, () => {
    if (storage.getItem(workspaceStorageKey) !== expectedRaw) throw new Error('Saved data changed since this recovery screen opened. Retry loading before resetting.')
    const seed = createAtlasFixtures()
    const revision = Date.now()
    // A fresh revision range prevents pre-reset editors from matching the starter entities.
    const data = { ...seed,
      memberships: seed.memberships.map((row) => ({ ...row, revision })),
      workspaceInvitations: seed.workspaceInvitations.map((row) => ({ ...row, revision })),
      projects: seed.projects.map((row) => ({ ...row, revision })),
      issues: seed.issues.map((row) => ({ ...row, revision })),
      comments: seed.comments.map((row) => ({ ...row, revision })),
      notificationPreferences: seed.notificationPreferences.map((row) => ({ ...row, revision })),
    }
    storage.setItem(workspaceStorageKey, encodeStoredSnapshot({ data, version: revision, recoveryEpoch: revision }))
  })
}
