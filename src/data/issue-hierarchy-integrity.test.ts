import { describe, expect, it } from 'vitest'

import { createAtlasFixtures } from './fixtures'
import { InMemoryDataStore } from './store'
import { assertIssueRelations, issueId, issueRelationId } from '../domain'

function sameProjectIssues() {
  const seed = createAtlasFixtures()
  const first = seed.issues[0]
  if (!first) throw new Error('Expected a fixture issue.')
  const second = seed.issues.find((issue) => issue.id !== first.id && issue.projectId === first.projectId)
  if (!second) throw new Error('Expected two issues in one project.')
  return { seed, first, second }
}

describe('issue hierarchy integrity', () => {
  it('rejects an issue as its own parent', () => {
    const { seed, first } = sameProjectIssues()
    expect(() => new InMemoryDataStore({
      ...seed,
      issues: seed.issues.map((issue) => issue.id === first.id
        ? { ...issue, parentIssueId: first.id } : issue),
    })).toThrow(/parent|hierarchy/i)
  })

  it('rejects a parent cycle without replacing the current snapshot', () => {
    const { seed, first, second } = sameProjectIssues()
    const store = new InMemoryDataStore(seed)
    const before = store.read()
    expect(() => store.commit(before.version, {
      ...seed,
      issues: seed.issues.map((issue) => issue.id === first.id
        ? { ...issue, parentIssueId: second.id }
        : issue.id === second.id ? { ...issue, parentIssueId: first.id } : issue),
    })).toThrow(/parent|hierarchy/i)
    expect(store.read()).toEqual(before)
    expect(store.read().data).toBe(before.data)
  })

  it('preserves valid parent relationships', () => {
    const { seed, first, second } = sameProjectIssues()
    expect(() => new InMemoryDataStore({
      ...seed,
      issues: seed.issues.map((issue) => issue.id === second.id
        ? { ...issue, parentIssueId: first.id } : { ...issue, parentIssueId: null }),
    })).not.toThrow()
  })

  it('validates a long blocking chain without overflowing the call stack', () => {
    const { first } = sameProjectIssues()
    const issues = Array.from({ length: 15_000 }, (_, index) => ({
      ...first, id: issueId(`issue_chain_${index.toString()}`), parentIssueId: null,
    }))
    const relations = issues.slice(1).map((issue, index) => ({
      id: issueRelationId(`rel_chain_${index.toString()}`),
      sourceIssueId: issues[index]?.id ?? first.id,
      targetIssueId: issue.id,
      type: 'blocks' as const,
    }))
    expect(() => { assertIssueRelations(issues, relations); }).not.toThrow()
    const last = issues.at(-1)
    const head = issues[0]
    if (!last || !head) throw new Error('Expected chain endpoints.')
    expect(() => { assertIssueRelations(issues, [...relations, {
      id: issueRelationId('rel_chain_back'), sourceIssueId: last.id,
      targetIssueId: head.id, type: 'blocks',
    }]); }).toThrow(/acyclic/)
  })
})
