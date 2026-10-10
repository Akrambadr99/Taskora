import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { workspaceStorageKey, type InMemoryDataStore } from '../../data'

export function WorkspaceSynchronization({ store, onFailure }: Readonly<{ store: InMemoryDataStore; onFailure(error: unknown): void }>) {
  const queryClient = useQueryClient()
  useEffect(() => {
    let mounted = true
    async function synchronize(): Promise<void> {
      const previous = store.read().version
      try {
        await store.exclusive(() => undefined)
        if (mounted && store.read().version !== previous) await queryClient.resetQueries()
      } catch (error) { if (mounted) onFailure(error) }
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.key === workspaceStorageKey || event.key === null) void synchronize()
    }
    const onFocus = (): void => { void synchronize() }
    const onVisibility = (): void => { if (document.visibilityState === 'visible') void synchronize() }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mounted = false
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [store, queryClient, onFailure])
  return null
}
