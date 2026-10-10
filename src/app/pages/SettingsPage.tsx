import { WorkspaceBackupPanel } from './WorkspaceBackupPanel'
import { useState, type ChangeEvent } from 'react'

import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '../../features/notifications/notification-preference-queries'
import {
  issuePageSizes,
  PreferencePersistenceError,
  useUserPreferences,
  type IssuePageSize,
} from '../../preferences'
import { hasAppErrorKind } from '../errors/classify-app-error'
import { useAppServices } from '../providers/app-services-context'
import './pages.css'

export function SettingsPage() {
  const services = useAppServices()
  const localPreferences = useUserPreferences()
  const notificationPreferences = useNotificationPreferences()
  const updateNotifications = useUpdateNotificationPreferences()
  const [status, setStatus] = useState('')
  const [localError, setLocalError] = useState('')

  const changeNotificationPreference = (
    key: 'assignments' | 'comments' | 'issueUpdates' | 'projectUpdates',
    enabled: boolean,
  ): void => {
    const current = notificationPreferences.data
    if (!current) return
    setStatus('')
    updateNotifications.mutate(
      {
        workspaceId: current.workspaceId,
        expectedRevision: current.revision,
        assignments: key === 'assignments' ? enabled : current.assignments,
        comments: key === 'comments' ? enabled : current.comments,
        issueUpdates: key === 'issueUpdates' ? enabled : current.issueUpdates,
        projectUpdates: key === 'projectUpdates' ? enabled : current.projectUpdates,
      },
      {
        onSuccess: () => {
          setStatus('Notification preferences saved.')
        },
        onError: (error) => {
          setStatus(
            hasAppErrorKind(error, 'conflict')
              ? 'Preferences changed elsewhere. Current settings were restored; try again.'
              : 'Notification preferences could not be saved.',
          )
        },
      },
    )
  }

  const changePageSize = (event: ChangeEvent<HTMLSelectElement>): void => {
    const pageSize = parsePageSize(event.currentTarget.value)
    setLocalError('')
    try {
      services.preferences.setIssuePageSize(pageSize)
      setStatus('Device preferences saved.')
    } catch (error) {
      setLocalError(
        error instanceof PreferencePersistenceError
          ? error.message
          : 'Device preferences could not be saved.',
      )
    }
  }

  return (
    <section className="page" aria-labelledby="settings-title">
      <header className="page-header">
        <p className="page-eyebrow">Personal configuration</p>
        <h1 id="settings-title">Settings</h1>
        <p>Manage authoritative notification delivery and device preferences.</p>
      </header>

      <div className="settings-grid">
        <section className="settings-panel" aria-labelledby="notification-settings-title">
          <div>
            <p className="page-eyebrow">Workspace delivery</p>
            <h2 id="notification-settings-title">Notification preferences</h2>
            <p>Choose which events create new inbox notifications for you.</p>
          </div>
          {notificationPreferences.isPending ? (
            <p role="status">Loading notification preferences…</p>
          ) : null}
          {notificationPreferences.isError ? (
            <div role="alert">
              <p>Notification preferences are unavailable.</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void notificationPreferences.refetch()}
              >
                Retry preferences
              </button>
            </div>
          ) : null}
          {notificationPreferences.isSuccess ? (
            <fieldset disabled={updateNotifications.isPending}>
              <legend className="visually-hidden">Notification event delivery</legend>
              <PreferenceToggle
                label="Issue assignments"
                description="Notify me when an issue is assigned to me."
                checked={notificationPreferences.data.assignments}
                onChange={(enabled) => {
                  changeNotificationPreference('assignments', enabled)
                }}
              />
              <PreferenceToggle
                label="New comments"
                description="Notify me when someone comments on my assigned work."
                checked={notificationPreferences.data.comments}
                onChange={(enabled) => {
                  changeNotificationPreference('comments', enabled)
                }}
              />
              <PreferenceToggle
                label="Issue updates"
                description="Notify me when assigned issue details or workflow change."
                checked={notificationPreferences.data.issueUpdates}
                onChange={(enabled) => {
                  changeNotificationPreference('issueUpdates', enabled)
                }}
              />
              <PreferenceToggle
                label="Project updates"
                description="Notify me when a watched project's details, workflow, or lifecycle change."
                checked={notificationPreferences.data.projectUpdates}
                onChange={(enabled) => {
                  changeNotificationPreference('projectUpdates', enabled)
                }}
              />
            </fieldset>
          ) : null}
          {updateNotifications.isError ? <p role="alert">{status}</p> : null}
        </section>

        <section className="settings-panel" aria-labelledby="device-settings-title">
          <div>
            <p className="page-eyebrow">This browser</p>
            <h2 id="device-settings-title">Device preferences</h2>
            <p>These settings are versioned and stored only for this signed-in user.</p>
          </div>
          <label className="settings-field">
            <span>Issues per page</span>
            <select value={localPreferences.issuePageSize} onChange={changePageSize}>
              {issuePageSizes.map((pageSize) => (
                <option key={pageSize} value={pageSize}>{pageSize}</option>
              ))}
            </select>
          </label>
          <dl className="settings-summary">
            <div><dt>Dashboard metrics</dt><dd>{localPreferences.dashboardWidgets.length}</dd></div>
            <div><dt>Saved issue views</dt><dd>{localPreferences.savedIssueViews.length}</dd></div>
          </dl>
          {localError ? <p role="alert">{localError}</p> : null}
        </section>
      </div>

      <WorkspaceBackupPanel />

      {status && !updateNotifications.isError ? (
        <p className="mutation-status" role="status">{status}</p>
      ) : null}
    </section>
  )
}

function PreferenceToggle({
  checked,
  description,
  label,
  onChange,
}: Readonly<{
  checked: boolean
  description: string
  label: string
  onChange(enabled: boolean): void
}>) {
  return (
    <label className="settings-toggle">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => {
          onChange(event.currentTarget.checked)
        }}
      />
    </label>
  )
}

function parsePageSize(value: string): IssuePageSize {
  const pageSize = Number(value)
  const parsed = issuePageSizes.find((candidate) => candidate === pageSize)
  if (!parsed) throw new TypeError('Unsupported issue page size.')
  return parsed
}
