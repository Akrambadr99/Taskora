# Taskora core architecture

## Preserved boundaries

React routing and pages live in `src/app`; feature modules own interactions and TanStack Query orchestration. `src/domain` holds identifiers, entity contracts and policy. `src/data` owns fixtures, immutable snapshots, the versioned store and the asynchronous gateway. ESLint enforces import boundaries. The browser entry now uses a versioned localStorage adapter and Web Locks around the same snapshot store; tests may still use in-memory stores. Preferences remain separate.

A mutation waits for the simulator, enters the store transaction, synchronizes persisted data, rechecks current permissions, validates the request and commits one complete snapshot. `InMemoryDataStore` validates and clones/freezes the proposed snapshot before replacement. Its monotonic version prevents stale snapshot commits. Issue revisions protect user drafts. Gateway errors are typed and cancellation is checked before mutation.

## Domain inventory

Workspace: users, workspace memberships and invitations. Projects: lifecycle, project memberships, leadership, subscriptions and workflow statuses. Issues: priority/type/status, labels, assignee, parent, revision, directed or symmetric relationships and subscriptions. Collaboration: comments, mentions, activity and audit events, notifications and preferences.

Workflow configuration and project lifecycle are established surfaces. Existing bulk mutations, optimistic rollback and authorization refresh remain intact. The new relationship editor deliberately waits for authoritative mutation results instead of optimistically displaying an unvalidated graph.

## Graph invariants

`assertIssueHierarchy` rejects missing parents, self-parenting, foreign project/workspace parents and cycles. It runs on every store construction and commit. Blocking relationships retain existing distinct-issue, same-project, unique-edge and cycle rules.

The shared iterative topological walk is O(V + E) in time and storage. It avoids recursive call-stack limits, including a tested 15,000-issue chain. Parent and blocking graphs are validated separately; hierarchy does not implicitly mean blocking.

## Relationship capability

`IssueGateway` exposes `getIssueRelationships`, `createIssueRelation`, and `removeIssueRelation`. Reads return the current issue, same-project issues and links touching that issue. Writes require current `issue:update` permission at both endpoints, an open project, and both expected issue revisions. Allowed types are blocks, relates-to and duplicates. Reversed relates-to links are duplicate symmetric relationships; blocking and duplicate directions remain meaningful.

One store commit adds/removes the link, advances both endpoint revisions and timestamps, emits activity for both issues and one audit event with endpoint IDs and revisions. Invalid graphs, stale revisions, denied access, simulated failures and cancellation leave the authoritative snapshot unchanged. Relation/activity/audit identifiers avoid collisions if a gateway is reconstructed against an existing store.

## Frontend integration

The issue detail route includes `IssueRelationshipsPanel`. Links show Blocks/Blocked by, Related to and Duplicates/Duplicated by with navigable target titles. Existing `updateIssue` handles parent selection and clearing through the same snapshot invariants. Forms use native labels, selects, fieldsets and buttons. Errors are announced and refresh is explicit.

Relationship query keys are beneath the workspace issue namespace. Mutations cancel stale issue reads and invalidate both endpoint views, issue lists, activity, governance and analytics. Forms disable during writes/refetches and remount when the issue revision or permission fingerprint changes. Backend checks remain authoritative even if browser controls are stale.

## Boundaries

No server authentication, hosted database, email delivery or remote collaboration service was added. Local permissions model intended behavior; a browser owner can inspect or alter browser state. Dependencies remain advisory; cross-project links and transition-guard policies are not implemented. Versioned workspace recovery and bounded browser persistence are now implemented. See [recovery and persistence](TASKORA_RECOVERY_AND_PERSISTENCE.md) for contracts, transaction ordering and limitations.
