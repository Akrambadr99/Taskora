import type {
  AnalyticsRange,
  GovernanceQuery,
  IssueQuery,
  ProjectSummaryQuery,
  WorkspaceInvitationQuery,
  WorkspaceActivityQuery,
} from '../../data'
import type { IssueId, NotificationCategory, ProjectId, WorkspaceId } from '../../domain'

export const atlasQueryKeys = {
  workspaceActivityReports: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'activity'] as const,
  workspaceActivity: (query: WorkspaceActivityQuery) =>
    [...atlasQueryKeys.workspaceActivityReports(query.workspaceId), query] as const,
  authorization: (workspaceId: WorkspaceId) =>
    ['authorization', workspaceId] as const,
  analytics: (workspaceId: WorkspaceId, range?: AnalyticsRange) =>
    range
      ? ['workspaces', workspaceId, 'analytics', range] as const
      : ['workspaces', workspaceId, 'analytics'] as const,
  administration: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'administration'] as const,
  workspaceInvitations: (query: WorkspaceInvitationQuery) =>
    [...atlasQueryKeys.administration(query.workspaceId), 'invitations', query] as const,
  governanceReports: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'governance'] as const,
  governance: (query: GovernanceQuery) =>
    [...atlasQueryKeys.governanceReports(query.workspaceId), query] as const,
  globalSearch: (workspaceId: WorkspaceId, search: string) =>
    ['workspaces', workspaceId, 'search', search] as const,
  boardMetadata: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'board', 'metadata'] as const,
  boardIssues: (workspaceId: WorkspaceId, projectId: ProjectId) =>
    ['workspaces', workspaceId, 'issues', 'board', projectId] as const,
  workspaceIssues: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'issues'] as const,
  issueFilterMetadata: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'issues', 'filter-metadata'] as const,
  projects: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'projects'] as const,
  project: (workspaceId: WorkspaceId, projectId: ProjectId) =>
    [...atlasQueryKeys.projects(workspaceId), 'detail', projectId] as const,
  projectMembers: (workspaceId: WorkspaceId, projectId: ProjectId) =>
    [...atlasQueryKeys.project(workspaceId, projectId), 'members'] as const,
  projectLeadTransfer: (workspaceId: WorkspaceId, projectId: ProjectId) =>
    [...atlasQueryKeys.project(workspaceId, projectId), 'lead-transfer'] as const,
  projectWorkflow: (workspaceId: WorkspaceId, projectId: ProjectId) =>
    [...atlasQueryKeys.project(workspaceId, projectId), 'workflow'] as const,
  projectActivity: (workspaceId: WorkspaceId, projectId: ProjectId) =>
    [...atlasQueryKeys.project(workspaceId, projectId), 'activity'] as const,
  projectSubscription: (workspaceId: WorkspaceId, projectId: ProjectId) =>
    [...atlasQueryKeys.project(workspaceId, projectId), 'subscription'] as const,
  projectSummaries: (query: ProjectSummaryQuery) =>
    [...atlasQueryKeys.projects(query.workspaceId), 'summaries', query] as const,
  dashboardIssues: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'issues', 'dashboard'] as const,
  issues: (workspaceId: WorkspaceId, query: IssueQuery) =>
    ['workspaces', workspaceId, 'issues', 'index', query] as const,
  issue: (workspaceId: WorkspaceId, issueId: IssueId) =>
    ['workspaces', workspaceId, 'issues', 'detail', issueId] as const,
  issueCreationMetadata: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'issues', 'creation-metadata'] as const,
  issueActivity: (workspaceId: WorkspaceId, issueId: IssueId) =>
    ['workspaces', workspaceId, 'issues', 'detail', issueId, 'activity'] as const,
  issueRelationships: (workspaceId: WorkspaceId, issueId: IssueId) =>
    [...atlasQueryKeys.issue(workspaceId, issueId), 'relationships'] as const,
  issueSubscription: (workspaceId: WorkspaceId, issueId: IssueId) =>
    ['workspaces', workspaceId, 'issues', 'detail', issueId, 'subscription'] as const,
  notifications: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'notifications'] as const,
  notificationInbox: (
    workspaceId: WorkspaceId,
    category?: NotificationCategory,
    read?: boolean,
  ) => category !== undefined || read !== undefined
    ? [...atlasQueryKeys.notifications(workspaceId), 'inbox', {
        ...(category ? { category } : {}),
        ...(read !== undefined ? { read } : {}),
      }] as const
    : [...atlasQueryKeys.notifications(workspaceId), 'inbox'] as const,
  notificationPreferences: (workspaceId: WorkspaceId) =>
    ['workspaces', workspaceId, 'notifications', 'preferences'] as const,
}
