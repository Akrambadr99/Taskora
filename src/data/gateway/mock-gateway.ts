import { StorageConflictError } from '../workspace-storage'
import { exportWorkspace, parseWorkspaceArchive, mergeWorkspace, describeChanges, rebaseRevisions } from '../workspace-backup'
import type { IssueRelation } from '../../domain'
import type {
  AtlasGateway,
  WorkspaceRecoveryPreview,
  IssueRelationshipData,
  CreateIssueRelationInput,
  RemoveIssueRelationInput,
  AddProjectMemberInput,
  ArchiveProjectInput,
  AuthorizationSession,
  BoardMetadata,
  CreateCommentInput,
  CreateIssueInput,
  CreateProjectInput,
  CreateWorkspaceInvitationInput,
  DeleteCommentInput,
  DeleteIssueInput,
  GovernanceQuery,
  GovernanceReport,
  IssueCreationMetadata,
  IssueFilterMetadata,
  IssueActivityData,
  IssueSubscriptionData,
  IssueQuery,
  MarkNotificationReadInput,
  NotificationInbox,
  NotificationQuery,
  Page,
  ProjectSummaryQuery,
  ProjectCreationMetadata,
  ProjectEditMetadata,
  ProjectMembershipAdministrationData,
  ProjectMembershipQuery,
  ProjectLeadTransferData,
  ProjectWorkflowAdministrationData,
  ProjectActivityData,
  ProjectSubscriptionData,
  RequestOptions,
  RemoveProjectMemberInput,
  ResendWorkspaceInvitationInput,
  SetIssueSubscriptionInput,
  SetProjectSubscriptionInput,
  RevokeWorkspaceInvitationInput,
  ActivateWorkspaceInvitationInput,
  TransferProjectLeadInput,
  UpdateIssueInput,
  UpdateCommentInput,
  UpdateNotificationPreferencesInput,
  UpdateNotificationsReadStateInput,
  UpdateProjectInput,
  UpdateProjectMemberInput,
  UpdateProjectWorkflowInput,
  UpdateWorkspaceMembershipInput,
  WorkspaceAdministrationData,
  WorkspaceAdministrationQuery,
  WorkspaceAnalytics,
  WorkspaceAnalyticsQuery,
  WorkspaceInvitationActivation,
  WorkspaceInvitationAdministrationData,
  WorkspaceInvitationEffectiveState,
  WorkspaceInvitationQuery,
  WorkspaceActivityData,
  WorkspaceActivityQuery,
} from './contracts'
import { buildWorkspaceAnalytics } from './analytics'
import { buildWorkspaceActivity } from './activity'
import { buildGovernanceReport } from './governance'
import {
  EntityNotFoundError,
  ForbiddenGatewayError,
  GatewayConflictError,
  GatewayError,
  InvalidGatewayRequestError,
  RequestCancelledError,
  SessionExpiredGatewayError,
} from './errors'
import { paginate, queryIssues, validatePage } from './query'
import { queryProjectSummaries } from './project-summary'
import { SimulatedNetwork, type RequestSimulator } from './simulation'
import {
  noopRequestTracer,
  type GatewayOperation,
  type RequestTracer,
} from './tracing'
import { SystemClock, type Clock } from '../clock'
import { DeterministicIdGenerator } from '../id-generator'
import type { AtlasDataSnapshot } from '../snapshot'
import { StaleSnapshotError, type InMemoryDataStore } from '../store'
import {
  can,
  getPermissionFingerprint,
  type ActivityEvent,
  type AuditEvent,
  type Comment,
  type Issue,
  type IssueId,
  type IsoDateTime,
  type Notification,
  type NotificationKind,
  type NotificationPreferences,
  type Membership,
  type MembershipStatus,
  type Permission,
  type Project,
  type ProjectId,
  type ProjectMember,
  type ProjectStatus,
  type WorkflowStatus,
  type WorkflowStatusCategory,
  type WorkflowStatusId,
  type UserId,
  type WorkspaceId,
  type WorkspaceInvitation,
  type WorkspaceInvitationRole,
  type WorkspaceRole,
  isoDate,
  isoDateTime,
  notificationCategory,
} from '../../domain'

const openProjectStatuses: ReadonlySet<Project['status']> = new Set([
  'planned',
  'active',
  'paused',
])

const projectStatusTransitions: Readonly<Record<ProjectStatus, ReadonlySet<ProjectStatus>>> = {
  planned: new Set(['active', 'paused', 'completed']),
  active: new Set(['paused', 'completed']),
  paused: new Set(['active', 'completed']),
  completed: new Set(['active']),
  archived: new Set(),
}

const workflowCategories: ReadonlySet<WorkflowStatusCategory> = new Set([
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
])

const workspaceRoles: ReadonlySet<WorkspaceRole> = new Set([
  'owner',
  'admin',
  'member',
  'viewer',
])
const membershipStatuses: ReadonlySet<MembershipStatus> = new Set([
  'invited',
  'active',
  'suspended',
])
const workspaceInvitationRoles: ReadonlySet<WorkspaceInvitationRole> = new Set([
  'admin',
  'member',
  'viewer',
])
const invitationEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const invitationLifetimeMilliseconds = 7 * 24 * 60 * 60 * 1_000
const assignableProjectRoles = new Set<ProjectMember['role']>([
  'contributor',
  'viewer',
])

export interface MockAtlasGatewayOptions {
  readonly store: InMemoryDataStore
  readonly actorId: UserId
  readonly clock?: Clock
  readonly idGenerator?: DeterministicIdGenerator
  readonly simulator?: RequestSimulator
  readonly tracer?: RequestTracer
}

function compareTimelineEntries(
  left: Comment | ActivityEvent,
  right: Comment | ActivityEvent,
): number {
  const leftTimestamp = 'createdAt' in left ? left.createdAt : left.occurredAt
  const rightTimestamp = 'createdAt' in right ? right.createdAt : right.occurredAt

  return (
    rightTimestamp.localeCompare(leftTimestamp) || right.id.localeCompare(left.id)
  )
}

export class MockAtlasGateway implements AtlasGateway {
  private readonly store: InMemoryDataStore
  private readonly actorId: UserId
  private readonly clock: Clock
  private readonly ids: DeterministicIdGenerator
  private readonly simulator: RequestSimulator
  private readonly tracer: RequestTracer
  private requestSequence = 0
  private reservedVersion = -1
  private recoveryPreview: { readonly view: WorkspaceRecoveryPreview; readonly data: AtlasDataSnapshot } | null = null


  constructor(options: MockAtlasGatewayOptions) {
    this.store = options.store
    this.actorId = options.actorId
    this.clock = options.clock ?? new SystemClock()
    this.ids = options.idGenerator ?? new DeterministicIdGenerator('gateway')
    this.simulator = options.simulator ?? new SimulatedNetwork()
    this.tracer = options.tracer ?? noopRequestTracer
    this.reserveSnapshotIds()
  }

  private reserveSnapshotIds(): void {
    const snapshot = this.store.read()
    if (snapshot.version === this.reservedVersion) return
    for (const rows of Object.values<readonly { readonly id: string }[]>({ ...snapshot.data })) {
      this.ids.reserve(rows.map((row) => row.id))
    }
    this.reservedVersion = snapshot.version
  }

  exportWorkspaceBackup(workspaceId: WorkspaceId, options?: RequestOptions): Promise<string> {
    return this.execute('workspace.backup.export', options, () => {
      this.assertPermission('members:manage', workspaceId)
      return exportWorkspace(this.store.read(), workspaceId, this.clock.now())
    })
  }

  previewWorkspaceRecovery(workspaceId: WorkspaceId, content: string, options?: RequestOptions): Promise<WorkspaceRecoveryPreview> {
    return this.execute('workspace.backup.preview', options, (requestId) => {
      this.recoveryPreview = null
      this.assertPermission('members:manage', workspaceId)
      const archive = parseWorkspaceArchive(content)
      if (archive.workspaceId !== workspaceId) throw new InvalidGatewayRequestError('This backup belongs to another workspace.')
      const current = this.store.read()
      const workspace = current.data.workspaces.find((row) => row.id === workspaceId)
      if (!workspace) throw new EntityNotFoundError('Workspace')
      const data = mergeWorkspace(current.data, archive)
      this.assertRecoveryAuthority(current.data, data, workspaceId)
      const view: WorkspaceRecoveryPreview = {
        token: requestId, workspaceId, workspaceName: workspace.name, expectedVersion: current.version,
        exportedAt: archive.exportedAt,
        expiresAt: isoDateTime(new Date(new Date(this.clock.now()).valueOf() + 10 * 60_000).toISOString()),
        changes: describeChanges(current.data, data),
      }
      this.recoveryPreview = { view, data }
      return structuredClone(view)
    })
  }

  restoreWorkspaceBackup(input: { readonly token: string; readonly workspaceId: WorkspaceId; readonly confirmation: string }, options?: RequestOptions): Promise<void> {
    return this.execute('workspace.backup.restore', options, (requestId) => {
      this.assertPermission('members:manage', input.workspaceId)
      const preview = this.recoveryPreview
      if (preview?.view.token !== input.token || preview.view.workspaceId !== input.workspaceId) {
        throw new GatewayConflictError('Recovery preview is no longer available. Preview the backup again.')
      }
      if (input.confirmation !== preview.view.workspaceName) throw new InvalidGatewayRequestError('Type the current workspace name to confirm replacement.')
      const current = this.store.read()
      if (current.version !== preview.view.expectedVersion || this.clock.now() >= preview.view.expiresAt) {
        this.recoveryPreview = null
        throw new GatewayConflictError('Workspace changed or the preview expired. Preview the backup again.')
      }
      this.assertRecoveryAuthority(current.data, preview.data, input.workspaceId)
      const data = rebaseRevisions(current.data, preview.data, input.workspaceId)
      this.ids.reserve(data.auditEvents.map((event) => event.id))
      const audit: AuditEvent = { id: this.ids.audit('recovery'), workspaceId: input.workspaceId,
        actorId: this.actorId, requestId, action: 'workspace.recovered', outcome: 'succeeded',
        occurredAt: this.clock.now(), metadata: { previousVersion: current.version, exportedAt: preview.view.exportedAt },
      }
      this.store.restore(current.version, { ...data, auditEvents: [...data.auditEvents, audit] })
      this.recoveryPreview = null
      this.reserveSnapshotIds()
    })
  }

  private assertRecoveryAuthority(current: AtlasDataSnapshot, next: AtlasDataSnapshot, workspaceId: WorkspaceId): void {
    const actor = current.memberships.find((row) => row.workspaceId === workspaceId && row.userId === this.actorId)
    const restored = next.memberships.find((row) => row.workspaceId === workspaceId && row.userId === this.actorId)
    if (!actor || restored?.status !== 'active' || restored.role !== actor.role) {
      throw new ForbiddenGatewayError('Recovery must preserve your active workspace role.')
    }
    if (!next.memberships.some((row) => row.workspaceId === workspaceId && row.role === 'owner' && row.status === 'active')) {
      throw new InvalidGatewayRequestError('Recovery requires an active workspace owner.')
    }
    if (actor.role !== 'owner') {
      const owners = (data: AtlasDataSnapshot) => data.memberships
        .filter((row) => row.workspaceId === workspaceId && row.role === 'owner')
        .map((row) => `${row.id}:${row.userId}:${row.status}`).sort().join('|')
      if (owners(current) !== owners(next)) throw new ForbiddenGatewayError('Only an owner may change owner memberships during recovery.')
    }
  }

  getWorkspaceActivity(
    query: WorkspaceActivityQuery,
    options?: RequestOptions,
  ): Promise<WorkspaceActivityData> {
    return this.execute('activity.list', options, () => {
      this.assertPermission('workspace:view', query.workspaceId)
      return buildWorkspaceActivity(this.store.read().data, query, this.clock.now())
    })
  }

  getWorkspaceAdministration(
    query: WorkspaceAdministrationQuery,
    options?: RequestOptions,
  ): Promise<WorkspaceAdministrationData> {
    return this.execute('administration.members.get', options, () => {
      this.assertPermission('members:manage', query.workspaceId)
      const data = this.store.read().data
      const actorMembership = data.memberships.find(
        (membership) =>
          membership.workspaceId === query.workspaceId &&
          membership.userId === this.actorId,
      )
      if (!actorMembership) throw new ForbiddenGatewayError()
      const usersById = new Map(data.users.map((user) => [user.id, user]))
      const search = query.search?.trim().toLocaleLowerCase() ?? ''
      const roleFilter = new Set(query.roles ?? [])
      const statusFilter = new Set(query.statuses ?? [])
      const entries = data.memberships
        .filter((membership) => membership.workspaceId === query.workspaceId)
        .map((membership) => {
          const user = usersById.get(membership.userId)
          if (!user) throw new EntityNotFoundError('Workspace member')
          return {
            membership,
            user,
            canEdit:
              membership.userId !== this.actorId &&
              (actorMembership.role === 'owner' || membership.role !== 'owner'),
            allowedRoles:
              actorMembership.role === 'owner'
                ? [...workspaceRoles]
                : (['admin', 'member', 'viewer'] satisfies WorkspaceRole[]),
          }
        })
        .filter(
          ({ membership, user }) =>
            (search.length === 0 ||
              `${user.displayName} ${user.email}`.toLocaleLowerCase().includes(search)) &&
            (roleFilter.size === 0 || roleFilter.has(membership.role)) &&
            (statusFilter.size === 0 || statusFilter.has(membership.status)),
        )
        .sort(
          (left, right) =>
            left.user.displayName.localeCompare(right.user.displayName) ||
            left.membership.id.localeCompare(right.membership.id),
        )
      return {
        members: paginate(
          entries,
          validatePage(query.page ?? { number: 1, size: 20 }),
        ),
      }
    })
  }

  updateWorkspaceMembership(
    input: UpdateWorkspaceMembershipInput,
    options?: RequestOptions,
  ): Promise<Membership> {
    return this.execute('administration.members.update', options, (requestId) => {
      const current = this.store.read()
      const membershipIndex = current.data.memberships.findIndex(
        ({ id }) => id === input.id,
      )
      const membership = current.data.memberships[membershipIndex]
      if (!membership) throw new EntityNotFoundError('Workspace membership')
      this.assertPermission('members:manage', membership.workspaceId)
      const actorMembership = current.data.memberships.find(
        (candidate) =>
          candidate.workspaceId === membership.workspaceId &&
          candidate.userId === this.actorId,
      )
      if (!actorMembership) throw new ForbiddenGatewayError()
      if (membership.userId === this.actorId) {
        throw new ForbiddenGatewayError(
          'Manage your own access through another workspace owner.',
        )
      }
      if (
        actorMembership.role !== 'owner' &&
        (membership.role === 'owner' || input.role === 'owner')
      ) {
        throw new ForbiddenGatewayError(
          'Only workspace owners can change owner access.',
        )
      }
      if (!workspaceRoles.has(input.role) || !membershipStatuses.has(input.status)) {
        throw new InvalidGatewayRequestError('Membership role or status is invalid.')
      }
      if (membership.revision !== input.expectedRevision) {
        throw new GatewayConflictError(
          'This membership changed after it was loaded. Refresh and try again.',
        )
      }
      if (input.role === 'owner' && input.status !== 'active') {
        throw new InvalidGatewayRequestError('Workspace owners must remain active.')
      }
      if (membership.role === input.role && membership.status === input.status) {
        throw new InvalidGatewayRequestError('Choose a different role or status.')
      }
      const removesActiveOwner =
        membership.role === 'owner' &&
        membership.status === 'active' &&
        (input.role !== 'owner' || input.status !== 'active')
      const activeOwnerCount = current.data.memberships.filter(
        (candidate) =>
          candidate.workspaceId === membership.workspaceId &&
          candidate.role === 'owner' &&
          candidate.status === 'active',
      ).length
      if (removesActiveOwner && activeOwnerCount <= 1) {
        throw new GatewayConflictError(
          'Promote another active owner before changing the last workspace owner.',
        )
      }

      const occurredAt = this.clock.now()
      const updated: Membership = {
        ...membership,
        role: input.role,
        status: input.status,
        joinedAt:
          input.status === 'active' && membership.joinedAt === null
            ? occurredAt
            : membership.joinedAt,
        revision: membership.revision + 1,
      }
      const memberships = [...current.data.memberships]
      memberships[membershipIndex] = updated
      const user = current.data.users.find(({ id }) => id === membership.userId)
      if (!user) throw new EntityNotFoundError('Workspace member')
      this.commit(current.version, {
        ...current.data,
        memberships,
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity('membership_updated'),
            workspaceId: membership.workspaceId,
            actorId: this.actorId,
            entityKind: 'member',
            entityId: membership.id,
            action: 'membership.updated',
            occurredAt,
            summary: `Changed ${user.displayName} from ${membership.role}/${membership.status} to ${updated.role}/${updated.status}.`,
          },
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit('membership_updated'),
            workspaceId: membership.workspaceId,
            actorId: this.actorId,
            requestId,
            action: 'membership.updated',
            outcome: 'succeeded',
            occurredAt,
            metadata: {
              membershipId: membership.id,
              userId: membership.userId,
              fromRole: membership.role,
              toRole: updated.role,
              fromStatus: membership.status,
              toStatus: updated.status,
              fromRevision: membership.revision,
              toRevision: updated.revision,
            },
          },
        ],
      })
      return updated
    })
  }

  getAuthorizationSession(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<AuthorizationSession> {
    return this.execute('authorization.get', options, () => {
      const current = this.store.read()
      const workspaceMembership = current.data.memberships.find(
        (membership) =>
          membership.workspaceId === workspaceId &&
          membership.userId === this.actorId,
      )
      const user = current.data.users.find(({ id }) => id === this.actorId)
      if (!user || workspaceMembership?.status !== 'active') {
        throw new SessionExpiredGatewayError()
      }
      const projectIds = new Set(
        current.data.projects
          .filter((project) => project.workspaceId === workspaceId)
          .map(({ id }) => id),
      )
      const projectMemberships = current.data.projectMembers.filter(
        (membership) =>
          membership.userId === this.actorId &&
          projectIds.has(membership.projectId),
      )

      return {
        user,
        workspaceMembership,
        projectMemberships,
        snapshotVersion: current.version,
        permissionFingerprint: getPermissionFingerprint(
          workspaceMembership,
          projectMemberships,
        ),
      }
    })
  }

  listProjects(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<readonly Project[]> {
    return this.execute('project.list', options, () => {
      this.assertPermission('project:view', workspaceId)
      return this.store
        .read()
        .data.projects.filter((project) => project.workspaceId === workspaceId)
        .sort((left, right) => left.name.localeCompare(right.name))
    })
  }

  listProjectSummaries(
    query: ProjectSummaryQuery,
    options?: RequestOptions,
  ) {
    return this.execute('project.summary-list', options, () => {
      this.assertPermission('project:view', query.workspaceId)
      return queryProjectSummaries(this.store.read().data, query)
    })
  }

  getProjectEditMetadata(
    projectId: ProjectId,
    options?: RequestOptions,
  ): Promise<ProjectEditMetadata> {
    return this.execute('project.metadata.get', options, () => {
      const data = this.store.read().data
      const project = data.projects.find(({ id }) => id === projectId)
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('project:view', project.workspaceId, project.id)
      return { project }
    })
  }

  getProjectMembershipAdministration(
    query: ProjectMembershipQuery,
    options?: RequestOptions,
  ): Promise<ProjectMembershipAdministrationData> {
    return this.execute('administration.project-members.get', options, () => {
      const data = this.store.read().data
      const project = data.projects.find(({ id }) => id === query.projectId)
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('members:manage', project.workspaceId)
      const usersById = new Map(data.users.map((user) => [user.id, user]))
      const activeWorkspaceUserIds = new Set(
        data.memberships
          .filter(
            (membership) =>
              membership.workspaceId === project.workspaceId &&
              membership.status === 'active',
          )
          .map(({ userId }) => userId),
      )
      const projectMemberships = data.projectMembers.filter(
        ({ projectId }) => projectId === project.id,
      )
      const projectUserIds = new Set(projectMemberships.map(({ userId }) => userId))
      const search = query.search?.trim().toLocaleLowerCase() ?? ''
      const entries = projectMemberships
        .map((membership) => {
          const user = usersById.get(membership.userId)
          const workspaceMembership = data.memberships.find(
            (candidate) =>
              candidate.workspaceId === project.workspaceId &&
              candidate.userId === membership.userId,
          )
          if (!user) throw new EntityNotFoundError('Project member')
          if (!workspaceMembership) {
            throw new EntityNotFoundError('Project member workspace access')
          }
          return {
            membership,
            user,
            workspaceStatus: workspaceMembership.status,
            assignedIssueCount: data.issues.filter(
              (issue) =>
                issue.projectId === project.id && issue.assigneeId === membership.userId,
            ).length,
          }
        })
        .filter(
          ({ user }) =>
            search.length === 0 ||
            `${user.displayName} ${user.email}`.toLocaleLowerCase().includes(search),
        )
        .sort(
          (left, right) =>
            (left.membership.role === 'lead' ? -1 : 0) -
              (right.membership.role === 'lead' ? -1 : 0) ||
            left.user.displayName.localeCompare(right.user.displayName),
        )
      const byName = (left: { displayName: string }, right: { displayName: string }) =>
        left.displayName.localeCompare(right.displayName)
      return {
        project,
        members: paginate(entries, validatePage(query.page ?? { number: 1, size: 10 })),
        eligibleUsers: data.users
          .filter(
            ({ id }) =>
              activeWorkspaceUserIds.has(id) && !projectUserIds.has(id),
          )
          .sort(byName),
        reassignmentUsers: data.users
          .filter(
            ({ id }) => activeWorkspaceUserIds.has(id) && projectUserIds.has(id),
          )
          .sort(byName),
      }
    })
  }

  addProjectMember(
    input: AddProjectMemberInput,
    options?: RequestOptions,
  ): Promise<Project> {
    return this.execute('administration.project-members.add', options, (requestId) => {
      const current = this.store.read()
      const projectIndex = current.data.projects.findIndex(({ id }) => id === input.projectId)
      const project = current.data.projects[projectIndex]
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('members:manage', project.workspaceId)
      this.assertProjectOpen(current.data, project.id)
      this.assertProjectRevision(project, input.expectedProjectRevision)
      this.assertAssignableProjectRole(input.role)
      if (
        current.data.projectMembers.some(
          ({ projectId, userId }) => projectId === project.id && userId === input.userId,
        )
      ) {
        throw new InvalidGatewayRequestError('This user is already a project member.')
      }
      const workspaceMembership = current.data.memberships.find(
        ({ workspaceId, userId }) =>
          workspaceId === project.workspaceId && userId === input.userId,
      )
      if (workspaceMembership?.status !== 'active') {
        throw new InvalidGatewayRequestError(
          'Only active workspace members can join a project.',
        )
      }
      const user = current.data.users.find(({ id }) => id === input.userId)
      if (!user) throw new EntityNotFoundError('Workspace member')
      const occurredAt = this.clock.now()
      const updatedProject = { ...project, revision: project.revision + 1, updatedAt: occurredAt }
      const projects = [...current.data.projects]
      projects[projectIndex] = updatedProject
      this.commit(current.version, {
        ...current.data,
        projects,
        projectMembers: [
          ...current.data.projectMembers,
          {
            id: this.ids.projectMember('member_added'),
            projectId: project.id,
            userId: input.userId,
            role: input.role,
          },
        ],
        activityEvents: [
          ...current.data.activityEvents,
          this.projectMembershipActivity(project, occurredAt, `Added ${user.displayName} as ${input.role}.`),
        ],
        auditEvents: [
          ...current.data.auditEvents,
          this.projectMembershipAudit(requestId, project, occurredAt, 'project.member.added', {
            userId: input.userId,
            role: input.role,
            fromRevision: project.revision,
            toRevision: updatedProject.revision,
          }),
        ],
      })
      return updatedProject
    })
  }

  updateProjectMember(
    input: UpdateProjectMemberInput,
    options?: RequestOptions,
  ): Promise<Project> {
    return this.execute('administration.project-members.update', options, (requestId) => {
      const current = this.store.read()
      const memberIndex = current.data.projectMembers.findIndex(({ id }) => id === input.id)
      const member = current.data.projectMembers[memberIndex]
      if (!member) throw new EntityNotFoundError('Project member')
      const projectIndex = current.data.projects.findIndex(({ id }) => id === member.projectId)
      const project = current.data.projects[projectIndex]
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('members:manage', project.workspaceId)
      this.assertProjectOpen(current.data, project.id)
      this.assertProjectRevision(project, input.expectedProjectRevision)
      this.assertAssignableProjectRole(input.role)
      if (member.role === 'lead') {
        throw new InvalidGatewayRequestError('Transfer project leadership before changing this role.')
      }
      if (member.role === input.role) {
        throw new InvalidGatewayRequestError('Choose a different project role.')
      }
      const user = current.data.users.find(({ id }) => id === member.userId)
      if (!user) throw new EntityNotFoundError('Project member')
      const occurredAt = this.clock.now()
      const updatedProject = { ...project, revision: project.revision + 1, updatedAt: occurredAt }
      const projects = [...current.data.projects]
      projects[projectIndex] = updatedProject
      const projectMembers = [...current.data.projectMembers]
      projectMembers[memberIndex] = { ...member, role: input.role }
      this.commit(current.version, {
        ...current.data,
        projects,
        projectMembers,
        activityEvents: [
          ...current.data.activityEvents,
          this.projectMembershipActivity(project, occurredAt, `Changed ${user.displayName} from ${member.role} to ${input.role}.`),
        ],
        auditEvents: [
          ...current.data.auditEvents,
          this.projectMembershipAudit(requestId, project, occurredAt, 'project.member.updated', {
            userId: member.userId,
            fromRole: member.role,
            toRole: input.role,
            fromRevision: project.revision,
            toRevision: updatedProject.revision,
          }),
        ],
      })
      return updatedProject
    })
  }

  removeProjectMember(
    input: RemoveProjectMemberInput,
    options?: RequestOptions,
  ): Promise<Project> {
    return this.execute('administration.project-members.remove', options, (requestId) => {
      const current = this.store.read()
      const member = current.data.projectMembers.find(({ id }) => id === input.id)
      if (!member) throw new EntityNotFoundError('Project member')
      const projectIndex = current.data.projects.findIndex(({ id }) => id === member.projectId)
      const project = current.data.projects[projectIndex]
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('members:manage', project.workspaceId)
      this.assertProjectOpen(current.data, project.id)
      this.assertProjectRevision(project, input.expectedProjectRevision)
      if (member.role === 'lead') {
        throw new InvalidGatewayRequestError('Transfer project leadership before removing the lead.')
      }
      const assignedIssues = current.data.issues.filter(
        (issue) => issue.projectId === project.id && issue.assigneeId === member.userId,
      )
      if (assignedIssues.length > 0 && input.reassignIssuesTo === null) {
        throw new GatewayConflictError(
          'This member owns project issues. Choose an active project member for reassignment.',
        )
      }
      if (input.reassignIssuesTo === member.userId) {
        throw new InvalidGatewayRequestError('Choose a different member for reassignment.')
      }
      if (input.reassignIssuesTo !== null) {
        const validTarget = current.data.projectMembers.some(
          ({ projectId, userId }) =>
            projectId === project.id && userId === input.reassignIssuesTo,
        ) && current.data.memberships.some(
          ({ workspaceId, userId, status }) =>
            workspaceId === project.workspaceId &&
            userId === input.reassignIssuesTo &&
            status === 'active',
        )
        if (!validTarget) {
          throw new InvalidGatewayRequestError(
            'Issue reassignment requires an active member of this project.',
          )
        }
      }
      const user = current.data.users.find(({ id }) => id === member.userId)
      if (!user) throw new EntityNotFoundError('Project member')
      const reassignmentUser = input.reassignIssuesTo
        ? current.data.users.find(({ id }) => id === input.reassignIssuesTo)
        : null
      if (input.reassignIssuesTo && !reassignmentUser) {
        throw new EntityNotFoundError('Issue reassignment member')
      }
      const occurredAt = this.clock.now()
      const updatedProject = { ...project, revision: project.revision + 1, updatedAt: occurredAt }
      const projects = [...current.data.projects]
      projects[projectIndex] = updatedProject
      const reassignedIssueIds = new Set(assignedIssues.map(({ id }) => id))
      const issues = current.data.issues.map((issue) =>
        reassignedIssueIds.has(issue.id)
          ? {
              ...issue,
              assigneeId: input.reassignIssuesTo,
              revision: issue.revision + 1,
              updatedAt: occurredAt,
            }
          : issue,
      )
      this.commit(current.version, {
        ...current.data,
        projects,
        issues,
        projectMembers: current.data.projectMembers.filter(({ id }) => id !== member.id),
        activityEvents: [
          ...current.data.activityEvents,
          this.projectMembershipActivity(
            project,
            occurredAt,
            `Removed ${user.displayName}${assignedIssues.length > 0 ? ` and reassigned ${assignedIssues.length.toString()} ${assignedIssues.length === 1 ? 'issue' : 'issues'}` : ''}.`,
          ),
          ...assignedIssues.map((issue) => ({
            id: this.ids.activity('project_member_issue_reassigned'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            entityKind: 'issue' as const,
            entityId: issue.id,
            action: 'issue.assignee.reassigned',
            occurredAt,
            summary: `Reassigned ${this.issueReference(current.data, issue)} from ${user.displayName} to ${reassignmentUser?.displayName ?? 'Unassigned'}.`,
          })),
        ],
        auditEvents: [
          ...current.data.auditEvents,
          this.projectMembershipAudit(requestId, project, occurredAt, 'project.member.removed', {
            userId: member.userId,
            role: member.role,
            reassignedIssueCount: assignedIssues.length,
            reassignedTo: input.reassignIssuesTo,
            fromRevision: project.revision,
            toRevision: updatedProject.revision,
          }),
        ],
      })
      return updatedProject
    })
  }

  getProjectLeadTransfer(
    projectId: ProjectId,
    options?: RequestOptions,
  ): Promise<ProjectLeadTransferData> {
    return this.execute('administration.project-lead.get', options, () => {
      const data = this.store.read().data
      const project = data.projects.find(({ id }) => id === projectId)
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('project:update', project.workspaceId, project.id)
      const currentLead = data.users.find(({ id }) => id === project.leadId)
      if (!currentLead) throw new EntityNotFoundError('Project lead')
      const activeUserIds = new Set(
        data.memberships
          .filter(
            ({ workspaceId, status }) =>
              workspaceId === project.workspaceId && status === 'active',
          )
          .map(({ userId }) => userId),
      )
      const candidates = data.projectMembers
        .flatMap((membership) => {
          if (
            membership.projectId !== project.id ||
            membership.role === 'lead' ||
            !activeUserIds.has(membership.userId)
          ) {
            return []
          }
          const user = data.users.find(({ id }) => id === membership.userId)
          if (!user) throw new EntityNotFoundError('Project member')
          return [{ user, currentRole: membership.role }]
        })
        .sort((left, right) =>
          left.user.displayName.localeCompare(right.user.displayName),
        )
      return { project, currentLead, candidates }
    })
  }

  transferProjectLead(
    input: TransferProjectLeadInput,
    options?: RequestOptions,
  ): Promise<Project> {
    return this.execute(
      'administration.project-lead.transfer',
      options,
      (requestId) => {
        const current = this.store.read()
        const projectIndex = current.data.projects.findIndex(
          ({ id }) => id === input.projectId,
        )
        const project = current.data.projects[projectIndex]
        if (!project) throw new EntityNotFoundError('Project')
        this.assertPermission('project:update', project.workspaceId, project.id)
        this.assertProjectOpen(current.data, project.id)
        this.assertProjectRevision(project, input.expectedProjectRevision)
        this.assertAssignableProjectRole(input.formerLeadRole)
        if (project.leadId !== input.expectedCurrentLeadId) {
          throw new GatewayConflictError(
            'Project leadership changed after it was loaded. Reload the latest members and try again.',
          )
        }
        if (input.newLeadId === project.leadId) {
          throw new InvalidGatewayRequestError(
            'Choose a different project member as the new lead.',
          )
        }

        const currentLead = current.data.users.find(({ id }) => id === project.leadId)
        const newLead = current.data.users.find(({ id }) => id === input.newLeadId)
        const currentLeadMembership = current.data.projectMembers.find(
          ({ projectId, userId, role }) =>
            projectId === project.id && userId === project.leadId && role === 'lead',
        )
        const newLeadMembership = current.data.projectMembers.find(
          ({ projectId, userId }) =>
            projectId === project.id && userId === input.newLeadId,
        )
        const newLeadWorkspaceMembership = current.data.memberships.find(
          ({ workspaceId, userId }) =>
            workspaceId === project.workspaceId && userId === input.newLeadId,
        )
        if (!currentLead || !currentLeadMembership) {
          throw new GatewayConflictError(
            'The current project lead membership is no longer valid.',
          )
        }
        if (
          !newLead ||
          !newLeadMembership ||
          newLeadMembership.role === 'lead' ||
          newLeadWorkspaceMembership?.status !== 'active'
        ) {
          throw new InvalidGatewayRequestError(
            'Project leadership can transfer only to an active project member.',
          )
        }

        const occurredAt = this.clock.now()
        const updatedProject: Project = {
          ...project,
          leadId: newLead.id,
          revision: project.revision + 1,
          updatedAt: occurredAt,
        }
        const projects = [...current.data.projects]
        projects[projectIndex] = updatedProject
        const projectMembers = current.data.projectMembers.map((membership) => {
          if (membership.id === currentLeadMembership.id) {
            return { ...membership, role: input.formerLeadRole }
          }
          if (membership.id === newLeadMembership.id) {
            return { ...membership, role: 'lead' as const }
          }
          return membership
        })

        this.commit(current.version, {
          ...current.data,
          projects,
          projectMembers,
          activityEvents: [
            ...current.data.activityEvents,
            {
              id: this.ids.activity('project_lead_transferred'),
              workspaceId: project.workspaceId,
              actorId: this.actorId,
              entityKind: 'project',
              entityId: project.id,
              action: 'project.lead.transferred',
              occurredAt,
              summary: `Transferred leadership from ${currentLead.displayName} to ${newLead.displayName}.`,
            },
          ],
          auditEvents: [
            ...current.data.auditEvents,
            {
              id: this.ids.audit('project_lead_transferred'),
              workspaceId: project.workspaceId,
              actorId: this.actorId,
              requestId,
              action: 'project.lead.transferred',
              outcome: 'succeeded',
              occurredAt,
              metadata: {
                projectId: project.id,
                previousLeadId: currentLead.id,
                newLeadId: newLead.id,
                previousLeadRole: input.formerLeadRole,
                previousCandidateRole: newLeadMembership.role,
                fromRevision: project.revision,
                toRevision: updatedProject.revision,
              },
            },
          ],
        })
        return updatedProject
      },
    )
  }

  getProjectWorkflowAdministration(
    projectId: ProjectId,
    options?: RequestOptions,
  ): Promise<ProjectWorkflowAdministrationData> {
    return this.execute('administration.workflow.get', options, () => {
      const data = this.store.read().data
      const project = data.projects.find(({ id }) => id === projectId)
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('project:update', project.workspaceId, project.id)
      return {
        project,
        statuses: data.workflowStatuses
          .filter((status) => status.projectId === project.id)
          .sort((left, right) => left.order - right.order)
          .map((status) => ({
            status,
            issueCount: data.issues.filter(({ statusId }) => statusId === status.id).length,
          })),
      }
    })
  }

  updateProjectWorkflow(
    input: UpdateProjectWorkflowInput,
    options?: RequestOptions,
  ): Promise<Project> {
    return this.execute('administration.workflow.update', options, (requestId) => {
      const current = this.store.read()
      const projectIndex = current.data.projects.findIndex(({ id }) => id === input.projectId)
      const project = current.data.projects[projectIndex]
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('project:update', project.workspaceId, project.id)
      this.assertProjectOpen(current.data, project.id)
      this.assertProjectRevision(project, input.expectedProjectRevision)

      const existing = current.data.workflowStatuses
        .filter(({ projectId }) => projectId === project.id)
        .sort((left, right) => left.order - right.order)
      const existingById = new Map(existing.map((status) => [status.id, status]))
      const referencedIds = new Set<WorkflowStatusId>()
      const normalizedDrafts = input.statuses.map((draft, order) => {
        const name = draft.name.trim()
        if (name.length === 0 || name.length > 60) {
          throw new InvalidGatewayRequestError(
            'Workflow status names must contain 1 to 60 characters.',
          )
        }
        if (!workflowCategories.has(draft.category)) {
          throw new InvalidGatewayRequestError('Choose a supported workflow category.')
        }
        if (draft.id !== null) {
          if (!existingById.has(draft.id) || referencedIds.has(draft.id)) {
            throw new InvalidGatewayRequestError(
              'Workflow updates may reference each existing project status once.',
            )
          }
          referencedIds.add(draft.id)
        }
        return {
          id: draft.id,
          name,
          category: draft.category,
          order,
        }
      })
      const names = new Set(normalizedDrafts.map(({ name }) => name.toLocaleLowerCase()))
      if (
        normalizedDrafts.length < 2 ||
        normalizedDrafts.length > 10 ||
        names.size !== normalizedDrafts.length ||
        !normalizedDrafts.some(({ category }) => category === 'completed') ||
        !normalizedDrafts.some(
          ({ category }) => category !== 'completed' && category !== 'canceled',
        )
      ) {
        throw new InvalidGatewayRequestError(
          'Project workflows require 2-10 uniquely named stages, including open and completed work.',
        )
      }

      const retired = existing.filter(({ id }) => !referencedIds.has(id))
      const retiredIds = new Set(retired.map(({ id }) => id))
      const targetIds = new Set(normalizedDrafts.flatMap(({ id }) => id ? [id] : []))
      const migrations = new Map<WorkflowStatusId, WorkflowStatusId>()
      for (const migration of input.migrations) {
        if (
          migrations.has(migration.statusId) ||
          !retiredIds.has(migration.statusId) ||
          !targetIds.has(migration.reassignToStatusId)
        ) {
          throw new InvalidGatewayRequestError(
            'Workflow migrations must map each retired status to one retained status.',
          )
        }
        migrations.set(migration.statusId, migration.reassignToStatusId)
      }
      const migratedIssues = current.data.issues.filter(
        ({ projectId, statusId }) => projectId === project.id && retiredIds.has(statusId),
      )
      if (migratedIssues.some(({ statusId }) => !migrations.has(statusId))) {
        throw new GatewayConflictError(
          'Retired statuses still contain issues. Choose a retained status for migration.',
        )
      }
      const workflowUnchanged =
        normalizedDrafts.length === existing.length &&
        normalizedDrafts.every((status, index) => {
          const previous = existing[index]
          return status.id === previous?.id &&
            status.name === previous.name &&
            status.category === previous.category
        })
      if (workflowUnchanged) {
        throw new InvalidGatewayRequestError('Change the workflow before saving.')
      }

      const normalized: WorkflowStatus[] = normalizedDrafts.map((draft) => ({
        ...draft,
        id: draft.id ?? this.ids.workflowStatus('workflow_added'),
        projectId: project.id,
      }))

      const occurredAt = this.clock.now()
      const updatedProject = {
        ...project,
        revision: project.revision + 1,
        updatedAt: occurredAt,
      }
      const projects = [...current.data.projects]
      projects[projectIndex] = updatedProject
      const migratedIssueIds = new Set(migratedIssues.map(({ id }) => id))
      const issues = current.data.issues.map((issue) => {
        if (!migratedIssueIds.has(issue.id)) return issue
        const statusId = migrations.get(issue.statusId)
        if (!statusId) throw new GatewayConflictError('Issue migration target is unavailable.')
        return { ...issue, statusId, revision: issue.revision + 1, updatedAt: occurredAt }
      })
      const statusNames = new Map(normalized.map(({ id, name }) => [id, name]))
      const projectNotifications = this.buildProjectUpdateNotifications(
        current.data,
        project,
        occurredAt,
        `${project.key} workflow updated`,
        `The workflow now has ${normalized.length.toString()} stages; ${migratedIssues.length.toString()} issues were migrated.`,
      )
      this.commit(current.version, {
        ...current.data,
        projects,
        workflowStatuses: [
          ...current.data.workflowStatuses.filter(({ projectId }) => projectId !== project.id),
          ...normalized,
        ],
        issues,
        notifications: [...current.data.notifications, ...projectNotifications],
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity('project_workflow_updated'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            entityKind: 'project',
            entityId: project.id,
            action: 'project.workflow.updated',
            occurredAt,
            summary: `Updated ${project.key} workflow to ${normalized.length.toString()} stages; retired ${retired.length.toString()} and migrated ${migratedIssues.length.toString()} issues.`,
          },
          ...migratedIssues.map((issue) => ({
            id: this.ids.activity('workflow_issue_migrated'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            entityKind: 'issue' as const,
            entityId: issue.id,
            action: 'issue.workflow.migrated',
            occurredAt,
            summary: `Migrated ${this.issueReference(current.data, issue)} from ${this.statusName(current.data, issue.statusId)} to ${statusNames.get(migrations.get(issue.statusId) ?? issue.statusId) ?? 'retained workflow status'}.`,
          })),
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit('project_workflow_updated'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            requestId,
            action: 'project.workflow.updated',
            outcome: 'succeeded',
            occurredAt,
            metadata: {
              projectId: project.id,
              fromRevision: project.revision,
              toRevision: updatedProject.revision,
              stageCount: normalized.length,
              retiredCount: retired.length,
              migratedIssueCount: migratedIssues.length,
              retiredStatusIds: retired.map(({ id }) => id).join(','),
            },
          },
        ],
      })
      return updatedProject
    })
  }

  getProjectCreationMetadata(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<ProjectCreationMetadata> {
    return this.execute('project.creation-metadata', options, () => {
      this.assertPermission('project:create', workspaceId)
      const data = this.store.read().data
      const activeUserIds = new Set(
        data.memberships
          .filter(
            (membership) =>
              membership.workspaceId === workspaceId &&
              membership.status === 'active',
          )
          .map(({ userId }) => userId),
      )
      return {
        eligibleLeads: data.users
          .filter(({ id }) => activeUserIds.has(id))
          .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      }
    })
  }

  createProject(
    input: CreateProjectInput,
    options?: RequestOptions,
  ): Promise<Project> {
    return this.execute('project.create', options, (requestId) => {
      this.assertPermission('project:create', input.workspaceId)
      const current = this.store.read()
      const key = input.key.trim().toLocaleUpperCase()
      const name = input.name.trim()
      const description = input.description.trim()

      if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
        throw new InvalidGatewayRequestError(
          'Project keys must contain 2-10 uppercase letters or digits and begin with a letter.',
        )
      }
      if (name.length === 0 || name.length > 120) {
        throw new InvalidGatewayRequestError(
          'Project names must contain 1 to 120 characters.',
        )
      }
      if (description.length > 5_000) {
        throw new InvalidGatewayRequestError(
          'Project descriptions may not exceed 5,000 characters.',
        )
      }
      if (
        current.data.projects.some(
          (project) =>
            project.workspaceId === input.workspaceId && project.key === key,
        )
      ) {
        throw new GatewayConflictError(
          `Project key ${key} is already in use. Choose another key.`,
        )
      }
      const leadIsEligible = current.data.memberships.some(
        (membership) =>
          membership.workspaceId === input.workspaceId &&
          membership.userId === input.leadId &&
          membership.status === 'active',
      )
      if (!leadIsEligible) {
        throw new InvalidGatewayRequestError(
          'Project leads must be active workspace members.',
        )
      }
      const normalizedWorkflow = input.workflow.map((status) => ({
        name: status.name.trim(),
        category: status.category,
      }))
      const workflowNames = new Set(
        normalizedWorkflow.map(({ name: statusName }) =>
          statusName.toLocaleLowerCase(),
        ),
      )
      if (
        normalizedWorkflow.length < 2 ||
        normalizedWorkflow.length > 10 ||
        normalizedWorkflow.some(
          (status) =>
            status.name.length === 0 ||
            status.name.length > 60 ||
            !workflowCategories.has(status.category),
        ) ||
        workflowNames.size !== normalizedWorkflow.length ||
        !normalizedWorkflow.some(({ category }) => category === 'completed') ||
        !normalizedWorkflow.some(
          ({ category }) => category !== 'completed' && category !== 'canceled',
        )
      ) {
        throw new InvalidGatewayRequestError(
          'Project workflows require 2-10 uniquely named stages, including open and completed work.',
        )
      }

      const occurredAt = this.clock.now()
      const project: Project = {
        id: this.ids.project('created'),
        workspaceId: input.workspaceId,
        key,
        name,
        description,
        leadId: input.leadId,
        status: 'planned',
        revision: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }
      const workflowStatuses = normalizedWorkflow.map((status, order) => ({
        id: this.ids.workflowStatus('created'),
        projectId: project.id,
        name: status.name,
        category: status.category,
        order,
      }))

      this.commit(current.version, {
        ...current.data,
        projects: [...current.data.projects, project],
        projectMembers: [
          ...current.data.projectMembers,
          {
            id: this.ids.projectMember('created_lead'),
            projectId: project.id,
            userId: project.leadId,
            role: 'lead',
          },
        ],
        workflowStatuses: [
          ...current.data.workflowStatuses,
          ...workflowStatuses,
        ],
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity('project_created'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            entityKind: 'project',
            entityId: project.id,
            action: 'project.created',
            occurredAt,
            summary: `Created ${project.key} with ${workflowStatuses.length.toString()} workflow stages.`,
          },
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit('project_created'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            requestId,
            action: 'project.created',
            outcome: 'succeeded',
            occurredAt,
            metadata: {
              projectId: project.id,
              projectKey: project.key,
              leadId: project.leadId,
              workflowStages: workflowStatuses.length,
            },
          },
        ],
      })
      return project
    })
  }

  getProjectActivity(
    projectId: ProjectId,
    page = { number: 1, size: 20 },
    options?: RequestOptions,
  ): Promise<ProjectActivityData> {
    return this.execute('project.activity.get', options, () => {
      const data = this.store.read().data
      const project = data.projects.find(({ id }) => id === projectId)
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('project:view', project.workspaceId, project.id)
      const usersById = new Map(data.users.map((user) => [user.id, user]))
      const entries = data.activityEvents
        .filter(
          ({ entityKind, entityId }) =>
            entityKind === 'project' && entityId === project.id,
        )
        .sort(
          (left, right) =>
            right.occurredAt.localeCompare(left.occurredAt) ||
            right.id.localeCompare(left.id),
        )
        .map((event) => {
          const actor = usersById.get(event.actorId)
          if (!actor) throw new EntityNotFoundError('Project activity actor')
          return { event, actor }
        })
      return { events: paginate(entries, validatePage(page)) }
    })
  }

  updateProject(
    input: UpdateProjectInput,
    options?: RequestOptions,
  ): Promise<Project> {
    return this.execute('project.update', options, (requestId) => {
      const current = this.store.read()
      const projectIndex = current.data.projects.findIndex(({ id }) => id === input.id)
      const project = current.data.projects[projectIndex]
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('project:update', project.workspaceId, project.id)
      if (project.status === 'archived') {
        throw new GatewayConflictError('Archived projects are read-only.')
      }
      if (project.revision !== input.expectedRevision) {
        throw new GatewayConflictError(
          'The project changed after it was loaded. Refresh and try again.',
        )
      }

      const name = input.changes.name?.trim() ?? project.name
      const description = input.changes.description?.trim() ?? project.description
      if (name.length === 0 || name.length > 120) {
        throw new InvalidGatewayRequestError(
          'Project names must contain 1 to 120 characters.',
        )
      }
      if (description.length > 5_000) {
        throw new InvalidGatewayRequestError(
          'Project descriptions may not exceed 5,000 characters.',
        )
      }
      const status = input.changes.status ?? project.status
      if (
        status !== project.status &&
        !projectStatusTransitions[project.status].has(status)
      ) {
        throw new InvalidGatewayRequestError(
          `Projects may not move from ${project.status} to ${status}.`,
        )
      }
      const occurredAt = this.clock.now()
      const updated: Project = {
        ...project,
        ...input.changes,
        name,
        description,
        status,
        revision: project.revision + 1,
        updatedAt: occurredAt,
      }
      const projects = [...current.data.projects]
      projects[projectIndex] = updated
      const projectNotifications = this.buildProjectUpdateNotifications(
        current.data,
        project,
        occurredAt,
        `${project.key} project updated`,
        `${updated.name} is now ${updated.status}.`,
      )
      this.commit(current.version, {
        ...current.data,
        projects,
        notifications: [...current.data.notifications, ...projectNotifications],
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity('project_updated'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            entityKind: 'project',
            entityId: project.id,
            action: 'project.updated',
            occurredAt,
            summary: `Updated ${project.key}.`,
          },
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit('project_updated'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            requestId,
            action: 'project.updated',
            outcome: 'succeeded',
            occurredAt,
            metadata: {
              projectId: project.id,
              fromRevision: project.revision,
              toRevision: updated.revision,
              status: updated.status,
            },
          },
        ],
      })
      return updated
    })
  }

  archiveProject(
    input: ArchiveProjectInput,
    options?: RequestOptions,
  ): Promise<Project> {
    return this.execute('project.archive', options, (requestId) => {
      const current = this.store.read()
      const projectIndex = current.data.projects.findIndex(({ id }) => id === input.id)
      const project = current.data.projects[projectIndex]
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('project:archive', project.workspaceId, project.id)
      if (project.revision !== input.expectedRevision) {
        throw new GatewayConflictError(
          'The project changed after it was loaded. Refresh and try again.',
        )
      }
      if (project.status === 'archived') return project

      const occurredAt = this.clock.now()
      const archived: Project = {
        ...project,
        status: 'archived',
        revision: project.revision + 1,
        updatedAt: occurredAt,
      }
      const projects = [...current.data.projects]
      projects[projectIndex] = archived
      const projectNotifications = this.buildProjectUpdateNotifications(
        current.data,
        project,
        occurredAt,
        `${project.key} was archived`,
        `${project.name} is now read-only.`,
      )
      this.commit(current.version, {
        ...current.data,
        projects,
        notifications: [...current.data.notifications, ...projectNotifications],
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity('project_archived'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            entityKind: 'project',
            entityId: project.id,
            action: 'project.archived',
            occurredAt,
            summary: `Archived ${project.key}.`,
          },
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit('project_archived'),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            requestId,
            action: 'project.archived',
            outcome: 'succeeded',
            occurredAt,
            metadata: {
              projectId: project.id,
              fromRevision: project.revision,
              toRevision: archived.revision,
            },
          },
        ],
      })
      return archived
    })
  }

  listIssues(query: IssueQuery, options?: RequestOptions): Promise<Page<Issue>> {
    return this.execute('issue.list', options, () => {
      this.assertPermission('issue:view', query.filters.workspaceId)
      return queryIssues(this.store.read().data.issues, query)
    })
  }

  getIssue(id: IssueId, options?: RequestOptions): Promise<Issue> {
    return this.execute('issue.get', options, () => {
      const issue = this.store.read().data.issues.find((candidate) => candidate.id === id)

      if (!issue) {
        throw new EntityNotFoundError('Issue')
      }

      this.assertPermission('issue:view', issue.workspaceId, issue.projectId)
      return issue
    })
  }

  getIssueCreationMetadata(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<IssueCreationMetadata> {
    return this.execute('issue.creation-metadata', options, () => {
      this.assertPermission('issue:view', workspaceId)
      const data = this.store.read().data
      const projects = data.projects
        .filter(
          (project) =>
            project.workspaceId === workspaceId &&
            openProjectStatuses.has(project.status) &&
            this.hasPermission('issue:create', workspaceId, project.id),
        )
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((project) => {
          const assignableUserIds = new Set(
            data.projectMembers
              .filter(({ projectId }) => projectId === project.id)
              .map(({ userId }) => userId),
          )
          const activeUserIds = new Set(
            data.memberships
              .filter(
                (membership) =>
                  membership.workspaceId === workspaceId &&
                  membership.status === 'active',
              )
              .map(({ userId }) => userId),
          )

          return {
            project,
            statuses: data.workflowStatuses
              .filter(({ projectId }) => projectId === project.id)
              .sort((left, right) => left.order - right.order),
            assignees: data.users
              .filter(
                ({ id }) => assignableUserIds.has(id) && activeUserIds.has(id),
              )
              .sort((left, right) =>
                left.displayName.localeCompare(right.displayName),
              ),
          }
        })

      return {
        projects,
        labels: data.labels
          .filter((label) => label.workspaceId === workspaceId)
          .sort((left, right) => left.name.localeCompare(right.name)),
      }
    })
  }

  getIssueFilterMetadata(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<IssueFilterMetadata> {
    return this.execute('issue.filter-metadata', options, () => {
      this.assertPermission('issue:view', workspaceId)
      const data = this.store.read().data

      return {
        projects: data.projects
          .filter((project) => project.workspaceId === workspaceId)
          .sort((left, right) =>
            left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
          )
          .map((project) => ({
            project,
            statuses: data.workflowStatuses
              .filter(({ projectId }) => projectId === project.id)
              .sort((left, right) => left.order - right.order),
          })),
      }
    })
  }

  getBoardMetadata(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<BoardMetadata> {
    return this.execute('board.metadata', options, () => {
      this.assertPermission('project:view', workspaceId)
      const data = this.store.read().data

      return {
        projects: data.projects
          .filter(
            (project) =>
              project.workspaceId === workspaceId &&
              openProjectStatuses.has(project.status),
          )
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((project) => ({
            project,
            statuses: data.workflowStatuses
              .filter(({ projectId }) => projectId === project.id)
              .sort((left, right) => left.order - right.order),
          })),
      }
    })
  }

  getWorkspaceAnalytics(
    query: WorkspaceAnalyticsQuery,
    options?: RequestOptions,
  ): Promise<WorkspaceAnalytics> {
    return this.execute('analytics.get', options, () => {
      this.assertPermission('analytics:view', query.workspaceId)
      return buildWorkspaceAnalytics(this.store.read().data, query, this.clock.now())
    })
  }

  getGovernanceReport(
    query: GovernanceQuery,
    options?: RequestOptions,
  ): Promise<GovernanceReport> {
    return this.execute('governance.get', options, () => {
      this.assertPermission('audit:view', query.workspaceId)
      return buildGovernanceReport(this.store.read().data, query, this.clock.now())
    })
  }

  getIssueActivity(
    issueId: IssueId,
    options?: RequestOptions,
  ): Promise<IssueActivityData> {
    return this.execute('issue.activity', options, () => {
      const data = this.store.read().data
      const issue = data.issues.find(({ id }) => id === issueId)

      if (!issue) throw new EntityNotFoundError('Issue')
      this.assertPermission('issue:view', issue.workspaceId, issue.projectId)

      const comments = data.comments
        .filter(({ issueId: commentIssueId }) => commentIssueId === issueId)
        .sort(compareTimelineEntries)
      const activityEvents = data.activityEvents
        .filter(
          ({ entityKind, entityId }) =>
            entityKind === 'issue' && entityId === issueId,
        )
        .sort(compareTimelineEntries)
      const commentIds = new Set(comments.map(({ id }) => id))
      const commentMentions = data.commentMentions.filter(
        ({ commentId, removedAt }) => commentIds.has(commentId) && removedAt === null,
      )
      const mentionedUserIds = commentMentions
        .map(({ userId }) => userId)
      const userIds = new Set([
        ...comments.map(({ authorId }) => authorId),
        ...activityEvents.map(({ actorId }) => actorId),
        ...mentionedUserIds,
      ])
      const activeMemberIds = new Set(
        data.memberships
          .filter(
            ({ workspaceId, status }) =>
              workspaceId === issue.workspaceId && status === 'active',
          )
          .map(({ userId }) => userId),
      )

      return {
        comments,
        commentMentions,
        activityEvents,
        users: data.users.filter(({ id }) => userIds.has(id)),
        mentionableUsers: data.users
          .filter(({ id }) => id !== this.actorId && activeMemberIds.has(id))
          .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      }
    })
  }

  getIssueSubscription(
    issueId: IssueId,
    options?: RequestOptions,
  ): Promise<IssueSubscriptionData> {
    return this.execute('issue.subscription.get', options, () => {
      const data = this.store.read().data
      const issue = data.issues.find(({ id }) => id === issueId)
      if (!issue) throw new EntityNotFoundError('Issue')
      this.assertPermission('issue:view', issue.workspaceId, issue.projectId)
      return this.buildIssueSubscriptionData(data, issue)
    })
  }

  getProjectSubscription(
    projectId: ProjectId,
    options?: RequestOptions,
  ): Promise<ProjectSubscriptionData> {
    return this.execute('project.subscription.get', options, () => {
      const data = this.store.read().data
      const project = data.projects.find(({ id }) => id === projectId)
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('project:view', project.workspaceId, project.id)
      return this.buildProjectSubscriptionData(data, project)
    })
  }

  setProjectSubscription(
    input: SetProjectSubscriptionInput,
    options?: RequestOptions,
  ): Promise<ProjectSubscriptionData> {
    return this.execute('project.subscription.update', options, (requestId) => {
      const current = this.store.read()
      const project = current.data.projects.find(({ id }) => id === input.projectId)
      if (!project) throw new EntityNotFoundError('Project')
      this.assertPermission('project:subscribe', project.workspaceId, project.id)
      if (input.subscribed && project.status === 'archived') {
        throw new GatewayConflictError('Archived projects cannot gain new watchers.')
      }

      const existing = current.data.projectSubscriptions.find(
        ({ projectId, userId }) => projectId === project.id && userId === this.actorId,
      )
      if (Boolean(existing) !== input.expectedSubscribed) {
        throw new GatewayConflictError(
          'The project subscription changed in another session. Refresh and try again.',
        )
      }
      if (Boolean(existing) === input.subscribed) {
        return this.buildProjectSubscriptionData(current.data, project)
      }

      const occurredAt = this.clock.now()
      const projectSubscriptions = input.subscribed
        ? [
            ...current.data.projectSubscriptions,
            {
              id: this.ids.projectSubscription('project'),
              projectId: project.id,
              userId: this.actorId,
              createdAt: occurredAt,
            },
          ]
        : current.data.projectSubscriptions.filter(({ id }) => id !== existing?.id)
      const action = input.subscribed ? 'project.subscribed' : 'project.unsubscribed'
      const nextData: AtlasDataSnapshot = {
        ...current.data,
        projectSubscriptions,
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity(action.replace('.', '_')),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            entityKind: 'project',
            entityId: project.id,
            action,
            occurredAt,
            summary: input.subscribed
              ? 'Started watching this project.'
              : 'Stopped watching this project.',
          },
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit(action.replace('.', '_')),
            workspaceId: project.workspaceId,
            actorId: this.actorId,
            requestId,
            action,
            outcome: 'succeeded',
            occurredAt,
            metadata: { projectId: project.id, subscribed: input.subscribed },
          },
        ],
      }
      this.commit(current.version, nextData)
      return this.buildProjectSubscriptionData(nextData, project)
    })
  }

  setIssueSubscription(
    input: SetIssueSubscriptionInput,
    options?: RequestOptions,
  ): Promise<IssueSubscriptionData> {
    return this.execute('issue.subscription.update', options, (requestId) => {
      const current = this.store.read()
      const issue = current.data.issues.find(({ id }) => id === input.issueId)
      if (!issue) throw new EntityNotFoundError('Issue')
      this.assertPermission('issue:subscribe', issue.workspaceId, issue.projectId)

      const existing = current.data.issueSubscriptions.find(
        ({ issueId, userId }) => issueId === issue.id && userId === this.actorId,
      )
      if (Boolean(existing) !== input.expectedSubscribed) {
        throw new GatewayConflictError(
          'The issue subscription changed in another session. Refresh and try again.',
        )
      }
      if (Boolean(existing) === input.subscribed) {
        return this.buildIssueSubscriptionData(current.data, issue)
      }

      const occurredAt = this.clock.now()
      const issueSubscriptions = input.subscribed
        ? [
            ...current.data.issueSubscriptions,
            {
              id: this.ids.issueSubscription('issue'),
              issueId: issue.id,
              userId: this.actorId,
              createdAt: occurredAt,
            },
          ]
        : current.data.issueSubscriptions.filter(({ id }) => id !== existing?.id)
      const action = input.subscribed ? 'issue.subscribed' : 'issue.unsubscribed'
      const nextData: AtlasDataSnapshot = {
        ...current.data,
        issueSubscriptions,
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity(action.replace('.', '_')),
            workspaceId: issue.workspaceId,
            actorId: this.actorId,
            entityKind: 'issue',
            entityId: issue.id,
            action,
            occurredAt,
            summary: input.subscribed
              ? 'Started watching this issue.'
              : 'Stopped watching this issue.',
          },
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit(action.replace('.', '_')),
            workspaceId: issue.workspaceId,
            actorId: this.actorId,
            requestId,
            action,
            outcome: 'succeeded',
            occurredAt,
            metadata: { issueId: issue.id, subscribed: input.subscribed },
          },
        ],
      }
      this.commit(current.version, nextData)
      return this.buildIssueSubscriptionData(nextData, issue)
    })
  }

  listNotifications(
    query: NotificationQuery,
    options?: RequestOptions,
  ): Promise<NotificationInbox> {
    return this.execute('notification.list', options, () => {
      this.assertPermission('notifications:view-self', query.workspaceId)
      const page = validatePage(query.page ?? { number: 1, size: 20 })
      const notifications = this.store
        .read()
        .data.notifications.filter(
          (notification) =>
            notification.workspaceId === query.workspaceId &&
            notification.recipientId === this.actorId,
        )
        .sort(
          (left, right) =>
            right.occurredAt.localeCompare(left.occurredAt) ||
            right.id.localeCompare(left.id),
        )
      const categoryItems = query.category
        ? notifications.filter(
            ({ kind }) => notificationCategory(kind) === query.category,
          )
        : notifications
      const items = query.read === undefined
        ? categoryItems
        : categoryItems.filter(({ readAt }) => (readAt !== null) === query.read)
      const categoryCounts = new Map<ReturnType<typeof notificationCategory>, number>()
      for (const notification of notifications) {
        const category = notificationCategory(notification.kind)
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
      }

      return {
        ...paginate(items, page),
        unreadCount: notifications.filter(({ readAt }) => readAt === null).length,
        readCount: notifications.filter(({ readAt }) => readAt !== null).length,
        matchingUnreadCount: items.filter(({ readAt }) => readAt === null).length,
        categories: [...categoryCounts]
          .map(([value, count]) => ({ value, count }))
          .sort((left, right) => left.value.localeCompare(right.value)),
      }
    })
  }

  markNotificationRead(
    input: MarkNotificationReadInput,
    options?: RequestOptions,
  ): Promise<Notification> {
    return this.execute('notification.mark-read', options, () => {
      const current = this.store.read()
      const index = current.data.notifications.findIndex(({ id }) => id === input.id)
      const notification = current.data.notifications[index]

      if (!notification) throw new EntityNotFoundError('Notification')
      this.assertNotificationRecipient(notification)
      const readAt = input.read ? (notification.readAt ?? this.clock.now()) : null
      if (readAt === notification.readAt) return notification

      const updated = { ...notification, readAt }
      const notifications = [...current.data.notifications]
      notifications[index] = updated
      this.commit(current.version, { ...current.data, notifications })
      return updated
    })
  }

  updateNotificationsReadState(
    input: UpdateNotificationsReadStateInput,
    options?: RequestOptions,
  ): Promise<number> {
    return this.execute('notification.update-read-state', options, () => {
      this.assertPermission('notifications:view-self', input.workspaceId)
      const current = this.store.read()
      const occurredAt = this.clock.now()
      const requestedIds = input.ids ? new Set(input.ids) : null
      if (requestedIds) {
        for (const id of requestedIds) {
          const notification = current.data.notifications.find(
            (candidate) => candidate.id === id,
          )
          if (!notification) throw new EntityNotFoundError('Notification')
          if (notification.workspaceId !== input.workspaceId) {
            throw new ForbiddenGatewayError(
              'Notification does not belong to this workspace inbox.',
            )
          }
          this.assertNotificationRecipient(notification)
        }
      }
      let updatedCount = 0
      const notifications = current.data.notifications.map((notification) => {
        if (
          notification.workspaceId !== input.workspaceId ||
          notification.recipientId !== this.actorId ||
          (requestedIds && !requestedIds.has(notification.id)) ||
          (input.category &&
            notificationCategory(notification.kind) !== input.category) ||
          (input.currentRead !== undefined &&
            (notification.readAt !== null) !== input.currentRead) ||
          (notification.readAt !== null) === input.read
        ) {
          return notification
        }
        updatedCount += 1
        return { ...notification, readAt: input.read ? occurredAt : null }
      })

      if (updatedCount > 0) {
        this.commit(current.version, { ...current.data, notifications })
      }
      return updatedCount
    })
  }

  getNotificationPreferences(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<NotificationPreferences> {
    return this.execute('notification.preferences.get', options, () => {
      this.assertPermission('notification-preferences:manage-self', workspaceId)
      const preferences = this.store.read().data.notificationPreferences.find(
        (candidate) =>
          candidate.workspaceId === workspaceId && candidate.userId === this.actorId,
      )
      if (!preferences) throw new EntityNotFoundError('Notification preferences')
      return preferences
    })
  }

  updateNotificationPreferences(
    input: UpdateNotificationPreferencesInput,
    options?: RequestOptions,
  ): Promise<NotificationPreferences> {
    return this.execute('notification.preferences.update', options, (requestId) => {
      this.assertPermission('notification-preferences:manage-self', input.workspaceId)
      const current = this.store.read()
      const index = current.data.notificationPreferences.findIndex(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.userId === this.actorId,
      )
      const preferences = current.data.notificationPreferences[index]
      if (!preferences) throw new EntityNotFoundError('Notification preferences')
      if (preferences.revision !== input.expectedRevision) {
        throw new GatewayConflictError(
          'Notification preferences changed after they were loaded. Refresh and try again.',
        )
      }

      const occurredAt = this.clock.now()
      const updated: NotificationPreferences = {
        ...preferences,
        assignments: input.assignments,
        comments: input.comments,
        issueUpdates: input.issueUpdates,
        projectUpdates: input.projectUpdates,
        revision: preferences.revision + 1,
      }
      const notificationPreferences = [...current.data.notificationPreferences]
      notificationPreferences[index] = updated
      this.commit(current.version, {
        ...current.data,
        notificationPreferences,
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit('notification_preferences_updated'),
            workspaceId: input.workspaceId,
            actorId: this.actorId,
            requestId,
            action: 'notification.preferences.updated',
            outcome: 'succeeded',
            occurredAt,
            metadata: { revision: updated.revision },
          },
        ],
      })
      return updated
    })
  }

  createComment(
    input: CreateCommentInput,
    options?: RequestOptions,
  ): Promise<Comment> {
    return this.execute('comment.create', options, (requestId) => {
      const current = this.store.read()
      const issue = current.data.issues.find(({ id }) => id === input.issueId)

      if (!issue) throw new EntityNotFoundError('Issue')
      this.assertPermission('comment:create', issue.workspaceId, issue.projectId)
      this.assertProjectOpen(current.data, issue.projectId)

      const body = input.body.trim()
      if (body.length === 0 || body.length > 5_000) {
        throw new InvalidGatewayRequestError(
          'Comments must contain 1 to 5,000 characters.',
        )
      }

      const occurredAt = this.clock.now()
      const comment: Comment = {
        id: this.ids.comment('issue'),
        issueId: issue.id,
        authorId: this.actorId,
        body,
        revision: 1,
        createdAt: occurredAt,
        editedAt: null,
        deletedAt: null,
        deletedById: null,
      }
      const mentionedUsers = this.resolveCommentMentions(
        current.data,
        issue,
        body,
        input.mentionedUserIds ?? [],
      )
      const mentionedUserIds = new Set(mentionedUsers.map(({ id }) => id))
      const commentMentions = mentionedUsers.map(({ id: userId }) => ({
        id: this.ids.commentMention('comment'),
        commentId: comment.id,
        userId,
        createdAt: occurredAt,
        removedAt: null,
      }))
      const authorAlreadySubscribed = current.data.issueSubscriptions.some(
        ({ issueId, userId }) => issueId === issue.id && userId === this.actorId,
      )
      const issueSubscriptions = authorAlreadySubscribed
        ? current.data.issueSubscriptions
        : [
            ...current.data.issueSubscriptions,
            {
              id: this.ids.issueSubscription('comment_author'),
              issueId: issue.id,
              userId: this.actorId,
              createdAt: occurredAt,
            },
          ]
      const notificationRecipientIds = new Set<UserId>([
        ...issueSubscriptions
          .filter(({ issueId }) => issueId === issue.id)
          .map(({ userId }) => userId),
        ...(issue.assigneeId ? [issue.assigneeId] : []),
        ...mentionedUserIds,
      ])
      notificationRecipientIds.delete(this.actorId)
      const commentNotifications: readonly Notification[] = [
        ...notificationRecipientIds,
      ]
        .filter((recipientId) =>
          this.allowsNotification(
            current.data,
            issue.workspaceId,
            recipientId,
            'comment',
          ),
        )
        .sort((left, right) => left.localeCompare(right))
        .map((recipientId) => ({
          id: this.ids.notification('comment_created'),
          workspaceId: issue.workspaceId,
          recipientId,
          kind: mentionedUserIds.has(recipientId) ? 'mention' : 'comment',
          target: { kind: 'issue', id: issue.id },
          title: mentionedUserIds.has(recipientId)
            ? `You were mentioned on ${this.issueReference(current.data, issue)}`
            : `New comment on ${this.issueReference(current.data, issue)}`,
          body: body.slice(0, 160),
          occurredAt,
          readAt: null,
        }))
      const nextData: AtlasDataSnapshot = {
        ...current.data,
        comments: [...current.data.comments, comment],
        commentMentions: [...current.data.commentMentions, ...commentMentions],
        issueSubscriptions,
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity('comment_created'),
            workspaceId: issue.workspaceId,
            actorId: this.actorId,
            entityKind: 'issue',
            entityId: issue.id,
            action: 'comment.created',
            occurredAt,
            summary: 'Added a comment.',
          },
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit('comment_created'),
            workspaceId: issue.workspaceId,
            actorId: this.actorId,
            requestId,
            action: 'comment.created',
            outcome: 'succeeded',
            occurredAt,
            metadata: {
              issueId: issue.id,
              commentId: comment.id,
              notificationCount: commentNotifications.length,
              autoSubscribed: !authorAlreadySubscribed,
              mentionCount: commentMentions.length,
            },
          },
        ],
        notifications: [...current.data.notifications, ...commentNotifications],
      }

      this.commit(current.version, nextData)
      return comment
    })
  }

  updateComment(
    input: UpdateCommentInput,
    options?: RequestOptions,
  ): Promise<Comment> {
    return this.execute('comment.update', options, (requestId) => {
      const current = this.store.read()
      const index = current.data.comments.findIndex(({ id }) => id === input.id)
      const comment = current.data.comments[index]
      const issue = current.data.issues.find(({ id }) => id === comment?.issueId)
      if (!comment || !issue) throw new EntityNotFoundError('Comment')
      if (comment.authorId !== this.actorId) {
        throw new ForbiddenGatewayError('Only the comment author can edit it.')
      }
      this.assertPermission('comment:edit-own', issue.workspaceId, issue.projectId)
      this.assertProjectOpen(current.data, issue.projectId)
      if (comment.deletedAt !== null || comment.revision !== input.expectedRevision) {
        throw new GatewayConflictError(
          'The comment changed or was removed. Refresh and try again.',
        )
      }
      const body = input.body.trim()
      if (body.length === 0 || body.length > 5_000) {
        throw new InvalidGatewayRequestError(
          'Comments must contain 1 to 5,000 characters.',
        )
      }
      const activeMentions = current.data.commentMentions.filter(
        ({ commentId, removedAt }) => commentId === comment.id && removedAt === null,
      )
      const requestedMentionUsers = input.mentionedUserIds
        ? this.resolveCommentMentions(current.data, issue, body, input.mentionedUserIds)
        : current.data.users.filter(({ id }) =>
            activeMentions.some(({ userId }) => userId === id),
          )
      const requestedMentionIds = new Set(requestedMentionUsers.map(({ id }) => id))
      const activeMentionIds = new Set(activeMentions.map(({ userId }) => userId))
      const addedMentionIds = [...requestedMentionIds].filter(
        (userId) => !activeMentionIds.has(userId),
      )
      const removedMentionIds = [...activeMentionIds].filter(
        (userId) => !requestedMentionIds.has(userId),
      )
      if (
        body === comment.body &&
        addedMentionIds.length === 0 &&
        removedMentionIds.length === 0
      ) return comment

      const occurredAt = this.clock.now()
      const updated: Comment = {
        ...comment,
        body,
        revision: comment.revision + 1,
        editedAt: occurredAt,
      }
      const comments = [...current.data.comments]
      comments[index] = updated
      const commentMentions = current.data.commentMentions.map((mention) =>
        mention.commentId === comment.id && removedMentionIds.includes(mention.userId)
          ? { ...mention, removedAt: occurredAt }
          : mention,
      )
      for (const userId of addedMentionIds) {
        const existingIndex = commentMentions.findIndex(
          (mention) => mention.commentId === comment.id && mention.userId === userId,
        )
        if (existingIndex >= 0) {
          const existing = commentMentions[existingIndex]
          if (existing) commentMentions[existingIndex] = { ...existing, removedAt: null }
        } else {
          commentMentions.push({
            id: this.ids.commentMention('comment_edit'),
            commentId: comment.id,
            userId,
            createdAt: occurredAt,
            removedAt: null,
          })
        }
      }
      const mentionNotifications: readonly Notification[] = addedMentionIds
        .filter((recipientId) =>
          this.allowsNotification(
            current.data,
            issue.workspaceId,
            recipientId,
            'mention',
          ),
        )
        .sort((left, right) => left.localeCompare(right))
        .map((recipientId) => ({
          id: this.ids.notification('comment_mention_added'),
          workspaceId: issue.workspaceId,
          recipientId,
          kind: 'mention',
          target: { kind: 'issue', id: issue.id },
          title: `You were mentioned on ${this.issueReference(current.data, issue)}`,
          body: body.slice(0, 160),
          occurredAt,
          readAt: null,
        }))
      this.commit(current.version, {
        ...current.data,
        comments,
        commentMentions,
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity('comment_updated'),
            workspaceId: issue.workspaceId,
            actorId: this.actorId,
            entityKind: 'issue',
            entityId: issue.id,
            action: 'comment.updated',
            occurredAt,
            summary: 'Edited a comment.',
          },
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit('comment_updated'),
            workspaceId: issue.workspaceId,
            actorId: this.actorId,
            requestId,
            action: 'comment.updated',
            outcome: 'succeeded',
            occurredAt,
            metadata: {
              issueId: issue.id,
              commentId: updated.id,
              revision: updated.revision,
              addedMentionCount: addedMentionIds.length,
              removedMentionCount: removedMentionIds.length,
              notificationCount: mentionNotifications.length,
            },
          },
        ],
        notifications: [...current.data.notifications, ...mentionNotifications],
      })
      return updated
    })
  }

  deleteComment(
    input: DeleteCommentInput,
    options?: RequestOptions,
  ): Promise<Comment> {
    return this.execute('comment.delete', options, (requestId) => {
      const current = this.store.read()
      const index = current.data.comments.findIndex(({ id }) => id === input.id)
      const comment = current.data.comments[index]
      const issue = current.data.issues.find(({ id }) => id === comment?.issueId)
      if (!comment || !issue) throw new EntityNotFoundError('Comment')
      const moderated = comment.authorId !== this.actorId
      this.assertPermission(
        moderated ? 'comment:moderate' : 'comment:delete-own',
        issue.workspaceId,
        issue.projectId,
      )
      this.assertProjectOpen(current.data, issue.projectId)
      if (comment.deletedAt !== null || comment.revision !== input.expectedRevision) {
        throw new GatewayConflictError(
          'The comment changed or was already removed. Refresh and try again.',
        )
      }

      const occurredAt = this.clock.now()
      const deleted: Comment = {
        ...comment,
        body: '',
        revision: comment.revision + 1,
        deletedAt: occurredAt,
        deletedById: this.actorId,
      }
      const comments = [...current.data.comments]
      comments[index] = deleted
      const activeMentionIds = new Set(
        current.data.commentMentions
          .filter(
            ({ commentId, removedAt }) => commentId === comment.id && removedAt === null,
          )
          .map(({ userId }) => userId),
      )
      const commentMentions = current.data.commentMentions.map((mention) =>
        mention.commentId === comment.id && mention.removedAt === null
          ? { ...mention, removedAt: occurredAt }
          : mention,
      )
      const action = moderated ? 'comment.moderated' : 'comment.deleted'
      const idScope = moderated ? 'comment_moderated' : 'comment_deleted'
      this.commit(current.version, {
        ...current.data,
        comments,
        commentMentions,
        activityEvents: [
          ...current.data.activityEvents,
          {
            id: this.ids.activity(idScope),
            workspaceId: issue.workspaceId,
            actorId: this.actorId,
            entityKind: 'issue',
            entityId: issue.id,
            action,
            occurredAt,
            summary: moderated ? 'Removed a comment as a moderator.' : 'Deleted a comment.',
          },
        ],
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit(idScope),
            workspaceId: issue.workspaceId,
            actorId: this.actorId,
            requestId,
            action,
            outcome: 'succeeded',
            occurredAt,
            metadata: {
              issueId: issue.id,
              commentId: deleted.id,
              revision: deleted.revision,
              moderated,
              removedMentionCount: activeMentionIds.size,
            },
          },
        ],
      })
      return deleted
    })
  }

  getIssueRelationships(id: IssueId, options?: RequestOptions): Promise<IssueRelationshipData> {
    return this.execute('issue.relationships.get', options, () => {
      const data = this.store.read().data
      const issue = data.issues.find((candidate) => candidate.id === id)
      if (!issue) throw new EntityNotFoundError('Issue')
      this.assertPermission('issue:view', issue.workspaceId, issue.projectId)
      return {
        issue,
        projectIssues: data.issues.filter(({ projectId }) => projectId === issue.projectId),
        relations: data.issueRelations.filter(({ sourceIssueId, targetIssueId }) =>
          sourceIssueId === id || targetIssueId === id),
      }
    })
  }

  createIssueRelation(input: CreateIssueRelationInput, options?: RequestOptions): Promise<IssueRelation> {
    return this.execute('issue.relation.create', options, (requestId) => {
      if (!['blocks', 'relates-to', 'duplicates'].includes(input.type)) {
        throw new InvalidGatewayRequestError('Unknown issue relationship type.')
      }
      const data = this.store.read().data
      const duplicate = data.issueRelations.some((relation) => relation.type === input.type && (
        (relation.sourceIssueId === input.sourceIssueId && relation.targetIssueId === input.targetIssueId) ||
        (input.type === 'relates-to' && relation.sourceIssueId === input.targetIssueId && relation.targetIssueId === input.sourceIssueId)
      ))
      if (duplicate) throw new InvalidGatewayRequestError('That issue relationship already exists.')
      let id = this.ids.issueRelation('relationship')
      while (data.issueRelations.some((relation) => relation.id === id)) {
        id = this.ids.issueRelation('relationship')
      }
      const relation: IssueRelation = {
        id, sourceIssueId: input.sourceIssueId, targetIssueId: input.targetIssueId, type: input.type,
      }
      this.changeIssueRelation(relation, input, false, requestId)
      return relation
    })
  }

  removeIssueRelation(input: RemoveIssueRelationInput, options?: RequestOptions): Promise<void> {
    return this.execute('issue.relation.remove', options, (requestId) => {
      const relation = this.store.read().data.issueRelations.find(({ id }) => id === input.id)
      if (!relation) throw new EntityNotFoundError('Issue relationship')
      this.changeIssueRelation(relation, input, true, requestId)
    })
  }

  private changeIssueRelation(
    relation: IssueRelation,
    revisions: Pick<CreateIssueRelationInput, 'expectedSourceRevision' | 'expectedTargetRevision'>,
    remove: boolean,
    requestId: string,
  ): void {
    const current = this.store.read()
    const source = current.data.issues.find(({ id }) => id === relation.sourceIssueId)
    const target = current.data.issues.find(({ id }) => id === relation.targetIssueId)
    if (!source || !target) throw new EntityNotFoundError('Issue')
    this.assertPermission('issue:update', source.workspaceId, source.projectId)
    this.assertPermission('issue:update', target.workspaceId, target.projectId)
    this.assertProjectOpen(current.data, source.projectId)
    if (source.id === target.id || source.projectId !== target.projectId || source.workspaceId !== target.workspaceId) {
      throw new InvalidGatewayRequestError('Relationships require two different issues in the same project.')
    }
    if (source.revision !== revisions.expectedSourceRevision || target.revision !== revisions.expectedTargetRevision) {
      throw new GatewayConflictError('An issue changed. Refresh the relationships and try again.')
    }
    const occurredAt = this.clock.now()
    const action = remove ? 'issue.relationship.removed' : 'issue.relationship.created'
    const summary = `${remove ? 'Removed' : 'Added'} ${relation.type}: ${this.issueReference(current.data, source)} to ${this.issueReference(current.data, target)}`
    const activity = [source, target].map((issue): ActivityEvent => {
      let id = this.ids.activity('relationship')
      while (current.data.activityEvents.some((event) => event.id === id)) {
        id = this.ids.activity('relationship')
      }
      return { id, workspaceId: source.workspaceId, actorId: this.actorId,
        entityKind: 'issue', entityId: issue.id, action, occurredAt, summary }
    })
    let auditId = this.ids.audit('relationship')
    while (current.data.auditEvents.some((event) => event.id === auditId)) {
      auditId = this.ids.audit('relationship')
    }
    this.commit(current.version, {
      ...current.data,
      issues: current.data.issues.map((issue) => issue.id === source.id || issue.id === target.id
        ? { ...issue, revision: issue.revision + 1, updatedAt: occurredAt } : issue),
      issueRelations: remove
        ? current.data.issueRelations.filter(({ id }) => id !== relation.id)
        : [...current.data.issueRelations, relation],
      activityEvents: [...current.data.activityEvents, ...activity],
      auditEvents: [...current.data.auditEvents, {
        id: auditId, workspaceId: source.workspaceId,
        actorId: this.actorId, requestId, action, outcome: 'succeeded', occurredAt,
        metadata: { relationId: relation.id, sourceIssueId: source.id, targetIssueId: target.id,
          type: relation.type, sourceRevision: source.revision + 1, targetRevision: target.revision + 1 },
      }],
    })
  }

  createIssue(
    input: CreateIssueInput,
    options?: RequestOptions,
  ): Promise<Issue> {
    return this.execute('issue.create', options, () => {
      const current = this.store.read()
      const project = current.data.projects.find(({ id }) => id === input.projectId)

      if (project?.workspaceId !== input.workspaceId) {
        throw new InvalidGatewayRequestError(
          'New issues must reference a project in their workspace.',
        )
      }

      if (!openProjectStatuses.has(project.status)) {
        throw new InvalidGatewayRequestError(
          'New issues require a project that is open for work.',
        )
      }

      this.assertPermission('issue:create', input.workspaceId, project.id)
      const { title, description } = this.validateNewIssue(current.data, input)

      const projectIssues = current.data.issues.filter(
        ({ projectId }) => projectId === project.id,
      )
      const occurredAt = this.clock.now()
      const issue: Issue = {
        ...input,
        id: this.ids.issue(project.key.toLocaleLowerCase()),
        title,
        description,
        number:
          projectIssues.reduce(
            (highest, candidate) => Math.max(highest, candidate.number),
            0,
          ) + 1,
        revision: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }
      const nextData = {
        ...current.data,
        issues: [...current.data.issues, issue],
        notifications:
          issue.assigneeId &&
          issue.assigneeId !== this.actorId &&
          this.allowsNotification(
            current.data,
            issue.workspaceId,
            issue.assigneeId,
            'assignment',
          )
            ? [
                ...current.data.notifications,
                {
                  id: this.ids.notification('issue_assigned'),
                  workspaceId: issue.workspaceId,
                  recipientId: issue.assigneeId,
                  kind: 'assignment' as const,
                  target: { kind: 'issue', id: issue.id } as const,
                  title: `You were assigned ${project.key}-${issue.number.toString()}`,
                  body: issue.title,
                  occurredAt,
                  readAt: null,
                },
              ]
            : current.data.notifications,
      }

      this.commit(current.version, nextData)
      return issue
    })
  }

  updateIssue(
    input: UpdateIssueInput,
    options?: RequestOptions,
  ): Promise<Issue> {
    return this.execute('issue.update', options, (requestId) => {
      const current = this.store.read()
      const issueIndex = current.data.issues.findIndex(({ id }) => id === input.id)
      const issue = current.data.issues[issueIndex]

      if (!issue) {
        throw new EntityNotFoundError('Issue')
      }

      this.assertPermission('issue:update', issue.workspaceId, issue.projectId)
      this.assertProjectOpen(current.data, issue.projectId)

      if (issue.revision !== input.expectedRevision) {
        throw new GatewayConflictError(
          'The issue changed after it was loaded. Refresh and try again.',
        )
      }

      const title = input.changes.title?.trim() ?? issue.title
      if (title.length === 0) {
        throw new InvalidGatewayRequestError('Issue titles may not be empty.')
      }

      const nextStatusId = input.changes.statusId ?? issue.statusId
      const nextStatus = current.data.workflowStatuses.find(
        ({ id }) => id === nextStatusId,
      )
      if (nextStatus?.projectId !== issue.projectId) {
        throw new InvalidGatewayRequestError(
          'Issues must use a status from their project workflow.',
        )
      }

      const occurredAt = this.clock.now()
      const updatedIssue: Issue = {
        ...issue,
        ...input.changes,
        title,
        revision: issue.revision + 1,
        updatedAt: occurredAt,
      }
      const issues = [...current.data.issues]
      issues[issueIndex] = updatedIssue
      const statusChanged = updatedIssue.statusId !== issue.statusId
      const notificationRecipient = updatedIssue.assigneeId
      const assignmentChanged = updatedIssue.assigneeId !== issue.assigneeId
      const nextData: AtlasDataSnapshot = {
        ...current.data,
        issues,
        activityEvents: statusChanged
          ? [
              ...current.data.activityEvents,
              {
                id: this.ids.activity('issue_status_changed'),
                workspaceId: issue.workspaceId,
                actorId: this.actorId,
                entityKind: 'issue',
                entityId: issue.id,
                action: 'issue.status_changed',
                occurredAt,
                summary: `Moved from ${this.statusName(current.data, issue.statusId)} to ${nextStatus.name}.`,
              },
            ]
          : current.data.activityEvents,
        auditEvents: [
          ...current.data.auditEvents,
          {
            id: this.ids.audit('issue_updated'),
            workspaceId: issue.workspaceId,
            actorId: this.actorId,
            requestId,
            action: 'issue.updated',
            outcome: 'succeeded',
            occurredAt,
            metadata: {
              issueId: issue.id,
              fromRevision: issue.revision,
              toRevision: updatedIssue.revision,
            },
          },
        ],
        notifications:
          notificationRecipient &&
          notificationRecipient !== this.actorId &&
          this.allowsNotification(
            current.data,
            issue.workspaceId,
            notificationRecipient,
            assignmentChanged ? 'assignment' : 'issue-update',
          )
            ? [
                ...current.data.notifications,
                {
                  id: this.ids.notification(
                    assignmentChanged ? 'issue_assigned' : 'issue_updated',
                  ),
                  workspaceId: issue.workspaceId,
                  recipientId: notificationRecipient,
                  kind: assignmentChanged ? 'assignment' : 'issue-update',
                  target: { kind: 'issue', id: issue.id } as const,
                  title: assignmentChanged
                    ? `You were assigned ${this.issueReference(current.data, issue)}`
                    : `${this.issueReference(current.data, issue)} was updated`,
                  body: updatedIssue.title,
                  occurredAt,
                  readAt: null,
                },
              ]
            : current.data.notifications,
      }

      this.commit(current.version, nextData)
      return updatedIssue
    })
  }

  deleteIssue(
    input: DeleteIssueInput,
    options?: RequestOptions,
  ): Promise<void> {
    return this.execute('issue.delete', options, () => {
      const current = this.store.read()
      const issue = current.data.issues.find(({ id }) => id === input.id)

      if (!issue) {
        throw new EntityNotFoundError('Issue')
      }

      this.assertPermission('issue:delete', issue.workspaceId, issue.projectId)
      this.assertProjectOpen(current.data, issue.projectId)

      if (issue.revision !== input.expectedRevision) {
        throw new GatewayConflictError(
          'The issue changed after it was loaded. Refresh and try again.',
        )
      }

      if (current.data.issues.some(({ parentIssueId }) => parentIssueId === issue.id)) {
        throw new GatewayConflictError(
          'An issue with subtasks cannot be deleted until its subtasks are moved.',
        )
      }

      const nextData = {
        ...current.data,
        issues: current.data.issues.filter(({ id }) => id !== issue.id),
        issueSubscriptions: current.data.issueSubscriptions.filter(
          ({ issueId }) => issueId !== issue.id,
        ),
        issueRelations: current.data.issueRelations.filter(
          ({ sourceIssueId, targetIssueId }) =>
            sourceIssueId !== issue.id && targetIssueId !== issue.id,
        ),
        comments: current.data.comments.filter(({ issueId }) => issueId !== issue.id),
        commentMentions: current.data.commentMentions.filter(({ commentId }) =>
          current.data.comments.some(
            (comment) => comment.id === commentId && comment.issueId !== issue.id,
          ),
        ),
        activityEvents: current.data.activityEvents.filter(
          ({ entityKind, entityId }) =>
            entityKind !== 'issue' || entityId !== issue.id,
        ),
        notifications: current.data.notifications.filter(
          ({ target }) => target.kind !== 'issue' || target.id !== issue.id,
        ),
      }

      this.commit(current.version, nextData)
    })
  }

  private buildIssueSubscriptionData(
    data: AtlasDataSnapshot,
    issue: Issue,
  ): IssueSubscriptionData {
    const viewer = data.users.find(({ id }) => id === this.actorId)
    if (!viewer) throw new EntityNotFoundError('User')

    const activeUserIds = new Set(
      data.memberships
        .filter(
          ({ workspaceId, status }) =>
            workspaceId === issue.workspaceId && status === 'active',
        )
        .map(({ userId }) => userId),
    )
    const subscriberIds = new Set(
      data.issueSubscriptions
        .filter(({ issueId, userId }) => issueId === issue.id && activeUserIds.has(userId))
        .map(({ userId }) => userId),
    )
    const subscribers = data.users
      .filter(({ id }) => subscriberIds.has(id))
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id),
      )

    return {
      issueId: issue.id,
      subscribers,
      viewer,
      subscribed: subscriberIds.has(this.actorId),
    }
  }

  private buildProjectSubscriptionData(
    data: AtlasDataSnapshot,
    project: Project,
  ): ProjectSubscriptionData {
    const viewer = data.users.find(({ id }) => id === this.actorId)
    if (!viewer) throw new EntityNotFoundError('User')

    const activeUserIds = new Set(
      data.memberships
        .filter(
          ({ workspaceId, status }) =>
            workspaceId === project.workspaceId && status === 'active',
        )
        .map(({ userId }) => userId),
    )
    const subscriberIds = new Set(
      data.projectSubscriptions
        .filter(
          ({ projectId, userId }) =>
            projectId === project.id && activeUserIds.has(userId),
        )
        .map(({ userId }) => userId),
    )
    const subscribers = data.users
      .filter(({ id }) => subscriberIds.has(id))
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id),
      )

    return {
      projectId: project.id,
      subscribers,
      viewer,
      subscribed: subscriberIds.has(this.actorId),
    }
  }

  private async execute<T>(
    operation: GatewayOperation,
    options: RequestOptions | undefined,
    perform: (requestId: string) => T,
  ): Promise<T> {
    const requestId = this.nextRequestId()
    const recoveryEpoch = this.store.recoveryEpoch
    this.trace(requestId, operation, 'started')

    try {
      await this.simulator.wait(operation, requestId, options?.signal)

      if (options?.signal?.aborted === true) {
        throw new RequestCancelledError()
      }

      const result = await this.store.exclusive(() => {
        if (options?.signal?.aborted === true) throw new RequestCancelledError()
        if (recoveryEpoch !== this.store.recoveryEpoch) {
          throw new GatewayConflictError('Workspace was recovered while this request was pending. Refresh and try again.')
        }
        this.reserveSnapshotIds()
        return perform(requestId)
      })
      this.trace(requestId, operation, 'succeeded')
      return result
    } catch (error) {
      const gatewayError = this.toGatewayError(error)
      this.trace(
        requestId,
        operation,
        gatewayError instanceof RequestCancelledError ? 'cancelled' : 'failed',
        gatewayError,
      )
      throw gatewayError
    }
  }

  private assertProjectRevision(project: Project, expectedRevision: number): void {
    if (project.revision !== expectedRevision) {
      throw new GatewayConflictError(
        'This project changed after it was loaded. Refresh and try again.',
      )
    }
  }

  private assertAssignableProjectRole(role: ProjectMember['role']): void {
    if (!assignableProjectRoles.has(role) || role === 'lead') {
      throw new InvalidGatewayRequestError(
        'Project member roles must be contributor or viewer.',
      )
    }
  }

  private projectMembershipActivity(
    project: Project,
    occurredAt: ActivityEvent['occurredAt'],
    summary: string,
  ): ActivityEvent {
    return {
      id: this.ids.activity('project_membership'),
      workspaceId: project.workspaceId,
      actorId: this.actorId,
      entityKind: 'project',
      entityId: project.id,
      action: 'project.membership.updated',
      occurredAt,
      summary,
    }
  }

  private projectMembershipAudit(
    requestId: string,
    project: Project,
    occurredAt: AuditEvent['occurredAt'],
    action: string,
    metadata: AuditEvent['metadata'],
  ): AuditEvent {
    return {
      id: this.ids.audit('project_membership'),
      workspaceId: project.workspaceId,
      actorId: this.actorId,
      requestId,
      action,
      outcome: 'succeeded',
      occurredAt,
      metadata: { projectId: project.id, ...metadata },
    }
  }

  private assertPermission(
    permission: Permission,
    workspaceId: WorkspaceId,
    projectId?: ProjectId,
  ): void {
    if (!this.hasPermission(permission, workspaceId, projectId)) {
      throw new ForbiddenGatewayError()
    }
  }

  private assertNotificationRecipient(notification: Notification): void {
    this.assertPermission('notifications:view-self', notification.workspaceId)
    if (notification.recipientId !== this.actorId) {
      throw new ForbiddenGatewayError()
    }
  }

  private assertProjectOpen(data: AtlasDataSnapshot, projectId: ProjectId): void {
    const project = data.projects.find(({ id }) => id === projectId)
    if (!project || !openProjectStatuses.has(project.status)) {
      throw new GatewayConflictError(
        'This project is read-only because it is completed or archived.',
      )
    }
  }

  private allowsNotification(
    data: AtlasDataSnapshot,
    workspaceId: WorkspaceId,
    recipientId: UserId,
    kind: NotificationKind,
  ): boolean {
    const activeMembership = data.memberships.some(
      (membership) =>
        membership.workspaceId === workspaceId &&
        membership.userId === recipientId &&
        membership.status === 'active',
    )
    if (!activeMembership) return false
    const preferences = data.notificationPreferences.find(
      (candidate) =>
        candidate.workspaceId === workspaceId && candidate.userId === recipientId,
    )
    if (!preferences) return false
    if (kind === 'assignment') return preferences.assignments
    if (kind === 'comment' || kind === 'mention') return preferences.comments
    if (kind === 'project-update') return preferences.projectUpdates
    return preferences.issueUpdates
  }

  private buildProjectUpdateNotifications(
    data: AtlasDataSnapshot,
    project: Project,
    occurredAt: IsoDateTime,
    title: string,
    body: string,
  ): readonly Notification[] {
    const recipientIds = new Set(
      data.projectSubscriptions
        .filter(
          ({ projectId, userId }) =>
            projectId === project.id &&
            userId !== this.actorId &&
            this.allowsNotification(
              data,
              project.workspaceId,
              userId,
              'project-update',
            ),
        )
        .map(({ userId }) => userId),
    )

    return [...recipientIds]
      .sort((left, right) => left.localeCompare(right))
      .map((recipientId) => ({
        id: this.ids.notification('project_updated'),
        workspaceId: project.workspaceId,
        recipientId,
        kind: 'project-update' as const,
        target: { kind: 'project' as const, id: project.id },
        title,
        body,
        occurredAt,
        readAt: null,
      }))
  }

  private resolveCommentMentions(
    data: AtlasDataSnapshot,
    issue: Issue,
    body: string,
    requestedUserIds: readonly UserId[],
  ) {
    const activeMemberIds = new Set(
      data.memberships
        .filter(
          ({ workspaceId, status }) =>
            workspaceId === issue.workspaceId && status === 'active',
        )
        .map(({ userId }) => userId),
    )

    const requested = new Set(requestedUserIds)
    return data.users
      .filter(({ id, displayName }) => {
        if (
          !requested.has(id) ||
          id === this.actorId ||
          !activeMemberIds.has(id)
        ) return false
        const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(
          `(^|\\s)@${escapedName}(?=$|[\\s.,!?;:])`,
          'iu',
        ).test(body)
      })
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  private hasPermission(
    permission: Permission,
    workspaceId: WorkspaceId,
    projectId?: ProjectId,
  ): boolean {
    const data = this.store.read().data
    const workspaceMembership = data.memberships.find(
      (membership) =>
        membership.workspaceId === workspaceId && membership.userId === this.actorId,
    )

    if (!workspaceMembership) {
      return false
    }

    const projectMembership = projectId
      ? (data.projectMembers.find(
          (membership) =>
            membership.projectId === projectId && membership.userId === this.actorId,
        ) ?? null)
      : null

    return can({ workspaceMembership, projectMembership }, permission, projectId)
  }

  private validateNewIssue(
    data: AtlasDataSnapshot,
    input: CreateIssueInput,
  ): { readonly title: string; readonly description: string } {
    const title = input.title.trim()
    const description = input.description.trim()
    const status = data.workflowStatuses.find(({ id }) => id === input.statusId)
    const parent = input.parentIssueId
      ? data.issues.find(({ id }) => id === input.parentIssueId)
      : null
    const labelIds = new Set(input.labelIds)
    const labelsAreValid = input.labelIds.every(
      (labelId) =>
        data.labels.find(({ id }) => id === labelId)?.workspaceId === input.workspaceId,
    )
    const assigneeIsValid =
      input.assigneeId === null ||
      (data.memberships.some(
        (membership) =>
          membership.workspaceId === input.workspaceId &&
          membership.userId === input.assigneeId &&
          membership.status === 'active',
      ) &&
        data.projectMembers.some(
          (membership) =>
            membership.projectId === input.projectId &&
            membership.userId === input.assigneeId,
        ))

    if (!['task', 'bug', 'story'].includes(input.type)) {
      throw new InvalidGatewayRequestError('Issue types are not valid.')
    }
    if (!['urgent', 'high', 'medium', 'low', 'none'].includes(input.priority)) {
      throw new InvalidGatewayRequestError('Issue priorities are not valid.')
    }

    if (title.length === 0 || title.length > 160) {
      throw new InvalidGatewayRequestError(
        'Issue titles must contain 1 to 160 characters.',
      )
    }
    if (description.length > 5_000) {
      throw new InvalidGatewayRequestError(
        'Issue descriptions may not exceed 5,000 characters.',
      )
    }
    if (status?.projectId !== input.projectId) {
      throw new InvalidGatewayRequestError(
        'New issues must use a status from their project workflow.',
      )
    }
    if (!assigneeIsValid) {
      throw new InvalidGatewayRequestError(
        'Issue assignees must be active members of the selected project.',
      )
    }
    if (!labelsAreValid || labelIds.size !== input.labelIds.length) {
      throw new InvalidGatewayRequestError(
        'Issue labels must be unique and belong to the issue workspace.',
      )
    }
    if (input.parentIssueId !== null && parent?.projectId !== input.projectId) {
      throw new InvalidGatewayRequestError(
        'Parent issues must belong to the selected project.',
      )
    }
    if (input.dueDate !== null) {
      try {
        isoDate(input.dueDate)
      } catch {
        throw new InvalidGatewayRequestError('Issue due dates must be valid dates.')
      }
    }

    return { title, description }
  }

  private statusName(
    data: AtlasDataSnapshot,
    statusId: Issue['statusId'],
  ): string {
    return (
      data.workflowStatuses.find(({ id }) => id === statusId)?.name ??
      'Unknown status'
    )
  }

  private issueReference(data: AtlasDataSnapshot, issue: Issue): string {
    const key = data.projects.find(({ id }) => id === issue.projectId)?.key ?? 'Issue'
    return `${key}-${issue.number.toString()}`
  }

  private commit(version: number, data: AtlasDataSnapshot): void {
    try {
      this.store.commit(version, data)
    } catch (error) {
      if (error instanceof StaleSnapshotError || error instanceof StorageConflictError) {
        throw new GatewayConflictError(
          'Another request committed data first. Refresh and try again.',
        )
      }

      throw error
    }
  }

  private toGatewayError(error: unknown): GatewayError {
    if (error instanceof StorageConflictError || error instanceof StaleSnapshotError) return new GatewayConflictError(error.message)
    if (error instanceof GatewayError) {
      return error
    }

    if (error instanceof Error) {
      return new InvalidGatewayRequestError(error.message)
    }

    return new InvalidGatewayRequestError('The request failed for an unknown reason.')
  }

  private trace(
    requestId: string,
    operation: GatewayOperation,
    phase: 'cancelled' | 'failed' | 'started' | 'succeeded',
    error?: GatewayError,
  ): void {
    this.tracer.record({
      requestId,
      operation,
      phase,
      occurredAt: this.clock.now(),
      ...(error ? { errorCode: error.code } : {}),
    })
  }

  private nextRequestId(): string {
    this.requestSequence += 1
    return `req_${this.requestSequence.toString().padStart(6, '0')}`
  }

  getWorkspaceInvitations(
    query: WorkspaceInvitationQuery,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitationAdministrationData> {
    return this.execute('administration.invitations.get', options, () => {
      this.assertPermission('members:manage', query.workspaceId)
      const now = this.clock.now()
      const search = query.search?.trim().toLocaleLowerCase() ?? ''
      const roles = query.roles ? new Set(query.roles) : null
      const states = query.states ? new Set(query.states) : null
      const invitations = this.store.read().data.workspaceInvitations
        .filter(({ workspaceId }) => workspaceId === query.workspaceId)
        .map((invitation) => ({
          invitation,
          effectiveState: invitationEffectiveState(invitation, now),
        }))
        .filter(({ invitation, effectiveState }) =>
          (!search || invitation.email.includes(search)) &&
          (!roles || roles.has(invitation.role)) &&
          (!states || states.has(effectiveState)),
        )
        .sort(
          (left, right) =>
            right.invitation.lastSentAt.localeCompare(left.invitation.lastSentAt) ||
            right.invitation.id.localeCompare(left.invitation.id),
        )
      return {
        invitations: paginate(
          invitations,
          validatePage(query.page ?? { number: 1, size: 20 }),
        ),
      }
    })
  }

  createWorkspaceInvitation(
    input: CreateWorkspaceInvitationInput,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitation> {
    return this.execute(
      'administration.invitations.create',
      options,
      (requestId) => {
        const current = this.store.read()
        this.assertPermission('members:manage', input.workspaceId)
        const email = normalizeInvitationEmail(input.email)
        this.assertWorkspaceInvitationRole(input.role)
        if (!current.data.workspaces.some(({ id }) => id === input.workspaceId)) {
          throw new EntityNotFoundError('Workspace')
        }
        const existingUser = current.data.users.find(
          (user) => user.email.toLocaleLowerCase() === email,
        )
        if (
          existingUser &&
          current.data.memberships.some(
            ({ workspaceId, userId }) =>
              workspaceId === input.workspaceId && userId === existingUser.id,
          )
        ) {
          throw new GatewayConflictError(
            'This email already belongs to a workspace member.',
          )
        }
        if (
          current.data.workspaceInvitations.some(
            (invitation) =>
              invitation.workspaceId === input.workspaceId &&
              invitation.email === email &&
              invitation.state === 'pending',
          )
        ) {
          throw new GatewayConflictError(
            'A pending invitation already exists for this email. Resend or revoke it instead.',
          )
        }

        const occurredAt = this.clock.now()
        const invitation: WorkspaceInvitation = {
          id: this.ids.workspaceInvitation('workspace_member'),
          workspaceId: input.workspaceId,
          email,
          role: input.role,
          state: 'pending',
          invitedById: this.actorId,
          createdAt: occurredAt,
          expiresAt: invitationExpiry(occurredAt),
          lastSentAt: occurredAt,
          acceptedAt: null,
          revokedAt: null,
          revision: 1,
        }
        this.commit(current.version, {
          ...current.data,
          workspaceInvitations: [...current.data.workspaceInvitations, invitation],
          activityEvents: [
            ...current.data.activityEvents,
            this.workspaceInvitationActivity(
              invitation,
              occurredAt,
              'workspace.invitation.created',
              `Invited ${email} as ${input.role}.`,
            ),
          ],
          auditEvents: [
            ...current.data.auditEvents,
            this.workspaceInvitationAudit(
              requestId,
              invitation,
              occurredAt,
              'workspace.invitation.created',
              { email, role: input.role, revision: invitation.revision },
            ),
          ],
        })
        return invitation
      },
    )
  }

  resendWorkspaceInvitation(
    input: ResendWorkspaceInvitationInput,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitation> {
    return this.execute(
      'administration.invitations.resend',
      options,
      (requestId) => {
        const current = this.store.read()
        const index = current.data.workspaceInvitations.findIndex(
          ({ id }) => id === input.id,
        )
        const invitation = current.data.workspaceInvitations[index]
        if (!invitation) throw new EntityNotFoundError('Workspace invitation')
        this.assertPermission('members:manage', invitation.workspaceId)
        this.assertInvitationRevision(invitation, input.expectedRevision)
        if (invitation.state !== 'pending') {
          throw new GatewayConflictError(
            'Only pending or expired invitations can be resent.',
          )
        }
        const occurredAt = this.clock.now()
        const updated: WorkspaceInvitation = {
          ...invitation,
          lastSentAt: occurredAt,
          expiresAt: invitationExpiry(occurredAt),
          revision: invitation.revision + 1,
        }
        const workspaceInvitations = [...current.data.workspaceInvitations]
        workspaceInvitations[index] = updated
        this.commit(current.version, {
          ...current.data,
          workspaceInvitations,
          activityEvents: [
            ...current.data.activityEvents,
            this.workspaceInvitationActivity(
              updated,
              occurredAt,
              'workspace.invitation.resent',
              `Resent the invitation to ${updated.email}.`,
            ),
          ],
          auditEvents: [
            ...current.data.auditEvents,
            this.workspaceInvitationAudit(
              requestId,
              updated,
              occurredAt,
              'workspace.invitation.resent',
              {
                email: updated.email,
                fromRevision: invitation.revision,
                toRevision: updated.revision,
              },
            ),
          ],
        })
        return updated
      },
    )
  }

  revokeWorkspaceInvitation(
    input: RevokeWorkspaceInvitationInput,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitation> {
    return this.execute(
      'administration.invitations.revoke',
      options,
      (requestId) => {
        const current = this.store.read()
        const index = current.data.workspaceInvitations.findIndex(
          ({ id }) => id === input.id,
        )
        const invitation = current.data.workspaceInvitations[index]
        if (!invitation) throw new EntityNotFoundError('Workspace invitation')
        this.assertPermission('members:manage', invitation.workspaceId)
        this.assertInvitationRevision(invitation, input.expectedRevision)
        if (invitation.state !== 'pending') {
          throw new GatewayConflictError('Only pending invitations can be revoked.')
        }
        const occurredAt = this.clock.now()
        const updated: WorkspaceInvitation = {
          ...invitation,
          state: 'revoked',
          revokedAt: occurredAt,
          revision: invitation.revision + 1,
        }
        const workspaceInvitations = [...current.data.workspaceInvitations]
        workspaceInvitations[index] = updated
        this.commit(current.version, {
          ...current.data,
          workspaceInvitations,
          activityEvents: [
            ...current.data.activityEvents,
            this.workspaceInvitationActivity(
              updated,
              occurredAt,
              'workspace.invitation.revoked',
              `Revoked the invitation to ${updated.email}.`,
            ),
          ],
          auditEvents: [
            ...current.data.auditEvents,
            this.workspaceInvitationAudit(
              requestId,
              updated,
              occurredAt,
              'workspace.invitation.revoked',
              { email: updated.email, toRevision: updated.revision },
            ),
          ],
        })
        return updated
      },
    )
  }

  activateWorkspaceInvitation(
    input: ActivateWorkspaceInvitationInput,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitationActivation> {
    return this.execute(
      'administration.invitations.activate',
      options,
      (requestId) => {
        const current = this.store.read()
        const index = current.data.workspaceInvitations.findIndex(
          ({ id }) => id === input.id,
        )
        const invitation = current.data.workspaceInvitations[index]
        if (!invitation) throw new EntityNotFoundError('Workspace invitation')
        this.assertPermission('members:manage', invitation.workspaceId)
        this.assertInvitationRevision(invitation, input.expectedRevision)
        if (invitation.state !== 'pending') {
          throw new GatewayConflictError('Only pending invitations can be activated.')
        }
        const occurredAt = this.clock.now()
        if (invitation.expiresAt <= occurredAt) {
          throw new GatewayConflictError(
            'This invitation expired. Resend it before activation.',
          )
        }
        const displayName = input.displayName.trim()
        if (displayName.length === 0 || displayName.length > 120) {
          throw new InvalidGatewayRequestError(
            'Member names must contain 1 to 120 characters.',
          )
        }
        const existingUser = current.data.users.find(
          (candidate) =>
            candidate.email.toLocaleLowerCase() === invitation.email,
        )
        if (
          existingUser &&
          current.data.memberships.some(
            ({ workspaceId, userId }) =>
              workspaceId === invitation.workspaceId && userId === existingUser.id,
          )
        ) {
          throw new GatewayConflictError(
            'This invitation recipient is already a workspace member.',
          )
        }
        const user = existingUser ?? {
          id: this.ids.user('invited_member'),
          displayName,
          email: invitation.email,
          initials: userInitials(displayName),
        }
        const membership: Membership = {
          id: this.ids.membership('invited_member'),
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role,
          status: 'active',
          joinedAt: occurredAt,
          revision: 1,
        }
        const updated: WorkspaceInvitation = {
          ...invitation,
          state: 'accepted',
          acceptedAt: occurredAt,
          revision: invitation.revision + 1,
        }
        const workspaceInvitations = [...current.data.workspaceInvitations]
        workspaceInvitations[index] = updated
        const hasNotificationPreferences = current.data.notificationPreferences.some(
          (preferences) =>
            preferences.workspaceId === invitation.workspaceId &&
            preferences.userId === user.id,
        )
        this.commit(current.version, {
          ...current.data,
          users: existingUser ? current.data.users : [...current.data.users, user],
          memberships: [...current.data.memberships, membership],
          workspaceInvitations,
          notificationPreferences: hasNotificationPreferences
            ? current.data.notificationPreferences
            : [
                ...current.data.notificationPreferences,
                {
                  id: this.ids.notificationPreference('invited_member'),
                  workspaceId: invitation.workspaceId,
                  userId: user.id,
                  assignments: true,
                  comments: true,
                  issueUpdates: true,
                  projectUpdates: true,
                  revision: 1,
                },
              ],
          activityEvents: [
            ...current.data.activityEvents,
            this.workspaceInvitationActivity(
              updated,
              occurredAt,
              'workspace.invitation.activated',
              `Activated ${user.displayName} as ${membership.role}.`,
            ),
          ],
          auditEvents: [
            ...current.data.auditEvents,
            this.workspaceInvitationAudit(
              requestId,
              updated,
              occurredAt,
              'workspace.invitation.activated',
              {
                email: updated.email,
                userId: user.id,
                membershipId: membership.id,
                role: membership.role,
                toRevision: updated.revision,
              },
            ),
          ],
        })
        return { invitation: updated, user, membership }
      },
    )
  }

  private assertWorkspaceInvitationRole(role: WorkspaceInvitationRole): void {
    if (!workspaceInvitationRoles.has(role)) {
      throw new InvalidGatewayRequestError(
        'Invitation roles must be admin, member, or viewer.',
      )
    }
  }

  private assertInvitationRevision(
    invitation: WorkspaceInvitation,
    expectedRevision: number,
  ): void {
    if (invitation.revision !== expectedRevision) {
      throw new GatewayConflictError(
        'This invitation changed after it was loaded. Refresh and try again.',
      )
    }
  }

  private workspaceInvitationActivity(
    invitation: WorkspaceInvitation,
    occurredAt: ActivityEvent['occurredAt'],
    action: string,
    summary: string,
  ): ActivityEvent {
    return {
      id: this.ids.activity('workspace_invitation'),
      workspaceId: invitation.workspaceId,
      actorId: this.actorId,
      entityKind: 'invitation',
      entityId: invitation.id,
      action,
      occurredAt,
      summary,
    }
  }

  private workspaceInvitationAudit(
    requestId: string,
    invitation: WorkspaceInvitation,
    occurredAt: AuditEvent['occurredAt'],
    action: string,
    metadata: AuditEvent['metadata'],
  ): AuditEvent {
    return {
      id: this.ids.audit('workspace_invitation'),
      workspaceId: invitation.workspaceId,
      actorId: this.actorId,
      requestId,
      action,
      outcome: 'succeeded',
      occurredAt,
      metadata: { invitationId: invitation.id, ...metadata },
    }
  }
}

function normalizeInvitationEmail(value: string): string {
  const email = value.trim().toLocaleLowerCase()
  if (email.length > 254 || !invitationEmailPattern.test(email)) {
    throw new InvalidGatewayRequestError('Enter a valid invitation email address.')
  }
  return email
}

function invitationExpiry(value: ActivityEvent['occurredAt']): ActivityEvent['occurredAt'] {
  return isoDateTime(
    new Date(Date.parse(value) + invitationLifetimeMilliseconds).toISOString(),
  )
}

function invitationEffectiveState(
  invitation: WorkspaceInvitation,
  now: ActivityEvent['occurredAt'],
): WorkspaceInvitationEffectiveState {
  return invitation.state === 'pending' && invitation.expiresAt <= now
    ? 'expired'
    : invitation.state
}

function userInitials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? '')
    .join('')
}
