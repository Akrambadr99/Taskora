import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { IssueRelationshipsPanel } from './IssueRelationshipsPanel'
import { AppProviders } from '../../app/providers/AppProviders'
import { createAtlasQueryClient } from '../../app/query-client'
import { createAppServices } from '../../app/services'
import { createAtlasFixtures, InMemoryDataStore, SimulatedNetwork } from '../../data'
import { render, screen, waitFor, within } from '../../test/render'

function setup(canEdit = true, simulator = new SimulatedNetwork()) {
  const seed = createAtlasFixtures()
  const issue = seed.issues[0]
  if (!issue) throw new Error('Expected fixture issue.')
  const target = seed.issues.find((candidate) => candidate.id !== issue.id && candidate.projectId === issue.projectId)
  if (!target) throw new Error('Expected target issue.')
  const store = new InMemoryDataStore({ ...seed, issueRelations: [], issues: seed.issues.map((entry) => ({ ...entry, parentIssueId: null })) })
  const services = createAppServices({ dataStore: store, simulator })
  const queryClient = createAtlasQueryClient()
  render(<AppProviders queryClient={queryClient} services={services}>
    <MemoryRouter><IssueRelationshipsPanel issueId={issue.id} canEdit={canEdit} /></MemoryRouter>
  </AppProviders>)
  return { issue, target, store, services, queryClient }
}

describe('IssueRelationshipsPanel', () => {
  it('adds a directed blocker and removes it using refreshed endpoint revisions', async () => {
    const user = userEvent.setup()
    const { target, store } = setup()
    await screen.findByText('No linked issues.')
    await user.selectOptions(screen.getByLabelText('Target issue'), target.id)
    await user.click(screen.getByRole('button', { name: 'Add relationship' }))
    await screen.findByText('Relationships saved.')
    const links = screen.getByRole('list', { name: 'Linked issues' })
    expect(within(links).getByText(/Blocks:/)).toBeVisible()
    expect(within(links).getByRole('link', { name: target.title })).toHaveAttribute('href', `/issues/${target.id}`)
    expect(store.read().data.issueRelations).toHaveLength(1)
    await user.click(within(links).getByRole('button', { name: `Remove blocks ${target.title}` }))
    await screen.findByText('No linked issues.')
    expect(store.read().data.issueRelations).toEqual([])
  })

  it('changes and clears an issue parent', async () => {
    const user = userEvent.setup()
    const { target, issue, store } = setup()
    await screen.findByLabelText('Parent issue')
    await user.selectOptions(screen.getByLabelText('Parent issue'), target.id)
    await user.click(screen.getByRole('button', { name: 'Save parent' }))
    await screen.findByText('Relationships saved.')
    expect(store.read().data.issues.find(({ id }) => id === issue.id)?.parentIssueId).toBe(target.id)
    await user.selectOptions(screen.getByLabelText('Parent issue'), '')
    await user.click(screen.getByRole('button', { name: 'Save parent' }))
    await waitFor(() => { expect(store.read().data.issues.find(({ id }) => id === issue.id)?.parentIssueId).toBeNull() })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Save parent' })).toBeDisabled() })
  })

  it('shows a stale-write error and refreshes before a deliberate retry', async () => {
    const user = userEvent.setup()
    const { target, store } = setup()
    await screen.findByLabelText('Target issue')
    await user.selectOptions(screen.getByLabelText('Target issue'), target.id)
    const current = store.read()
    store.commit(current.version, { ...current.data, issues: current.data.issues.map((issue) =>
      issue.id === target.id ? { ...issue, revision: issue.revision + 1 } : issue) })
    await user.click(screen.getByRole('button', { name: 'Add relationship' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('An issue changed.')
    expect(store.read().data.issueRelations).toHaveLength(0)
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Refresh relationships' })).toBeEnabled() })
    await user.click(screen.getByRole('button', { name: 'Refresh relationships' }))
    await waitFor(() => { expect(screen.queryByRole('alert')).not.toBeInTheDocument() })
    await user.selectOptions(screen.getByLabelText('Target issue'), target.id)
    await user.click(screen.getByRole('button', { name: 'Add relationship' }))
    await screen.findByText('Relationships saved.')
    expect(store.read().data.issueRelations).toHaveLength(1)
  })

  it('does not expose write controls in read-only mode', async () => {
    setup(false)
    expect(await screen.findByText('Relationships are read-only.')).toBeVisible()
    expect(screen.queryByRole('form', { name: 'Add issue relationship' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Change issue parent' })).not.toBeInTheDocument()
  })

  it('recovers a failed relationship read without leaving a writable stale form', async () => {
    let offline = true
    const user = userEvent.setup()
    setup(true, new SimulatedNetwork({ failure: (operation) =>
      operation === 'issue.relationships.get' && offline ? 'offline' : null }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load relationships')
    expect(screen.queryByLabelText('Target issue')).not.toBeInTheDocument()
    offline = false
    await user.click(screen.getByRole('button', { name: 'Refresh relationships' }))
    expect(await screen.findByLabelText('Target issue')).toBeEnabled()
  })

  it('reports a failed mutation and preserves the graph', async () => {
    const user = userEvent.setup()
    const { target, store } = setup(true, new SimulatedNetwork({ failure: (operation) =>
      operation === 'issue.relation.create' ? 'Service unavailable.' : null }))
    await screen.findByLabelText('Target issue')
    await user.selectOptions(screen.getByLabelText('Target issue'), target.id)
    await user.click(screen.getByRole('button', { name: 'Add relationship' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable.')
    expect(store.read().data.issueRelations).toHaveLength(0)
  })
})
