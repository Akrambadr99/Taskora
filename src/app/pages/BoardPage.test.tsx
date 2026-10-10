import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { BoardPage } from './BoardPage'
import { AppProviders } from '../providers/AppProviders'
import { createAtlasQueryClient } from '../query-client'
import { createAppServices } from '../services'
import {
  createAtlasFixtures,
  InMemoryDataStore,
  SimulatedNetwork,
} from '../../data'
import { issueId, type UserId } from '../../domain'
import { fireEvent, render, screen, waitFor, within } from '../../test/render'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function renderBoard(
  path = '/board',
  simulator = new SimulatedNetwork(),
  actorId?: UserId,
  dataStore?: InMemoryDataStore,
) {
  const services = createAppServices({
    simulator,
    ...(actorId ? { actorId } : {}),
    ...(dataStore ? { dataStore } : {}),
  })

  return {
    services,
    ...render(
      <AppProviders
        queryClient={createAtlasQueryClient()}
        services={services}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/board"
              element={
                <>
                  <BoardPage />
                  <LocationProbe />
                </>
              }
            />
            <Route path="/issues/:issueId" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    ),
  }
}

function getColumn(name: string): HTMLElement {
  const column = screen.getByRole('heading', { level: 2, name }).closest('section')
  if (!column) throw new Error(`Expected the ${name} board column.`)
  return column
}

describe('BoardPage', () => {
  it('canonicalizes project selection in the URL and renders configured columns', async () => {
    const user = userEvent.setup()
    renderBoard()

    expect(screen.getByText('Loading project workflows…')).toBeVisible()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Investigating' }),
    ).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue(
      screen.getByRole('option', { name: 'Field reliability' }).getAttribute('value'),
    )
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('project=prj_')
    })
    expect(
      within(getColumn('Investigating')).getByText(
        'Close the device telemetry coverage gap',
      ),
    ).toBeVisible()
    expect(within(getColumn('Triage')).getByLabelText('1 loaded issue')).toBeVisible()

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Project' }),
      screen.getByRole('option', { name: 'Launch readiness' }),
    )

    expect(
      await screen.findByRole('heading', { level: 2, name: 'In progress' }),
    ).toBeVisible()
    expect(screen.getByTestId('location')).toHaveTextContent('project=prj_')
    expect(
      within(getColumn('In progress')).getByText('Publish the launch readiness brief'),
    ).toBeVisible()
  })

  it('moves an issue with a keyboard-native control and records activity', async () => {
    const user = userEvent.setup()
    const { services } = renderBoard()
    const moveControl = await screen.findByRole('combobox', {
      name: 'Move Close the device telemetry coverage gap',
    })
    const issue = createAtlasFixtures().issues.find(
      ({ title }) => title === 'Close the device telemetry coverage gap',
    )

    await user.selectOptions(
      moveControl,
      within(moveControl).getByRole('option', { name: 'Resolved' }),
    )

    expect(
      await screen.findByText(
        'Close the device telemetry coverage gap moved to Resolved.',
      ),
    ).toBeVisible()
    expect(
      within(getColumn('Resolved')).getByText(
        'Close the device telemetry coverage gap',
      ),
    ).toBeVisible()

    if (!issue) throw new Error('Expected reliability issue fixture.')
    const activity = await services.gateway.getIssueActivity(issue.id)
    expect(activity.activityEvents[0]).toMatchObject({
      action: 'issue.status_changed',
      summary: 'Moved from Investigating to Resolved.',
    })
  })

  it('restores a blocked completion and explains the prerequisite to keyboard users', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Project' }),
      screen.getByRole('option', { name: 'Launch readiness' }),
    )
    const moveControl = await screen.findByRole('combobox', {
      name: 'Move Complete launch risk review',
    })
    await user.selectOptions(moveControl, within(moveControl).getByRole('option', { name: 'Done' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Complete OPS-1 before moving dependent work to a completed stage.',
    )
    await waitFor(() => {
      expect(moveControl).toHaveValue(
        within(moveControl).getByRole('option', { name: 'Backlog' }).getAttribute('value'),
      )
    })
  })

  it('moves an issue with a pointer drag and restores focus to its handle', async () => {
    renderBoard()
    const issue = createAtlasFixtures().issues.find(
      ({ title }) => title === 'Close the device telemetry coverage gap',
    )
    if (!issue) throw new Error('Expected reliability issue fixture.')
    const handle = await screen.findByRole('button', {
      name: 'Drag Close the device telemetry coverage gap',
    })
    const targetColumn = getColumn('Resolved')
    const setData = vi.fn()
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn(() => issue.id),
      setData,
    } as unknown as DataTransfer

    fireEvent.dragStart(handle, { dataTransfer })
    fireEvent.dragOver(targetColumn, { dataTransfer })
    expect(targetColumn).toHaveAttribute('data-drag-target', 'true')
    fireEvent.drop(targetColumn, { dataTransfer })

    expect(
      await screen.findByText(
        'Close the device telemetry coverage gap moved to Resolved.',
      ),
    ).toBeVisible()
    const restoredHandle = within(getColumn('Resolved')).getByRole('button', {
      name: 'Drag Close the device telemetry coverage gap',
    })
    await waitFor(() => {
      expect(restoredHandle).toHaveFocus()
    })
    expect(setData).toHaveBeenCalledWith('text/plain', issue.id)
  })

  it('rolls back a pointer drop after a revision conflict and restores focus', async () => {
    const { services } = renderBoard()
    const issue = createAtlasFixtures().issues.find(
      ({ title }) => title === 'Close the device telemetry coverage gap',
    )
    if (!issue) throw new Error('Expected reliability issue fixture.')
    const handle = await screen.findByRole('button', {
      name: 'Drag Close the device telemetry coverage gap',
    })
    await services.gateway.updateIssue({
      id: issue.id,
      expectedRevision: issue.revision,
      changes: { priority: 'low' },
    })
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      getData: vi.fn(() => issue.id),
      setData: vi.fn(),
    } as unknown as DataTransfer

    fireEvent.dragStart(handle, { dataTransfer })
    fireEvent.dragOver(getColumn('Resolved'), { dataTransfer })
    fireEvent.drop(getColumn('Resolved'), { dataTransfer })

    expect(
      await screen.findByText(
        'Close the device telemetry coverage gap changed elsewhere. The latest board state has been restored.',
      ),
    ).toBeVisible()
    const restoredHandle = within(getColumn('Investigating')).getByRole('button', {
      name: 'Drag Close the device telemetry coverage gap',
    })
    await waitFor(() => {
      expect(restoredHandle).toHaveFocus()
    })
    expect(
      within(getColumn('Resolved')).queryByText(
        'Close the device telemetry coverage gap',
      ),
    ).not.toBeInTheDocument()
  })

  it('rolls back an optimistic move when the gateway fails', async () => {
    const user = userEvent.setup()
    const simulator = new SimulatedNetwork({
      latency: (operation) => (operation === 'issue.update' ? 25 : 0),
      failure: (operation) =>
        operation === 'issue.update' ? 'The move could not be saved.' : null,
    })
    renderBoard('/board', simulator)
    const moveControl = await screen.findByRole('combobox', {
      name: 'Move Close the device telemetry coverage gap',
    })

    await user.selectOptions(
      moveControl,
      within(moveControl).getByRole('option', { name: 'Resolved' }),
    )

    expect(
      await screen.findByText(
        'Close the device telemetry coverage gap could not be moved. Its previous status has been restored.',
      ),
    ).toBeVisible()
    expect(
      within(getColumn('Investigating')).getByText(
        'Close the device telemetry coverage gap',
      ),
    ).toBeVisible()
    expect(moveControl).toHaveValue(
      within(moveControl)
        .getByRole('option', { name: 'Investigating' })
        .getAttribute('value'),
    )
  })

  it('keeps workflow context visible while disabling moves for viewers', async () => {
    const fixtures = createAtlasFixtures()
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    if (!viewerId) throw new Error('Expected viewer fixture.')

    renderBoard('/board', new SimulatedNetwork(), viewerId)

    expect(
      await screen.findByText('Close the device telemetry coverage gap'),
    ).toBeVisible()
    expect(
      screen.getByRole('combobox', {
        name: 'Move Close the device telemetry coverage gap',
      }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', {
        name: 'Drag Close the device telemetry coverage gap',
      }),
    ).toBeDisabled()
    expect(
      screen.getByText(/use its status menu as a keyboard-accessible alternative/i),
    ).toBeVisible()
  })

  it('offers recovery when workflow metadata fails to load', async () => {
    const user = userEvent.setup()
    const simulator = new SimulatedNetwork({
      failure: (operation, requestId) =>
        operation === 'board.metadata' && requestId === 'req_000001'
          ? 'Temporary metadata failure.'
          : null,
    })
    renderBoard('/board', simulator)

    expect(await screen.findByText('Project workflows are unavailable.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry board' }))
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Investigating' }),
    ).toBeVisible()
  })

  it('progressively loads large project boards across server pages', async () => {
    const user = userEvent.setup()
    const fixtures = createAtlasFixtures()
    const project = fixtures.projects.find(({ name }) => name === 'Launch readiness')
    const template = fixtures.issues.find(({ projectId }) => projectId === project?.id)
    if (!project || !template) throw new Error('Expected launch project fixtures.')
    const additionalIssues = Array.from({ length: 48 }, (_, index) => ({
      ...template,
      id: issueId(`issue_board_scale_${String(index + 4).padStart(3, '0')}`),
      number: index + 4,
      title: `Scaled board issue ${String(index + 4)}`,
      parentIssueId: null,
      labelIds: [],
    }))
    const dataStore = new InMemoryDataStore({
      ...fixtures,
      issues: [...fixtures.issues, ...additionalIssues],
    })

    renderBoard(
      `/board?project=${project.id}`,
      new SimulatedNetwork(),
      undefined,
      dataStore,
    )

    expect(await screen.findByText('Showing 50 of 51 issues.')).toBeVisible()
    expect(screen.getAllByRole('article')).toHaveLength(50)
    await user.click(screen.getByRole('button', { name: 'Load more issues' }))
    expect(await screen.findByText('Scaled board issue 51')).toBeVisible()
    expect(screen.getAllByRole('article')).toHaveLength(51)
    expect(screen.getByText('Showing 51 of 51 issues.')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Load more issues' }),
    ).not.toBeInTheDocument()
  })
})
