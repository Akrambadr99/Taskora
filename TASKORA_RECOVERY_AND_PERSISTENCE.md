# Workspace recovery and browser persistence

Implemented on 10 October 2026. This is a browser-local application, not a hosted multi-user database or server authentication system.

## Backup and recovery

Settings exposes a JSON download and file import, a collection-by-collection preview, and confirmation by typing the current workspace name. Owner/admin access is checked again by the gateway at execution. Preview does not write workspace data. Cancel and Escape preserve state and return focus to the preview trigger.

The archive envelope is `{format: "taskora.workspace", schemaVersion: 1, workspaceId, exportedAt, sourceVersion, data}`. Files are limited to 10 MiB of UTF-8. Unknown fields, missing fields, unsupported versions, invalid domain IDs/enums/dates and invalid references are rejected before replacement. The decoder checks the existing snapshot invariants, including project/workspace memberships, workflow states, issue parent and blocking cycles, subscriptions and notification targets. Imports contain exactly one named workspace. There is no implicit migration of unknown archive versions.

A gateway retains one validated candidate, bound to the actor's gateway instance, workspace, current global store version and a ten-minute expiry. Any intervening store write, even in another workspace, invalidates confirmation. The caller supplies the preview token and exact current workspace name; caller-supplied replacement data is not accepted at confirmation. Permission is rechecked, the current actor must retain their active role, at least one active owner must remain, and admins cannot alter owner memberships.

Replacement is scoped to the chosen workspace. Existing shared user profiles and current audit events win over imported records with the same ID; new referenced users and missing audit entries may be added. Other workspace records are preserved. The preview reflects that merge policy. Historical activity may reference deleted entities, while existing live targets must belong to the event workspace.

Restored revision-bearing entities advance above the maximum current/imported revision. Requests already waiting across a restore fail instead of applying stale intent. All mutation paths reserve existing IDs before allocation, including after tab synchronization. Recovery adds one audit event and commits the complete validated snapshot atomically. A failed validation, stale preview, denied permission, cancellation before execution, or failed durable write leaves the attempted replacement unpublished. This is atomic publication rather than an undo log. To undo a successful recovery, import a previously downloaded backup.

## Durable local data

The browser entry stores the whole authoritative snapshot in the single `taskora:workspace` localStorage key. Personal preferences keep their separate existing repository. The store remains usable without persistence in tests and explicitly supplied in-memory services.

Gateway execution waits for transport simulation, acquires the origin-scoped Web Lock named `taskora:workspace`, loads and validates the latest saved snapshot, checks cancellation/recovery epoch and current authorization/revisions, and performs the operation. The store validates and clones/freezes the candidate, serializes and saves it, then publishes the new in-memory state. Native localStorage replaces one key atomically; quota or access errors leave the previous saved value and the attempted in-memory mutation unchanged. Direct persistent commits outside the transaction are rejected. No network request or UI confirmation is held inside the storage lock.

Schema v2 stores `{format: "taskora.local", schemaVersion: 2, version, recoveryEpoch, data, checksum}`. A fully validated v1 compatibility envelope containing format, schemaVersion, version and data migrates under the same lock without changing content/version; it gains recoveryEpoch 0 and a checksum. This is a tested compatibility contract, not a claim that a v1 persistence release was previously published. Unknown future schemas are preserved and rejected.

The checksum detects accidental corruption; it is not a signature or protection against scripts or people controlling the browser. Version and recovery epoch survive restarts. Raw-value comparison protects against intervening saves, and entity revisions reject stale editors. Storage events and focus/visibility resumption synchronize the store and refresh active queries. Browser locks are required; unsupported browsers receive an explicit error instead of an unsafe concurrent-write fallback.

## Recovery from storage failure

Malformed or unsupported saved data is retained. The recovery screen offers a diagnostic download and retry. Reset requires typing RESET; it compares the saved bytes again under the lock before atomically replacing them with starter data and a fresh revision range. Export the damaged data first if it may be needed. After reset, a valid workspace archive can be imported in Settings. Reset does not reconstruct missing edits and does not clear personal preference keys. Existing tabs with incompatible older state must refresh.

The 10 MiB application bound does not guarantee browser quota availability. Storage can be cleared or evicted by the browser/user, so export backups independently. Large snapshot serialization is synchronous; this bounded local design is not a substitute for IndexedDB/server storage at production scale. Only Chromium lifecycle behavior has been verified. No encryption, remote synchronization, server authorization, or crash-durable database guarantee is claimed.

## Verification

The final run passes 431 Vitest tests across 59 files, 31 Chromium journeys, TypeScript, ESLint, coverage gates, production build and npm audit. Coverage: statements 89.63%, branches 81.67%, functions 90.80%, lines 92.13%.

Regressions include malformed/oversized/future-version archives; field completeness; missing references; graph cycles; stale/expired/replaced previews; exact confirmation; role revocation/escalation; atomic failure/cancellation; shared-profile and unrelated-workspace preservation; quota rollback; v1 migration; checksum corruption; deleted storage; two-tab stale writes; preserved actor identity; a real Chromium persistent-profile browser restart; live tab updates; and confirmed corruption reset. A browser-discovered focus restoration failure was fixed before the recovery UI commit; its failed logs remain in the external evidence directory.
