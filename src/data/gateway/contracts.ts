import type {
  Issue,
  IssueRelation,
  IssueRelationId,
  IssueRelationType,
  ActivityEvent,
  AuditEvent,
  Comment,
  CommentMention,
  CommentId,
  IssueId,
  IssuePriority,
  IssueType,
  IsoDate,
  IsoDateTime,
  Label,
  LabelId,
  Notification,
  NotificationCategory,
  NotificationId,
  NotificationPreferences,
  Membership,
  MembershipId,
  MembershipStatus,
  ProjectMember,
  ProjectMemberId,
  ProjectMemberRole,
  Project,
  ProjectId,
  ProjectStatus,
  UserId,
  User,
  WorkflowStatus,
  WorkflowStatusCategory,
  WorkflowStatusId,
  WorkspaceId,
  WorkspaceRole,
  WorkspaceInvitation,
  WorkspaceInvitationId,
  WorkspaceInvitationRole,
  WorkspaceInvitationState,
  EntityKind,
} from '../../domain'

export type SortDirection = 'ascending' | 'descending'
export type IssueSortField =
  | 'createdAt'
  | 'dueDate'
  | 'number'
  | 'priority'
  | 'title'
  | 'updatedAt'

export interface PageRequest {
  readonly number: number
  readonly size: number
}

export interface Page<T> {
  readonly items: readonly T[]
  readonly pageNumber: number
  readonly pageSize: number
  readonly pageCount: number
  readonly totalItems: number
}

export interface ProjectSummaryQuery {
  readonly workspaceId: WorkspaceId
  readonly search?: string
  readonly statuses?: readonly ProjectStatus[]
  readonly page?: PageRequest
}

export interface ProjectSummary {
  readonly project: Project
  readonly totalIssues: number
  readonly openIssues: number
  readonly completedIssues: number
}

export interface ProjectEditMetadata {
  readonly project: Project
}

export interface ProjectLeadCandidate {
  readonly user: User
  readonly currentRole: AssignableProjectRole
}

export interface ProjectLeadTransferData {
  readonly project: Project
  readonly currentLead: User
  readonly candidates: readonly ProjectLeadCandidate[]
}

export type AssignableProjectRole = Exclude<ProjectMemberRole, 'lead'>

export interface ProjectMembershipQuery {
  readonly projectId: ProjectId
  readonly search?: string
  readonly page?: PageRequest
}

export interface ProjectMembershipEntry {
  readonly membership: ProjectMember
  readonly user: User
  readonly workspaceStatus: MembershipStatus
  readonly assignedIssueCount: number
}

export interface ProjectMembershipAdministrationData {
  readonly project: Project
  readonly members: Page<ProjectMembershipEntry>
  readonly eligibleUsers: readonly User[]
  readonly reassignmentUsers: readonly User[]
}

export interface AddProjectMemberInput {
  readonly projectId: ProjectId
  readonly expectedProjectRevision: number
  readonly userId: UserId
  readonly role: AssignableProjectRole
}

export interface UpdateProjectMemberInput {
  readonly id: ProjectMemberId
  readonly expectedProjectRevision: number
  readonly role: AssignableProjectRole
}

export interface RemoveProjectMemberInput {
  readonly id: ProjectMemberId
  readonly expectedProjectRevision: number
  readonly reassignIssuesTo: UserId | null
}

export interface TransferProjectLeadInput {
  readonly projectId: ProjectId
  readonly expectedProjectRevision: number
  readonly expectedCurrentLeadId: UserId
  readonly newLeadId: UserId
  readonly formerLeadRole: AssignableProjectRole
}

export interface ProjectWorkflowAdministrationEntry {
  readonly status: WorkflowStatus
  readonly issueCount: number
}

export interface ProjectWorkflowAdministrationData {
  readonly project: Project
  readonly statuses: readonly ProjectWorkflowAdministrationEntry[]
}

export interface ProjectWorkflowStatusDraft {
  readonly id: WorkflowStatusId | null
  readonly name: string
  readonly category: WorkflowStatusCategory
}

export interface ProjectWorkflowMigration {
  readonly statusId: WorkflowStatusId
  readonly reassignToStatusId: WorkflowStatusId
}

export interface UpdateProjectWorkflowInput {
  readonly projectId: ProjectId
  readonly expectedProjectRevision: number
  readonly statuses: readonly ProjectWorkflowStatusDraft[]
  readonly migrations: readonly ProjectWorkflowMigration[]
}

export interface ProjectCreationMetadata {
  readonly eligibleLeads: readonly User[]
}

export interface CreateProjectWorkflowStatusInput {
  readonly name: string
  readonly category: WorkflowStatusCategory
}

export interface CreateProjectInput {
  readonly workspaceId: WorkspaceId
  readonly key: string
  readonly name: string
  readonly description: string
  readonly leadId: UserId
  readonly workflow: readonly CreateProjectWorkflowStatusInput[]
}

export interface ProjectActivityEntry {
  readonly event: ActivityEvent
  readonly actor: User
}

export interface ProjectActivityData {
  readonly events: Page<ProjectActivityEntry>
}

export interface WorkspaceActivityQuery {
  readonly workspaceId: WorkspaceId
  readonly actorId?: UserId
  readonly action?: string
  readonly entityKind?: EntityKind
  readonly entityId?: string
  readonly occurredFrom?: IsoDateTime
  readonly occurredTo?: IsoDateTime
  readonly page?: PageRequest
}

export interface WorkspaceActivityActorFacet {
  readonly value: UserId
  readonly label: string
  readonly count: number
}

export interface WorkspaceActivityFacet<TValue extends string> {
  readonly value: TValue
  readonly count: number
}

export interface WorkspaceActivityTarget {
  readonly label: string
  readonly href: string | null
}

export interface WorkspaceActivityEntry {
  readonly event: ActivityEvent
  readonly actor: User
  readonly target: WorkspaceActivityTarget
}

export interface WorkspaceActivityData {
  readonly generatedAt: IsoDateTime
  readonly actors: readonly WorkspaceActivityActorFacet[]
  readonly actions: readonly WorkspaceActivityFacet<string>[]
  readonly entityKinds: readonly WorkspaceActivityFacet<EntityKind>[]
  readonly events: Page<WorkspaceActivityEntry>
}

export type MutableProjectFields = Pick<
  Project,
  'description' | 'name' | 'status'
>

export interface UpdateProjectInput {
  readonly id: ProjectId
  readonly expectedRevision: number
  readonly changes: Partial<MutableProjectFields>
}

export interface ArchiveProjectInput {
  readonly id: ProjectId
  readonly expectedRevision: number
}

export interface IssueFilters {
  readonly workspaceId: WorkspaceId
  readonly projectIds?: readonly ProjectId[]
  readonly statusIds?: readonly WorkflowStatusId[]
  readonly priorities?: readonly IssuePriority[]
  readonly assigneeIds?: readonly UserId[]
  readonly includeUnassigned?: boolean
  readonly search?: string
}

export interface IssueQuery {
  readonly filters: IssueFilters
  readonly sort?: {
    readonly field: IssueSortField
    readonly direction: SortDirection
  }
  readonly page?: PageRequest
}

export interface RequestOptions {
  readonly signal?: AbortSignal
}

export interface CreateIssueInput {
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly type: IssueType
  readonly title: string
  readonly description: string
  readonly statusId: WorkflowStatusId
  readonly priority: IssuePriority
  readonly assigneeId: UserId | null
  readonly parentIssueId: IssueId | null
  readonly dueDate: IsoDate | null
  readonly labelIds: readonly LabelId[]
}

export interface IssueCreationProjectMetadata {
  readonly project: Project
  readonly statuses: readonly WorkflowStatus[]
  readonly assignees: readonly User[]
}

export interface IssueCreationMetadata {
  readonly projects: readonly IssueCreationProjectMetadata[]
  readonly labels: readonly Label[]
}

export interface IssueFilterProjectMetadata {
  readonly project: Project
  readonly statuses: readonly WorkflowStatus[]
}

export interface IssueFilterMetadata {
  readonly projects: readonly IssueFilterProjectMetadata[]
}

export interface BoardProjectMetadata {
  readonly project: Project
  readonly statuses: readonly WorkflowStatus[]
}

export interface BoardMetadata {
  readonly projects: readonly BoardProjectMetadata[]
}

export interface IssueActivityData {
  readonly comments: readonly Comment[]
  readonly commentMentions: readonly CommentMention[]
  readonly activityEvents: readonly ActivityEvent[]
  readonly users: readonly User[]
  readonly mentionableUsers: readonly User[]
}

export interface IssueSubscriptionData {
  readonly issueId: IssueId
  readonly subscribers: readonly User[]
  readonly viewer: User
  readonly subscribed: boolean
}

export interface ProjectSubscriptionData {
  readonly projectId: ProjectId
  readonly subscribers: readonly User[]
  readonly viewer: User
  readonly subscribed: boolean
}

export interface SetProjectSubscriptionInput {
  readonly projectId: ProjectId
  readonly subscribed: boolean
  readonly expectedSubscribed: boolean
}

export interface SetIssueSubscriptionInput {
  readonly issueId: IssueId
  readonly subscribed: boolean
  readonly expectedSubscribed: boolean
}

export interface CreateCommentInput {
  readonly issueId: IssueId
  readonly body: string
  readonly mentionedUserIds?: readonly UserId[]
}

export interface UpdateCommentInput {
  readonly id: CommentId
  readonly expectedRevision: number
  readonly body: string
  /** Omit to preserve the active mention set for backwards-compatible clients. */
  readonly mentionedUserIds?: readonly UserId[]
}

export interface DeleteCommentInput {
  readonly id: CommentId
  readonly expectedRevision: number
}

export interface NotificationQuery {
  readonly workspaceId: WorkspaceId
  readonly category?: NotificationCategory
  readonly read?: boolean
  readonly page?: PageRequest
}

export interface NotificationInbox extends Page<Notification> {
  readonly unreadCount: number
  readonly readCount: number
  readonly matchingUnreadCount: number
  readonly categories: readonly AnalyticsBreakdown<NotificationCategory>[]
}

export interface MarkNotificationReadInput {
  readonly id: NotificationId
  readonly read: boolean
}

export interface UpdateNotificationsReadStateInput {
  readonly workspaceId: WorkspaceId
  readonly read: boolean
  readonly category?: NotificationCategory
  readonly currentRead?: boolean
  readonly ids?: readonly NotificationId[]
}

export interface UpdateNotificationPreferencesInput {
  readonly workspaceId: WorkspaceId
  readonly expectedRevision: number
  readonly assignments: boolean
  readonly comments: boolean
  readonly issueUpdates: boolean
  readonly projectUpdates: boolean
}

export interface AnalyticsBreakdown<TValue extends string> {
  readonly value: TValue
  readonly count: number
}

export interface ProjectHealthAggregate {
  readonly projectId: ProjectId
  readonly projectKey: string
  readonly projectName: string
  readonly totalIssues: number
  readonly openIssues: number
  readonly completedIssues: number
  readonly urgentOpenIssues: number
  readonly overdueIssues: number
  readonly completionPercent: number
}

export type AnalyticsRange = '30-days' | '90-days' | 'all-time'

export interface WorkspaceAnalyticsQuery {
  readonly workspaceId: WorkspaceId
  readonly range: AnalyticsRange
}

export interface IssueFlowTrendPoint {
  readonly periodStart: IsoDate
  readonly createdIssues: number
  readonly updatedIssues: number
}

export interface WorkspaceAnalytics {
  readonly generatedAt: IsoDateTime
  readonly range: AnalyticsRange
  readonly rangeStart: IsoDate
  readonly createdInRange: number
  readonly updatedInRange: number
  readonly issueFlow: readonly IssueFlowTrendPoint[]
  readonly activeProjects: number
  readonly totalIssues: number
  readonly openIssues: number
  readonly completedIssues: number
  readonly urgentOpenIssues: number
  readonly overdueIssues: number
  readonly unassignedOpenIssues: number
  readonly priorities: readonly AnalyticsBreakdown<IssuePriority>[]
  readonly statusCategories: readonly AnalyticsBreakdown<WorkflowStatus['category']>[]
  readonly projects: readonly ProjectHealthAggregate[]
}

export interface GovernanceQuery {
  readonly workspaceId: WorkspaceId
  readonly action?: string
  readonly outcome?: AuditEvent['outcome']
  readonly actor?: UserId | 'system'
  readonly entityId?: string
  readonly requestId?: string
  readonly occurredFrom?: IsoDateTime
  readonly occurredTo?: IsoDateTime
  readonly page?: PageRequest
}

export interface GovernanceAuditEntry {
  readonly event: AuditEvent
  readonly actorName: string
  readonly entityId: string | null
}

export interface GovernanceActorFacet {
  readonly value: UserId | 'system'
  readonly label: string
  readonly count: number
}

export interface GovernanceExportRow {
  readonly occurredAt: IsoDateTime
  readonly action: string
  readonly actor: string
  readonly outcome: AuditEvent['outcome']
  readonly entityId: string
  readonly requestId: string
}

export interface GovernanceReport {
  readonly generatedAt: IsoDateTime
  readonly totalEvents: number
  readonly succeededEvents: number
  readonly rejectedEvents: number
  readonly failedEvents: number
  readonly actions: readonly AnalyticsBreakdown<string>[]
  readonly actors: readonly GovernanceActorFacet[]
  readonly events: Page<GovernanceAuditEntry>
  readonly exportRows: readonly GovernanceExportRow[]
}

export interface AuthorizationSession {
  readonly user: User
  readonly workspaceMembership: Membership
  readonly projectMemberships: readonly ProjectMember[]
  readonly snapshotVersion: number
  readonly permissionFingerprint: string
}

export interface WorkspaceAdministrationQuery {
  readonly workspaceId: WorkspaceId
  readonly search?: string
  readonly roles?: readonly WorkspaceRole[]
  readonly statuses?: readonly MembershipStatus[]
  readonly page?: PageRequest
}

export interface WorkspaceMemberEntry {
  readonly membership: Membership
  readonly user: User
  readonly canEdit: boolean
  readonly allowedRoles: readonly WorkspaceRole[]
}

export interface WorkspaceAdministrationData {
  readonly members: Page<WorkspaceMemberEntry>
}

export interface UpdateWorkspaceMembershipInput {
  readonly id: MembershipId
  readonly expectedRevision: number
  readonly role: WorkspaceRole
  readonly status: MembershipStatus
}

export type WorkspaceInvitationEffectiveState =
  | WorkspaceInvitationState
  | 'expired'

export interface WorkspaceInvitationQuery {
  readonly workspaceId: WorkspaceId
  readonly search?: string
  readonly roles?: readonly WorkspaceInvitationRole[]
  readonly states?: readonly WorkspaceInvitationEffectiveState[]
  readonly page?: PageRequest
}

export interface WorkspaceInvitationEntry {
  readonly invitation: WorkspaceInvitation
  readonly effectiveState: WorkspaceInvitationEffectiveState
}

export interface WorkspaceInvitationAdministrationData {
  readonly invitations: Page<WorkspaceInvitationEntry>
}

export interface CreateWorkspaceInvitationInput {
  readonly workspaceId: WorkspaceId
  readonly email: string
  readonly role: WorkspaceInvitationRole
}

export interface ResendWorkspaceInvitationInput {
  readonly id: WorkspaceInvitationId
  readonly expectedRevision: number
}

export interface RevokeWorkspaceInvitationInput {
  readonly id: WorkspaceInvitationId
  readonly expectedRevision: number
}

export interface ActivateWorkspaceInvitationInput {
  readonly id: WorkspaceInvitationId
  readonly expectedRevision: number
  readonly displayName: string
}

export interface WorkspaceInvitationActivation {
  readonly invitation: WorkspaceInvitation
  readonly user: User
  readonly membership: Membership
}

export type MutableIssueFields = Pick<
  Issue,
  | 'assigneeId'
  | 'description'
  | 'dueDate'
  | 'labelIds'
  | 'parentIssueId'
  | 'priority'
  | 'statusId'
  | 'title'
  | 'type'
>

export interface UpdateIssueInput {
  readonly id: IssueId
  readonly expectedRevision: number
  readonly changes: Partial<MutableIssueFields>
}

export interface DeleteIssueInput {
  readonly id: IssueId
  readonly expectedRevision: number
}

export interface WorkspaceActivityGateway {
  getWorkspaceActivity(
    query: WorkspaceActivityQuery,
    options?: RequestOptions,
  ): Promise<WorkspaceActivityData>
}

export interface WorkspaceAdministrationGateway {
  getWorkspaceInvitations(
    query: WorkspaceInvitationQuery,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitationAdministrationData>
  createWorkspaceInvitation(
    input: CreateWorkspaceInvitationInput,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitation>
  resendWorkspaceInvitation(
    input: ResendWorkspaceInvitationInput,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitation>
  revokeWorkspaceInvitation(
    input: RevokeWorkspaceInvitationInput,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitation>
  activateWorkspaceInvitation(
    input: ActivateWorkspaceInvitationInput,
    options?: RequestOptions,
  ): Promise<WorkspaceInvitationActivation>
  getWorkspaceAdministration(
    query: WorkspaceAdministrationQuery,
    options?: RequestOptions,
  ): Promise<WorkspaceAdministrationData>
  updateWorkspaceMembership(
    input: UpdateWorkspaceMembershipInput,
    options?: RequestOptions,
  ): Promise<Membership>
}

export interface AuthorizationGateway {
  getAuthorizationSession(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<AuthorizationSession>
}

export interface ProjectGateway {
  listProjects(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<readonly Project[]>
  listProjectSummaries(
    query: ProjectSummaryQuery,
    options?: RequestOptions,
  ): Promise<Page<ProjectSummary>>
  getProjectEditMetadata(
    projectId: ProjectId,
    options?: RequestOptions,
  ): Promise<ProjectEditMetadata>
  getProjectMembershipAdministration(
    query: ProjectMembershipQuery,
    options?: RequestOptions,
  ): Promise<ProjectMembershipAdministrationData>
  addProjectMember(
    input: AddProjectMemberInput,
    options?: RequestOptions,
  ): Promise<Project>
  updateProjectMember(
    input: UpdateProjectMemberInput,
    options?: RequestOptions,
  ): Promise<Project>
  removeProjectMember(
    input: RemoveProjectMemberInput,
    options?: RequestOptions,
  ): Promise<Project>
  getProjectLeadTransfer(
    projectId: ProjectId,
    options?: RequestOptions,
  ): Promise<ProjectLeadTransferData>
  transferProjectLead(
    input: TransferProjectLeadInput,
    options?: RequestOptions,
  ): Promise<Project>
  getProjectWorkflowAdministration(
    projectId: ProjectId,
    options?: RequestOptions,
  ): Promise<ProjectWorkflowAdministrationData>
  updateProjectWorkflow(
    input: UpdateProjectWorkflowInput,
    options?: RequestOptions,
  ): Promise<Project>
  getProjectCreationMetadata(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<ProjectCreationMetadata>
  createProject(
    input: CreateProjectInput,
    options?: RequestOptions,
  ): Promise<Project>
  getProjectActivity(
    projectId: ProjectId,
    page?: PageRequest,
    options?: RequestOptions,
  ): Promise<ProjectActivityData>
  updateProject(
    input: UpdateProjectInput,
    options?: RequestOptions,
  ): Promise<Project>
  archiveProject(
    input: ArchiveProjectInput,
    options?: RequestOptions,
  ): Promise<Project>
}

export interface IssueRelationshipData {
  readonly issue: Issue
  readonly projectIssues: readonly Issue[]
  readonly relations: readonly IssueRelation[]
}

export interface CreateIssueRelationInput {
  readonly sourceIssueId: IssueId
  readonly targetIssueId: IssueId
  readonly type: IssueRelationType
  readonly expectedSourceRevision: number
  readonly expectedTargetRevision: number
}

export interface RemoveIssueRelationInput {
  readonly id: IssueRelationId
  readonly expectedSourceRevision: number
  readonly expectedTargetRevision: number
}

export interface IssueGateway {
  getIssueRelationships(id: IssueId, options?: RequestOptions): Promise<IssueRelationshipData>
  createIssueRelation(input: CreateIssueRelationInput, options?: RequestOptions): Promise<IssueRelation>
  removeIssueRelation(input: RemoveIssueRelationInput, options?: RequestOptions): Promise<void>
  listIssues(query: IssueQuery, options?: RequestOptions): Promise<Page<Issue>>
  getIssue(id: IssueId, options?: RequestOptions): Promise<Issue>
  getIssueFilterMetadata(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<IssueFilterMetadata>
  getIssueCreationMetadata(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<IssueCreationMetadata>
  getBoardMetadata(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<BoardMetadata>
  createIssue(input: CreateIssueInput, options?: RequestOptions): Promise<Issue>
  updateIssue(input: UpdateIssueInput, options?: RequestOptions): Promise<Issue>
  deleteIssue(input: DeleteIssueInput, options?: RequestOptions): Promise<void>
}

export interface ReportingGateway {
  getWorkspaceAnalytics(
    query: WorkspaceAnalyticsQuery,
    options?: RequestOptions,
  ): Promise<WorkspaceAnalytics>
  getGovernanceReport(
    query: GovernanceQuery,
    options?: RequestOptions,
  ): Promise<GovernanceReport>
}

export interface CollaborationGateway {
  getProjectSubscription(
    projectId: ProjectId,
    options?: RequestOptions,
  ): Promise<ProjectSubscriptionData>
  setProjectSubscription(
    input: SetProjectSubscriptionInput,
    options?: RequestOptions,
  ): Promise<ProjectSubscriptionData>
  getIssueActivity(
    issueId: IssueId,
    options?: RequestOptions,
  ): Promise<IssueActivityData>
  getIssueSubscription(
    issueId: IssueId,
    options?: RequestOptions,
  ): Promise<IssueSubscriptionData>
  setIssueSubscription(
    input: SetIssueSubscriptionInput,
    options?: RequestOptions,
  ): Promise<IssueSubscriptionData>
  createComment(
    input: CreateCommentInput,
    options?: RequestOptions,
  ): Promise<Comment>
  updateComment(
    input: UpdateCommentInput,
    options?: RequestOptions,
  ): Promise<Comment>
  deleteComment(
    input: DeleteCommentInput,
    options?: RequestOptions,
  ): Promise<Comment>
}

export interface NotificationGateway {
  listNotifications(
    query: NotificationQuery,
    options?: RequestOptions,
  ): Promise<NotificationInbox>
  markNotificationRead(
    input: MarkNotificationReadInput,
    options?: RequestOptions,
  ): Promise<Notification>
  updateNotificationsReadState(
    input: UpdateNotificationsReadStateInput,
    options?: RequestOptions,
  ): Promise<number>
  getNotificationPreferences(
    workspaceId: WorkspaceId,
    options?: RequestOptions,
  ): Promise<NotificationPreferences>
  updateNotificationPreferences(
    input: UpdateNotificationPreferencesInput,
    options?: RequestOptions,
  ): Promise<NotificationPreferences>
}

export interface AtlasGateway
  extends AuthorizationGateway,
    CollaborationGateway,
    IssueGateway,
    NotificationGateway,
    ProjectGateway,
    ReportingGateway,
    WorkspaceActivityGateway,
    WorkspaceAdministrationGateway {}
