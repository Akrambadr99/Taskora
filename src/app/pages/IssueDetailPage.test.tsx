import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { IssueDetailPage } from './IssueDetailPage'
import { AppProviders } from '../providers/AppProviders'
import { createAtlasQueryClient } from '../query-client'
import { createAppServices } from '../services'
import {
  createAtlasFixtures,
  FixedClock,
  InMemoryDataStore,
  SimulatedNetwork,
  type Clock,
  type RequestSimulator,
} from '../../data'
import { isoDateTime, type UserId } from '../../domain'
import { fireEvent, render, screen, waitFor, within } from '../../test/render'

function getFixtureIssue() {
  const issue = createAtlasFixtures().issues[0]
  if (!issue) throw new Error('Expected a fixture issue.')
  return issue
}

function renderIssueDetail(
  path: string,
  actorId?: UserId,
  simulator: RequestSimulator = new SimulatedNetwork(),
  clock?: Clock,
  dataStore?: InMemoryDataStore,
) {
  const queryClient = createAtlasQueryClient()
  const services = createAppServices({
    simulator,
    ...(actorId ? { actorId } : {}),
    ...(clock ? { clock } : {}),
    ...(dataStore ? { dataStore } : {}),
  })
  render(
    <AppProviders queryClient={queryClient} services={services}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/issues/:issueId" element={<IssueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  )
  return { ...services, queryClient }
}

describe('IssueDetailPage', () => {
  it('renders archived project work as read-only across issue and comment controls', async () => {
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[0]
    if (!issue) throw new Error('Expected a fixture issue.')
    const store = new InMemoryDataStore({
      ...fixtures,
      projects: fixtures.projects.map((project) =>
        project.id === issue.projectId
          ? { ...project, status: 'archived' as const, revision: 2 }
          : project,
      ),
    })

    renderIssueDetail(
      `/issues/${issue.id}`,
      undefined,
      new SimulatedNetwork(),
      undefined,
      store,
    )
    await screen.findByRole(
      'heading',
      { name: issue.title },
      { timeout: 3_000 },
    )

    expect(
      screen.queryByRole('button', { name: 'Edit issue' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Read-only access')).toBeVisible()
    expect(
      screen.queryByRole('form', { name: 'Add comment' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit comment' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove comment' }),
    ).not.toBeInTheDocument()
  })

  it('loads a deep-linked issue and edits validated fields', async () => {
    const user = userEvent.setup()
    const issue = getFixtureIssue()
    const services = renderIssueDetail(`/issues/${issue.id}`)

    expect(screen.getByText('Loading issue…')).toBeVisible()
    expect(await screen.findByRole('heading', { name: issue.title })).toBeVisible()
    expect(screen.getByText('Launch readiness')).toBeVisible()
    expect(
      await screen.findByText(/include explicit rollback owners/i),
    ).toBeVisible()
    expect(screen.getByText(/Moved the launch brief into progress/i)).toBeVisible()

    const editButton = screen.getByRole('button', { name: 'Edit issue' })
    await user.click(editButton)
    const title = screen.getByLabelText('Title')
    expect(title).toHaveFocus()
    await user.clear(title)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('Enter an issue title.')).toBeVisible()

    await user.type(title, 'Publish the final launch brief')
    const status = screen.getByRole('combobox', { name: 'Status' })
    await waitFor(() => { expect(status).toBeEnabled() })
    await user.selectOptions(status, within(status).getByRole('option', { name: 'Done' }))
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Issue changes saved.')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Publish the final launch brief' }),
    ).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(editButton).toHaveFocus()
    const updatedIssue = await services.gateway.getIssue(issue.id)
    expect(updatedIssue.statusId).toBe(
      createAtlasFixtures().workflowStatuses.find(({ projectId, name }) =>
        projectId === issue.projectId && name === 'Done')?.id,
    )
  }, 10_000)

  it('keeps the issue editor open when an unfinished blocker rejects completion', async () => {
    const user = userEvent.setup()
    const issue = createAtlasFixtures().issues.find(({ title }) => title.includes('risk review'))
    if (!issue) throw new Error('Expected blocked issue fixture.')
    const services = renderIssueDetail(`/issues/${issue.id}`)

    await screen.findByRole('heading', { name: issue.title })
    await user.click(screen.getByRole('button', { name: 'Edit issue' }))
    const status = await screen.findByRole('combobox', { name: 'Status' })
    await waitFor(() => { expect(status).toBeEnabled() })
    await user.selectOptions(status, within(status).getByRole('option', { name: 'Done' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Complete OPS-1')
    expect(screen.getByRole('dialog', { name: 'Edit issue' })).toBeVisible()
    expect((await services.gateway.getIssue(issue.id)).statusId).toBe(issue.statusId)
  })

  it('refreshes after a revision conflict and preserves the draft for retry', async () => {
    const user = userEvent.setup()
    const fixtureIssue = getFixtureIssue()
    const services = renderIssueDetail(`/issues/${fixtureIssue.id}`)

    await screen.findByRole('heading', { name: fixtureIssue.title })
    await services.gateway.updateIssue({
      id: fixtureIssue.id,
      expectedRevision: fixtureIssue.revision,
      changes: { description: 'A concurrent editor changed this description.' },
    })

    await user.click(screen.getByRole('button', { name: 'Edit issue' }))
    const title = screen.getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Conflict-safe launch brief')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText(/changed elsewhere.*latest revision is loaded/i),
    ).toBeVisible()
    expect(title).toHaveValue('Conflict-safe launch brief')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Issue changes saved.')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Conflict-safe launch brief' }),
    ).toBeVisible()
  })

  it('rejects malformed branded issue identifiers without requesting data', async () => {
    renderIssueDetail('/issues/not-an-issue')
    expect(
      await screen.findByRole('heading', { name: 'Issue not found' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Return to issues' })).toHaveAttribute(
      'href',
      '/issues',
    )
  })

  it('presents issues as read-only when the actor cannot update them', async () => {
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[0]
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId

    if (!issue || !viewerId) {
      throw new Error('Expected issue and viewer fixtures.')
    }

    renderIssueDetail(`/issues/${issue.id}`, viewerId)

    expect(await screen.findByRole('heading', { name: issue.title })).toBeVisible()
    expect(screen.getByText('Read-only access')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Edit issue' }),
    ).not.toBeInTheDocument()
    expect(
      await screen.findByText(/include explicit rollback owners/i),
    ).toBeVisible()
    expect(screen.queryByRole('form', { name: 'Add comment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit comment/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove comment/i })).not.toBeInTheDocument()
  })

  it('closes the editor and restores accessible focus after live permission loss', async () => {
    const user = userEvent.setup()
    const fixtures = createAtlasFixtures()
    const reliabilityProject = fixtures.projects.find(({ key }) => key === 'REL')
    const issue = fixtures.issues.find(
      ({ projectId }) => projectId === reliabilityProject?.id,
    )
    const actorMembership = fixtures.memberships.find(({ role }) => role === 'admin')
    if (!issue || !actorMembership) {
      throw new Error('Expected an admin and a reliability issue.')
    }
    const store = new InMemoryDataStore(fixtures)
    const services = renderIssueDetail(
      `/issues/${issue.id}`,
      undefined,
      new SimulatedNetwork(),
      undefined,
      store,
    )

    await screen.findByRole('heading', { name: issue.title })
    await user.click(screen.getByRole('button', { name: 'Edit issue' }))
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Unsaved restricted draft')

    const current = store.read()
    store.commit(current.version, {
      ...current.data,
      memberships: current.data.memberships.map((membership) =>
        membership.id === actorMembership.id
          ? { ...membership, role: 'viewer' as const, revision: 2 }
          : membership,
      ),
    })
    await services.queryClient.invalidateQueries({
      queryKey: ['authorization', services.workspaceId],
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit issue' }))
        .not.toBeInTheDocument()
    })
    const status = await screen.findByText(
      'Your issue editing permission changed. No changes were saved.',
    )
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Edit issue' }))
      .not.toBeInTheDocument()
    expect((await services.gateway.getIssue(issue.id)).title).toBe(issue.title)
  })

  it('lets a read-only member watch an issue through an accessible pressed control', async () => {
    const user = userEvent.setup()
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[0]
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    if (!issue || !viewerId) throw new Error('Expected viewer and issue fixtures.')

    renderIssueDetail(`/issues/${issue.id}`, viewerId)
    const watch = await screen.findByRole('button', { name: 'Watch issue' })
    expect(watch).toHaveAttribute('aria-pressed', 'false')
    await user.click(watch)

    expect(
      await screen.findByText('You are now watching this issue.'),
    ).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Stop watching' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('list', { name: 'People watching this issue' })).toHaveTextContent(
      'Theo Martin',
    )
    expect(screen.getByText('Read-only access')).toBeVisible()
  })

  it('rolls subscription state back when delivery fails', async () => {
    const user = userEvent.setup()
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[1]
    if (!issue) throw new Error('Expected an unwatched issue fixture.')

    renderIssueDetail(
      `/issues/${issue.id}`,
      undefined,
      new SimulatedNetwork({
        failure: (operation) =>
          operation === 'issue.subscription.update'
            ? 'Subscription service unavailable.'
            : null,
      }),
    )
    await user.click(await screen.findByRole('button', { name: 'Watch issue' }))

    expect(
      await screen.findByText('Watch state could not be updated. Previous state restored.'),
    ).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Watch issue' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('recovers the authoritative watch state after a concurrent session change', async () => {
    const user = userEvent.setup()
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[1]
    if (!issue) throw new Error('Expected an unwatched issue fixture.')
    const services = renderIssueDetail(`/issues/${issue.id}`)

    await screen.findByRole('button', { name: 'Watch issue' })
    await services.gateway.setIssueSubscription({
      issueId: issue.id,
      expectedSubscribed: false,
      subscribed: true,
    })
    await user.click(screen.getByRole('button', { name: 'Watch issue' }))

    expect(
      await screen.findByText(
        'Watch state changed in another session. Current state restored.',
      ),
    ).toHaveAttribute('role', 'status')
    expect(await screen.findByRole('button', { name: 'Stop watching' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('validates and creates a comment with focus-preserving feedback', async () => {
    const user = userEvent.setup()
    const issue = getFixtureIssue()
    const clock = new FixedClock(isoDateTime('2026-03-01T10:30:00.000Z'))
    renderIssueDetail(
      `/issues/${issue.id}`,
      undefined,
      new SimulatedNetwork(),
      clock,
    )

    const comment = await screen.findByLabelText('Add a comment')
    await user.click(screen.getByRole('button', { name: 'Add comment' }))
    expect(
      screen.getByText('Enter a comment between 1 and 5,000 characters.'),
    ).toBeVisible()

    await user.type(comment, 'Confirmed the escalation and rollback owners.')
    await user.click(screen.getByRole('button', { name: 'Add comment' }))

    const status = await screen.findByText('Comment added.')
    expect(status).toHaveAttribute('role', 'status')
    expect(comment).toHaveValue('')
    expect(comment).toHaveFocus()
    expect(
      screen.getByText('Confirmed the escalation and rollback owners.'),
    ).toBeVisible()
    const activityColumn = screen
      .getByRole('heading', { name: 'Activity' })
      .closest<HTMLElement>('.issue-collaboration__column')
    if (!activityColumn) throw new Error('Expected the activity column.')
    expect(within(activityColumn).getByText('Added a comment.')).toBeVisible()
    expect(screen.getAllByText('Mar 1, 2026, 10:30 AM')).toHaveLength(2)
  })

  it('reconciles the watcher projection when commenting auto-subscribes the author', async () => {
    const user = userEvent.setup()
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[1]
    const mentionedUser = fixtures.users.find(
      ({ displayName }) => displayName === 'Maya Chen',
    )
    if (!issue || !mentionedUser) throw new Error('Expected mention composer fixtures.')
    renderIssueDetail(`/issues/${issue.id}`)

    expect(await screen.findByRole('button', { name: 'Watch issue' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    const composer = screen.getByLabelText('Add a comment')
    await user.type(composer, 'Subscribe through discussion.')
    await user.selectOptions(
      screen.getByLabelText('Member to mention'),
      mentionedUser.id,
    )
    await user.click(screen.getByRole('button', { name: 'Insert mention' }))
    expect(composer).toHaveFocus()
    expect(composer).toHaveValue('Subscribe through discussion. @Maya Chen ')
    await user.click(screen.getByRole('button', { name: 'Add comment' }))

    expect(await screen.findByText('Comment added.')).toBeVisible()
    expect(await screen.findByRole('button', { name: 'Stop watching' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('coalesces duplicate comment submissions before React can rerender', async () => {
    const user = userEvent.setup()
    const issue = getFixtureIssue()
    const services = renderIssueDetail(
      `/issues/${issue.id}`,
      undefined,
      new SimulatedNetwork({
        latency: (operation) => (operation === 'comment.create' ? 75 : 0),
      }),
    )

    await screen.findByText(/include explicit rollback owners/i)
    await user.type(screen.getByLabelText('Add a comment'), 'One durable comment.')
    const form = screen.getByRole('form', { name: 'Add comment' })
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(await screen.findByText('Comment added.')).toBeVisible()
    const activity = await services.gateway.getIssueActivity(issue.id)
    expect(
      activity.comments.filter(({ body }) => body === 'One durable comment.'),
    ).toHaveLength(1)
  })

  it('offers independent recovery when collaboration history fails', async () => {
    const issue = getFixtureIssue()
    renderIssueDetail(
      `/issues/${issue.id}`,
      undefined,
      new SimulatedNetwork({
        failure: (operation) =>
          operation === 'issue.activity' ? 'Scripted history failure.' : null,
      }),
    )

    expect(await screen.findByRole('heading', { name: issue.title })).toBeVisible()
    expect(
      await screen.findByText('Comments and activity could not be loaded.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry history' })).toBeEnabled()
  })

  it('preserves a comment draft when submission fails', async () => {
    const user = userEvent.setup()
    const issue = getFixtureIssue()
    renderIssueDetail(
      `/issues/${issue.id}`,
      undefined,
      new SimulatedNetwork({
        failure: (operation) =>
          operation === 'comment.create' ? 'Comment service unavailable.' : null,
      }),
    )

    const comment = await screen.findByLabelText('Add a comment')
    await user.type(comment, 'Keep this draft after failure.')
    await user.click(screen.getByRole('button', { name: 'Add comment' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Comment service unavailable.',
    )
    expect(comment).toHaveValue('Keep this draft after failure.')
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeEnabled()
  })

  it('recovers an author edit draft after a comment revision conflict', async () => {
    const user = userEvent.setup()
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[0]
    const comment = fixtures.comments[0]
    if (!issue || !comment) throw new Error('Expected issue and comment fixtures.')
    const services = renderIssueDetail(`/issues/${issue.id}`, comment.authorId)

    await screen.findByText(comment.body)
    await services.gateway.updateComment({
      id: comment.id,
      expectedRevision: comment.revision,
      body: 'A concurrent author revision.',
    })
    await user.click(screen.getByRole('button', { name: 'Edit comment' }))
    const editor = screen.getByRole('textbox', { name: 'Edit comment' })
    await user.clear(editor)
    await user.click(screen.getByRole('button', { name: 'Save comment' }))
    expect(editor).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a comment between 1 and 5,000 characters.',
    )
    await user.type(editor, 'Conflict-safe author revision.')
    await user.click(screen.getByRole('button', { name: 'Save comment' }))

    expect(
      await screen.findByText(/comment changed elsewhere.*latest version is loaded/i),
    ).toHaveAttribute('role', 'alert')
    expect(editor).toHaveValue('Conflict-safe author revision.')
    await user.click(screen.getByRole('button', { name: 'Save comment' }))

    expect(await screen.findByText('Comment updated.')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Conflict-safe author revision.')).toBeVisible()
    expect(screen.getByText(/· edited$/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Edit comment' })).toHaveFocus()
  })

  it('adds identity-backed mentions while editing and reports delivery', async () => {
    const user = userEvent.setup()
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[0]
    const comment = fixtures.comments[0]
    const mentioned = fixtures.users.find(
      ({ id, displayName }) => id !== comment?.authorId && displayName === 'Lena Ortiz',
    )
    if (!issue || !comment || !mentioned) {
      throw new Error('Expected issue, comment, and mention fixtures.')
    }
    const store = new InMemoryDataStore(fixtures)
    renderIssueDetail(
      `/issues/${issue.id}`,
      comment.authorId,
      new SimulatedNetwork(),
      undefined,
      store,
    )

    await screen.findByText(comment.body)
    await user.click(screen.getByRole('button', { name: 'Edit comment' }))
    await user.selectOptions(
      screen.getByLabelText('Member to mention in this edit'),
      mentioned.id,
    )
    await user.click(screen.getByRole('button', { name: 'Insert mention in edit' }))
    expect(screen.getByRole('textbox', { name: 'Edit comment' })).toHaveValue(
      `${comment.body} @${mentioned.displayName} `,
    )
    await user.click(screen.getByRole('button', { name: 'Save comment' }))

    expect(await screen.findByText('Comment updated.')).toHaveAttribute('role', 'status')
    expect(
      store.read().data.commentMentions.some(
        ({ commentId, userId, removedAt }) =>
          commentId === comment.id && userId === mentioned.id && removedAt === null,
      ),
    ).toBe(true)
    expect(
      store.read().data.notifications.some(
        ({ recipientId, kind }) => recipientId === mentioned.id && kind === 'mention',
      ),
    ).toBe(true)
  })

  it('moderates a comment through confirmation and focuses its tombstone', async () => {
    const user = userEvent.setup()
    const issue = getFixtureIssue()
    renderIssueDetail(`/issues/${issue.id}`)

    await screen.findByText(/include explicit rollback owners/i)
    await user.click(screen.getByRole('button', { name: 'Remove comment' }))
    expect(screen.getByText('Remove this comment?')).toBeVisible()
    let confirmRemove = screen.getByRole('button', { name: 'Confirm remove' })
    expect(confirmRemove).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    const removeComment = screen.getByRole('button', { name: 'Remove comment' })
    expect(removeComment).toHaveFocus()
    await user.click(removeComment)
    confirmRemove = screen.getByRole('button', { name: 'Confirm remove' })
    expect(confirmRemove).toHaveFocus()
    await user.click(confirmRemove)

    expect(await screen.findByText('Comment removed by moderation.')).toHaveAttribute(
      'role',
      'status',
    )
    const tombstone = screen.getByText('Comment removed by Omar Haddad.')
    expect(tombstone).toBeVisible()
    expect(tombstone.closest('li')).toHaveFocus()
    expect(screen.getByText('Removed a comment as a moderator.')).toBeVisible()
    expect(
      screen.queryByText(/include explicit rollback owners/i),
    ).not.toBeInTheDocument()
  })

  it('restores comment content and confirmation focus when moderation fails', async () => {
    const user = userEvent.setup()
    const issue = getFixtureIssue()
    renderIssueDetail(
      `/issues/${issue.id}`,
      undefined,
      new SimulatedNetwork({
        failure: (operation) =>
          operation === 'comment.delete' ? 'Moderation service unavailable.' : null,
      }),
    )

    await screen.findByText(/include explicit rollback owners/i)
    await user.click(screen.getByRole('button', { name: 'Remove comment' }))
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Moderation service unavailable.',
    )
    expect(screen.getByText(/include explicit rollback owners/i)).toBeVisible()
    expect(screen.queryByText(/comment removed by Omar Haddad/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm remove' })).toHaveFocus()
  })
})
