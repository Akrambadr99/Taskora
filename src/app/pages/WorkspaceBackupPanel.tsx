import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { backupByteLimit, type WorkspaceRecoveryPreview } from '../../data'
import { ModalDialog } from '../../components/dialog/ModalDialog'
import { useAppServices } from '../providers/app-services-context'
import { useAuthorization } from '../providers/authorization-context'

export function WorkspaceBackupPanel() {
  const { gateway, workspaceId } = useAppServices()
  const authorization = useAuthorization()
  const queryClient = useQueryClient()
  const headingId = useId()
  const dialogId = useId()
  const request = useRef<AbortController | null>(null)
  const previewButton = useRef<HTMLButtonElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<WorkspaceRecoveryPreview | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => () => { request.current?.abort() }, [])

  async function run(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setStatus('')
    try { await action(controller.signal) } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Backup operation failed. Try again.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function closePreview(): void {
    if (busy) return
    setPreview(null); setError('')
    // The trigger is disabled during validation, so the dialog cannot capture its focus.
    window.setTimeout(() => { previewButton.current?.focus() }, 0)
  }

  function download(): void {
    void run(async (signal) => {
      const content = await gateway.exportWorkspaceBackup(workspaceId, { signal })
      if (signal.aborted) return
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `taskora-${workspaceId}-backup.json`
      document.body.append(link); link.click(); link.remove()
      window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
      setStatus('Workspace backup downloaded.')
    })
  }

  function inspect(): void {
    if (!file) return
    setPreview(null); setConfirmation('')
    void run(async (signal) => {
      if (file.size > backupByteLimit) throw new Error('Choose a backup no larger than 10 MiB.')
      const content = await file.text()
      if (signal.aborted) return
      const result = await gateway.previewWorkspaceRecovery(workspaceId, content, { signal })
      if (request.current?.signal.aborted !== true) setPreview(result)
    })
  }

  function restore(): void {
    if (!preview) return
    void run(async (signal) => {
      await queryClient.cancelQueries()
      await gateway.restoreWorkspaceBackup({ workspaceId, token: preview.token, confirmation }, { signal })
      if (signal.aborted) return
      setPreview(null); setConfirmation('')
      setStatus('Workspace restored. Current workspace views have been refreshed.')
      await queryClient.resetQueries()
    })
  }

  return <section className="settings-panel backup-panel" aria-labelledby={headingId}>
    <h2 id={headingId}>Workspace backup and recovery</h2>
    <p>Download workspace data and history as a versioned JSON file. Keep backups private: they contain member details and comments. Device preferences are separate.</p>
    <p>Recovery replaces workspace content. Existing user profiles and audit records are retained. Until browser persistence is enabled, workspace data resets on reload.</p>
    {authorization.can('members:manage') ? <>
      <button className="secondary-button" type="button" disabled={busy} onClick={download}>Download workspace backup</button>
      <label className="settings-field"><span>Workspace backup file</span>
        <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
          setFile(event.currentTarget.files?.[0] ?? null); setPreview(null); setConfirmation(''); setError(''); setStatus('')
        }} />
      </label>
      <p>JSON files up to 10 MiB. A preview expires after ten minutes or any workspace edit.</p>
      <button ref={previewButton} className="primary-button" type="button" disabled={busy || !file} onClick={inspect}>Preview recovery</button>
    </> : <p>Only workspace owners and admins can export or recover workspace data.</p>}
    {busy && !preview ? <p role="status">Processing workspace backup...</p> : null}
    {error && !preview ? <p role="alert">{error}</p> : null}
    {status ? <p role="status">{status}</p> : null}
    {preview ? <ModalDialog titleId={dialogId} onRequestClose={closePreview}>
      <h2 id={dialogId}>Confirm workspace recovery</h2>
      <p>Backup exported {preview.exportedAt}. Review the replacement before continuing.</p>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to scroll the preview table. */}
      <div className="backup-preview-scroll" tabIndex={0} role="region" aria-label="Recovery changes">
        <table><caption>Workspace recovery changes</caption>
          <thead><tr><th scope="col">Collection</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Added</th><th scope="col">Removed</th><th scope="col">Changed</th></tr></thead>
          <tbody>{preview.changes.map((row) => <tr key={row.collection}><th scope="row">{row.collection}</th><td>{row.before}</td><td>{row.after}</td><td>{row.added}</td><td>{row.removed}</td><td>{row.changed}</td></tr>)}</tbody>
        </table>
      </div>
      <p>This replaces data in {preview.workspaceName}. Download a current backup first if you may need to undo the replacement. Restored revisions will advance.</p>
      <label className="settings-field"><span>Type {preview.workspaceName} to confirm</span>
        <input value={confirmation} disabled={busy} autoComplete="off" onChange={(event) => { setConfirmation(event.currentTarget.value) }} />
      </label>
      {error ? <p role="alert">{error} Cancel and preview again if the workspace changed.</p> : null}
      {busy ? <p role="status">Restoring workspace...</p> : null}
      <div className="backup-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={closePreview}>Cancel recovery</button>
        <button type="button" className="primary-button" disabled={busy || confirmation !== preview.workspaceName} onClick={restore}>Replace workspace data</button>
      </div>
    </ModalDialog> : null}
  </section>
}
