import { isoDateTime, workspaceId as parseWorkspaceId, type IsoDateTime, type WorkspaceId } from '../domain'
import type { AtlasDataSnapshot, VersionedSnapshot } from './snapshot'
import { assertSnapshotShape } from './snapshot-schema'
import { assertValidSnapshot } from './snapshot-validation'

export const backupByteLimit = 10 * 1024 * 1024
export interface WorkspaceArchive {
  readonly format: 'taskora.workspace'
  readonly schemaVersion: 1
  readonly workspaceId: WorkspaceId
  readonly exportedAt: IsoDateTime
  readonly sourceVersion: number
  readonly data: AtlasDataSnapshot
}

export interface CollectionChange {
  readonly collection: keyof AtlasDataSnapshot
  readonly before: number
  readonly after: number
  readonly added: number
  readonly removed: number
  readonly changed: number
}

export function workspaceSnapshot(data: AtlasDataSnapshot, workspaceId: WorkspaceId): AtlasDataSnapshot {
  const projects = data.projects.filter((row) => row.workspaceId === workspaceId)
  const issues = data.issues.filter((row) => row.workspaceId === workspaceId)
  const projectIds = new Set(projects.map((row) => row.id))
  const issueIds = new Set(issues.map((row) => row.id))
  const comments = data.comments.filter((row) => issueIds.has(row.issueId))
  const commentIds = new Set(comments.map((row) => row.id))
  const scoped = {
    ...data,
    workspaces: data.workspaces.filter((row) => row.id === workspaceId),
    memberships: data.memberships.filter((row) => row.workspaceId === workspaceId),
    workspaceInvitations: data.workspaceInvitations.filter((row) => row.workspaceId === workspaceId),
    projects, issues, comments,
    projectMembers: data.projectMembers.filter((row) => projectIds.has(row.projectId)),
    projectSubscriptions: data.projectSubscriptions.filter((row) => projectIds.has(row.projectId)),
    workflowStatuses: data.workflowStatuses.filter((row) => projectIds.has(row.projectId)),
    labels: data.labels.filter((row) => row.workspaceId === workspaceId),
    issueRelations: data.issueRelations.filter((row) => issueIds.has(row.sourceIssueId)),
    issueSubscriptions: data.issueSubscriptions.filter((row) => issueIds.has(row.issueId)),
    commentMentions: data.commentMentions.filter((row) => commentIds.has(row.commentId)),
    activityEvents: data.activityEvents.filter((row) => row.workspaceId === workspaceId),
    auditEvents: data.auditEvents.filter((row) => row.workspaceId === workspaceId),
    notifications: data.notifications.filter((row) => row.workspaceId === workspaceId),
    notificationPreferences: data.notificationPreferences.filter((row) => row.workspaceId === workspaceId),
    users: [],
  } satisfies AtlasDataSnapshot
  const userIds = new Set<string>()
  const userFields = new Set(['userId', 'leadId', 'assigneeId', 'authorId', 'deletedById', 'invitedById', 'actorId', 'recipientId'])
  for (const rows of Object.values<readonly object[]>(scoped)) {
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (userFields.has(key) && typeof value === 'string') userIds.add(value)
      }
    }
  }
  return { ...scoped, users: data.users.filter((user) => userIds.has(user.id)) }
}

export function exportWorkspace(snapshot: VersionedSnapshot, workspaceId: WorkspaceId, exportedAt: IsoDateTime): string {
  const data = workspaceSnapshot(snapshot.data, workspaceId)
  if (data.workspaces.length !== 1) throw new Error('Workspace not found.')
  const archive: WorkspaceArchive = { format: 'taskora.workspace', schemaVersion: 1, workspaceId, exportedAt, sourceVersion: snapshot.version, data }
  const content = JSON.stringify(archive, null, 2)
  parseWorkspaceArchive(content)
  return content
}

export function parseWorkspaceArchive(content: string): WorkspaceArchive {
  if (content.length > backupByteLimit || new TextEncoder().encode(content).byteLength > backupByteLimit) {
    throw new Error('Backup exceeds the 10 MiB limit.')
  }
  let value: unknown
  try { value = JSON.parse(content) } catch { throw new Error('Backup is not valid JSON.') }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid backup envelope.')
  const root = value as Record<string, unknown>
  const keys = ['format', 'schemaVersion', 'workspaceId', 'exportedAt', 'sourceVersion', 'data']
  if (Object.keys(root).length !== keys.length || keys.some((key) => !Object.hasOwn(root, key))) throw new Error('Invalid backup envelope.')
  if (root['format'] !== 'taskora.workspace' || root['schemaVersion'] !== 1) throw new Error('Unsupported backup format or schema version.')
  if (typeof root['workspaceId'] !== 'string' || typeof root['exportedAt'] !== 'string' ||
    typeof root['sourceVersion'] !== 'number' || !Number.isSafeInteger(root['sourceVersion']) || root['sourceVersion'] < 0) throw new Error('Invalid backup metadata.')
  const workspaceId = parseWorkspaceId(root['workspaceId'])
  const exportedAt = isoDateTime(root['exportedAt'])
  const data = root['data']
  assertSnapshotShape(data)
  if (data.workspaces.length !== 1 || data.workspaces[0]?.id !== workspaceId) throw new Error('A backup must contain exactly its named workspace.')
  return { format: 'taskora.workspace', schemaVersion: 1, workspaceId, exportedAt, sourceVersion: root['sourceVersion'], data }
}

export function mergeWorkspace(current: AtlasDataSnapshot, archive: WorkspaceArchive): AtlasDataSnapshot {
  const previous = workspaceSnapshot(current, archive.workspaceId)
  const merged = { ...current }
  // The keyed assignment preserves each collection's entity type; no imported object is trusted before decoding.
  function replace(key: keyof AtlasDataSnapshot): void {
    const oldIds = new Set<string>(previous[key].map((row) => row.id))
    const incoming = archive.data[key]
    const existingIds = new Set<string>(current[key].map((row) => row.id))
    const rows = key === 'users' || key === 'auditEvents'
      ? [...current[key], ...incoming.filter((row) => !existingIds.has(row.id))]
      : [...current[key].filter((row) => !oldIds.has(row.id)), ...incoming]
    Object.assign(merged, { [key]: rows })
  }
  for (const key of Object.keys(current) as (keyof AtlasDataSnapshot)[]) replace(key)
  assertValidSnapshot(merged)
  return merged
}

export function describeChanges(before: AtlasDataSnapshot, after: AtlasDataSnapshot): readonly CollectionChange[] {
  return (Object.keys(before) as (keyof AtlasDataSnapshot)[]).map((collection) => {
    const previous = new Map<string, string>(before[collection].map((row) => [row.id, JSON.stringify(row)]))
    const next = new Map<string, string>(after[collection].map((row) => [row.id, JSON.stringify(row)]))
    return { collection, before: previous.size, after: next.size,
      added: [...next.keys()].filter((id) => !previous.has(id)).length,
      removed: [...previous.keys()].filter((id) => !next.has(id)).length,
      changed: [...next].filter(([id, value]) => previous.has(id) && previous.get(id) !== value).length,
    }
  })
}

export function rebaseRevisions(current: AtlasDataSnapshot, next: AtlasDataSnapshot, workspaceId: WorkspaceId): AtlasDataSnapshot {
  let maximum = 0
  for (const snapshot of [current, next]) {
    for (const rows of Object.values<readonly object[]>({ ...snapshot })) {
      for (const row of rows) {
        if ('revision' in row && typeof row.revision === 'number') maximum = Math.max(maximum, row.revision)
      }
    }
  }
  if (!Number.isSafeInteger(maximum + 1)) throw new Error('Cannot safely advance recovered revisions.')
  const revision = maximum + 1
  const issueIds = new Set(next.issues.filter((row) => row.workspaceId === workspaceId).map((row) => row.id))
  return { ...next,
    memberships: next.memberships.map((row) => row.workspaceId === workspaceId ? { ...row, revision } : row),
    workspaceInvitations: next.workspaceInvitations.map((row) => row.workspaceId === workspaceId ? { ...row, revision } : row),
    projects: next.projects.map((row) => row.workspaceId === workspaceId ? { ...row, revision } : row),
    issues: next.issues.map((row) => row.workspaceId === workspaceId ? { ...row, revision } : row),
    comments: next.comments.map((row) => issueIds.has(row.issueId) ? { ...row, revision } : row),
    notificationPreferences: next.notificationPreferences.map((row) => row.workspaceId === workspaceId ? { ...row, revision } : row),
  }
}
