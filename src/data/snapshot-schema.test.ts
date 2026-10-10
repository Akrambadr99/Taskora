import { describe, expect, it } from 'vitest'
import { createAtlasFixtures } from './fixtures'
import { assertSnapshotShape } from './snapshot-schema'
import { projectId, workflowStatusId } from '../domain'

describe('untrusted snapshot schema', () => {
  it('accepts a JSON round trip of the real domain fixture', () => {
    const value: unknown = JSON.parse(JSON.stringify(createAtlasFixtures()))
    expect(() => { assertSnapshotShape(value) }).not.toThrow()
  })

  it('requires every collection and rejects unknown collections', () => {
    const data = createAtlasFixtures()
    for (const key of Object.keys(data)) {
      const value = Object.fromEntries(Object.entries(data).filter(([name]) => name !== key))
      expect(() => { assertSnapshotShape(value) }).toThrow()
      expect(() => { assertSnapshotShape({ ...data, [key]: {} }) }).toThrow()
    }
    expect(() => { assertSnapshotShape({ ...data, extra: [] }) }).toThrow()
  })

  it('rejects missing, extra and wrongly typed fields in every populated collection', () => {
    const data = createAtlasFixtures()
    for (const [collection, rows] of Object.entries<readonly object[]>({ ...data })) {
      const row = rows[0]
      if (!row) continue
      for (const field of Object.keys(row)) {
        const incomplete = Object.fromEntries(Object.entries(row).filter(([name]) => name !== field))
        expect(() => { assertSnapshotShape({ ...data, [collection]: [incomplete] }) }).toThrow()
        expect(() => { assertSnapshotShape({ ...data, [collection]: [{ ...row, [field]: undefined }] }) }).toThrow()
      }
      expect(() => { assertSnapshotShape({ ...data, [collection]: [{ ...row, extra: true }] }) }).toThrow()
    }
  })

  it.each([
    { revision: 0 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { priority: 'critical' }, { type: 'epic' }, { createdAt: 'yesterday' },
    { dueDate: '2026-02-30' }, { id: 'bad' }, { labelIds: [123] },
  ])('rejects invalid issue values %j', (change) => {
    const data = createAtlasFixtures()
    expect(() => { assertSnapshotShape({ ...data, issues: data.issues.map((issue, i) => i ? issue : { ...issue, ...change }) }) }).toThrow()
  })

  it('rejects orphan workflow states even when no issue uses them', () => {
    const data = createAtlasFixtures()
    const status = data.workflowStatuses[0]
    if (!status) throw new Error('Expected workflow fixture')
    expect(() => { assertSnapshotShape({ ...data, workflowStatuses: [...data.workflowStatuses,
      { ...status, id: workflowStatusId('status_orphan'), projectId: projectId('prj_absent') },
    ] }) }).toThrow(/existing project/)
  })

  it('rejects invalid notification discriminants and nonprimitive audit metadata', () => {
    const data = createAtlasFixtures()
    const notification = data.notifications[0]
    const audit = data.auditEvents[0]
    if (!notification || !audit) throw new Error('Expected history fixture')
    expect(() => { assertSnapshotShape({ ...data, notifications: [{ ...notification, target: { kind: 'unknown', id: 'x' } }] }) }).toThrow()
    expect(() => { assertSnapshotShape({ ...data, auditEvents: [{ ...audit, metadata: { nested: {} } }] }) }).toThrow()
  })
})
