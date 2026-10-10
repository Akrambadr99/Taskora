import type { AtlasDataSnapshot } from './snapshot'
import {
  assertIssueRelations,
  assertIssueHierarchy,
  assertProjectKey,
  assertProjectWorkflow,
  assertUniqueMemberships,
} from '../domain'

export class DataIntegrityError extends Error {
  readonly collection: keyof AtlasDataSnapshot

  constructor(collection: keyof AtlasDataSnapshot, message: string) {
    super(message)
    this.name = 'DataIntegrityError'
    this.collection = collection
  }
}

export function assertValidSnapshot(snapshot: AtlasDataSnapshot): void {
  for (const collection of collectionNames) {
    assertUniqueIds(collection, snapshot[collection])
  }

  assertUniqueMemberships(snapshot.memberships)
  assertIssueHierarchy(snapshot.issues)

  const workspaces = new Set(snapshot.workspaces.map(({ id }) => id))
  const users = new Set(snapshot.users.map(({ id }) => id))
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]))
  const statuses = new Map(
    snapshot.workflowStatuses.map((status) => [status.id, status]),
  )
  const labels = new Map(snapshot.labels.map((label) => [label.id, label]))
  const issues = new Map(snapshot.issues.map((issue) => [issue.id, issue]))
  const comments = new Map(snapshot.comments.map((comment) => [comment.id, comment]))
  const memberships = new Map<string, (typeof snapshot.memberships)[number]>(
    snapshot.memberships.map((membership) => [membership.id, membership]),
  )
  const invitations = new Map<string, (typeof snapshot.workspaceInvitations)[number]>(
    snapshot.workspaceInvitations.map((invitation) => [invitation.id, invitation]),
  )
  const projectKeys = new Set<string>()
  const workspaceMembershipUsers = new Set(
    snapshot.memberships.map(
      ({ workspaceId, userId }) => `${workspaceId}:${userId}`,
    ),
  )

  for (const membership of snapshot.memberships) {
    if (
      !workspaces.has(membership.workspaceId) ||
      !users.has(membership.userId) ||
      !Number.isSafeInteger(membership.revision) ||
      membership.revision < 1
    ) {
      throw new DataIntegrityError(
        'memberships',
        'Memberships must reference an existing workspace and user with a valid revision.',
      )
    }
  }

  const pendingInvitationEmails = new Set<string>()
  for (const invitation of snapshot.workspaceInvitations) {
    const pendingKey = `${invitation.workspaceId}:${invitation.email}`
    const timestampsAreConsistent =
      invitation.createdAt <= invitation.lastSentAt &&
      invitation.lastSentAt < invitation.expiresAt
    const stateIsConsistent =
      (invitation.state === 'pending' &&
        invitation.acceptedAt === null &&
        invitation.revokedAt === null) ||
      (invitation.state === 'accepted' &&
        invitation.acceptedAt !== null &&
        invitation.revokedAt === null) ||
      (invitation.state === 'revoked' &&
        invitation.acceptedAt === null &&
        invitation.revokedAt !== null)
    if (
      !workspaces.has(invitation.workspaceId) ||
      !users.has(invitation.invitedById) ||
      invitation.email !== invitation.email.trim().toLocaleLowerCase() ||
      invitation.email.length === 0 ||
      !Number.isSafeInteger(invitation.revision) ||
      invitation.revision < 1 ||
      !timestampsAreConsistent ||
      !stateIsConsistent ||
      (invitation.state === 'pending' && pendingInvitationEmails.has(pendingKey))
    ) {
      throw new DataIntegrityError(
        'workspaceInvitations',
        'Invitations require valid references, normalized email, lifecycle timestamps, revision, and a unique pending recipient.',
      )
    }
    if (invitation.state === 'pending') pendingInvitationEmails.add(pendingKey)
  }

  for (const status of snapshot.workflowStatuses) {
    if (!projects.has(status.projectId)) {
      throw new DataIntegrityError('workflowStatuses', 'Workflow states must reference an existing project.')
    }
  }

  for (const project of snapshot.projects) {
    assertProjectKey(project.key)
    const key = `${project.workspaceId}:${project.key}`

    if (
      !workspaces.has(project.workspaceId) ||
      !users.has(project.leadId) ||
      projectKeys.has(key) ||
      !Number.isSafeInteger(project.revision) ||
      project.revision < 1
    ) {
      throw new DataIntegrityError(
        'projects',
        'Projects require a workspace, a valid lead, and a unique workspace key.',
      )
    }

    projectKeys.add(key)
    assertProjectWorkflow(
      project,
      snapshot.workflowStatuses.filter(({ projectId }) => projectId === project.id),
    )

    const projectLeads = snapshot.projectMembers.filter(
      ({ projectId, role }) => projectId === project.id && role === 'lead',
    )
    if (projectLeads.length !== 1 || projectLeads[0]?.userId !== project.leadId) {
      throw new DataIntegrityError(
        'projectMembers',
        'Projects require exactly one matching project lead membership.',
      )
    }
  }

  const projectMemberOwners = new Set<string>()
  for (const projectMember of snapshot.projectMembers) {
    const project = projects.get(projectMember.projectId)
    const ownerKey = `${projectMember.projectId}:${projectMember.userId}`
    if (
      !project ||
      !users.has(projectMember.userId) ||
      !workspaceMembershipUsers.has(`${project.workspaceId}:${projectMember.userId}`) ||
      projectMemberOwners.has(ownerKey)
    ) {
      throw new DataIntegrityError(
        'projectMembers',
        'Project members must be unique per project/user and belong to the project workspace.',
      )
    }
    projectMemberOwners.add(ownerKey)
  }

  const projectSubscriptionOwners = new Set<string>()
  for (const subscription of snapshot.projectSubscriptions) {
    const project = projects.get(subscription.projectId)
    const ownerKey = `${subscription.projectId}:${subscription.userId}`
    if (
      !project ||
      !workspaceMembershipUsers.has(`${project.workspaceId}:${subscription.userId}`) ||
      projectSubscriptionOwners.has(ownerKey)
    ) {
      throw new DataIntegrityError(
        'projectSubscriptions',
        'Project subscriptions require a unique workspace member per project.',
      )
    }
    projectSubscriptionOwners.add(ownerKey)
  }

  for (const label of snapshot.labels) {
    if (!workspaces.has(label.workspaceId)) {
      throw new DataIntegrityError('labels', 'Labels must belong to a workspace.')
    }
  }

  for (const issue of snapshot.issues) {
    const project = projects.get(issue.projectId)
    const status = statuses.get(issue.statusId)
    const parent = issue.parentIssueId ? issues.get(issue.parentIssueId) : null
    const hasInvalidLabel = issue.labelIds.some(
      (labelId) => labels.get(labelId)?.workspaceId !== issue.workspaceId,
    )

    if (
      project?.workspaceId !== issue.workspaceId ||
      status?.projectId !== issue.projectId ||
      (issue.assigneeId !== null && !workspaceMembershipUsers.has(`${issue.workspaceId}:${issue.assigneeId}`)) ||
      (issue.parentIssueId !== null && parent?.projectId !== issue.projectId) ||
      hasInvalidLabel ||
      new Set(issue.labelIds).size !== issue.labelIds.length ||
      issue.number < 1 ||
      !Number.isSafeInteger(issue.number) ||
      issue.revision < 1 ||
      !Number.isSafeInteger(issue.revision)
    ) {
      throw new DataIntegrityError(
        'issues',
        'Issues must have valid project, status, member, label, numbering, and parent references.',
      )
    }
  }

  assertUniqueIssueNumbers(snapshot)
  assertIssueRelations(snapshot.issues, snapshot.issueRelations)

  const subscriptionOwners = new Set<string>()
  for (const subscription of snapshot.issueSubscriptions) {
    const issue = issues.get(subscription.issueId)
    const ownerKey = `${subscription.issueId}:${subscription.userId}`
    if (
      !issue ||
      !workspaceMembershipUsers.has(`${issue.workspaceId}:${subscription.userId}`) ||
      subscriptionOwners.has(ownerKey)
    ) {
      throw new DataIntegrityError(
        'issueSubscriptions',
        'Issue subscriptions require a unique workspace member per issue.',
      )
    }
    subscriptionOwners.add(ownerKey)
  }

  for (const comment of snapshot.comments) {
    const deletionIsConsistent =
      comment.deletedAt === null
        ? comment.deletedById === null && comment.body.trim().length > 0
        : comment.deletedById !== null && comment.body.length === 0
    if (
      !issues.has(comment.issueId) ||
      !users.has(comment.authorId) ||
      (comment.deletedById !== null && !users.has(comment.deletedById)) ||
      !Number.isSafeInteger(comment.revision) ||
      comment.revision < 1 ||
      !deletionIsConsistent
    ) {
      throw new DataIntegrityError(
        'comments',
        'Comments require valid references, revisions, content, and deletion state.',
      )
    }
  }

  const deliveredMentions = new Set<string>()
  for (const mention of snapshot.commentMentions) {
    const comment = comments.get(mention.commentId)
    const issue = comment ? issues.get(comment.issueId) : undefined
    const recipientKey = `${mention.commentId}:${mention.userId}`
    if (
      !issue ||
      !workspaceMembershipUsers.has(`${issue.workspaceId}:${mention.userId}`) ||
      (mention.removedAt !== null && mention.removedAt < mention.createdAt) ||
      deliveredMentions.has(recipientKey)
    ) {
      throw new DataIntegrityError(
        'commentMentions',
        'Comment mentions require a unique workspace member recipient per comment and a valid lifecycle.',
      )
    }
    deliveredMentions.add(recipientKey)
  }

  const liveEntityWorkspaces = new Map<string, string>([
    ...snapshot.workspaces.map((row) => [row.id, row.id] as const),
    ...snapshot.projects.map((row) => [row.id, row.workspaceId] as const),
    ...snapshot.issues.map((row) => [row.id, row.workspaceId] as const),
    ...snapshot.memberships.map((row) => [row.id, row.workspaceId] as const),
    ...snapshot.workspaceInvitations.map((row) => [row.id, row.workspaceId] as const),
    ...snapshot.comments.map((row) => [row.id, issues.get(row.issueId)?.workspaceId ?? ''] as const),
  ])

  for (const activity of snapshot.activityEvents) {
    const targetWorkspace = liveEntityWorkspaces.get(activity.entityId)
    // Deleted entities remain legitimate historical targets; live targets cannot cross workspaces.
    if (targetWorkspace !== undefined && targetWorkspace !== activity.workspaceId) {
      throw new DataIntegrityError('activityEvents', 'Live activity targets must belong to the event workspace.')
    }
    if (!workspaces.has(activity.workspaceId) || !users.has(activity.actorId)) {
      throw new DataIntegrityError(
        'activityEvents',
        'Activity events must reference an existing workspace and actor.',
      )
    }
  }

  for (const audit of snapshot.auditEvents) {
    if (
      !workspaces.has(audit.workspaceId) ||
      (audit.actorId !== null && !users.has(audit.actorId))
    ) {
      throw new DataIntegrityError(
        'auditEvents',
        'Audit events must reference an existing workspace and optional actor.',
      )
    }
  }

  for (const notification of snapshot.notifications) {
    const { target } = notification
    const targetIsValid =
      (target.kind === 'issue' &&
        issues.get(target.id)?.workspaceId === notification.workspaceId) ||
      (target.kind === 'project' &&
        projects.get(target.id)?.workspaceId === notification.workspaceId) ||
      (target.kind === 'workspace' && target.id === notification.workspaceId) ||
      (target.kind === 'administration' &&
        (target.id === null ||
          memberships.get(target.id)?.workspaceId === notification.workspaceId ||
          invitations.get(target.id)?.workspaceId === notification.workspaceId)) ||
      (target.kind === 'governance' &&
        target.id.length > 0 &&
        target.id.trim() === target.id)
    if (
      !workspaceMembershipUsers.has(`${notification.workspaceId}:${notification.recipientId}`) ||
      !workspaces.has(notification.workspaceId) ||
      !targetIsValid
    ) {
      throw new DataIntegrityError(
        'notifications',
        'Notifications must reference an existing recipient, workspace, and valid target.',
      )
    }
  }

  const notificationPreferenceOwners = new Set<string>()
  for (const preference of snapshot.notificationPreferences) {
    const ownerKey = `${preference.workspaceId}:${preference.userId}`
    if (
      !workspaceMembershipUsers.has(`${preference.workspaceId}:${preference.userId}`) ||
      !workspaces.has(preference.workspaceId) ||
      !Number.isSafeInteger(preference.revision) ||
      preference.revision < 1 ||
      notificationPreferenceOwners.has(ownerKey)
    ) {
      throw new DataIntegrityError(
        'notificationPreferences',
        'Notification preferences require a unique workspace user and valid revision.',
      )
    }
    notificationPreferenceOwners.add(ownerKey)
  }
}

const collectionNames = [
  'workspaces',
  'users',
  'memberships',
  'workspaceInvitations',
  'projects',
  'projectMembers',
  'projectSubscriptions',
  'workflowStatuses',
  'labels',
  'issues',
  'issueSubscriptions',
  'issueRelations',
  'comments',
  'commentMentions',
  'activityEvents',
  'auditEvents',
  'notifications',
  'notificationPreferences',
] as const satisfies readonly (keyof AtlasDataSnapshot)[]

function assertUniqueIds(
  collection: keyof AtlasDataSnapshot,
  entities: readonly { readonly id: string }[],
): void {
  const ids = new Set<string>()

  for (const entity of entities) {
    if (ids.has(entity.id)) {
      throw new DataIntegrityError(collection, `${collection} ids must be unique.`)
    }

    ids.add(entity.id)
  }
}

function assertUniqueIssueNumbers(snapshot: AtlasDataSnapshot): void {
  const issueNumbers = new Set<string>()

  for (const issue of snapshot.issues) {
    const key = `${issue.projectId}:${issue.number.toString()}`

    if (issueNumbers.has(key)) {
      throw new DataIntegrityError(
        'issues',
        'Issue numbers must be unique within a project.',
      )
    }

    issueNumbers.add(key)
  }
}
