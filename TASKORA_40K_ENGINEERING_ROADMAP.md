# Taskora engineering roadmap

Current measured first-party candidate source: **33,704 SLOC**, up 1,513 from the verified 32,191 baseline. The 40K planning target remains open; it is not a reason to pad implementations or tests.

## Completed milestones

- Original core milestone: iterative hierarchy validation and issue relationship management, preserved without repeating or rewriting its commits.
- A: versioned workspace exports, exhaustive runtime field validation, graph/reference validation, preview, authorization checks, typed confirmation, stale/expired token handling, atomic recovery and accessible Settings integration. Verified at 33,115 SLOC with 412 tests and 27 Chromium journeys.
- B: bounded browser persistence, versioned schema migration, accidental-corruption checks, save-before-publish transactions, Web Locks, cross-tab synchronization, startup recovery and real browser restart tests. Verified at 33,630 SLOC with 426 tests and 31 Chromium journeys.
- C: nonmember assignment/recipient/preference rejection, duplicate-label rejection, cross-workspace live activity protection, and a regression proving restart retains a demoted actor's identity. Final 33,704 SLOC with 431 tests and 31 Chromium journeys.
- Portable source measurement: `scripts/count-source.py` reproduces the unchanged baseline counting rules and records every counted file's hash.

## Evaluated and deferred

Workflow configuration, project lifecycle, bulk actions, board movement, comments, subscriptions, memberships and governance already exist. No parallel architecture was added. Completion blockers remain advisory: deciding whether canceled prerequisites count as satisfied, whether users may override blockers, and how guards apply to bulk operations requires a product policy. Cross-project dependency health also requires an explicit cross-project relationship policy. Those behaviors were not invented to increase code volume.

Future separately scoped work includes server-backed authentication/storage, larger-scale IndexedDB or server persistence if measured workloads justify it, additional browser/accessibility qualification, and a supported Node runtime migration with fresh dependency/license verification.

The justified backup, local durability and integrity scope is complete below 40K. Remaining gap: 6,296 SLOC. New code is AI-generated/assisted and is attributed accordingly; source size and professional Git history do not establish human authorship percentages.
