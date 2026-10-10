import { useCallback, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { AppProviders } from './app/providers/AppProviders'
import { browserRouter } from './app/router'
import { openBrowserWorkspace } from './app/browser-workspace'
import { WorkspaceSynchronization } from './app/providers/WorkspaceSynchronization'
import { StorageRecoveryPage, type StorageFailure } from './app/pages/StorageRecoveryPage'
import { workspaceStorageKey } from './data'
import { createAtlasQueryClient } from './app/query-client'

type BrowserState = { readonly workspace: ReturnType<typeof openBrowserWorkspace>; readonly failure: null } |
  { readonly workspace: null; readonly failure: StorageFailure }

function storageFailure(error: unknown): StorageFailure {
  let raw: string | null | undefined
  try { raw = window.localStorage.getItem(workspaceStorageKey) } catch { raw = undefined }
  return { raw, message: error instanceof Error ? error.message : 'Workspace storage could not be opened.' }
}
function open(): BrowserState {
  try { return { workspace: openBrowserWorkspace(window.localStorage, (navigator as Partial<Navigator>).locks), failure: null } }
  catch (error) { return { workspace: null, failure: storageFailure(error) } }
}

function App() {
  const [state, setState] = useState(open)
  const [queryClient, setQueryClient] = useState(createAtlasQueryClient)
  const onFailure = useCallback((error: unknown) => {
    void queryClient.cancelQueries()
    queryClient.clear()
    setState({ workspace: null, failure: storageFailure(error) })
  }, [queryClient])
  if (state.failure) return <StorageRecoveryPage failure={state.failure} onRetry={() => {
    setQueryClient(createAtlasQueryClient()); setState(open())
  }} />
  return <AppProviders services={state.workspace.services} queryClient={queryClient}>
    <WorkspaceSynchronization store={state.workspace.store} onFailure={onFailure} />
    <RouterProvider router={browserRouter} />
  </AppProviders>
}

export default App
