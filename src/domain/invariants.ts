import type { Issue, IssueRelation } from './issue'
import type { Membership } from './workspace'
import type { Project, WorkflowStatus } from './project'
import type { IssueId } from './ids'

const workflowStatusCategories = new Set<WorkflowStatus['category']>([
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
])

export type DomainInvariantCode =
  | 'duplicate-membership'
  | 'invalid-project-key'
  | 'invalid-workflow'
  | 'invalid-issue-relation'
  | 'cyclic-issue-dependency'
  | 'invalid-issue-parent'

export class DomainInvariantError extends Error {
  readonly code: DomainInvariantCode

  constructor(code: DomainInvariantCode, message: string) {
    super(message)
    this.name = 'DomainInvariantError'
    this.code = code
  }
}

export function assertProjectKey(key: string): void {
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
    throw new DomainInvariantError(
      'invalid-project-key',
      'Project keys must contain 2-10 uppercase letters or digits and begin with a letter.',
    )
  }
}

export function assertUniqueMemberships(memberships: readonly Membership[]): void {
  const seen = new Set<string>()

  for (const membership of memberships) {
    const identity = `${membership.workspaceId}:${membership.userId}`

    if (seen.has(identity)) {
      throw new DomainInvariantError(
        'duplicate-membership',
        'A user may have only one membership in a workspace.',
      )
    }

    seen.add(identity)
  }
}

export function assertProjectWorkflow(
  project: Project,
  statuses: readonly WorkflowStatus[],
): void {
  if (statuses.length < 2 || statuses.length > 10) {
    throw new DomainInvariantError(
      'invalid-workflow',
      'A project workflow must contain 2 to 10 statuses.',
    )
  }

  const ids = new Set<string>()
  const names = new Set<string>()
  const orders = new Set<number>()

  for (const status of statuses) {
    const normalizedName = status.name.trim().toLocaleLowerCase()

    if (
      status.projectId !== project.id ||
      normalizedName.length === 0 ||
      normalizedName.length > 60 ||
      !workflowStatusCategories.has(status.category) ||
      ids.has(status.id) ||
      names.has(normalizedName) ||
      orders.has(status.order)
    ) {
      throw new DomainInvariantError(
        'invalid-workflow',
        'Workflow statuses must belong to the project, use valid names and categories, and have unique ids, names, and order values.',
      )
    }

    ids.add(status.id)
    names.add(normalizedName)
    orders.add(status.order)
  }

  const sortedOrders = [...orders].sort((left, right) => left - right)
  const isContiguous = sortedOrders.every((order, index) => order === index)

  if (!isContiguous) {
    throw new DomainInvariantError(
      'invalid-workflow',
      'Workflow status order must be contiguous and start at zero.',
    )
  }

  if (
    !statuses.some(({ category }) => category === 'completed') ||
    !statuses.some(
      ({ category }) => category !== 'completed' && category !== 'canceled',
    )
  ) {
    throw new DomainInvariantError(
      'invalid-workflow',
      'A project workflow must support both open and completed work.',
    )
  }
}

export function assertIssueRelations(
  issues: readonly Issue[],
  relations: readonly IssueRelation[],
): void {
  const issuesById = new Map(issues.map((issue) => [issue.id, issue]))
  const relationKeys = new Set<string>()
  const blockingGraph = new Map<IssueId, IssueId[]>()

  for (const issue of issues) {
    blockingGraph.set(issue.id, [])
  }

  for (const relation of relations) {
    const source = issuesById.get(relation.sourceIssueId)
    const target = issuesById.get(relation.targetIssueId)
    const relationKey = `${relation.sourceIssueId}:${relation.targetIssueId}:${relation.type}`

    if (!source || !target) {
      throw new DomainInvariantError(
        'invalid-issue-relation',
        'Issue relations require distinct, existing issues in the same project and may not be duplicated.',
      )
    }

    if (
      source.projectId !== target.projectId ||
      source.id === target.id ||
      relationKeys.has(relationKey)
    ) {
      throw new DomainInvariantError(
        'invalid-issue-relation',
        'Issue relations require distinct, existing issues in the same project and may not be duplicated.',
      )
    }

    relationKeys.add(relationKey)

    if (relation.type === 'blocks') {
      blockingGraph.get(source.id)?.push(target.id)
    }
  }

  assertAcyclicGraph(blockingGraph)
}

export function assertIssueHierarchy(issues: readonly Issue[]): void {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const children = new Map<IssueId, IssueId[]>(issues.map(({ id }) => [id, []]))
  for (const issue of issues) {
    if (issue.parentIssueId === null) continue
    const parent = byId.get(issue.parentIssueId)
    if (!parent || parent.id === issue.id || parent.projectId !== issue.projectId ||
        parent.workspaceId !== issue.workspaceId) {
      throw new DomainInvariantError(
        'invalid-issue-parent',
        'An issue parent must be a different existing issue in the same project and workspace.',
      )
    }
    children.get(parent.id)?.push(issue.id)
  }
  assertAcyclicGraph(children, 'invalid-issue-parent', 'Issue parent hierarchies must be acyclic.')
}

function assertAcyclicGraph(
  graph: ReadonlyMap<IssueId, readonly IssueId[]>,
  code: DomainInvariantCode = 'cyclic-issue-dependency',
  message = 'Blocking issue relations must form an acyclic graph.',
): void {
  // An iterative topological walk also supports deep imported project graphs.
  const incoming = new Map<IssueId, number>([...graph.keys()].map((id) => [id, 0]))
  for (const targets of graph.values()) {
    for (const target of targets) incoming.set(target, (incoming.get(target) ?? 0) + 1)
  }
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  for (const id of ready) {
    visited += 1
    for (const target of graph.get(id) ?? []) {
      const remaining = (incoming.get(target) ?? 0) - 1
      incoming.set(target, remaining)
      if (remaining === 0) ready.push(target)
    }
  }
  if (visited !== graph.size) throw new DomainInvariantError(code, message)
}
