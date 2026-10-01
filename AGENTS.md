# Wild Accounting: developer guide

This repository holds the Google Apps Script code of the **Funding Cockpit**, the dashboard that
joins Wildlife.ai's budgets (Google Sheets in Drive) to its actuals (Xero), and the checks that
keep it honest. Staff using the cockpit want the [README](README.md); this file is for changing it.

This repo is **not** the running system. The code executes as an Apps Script project in the cloud,
and that project can be edited in the browser. Treating the repo as the sole source of truth has
already cost real work.

**Before changing any script, pushing to Apps Script, or touching Xero, read
[`.agents/skills/SKILL.md`](.agents/skills/SKILL.md)**: the invariants and the traps that have
actually bitten. The reasoning, requirements and history are in
[`docs/DESIGN.md`](docs/DESIGN.md).

## Repository map

| Path | What it is |
|---|---|
| `dashboard/` | The Apps Script project and nothing else. `clasp push` uploads its code |
| `docs/` | Everything people read: the user guide, the budget sheet contract and template, the health checks, the design |
| `tools/` | Node scripts: the test runner, the docs checker and the content scanner. Not Apps Script |
| `.agents/skills/SKILL.md` | The rules for anyone changing the code |
| `.githooks/`, `.github/workflows/` | The checks, run on every commit and in CI |

## Setup and everyday commands

```bash
npm install -g @google/clasp        # v3+
clasp login                         # then enable the Apps Script API for your account:
                                    # https://script.google.com/home/usersettings
cd dashboard                        # one directory == one Apps Script project
clasp show-file-status              # dry run: exactly what push would upload
clasp push                          # replaces the remote project with local files
clasp open-script                   # open the IDE
```

Two checks, both offline. Run them before every push:

```bash
node tools/check_docs.js            # fails when the docs disagree with the code
node tools/run_tests.js             # runs dashboard/Tests.js headlessly
```

Both live in `tools/`, not `dashboard/`, because `.claspignore` is a whitelist: any `.js` file under
`dashboard/` is swept into the Apps Script project whether or not it belongs there.

`dashboard/Tests.js` holds `runTests()`: 238 checks over the forecast maths, budget and forecast
parsing, the health catalogue, serve-time staleness, which Xero statuses count as actuals, the
budget aggregation and contribution derivation, funded runway, scoped access and the funding
pipeline. It runs from the IDE with no Drive or Xero access, and `tools/run_tests.js` runs the
same file under Node. `runTests()` is the canonical copy.

`check_docs.js` is the one that stops documentation rotting: it verifies health-check ids **and
severities** match `HEALTH_CATALOGUE`, the file list below is complete, the user guide's tab count
matches `Index.html`, every `Config.META` key is documented, no doc points at a missing file, and
nothing in the repository looks like a real figure, a personal email or a bank account. Both run
in CI on every push and pull request, via `.github/workflows/checks.yml`, alongside GitGuardian
secret scanning.

## How the cockpit works

```
Apps Script web app (HtmlService)  ->  staff open one URL, Google login
        |
        v
  Aggregator  -- joins --+
        |                |
  ForecastEngine         |   (day-weighted Cost/Income distribution and quarter helpers)
        |                |
   +----+-----+    +-----+--------+
   | Budgets  |    |   Xero API   |
   | (Drive)  |    |   (OAuth2)   |
   | secured/ |    |  actuals by  |
   | proposed/|    |  Project x   |
   +----------+    |  Funding x   |
                   |  Item x Acct |
                   +--------------+
        |
        v
  Snapshot cache (JSON file in Drive)
  rebuilt every 6h by a time trigger, and by "Refresh now"
        |
        v
  Overview, Quarterly tracking, Project planner, Health
```

**Why a cache.** Crawling the budget sheets plus a full Xero pull takes about a minute and can
approach Apps Script's 6-minute limit, so the crawl runs on a time trigger and stores a JSON
snapshot that the dashboard reads instantly. The data model it relies on is in `SKILL.md` §2.

### Files

| File | Responsibility |
|---|---|
| `appsscript.json` | Manifest: OAuth2 library, scopes, web-app access |
| `Config.js` | All non-secret config: folder ids, excluded accounts, tuning. Edit this |
| `XeroClient.js` | Xero OAuth2, and fetching actuals as normalised lines |
| `BudgetReader.js` | Walk Drive, parse each sheet's `Funding_info`, `Budget` and `Forecast` tabs |
| `ForecastEngine.js` | Pure forecasting maths and quarter helpers, unit-testable |
| `Aggregator.js` | Join budgets and actuals into the snapshot: breakdown rows, contribution, tracking, planner, runway |
| `Permissions.js` | The Permissions tab of the Cockpit Settings sheet: which projects each person may see |
| `TrackingBuilder.js` | Merge budget, actual and forecast into the quarterly grid |
| `HealthCheck.js` | Turns silent wrongness into named findings. Pure, so it runs offline |
| `Snapshot.js` | The cache in Drive, the refresh trigger, and refresh progress |
| `WebApp.js` | `doGet`, the client API (`google.script.run`), per-person filtering |
| `Index/Stylesheet/JavaScript.html` | The dashboard UI |
| `Tests.js` | `runTests()`: the checks above, with no Drive or Xero |
| `Probe.js` | Read-only diagnostics run by hand from the editor, currently the contribution, forecast-plan and earned-actuals dry runs. Never on a trigger |

## Deploying a change

1. Run both checks. Commit, push the branch, and open a PR against `dev`.
2. Clone the live project into a scratch directory and compare it with the commit last pushed,
   ignoring line endings (`diff --strip-trailing-cr`). Any difference is browser work: stop and
   reconcile it first (`SKILL.md` §1).
3. From `dashboard/`, `clasp push -f`.
4. Clone again and confirm every file matches your local copy.
5. `clasp deploy -i <deploymentId> -d "what changed"`, which publishes a new version of the
   existing deployment, so the link staff use stays the same.

**The push alone changes published numbers.** The refresh trigger runs the latest pushed code, so
anything that changes how a figure is computed reaches the dashboard at the next refresh, deploy
or not. The deploy changes the page and its server calls.

## First-time setup

Only needed to stand up a new copy of the cockpit.

1. **Prerequisites.** A `wildlife.ai` Google account with access to the Budgets Drive, and a Xero
   app from <https://developer.xero.com/app/manage> (New app, Web app), which gives a Client ID
   and Client Secret.
2. **Create the project.** From `dashboard/`, `clasp create --type webapp --title "Funding Cockpit"`
   then `clasp push`. Copy `.clasp.json.example` instead if you already have a script id.
3. **Config.** In `Config.js`, set `BUDGETS_ROOT_FOLDER_ID` to the id of the top-level Budgets
   folder. The **Cockpit Settings** sheet is created in that folder on first use, with its
   `Permissions` tab seeded with you as the only person with access to everything.
4. **Xero secrets.** In the editor, Project Settings, Script Properties: add `XERO_CLIENT_ID` and
   `XERO_CLIENT_SECRET`. Never commit them. The tenant id is found and stored on first connect.
5. **Redirect URI.** Run `logXeroRedirectUri` and add the logged URL to the Xero app's Redirect URIs.
6. **Connect Xero.** Run `logXeroAuthUrl`, open the logged URL and approve the organisation.
7. **First snapshot and the trigger.** Run `refreshSnapshot` once, then `installRefreshTrigger` to
   refresh every 6 hours. Without the trigger the Health tab raises F7 on every page load; if it
   stops firing, F2 says how old the snapshot is.
8. **Deploy the web app.** Deploy, New deployment, Web app, executing as you, with access for anyone
   within wildlife.ai. Run `runTests` from the editor to confirm the maths.

## Maintaining it

- **Nothing day to day.** The snapshot refreshes itself. A new funding source appears at the next
  refresh after its sheet lands in a `secured/` or `proposed/` folder with the right name.
- **When something looks wrong:** read the Health tab first; it names most problems. Click
  **Refresh now**. The editor's **Executions** list shows each `refreshSnapshot` run and any error.
  If Xero reports not connected (F1), repeat the connect step.
- **Common adjustments, all in `Config.js`:** a balance-sheet account to exclude goes in
  `EXCLUDED_ACCOUNTS`, matched on its code, so a rename in Xero needs nothing; the refresh interval
  is `REFRESH_TRIGGER_HOURS`, after which re-run `installRefreshTrigger`.
- **Known assumptions.** `XeroClient.js` reads bank transactions and invoices; anything booked as a
  manual journal is invisible (see `SKILL.md` §4). Line amounts are Xero's GST-exclusive
  `LineAmount`, matching the GST-exclusive budgets.

## What belongs in this repository

**This repository is public, and it holds structure, not content.** Schema, code, checks, and
documentation about how the system works.

The content lives elsewhere: **`wildlife-ai-management`** and the Budgets Drive hold actual
budgets, funder terms, salary bands, and decisions about specific grants.

The line, stated so a machine can check it:

> A file here may **name** a funding source. It may never **state an amount**.

Names like `WW_25_TOI` are unavoidable, because they are the Xero tracking values the code joins
on, and funders announce their grants anyway. Amounts are the part that reveals what a person is
paid and what a funder agreed. Every example figure in this repository is invented and round; if
you need to write one, round it, or append `INVENTED-OK` to the line.

That applies to **commit messages and pull request descriptions too**, the easiest place to leak
and the most expensive to clean up: removing a figure from a merged commit means rewriting shared
history. Three mechanisms enforce it, in increasing order of how hard they are to bypass:

```bash
git config core.hooksPath .githooks   # enable the hooks, once per clone
```

| | Runs | Catches |
|---|---|---|
| `.githooks/pre-commit` | before each commit | stale docs, content in files |
| `.githooks/commit-msg` | as a message is written | content in that message |
| `.github/workflows/checks.yml` | every push and PR | both, across the whole branch, and cannot be skipped with `--no-verify` |

All three call the same scanner, [`tools/sensitive.js`](tools/sensitive.js), so there is one rule
rather than three that drift.

## Non-negotiables

- **`clasp push` replaces the remote project.** Files absent locally are deleted there. Never push
  without cloning and diffing first: on 2026-08-11 the deployed dashboard was about 1,030 lines
  ahead of the repo, including a whole permissions layer. `SKILL.md` §1, Deployment Invariant.
- **Never fetch code at runtime and execute it.** No `eval`, no `new Function` over a fetched
  string, no loader scripts. Code is deployed with clasp; secrets live in **Script Properties**,
  never in source. `SKILL.md` §1, No Remote Code Loading.
- **Verify automated review suggestions against the data before applying them.**
- **`.gitattributes` pins LF,** in the working tree too, which matters because `clasp push` reads
  the working tree. Use `git diff --ignore-cr-at-eol`, and never commit a line-endings-only diff.
- **Apps Script has one global scope per project.** Private helpers take a trailing underscore;
  only real entry points stay bare.
- **Money changes need a human.** Anything altering published actuals, budgets, or what a funder is
  told is reviewed before it ships: say what will move and by how much, outside the repository.
- **Victor approves every commit and push.** Prepare the change, show the diffstat, then ask.
- **No AI attribution** in commit messages or pull request descriptions.

## Apps Script project

| Project | Script ID | Deployment ID | Kind |
|---|---|---|---|
| Funding Cockpit | `1L4ilqypO-LyLmY4Vyv6TwxjsUwH3d8x0cr54hIgkyU1bch7pQ4xAurVW` | `AKfycbxCjtIS-xnIdySCtFF7vibrW0qhhnMcnzFs0GCPK0SXrzFzV5-WZtNnpkyTWfbLdAqs` | standalone web app, access limited to wildlife.ai |

It is the only one. Earlier tools and the projects they ran in were retired; see the history in
[`docs/DESIGN.md`](docs/DESIGN.md).

Branches: work on a feature branch and open a PR against `dev`. `main` is the release branch.
