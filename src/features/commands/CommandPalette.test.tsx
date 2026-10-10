import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { CommandPalette } from './CommandPalette'
import { AppProviders } from '../../app/providers/AppProviders'
import { createAtlasQueryClient } from '../../app/query-client'
import { createAppServices } from '../../app/services'
import {
  createAtlasFixtures,
  InMemoryDataStore,
  SimulatedNetwork,
} from '../../data'
import {
  issueWorkspaceDefaults,
  type IssueWorkspaceState,
} from '../issues/issue-workspace-state'
import type { UserId } from '../../domain'
import {
  MemoryPreferenceStorage,
  type PreferenceStorage,
} from '../../preferences'
import { render, screen, waitFor } from '../../test/render'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

interface RenderPaletteOptions {
  readonly actorId?: UserId
  readonly dataStore?: InMemoryDataStore
  readonly preferenceStorage?: PreferenceStorage
  readonly savedViewState?: IssueWorkspaceState
  readonly simulator?: SimulatedNetwork
}

function renderPalette(options: RenderPaletteOptions = {}) {
  const services = createAppServices({
    ...(options.actorId ? { actorId: options.actorId } : {}),
    ...(options.dataStore ? { dataStore: options.dataStore } : {}),
    ...(options.preferenceStorage
      ? { preferenceStorage: options.preferenceStorage }
      : {}),
    ...(options.simulator ? { simulator: options.simulator } : {}),
  })
  if (options.savedViewState) {
    services.preferences.saveIssueView('Urgent queue', {
      ...options.savedViewState,
    })
  }

  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <div className="app-shell">
        <button
          type="button"
          onClick={() => {
            setOpen(true)
          }}
        >
          Commands
        </button>
        {open ? (
          <CommandPalette
            onClose={() => {
              setOpen(false)
            }}
          />
        ) : null}
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </div>
    )
  }

  render(
    <AppProviders queryClient={createAtlasQueryClient()} services={services}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </AppProviders>,
  )
  return services
}

describe('CommandPalette', () => {
  it('filters commands and executes the active result with the keyboard', async () => {
    const user = userEvent.setup()
    renderPalette()
    const input = screen.getByRole('combobox', { name: 'Search commands' })

    expect(input).toHaveFocus()
    await user.type(input, 'kanban')
    expect(screen.getByRole('option', { name: /Go to board.*Navigation/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/board')
  })

  it('includes private saved views and permission-allowed actions', async () => {
    const user = userEvent.setup()
    renderPalette({
      savedViewState: { ...issueWorkspaceDefaults, priority: 'urgent' },
    })
    const input = screen.getByRole('combobox', { name: 'Search commands' })

    expect(screen.getByRole('option', { name: /Create issue.*Actions/ })).toBeVisible()
    await user.type(input, 'urgent queue')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/issues?priority=urgent',
      )
    })
  })

  it('omits issue creation for a read-only actor', () => {
    const fixtures = createAtlasFixtures()
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    if (!viewerId) throw new Error('Expected viewer fixture.')

    renderPalette({ actorId: viewerId })

    expect(
      screen.queryByRole('option', { name: /Create issue.*Actions/ }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(4)
  })

  it('repairs stale saved-view workflow filters before navigating', async () => {
    const user = userEvent.setup()
    const fixtures = createAtlasFixtures()
    const dataStore = new InMemoryDataStore(fixtures)
    const preferenceStorage = new MemoryPreferenceStorage()
    const project = fixtures.projects.find(({ key }) => key === 'OPS')
    const statuses = fixtures.workflowStatuses
      .filter(({ projectId }) => projectId === project?.id)
      .sort((left, right) => left.order - right.order)
    const active = statuses.find(({ name }) => name === 'In progress')
    const retired = statuses.find(({ name }) => name === 'Done')
    if (!project || !active || !retired) {
      throw new Error('Expected launch workflow fixtures.')
    }
    const bootstrap = createAppServices({ dataStore, preferenceStorage })
    bootstrap.preferences.saveIssueView('Completed launch', {
      ...issueWorkspaceDefaults,
      projectId: project.id,
      statusId: retired.id,
    })
    await bootstrap.gateway.updateProjectWorkflow({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      statuses: [
        ...statuses
          .filter(({ id }) => id !== retired.id)
          .map(({ id, name, category }) => ({ id, name, category })),
        { id: null, name: 'Verified', category: 'completed' },
      ],
      migrations: [{ statusId: retired.id, reassignToStatusId: active.id }],
    })

    const services = renderPalette({ dataStore, preferenceStorage })
    await user.type(
      screen.getByRole('combobox', { name: 'Search commands' }),
      'completed launch',
    )
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/issues?project=${project.id}`,
      )
    })
    expect(screen.getByTestId('location')).not.toHaveTextContent('status=')
    expect(services.preferences.getSnapshot().savedIssueViews[0]?.state)
      .toMatchObject({ projectId: project.id, statusId: null })
  })

  it('keeps the palette available when saved-view metadata cannot load', async () => {
    const user = userEvent.setup()
    renderPalette({
      savedViewState: { ...issueWorkspaceDefaults, priority: 'urgent' },
      simulator: new SimulatedNetwork({
        failure: (operation) =>
          operation === 'issue.filter-metadata'
            ? 'Workflow filters could not be loaded.'
            : null,
      }),
    })
    const input = screen.getByRole('combobox', { name: 'Search commands' })
    await user.type(input, 'urgent queue')
    await user.keyboard('{Enter}')

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent('Workflow filters could not be loaded.')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(input).toBeEnabled()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  it('prevents dismissal while an asynchronous saved-view command is pending', async () => {
    const user = userEvent.setup()
    renderPalette({
      savedViewState: { ...issueWorkspaceDefaults, priority: 'urgent' },
      simulator: new SimulatedNetwork({
        latency: (operation) =>
          operation === 'issue.filter-metadata' ? 300 : 0,
      }),
    })
    await user.type(
      screen.getByRole('combobox', { name: 'Search commands' }),
      'urgent queue',
    )
    await user.keyboard('{Enter}')

    expect(
      screen.getByText('Opening Open saved view: Urgent queue…'),
    ).toHaveAttribute('role', 'status')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: 'Search commands' }),
    ).toBeDisabled()

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/issues?priority=urgent',
    )
  })
})
