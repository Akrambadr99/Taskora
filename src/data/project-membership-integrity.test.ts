import { describe, expect, it } from 'vitest'

import { createAtlasFixtures } from './fixtures'
import type { AtlasDataSnapshot } from './snapshot'
import { DataIntegrityError } from './snapshot-validation'
import { InMemoryDataStore } from './store'
import { membershipId, projectMemberId, userId, workspaceId } from '../domain'

function duplicateProjectMember(seed: AtlasDataSnapshot): AtlasDataSnapshot {
  const member = seed.projectMembers.find(({ role }) => role === 'contributor')
  if (!member) throw new Error('Expected a contributor fixture.')
  return {
    ...seed,
    projectMembers: [
      ...seed.projectMembers,
      { ...member, id: projectMemberId('pm_duplicate_contributor'), role: 'viewer' },
    ],
  }
}

function foreignWorkspaceMember(seed: AtlasDataSnapshot): AtlasDataSnapshot {
  const workspace = seed.workspaces[0]
  const user = seed.users[0]
  const membership = seed.memberships[0]
  const project = seed.projects[0]
  if (!workspace || !user || !membership || !project) {
    throw new Error('Expected workspace fixtures.')
  }
  const foreignWorkspaceId = workspaceId('ws_other')
  const foreignUserId = userId('usr_other_workspace')
  return {
    ...seed,
    workspaces: [...seed.workspaces, { ...workspace, id: foreignWorkspaceId }],
    users: [...seed.users, { ...user, id: foreignUserId, email: 'other@example.test' }],
    memberships: [
      ...seed.memberships,
      {
        ...membership,
        id: membershipId('mem_other_workspace'),
        workspaceId: foreignWorkspaceId,
        userId: foreignUserId,
      },
    ],
    projectMembers: [
      ...seed.projectMembers,
      {
        id: projectMemberId('pm_foreign_workspace'),
        projectId: project.id,
        userId: foreignUserId,
        role: 'contributor',
      },
    ],
  }
}

describe.each([
  ['duplicate roles for one project/user', duplicateProjectMember],
  ['a member belonging only to another workspace', foreignWorkspaceMember],
] as const)('project membership integrity: %s', (_description, invalidSnapshot) => {
  it('rejects the invalid seed', () => {
    expect(() => new InMemoryDataStore(invalidSnapshot(createAtlasFixtures())))
      .toThrow(DataIntegrityError)
  })

  it('rejects an invalid commit without changing data or version', () => {
    const store = new InMemoryDataStore(createAtlasFixtures())
    const before = store.read()
    expect(() => store.commit(before.version, invalidSnapshot(before.data)))
      .toThrow(DataIntegrityError)
    expect(store.read().version).toBe(before.version)
    expect(store.read().data).toBe(before.data)
  })
})

it('allows one user to hold memberships in different projects', () => {
  const seed = createAtlasFixtures()
  const member = seed.projectMembers.find(({ role }) => role === 'contributor')
  const otherProject = seed.projects.find(({ id }) => id !== member?.projectId)
  if (!member || !otherProject) throw new Error('Expected project fixtures.')
  expect(() => new InMemoryDataStore({
    ...seed,
    projectMembers: [
      ...seed.projectMembers,
      {
        ...member,
        id: projectMemberId('pm_other_project'),
        projectId: otherProject.id,
      },
    ],
  })).not.toThrow()
})
