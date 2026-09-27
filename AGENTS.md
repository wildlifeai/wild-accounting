# Agent guide — Wildlife.ai accounting

**Google Apps Script** tooling that joins Wildlife.ai's budgets (Google Sheets in Drive) to its
actuals (Xero) so the GM, board, project leads and funders can each see the same numbers. The
flagship is the **Funding Cockpit** dashboard; alongside it sit quarterly-budget generation,
funding reports and chart-of-accounts helpers.

This repo is **not** the running system. Every script here executes as an Apps Script project in
the cloud, and those projects can be edited in the browser. Treating the repo as the sole source
of truth has already cost real work.

**Before changing any script, pushing to Apps Script, or touching Xero, read
[`.agents/skills/SKILL.md`](.agents/skills/SKILL.md)** — the invariants and the traps that have
actually bitten here. This file is only the quickstart.

## Setup and everyday commands

```bash
npm install -g @google/clasp        # v3+; commands renamed from v2 (open -> open-script)
clasp login                         # then enable the Apps Script API for your account:
                                    # https://script.google.com/home/usersettings
cd dashboard                        # one directory == one Apps Script project
clasp pull                          # ALWAYS pull and diff before you edit or push
clasp show-file-status              # dry run: exactly what push would upload
clasp push                          # replaces the remote project with local files
clasp open-script                   # open the IDE
clasp list-scripts                  # standalone projects only; bound scripts do not appear
```

Two checks, both offline. Run them before every push:

```bash
node tools/check_docs.js            # fails when the docs disagree with the code
node tools/run_tests.js             # runs dashboard/Tests.js headlessly
```

Both live in `tools/`, not `dashboard/`, because `.claspignore` is a whitelist: any `.js`
file under `dashboard/` is swept into the Apps Script project whether or not it belongs there.

`dashboard/Tests.js` holds `runTests()`: 195 checks over the forecast maths, budget and
forecast parsing, the health catalogue, serve-time staleness, which Xero statuses count
as actuals, funded runway, scoped access, and the funding pipeline. It runs
from the IDE with no Drive or Xero access, and `tools/run_tests.js` runs the same file under
Node. `runTests()` is the canonical copy.

`check_docs.js` is the one that stops documentation rotting: it verifies health-check ids
**and severities** match `HEALTH_CATALOGUE`, the file list is complete, GM_GUIDE's tab count
matches `Index.html`, every `Config.META` key is documented, no doc points at a missing file,
and nothing in the docs looks like a real figure, a personal email or a bank account. This is
a public repository, so that last group matters.

Both run in CI on every push and pull request, via `.github/workflows/checks.yml`, alongside
GitGuardian secret scanning.

## What belongs in this repository

**This repository is public, and it holds structure, not content.** Schema, code, checks,
and documentation about how the system works.

The content lives elsewhere: **`wildlife-ai-management`** and the Budgets Drive hold actual
budgets, funder terms, salary bands, and decisions about specific grants.

The line, stated so a machine can check it:

> A file here may **name** a funding source. It may never **state an amount**.

Names like `WW_25_TOI` are unavoidable, because they are the Xero tracking values the code
joins on, and funders announce their grants anyway. Amounts are the part that reveals what
a person is paid and what a funder agreed. Every example figure in this repository is
invented and round; if you need to write one, round it, or append `INVENTED-OK` to the line.

That applies to **commit messages too**, which is the easiest place to leak and the most
expensive to clean up: removing a figure from a merged commit means rewriting shared
history. Three mechanisms enforce it, in increasing order of how hard they are to bypass:

```bash
git config core.hooksPath .githooks   # enable the hooks, once per clone
```

| | Runs | Catches |
|---|---|---|
| `.githooks/pre-commit` | before each commit | stale docs, content in files |
| `.githooks/commit-msg` | as a message is written | content in that message |
| `.github/workflows/checks.yml` | every push and PR | both, across the whole branch, and cannot be skipped with `--no-verify` |

All three call the same scanner, [`tools/sensitive.js`](tools/sensitive.js), so there is one
rule rather than three that drift.

## Non-negotiables

- **`clasp push` replaces the remote project.** Files absent locally are deleted there. Never
  push without pulling and diffing first — on 2026-08-11 the deployed dashboard was ~1,030 lines
  ahead of the repo, including a whole permissions layer, and a blind push would have erased it.
  See SKILL.md §1, Deployment Invariant.
- **Never fetch code at runtime and execute it.** No `eval`, no `new Function` over a fetched
  string, no "loader" scripts. Code lives in the project and is deployed with clasp; secrets live
  in **Script Properties**, never in source. SKILL.md §1, No Remote Code Loading.
- **Verify AI review suggestions against the data before applying them.** A reviewer bot on PR #6
  asked for project abbreviations that matched neither the README nor the real Drive files;
  applying it would have decoupled generated budgets from live funding sources.
- **`.gitattributes` pins LF** (`* text=auto eol=lf`, added 2026-08-11). Before it, clasp wrote LF
  while a Windows checkout was CRLF, so whole files appeared modified with no content change. Use
  `git diff --ignore-cr-at-eol` and never commit a line-endings-only diff.
- **Apps Script has one global scope per project.** Private helpers take a trailing underscore;
  only real entry points stay bare. SKILL.md §1, Global Scope Invariant.
- **Money changes need a human.** Anything altering published actuals, budgets, or what a funder
  is told is reviewed before it ships — say what will move and by how much.
- **Victor approves every commit and push.** Prepare the change, show the diffstat, then ask.

## Where things are

| | |
|---|---|
| Deep guide | [`.agents/skills/SKILL.md`](.agents/skills/SKILL.md) |
| Funding Cockpit dashboard | [`dashboard/`](dashboard/) — `README.md`, `GM_GUIDE.md`, `BUDGET_PROCEDURES_ADDENDUM.md` |
| `PROJECT_overview` sheet aggregator | [`project_reports/`](project_reports/) — predates the cockpit and overlaps requirement 10. Quarterly budget generation was retired 2026-08-11 |
| Chart-of-accounts helpers | `general_valid_accounts.js`, `variance_funding_source.js` (root) |
| Account-keyed budget/overhead logic | `create_xero_budget_project.js` (root) |
| Budgets (the actual data) | Google Drive `Budgets` folder — id `10105co6S5qHFSVVg0pb0fkoPidN3ScJZ` |

## Apps Script projects

| Project | Script ID | Kind |
|---|---|---|
| Funding Cockpit | `1L4ilqypO-LyLmY4Vyv6TwxjsUwH3d8x0cr54hIgkyU1bch7pQ4xAurVW` | standalone web app |
| PROJECT_overview | not listed by clasp | bound to a spreadsheet |

`quarterly_budgets` was deleted from script.google.com on 2026-08-11 when quarterly budget
generation moved into the cockpit. Its id is deliberately not recorded here: a live-looking
script id for a project that no longer exists is worse than no entry.

Branches: work on a feature branch and open a PR against `dev`. `main` is the release branch.
