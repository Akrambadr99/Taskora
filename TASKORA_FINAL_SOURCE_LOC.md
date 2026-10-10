# Taskora final source LOC

Counter: cloc 2.10, code lines only, `--by-file --skip-uniqueness`. Counts are from committed snapshots, not accumulated historical additions. Blank lines, comments, Markdown, notices, JSON/lockfiles, dependencies, bundles, coverage, browser artifacts and private evidence are excluded. Eleven verified create-vite scaffold lines are subtracted (five in vite.config.ts and six in index.html).

| Milestone | Inclusive | No tests | No CSS/HTML | Application implementation |
| --- | ---: | ---: | ---: | ---: |
| Prepared remediation (1550b21) | 31,460 | 21,714 | 28,421 | 18,528 |
| Corrected hierarchy core (f7b3110) | 31,540 | 21,731 | 28,501 | 18,545 |
| Relationship gateway (50b30b9) | 31,825 | 21,854 | 28,786 | 18,668 |
| Integrated dependency UI (2c11d65) | 32,191 | 22,089 | 29,116 | 18,867 |

Final component totals (disjoint, except the application rollup):

| Category | Candidate SLOC |
| --- | ---: |
| Domain/core | 685 |
| Data/gateway, including deterministic fixtures | 6,735 |
| Frontend, application services and preferences | 11,447 |
| Application implementation rollup | 18,867 |
| Tests and test infrastructure | 10,102 |
| CSS/HTML after scaffold exclusion | 3,075 |
| Build/lint tooling after scaffold exclusion | 147 |
| Inclusive | 32,191 |
| Excluding tests | 22,089 |
| Excluding CSS/HTML | 29,116 |

The raw source total is 32,202; subtracting 11 gives 32,191. Growth from the remediation is +731 inclusive, +339 application implementation, +356 test and +36 style lines. No exact duplicate source modules were introduced; no vendored/license text contributes to source totals.

Reproduction: `python C:/Users/Lenovo/Documents/Taskora_engineering_evidence_20261010/count_source.py <commit>` archives that commit into a new isolated evidence directory, enumerates source extensions and runs cloc. The script records its cloc command, category, scaffold exclusion and SHA-256 for every counted file in loc-<commit>.json. It does not execute application source or modify Git. Git's committed snapshots use canonical line endings; text hashes may differ from a CRLF worktree without changing counts.

40K has not been achieved. This report measures candidate first-party source, not original human contribution, license ownership, or rustLabs' private counting policy.
