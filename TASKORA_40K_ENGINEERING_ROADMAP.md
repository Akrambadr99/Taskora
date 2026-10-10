# Taskora engineering roadmap

This is the first core expansion increment after the 10 October 2026 remediation. The 40,000 inclusive first-party SLOC milestone remains open; it is not a release gate or a reason to add code. The measured implementation is 32,191 SLOC, an increase of 731 over the verified remediation tree.

## Assessment and completed sequence

1. Preserve and review staged README, membership integrity, dependency updates, test synchronization and version-specific notices. Committed separately using the owner's authorized Akrambadr99 identity.
2. Reproduce and fix invalid parent hierarchies and recursive blocking-graph overflow. Preserve existing same-project relationship semantics and workflow invariants.
3. Expose relationship reads and revision-checked mutations through the established asynchronous gateway; atomically maintain both endpoint revisions and history.
4. Integrate dependency and parent editing into issue details, including incoming links, error recovery, read-only controls and cache invalidation.
5. Validate existing and new application journeys; document counts, attribution and limitations.

## Existing capabilities retained

Project lifecycle, leadership transfer, membership administration, workflow status configuration/migration, bulk issue actions, board movement, comments, subscriptions, notification preferences, saved views, workspace administration and governance already exist. This increment does not rebuild those surfaces or introduce a competing domain model.

## Subsequent substantive milestones

- **Validated backup/recovery:** define a versioned runtime schema for all snapshot collections; reject unknown versions, malformed references and cyclic graphs before replacement. Add export preview, import validation, explicit replacement confirmation, atomic rollback and current-session reauthorization. Do not cast arbitrary JSON into AtlasDataSnapshot.
- **Durable local persistence:** choose storage limits, multi-tab conflict policy and migrations after the recovery contract is tested. Separate preferences from authoritative data. Never treat local role checks as server security, silently replace corrupt data with fixtures, or claim browser storage is a multi-user backend.
- **Workflow transition policy:** current workflows configure statuses and migrations, not a transition-guard engine. Define guards and blocked-completion behavior as product rules before enforcing them across board, detail and bulk actions.
- **Project dependency health:** use the relationship graph for actionable blockers and project health only after defining whether canceled work satisfies prerequisites and whether cross-project relationships should be supported. Current links are advisory and same-project only.
- **Runtime maintenance:** migrate the existing Node 20 contract with a fresh locked install, notice update and complete verification in a separate change.

## Milestone boundary

The completed dependency-management increment is coherent below 40K. Padding its graph algorithms, tests or JSX would make it worse. Persistence and workflow enforcement are separate product changes with unresolved policy decisions, so they are explicitly future work rather than unfinished controls in this release. No claim is made that the complete 40K roadmap has been delivered. New implementation is AI-generated; more code cannot establish predominantly human authorship.
