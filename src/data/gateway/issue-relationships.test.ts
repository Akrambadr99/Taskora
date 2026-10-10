import { describe, expect, it } from 'vitest'

import { MockAtlasGateway } from './mock-gateway'
import { SimulatedNetwork, type RequestSimulator } from './simulation'
import { createAtlasFixtures } from '../fixtures'
import { InMemoryDataStore } from '../store'
import { issueId, issueRelationId, type IssueRelationType, type UserId } from '../../domain'

function setup(simulator: RequestSimulator = new SimulatedNetwork(), actor?: UserId) {
  const fixtures = createAtlasFixtures()
  const source = fixtures.issues[0]
  if (!source) throw new Error('Expected issue fixture.')
  const target = fixtures.issues.find((issue) => issue.projectId === source.projectId && issue.id !== source.id)
  const admin = fixtures.memberships.find(({ role }) => role === 'admin')
  if (!target || !admin) throw new Error('Expected fixtures.')
  const store = new InMemoryDataStore({ ...fixtures, issueRelations: [] })
  const gateway = new MockAtlasGateway({ store, actorId: actor ?? admin.userId, simulator })
  const input = {
    sourceIssueId: source.id, targetIssueId: target.id, type: 'blocks' as const,
    expectedSourceRevision: source.revision, expectedTargetRevision: target.revision,
  }
  return { fixtures, source, target, store, gateway, input, admin }
}

describe('issue relationships gateway', () => {
  it('reads a project-scoped relationship view', async () => {
    const { gateway, source } = setup()
    const view = await gateway.getIssueRelationships(source.id)
    expect(view.issue).toEqual(source)
    expect(view.projectIssues.every(({ projectId }) => projectId === source.projectId)).toBe(true)
    expect(view.relations).toEqual([])
    await expect(gateway.getIssueRelationships(issueId('issue_absent'))).rejects.toMatchObject({ code: 'not-found' })
  })

  it.each(['blocks', 'relates-to', 'duplicates'] as const)('adds and removes %s with one atomic commit and history at both ends', async (type) => {
    const { gateway, store, input, source, target } = setup()
    const before = store.read()
    const relation = await gateway.createIssueRelation({ ...input, type })
    const after = store.read()
    expect(after.version).toBe(before.version + 1)
    expect(after.data.issueRelations).toEqual([relation])
    expect(after.data.issues.find(({ id }) => id === source.id)?.revision).toBe(source.revision + 1)
    expect(after.data.issues.find(({ id }) => id === target.id)?.revision).toBe(target.revision + 1)
    expect(after.data.activityEvents.slice(-2).map(({ entityId }) => entityId)).toEqual([source.id, target.id])
    expect(after.data.auditEvents.at(-1)).toMatchObject({
      action: 'issue.relationship.created', outcome: 'succeeded',
      metadata: { sourceIssueId: source.id, targetIssueId: target.id, type },
    })
    expect((await gateway.getIssueRelationships(target.id)).relations).toEqual([relation])
    await gateway.removeIssueRelation({
      id: relation.id, expectedSourceRevision: source.revision + 1,
      expectedTargetRevision: target.revision + 1,
    })
    expect(store.read().version).toBe(before.version + 2)
    expect(store.read().data.issueRelations).toEqual([])
    expect(store.read().data.auditEvents.at(-1)?.action).toBe('issue.relationship.removed')
  })

  it.each(['source', 'target'] as const)('rejects a stale %s revision without partial changes', async (endpoint) => {
    const { gateway, store, input } = setup()
    const before = store.read()
    await expect(gateway.createIssueRelation({
      ...input, [endpoint === 'source' ? 'expectedSourceRevision' : 'expectedTargetRevision']: 999,
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(store.read()).toEqual(before)
  })

  it('rejects cycles without advancing endpoint revisions or emitting success history', async () => {
    const { gateway, store, input, source, target } = setup()
    await gateway.createIssueRelation(input)
    const before = store.read()
    await expect(gateway.createIssueRelation({
      ...input, sourceIssueId: target.id, targetIssueId: source.id,
      expectedSourceRevision: target.revision + 1, expectedTargetRevision: source.revision + 1,
    })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(store.read()).toEqual(before)
  })

  it('rejects duplicates, including reversed symmetric links', async () => {
    const { gateway, store, input, source, target } = setup()
    await gateway.createIssueRelation({ ...input, type: 'relates-to' })
    const before = store.read()
    await expect(gateway.createIssueRelation({ ...input, type: 'relates-to' })).rejects.toThrow(/already exists/)
    await expect(gateway.createIssueRelation({
      ...input, type: 'relates-to', sourceIssueId: target.id, targetIssueId: source.id,
      expectedSourceRevision: target.revision + 1, expectedTargetRevision: source.revision + 1,
    })).rejects.toThrow(/already exists/)
    expect(store.read()).toEqual(before)
  })

  it('rejects self links, foreign projects, missing endpoints and unknown relation types', async () => {
    const { gateway, store, input, source, fixtures } = setup()
    const foreign = fixtures.issues.find(({ projectId }) => projectId !== source.projectId)
    if (!foreign) throw new Error('Expected another project.')
    const before = store.read()
    for (const change of [
      { targetIssueId: source.id }, { targetIssueId: foreign.id },
      { targetIssueId: issueId('issue_missing') }, { type: 'unknown' as IssueRelationType },
    ]) {
      await expect(gateway.createIssueRelation({ ...input, ...change })).rejects.toThrow()
      expect(store.read()).toEqual(before)
    }
  })

  it('rejects stale and missing removals', async () => {
    const { gateway, store, input } = setup()
    const relation = await gateway.createIssueRelation(input)
    const before = store.read()
    await expect(gateway.removeIssueRelation({ ...input, id: relation.id })).rejects.toMatchObject({ code: 'conflict' })
    await expect(gateway.removeIssueRelation({ ...input, id: issueRelationId('rel_missing') })).rejects.toMatchObject({ code: 'not-found' })
    expect(store.read()).toEqual(before)
  })

  it('allows only one of two concurrent writes from the same endpoint revisions', async () => {
    const { gateway, store, input } = setup()
    const results = await Promise.allSettled([
      gateway.createIssueRelation(input), gateway.createIssueRelation({ ...input, type: 'duplicates' }),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } })
    expect(store.read().data.issueRelations).toHaveLength(1)
  })

  it('rejects viewer writes and archived-project writes', async () => {
    const fixtures = createAtlasFixtures()
    const viewer = fixtures.memberships.find(({ role }) => role === 'viewer')
    if (!viewer) throw new Error('Expected viewer.')
    const readOnly = setup(undefined, viewer.userId)
    await expect(readOnly.gateway.createIssueRelation(readOnly.input)).rejects.toMatchObject({ code: 'forbidden' })
    const { gateway, store, input, source } = setup()
    const current = store.read()
    store.commit(current.version, { ...current.data, projects: current.data.projects.map((project) =>
      project.id === source.projectId ? { ...project, status: 'archived' } : project) })
    const before = store.read()
    await expect(gateway.createIssueRelation(input)).rejects.toMatchObject({ code: 'conflict' })
    expect(store.read()).toEqual(before)
  })

  it('checks current access after the simulated transport wait', async () => {
    let release: () => void = () => { throw new Error('Request not started.') }
    const simulator: RequestSimulator = { wait: () => new Promise<void>((resolve) => { release = resolve }) }
    const { gateway, store, input, admin } = setup(simulator)
    const pending = gateway.createIssueRelation(input)
    const current = store.read()
    store.commit(current.version, { ...current.data, memberships: current.data.memberships.map((membership) =>
      membership.id === admin.id ? { ...membership, status: 'suspended' } : membership) })
    const before = store.read()
    release()
    await expect(pending).rejects.toMatchObject({ code: 'forbidden' })
    expect(store.read()).toEqual(before)
  })

  it('does not mutate after cancellation or simulated failure', async () => {
    const controller = new AbortController()
    controller.abort()
    const { gateway, store, input } = setup()
    const before = store.read()
    await expect(gateway.createIssueRelation(input, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(store.read()).toEqual(before)
    const failed = setup(new SimulatedNetwork({ failure: () => 'offline' }))
    await expect(failed.gateway.createIssueRelation(failed.input)).rejects.toMatchObject({ code: 'simulated-failure' })
    expect(failed.store.read().version).toBe(0)
  })

  it('continues allocating unique relation identifiers when a gateway is reconstructed', async () => {
    const { gateway, store, input, admin, source, target } = setup()
    const first = await gateway.createIssueRelation(input)
    const reopened = new MockAtlasGateway({ store, actorId: admin.userId })
    const second = await reopened.createIssueRelation({
      ...input, type: 'duplicates', expectedSourceRevision: source.revision + 1,
      expectedTargetRevision: target.revision + 1,
    })
    expect(second.id).not.toBe(first.id)
    expect(store.read().data.issueRelations).toHaveLength(2)
  })
})
