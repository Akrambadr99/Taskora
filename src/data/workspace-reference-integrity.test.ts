import { describe, expect, it } from 'vitest'
import { createAtlasFixtures } from './fixtures'
import { InMemoryDataStore } from './store'
import { userId, workspaceId, activityEventId } from '../domain'

function setup() {
  const seed = createAtlasFixtures()
  const outsider = { id: userId('usr_outsider'), displayName: 'Outside member', email: 'outside@example.test', initials: 'OM' }
  const data = { ...seed, users: [...seed.users, outsider] }
  return { store: new InMemoryDataStore(data), data, outsider }
}

describe('workspace reference boundaries', () => {
  it('rejects an assignee who exists globally but is not a workspace member', () => {
    const { store, data, outsider } = setup()
    const before = store.read()
    expect(() => store.commit(0, { ...data, issues: data.issues.map((row) => ({ ...row, assigneeId: outsider.id })) })).toThrow(/member/)
    expect(store.read()).toEqual(before)
  })

  it('rejects notification and preference recipients outside the workspace', () => {
    const { store, data, outsider } = setup()
    expect(() => store.commit(0, { ...data, notifications: data.notifications.map((row) => ({ ...row, recipientId: outsider.id })) })).toThrow()
    expect(() => store.commit(0, { ...data, notificationPreferences: data.notificationPreferences.map((row) => ({ ...row, userId: outsider.id })) })).toThrow()
    expect(store.read().version).toBe(0)
  })

  it('rejects duplicate labels while retaining valid suspended-member assignments', () => {
    const { store, data } = setup()
    const label = data.labels[0]
    if (!label) throw new Error('Expected label')
    expect(() => store.commit(0, { ...data, issues: data.issues.map((row) => ({ ...row, labelIds: [label.id, label.id] })) })).toThrow()
    const assigned = data.issues.find((row) => row.assigneeId !== null)
    if (!assigned) throw new Error('Expected assigned issue')
    expect(() => store.commit(0, { ...data, memberships: data.memberships.map((row) => row.userId === assigned.assigneeId ? { ...row, status: 'suspended' } : row) })).not.toThrow()
  })

  it('rejects cross-workspace live activity but preserves deleted-entity history', () => {
    const { store, data } = setup()
    const workspace = data.workspaces[0]
    const event = data.activityEvents[0]
    if (!workspace || !event) throw new Error('Expected history fixture')
    const other = { ...workspace, id: workspaceId('ws_foreign'), name: 'Foreign', slug: 'foreign' }
    expect(() => store.commit(0, { ...data, workspaces: [...data.workspaces, other], activityEvents: [...data.activityEvents,
      { ...event, id: activityEventId('activity_foreign'), entityKind: 'workspace', entityId: other.id },
    ] })).toThrow('event workspace')
    expect(() => store.commit(0, { ...data, activityEvents: [...data.activityEvents,
      { ...event, id: activityEventId('activity_deleted'), entityKind: 'issue', entityId: 'issue_previously_deleted' },
    ] })).not.toThrow()
  })
})
