import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { useAppServices } from '../../app/providers/app-services-context'
import { atlasQueryKeys } from '../../app/query/keys'
import { toIssueQuery, type IssueWorkspaceState } from './issue-workspace-state'
import type { CreateIssueInput, IssueGateway, MutableIssueFields } from '../../data'
import type { Issue } from '../../domain'
import type { IssuePageSize } from '../../preferences/types'
import { cancelIssueDerivedReads, reconcileIssueCaches } from '../../app/query/issue-cache'

export function useIssueWorkspaceData(
  state: IssueWorkspaceState,
  pageSize: IssuePageSize,
) {
  const { gateway, workspaceId } = useAppServices()
  const query = toIssueQuery(workspaceId, state, pageSize)
  const filterMetadata = useQuery({
    queryKey: atlasQueryKeys.issueFilterMetadata(workspaceId),
    queryFn: ({ signal }) => gateway.getIssueFilterMetadata(workspaceId, { signal }),
  })
  const issues = useQuery({
    queryKey: atlasQueryKeys.issues(workspaceId, query),
    queryFn: ({ signal }) => gateway.listIssues(query, { signal }),
    placeholderData: keepPreviousData,
  })

  return { issues, filterMetadata }
}

export function useIssueCreationMetadata(enabled: boolean) {
  const { gateway, workspaceId } = useAppServices()

  return useQuery({
    queryKey: atlasQueryKeys.issueCreationMetadata(workspaceId),
    queryFn: ({ signal }) =>
      gateway.getIssueCreationMetadata(workspaceId, { signal }),
    enabled,
  })
}

export function useCreateIssue() {
  const { gateway, workspaceId } = useAppServices()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateIssueInput) => gateway.createIssue(input),
    onMutate: async () => {
      await cancelIssueDerivedReads(queryClient, workspaceId)
    },
    onSuccess: (issue) => {
      reconcileIssueCaches(queryClient, workspaceId, issue)
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: atlasQueryKeys.workspaceIssues(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: atlasQueryKeys.notificationInbox(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: atlasQueryKeys.analytics(workspaceId),
        }),
      ])
    },
  })
}

export interface BulkIssueUpdateResult {
  readonly updated: readonly Issue[]
  readonly failed: readonly BulkIssueUpdateFailure[]
}

export interface BulkIssueUpdateFailure {
  readonly issue: Issue
  readonly message: string
}

type BulkIssueChanges = Partial<Pick<MutableIssueFields, 'priority' | 'statusId'>>

export function useBulkUpdateIssues() {
  const { gateway, workspaceId } = useAppServices()
  const queryClient = useQueryClient()

  return useMutation({
    scope: { id: `bulk-issue:${workspaceId}` },
    mutationFn: ({
      issues,
      changes,
    }: {
      issues: readonly Issue[]
      changes: BulkIssueChanges
    }) => updateIssues(gateway, issues, changes),
    onMutate: async () => {
      await cancelIssueDerivedReads(queryClient, workspaceId)
    },
    onSuccess: (result) => {
      for (const issue of result.updated) {
        reconcileIssueCaches(queryClient, workspaceId, issue)
      }
      for (const failure of result.failed) {
        reconcileIssueCaches(queryClient, workspaceId, failure.issue)
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: atlasQueryKeys.workspaceIssues(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: atlasQueryKeys.notificationInbox(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: atlasQueryKeys.analytics(workspaceId),
        }),
      ])
    },
  })
}

export async function updateIssues(
  gateway: Pick<IssueGateway, 'getIssue' | 'updateIssue'>,
  issues: readonly Issue[],
  changes: BulkIssueChanges,
): Promise<BulkIssueUpdateResult> {
  const outcomes = await Promise.all(
    issues.map(async (issue) => {
      try {
        const updated = await gateway.updateIssue({
          id: issue.id,
          expectedRevision: issue.revision,
          changes,
        })
        return { status: 'updated' as const, issue: updated }
      } catch (error) {
        let currentIssue = issue

        try {
          currentIssue = await gateway.getIssue(issue.id)
        } catch {
          // Retain the submitted snapshot when recovery data is unavailable.
        }

        return {
          status: 'failed' as const,
          issue: currentIssue,
          message: error instanceof Error ? error.message : 'The update failed.',
        }
      }
    }),
  )

  return {
    updated: outcomes.flatMap((outcome) =>
      outcome.status === 'updated' ? [outcome.issue] : [],
    ),
    failed: outcomes.flatMap((outcome) =>
      outcome.status === 'failed'
        ? [{ issue: outcome.issue, message: outcome.message }]
        : [],
    ),
  }
}
