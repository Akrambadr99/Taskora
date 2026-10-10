import type { Issue, IssueRelation, WorkflowStatus } from '../domain'

export function unresolvedBlockers(
  issueId: Issue['id'],
  issues: readonly Issue[],
  relations: readonly IssueRelation[],
  statuses: readonly WorkflowStatus[],
): readonly Issue[] {
  const issueById = new Map(issues.map((issue) => [issue.id, issue]))
  const categoryById = new Map(statuses.map((status) => [status.id, status.category]))

  return relations
    .filter((relation) => relation.type === 'blocks' && relation.targetIssueId === issueId)
    .flatMap((relation) => {
      const blocker = issueById.get(relation.sourceIssueId)
      return blocker && categoryById.get(blocker.statusId) !== 'completed' ? [blocker] : []
    })
}

export function completedIssuesWithOpenBlockers(
  issues: readonly Issue[],
  relations: readonly IssueRelation[],
  statuses: readonly WorkflowStatus[],
): readonly Issue[] {
  const categoryById = new Map(statuses.map((status) => [status.id, status.category]))
  const issueById = new Map(issues.map((issue) => [issue.id, issue]))
  const blockedTargets = new Set<Issue['id']>()
  for (const relation of relations) {
    if (relation.type !== 'blocks') continue
    const blocker = issueById.get(relation.sourceIssueId)
    if (blocker && categoryById.get(blocker.statusId) !== 'completed') {
      blockedTargets.add(relation.targetIssueId)
    }
  }
  return issues.filter((issue) =>
    blockedTargets.has(issue.id) && categoryById.get(issue.statusId) === 'completed',
  )
}
