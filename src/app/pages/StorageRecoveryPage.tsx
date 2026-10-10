import { useState } from 'react'
import { resetBrowserWorkspace } from '../browser-workspace'

export interface StorageFailure { readonly message: string; readonly raw: string | null | undefined }

export function StorageRecoveryPage({ failure, onRetry }: Readonly<{ failure: StorageFailure; onRetry(): void }>) {
  const locks = (navigator as Partial<Navigator>).locks
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function download(): void {
    if (failure.raw === null || failure.raw === undefined) return
    const url = URL.createObjectURL(new Blob([failure.raw], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'taskora-damaged-workspace.json'
    document.body.append(link); link.click(); link.remove()
    window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
  }
  async function reset(): Promise<void> {
    if (confirmation !== 'RESET' || failure.raw === undefined || !locks) return
    setBusy(true); setError('')
    try {
      await resetBrowserWorkspace(window.localStorage, locks, failure.raw)
      onRetry()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Local reset failed. Saved data was not cleared.')
    } finally { setBusy(false) }
  }
  return <main className="page" aria-labelledby="storage-recovery-title">
    <h1 id="storage-recovery-title">Workspace storage needs attention</h1>
    <p role="alert">{failure.message}</p>
    <p>Saved data has not been replaced. Download it before resetting. You can retry after fixing browser storage or opening a compatible application version.</p>
    <button type="button" className="secondary-button" disabled={failure.raw === null || failure.raw === undefined || busy} onClick={download}>Download saved data for recovery</button>
    <button type="button" className="secondary-button" disabled={busy} onClick={onRetry}>Retry loading workspace</button>
    <p>Reset replaces this browser’s saved workspace with starter data. After resetting, import a valid workspace backup in Settings. This cannot recover edits missing from your backup.</p>
    <label className="settings-field"><span>Type RESET to replace local workspace data</span>
      <input value={confirmation} disabled={busy} onChange={(event) => { setConfirmation(event.currentTarget.value) }} autoComplete="off" />
    </label>
    <button type="button" className="primary-button" disabled={busy || confirmation !== 'RESET' || failure.raw === undefined || !locks} onClick={() => { void reset() }}>Reset local workspace</button>
    {busy ? <p role="status">Resetting local workspace...</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </main>
}
