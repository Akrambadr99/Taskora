# Taskora engineering roadmap

Current measured first-party candidate source: **34,011 SLOC**, up 1,820 from the verified 32,191 baseline. The 40K planning target remains open; it is not a reason to pad implementations or tests.

## Completed milestones

- Original core milestone: iterative hierarchy validation and issue relationship management, preserved without repeating or rewriting its commits.
- A: versioned workspace exports, exhaustive runtime field validation, graph/reference validation, preview, authorization checks, typed confirmation, stale/expired token handling, atomic recovery and accessible Settings integration. Verified at 33,115 SLOC with 412 tests and 27 Chromium journeys.
- B: bounded browser persistence, versioned schema migration, accidental-corruption checks, save-before-publish transactions, Web Locks, cross-tab synchronization, startup recovery and real browser restart tests. Verified at 33,630 SLOC with 426 tests and 31 Chromium journeys.
- C: nonmember assignment/recipient/preference rejection, duplicate-label rejection, cross-workspace live activity protection, and a regression proving restart retains a demoted actor's identity. Final 33,704 SLOC with 431 tests and 31 Chromium journeys.
- Workflow transition increment: unfinished blockers now prevent completion, reopening a required blocker, adding invalid links, and unsafe workflow category changes. Board, detail, and same-project bulk status controls use the same gateway rule with error recovery. The current measured source is 34,011 SLOC; see [workflow transitions](TASKORA_WORKFLOW_TRANSITIONS.md) for the exact policy and bulk semantics.
- Portable source measurement: `scripts/count-source.py` reproduces the unchanged baseline counting rules and records every counted file's hash.

## Evaluated and deferred

Workflow configuration, project lifecycle, comments, subscriptions, memberships and governance already exist. No parallel architecture was added. Canceled prerequisites are conservatively unresolved and there is no override. Cross-project dependency health still requires an explicit cross-project relationship policy; no such links were introduced merely to increase code volume.

Future separately scoped work includes server-backed authentication/storage, larger-scale IndexedDB or server persistence if measured workloads justify it, additional browser/accessibility qualification, and a supported Node runtime migration with fresh dependency/license verification.

The justified backup, local durability, integrity and workflow increments remain below 40K. Remaining planning gap: 5,989 SLOC. New code is AI-generated/assisted and is attributed accordingly; source size and professional Git history do not establish human authorship percentages.
