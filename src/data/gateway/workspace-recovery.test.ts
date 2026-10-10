import { describe, expect, it, vi } from 'vitest'
import { MockAtlasGateway } from './mock-gateway'
import { SimulatedNetwork, type RequestSimulator } from './simulation'
import { createAtlasFixtures } from '../fixtures'
import { InMemoryDataStore } from '../store'
import { FixedClock } from '../clock'
import { parseWorkspaceArchive, backupByteLimit, workspaceSnapshot } from '../workspace-backup'
import { isoDateTime, workspaceId, issueId, issueRelationId, workflowStatusId } from '../../domain'
import type { AtlasDataSnapshot } from '../snapshot'

function setup(simulator?: RequestSimulator) {
  const fixtures = createAtlasFixtures()
  const admin = fixtures.memberships.find((row) => row.role === 'admin')
  if (!admin) throw new Error('Expected admin fixture')
  const store = new InMemoryDataStore(fixtures)
  const clock = new FixedClock(isoDateTime('2026-10-10T10:00:00.000Z'))
  const gateway = new MockAtlasGateway({ store, actorId: admin.userId, clock, ...(simulator ? { simulator } : {}) })
  return { fixtures, admin, store, gateway, clock, workspaceId: admin.workspaceId }
}

async function previewReplacement(context: ReturnType<typeof setup>, change: (data: AtlasDataSnapshot) => AtlasDataSnapshot = (data) => data) {
  const archive = parseWorkspaceArchive(await context.gateway.exportWorkspaceBackup(context.workspaceId))
  const content = JSON.stringify({ ...archive, data: change(archive.data) })
  return context.gateway.previewWorkspaceRecovery(context.workspaceId, content)
}
function confirmation(view: Awaited<ReturnType<typeof previewReplacement>>) {
  return { workspaceId: view.workspaceId, token: view.token, confirmation: view.workspaceName }
}

describe('workspace recovery', () => {
  it('exports a bounded versioned archive and previews without changing state', async () => {
    const c = setup()
    const before = c.store.read()
    const archive = parseWorkspaceArchive(await c.gateway.exportWorkspaceBackup(c.workspaceId))
    expect(archive).toMatchObject({ format: 'taskora.workspace', schemaVersion: 1, workspaceId: c.workspaceId, sourceVersion: 0 })
    const view = await previewReplacement(c)
    expect(view.changes.every((row) => row.added === 0 && row.removed === 0 && row.changed === 0)).toBe(true)
    expect(c.store.read()).toEqual(before)
  })

  it('restores changed content atomically, advances revisions and retains audit history', async () => {
    const c = setup()
    const view = await previewReplacement(c, (data) => ({ ...data, issues: data.issues.map((row) => ({ ...row, title: 'Recovered title' })), auditEvents: [] }))
    expect(view.changes.find((row) => row.collection === 'issues')?.changed).toBeGreaterThan(0)
    const before = c.store.read()
    await c.gateway.restoreWorkspaceBackup(confirmation(view))
    const after = c.store.read()
    expect(after.version).toBe(before.version + 1)
    expect(after.data.issues.filter((row) => row.workspaceId === c.workspaceId).every((row) => row.title === 'Recovered title')).toBe(true)
    expect(after.data.issues[0]?.revision).toBeGreaterThan(before.data.issues[0]?.revision ?? 0)
    expect(after.data.auditEvents).toEqual(expect.arrayContaining([...before.data.auditEvents]))
    expect(after.data.auditEvents.at(-1)?.action).toBe('workspace.recovered')
    await expect(c.gateway.restoreWorkspaceBackup(confirmation(view))).rejects.toMatchObject({ code: 'conflict' })
  })

  it('requires exact explicit confirmation and permits retry after a typo', async () => {
    const c = setup()
    const view = await previewReplacement(c)
    await expect(c.gateway.restoreWorkspaceBackup({ ...confirmation(view), confirmation: '' })).rejects.toMatchObject({ code: 'invalid-request' })
    expect(c.store.read().version).toBe(0)
    await c.gateway.restoreWorkspaceBackup(confirmation(view))
    expect(c.store.read().version).toBe(1)
  })

  it.each(['write', 'expiry', 'replacement'] as const)('rejects a preview invalidated by %s', async (cause) => {
    const c = setup()
    const view = await previewReplacement(c)
    if (cause === 'write') c.store.commit(0, c.store.read().data)
    if (cause === 'expiry') c.clock.advanceBy(600_000)
    if (cause === 'replacement') await previewReplacement(c)
    const before = c.store.read()
    await expect(c.gateway.restoreWorkspaceBackup(confirmation(view))).rejects.toMatchObject({ code: 'conflict' })
    expect(c.store.read()).toEqual(before)
  })

  it('checks current access at confirmation and rejects owner escalation during preview', async () => {
    const c = setup()
    await expect(previewReplacement(c, (data) => ({ ...data, memberships: data.memberships.map((row) => row.id === c.admin.id ? { ...row, role: 'owner' } : row) }))).rejects.toMatchObject({ code: 'forbidden' })
    await expect(previewReplacement(c, (data) => ({ ...data, memberships: data.memberships.map((row) => row.role === 'owner' ? { ...row, role: 'member' } : row) }))).rejects.toThrow()
    const view = await previewReplacement(c)
    c.store.commit(0, { ...c.store.read().data, memberships: c.store.read().data.memberships.map((row) => row.id === c.admin.id ? { ...row, status: 'suspended' } : row) })
    const before = c.store.read()
    await expect(c.gateway.restoreWorkspaceBackup(confirmation(view))).rejects.toMatchObject({ code: 'forbidden' })
    expect(c.store.read()).toEqual(before)
  })

  it('rejects viewer access to both backup and recovery', async () => {
    const c = setup()
    const viewer = c.fixtures.memberships.find((row) => row.role === 'viewer')
    if (!viewer) throw new Error('Expected viewer')
    const gateway = new MockAtlasGateway({ store: c.store, actorId: viewer.userId })
    await expect(gateway.exportWorkspaceBackup(c.workspaceId)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(gateway.previewWorkspaceRecovery(c.workspaceId, '{}')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('rejects schema versions, oversized files, malformed JSON and wrong workspaces', async () => {
    const c = setup()
    const archive = parseWorkspaceArchive(await c.gateway.exportWorkspaceBackup(c.workspaceId))
    for (const content of ['{', JSON.stringify({ ...archive, schemaVersion: 2 }), ' '.repeat(backupByteLimit + 1), JSON.stringify({ ...archive, workspaceId: workspaceId('ws_other') })]) {
      await expect(c.gateway.previewWorkspaceRecovery(c.workspaceId, content)).rejects.toMatchObject({ code: 'invalid-request' })
    }
    expect(c.store.read().version).toBe(0)
  })

  it('rejects missing references, invalid workflow states, parent cycles and dependency cycles', async () => {
    const c = setup()
    const changes: ((data: AtlasDataSnapshot) => AtlasDataSnapshot)[] = [
      (data) => ({ ...data, users: [] }),
      (data) => ({ ...data, issues: data.issues.map((row) => ({ ...row, statusId: workflowStatusId('status_absent') })) }),
      (data) => ({ ...data, issues: data.issues.map((row) => ({ ...row, parentIssueId: row.id })) }),
      (data) => {
        const first = data.issues[0]
        const second = data.issues.find((row) => row.projectId === first?.projectId && row.id !== first.id)
        if (!first || !second) throw new Error('Expected two issues')
        return { ...data, issueRelations: [
          { id: issueRelationId('rel_a'), sourceIssueId: first.id, targetIssueId: second.id, type: 'blocks' },
          { id: issueRelationId('rel_b'), sourceIssueId: second.id, targetIssueId: first.id, type: 'blocks' },
        ] }
      },
      (data) => ({ ...data, issues: data.issues.map((row) => ({ ...row, parentIssueId: issueId('issue_absent') })) }),
    ]
    for (const change of changes) await expect(previewReplacement(c, change)).rejects.toThrow()
    expect(c.store.read().version).toBe(0)
  })

  it('rejects requests already waiting when another gateway restores the workspace', async () => {
    const c = setup()
    let release: () => void = () => { throw new Error('Not waiting') }
    const pendingGateway = new MockAtlasGateway({ store: c.store, actorId: c.admin.userId,
      simulator: { wait: () => new Promise<void>((resolve) => { release = resolve }) },
    })
    const view = await previewReplacement(c)
    const pending = pendingGateway.exportWorkspaceBackup(c.workspaceId)
    await c.gateway.restoreWorkspaceBackup(confirmation(view))
    release()
    await expect(pending).rejects.toMatchObject({ code: 'conflict' })
  })

  it('keeps state unchanged after cancellation or an atomic-store failure', async () => {
    const c = setup()
    const view = await previewReplacement(c)
    const before = c.store.read()
    const controller = new AbortController(); controller.abort()
    await expect(c.gateway.restoreWorkspaceBackup(confirmation(view), { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
    const fail = vi.spyOn(c.store, 'restore').mockImplementationOnce(() => { throw new Error('Storage unavailable') })
    await expect(c.gateway.restoreWorkspaceBackup(confirmation(view))).rejects.toThrow('Storage unavailable')
    expect(c.store.read()).toEqual(before)
    expect(c.store.recoveryEpoch).toBe(0)
    fail.mockRestore()
    await c.gateway.restoreWorkspaceBackup(confirmation(view))
    expect(c.store.read().version).toBe(1)
  })

  it('preserves shared profiles and unrelated workspaces', async () => {
    const c = setup()
    const extra = { id: workspaceId('ws_other'), name: 'Other', slug: 'other', createdAt: c.clock.now() }
    c.store.commit(0, { ...c.store.read().data, workspaces: [...c.store.read().data.workspaces, extra] })
    const before = workspaceSnapshot(c.store.read().data, extra.id)
    const view = await previewReplacement(c, (data) => ({ ...data, users: data.users.map((row) => ({ ...row, displayName: 'Old name' })) }))
    await c.gateway.restoreWorkspaceBackup(confirmation(view))
    expect(workspaceSnapshot(c.store.read().data, extra.id)).toEqual(before)
    expect(c.store.read().data.users).toEqual(c.fixtures.users)
  })

  it('does not commit after simulated network failure', async () => {
    const c = setup(new SimulatedNetwork({ failure: (operation) => operation === 'workspace.backup.restore' ? 'Offline' : null }))
    const view = await previewReplacement(c)
    await expect(c.gateway.restoreWorkspaceBackup(confirmation(view))).rejects.toThrow('Offline')
    expect(c.store.read().version).toBe(0)
  })
})
