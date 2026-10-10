# Taskora

Taskora, originally developed as **Atlas Ops**, is a React and TypeScript
application for managing projects, issues, collaboration and workspace
operations. It implements a browser-based interface, domain policies and a typed
asynchronous gateway backed by a versioned in-memory data store.

The application runs locally with deterministic seed data. It does not require
a database, API credentials or an external application service. Dependency and
browser installation require access to their distribution services.

Some UI labels, TypeScript identifiers, preference-storage keys and the npm
package name still use `Atlas Ops` or `atlas-ops`. These reflect the project's
original implementation; this README uses its current name, Taskora.

## Implemented features

- **Projects:** searchable portfolio, project detail routes, creation and editing,
  lifecycle changes, leadership transfer, membership administration and workflow
  configuration.
- **Issues:** URL-backed search and filters, sorting, pagination, configurable
  columns, cross-page selection, bulk actions, creation and editing. Mutations
  include validation, revision-conflict handling and optimistic rollback.
- **Board:** project Kanban with pointer and keyboard issue-move interactions.
- **Collaboration:** issue comments and moderation, mentions, watchers, project
  subscriptions and activity records within the in-memory application session.
- **Workspace operations:** membership lifecycle and invitation workflows,
  activity exploration, governance reporting and audit CSV export. Invitations
  are modeled locally; no email-delivery service is configured.
- **Navigation and reporting:** dashboard widgets, time-filtered analytics,
  global search, saved issue views, a command palette and keyboard shortcuts.
- **Notifications and preferences:** filtered inboxes, delivery preferences,
  optimistic updates and concurrent-mutation reconciliation. Browser preferences
  are stored separately from application data.

Routes are defined in [src/app/router.tsx](src/app/router.tsx). Gateway
capabilities are defined in
[src/data/gateway/contracts.ts](src/data/gateway/contracts.ts).

## Architecture

The main data flow is:

```text
React routes and feature components
  -> query/mutation hooks and TanStack Query cache
  -> typed AtlasGateway capabilities
  -> MockAtlasGateway and simulated requests
  -> validated, versioned InMemoryDataStore
```

| Location | Responsibility |
| --- | --- |
| `src/app` | Application services, providers, lazy-loaded routes, page composition and error boundaries |
| `src/features` | Feature interactions, query/mutation hooks and cache coordination |
| `src/domain` | Branded identifiers, entities, invariants, permission policies and lifecycle rules |
| `src/data` | Fixtures, clocks, generators, snapshots, store, gateway, request simulation, cancellation and tracing |
| `src/preferences` | Preference repository and browser/in-memory storage adapters |
| `src/components` | Shared interaction components, including dialogs and data tables |
| `src/test` | Shared Vitest setup and test helpers |
| `e2e` | Playwright application journeys |
| `scripts` | Production entry-bundle size check |

[ESLint rules](eslint.config.js) restrict React and application/feature imports
in the domain/data layers and restrict feature imports of datastore internals.
These are source-architecture checks, not a runtime security boundary.

### Data lifetime and authorization model

[createAppServices](src/app/services.ts) initializes the fixture workspace and
an actor, constructs the mock gateway and connects the preference repository.
The default actor comes from an active administrator membership in the fixtures.
There is no login service or server-verified identity in this implementation.

The [store](src/data/store.ts) clones and freezes snapshots, rejects stale
versions, and validates a proposed snapshot before replacing current data.
[Snapshot validation](src/data/snapshot-validation.ts) includes unique
project/user memberships and membership in the project's workspace.

Application data, including issues, memberships and activity records, lives in
memory and is recreated from fixtures on a full page reload. The browser entry
uses [BrowserPreferenceStorage](src/preferences/storage.ts) with `localStorage`
for preferences. This is not durable storage for the project/issue database.
The service factory also supports an in-memory preference adapter for tests.

Domain and gateway authorization checks model role and membership behavior.
They do not secure data against someone controlling the browser. A real
multi-user service would need authenticated server-side enforcement and a
persistent backend implementing the gateway contracts.

## Development environment

The repository currently declares:

- **Node.js:** `>=20.19 <21` in [package.json](package.json); `.nvmrc` selects
  `20.19`.
- **npm:** `10.8.2` in the `packageManager` field.
- **Recorded verification environment:** Windows, Node.js `20.19.5`, npm `10.8.2`.

Node.js 20 is now [end-of-life](https://nodejs.org/en/about/previous-releases).
These versions describe the reproducible existing contract, not a maintained
production runtime recommendation. Migrating to a supported LTS release and
rerunning the complete validation pipeline is a maintenance requirement.

From the repository root, check your runtime and install the locked dependencies:

```sh
node --version
npm --version
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local URL printed by Vite. The app starts with seeded workspace data;
no account setup or environment-variable file is required for this local mode.

To build and inspect the compiled application locally:

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

The build writes `dist/`. Vite preview is a local inspection tool; no hosted
production deployment is provided by these commands. A future static host must
serve the application entry for client-side routes.

## Validation

Install Playwright's Chromium browser before the E2E suite:

```sh
npx playwright install chromium
```

On Linux environments that need browser system dependencies, Playwright also
provides `npx playwright install --with-deps chromium`; installing system
packages may require administrator privileges.

Run the complete local checks:

```sh
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm run test:e2e
npm audit
```

`npm run check` is a convenience command for lint, unit/integration tests and
build. It does **not** include coverage, E2E or the dependency audit.
`npm run test:watch` starts Vitest watch mode.

[Playwright configuration](playwright.config.ts) runs the Chromium project and
starts its own Vite server at `http://127.0.0.1:4173`; keep that port free.
It does not reuse an existing server. With `CI` set, it uses one worker and up
to two retries. The recorded E2E run used this CI configuration locally.

[Vitest configuration](vitest.config.ts) uses jsdom and V8 coverage. Coverage
includes `src/**/*.{ts,tsx}`, excluding `src/main.tsx` and `src/test/**`, and
requires at least 80% for each of statements, branches, functions and lines.
HTML coverage output is written to `coverage/`.

The build also checks the emitted entry JavaScript against limits of **335 KiB
raw** and **105 KiB gzip** in
[scripts/check-entry-budget.mjs](scripts/check-entry-budget.mjs). These limits
cover the entry script, not the complete set of lazy-loaded assets.

### Recorded local verification — 10 October 2026

The following results apply to the local remediation candidate based on commit
`02ef05c956f691d1ee15ed6f5c7b4091bf071a34`, including its unpublished changes.
They are not results for the base commit alone or a claim of remote CI execution.
The README refresh did not change the tested implementation or dependencies.

| Check | Recorded result |
| --- | --- |
| Locked dependency installation | `npm ci` passed |
| ESLint and TypeScript | Passed |
| Vitest unit/integration suite | 49 files, 355 tests passed |
| Playwright Chromium | 24 tests passed |
| Production build and entry budget | Passed |
| npm dependency audit | Zero reported vulnerabilities at the time of the check |

| Coverage metric | Measured coverage |
| --- | ---: |
| Statements | 89.95% |
| Branches | 81.54% |
| Functions | 90.84% |
| Lines | 92.09% |

The remediation added five membership-integrity tests covering invalid seeds,
atomic rejection of invalid commits, and valid membership across projects.
Four regression cases failed before the validator fix and all five passed after
it. A coverage run also exposed a command-palette test synchronization issue;
the existing route assertion was moved into `waitFor`, after which the full
coverage suite passed. Compatible dependency updates addressed the audit
findings without a forced major upgrade.

These are dated local observations. Advisory databases change, and neither a
passing suite nor a zero-result dependency audit guarantees security or
correctness. Refresh the evidence when source, dependencies or runtime change.

## Limitations and maintenance

- Authoritative application data has no durable persistence, backup/recovery
  service or transactional workspace import/export workflow.
- Requests simulate asynchronous transport. The repository does not implement
  a remote API server, production authentication, email delivery or a shared
  multi-user database.
- Browser automation verification currently covers Chromium. It does not
  establish Firefox/WebKit compatibility, complete accessibility conformance
  or production-scale performance.
- Move the Node runtime contract to a supported LTS release with full
  compatibility validation; keep the package-manager and lockfile reproducible.
- Review dependency advisories and update the version-specific third-party
  inventory/notices when dependencies change.
- Preserve gateway contracts, snapshot validation, cancellation and conflict
  behavior when replacing the mock transport or adding persistence. Give new
  user-facing capabilities acceptance tests instead of adding code for size alone.

## Creator & Maintainer

Taskora's original creator, owner and maintainer is **Kemo Pop**, also known as
**Akram Bedr 99**. Both names identify the same person and project owner.

GitHub: [Akrambadr99](https://github.com/Akrambadr99)

## Development history and AI assistance

Taskora originated as Atlas Ops. The owner and original developer confirms
personally writing actual implementation code by hand during early development
in August 2026, beyond architecture, requirements, prompting or review.

AI coding assistants were used more extensively later for implementation,
features, fixes and refactoring, including the local remediation and this README
revision. Some earlier implementations may have been moved or modified by
assistants. An assistant applying or committing a change does not by itself
establish who originally wrote the retained code. No exact human/AI percentage
is claimed here, and source-range verification remains separate from the owner's
direct-coding declaration.

This README describes the implemented project and recorded verification; it
does not certify rustLabs eligibility or grant rights to submit/license the
codebase. Eligibility and licensing review use the separate evidence dossier.

## Third-party material and licensing

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the versioned
[dependency inventory](docs/third-party/inventory.json) for notices and their
provenance. The inventory covers 415 locked package entries, including optional
platform packages and explicit upstream notice references. Known create-vite
scaffold attribution is retained separately.

Third-party material remains subject to its respective licenses. These notices
do not apply a blanket license to Taskora or grant exclusive rights over its
dependencies. Any proposed codebase license requires a separate agreement and
appropriate third-party exclusions.
