# Current domain/data verification

See [recovery and persistence](TASKORA_RECOVERY_AND_PERSISTENCE.md) for guarantees and the complete new regression scope. Final verification: 431 tests in 59 files and 31 Chromium journeys.

Targeted pre-commit gates: schema/store/membership 31 tests; recovery/gateway/store/IDs 111; backup UI/Settings 6; persistence/store/gateway 100; browser startup/recovery/Settings 11; final integrity/store/recovery/lifecycle 36. TypeScript and applicable ESLint passed before each corresponding commit. The full milestone runs verify compatibility with existing features.

The reference-boundary changes intentionally preserve suspended members' existing assignments and historical events for deleted entities. They reject live nonmember assignees/notification recipients/preference owners, duplicate labels and cross-workspace live activity targets. No blocker-completion policy was imposed.

## Historical relationship regression evidence

# Taskora domain and data test report

Verified on Node 20.19.5 / npm 10.8.2 on Windows. Final implementation snapshot: `2c11d656553a77855ec1767765aed6f099e342d9`.

| Milestone | Evidence |
| --- | --- |
| Preserved membership remediation | Full baseline: 49 files / 355 tests; lint/types pass. Existing evidence records four failing regression cases before its fix. This run revalidated the fixed tree. |
| Hierarchy and graph traversal | New before-fix run: 3 failed / 1 passed. Fixed targeted domain/store/hierarchy run: 40 tests passed. |
| Relationship gateway | New relationship suite: 15 tests; together with existing gateway suite: 79 passed. |
| Relationship UI | 6 new rendered interaction tests; together with existing issue-detail suite: 24 passed. |
| Full final coverage suite | 52 files / 380 tests passed; thresholds unchanged. |
| Full Chromium suite | 25 passed, including 24 established journeys and one cross-issue relationship/hierarchy journey. |

## Confirmed regression cases

Self-parenting and two-node parent cycles were accepted before the hierarchy fix. Invalid cyclic commits now retain the same snapshot identity and version. A 15,000-node blocking chain previously caused a RangeError; iterative validation now accepts it and still rejects a back edge.

## New capability cases

All three link types; reads from both endpoints; remove and revision advancement; two activity events and one audit event; stale source/target writes; duplicate symmetric links; cycles; self and foreign-project links; missing entities; malformed type; stale/missing removal; concurrent writes; viewers; archived projects; permission revocation during the transport wait; pre-aborted requests; simulated failure; and reconstructed gateway ID allocation.

UI tests cover add/remove, parent set/clear, explicit stale-write recovery, read-only controls, failed-read recovery and failed-mutation preservation. The Chromium journey follows a duplicate link to the opposite issue, removes it there, and changes/clears a parent through real routes.

## Failures retained

- Initial hierarchy fixture lint/type issues were corrected. Commit a956a03 was mistakenly created before lint succeeded and contains a redundant guard; its verification body was premature. Corrective commit f7b3110 retains the history and passes lint, types and 40 targeted tests.
- New gateway tests exposed colliding activity IDs after reconstructing a gateway. The final implementation checks relation, activity and audit IDs against stored records. The archived-project test was aligned with the existing conflict error contract.
- First Chromium run: the new test's exact label locator did not match the nested select's label text. All 24 existing tests passed. Selecting the observed accessible combobox role fixed the test; the complete 25-test rerun passed without retries.

Raw logs, failed-attempt receipts and the check runner remain outside Git in the local engineering evidence directory. No tests were disabled, no coverage thresholds reduced, and no source files excluded from coverage.
