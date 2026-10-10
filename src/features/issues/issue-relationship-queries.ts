import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAppServices } from '../../app/providers/app-services-context'
import { atlasQueryKeys } from '../../app/query/keys'
import type { CreateIssueRelationInput, RemoveIssueRelationInput, UpdateIssueInput } from '../../data'
import type { IssueId } from '../../domain'

export type RelationshipChange =
  | { readonly kind: 'add'; readonly input: CreateIssueRelationInput }
  | { readonly kind: 'remove'; readonly input: RemoveIssueRelationInput }
  | { readonly kind: 'parent'; readonly input: UpdateIssueInput }

export function useIssueRelationships(issueId: IssueId) {
  const { gateway, workspaceId } = useAppServices()
  return useQuery({
    queryKey: atlasQueryKeys.issueRelationships(workspaceId, issueId),
    queryFn: ({ signal }) => gateway.getIssueRelationships(issueId, { signal }),
  })
}

export function useChangeIssueRelationships(issueId: IssueId) {
  const { gateway, workspaceId } = useAppServices()
  const client = useQueryClient()
  return useMutation({
    scope: { id: `issue:${issueId}` },
    mutationFn: async (change: RelationshipChange) => {
      switch (change.kind) {
        case 'add': await gateway.createIssueRelation(change.input); break
        case 'remove': await gateway.removeIssueRelation(change.input); break
        case 'parent': await gateway.updateIssue(change.input); break
      }
    },
    onMutate: async () => {
      await client.cancelQueries({ queryKey: atlasQueryKeys.workspaceIssues(workspaceId) })
    },
    onSettled: async () => {
      // Both endpoints advance revisions; refresh their detail/activity/relationship views together.
      await Promise.all([
        client.invalidateQueries({ queryKey: atlasQueryKeys.workspaceIssues(workspaceId) }),
        client.invalidateQueries({ queryKey: atlasQueryKeys.workspaceActivityReports(workspaceId) }),
        client.invalidateQueries({ queryKey: atlasQueryKeys.governanceReports(workspaceId) }),
        client.invalidateQueries({ queryKey: atlasQueryKeys.analytics(workspaceId) }),
      ])
    },
  })
}
