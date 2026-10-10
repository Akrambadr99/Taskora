# Taskora source LOC

Counter: cloc 2.10, code lines only, `--by-file --skip-uniqueness`. Sources are extracted from committed Git snapshots. The unchanged baseline scope is .ts/.tsx/.js/.mjs/.css/.html, excluding docs. Blank lines, comments, Markdown, JSON/lockfiles, dependencies, licenses, generated output, private evidence and the Python reporting tool are not counted. Eleven previously verified scaffold lines are subtracted: five in vite.config.ts and six in index.html.

| Milestone | Commit | Inclusive | No tests | No CSS/HTML | Application implementation |
| --- | --- | ---: | ---: | ---: | ---: |
| Original verified baseline | fcd3d14 | 32,191 | 22,089 | 29,116 | 18,867 |
| A: backup/recovery UI | 1ccbdd5 | 33,115 | 22,705 | 30,035 | 19,478 |
| B: durable browser lifecycle | eb9656e | 33,630 | 22,970 | 30,550 | 19,743 |
| C: live reference boundaries | b1f20bd | 33,704 | 22,983 | 30,624 | 19,756 |

| Category | Final candidate SLOC |
| --- | ---: |
| Domain/core | 685 |
| Data/gateway including fixtures | 7,391 |
| Frontend/services/preferences | 11,680 |
| Tests and test infrastructure | 10,721 |
| CSS/HTML | 3,080 |
| Build/lint tooling | 147 |
| Inclusive | 33,704 |
| Application implementation rollup | 19,756 |

Raw code: 33,715; scaffold exclusion: 11. Net increase from baseline: 1,513 inclusive lines, including 889 application implementation, 619 tests and 5 styles. This is a net source delta, not a human-authorship measurement. The 40K gap is 6,296 lines; no filler was added to close it.

Reproduce with Python 3.9+ and cloc 2.10:

```sh
python scripts/count-source.py HEAD --cloc cloc --output /path/outside/repo/source-loc.json
```

For a Perl cloc script, pass `--cloc /absolute/path/cloc.pl --perl /path/to/perl`. The ledger records the exact revision, command, category, scaffold exclusions and SHA-256 for every counted file. The portable counter was executed on both the original fcd3d14 baseline (32,191) and the final source implementation (33,704). Subsequent Python/documentation-only commits do not affect this counting scope.

These are candidate first-party source counts; they do not establish exclusive human authorship, ownership rights or rustLabs acceptance.
