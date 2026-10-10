import {
  activityEventId,
  auditEventId,
  commentId,
  commentMentionId,
  issueId,
  issueSubscriptionId,
  issueRelationId,
  labelId,
  membershipId,
  workspaceInvitationId,
  notificationId,
  notificationPreferenceId,
  projectId,
  projectMemberId,
  projectSubscriptionId,
  userId,
  workflowStatusId,
  workspaceId,
  type ActivityEventId,
  type AuditEventId,
  type CommentId,
  type CommentMentionId,
  type IssueId,
  type IssueSubscriptionId,
  type IssueRelationId,
  type LabelId,
  type MembershipId,
  type WorkspaceInvitationId,
  type NotificationId,
  type NotificationPreferenceId,
  type ProjectId,
  type ProjectMemberId,
  type ProjectSubscriptionId,
  type UserId,
  type WorkflowStatusId,
  type WorkspaceId,
} from '../domain'

const idSegmentPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/

export class DeterministicIdGenerator {
  private readonly reserved = new Set<string>()

  reserve(ids: Iterable<string>): void {
    for (const id of ids) this.reserved.add(id)
  }

  private readonly namespace: string
  private readonly counters = new Map<string, number>()

  constructor(namespace: string) {
    if (!idSegmentPattern.test(namespace)) {
      throw new TypeError('Identifier namespaces must be lowercase slug segments.')
    }

    this.namespace = namespace
  }

  workspace(scope: string): WorkspaceId {
    return workspaceId(this.next('ws', scope))
  }

  user(scope: string): UserId {
    return userId(this.next('usr', scope))
  }

  membership(scope: string): MembershipId {
    return membershipId(this.next('mem', scope))
  }

  workspaceInvitation(scope: string): WorkspaceInvitationId {
    return workspaceInvitationId(this.next('invite', scope))
  }

  project(scope: string): ProjectId {
    return projectId(this.next('prj', scope))
  }

  projectMember(scope: string): ProjectMemberId {
    return projectMemberId(this.next('pm', scope))
  }

  projectSubscription(scope: string): ProjectSubscriptionId {
    return projectSubscriptionId(this.next('project_subscription', scope))
  }

  workflowStatus(scope: string): WorkflowStatusId {
    return workflowStatusId(this.next('status', scope))
  }

  issue(scope: string): IssueId {
    return issueId(this.next('issue', scope))
  }

  issueSubscription(scope: string): IssueSubscriptionId {
    return issueSubscriptionId(this.next('subscription', scope))
  }

  issueRelation(scope: string): IssueRelationId {
    return issueRelationId(this.next('rel', scope))
  }

  label(scope: string): LabelId {
    return labelId(this.next('label', scope))
  }

  comment(scope: string): CommentId {
    return commentId(this.next('comment', scope))
  }

  commentMention(scope: string): CommentMentionId {
    return commentMentionId(this.next('mention', scope))
  }

  activity(scope: string): ActivityEventId {
    return activityEventId(this.next('activity', scope))
  }

  audit(scope: string): AuditEventId {
    return auditEventId(this.next('audit', scope))
  }

  notification(scope: string): NotificationId {
    return notificationId(this.next('notification', scope))
  }

  notificationPreference(scope: string): NotificationPreferenceId {
    return notificationPreferenceId(this.next('notification_pref', scope))
  }

  private next(prefix: string, scope: string): string {
    if (!idSegmentPattern.test(scope)) {
      throw new TypeError('Identifier scopes must be lowercase slug segments.')
    }

    const counterKey = `${prefix}:${scope}`
    let sequence = this.counters.get(counterKey) ?? 0
    let id: string
    do {
      sequence += 1
      id = `${prefix}_${this.namespace}_${scope}_${sequence.toString().padStart(3, '0')}`
    } while (this.reserved.has(id))
    this.counters.set(counterKey, sequence)
    this.reserved.add(id)
    return id
  }
}
