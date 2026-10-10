import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EntityNotFoundError,
  ForbiddenGatewayError,
  GatewayConflictError,
  InvalidGatewayRequestError,
  RequestCancelledError,
  SessionExpiredGatewayError,
  SimulatedGatewayError,
} from './errors'
import { MockAtlasGateway } from './mock-gateway'
import { SimulatedNetwork } from './simulation'
import { InMemoryRequestTracer } from './tracing'
import { FixedClock } from '../clock'
import { createAtlasFixtures } from '../fixtures'
import { DeterministicIdGenerator } from '../id-generator'
import { InMemoryDataStore } from '../store'
import {
  isoDateTime,
  issueId,
  issueSubscriptionId,
  type UserId,
} from '../../domain'

afterEach(() => {
  vi.useRealTimers()
})

function createGateway(
  simulator = new SimulatedNetwork(),
  requestedActorId?: UserId,
) {
  const fixtures = createAtlasFixtures()
  const defaultActorId = fixtures.memberships.find(
    ({ role }) => role === 'admin',
  )?.userId
  const actorId = requestedActorId ?? defaultActorId

  if (!actorId) {
    throw new Error('Expected an administrative fixture actor.')
  }

  const store = new InMemoryDataStore(fixtures)
  const tracer = new InMemoryRequestTracer()
  const clock = new FixedClock(isoDateTime('2026-02-01T08:00:00.000Z'))
  const idGenerator = new DeterministicIdGenerator('gateway')
  const gateway = new MockAtlasGateway({
    actorId,
    store,
    tracer,
    clock,
    simulator,
    idGenerator,
  })

  return { fixtures, gateway, idGenerator, store, tracer }
}

describe('MockAtlasGateway', () => {
  it('returns permission-protected workspace activity with request tracing', async () => {
    const { fixtures, gateway, tracer } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    if (!workspaceId) throw new Error('Expected a fixture workspace.')

    const activity = await gateway.getWorkspaceActivity({ workspaceId })

    expect(activity.events).toMatchObject({ totalItems: 1, pageCount: 1 })
    expect(activity.events.items[0]).toMatchObject({
      actor: { displayName: 'Omar Haddad' },
    })
    expect(activity.events.items[0]?.target.href).toMatch(/^\/issues\//)
    expect(tracer.read()).toMatchObject([
      { operation: 'activity.list', phase: 'started' },
      { operation: 'activity.list', phase: 'succeeded' },
    ])
  })

  it('returns an authoritative analytics snapshot with request tracing', async () => {
    const { fixtures, gateway, tracer } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    if (!workspaceId) throw new Error('Expected a fixture workspace.')

    const analytics = await gateway.getWorkspaceAnalytics({
      workspaceId,
      range: 'all-time',
    })
    expect(analytics).toMatchObject({
      generatedAt: '2026-02-01T08:00:00.000Z',
      totalIssues: 6,
      activeProjects: 2,
    })
    expect(tracer.read()).toMatchObject([
      { operation: 'analytics.get', phase: 'started' },
      { operation: 'analytics.get', phase: 'succeeded' },
    ])
  })

  it('returns authoritative project summaries with request tracing', async () => {
    const { fixtures, gateway, tracer } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    if (!workspaceId) throw new Error('Expected a fixture workspace.')

    const result = await gateway.listProjectSummaries({
      workspaceId,
      search: 'reliability',
      page: { number: 1, size: 12 },
    })

    expect(result).toMatchObject({ totalItems: 1, pageCount: 1 })
    expect(result.items[0]).toMatchObject({
      project: { key: 'REL' },
      totalIssues: 3,
      openIssues: 2,
      completedIssues: 1,
    })
    expect(tracer.read()).toMatchObject([
      { operation: 'project.summary-list', phase: 'started' },
      { operation: 'project.summary-list', phase: 'succeeded' },
    ])
  })

  it('returns project edit metadata', async () => {
    const { fixtures, gateway, tracer } = createGateway()
    const project = fixtures.projects[0]
    if (!project) throw new Error('Expected a fixture project.')

    const metadata = await gateway.getProjectEditMetadata(project.id)

    expect(metadata.project).toEqual(project)
    expect(tracer.read()).toMatchObject([
      { operation: 'project.metadata.get', phase: 'started' },
      { operation: 'project.metadata.get', phase: 'succeeded' },
    ])
  })

  it('creates an atomic project foundation with ownership, workflow, and audit evidence', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    const lead = fixtures.users.find(({ displayName }) => displayName === 'Maya Chen')
    if (!workspaceId || !lead) throw new Error('Expected project creation fixtures.')

    const metadata = await gateway.getProjectCreationMetadata(workspaceId)
    expect(metadata.eligibleLeads.map(({ displayName }) => displayName)).toEqual([
      'Lena Ortiz',
      'Maya Chen',
      'Omar Haddad',
      'Theo Martin',
    ])

    const project = await gateway.createProject({
      workspaceId,
      key: ' sec ',
      name: ' Security readiness ',
      description: ' Prepare controls and evidence. ',
      leadId: lead.id,
      workflow: [
        { name: 'Queued', category: 'backlog' },
        { name: 'Verifying', category: 'started' },
        { name: 'Accepted', category: 'completed' },
      ],
    })

    expect(project).toMatchObject({
      key: 'SEC',
      name: 'Security readiness',
      description: 'Prepare controls and evidence.',
      leadId: lead.id,
      status: 'planned',
      revision: 1,
    })
    const snapshot = store.read().data
    expect(
      snapshot.projectMembers.find(({ projectId }) => projectId === project.id),
    ).toMatchObject({ userId: lead.id, role: 'lead' })
    expect(
      snapshot.workflowStatuses
        .filter(({ projectId }) => projectId === project.id)
        .map(({ name, category, order }) => ({ name, category, order })),
    ).toEqual([
      { name: 'Queued', category: 'backlog', order: 0 },
      { name: 'Verifying', category: 'started', order: 1 },
      { name: 'Accepted', category: 'completed', order: 2 },
    ])
    expect(snapshot.activityEvents.at(-1)).toMatchObject({
      action: 'project.created',
      entityId: project.id,
    })
    expect(snapshot.auditEvents.at(-1)).toMatchObject({
      action: 'project.created',
      metadata: { projectKey: 'SEC', leadId: lead.id, workflowStages: 3 },
    })
    expect(tracer.read().at(-1)).toMatchObject({
      operation: 'project.create',
      phase: 'succeeded',
    })
  })

  it('rejects duplicate keys, invalid workflows, and unauthorized project creation', async () => {
    const { fixtures, gateway } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    const lead = fixtures.users[0]
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    if (!workspaceId || !lead || !viewerId) {
      throw new Error('Expected project validation fixtures.')
    }
    const validInput = {
      workspaceId,
      key: 'NEW',
      name: 'New project',
      description: '',
      leadId: lead.id,
      workflow: [
        { name: 'Open', category: 'backlog' as const },
        { name: 'Done', category: 'completed' as const },
      ],
    }

    await gateway.createProject(validInput)
    await expect(gateway.createProject(validInput)).rejects.toBeInstanceOf(
      GatewayConflictError,
    )
    await expect(
      gateway.createProject({
        ...validInput,
        key: 'BAD',
        workflow: [
          { name: 'Same', category: 'started' },
          { name: 'same', category: 'completed' },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)

    const { gateway: viewerGateway } = createGateway(
      new SimulatedNetwork(),
      viewerId,
    )
    await expect(viewerGateway.createProject(validInput)).rejects.toBeInstanceOf(
      ForbiddenGatewayError,
    )
  })

  it('updates project lifecycle fields without changing leadership', async () => {
    const { fixtures, gateway, store } = createGateway()
    const project = fixtures.projects[0]
    const followerId = fixtures.projectSubscriptions.find(
      ({ projectId }) => projectId === project?.id,
    )?.userId
    if (!project || !followerId) throw new Error('Expected project lifecycle fixtures.')

    const updated = await gateway.updateProject({
      id: project.id,
      expectedRevision: project.revision,
      changes: {
        name: '  Launch assurance  ',
        description: '  Govern the launch decision.  ',
        status: 'paused',
      },
    })

    expect(updated).toMatchObject({
      name: 'Launch assurance',
      description: 'Govern the launch decision.',
      leadId: project.leadId,
      status: 'paused',
      revision: 2,
    })
    const snapshot = store.read().data
    expect(snapshot.projectMembers.filter(
      ({ projectId, role }) => projectId === project.id && role === 'lead',
    )).toEqual([
      expect.objectContaining({ userId: project.leadId }),
    ])
    expect(snapshot.auditEvents.at(-1)).toMatchObject({
      action: 'project.updated',
      metadata: { projectId: project.id, fromRevision: 1, toRevision: 2 },
    })
    expect(snapshot.notifications.at(-1)).toMatchObject({
      recipientId: followerId,
      kind: 'project-update',
      target: { kind: 'project', id: project.id },
      title: 'OPS project updated',
      readAt: null,
    })
  })

  it('transfers project leadership atomically with roles, activity, audit, and tracing', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const project = fixtures.projects.find(({ key }) => key === 'OPS')
    const currentLead = fixtures.users.find(({ id }) => id === project?.leadId)
    const candidate = fixtures.users.find(({ displayName }) => displayName === 'Maya Chen')
    if (!project || !currentLead || !candidate) {
      throw new Error('Expected lead transfer fixtures.')
    }

    const transferData = await gateway.getProjectLeadTransfer(project.id)
    expect(transferData).toMatchObject({
      project,
      currentLead,
      candidates: [
        { user: { id: candidate.id, displayName: candidate.displayName }, currentRole: 'contributor' },
      ],
    })

    const updated = await gateway.transferProjectLead({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      expectedCurrentLeadId: currentLead.id,
      newLeadId: candidate.id,
      formerLeadRole: 'viewer',
    })

    expect(updated).toMatchObject({ leadId: candidate.id, revision: 2 })
    const snapshot = store.read().data
    expect(snapshot.projectMembers.find(
      ({ projectId, userId }) => projectId === project.id && userId === currentLead.id,
    )).toMatchObject({ role: 'viewer' })
    expect(snapshot.projectMembers.find(
      ({ projectId, userId }) => projectId === project.id && userId === candidate.id,
    )).toMatchObject({ role: 'lead' })
    expect(snapshot.activityEvents.at(-1)).toMatchObject({
      action: 'project.lead.transferred',
      summary: 'Transferred leadership from Omar Haddad to Maya Chen.',
    })
    expect(snapshot.auditEvents.at(-1)).toMatchObject({
      action: 'project.lead.transferred',
      metadata: {
        previousLeadId: currentLead.id,
        newLeadId: candidate.id,
        previousLeadRole: 'viewer',
        previousCandidateRole: 'contributor',
        fromRevision: 1,
        toRevision: 2,
      },
    })
    expect(tracer.read().slice(-2)).toMatchObject([
      { operation: 'administration.project-lead.transfer', phase: 'started' },
      { operation: 'administration.project-lead.transfer', phase: 'succeeded' },
    ])
  })

  it('rejects ineligible, stale, no-op, and unauthorized lead transfers', async () => {
    const ineligible = createGateway()
    const project = ineligible.fixtures.projects.find(({ key }) => key === 'OPS')
    const candidate = ineligible.fixtures.users.find(
      ({ displayName }) => displayName === 'Maya Chen',
    )
    const candidateWorkspaceMembership = ineligible.fixtures.memberships.find(
      ({ userId }) => userId === candidate?.id,
    )
    if (!project || !candidate || !candidateWorkspaceMembership) {
      throw new Error('Expected lead eligibility fixtures.')
    }
    const suspended = ineligible.store.read()
    ineligible.store.commit(suspended.version, {
      ...suspended.data,
      memberships: suspended.data.memberships.map((membership) =>
        membership.id === candidateWorkspaceMembership.id
          ? { ...membership, status: 'suspended' as const, revision: 2 }
          : membership,
      ),
    })
    await expect(ineligible.gateway.transferProjectLead({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      expectedCurrentLeadId: project.leadId,
      newLeadId: candidate.id,
      formerLeadRole: 'contributor',
    })).rejects.toBeInstanceOf(InvalidGatewayRequestError)

    const stale = createGateway()
    const staleProject = stale.fixtures.projects.find(({ key }) => key === 'OPS')
    const staleCandidate = stale.fixtures.users.find(
      ({ displayName }) => displayName === 'Maya Chen',
    )
    if (!staleProject || !staleCandidate) throw new Error('Expected stale transfer fixtures.')
    await stale.gateway.updateProject({
      id: staleProject.id,
      expectedRevision: staleProject.revision,
      changes: { description: 'A concurrent project update.' },
    })
    await expect(stale.gateway.transferProjectLead({
      projectId: staleProject.id,
      expectedProjectRevision: staleProject.revision,
      expectedCurrentLeadId: staleProject.leadId,
      newLeadId: staleCandidate.id,
      formerLeadRole: 'contributor',
    })).rejects.toBeInstanceOf(GatewayConflictError)
    await expect(stale.gateway.transferProjectLead({
      projectId: staleProject.id,
      expectedProjectRevision: 2,
      expectedCurrentLeadId: staleProject.leadId,
      newLeadId: staleProject.leadId,
      formerLeadRole: 'contributor',
    })).rejects.toBeInstanceOf(InvalidGatewayRequestError)

    const revoked = createGateway()
    const revokedProject = revoked.fixtures.projects.find(({ key }) => key === 'OPS')
    const revokedCandidate = revoked.fixtures.users.find(
      ({ displayName }) => displayName === 'Maya Chen',
    )
    if (!revokedProject || !revokedCandidate) {
      throw new Error('Expected authorization transfer fixtures.')
    }
    const current = revoked.store.read()
    revoked.store.commit(current.version, {
      ...current.data,
      projects: current.data.projects.map((item) =>
        item.id === revokedProject.id ? { ...item, leadId: revokedCandidate.id } : item,
      ),
      memberships: current.data.memberships.map((membership) =>
        membership.userId === revokedProject.leadId
          ? { ...membership, role: 'member' as const, revision: membership.revision + 1 }
          : membership,
      ),
      projectMembers: current.data.projectMembers.map((membership) => {
        if (membership.projectId !== revokedProject.id) return membership
        if (membership.userId === revokedProject.leadId) {
          return { ...membership, role: 'contributor' as const }
        }
        if (membership.userId === revokedCandidate.id) {
          return { ...membership, role: 'lead' as const }
        }
        return membership
      }),
    })
    await expect(revoked.gateway.transferProjectLead({
      projectId: revokedProject.id,
      expectedProjectRevision: revokedProject.revision,
      expectedCurrentLeadId: revokedProject.leadId,
      newLeadId: revokedCandidate.id,
      formerLeadRole: 'contributor',
    })).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('returns paginated project activity with authoritative actor attribution', async () => {
    const { fixtures, gateway, tracer } = createGateway()
    const project = fixtures.projects[0]
    if (!project) throw new Error('Expected a fixture project.')
    await gateway.updateProject({
      id: project.id,
      expectedRevision: project.revision,
      changes: { status: 'paused' },
    })

    const activity = await gateway.getProjectActivity(project.id, {
      number: 1,
      size: 1,
    })

    expect(activity.events).toMatchObject({ totalItems: 1, pageCount: 1 })
    expect(activity.events.items[0]).toMatchObject({
      actor: { displayName: 'Omar Haddad' },
      event: { action: 'project.updated', summary: 'Updated OPS.' },
    })
    expect(tracer.read().at(-1)).toMatchObject({
      operation: 'project.activity.get',
      phase: 'succeeded',
    })
    await expect(
      gateway.getProjectActivity(project.id, { number: 0, size: 20 }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
  })

  it('rejects stale, invalid, and unauthorized project updates', async () => {
    const { fixtures, gateway } = createGateway()
    const project = fixtures.projects[0]
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    if (!project || !viewerId) throw new Error('Expected project and viewer fixtures.')

    await expect(
      gateway.updateProject({
        id: project.id,
        expectedRevision: 99,
        changes: { name: 'Stale overwrite' },
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
    await expect(
      gateway.updateProject({
        id: project.id,
        expectedRevision: project.revision,
        changes: { status: 'archived' },
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)

    const { gateway: viewerGateway } = createGateway(
      new SimulatedNetwork(),
      viewerId,
    )
    await expect(
      viewerGateway.updateProject({
        id: project.id,
        expectedRevision: project.revision,
        changes: { name: 'Unauthorized' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('archives projects with audit history and makes their work read-only', async () => {
    const { fixtures, gateway, store } = createGateway()
    const project = fixtures.projects[0]
    const issue = fixtures.issues.find(({ projectId }) => projectId === project?.id)
    if (!project || !issue) throw new Error('Expected project issue fixtures.')

    const archived = await gateway.archiveProject({
      id: project.id,
      expectedRevision: project.revision,
    })

    expect(archived).toMatchObject({ status: 'archived', revision: 2 })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'project.archived',
      metadata: { projectId: project.id, fromRevision: 1, toRevision: 2 },
    })
    expect(store.read().data.notifications.at(-1)).toMatchObject({
      kind: 'project-update',
      target: { kind: 'project', id: project.id },
      title: 'OPS was archived',
    })
    await expect(
      gateway.updateIssue({
        id: issue.id,
        expectedRevision: issue.revision,
        changes: { priority: 'low' },
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
    await expect(
      gateway.createComment({ issueId: issue.id, body: 'Archived bypass' }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
    const comment = fixtures.comments.find(({ issueId }) => issueId === issue.id)
    if (!comment) throw new Error('Expected an archived project comment fixture.')
    await expect(
      gateway.deleteComment({
        id: comment.id,
        expectedRevision: comment.revision,
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
    await expect(
      gateway.deleteIssue({ id: issue.id, expectedRevision: issue.revision }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('refreshes live authorization and expires inactive sessions', async () => {
    const { fixtures, gateway, store } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    const admin = fixtures.memberships.find(({ role }) => role === 'admin')
    if (!workspaceId || !admin) {
      throw new Error('Expected fixture workspace and administrator.')
    }

    const initial = await gateway.getAuthorizationSession(workspaceId)
    expect(initial.workspaceMembership.role).toBe('admin')

    const current = store.read()
    store.commit(current.version, {
      ...current.data,
      memberships: current.data.memberships.map((membership) =>
        membership.id === admin.id
          ? { ...membership, role: 'viewer' as const }
          : membership,
      ),
    })
    const downgraded = await gateway.getAuthorizationSession(workspaceId)
    expect(downgraded.workspaceMembership.role).toBe('viewer')
    expect(downgraded.permissionFingerprint).not.toBe(initial.permissionFingerprint)

    const latest = store.read()
    store.commit(latest.version, {
      ...latest.data,
      memberships: latest.data.memberships.map((membership) =>
        membership.id === admin.id
          ? { ...membership, status: 'suspended' as const }
          : membership,
      ),
    })
    await expect(
      gateway.getAuthorizationSession(workspaceId),
    ).rejects.toBeInstanceOf(SessionExpiredGatewayError)
  })

  it('lists and revision-protects authoritative workspace member changes', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    const member = fixtures.memberships.find(({ role }) => role === 'member')
    if (!workspaceId || !member) throw new Error('Expected membership fixtures.')

    const directory = await gateway.getWorkspaceAdministration({
      workspaceId,
      search: 'lena',
      page: { number: 1, size: 20 },
    })
    expect(directory.members).toMatchObject({ totalItems: 1, pageCount: 1 })
    expect(directory.members.items[0]).toMatchObject({
      user: { displayName: 'Lena Ortiz' },
      membership: { role: 'member', status: 'active', revision: 1 },
      canEdit: true,
      allowedRoles: ['admin', 'member', 'viewer'],
    })

    const updated = await gateway.updateWorkspaceMembership({
      id: member.id,
      expectedRevision: member.revision,
      role: 'admin',
      status: 'active',
    })
    expect(updated).toMatchObject({ role: 'admin', status: 'active', revision: 2 })
    expect(store.read().data.activityEvents.at(-1)).toMatchObject({
      action: 'membership.updated',
      entityId: member.id,
    })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'membership.updated',
      metadata: { fromRole: 'member', toRole: 'admin', fromRevision: 1, toRevision: 2 },
    })
    expect(tracer.read().at(-1)).toMatchObject({
      operation: 'administration.members.update',
      phase: 'succeeded',
    })
    await expect(
      gateway.updateWorkspaceMembership({
        id: member.id,
        expectedRevision: member.revision,
        role: 'viewer',
        status: 'active',
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('protects owner access and rejects membership administration after privilege loss', async () => {
    const { fixtures, gateway, store } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    const owner = fixtures.memberships.find(({ role }) => role === 'owner')
    const member = fixtures.memberships.find(({ role }) => role === 'member')
    const admin = fixtures.memberships.find(({ role }) => role === 'admin')
    if (!workspaceId || !owner || !member || !admin) {
      throw new Error('Expected governance membership fixtures.')
    }

    await expect(
      gateway.updateWorkspaceMembership({
        id: owner.id,
        expectedRevision: owner.revision,
        role: 'admin',
        status: 'active',
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)

    const current = store.read()
    store.commit(current.version, {
      ...current.data,
      memberships: current.data.memberships.map((membership) =>
        membership.id === admin.id
          ? { ...membership, role: 'viewer' as const, revision: 2 }
          : membership,
      ),
    })
    await expect(
      gateway.updateWorkspaceMembership({
        id: member.id,
        expectedRevision: member.revision,
        role: 'admin',
        status: 'active',
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
    await expect(
      gateway.getWorkspaceAdministration({ workspaceId }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('creates, filters, and audits normalized workspace invitations', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    const existingMember = fixtures.users[0]
    if (!workspaceId || !existingMember) {
      throw new Error('Expected workspace invitation fixtures.')
    }

    const invitation = await gateway.createWorkspaceInvitation({
      workspaceId,
      email: '  New.Member@Example.Test ',
      role: 'viewer',
    })

    expect(invitation).toMatchObject({
      id: 'invite_gateway_workspace_member_001',
      email: 'new.member@example.test',
      role: 'viewer',
      state: 'pending',
      expiresAt: '2026-02-08T08:00:00.000Z',
      revision: 1,
    })
    const directory = await gateway.getWorkspaceInvitations({
      workspaceId,
      search: 'NEW.MEMBER',
      roles: ['viewer'],
      states: ['pending'],
      page: { number: 1, size: 1 },
    })
    expect(directory.invitations).toMatchObject({ totalItems: 1, pageCount: 1 })
    expect(directory.invitations.items[0]).toMatchObject({
      invitation: { id: invitation.id },
      effectiveState: 'pending',
    })
    expect(store.read().data.activityEvents.at(-1)).toMatchObject({
      entityKind: 'invitation',
      entityId: invitation.id,
      action: 'workspace.invitation.created',
    })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'workspace.invitation.created',
      metadata: { email: invitation.email, role: 'viewer', revision: 1 },
    })
    expect(tracer.read().slice(-2)).toMatchObject([
      { operation: 'administration.invitations.get', phase: 'started' },
      { operation: 'administration.invitations.get', phase: 'succeeded' },
    ])

    await expect(
      gateway.createWorkspaceInvitation({
        workspaceId,
        email: invitation.email,
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
    await expect(
      gateway.createWorkspaceInvitation({
        workspaceId,
        email: existingMember.email,
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
    await expect(
      gateway.createWorkspaceInvitation({
        workspaceId,
        email: 'not-an-email',
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
  })

  it('derives expiry and revision-protects resend and revocation', async () => {
    const { fixtures, gateway, store } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    if (!workspaceId) throw new Error('Expected a fixture workspace.')
    const invitation = await gateway.createWorkspaceInvitation({
      workspaceId,
      email: 'expiring.member@example.test',
      role: 'member',
    })
    const current = store.read()
    store.commit(current.version, {
      ...current.data,
      workspaceInvitations: current.data.workspaceInvitations.map((candidate) =>
        candidate.id === invitation.id
          ? {
              ...candidate,
              createdAt: isoDateTime('2026-01-01T08:00:00.000Z'),
              lastSentAt: isoDateTime('2026-01-02T08:00:00.000Z'),
              expiresAt: isoDateTime('2026-01-09T08:00:00.000Z'),
            }
          : candidate,
      ),
    })

    const expired = await gateway.getWorkspaceInvitations({
      workspaceId,
      states: ['expired'],
    })
    expect(expired.invitations.items[0]?.effectiveState).toBe('expired')
    await expect(
      gateway.activateWorkspaceInvitation({
        id: invitation.id,
        expectedRevision: 1,
        displayName: 'Expired Member',
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)

    const renewed = await gateway.resendWorkspaceInvitation({
      id: invitation.id,
      expectedRevision: 1,
    })
    expect(renewed).toMatchObject({
      lastSentAt: '2026-02-01T08:00:00.000Z',
      expiresAt: '2026-02-08T08:00:00.000Z',
      revision: 2,
    })
    await expect(
      gateway.revokeWorkspaceInvitation({
        id: invitation.id,
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
    const revoked = await gateway.revokeWorkspaceInvitation({
      id: invitation.id,
      expectedRevision: renewed.revision,
    })
    expect(revoked).toMatchObject({
      state: 'revoked',
      revokedAt: '2026-02-01T08:00:00.000Z',
      revision: 3,
    })
    await expect(
      gateway.resendWorkspaceInvitation({
        id: invitation.id,
        expectedRevision: revoked.revision,
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('atomically activates invitations and preserves data on simulated failure', async () => {
    const simulator = new SimulatedNetwork({
      failure: (operation) =>
        operation === 'administration.invitations.activate'
          ? 'Activation transport failed.'
          : null,
    })
    const { fixtures, gateway, idGenerator, store, tracer } = createGateway(simulator)
    const workspaceId = fixtures.workspaces[0]?.id
    if (!workspaceId) throw new Error('Expected a fixture workspace.')
    const invitation = await gateway.createWorkspaceInvitation({
      workspaceId,
      email: 'provisioned.member@example.test',
      role: 'admin',
    })
    const beforeFailure = store.read()
    await expect(
      gateway.activateWorkspaceInvitation({
        id: invitation.id,
        expectedRevision: invitation.revision,
        displayName: 'Provisioned Member',
      }),
    ).rejects.toBeInstanceOf(SimulatedGatewayError)
    expect(store.read()).toEqual(beforeFailure)
    expect(tracer.read().at(-1)).toMatchObject({
      operation: 'administration.invitations.activate',
      phase: 'failed',
      errorCode: 'simulated-failure',
    })

    const reliableGateway = new MockAtlasGateway({
      actorId: invitation.invitedById,
      store,
      clock: new FixedClock(isoDateTime('2026-02-01T08:00:00.000Z')),
      idGenerator,
    })
    const activation = await reliableGateway.activateWorkspaceInvitation({
      id: invitation.id,
      expectedRevision: invitation.revision,
      displayName: '  Provisioned Member  ',
    })
    expect(activation).toMatchObject({
      invitation: { state: 'accepted', revision: 2 },
      user: {
        id: 'usr_gateway_invited_member_001',
        displayName: 'Provisioned Member',
        initials: 'PM',
      },
      membership: {
        id: 'mem_gateway_invited_member_001',
        role: 'admin',
        status: 'active',
        revision: 1,
      },
    })
    const snapshot = store.read().data
    expect(snapshot.notificationPreferences).toContainEqual(
      expect.objectContaining({
        workspaceId,
        userId: activation.user.id,
        assignments: true,
        comments: true,
        issueUpdates: true,
        projectUpdates: true,
      }),
    )
    expect(snapshot.activityEvents.at(-1)).toMatchObject({
      action: 'workspace.invitation.activated',
      entityId: invitation.id,
    })
    expect(snapshot.auditEvents.at(-1)).toMatchObject({
      action: 'workspace.invitation.activated',
      metadata: {
        userId: activation.user.id,
        membershipId: activation.membership.id,
        role: 'admin',
      },
    })
    await expect(
      reliableGateway.activateWorkspaceInvitation({
        id: invitation.id,
        expectedRevision: activation.invitation.revision,
        displayName: 'Provisioned Member',
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('adds and changes project members through the project revision boundary', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const project = fixtures.projects[0]
    const observer = fixtures.users.find(({ displayName }) => displayName === 'Theo Martin')
    if (!project || !observer) throw new Error('Expected project membership fixtures.')

    const directory = await gateway.getProjectMembershipAdministration({
      projectId: project.id,
      search: 'omar',
    })
    expect(directory.members).toMatchObject({ totalItems: 1, pageCount: 1 })
    expect(directory.members.items[0]).toMatchObject({
      membership: { role: 'lead' },
      user: { displayName: 'Omar Haddad' },
      workspaceStatus: 'active',
      assignedIssueCount: 2,
    })
    expect(directory.eligibleUsers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: observer.id })]),
    )

    const afterAdd = await gateway.addProjectMember({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      userId: observer.id,
      role: 'viewer',
    })
    const added = store.read().data.projectMembers.find(
      ({ projectId, userId }) => projectId === project.id && userId === observer.id,
    )
    if (!added) throw new Error('Expected the added project member.')
    const afterUpdate = await gateway.updateProjectMember({
      id: added.id,
      expectedProjectRevision: afterAdd.revision,
      role: 'contributor',
    })

    expect(afterUpdate.revision).toBe(3)
    expect(store.read().data.projectMembers.find(({ id }) => id === added.id)?.role)
      .toBe('contributor')
    expect(store.read().data.activityEvents.slice(-2).map(({ action }) => action))
      .toEqual(['project.membership.updated', 'project.membership.updated'])
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'project.member.updated',
      metadata: { fromRole: 'viewer', toRole: 'contributor', toRevision: 3 },
    })
    expect(tracer.read().at(-1)).toMatchObject({
      operation: 'administration.project-members.update',
      phase: 'succeeded',
    })
    await expect(
      gateway.updateProjectMember({
        id: added.id,
        expectedProjectRevision: afterAdd.revision,
        role: 'viewer',
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('rechecks concurrent issue ownership and requires governed reassignment on removal', async () => {
    const { fixtures, gateway, store } = createGateway()
    const project = fixtures.projects[0]
    const observer = fixtures.users.find(({ displayName }) => displayName === 'Theo Martin')
    if (!project || !observer) throw new Error('Expected project membership fixtures.')
    const afterAdd = await gateway.addProjectMember({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      userId: observer.id,
      role: 'contributor',
    })
    const added = store.read().data.projectMembers.find(
      ({ projectId, userId }) => projectId === project.id && userId === observer.id,
    )
    const lead = store.read().data.projectMembers.find(
      ({ projectId, role }) => projectId === project.id && role === 'lead',
    )
    const issue = store.read().data.issues.find(({ projectId }) => projectId === project.id)
    if (!added || !lead || !issue) throw new Error('Expected removal fixtures.')

    const beforeConcurrentAssignment = await gateway.getProjectMembershipAdministration({
      projectId: project.id,
    })
    expect(
      beforeConcurrentAssignment.members.items.find(({ membership }) => membership.id === added.id)
        ?.assignedIssueCount,
    ).toBe(0)
    const current = store.read()
    store.commit(current.version, {
      ...current.data,
      issues: current.data.issues.map((candidate) =>
        candidate.id === issue.id
          ? { ...candidate, assigneeId: observer.id, revision: candidate.revision + 1 }
          : candidate,
      ),
    })
    await expect(
      gateway.removeProjectMember({
        id: added.id,
        expectedProjectRevision: afterAdd.revision,
        reassignIssuesTo: null,
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)

    const removed = await gateway.removeProjectMember({
      id: added.id,
      expectedProjectRevision: afterAdd.revision,
      reassignIssuesTo: lead.userId,
    })
    expect(removed.revision).toBe(3)
    expect(store.read().data.projectMembers.some(({ id }) => id === added.id)).toBe(false)
    expect(store.read().data.issues.find(({ id }) => id === issue.id)).toMatchObject({
      assigneeId: lead.userId,
      revision: issue.revision + 2,
    })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'project.member.removed',
      metadata: { reassignedIssueCount: 1, reassignedTo: lead.userId },
    })
    const reassignmentActivity = store.read().data.activityEvents.at(-1)
    expect(reassignmentActivity).toMatchObject({
      action: 'issue.assignee.reassigned',
      entityId: issue.id,
    })
    expect(reassignmentActivity?.summary).toContain('from Theo Martin to Omar Haddad')
  })

  it('protects project membership mutations from suspended candidates and stale administrators', async () => {
    const { fixtures, gateway, store } = createGateway()
    const project = fixtures.projects[0]
    const observer = fixtures.users.find(({ displayName }) => displayName === 'Theo Martin')
    const observerMembership = fixtures.memberships.find(({ userId }) => userId === observer?.id)
    const admin = fixtures.memberships.find(({ role }) => role === 'admin')
    if (!project || !observer || !observerMembership || !admin) {
      throw new Error('Expected authorization fixtures.')
    }
    const suspended = store.read()
    store.commit(suspended.version, {
      ...suspended.data,
      memberships: suspended.data.memberships.map((membership) =>
        membership.id === observerMembership.id
          ? { ...membership, status: 'suspended' as const, revision: 2 }
          : membership,
      ),
    })
    await expect(
      gateway.addProjectMember({
        projectId: project.id,
        expectedProjectRevision: project.revision,
        userId: observer.id,
        role: 'viewer',
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)

    const revoked = store.read()
    store.commit(revoked.version, {
      ...revoked.data,
      memberships: revoked.data.memberships.map((membership) =>
        membership.id === admin.id
          ? { ...membership, role: 'viewer' as const, revision: 2 }
          : membership,
      ),
    })
    await expect(
      gateway.getProjectMembershipAdministration({ projectId: project.id }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('rejects duplicate, no-op, and lead-bypassing project membership changes', async () => {
    const { fixtures, gateway } = createGateway()
    const project = fixtures.projects[0]
    const lead = fixtures.projectMembers.find(
      ({ projectId, role }) => projectId === project?.id && role === 'lead',
    )
    const contributor = fixtures.projectMembers.find(
      ({ projectId, role }) => projectId === project?.id && role === 'contributor',
    )
    if (!project || !lead || !contributor) {
      throw new Error('Expected protected project membership fixtures.')
    }

    await expect(
      gateway.addProjectMember({
        projectId: project.id,
        expectedProjectRevision: project.revision,
        userId: contributor.userId,
        role: 'viewer',
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
    await expect(
      gateway.updateProjectMember({
        id: contributor.id,
        expectedProjectRevision: project.revision,
        role: 'contributor',
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
    await expect(
      gateway.updateProjectMember({
        id: lead.id,
        expectedProjectRevision: project.revision,
        role: 'viewer',
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
    await expect(
      gateway.removeProjectMember({
        id: lead.id,
        expectedProjectRevision: project.revision,
        reassignIssuesTo: contributor.userId,
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
  })

  it('updates workflows atomically and migrates issues from retired statuses', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const project = fixtures.projects.find(({ key }) => key === 'OPS')
    const statuses = fixtures.workflowStatuses
      .filter(({ projectId }) => projectId === project?.id)
      .sort((left, right) => left.order - right.order)
    const backlog = statuses[0]
    const active = statuses[1]
    const completed = statuses[2]
    const completedIssue = fixtures.issues.find(({ statusId }) => statusId === completed?.id)
    if (!project || !backlog || !active || !completed || !completedIssue) {
      throw new Error('Expected workflow administration fixtures.')
    }

    const administration = await gateway.getProjectWorkflowAdministration(project.id)
    expect(administration.statuses.map(({ status, issueCount }) => ({
      name: status.name,
      issueCount,
    }))).toEqual([
      { name: backlog.name, issueCount: 1 },
      { name: active.name, issueCount: 1 },
      { name: completed.name, issueCount: 1 },
    ])

    const updated = await gateway.updateProjectWorkflow({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      statuses: [
        { id: active.id, name: 'In verification', category: 'started' },
        { id: backlog.id, name: backlog.name, category: 'unstarted' },
        { id: null, name: 'Verified', category: 'completed' },
      ],
      migrations: [
        { statusId: completed.id, reassignToStatusId: active.id },
      ],
    })

    expect(updated.revision).toBe(2)
    expect(
      store.read().data.workflowStatuses
        .filter(({ projectId }) => projectId === project.id)
        .sort((left, right) => left.order - right.order)
        .map(({ name, category, order }) => ({ name, category, order })),
    ).toEqual([
      { name: 'In verification', category: 'started', order: 0 },
      { name: backlog.name, category: 'unstarted', order: 1 },
      { name: 'Verified', category: 'completed', order: 2 },
    ])
    expect(store.read().data.issues.find(({ id }) => id === completedIssue.id)).toMatchObject({
      statusId: active.id,
      revision: completedIssue.revision + 1,
    })
    expect((await gateway.getBoardMetadata(project.workspaceId)).projects
      .find(({ project: candidate }) => candidate.id === project.id)?.statuses
      .map(({ name }) => name)).toEqual(['In verification', backlog.name, 'Verified'])
    expect((await gateway.getWorkspaceAnalytics({
      workspaceId: project.workspaceId,
      range: 'all-time',
    })).statusCategories)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 'completed', count: 1 }),
        expect.objectContaining({ value: 'started', count: 3 }),
        expect.objectContaining({ value: 'backlog', count: 0 }),
        expect.objectContaining({ value: 'unstarted', count: 2 }),
      ]))
    expect(store.read().data.activityEvents.slice(-2).map(({ action }) => action))
      .toEqual(['project.workflow.updated', 'issue.workflow.migrated'])
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'project.workflow.updated',
      metadata: { retiredCount: 1, migratedIssueCount: 1, toRevision: 2 },
    })
    expect(store.read().data.notifications.at(-1)).toMatchObject({
      kind: 'project-update',
      target: { kind: 'project', id: project.id },
      title: 'OPS workflow updated',
    })
    expect(tracer.read().at(-1)).toMatchObject({
      operation: 'analytics.get',
      phase: 'succeeded',
    })
  })

  it('rejects workflow category changes that complete blocked issues', async () => {
    const { fixtures, gateway, store } = createGateway()
    const project = fixtures.projects.find(({ key }) => key === 'OPS')
    const statuses = fixtures.workflowStatuses
      .filter(({ projectId }) => projectId === project?.id)
      .sort((left, right) => left.order - right.order)
    if (!project || statuses.length !== 3) throw new Error('Expected launch workflow.')

    const before = store.read()
    await expect(gateway.updateProjectWorkflow({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      statuses: statuses.map((status, index) => ({
        id: status.id,
        name: status.name,
        category: index === 0 ? 'completed' as const : status.category,
      })),
      migrations: [],
    })).rejects.toThrow('unfinished blocker')
    expect(store.read()).toEqual(before)
  })

  it('refuses to retire referenced workflow statuses without an explicit migration', async () => {
    const { fixtures, gateway, store } = createGateway()
    const project = fixtures.projects[0]
    const statuses = fixtures.workflowStatuses
      .filter(({ projectId }) => projectId === project?.id)
      .sort((left, right) => left.order - right.order)
    const retired = statuses[0]
    if (!project || !retired) throw new Error('Expected workflow migration fixtures.')
    const before = store.read()

    await expect(gateway.updateProjectWorkflow({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      statuses: statuses.slice(1).map((status) => ({
        id: status.id,
        name: status.name,
        category: status.category,
      })),
      migrations: [],
    })).rejects.toBeInstanceOf(GatewayConflictError)
    expect(store.read()).toEqual(before)
  })

  it('enforces workflow validation, authorization, no-op, and revision boundaries', async () => {
    const { fixtures, gateway } = createGateway()
    const project = fixtures.projects[0]
    const statuses = fixtures.workflowStatuses
      .filter(({ projectId }) => projectId === project?.id)
      .sort((left, right) => left.order - right.order)
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    if (!project || statuses.length < 2 || !viewerId) {
      throw new Error('Expected workflow validation fixtures.')
    }
    const unchanged = statuses.map((status) => ({
      id: status.id,
      name: status.name,
      category: status.category,
    }))

    await expect(gateway.updateProjectWorkflow({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      statuses: unchanged,
      migrations: [],
    })).rejects.toBeInstanceOf(InvalidGatewayRequestError)
    await expect(gateway.updateProjectWorkflow({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      statuses: unchanged.map((status) => ({ ...status, name: 'Duplicate' })),
      migrations: [],
    })).rejects.toBeInstanceOf(InvalidGatewayRequestError)
    await expect(gateway.updateProjectWorkflow({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      statuses: [
        ...unchanged,
        { id: null, name: statuses[0]?.name ?? 'Backlog', category: 'started' },
      ],
      migrations: [],
    })).rejects.toBeInstanceOf(InvalidGatewayRequestError)

    const changed = await gateway.updateProjectWorkflow({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      statuses: [
        ...unchanged,
        { id: null, name: 'Quality review', category: 'started' },
      ],
      migrations: [],
    })
    await expect(gateway.updateProjectWorkflow({
      projectId: project.id,
      expectedProjectRevision: project.revision,
      statuses: unchanged,
      migrations: [],
    })).rejects.toBeInstanceOf(GatewayConflictError)
    expect(changed.revision).toBe(2)
    expect((await gateway.getProjectWorkflowAdministration(project.id)).statuses
      .find(({ status }) => status.name === 'Quality review')?.status.id)
      .toBe('status_gateway_workflow_added_001')

    const { gateway: viewerGateway } = createGateway(new SimulatedNetwork(), viewerId)
    await expect(viewerGateway.getProjectWorkflowAdministration(project.id))
      .rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('returns filtered, sorted, and paginated issues asynchronously', async () => {
    const { fixtures, gateway, tracer } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    const projectId = fixtures.projects[0]?.id

    if (!workspaceId || !projectId) {
      throw new Error('Expected fixture workspace and project records.')
    }

    const result = await gateway.listIssues({
      filters: { workspaceId, projectIds: [projectId] },
      sort: { field: 'number', direction: 'descending' },
      page: { number: 1, size: 2 },
    })

    expect(result.items.map(({ number }) => number)).toEqual([3, 2])
    expect(result.totalItems).toBe(3)
    expect(tracer.read()).toMatchObject([
      { requestId: 'req_000001', operation: 'issue.list', phase: 'started' },
      { requestId: 'req_000001', operation: 'issue.list', phase: 'succeeded' },
    ])
  })

  it('isolates the actor notification inbox and persists read state', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    const actorId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    const unread = fixtures.notifications.find(
      (notification) =>
        notification.recipientId === actorId && notification.readAt === null,
    )

    if (!workspaceId || !unread) {
      throw new Error('Expected an unread administrative notification fixture.')
    }

    const inbox = await gateway.listNotifications({
      workspaceId,
      page: { number: 1, size: 1 },
    })
    expect(inbox.items).toHaveLength(1)
    expect(inbox).toMatchObject({ pageCount: 2, totalItems: 2 })
    expect(inbox.unreadCount).toBe(1)
    expect(inbox.categories).toEqual([
      { value: 'collaboration', count: 1 },
      { value: 'work', count: 1 },
    ])

    const collaboration = await gateway.listNotifications({
      workspaceId,
      category: 'collaboration',
    })
    expect(collaboration).toMatchObject({ totalItems: 1, unreadCount: 1 })
    expect(collaboration.items[0]?.kind).toBe('comment')
    expect(collaboration.matchingUnreadCount).toBe(1)

    const read = await gateway.listNotifications({ workspaceId, read: true })
    expect(read).toMatchObject({ totalItems: 1, unreadCount: 1, readCount: 1 })
    expect(read.items.every(({ readAt }) => readAt !== null)).toBe(true)

    const unreadOnly = await gateway.listNotifications({ workspaceId, read: false })
    expect(unreadOnly.items.map(({ id }) => id)).toEqual([unread.id])

    const older = await gateway.listNotifications({
      workspaceId,
      page: { number: 2, size: 1 },
    })
    expect(older.items).toHaveLength(1)
    expect(older.items[0]?.id).not.toBe(inbox.items[0]?.id)
    expect(older.unreadCount).toBe(1)

    const marked = await gateway.markNotificationRead({ id: unread.id, read: true })
    expect(marked.readAt).toBe('2026-02-01T08:00:00.000Z')
    expect(store.read().data.notifications.find(({ id }) => id === unread.id)?.readAt).toBe(
      '2026-02-01T08:00:00.000Z',
    )

    await gateway.markNotificationRead({ id: unread.id, read: false })
    await expect(
      gateway.updateNotificationsReadState({
        workspaceId,
        category: 'collaboration',
        currentRead: false,
        read: true,
      }),
    ).resolves.toBe(1)
    expect((await gateway.listNotifications({ workspaceId })).unreadCount).toBe(0)
    await gateway.markNotificationRead({ id: unread.id, read: false })
    await expect(
      gateway.updateNotificationsReadState({
        workspaceId,
        ids: [unread.id, unread.id],
        read: true,
      }),
    ).resolves.toBe(1)
    expect(tracer.read().some(({ operation }) => operation === 'notification.list')).toBe(
      true,
    )
  })

  it('rejects invalid notification page boundaries', async () => {
    const { fixtures, gateway } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    if (!workspaceId) throw new Error('Expected a fixture workspace.')

    await expect(
      gateway.listNotifications({
        workspaceId,
        page: { number: 1, size: 101 },
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
  })

  it('prevents actors from changing another recipient notification', async () => {
    const fixtures = createAtlasFixtures()
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    const administrativeNotification = fixtures.notifications[0]

    if (!viewerId || !administrativeNotification) {
      throw new Error('Expected viewer and notification fixtures.')
    }

    const { gateway } = createGateway(new SimulatedNetwork(), viewerId)
    await expect(
      gateway.markNotificationRead({
        id: administrativeNotification.id,
        read: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
    await expect(
      gateway.updateNotificationsReadState({
        workspaceId: fixtures.workspaces[0]?.id ?? administrativeNotification.workspaceId,
        ids: [administrativeNotification.id],
        read: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('enforces audit permission at the governance gateway boundary', async () => {
    const fixtures = createAtlasFixtures()
    const workspaceId = fixtures.workspaces[0]?.id
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    const adminId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    if (!workspaceId || !viewerId || !adminId) {
      throw new Error('Expected fixture workspace, viewer, and administrator.')
    }

    const store = new InMemoryDataStore(fixtures)
    const viewerGateway = new MockAtlasGateway({ actorId: viewerId, store })
    await expect(
      viewerGateway.getGovernanceReport({ workspaceId }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)

    const adminGateway = new MockAtlasGateway({ actorId: adminId, store })
    await expect(
      adminGateway.getGovernanceReport({ workspaceId }),
    ).resolves.toMatchObject({ totalEvents: fixtures.auditEvents.length })
  })

  it('updates notification preferences with revision and audit enforcement', async () => {
    const { fixtures, gateway, store } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    if (!workspaceId) throw new Error('Expected a fixture workspace.')

    const current = await gateway.getNotificationPreferences(workspaceId)
    const updated = await gateway.updateNotificationPreferences({
      workspaceId,
      expectedRevision: current.revision,
      assignments: current.assignments,
      comments: false,
      issueUpdates: current.issueUpdates,
      projectUpdates: current.projectUpdates,
    })
    expect(updated).toMatchObject({ comments: false, revision: 2 })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'notification.preferences.updated',
      outcome: 'succeeded',
      metadata: { revision: 2 },
    })
    await expect(
      gateway.updateNotificationPreferences({
        workspaceId,
        expectedRevision: current.revision,
        assignments: false,
        comments: false,
        issueUpdates: false,
        projectUpdates: false,
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('suppresses notification production according to recipient preferences', async () => {
    const fixtures = createAtlasFixtures()
    const adminId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    const issue = fixtures.issues.find(
      ({ assigneeId }) => assigneeId !== null && assigneeId !== adminId,
    )
    if (!adminId || !issue?.assigneeId) {
      throw new Error('Expected an administrator and externally assigned issue.')
    }
    const configured = {
      ...fixtures,
      notificationPreferences: fixtures.notificationPreferences.map((preferences) =>
        preferences.userId === issue.assigneeId
          ? { ...preferences, comments: false }
          : preferences,
      ),
    }
    const store = new InMemoryDataStore(configured)
    const gateway = new MockAtlasGateway({ actorId: adminId, store })
    const before = store.read().data.notifications.length

    await gateway.createComment({ issueId: issue.id, body: 'Delivery is disabled.' })
    expect(store.read().data.notifications).toHaveLength(before)
  })

  it('honors project update preferences for watched project delivery', async () => {
    const fixtures = createAtlasFixtures()
    const adminId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    const project = fixtures.projects.find(({ id }) =>
      fixtures.projectSubscriptions.some(({ projectId }) => projectId === id),
    )
    const followerId = fixtures.projectSubscriptions.find(
      ({ projectId }) => projectId === project?.id,
    )?.userId
    if (!adminId || !project || !followerId) {
      throw new Error('Expected an administrator and watched project fixture.')
    }
    const configured = {
      ...fixtures,
      notificationPreferences: fixtures.notificationPreferences.map((preferences) =>
        preferences.userId === followerId
          ? { ...preferences, projectUpdates: false }
          : preferences,
      ),
    }
    const store = new InMemoryDataStore(configured)
    const gateway = new MockAtlasGateway({ actorId: adminId, store })
    const before = store.read().data.notifications.length

    await gateway.updateProject({
      id: project.id,
      expectedRevision: project.revision,
      changes: { description: 'Delivery remains disabled.' },
    })

    expect(store.read().data.notifications).toHaveLength(before)
  })

  it('cancels in-flight reads and records a cancellation trace', async () => {
    vi.useFakeTimers()
    const simulator = new SimulatedNetwork({ latency: () => 5_000 })
    const { fixtures, gateway, tracer } = createGateway(simulator)
    const workspaceId = fixtures.workspaces[0]?.id
    const controller = new AbortController()

    if (!workspaceId) {
      throw new Error('Expected a fixture workspace.')
    }

    const request = gateway.listProjects(workspaceId, {
      signal: controller.signal,
    })
    controller.abort()

    await expect(request).rejects.toBeInstanceOf(RequestCancelledError)
    expect(tracer.read().map(({ phase }) => phase)).toEqual([
      'started',
      'cancelled',
    ])
  })

  it('honors cancellation after a zero-latency request has been queued', async () => {
    const { fixtures, gateway } = createGateway()
    const issue = fixtures.issues[0]
    const controller = new AbortController()

    if (!issue) {
      throw new Error('Expected a fixture issue.')
    }

    const request = gateway.getIssue(issue.id, { signal: controller.signal })
    controller.abort()

    await expect(request).rejects.toBeInstanceOf(RequestCancelledError)
  })

  it('surfaces simulated failures and records retryable error codes', async () => {
    const simulator = new SimulatedNetwork({
      failure: () => 'The mock service is unavailable.',
    })
    const { fixtures, gateway, tracer } = createGateway(simulator)
    const issue = fixtures.issues[0]

    if (!issue) {
      throw new Error('Expected a fixture issue.')
    }

    await expect(gateway.getIssue(issue.id)).rejects.toBeInstanceOf(
      SimulatedGatewayError,
    )
    expect(tracer.read()[1]).toMatchObject({
      phase: 'failed',
      errorCode: 'simulated-failure',
    })
  })

  it('creates an issue with the next project number and canonical metadata', async () => {
    const { fixtures, gateway, store } = createGateway()
    const template = fixtures.issues[0]

    if (!template) {
      throw new Error('Expected a fixture issue.')
    }

    const created = await gateway.createIssue({
      workspaceId: template.workspaceId,
      projectId: template.projectId,
      type: 'task',
      title: '  Confirm launch staffing  ',
      description: 'Verify launch-day on-call coverage.',
      statusId: template.statusId,
      priority: 'high',
      assigneeId: template.assigneeId,
      parentIssueId: null,
      dueDate: null,
      labelIds: [],
    })

    expect(created).toMatchObject({
      number: 4,
      title: 'Confirm launch staffing',
      revision: 1,
      createdAt: '2026-02-01T08:00:00.000Z',
    })
    expect(store.read().data.issues).toContainEqual(created)
  })

  it('returns creation metadata only for projects the actor can contribute to', async () => {
    const fixtures = createAtlasFixtures()
    const memberId = fixtures.memberships.find(({ role }) => role === 'member')?.userId
    const expectedProjectId = fixtures.projectMembers.find(
      ({ userId }) => userId === memberId,
    )?.projectId
    const workspaceId = fixtures.workspaces[0]?.id

    if (!memberId || !expectedProjectId || !workspaceId) {
      throw new Error('Expected project-scoped member fixtures.')
    }

    const { gateway } = createGateway(new SimulatedNetwork(), memberId)
    const metadata = await gateway.getIssueCreationMetadata(workspaceId)

    expect(metadata.projects).toHaveLength(1)
    expect(metadata.projects[0]?.project.id).toBe(expectedProjectId)
    expect(metadata.projects[0]?.statuses.map(({ order }) => order)).toEqual([
      0, 1, 2,
    ])
    expect(metadata.projects[0]?.assignees.map(({ displayName }) => displayName)).toEqual([
      'Lena Ortiz',
    ])
    expect(metadata.labels).toHaveLength(2)
  })

  it('returns ordered board workflows to read-only workspace members', async () => {
    const fixtures = createAtlasFixtures()
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    const workspaceId = fixtures.workspaces[0]?.id

    if (!viewerId || !workspaceId) {
      throw new Error('Expected viewer and workspace fixtures.')
    }

    const { gateway, tracer } = createGateway(new SimulatedNetwork(), viewerId)
    const metadata = await gateway.getBoardMetadata(workspaceId)

    expect(metadata.projects.map(({ project }) => project.name)).toEqual([
      'Field reliability',
      'Launch readiness',
    ])
    expect(
      metadata.projects.every(({ statuses }) =>
        statuses.every((status, index) => status.order === index),
      ),
    ).toBe(true)
    expect(tracer.read().at(-1)).toMatchObject({
      operation: 'board.metadata',
      phase: 'succeeded',
    })
  })

  it('returns workflow-aware issue filters for every visible project lifecycle', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const workspaceId = fixtures.workspaces[0]?.id
    const archivedProject = fixtures.projects[0]
    if (!workspaceId || !archivedProject) {
      throw new Error('Expected workspace and project fixtures.')
    }
    const current = store.read()
    store.commit(current.version, {
      ...current.data,
      projects: current.data.projects.map((project) =>
        project.id === archivedProject.id
          ? { ...project, status: 'archived' as const, revision: 2 }
          : project,
      ),
    })

    const metadata = await gateway.getIssueFilterMetadata(workspaceId)

    expect(metadata.projects.map(({ project }) => project.name)).toEqual([
      'Field reliability',
      'Launch readiness',
    ])
    expect(
      metadata.projects.find(({ project }) => project.id === archivedProject.id),
    ).toMatchObject({
      project: { status: 'archived' },
      statuses: [{ order: 0 }, { order: 1 }, { order: 2 }],
    })
    expect(tracer.read().at(-1)).toMatchObject({
      operation: 'issue.filter-metadata',
      phase: 'succeeded',
    })
  })

  it('rejects invalid creation references before committing data', async () => {
    const { fixtures, gateway, store } = createGateway()
    const project = fixtures.projects[0]
    const otherProjectStatus = fixtures.workflowStatuses.find(
      ({ projectId }) => projectId !== project?.id,
    )

    if (!project || !otherProjectStatus) {
      throw new Error('Expected multiple project workflows.')
    }

    const issueCount = store.read().data.issues.length
    await expect(
      gateway.createIssue({
        workspaceId: project.workspaceId,
        projectId: project.id,
        type: 'task',
        title: 'Invalid workflow issue',
        description: '',
        statusId: otherProjectStatus.id,
        priority: 'medium',
        assigneeId: null,
        parentIssueId: null,
        dueDate: null,
        labelIds: [],
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
    expect(store.read().data.issues).toHaveLength(issueCount)
  })

  it('rejects direct issue creation attempts from a read-only actor', async () => {
    const fixtures = createAtlasFixtures()
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    const template = fixtures.issues[0]

    if (!viewerId || !template) {
      throw new Error('Expected read-only actor and issue fixtures.')
    }

    const { gateway } = createGateway(new SimulatedNetwork(), viewerId)

    await expect(
      gateway.createIssue({
        workspaceId: template.workspaceId,
        projectId: template.projectId,
        type: template.type,
        title: 'Unauthorized issue',
        description: '',
        statusId: template.statusId,
        priority: template.priority,
        assigneeId: null,
        parentIssueId: null,
        dueDate: null,
        labelIds: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('excludes closed projects and rejects creation into them', async () => {
    const fixtures = createAtlasFixtures()
    const project = fixtures.projects[0]
    const template = fixtures.issues[0]
    const adminId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId

    if (!project || !template || !adminId) {
      throw new Error('Expected project, issue, and administrator fixtures.')
    }

    const closedFixtures = {
      ...fixtures,
      projects: fixtures.projects.map((candidate) =>
        candidate.id === project.id
          ? { ...candidate, status: 'completed' as const }
          : candidate,
      ),
    }
    const gateway = new MockAtlasGateway({
      actorId: adminId,
      store: new InMemoryDataStore(closedFixtures),
    })
    const metadata = await gateway.getIssueCreationMetadata(project.workspaceId)

    expect(metadata.projects.some(({ project: item }) => item.id === project.id)).toBe(
      false,
    )
    await expect(
      gateway.createIssue({
        workspaceId: template.workspaceId,
        projectId: template.projectId,
        type: template.type,
        title: 'Closed project work',
        description: '',
        statusId: template.statusId,
        priority: template.priority,
        assigneeId: null,
        parentIssueId: null,
        dueDate: null,
        labelIds: [],
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
  })

  it('updates with revision checks and rejects stale mutations', async () => {
    const { fixtures, gateway, store } = createGateway()
    const issue = fixtures.issues[0]

    if (!issue) {
      throw new Error('Expected a fixture issue.')
    }

    const updated = await gateway.updateIssue({
      id: issue.id,
      expectedRevision: issue.revision,
      changes: { title: 'Updated launch readiness brief', priority: 'high' },
    })

    expect(updated).toMatchObject({
      title: 'Updated launch readiness brief',
      priority: 'high',
      revision: issue.revision + 1,
    })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'issue.updated',
      requestId: 'req_000001',
      metadata: {
        issueId: issue.id,
        fromRevision: issue.revision,
        toRevision: issue.revision + 1,
      },
    })
    await expect(
      gateway.updateIssue({
        id: issue.id,
        expectedRevision: issue.revision,
        changes: { priority: 'low' },
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('moves issues only within their project workflow and records activity', async () => {
    const { fixtures, gateway, store } = createGateway()
    const issue = fixtures.issues[0]
    const projectStatuses = fixtures.workflowStatuses.filter(
      ({ projectId }) => projectId === issue?.projectId,
    )
    const targetStatus = projectStatuses.find(({ id }) => id !== issue?.statusId)
    const foreignStatus = fixtures.workflowStatuses.find(
      ({ projectId }) => projectId !== issue?.projectId,
    )

    if (!issue || !targetStatus || !foreignStatus) {
      throw new Error('Expected issue and workflow fixtures.')
    }

    const moved = await gateway.updateIssue({
      id: issue.id,
      expectedRevision: issue.revision,
      changes: { statusId: targetStatus.id },
    })

    expect(moved.statusId).toBe(targetStatus.id)
    expect(store.read().data.activityEvents.at(-1)).toMatchObject({
      action: 'issue.status_changed',
      entityId: issue.id,
    })
    expect(store.read().data.activityEvents.at(-1)?.summary).toContain(
      targetStatus.name,
    )
    await expect(
      gateway.updateIssue({
        id: issue.id,
        expectedRevision: moved.revision,
        changes: { statusId: foreignStatus.id },
      }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
    expect(store.read().data.issues.find(({ id }) => id === issue.id)?.statusId).toBe(
      targetStatus.id,
    )
  })

  it('requires blocking issues to be completed before their dependents', async () => {
    const { fixtures, gateway, store } = createGateway()
    const relation = fixtures.issueRelations.find(({ type }) => type === 'blocks')
    const blocker = fixtures.issues.find(({ id }) => id === relation?.sourceIssueId)
    const dependent = fixtures.issues.find(({ id }) => id === relation?.targetIssueId)
    const completed = fixtures.workflowStatuses.find(({ projectId, category }) =>
      projectId === dependent?.projectId && category === 'completed')
    if (!blocker || !dependent || !completed) throw new Error('Expected blocking fixtures.')

    const before = store.read()
    await expect(gateway.updateIssue({
      id: dependent.id, expectedRevision: dependent.revision, changes: { statusId: completed.id },
    })).rejects.toThrow(/Complete .* before moving dependent work/)
    expect(store.read()).toEqual(before)

    const finishedBlocker = await gateway.updateIssue({
      id: blocker.id, expectedRevision: blocker.revision, changes: { statusId: completed.id },
    })
    const finishedDependent = await gateway.updateIssue({
      id: dependent.id, expectedRevision: dependent.revision, changes: { statusId: completed.id },
    })
    expect(finishedDependent.statusId).toBe(completed.id)
    await expect(gateway.updateIssue({
      id: blocker.id, expectedRevision: finishedBlocker.revision,
      changes: { statusId: blocker.statusId },
    })).rejects.toThrow(/Complete .* before moving dependent work/)
    expect(store.read().data.issues.find(({ id }) => id === blocker.id)?.statusId).toBe(completed.id)
  })

  it('rejects adding an unfinished blocker to already completed work', async () => {
    const { fixtures, gateway, store } = createGateway()
    const source = fixtures.issues.find(({ title }) => title.includes('risk review'))
    const target = fixtures.issues.find(({ title }) => title.includes('runbook'))
    if (!source || !target) throw new Error('Expected launch issues.')

    const before = store.read()
    await expect(gateway.createIssueRelation({
      sourceIssueId: source.id, targetIssueId: target.id, type: 'blocks',
      expectedSourceRevision: source.revision, expectedTargetRevision: target.revision,
    })).rejects.toThrow('Complete the blocking issue')
    expect(store.read()).toEqual(before)
  })

  it('creates a comment with deterministic activity and audit records', async () => {
    const { fixtures, gateway, store } = createGateway()
    const issue = fixtures.issues[0]

    if (!issue) throw new Error('Expected a fixture issue.')

    const comment = await gateway.createComment({
      issueId: issue.id,
      body: '  Confirmed the rollback owner and escalation window.  ',
    })

    expect(comment).toMatchObject({
      issueId: issue.id,
      body: 'Confirmed the rollback owner and escalation window.',
      revision: 1,
      createdAt: '2026-02-01T08:00:00.000Z',
      editedAt: null,
      deletedAt: null,
    })
    const snapshot = store.read().data
    expect(snapshot.activityEvents.at(-1)).toMatchObject({
      entityId: issue.id,
      action: 'comment.created',
      summary: 'Added a comment.',
    })
    expect(snapshot.auditEvents.at(-1)).toMatchObject({
      requestId: 'req_000001',
      action: 'comment.created',
      outcome: 'succeeded',
      metadata: { issueId: issue.id, commentId: comment.id },
    })

    const activity = await gateway.getIssueActivity(issue.id)
    expect(activity.comments[0]).toEqual(comment)
    expect(activity.activityEvents[0]?.action).toBe('comment.created')
    expect(activity.users.some(({ id }) => id === comment.authorId)).toBe(true)
  })

  it('edits author comments with revision and audit enforcement', async () => {
    const fixtures = createAtlasFixtures()
    const comment = fixtures.comments[0]
    const authorId = comment?.authorId
    if (!comment || !authorId) throw new Error('Expected an authored comment fixture.')
    const { gateway, store } = createGateway(new SimulatedNetwork(), authorId)

    const updated = await gateway.updateComment({
      id: comment.id,
      expectedRevision: comment.revision,
      body: '  Include named rollback and escalation owners.  ',
    })

    expect(updated).toMatchObject({
      body: 'Include named rollback and escalation owners.',
      revision: 2,
      editedAt: '2026-02-01T08:00:00.000Z',
    })
    expect(store.read().data.activityEvents.at(-1)).toMatchObject({
      action: 'comment.updated',
      summary: 'Edited a comment.',
    })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'comment.updated',
      metadata: { commentId: comment.id, revision: 2 },
    })
    await expect(
      gateway.updateComment({
        id: comment.id,
        expectedRevision: comment.revision,
        body: 'Overwrite a stale revision.',
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('reconciles edited mentions atomically and only notifies newly mentioned members', async () => {
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[1]
    const mentioned = fixtures.users.find(({ displayName }) => displayName === 'Lena Ortiz')
    if (!issue || !mentioned) throw new Error('Expected issue and mention fixtures.')
    const actorId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    if (!actorId) throw new Error('Expected an administrator fixture.')
    const store = new InMemoryDataStore(fixtures)
    const gateway = new MockAtlasGateway({
      actorId,
      store,
      clock: new FixedClock(isoDateTime('2026-02-01T08:00:00.000Z')),
      idGenerator: new DeterministicIdGenerator('mention_edit'),
    })
    const comment = await gateway.createComment({
      issueId: issue.id,
      body: 'Initial review request.',
    })

    const added = await gateway.updateComment({
      id: comment.id,
      expectedRevision: comment.revision,
      body: 'Please review this, @Lena Ortiz.',
      mentionedUserIds: [mentioned.id],
    })
    expect(store.read().data.commentMentions).toEqual([
      expect.objectContaining({
        commentId: comment.id,
        userId: mentioned.id,
        removedAt: null,
      }),
    ])
    expect(store.read().data.notifications.at(-1)).toMatchObject({
      recipientId: mentioned.id,
      kind: 'mention',
      body: added.body,
    })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'comment.updated',
      metadata: {
        addedMentionCount: 1,
        removedMentionCount: 0,
        notificationCount: 1,
      },
    })

    const notificationCount = store.read().data.notifications.length
    const removed = await gateway.updateComment({
      id: added.id,
      expectedRevision: added.revision,
      body: 'The review request is complete.',
      mentionedUserIds: [],
    })
    expect(store.read().data.commentMentions[0]?.removedAt).toBe(
      '2026-02-01T08:00:00.000Z',
    )
    expect(store.read().data.notifications).toHaveLength(notificationCount)
    expect((await gateway.getIssueActivity(issue.id)).commentMentions).toEqual([])

    await gateway.updateComment({
      id: removed.id,
      expectedRevision: removed.revision,
      body: 'Please recheck this, @Lena Ortiz.',
      mentionedUserIds: [mentioned.id],
    })
    expect(store.read().data.commentMentions).toHaveLength(1)
    expect(store.read().data.commentMentions[0]?.removedAt).toBeNull()
    expect(store.read().data.notifications).toHaveLength(notificationCount + 1)
  })

  it('tombstones moderated comments and rejects authorization bypasses', async () => {
    const fixtures = createAtlasFixtures()
    const comment = fixtures.comments[0]
    const adminId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    if (!comment || !adminId || !viewerId) {
      throw new Error('Expected comment, administrator, and viewer fixtures.')
    }
    const store = new InMemoryDataStore(fixtures)
    const adminGateway = new MockAtlasGateway({ actorId: adminId, store })
    const viewerGateway = new MockAtlasGateway({ actorId: viewerId, store })

    await expect(
      adminGateway.updateComment({
        id: comment.id,
        expectedRevision: comment.revision,
        body: 'Moderators may not rewrite another author.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
    await expect(
      viewerGateway.deleteComment({
        id: comment.id,
        expectedRevision: comment.revision,
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)

    const deleted = await adminGateway.deleteComment({
      id: comment.id,
      expectedRevision: comment.revision,
    })
    expect(deleted).toMatchObject({
      body: '',
      revision: 2,
      deletedById: adminId,
    })
    expect(deleted.deletedAt).not.toBeNull()
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'comment.moderated',
      metadata: { moderated: true, commentId: comment.id },
    })
    await expect(
      adminGateway.deleteComment({
        id: comment.id,
        expectedRevision: comment.revision,
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('manages issue subscriptions with expected-state conflicts and durable history', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const actorId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    const issue = fixtures.issues.find(
      ({ id }) =>
        !fixtures.issueSubscriptions.some(
          ({ issueId, userId }) => issueId === id && userId === actorId,
        ),
    )
    if (!actorId || !issue) throw new Error('Expected an unwatched issue fixture.')

    const initial = await gateway.getIssueSubscription(issue.id)
    expect(initial).toMatchObject({ subscribed: false, subscribers: [] })

    const watched = await gateway.setIssueSubscription({
      issueId: issue.id,
      expectedSubscribed: false,
      subscribed: true,
    })
    expect(watched.subscribed).toBe(true)
    expect(watched.subscribers.map(({ id }) => id)).toEqual([actorId])
    expect(store.read().data.activityEvents.at(-1)).toMatchObject({
      action: 'issue.subscribed',
      summary: 'Started watching this issue.',
    })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'issue.subscribed',
      metadata: { issueId: issue.id, subscribed: true },
    })
    await expect(
      gateway.setIssueSubscription({
        issueId: issue.id,
        expectedSubscribed: false,
        subscribed: true,
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)

    const unwatched = await gateway.setIssueSubscription({
      issueId: issue.id,
      expectedSubscribed: true,
      subscribed: false,
    })
    expect(unwatched).toMatchObject({ subscribed: false, subscribers: [] })
    expect(tracer.read().filter(({ phase }) => phase === 'succeeded')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'issue.subscription.get' }),
        expect.objectContaining({ operation: 'issue.subscription.update' }),
      ]),
    )
  })

  it('manages project subscriptions with expected-state conflicts and durable history', async () => {
    const { fixtures, gateway, store, tracer } = createGateway()
    const actorId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    const project = fixtures.projects.find(
      ({ id }) =>
        !fixtures.projectSubscriptions.some(
          ({ projectId, userId }) => projectId === id && userId === actorId,
        ),
    )
    const existingSubscriber = fixtures.projectSubscriptions.find(
      ({ projectId }) => projectId === project?.id,
    )?.userId
    if (!actorId || !project || !existingSubscriber) {
      throw new Error('Expected an unwatched project with a follower fixture.')
    }

    const initial = await gateway.getProjectSubscription(project.id)
    expect(initial.subscribed).toBe(false)
    expect(initial.subscribers.map(({ id }) => id)).toEqual([existingSubscriber])

    const watched = await gateway.setProjectSubscription({
      projectId: project.id,
      expectedSubscribed: false,
      subscribed: true,
    })
    expect(watched.subscribed).toBe(true)
    expect(watched.subscribers.map(({ id }) => id)).toEqual(
      expect.arrayContaining([actorId, existingSubscriber]),
    )
    expect(store.read().data.activityEvents.at(-1)).toMatchObject({
      action: 'project.subscribed',
      summary: 'Started watching this project.',
    })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      action: 'project.subscribed',
      metadata: { projectId: project.id, subscribed: true },
    })
    await expect(
      gateway.setProjectSubscription({
        projectId: project.id,
        expectedSubscribed: false,
        subscribed: true,
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)

    const unwatched = await gateway.setProjectSubscription({
      projectId: project.id,
      expectedSubscribed: true,
      subscribed: false,
    })
    expect(unwatched.subscribed).toBe(false)
    expect(unwatched.subscribers.map(({ id }) => id)).toEqual([existingSubscriber])
    expect(tracer.read().filter(({ phase }) => phase === 'succeeded')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'project.subscription.get' }),
        expect.objectContaining({ operation: 'project.subscription.update' }),
      ]),
    )
  })

  it('lets read-only members watch projects without granting mutation access', async () => {
    const fixtures = createAtlasFixtures()
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    const project = fixtures.projects[0]
    if (!viewerId || !project) throw new Error('Expected viewer and project fixtures.')
    const { gateway } = createGateway(new SimulatedNetwork(), viewerId)

    const result = await gateway.setProjectSubscription({
      projectId: project.id,
      expectedSubscribed: false,
      subscribed: true,
    })
    expect(result.subscribed).toBe(true)
    await expect(
      gateway.updateProject({
        id: project.id,
        expectedRevision: project.revision,
        changes: { description: 'Unauthorized update.' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('prevents archived projects from gaining new watchers', async () => {
    const { fixtures, gateway } = createGateway()
    const project = fixtures.projects[0]
    if (!project) throw new Error('Expected a project fixture.')

    await gateway.archiveProject({
      id: project.id,
      expectedRevision: project.revision,
    })

    await expect(
      gateway.setProjectSubscription({
        projectId: project.id,
        expectedSubscribed: false,
        subscribed: true,
      }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('lets read-only members watch issues without granting mutation access', async () => {
    const fixtures = createAtlasFixtures()
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId
    const issue = fixtures.issues[0]
    if (!viewerId || !issue) throw new Error('Expected viewer and issue fixtures.')
    const { gateway } = createGateway(new SimulatedNetwork(), viewerId)

    const result = await gateway.setIssueSubscription({
      issueId: issue.id,
      expectedSubscribed: false,
      subscribed: true,
    })
    expect(result).toMatchObject({ subscribed: true })
    await expect(
      gateway.updateIssue({
        id: issue.id,
        expectedRevision: issue.revision,
        changes: { priority: 'low' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('fans comments out once to active followers and auto-subscribes authors', async () => {
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[1]
    const actorId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    const engineerId = fixtures.users.find(({ email }) => email === 'lena@example.test')?.id
    if (!issue || !actorId || !engineerId || !issue.assigneeId) {
      throw new Error('Expected collaboration fan-out fixtures.')
    }
    const store = new InMemoryDataStore({
      ...fixtures,
      issueSubscriptions: [
        ...fixtures.issueSubscriptions,
        {
          id: issueSubscriptionId('subscription_test_assignee_001'),
          issueId: issue.id,
          userId: issue.assigneeId,
          createdAt: isoDateTime('2026-01-15T09:00:00.000Z'),
        },
        {
          id: issueSubscriptionId('subscription_test_engineer_001'),
          issueId: issue.id,
          userId: engineerId,
          createdAt: isoDateTime('2026-01-15T09:00:00.000Z'),
        },
      ],
    })
    const gateway = new MockAtlasGateway({
      actorId,
      store,
      clock: new FixedClock(isoDateTime('2026-02-01T08:00:00.000Z')),
      idGenerator: new DeterministicIdGenerator('fanout'),
    })

    await gateway.createComment({ issueId: issue.id, body: 'Follower update one.' })
    const firstNotifications = store.read().data.notifications.filter(
      ({ occurredAt }) => occurredAt === '2026-02-01T08:00:00.000Z',
    )
    expect(firstNotifications.map(({ recipientId }) => recipientId).sort()).toEqual(
      [engineerId, issue.assigneeId].sort(),
    )
    expect(new Set(firstNotifications.map(({ recipientId }) => recipientId)).size).toBe(2)
    expect(
      store.read().data.issueSubscriptions.some(
        ({ issueId, userId }) => issueId === issue.id && userId === actorId,
      ),
    ).toBe(true)
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      metadata: { notificationCount: 2, autoSubscribed: true },
    })

    const current = store.read()
    store.commit(current.version, {
      ...current.data,
      memberships: current.data.memberships.map((membership) =>
        membership.userId === engineerId
          ? { ...membership, status: 'suspended' as const, revision: 2 }
          : membership,
      ),
    })
    await gateway.createComment({ issueId: issue.id, body: 'Follower update two.' })
    const latestNotifications = store.read().data.notifications.filter(
      ({ body }) => body === 'Follower update two.',
    )
    expect(latestNotifications.map(({ recipientId }) => recipientId)).toEqual([
      issue.assigneeId,
    ])
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      metadata: { notificationCount: 1, autoSubscribed: false },
    })
  })

  it('resolves durable mentions and prioritizes mention notifications', async () => {
    const { fixtures, gateway, store } = createGateway()
    const issue = fixtures.issues[1]
    const mentioned = fixtures.users.find(({ displayName }) => displayName === 'Lena Ortiz')
    if (!issue || !mentioned) throw new Error('Expected mention fixtures.')
    const duplicateName = fixtures.users.find(({ displayName }) => displayName === 'Theo Martin')
    if (!duplicateName) throw new Error('Expected a duplicate-name candidate.')
    const beforeMention = store.read()
    store.commit(beforeMention.version, {
      ...beforeMention.data,
      users: beforeMention.data.users.map((user) =>
        user.id === duplicateName.id ? { ...user, displayName: mentioned.displayName } : user,
      ),
    })

    const comment = await gateway.createComment({
      issueId: issue.id,
      body: 'Please review @Lena Ortiz, then ask @Lena Ortiz for approval.',
      mentionedUserIds: [mentioned.id, mentioned.id],
    })
    expect(store.read().data.commentMentions).toEqual([
      expect.objectContaining({ commentId: comment.id, userId: mentioned.id }),
    ])
    const mentionNotification = store.read().data.notifications.find(
      ({ recipientId, body }) =>
        recipientId === mentioned.id && body === comment.body.slice(0, 160),
    )
    expect(mentionNotification?.kind).toBe('mention')
    expect(mentionNotification?.title).toContain('You were mentioned on')
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      metadata: { mentionCount: 1, notificationCount: 2 },
    })

    await gateway.createComment({
      issueId: issue.id,
      body: 'A partial @Lena token is ordinary comment text.',
    })
    expect(store.read().data.auditEvents.at(-1)).toMatchObject({
      metadata: { mentionCount: 0 },
    })
  })

  it('creates notifications at the mutation boundary for non-actor assignees', async () => {
    const { fixtures, gateway, store } = createGateway()
    const adminId = fixtures.memberships.find(({ role }) => role === 'admin')?.userId
    const issue = fixtures.issues.find(
      ({ assigneeId }) => assigneeId !== null && assigneeId !== adminId,
    )

    if (!issue?.assigneeId) {
      throw new Error('Expected an issue assigned to another fixture user.')
    }

    await gateway.createComment({ issueId: issue.id, body: 'Please review this update.' })
    expect(store.read().data.notifications.at(-1)).toMatchObject({
      recipientId: issue.assigneeId,
      target: { kind: 'issue', id: issue.id },
      kind: 'comment',
      readAt: null,
    })

    const current = store.read().data.issues.find(({ id }) => id === issue.id)
    if (!current) throw new Error('Expected the issue after comment creation.')
    await gateway.updateIssue({
      id: current.id,
      expectedRevision: current.revision,
      changes: { priority: 'urgent' },
    })
    expect(store.read().data.notifications.at(-1)).toMatchObject({
      recipientId: issue.assigneeId,
      target: { kind: 'issue', id: issue.id },
      kind: 'issue-update',
    })
  })

  it('rejects invalid and permission-bypassing comment submissions', async () => {
    const fixtures = createAtlasFixtures()
    const issue = fixtures.issues[0]
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId

    if (!issue || !viewerId) {
      throw new Error('Expected issue and viewer fixtures.')
    }

    const { gateway: adminGateway, store } = createGateway()
    const originalCommentCount = store.read().data.comments.length
    await expect(
      adminGateway.createComment({ issueId: issue.id, body: '   ' }),
    ).rejects.toBeInstanceOf(InvalidGatewayRequestError)
    expect(store.read().data.comments).toHaveLength(originalCommentCount)

    const { gateway: viewerGateway } = createGateway(
      new SimulatedNetwork(),
      viewerId,
    )
    await expect(
      viewerGateway.createComment({ issueId: issue.id, body: 'Bypass attempt' }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('rejects mutation bypass attempts for a read-only actor', async () => {
    const fixtures = createAtlasFixtures()
    const viewerId = fixtures.memberships.find(({ role }) => role === 'viewer')?.userId

    if (!viewerId) {
      throw new Error('Expected a read-only fixture actor.')
    }

    const { gateway, tracer } = createGateway(new SimulatedNetwork(), viewerId)
    const issue = fixtures.issues[0]

    if (!issue) {
      throw new Error('Expected a fixture issue.')
    }

    await expect(
      gateway.updateIssue({
        id: issue.id,
        expectedRevision: issue.revision,
        changes: { priority: 'low' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
    expect(tracer.read().at(-1)).toMatchObject({
      operation: 'issue.update',
      phase: 'failed',
      errorCode: 'forbidden',
    })
  })

  it('limits member mutations to projects where the actor has a project role', async () => {
    const fixtures = createAtlasFixtures()
    const memberId = fixtures.memberships.find(({ role }) => role === 'member')?.userId
    const permittedProject = fixtures.projectMembers.find(
      ({ userId }) => userId === memberId,
    )?.projectId
    const permittedIssue = fixtures.issues.find(
      ({ projectId }) => projectId === permittedProject,
    )
    const deniedIssue = fixtures.issues.find(
      ({ projectId }) => projectId !== permittedProject,
    )

    if (!memberId || !permittedIssue || !deniedIssue) {
      throw new Error('Expected project-scoped member fixtures.')
    }

    const { gateway } = createGateway(new SimulatedNetwork(), memberId)

    await expect(
      gateway.updateIssue({
        id: permittedIssue.id,
        expectedRevision: permittedIssue.revision,
        changes: { priority: 'medium' },
      }),
    ).resolves.toMatchObject({ priority: 'medium' })
    await expect(
      gateway.updateIssue({
        id: deniedIssue.id,
        expectedRevision: deniedIssue.revision,
        changes: { priority: 'medium' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenGatewayError)
  })

  it('denies reads when workspace membership is suspended', async () => {
    const fixtures = createAtlasFixtures()
    const actor = fixtures.memberships.find(({ role }) => role === 'viewer')

    if (!actor) {
      throw new Error('Expected a fixture actor.')
    }

    const suspendedFixtures = {
      ...fixtures,
      memberships: fixtures.memberships.map((membership) =>
        membership.id === actor.id
          ? { ...membership, status: 'suspended' as const }
          : membership,
      ),
    }
    const gateway = new MockAtlasGateway({
      actorId: actor.userId,
      store: new InMemoryDataStore(suspendedFixtures),
    })

    await expect(gateway.listProjects(actor.workspaceId)).rejects.toBeInstanceOf(
      ForbiddenGatewayError,
    )
  })

  it('deletes a leaf issue and its related comments and relations', async () => {
    const { fixtures, gateway, store } = createGateway()
    const issue = fixtures.issues.find(({ number, projectId }) => {
      const firstProject = fixtures.projects[0]
      return number === 1 && projectId === firstProject?.id
    })

    if (!issue) {
      throw new Error('Expected the launch brief fixture issue.')
    }

    await gateway.deleteIssue({ id: issue.id, expectedRevision: issue.revision })

    const snapshot = store.read().data
    expect(snapshot.issues.some(({ id }) => id === issue.id)).toBe(false)
    expect(snapshot.comments.some(({ issueId }) => issueId === issue.id)).toBe(false)
    expect(
      snapshot.activityEvents.some(
        ({ entityKind, entityId }) =>
          entityKind === 'issue' && entityId === issue.id,
      ),
    ).toBe(false)
    expect(
      snapshot.issueRelations.some(
        ({ sourceIssueId, targetIssueId }) =>
          sourceIssueId === issue.id || targetIssueId === issue.id,
      ),
    ).toBe(false)
  })

  it('protects parents with subtasks from deletion', async () => {
    const { fixtures, gateway } = createGateway()
    const child = fixtures.issues.find(({ parentIssueId }) => parentIssueId !== null)
    const parent = fixtures.issues.find(({ id }) => id === child?.parentIssueId)

    if (!parent) {
      throw new Error('Expected a parent issue fixture.')
    }

    await expect(
      gateway.deleteIssue({ id: parent.id, expectedRevision: parent.revision }),
    ).rejects.toBeInstanceOf(GatewayConflictError)
  })

  it('returns a typed not-found failure for missing entities', async () => {
    const { gateway } = createGateway()

    await expect(
      gateway.getIssue(issueId('issue_missing_record')),
    ).rejects.toBeInstanceOf(EntityNotFoundError)
  })
})
