import type { GatewayErrorCode } from './errors'
import type { IsoDateTime } from '../../domain'

export type GatewayOperation =
  | 'workspace.backup.export'
  | 'workspace.backup.preview'
  | 'workspace.backup.restore'
  | 'activity.list'
  | 'administration.invitations.get'
  | 'administration.invitations.create'
  | 'administration.invitations.resend'
  | 'administration.invitations.revoke'
  | 'administration.invitations.activate'
  | 'administration.members.get'
  | 'administration.members.update'
  | 'administration.project-members.get'
  | 'administration.project-members.add'
  | 'administration.project-members.update'
  | 'administration.project-members.remove'
  | 'administration.project-lead.get'
  | 'administration.project-lead.transfer'
  | 'administration.workflow.get'
  | 'administration.workflow.update'
  | 'analytics.get'
  | 'authorization.get'
  | 'board.metadata'
  | 'comment.create'
  | 'comment.update'
  | 'comment.delete'
  | 'governance.get'
  | 'issue.activity'
  | 'issue.create'
  | 'issue.delete'
  | 'issue.get'
  | 'issue.filter-metadata'
  | 'issue.creation-metadata'
  | 'issue.list'
  | 'issue.subscription.get'
  | 'issue.subscription.update'
  | 'issue.update'
  | 'issue.relationships.get'
  | 'issue.relation.create'
  | 'issue.relation.remove'
  | 'notification.list'
  | 'notification.mark-read'
  | 'notification.update-read-state'
  | 'notification.preferences.get'
  | 'notification.preferences.update'
  | 'project.list'
  | 'project.summary-list'
  | 'project.metadata.get'
  | 'project.activity.get'
  | 'project.subscription.get'
  | 'project.subscription.update'
  | 'project.create'
  | 'project.creation-metadata'
  | 'project.update'
  | 'project.archive'

export type RequestPhase = 'cancelled' | 'failed' | 'started' | 'succeeded'

export interface RequestTraceEvent {
  readonly requestId: string
  readonly operation: GatewayOperation
  readonly phase: RequestPhase
  readonly occurredAt: IsoDateTime
  readonly errorCode?: GatewayErrorCode
}

export interface RequestTracer {
  record(event: RequestTraceEvent): void
}

export class InMemoryRequestTracer implements RequestTracer {
  private readonly events: RequestTraceEvent[] = []

  record(event: RequestTraceEvent): void {
    this.events.push(structuredClone(event))
  }

  read(): readonly RequestTraceEvent[] {
    return structuredClone(this.events)
  }

  clear(): void {
    this.events.length = 0
  }
}

export const noopRequestTracer: RequestTracer = {
  record: () => undefined,
}
