import * as domain from '../domain'
import type { AtlasDataSnapshot } from './snapshot'
import { assertValidSnapshot } from './snapshot-validation'

type Rule = (value: unknown, path: string) => void

function invalid(path: string): never {
  throw new TypeError(`Invalid snapshot field: ${path}.`)
}

const text: Rule = (value, path) => {
  if (typeof value !== 'string') invalid(path)
}
const booleanValue: Rule = (value, path) => {
  if (typeof value !== 'boolean') invalid(path)
}
const nonNegativeInteger: Rule = (value, path) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(path)
}
const positiveInteger: Rule = (value, path) => {
  nonNegativeInteger(value, path)
  if (value === 0) invalid(path)
}
function textWith(check: (value: string) => unknown): Rule {
  return (value, path) => {
    if (typeof value !== 'string') invalid(path)
    try { check(value) } catch { invalid(path) }
  }
}
function nullable(rule: Rule): Rule {
  return (value, path) => { if (value !== null) rule(value, path) }
}
function oneOf(...values: readonly string[]): Rule {
  return (value, path) => {
    if (typeof value !== 'string' || !values.includes(value)) invalid(path)
  }
}
function arrayOf(rule: Rule): Rule {
  return (value, path) => {
    if (!Array.isArray(value)) invalid(path)
    value.forEach((entry: unknown, index) => { rule(entry, `${path}[${index.toString()}]`) })
  }
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path)
  return value as Record<string, unknown>
}
function fields(rules: Readonly<Record<string, Rule>>): Rule {
  return (value, path) => {
    const object = record(value, path)
    if (Object.keys(object).length !== Object.keys(rules).length) invalid(path)
    for (const [key, rule] of Object.entries(rules)) {
      if (!Object.hasOwn(object, key)) invalid(`${path}.${key}`)
      rule(object[key], `${path}.${key}`)
    }
  }
}
const metadata: Rule = (value, path) => {
  for (const entry of Object.values(record(value, path))) {
    if (entry !== null && typeof entry !== 'string' && typeof entry !== 'boolean' &&
      !(typeof entry === 'number' && Number.isFinite(entry))) invalid(path)
  }
}
const notificationTarget: Rule = (value, path) => {
  const target = record(value, path)
  const rules: Readonly<Record<string, Rule>> = {
    issue: textWith(domain.issueId), project: textWith(domain.projectId),
    workspace: textWith(domain.workspaceId), governance: text,
    administration: nullable(textWith((id) => id.startsWith('mem_')
      ? domain.membershipId(id) : domain.workspaceInvitationId(id))),
  }
  if (typeof target['kind'] !== 'string' || !Object.hasOwn(rules, target['kind'])) invalid(path)
  const idRule = rules[target['kind']]
  if (!idRule) invalid(path)
  fields({ kind: oneOf(target['kind']), id: idRule })(value, path)
}

// Every domain field must have a runtime rule before an untrusted file can reach the store.
const schemas = {
  workspaces: {
    id: textWith(domain.workspaceId),
    name: text,
    slug: text,
    createdAt: textWith(domain.isoDateTime),
  },
  users: {
    id: textWith(domain.userId),
    displayName: text,
    email: text,
    initials: text,
  },
  memberships: {
    id: textWith(domain.membershipId),
    workspaceId: textWith(domain.workspaceId),
    userId: textWith(domain.userId),
    role: oneOf('owner', 'admin', 'member', 'viewer'),
    status: oneOf('invited', 'active', 'suspended'),
    joinedAt: nullable(textWith(domain.isoDateTime)),
    revision: positiveInteger,
  },
  workspaceInvitations: {
    id: textWith(domain.workspaceInvitationId),
    workspaceId: textWith(domain.workspaceId),
    email: text,
    role: oneOf('admin', 'member', 'viewer'),
    state: oneOf('pending', 'accepted', 'revoked'),
    invitedById: textWith(domain.userId),
    createdAt: textWith(domain.isoDateTime),
    expiresAt: textWith(domain.isoDateTime),
    lastSentAt: textWith(domain.isoDateTime),
    acceptedAt: nullable(textWith(domain.isoDateTime)),
    revokedAt: nullable(textWith(domain.isoDateTime)),
    revision: positiveInteger,
  },
  projects: {
    id: textWith(domain.projectId),
    workspaceId: textWith(domain.workspaceId),
    key: text,
    name: text,
    description: text,
    leadId: textWith(domain.userId),
    status: oneOf('planned', 'active', 'paused', 'completed', 'archived'),
    revision: positiveInteger,
    createdAt: textWith(domain.isoDateTime),
    updatedAt: textWith(domain.isoDateTime),
  },
  projectMembers: {
    id: textWith(domain.projectMemberId),
    projectId: textWith(domain.projectId),
    userId: textWith(domain.userId),
    role: oneOf('lead', 'contributor', 'viewer'),
  },
  projectSubscriptions: {
    id: textWith(domain.projectSubscriptionId),
    projectId: textWith(domain.projectId),
    userId: textWith(domain.userId),
    createdAt: textWith(domain.isoDateTime),
  },
  workflowStatuses: {
    id: textWith(domain.workflowStatusId),
    projectId: textWith(domain.projectId),
    name: text,
    category: oneOf('backlog', 'unstarted', 'started', 'completed', 'canceled'),
    order: nonNegativeInteger,
  },
  labels: {
    id: textWith(domain.labelId),
    workspaceId: textWith(domain.workspaceId),
    name: text,
    color: text,
    description: text,
  },
  issues: {
    id: textWith(domain.issueId),
    workspaceId: textWith(domain.workspaceId),
    projectId: textWith(domain.projectId),
    number: positiveInteger,
    type: oneOf('task', 'bug', 'story'),
    title: text,
    description: text,
    statusId: textWith(domain.workflowStatusId),
    priority: oneOf('urgent', 'high', 'medium', 'low', 'none'),
    assigneeId: nullable(textWith(domain.userId)),
    parentIssueId: nullable(textWith(domain.issueId)),
    dueDate: nullable(textWith(domain.isoDate)),
    labelIds: arrayOf(textWith(domain.labelId)),
    revision: positiveInteger,
    createdAt: textWith(domain.isoDateTime),
    updatedAt: textWith(domain.isoDateTime),
  },
  issueRelations: {
    id: textWith(domain.issueRelationId),
    sourceIssueId: textWith(domain.issueId),
    targetIssueId: textWith(domain.issueId),
    type: oneOf('blocks', 'relates-to', 'duplicates'),
  },
  issueSubscriptions: {
    id: textWith(domain.issueSubscriptionId),
    issueId: textWith(domain.issueId),
    userId: textWith(domain.userId),
    createdAt: textWith(domain.isoDateTime),
  },
  comments: {
    id: textWith(domain.commentId),
    issueId: textWith(domain.issueId),
    authorId: textWith(domain.userId),
    body: text,
    revision: positiveInteger,
    createdAt: textWith(domain.isoDateTime),
    editedAt: nullable(textWith(domain.isoDateTime)),
    deletedAt: nullable(textWith(domain.isoDateTime)),
    deletedById: nullable(textWith(domain.userId)),
  },
  commentMentions: {
    id: textWith(domain.commentMentionId),
    commentId: textWith(domain.commentId),
    userId: textWith(domain.userId),
    createdAt: textWith(domain.isoDateTime),
    removedAt: nullable(textWith(domain.isoDateTime)),
  },
  activityEvents: {
    id: textWith(domain.activityEventId),
    workspaceId: textWith(domain.workspaceId),
    actorId: textWith(domain.userId),
    entityKind: oneOf('workspace', 'project', 'issue', 'comment', 'member', 'invitation'),
    entityId: text,
    action: text,
    occurredAt: textWith(domain.isoDateTime),
    summary: text,
  },
  auditEvents: {
    id: textWith(domain.auditEventId),
    workspaceId: textWith(domain.workspaceId),
    actorId: nullable(textWith(domain.userId)),
    requestId: text,
    action: text,
    outcome: oneOf('succeeded', 'rejected', 'failed'),
    occurredAt: textWith(domain.isoDateTime),
    metadata: metadata,
  },
  notifications: {
    id: textWith(domain.notificationId),
    workspaceId: textWith(domain.workspaceId),
    recipientId: textWith(domain.userId),
    kind: oneOf('assignment', 'comment', 'mention', 'issue-update', 'project-update', 'workspace-administration', 'governance'),
    target: notificationTarget,
    title: text,
    body: text,
    occurredAt: textWith(domain.isoDateTime),
    readAt: nullable(textWith(domain.isoDateTime)),
  },
  notificationPreferences: {
    id: textWith(domain.notificationPreferenceId),
    workspaceId: textWith(domain.workspaceId),
    userId: textWith(domain.userId),
    assignments: booleanValue,
    comments: booleanValue,
    issueUpdates: booleanValue,
    projectUpdates: booleanValue,
    revision: positiveInteger,
  },
} satisfies { [K in keyof AtlasDataSnapshot]: { [P in keyof AtlasDataSnapshot[K][number]]: Rule } }

export function assertSnapshotShape(value: unknown): asserts value is AtlasDataSnapshot {
  fields(Object.fromEntries(Object.entries(schemas).map(([key, schema]) =>
    [key, arrayOf(fields(schema))],
  )))(value, 'data')
  assertValidSnapshot(value as AtlasDataSnapshot)
}
