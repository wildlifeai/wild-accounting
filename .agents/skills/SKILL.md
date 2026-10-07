---
name: wild-accounting-agent
description: >
  Invariants and hard-won traps for any agent or developer working on Wild Accounting, the
  Funding Cockpit that joins Wildlife.ai's budgets in Google Sheets to actuals in Xero. Read and
  follow this before editing any script, deploying to Apps Script, or touching Xero or budget data.
---

# Wild Accounting: rules for agents and developers

This repository holds the Apps Script code of the **Funding Cockpit**, which joins **budgets**
(Google Sheets in Drive) to **actuals** (Xero) so one set of numbers serves the board, the GM,
project leads and funders. This file holds the rules and the traps behind them; the reasoning,
open questions and history are in [`docs/DESIGN.md`](../../docs/DESIGN.md).

> **Canonical documentation**
>
> * `AGENTS.md`: setup, deploying, the repository map and the non-negotiables. `CLAUDE.md` is
>   just `@AGENTS.md`
> * `docs/USER_GUIDE.md`: what each dashboard panel means, for anyone using it
> * `docs/BUDGET_SHEET_TEMPLATE.md`: the budget sheet contract
> * `docs/HEALTH_CHECKS.md`: every health check, validated against the code by `check_docs.js`
> * `docs/DESIGN.md`: why it exists, the requirements, open questions, decisions, history

**The most important thing to understand about this repo: it is not the running system.** The
code executes as an Apps Script project in the cloud, and that project can be, and has been,
edited directly in the browser. The repo and the deployment drift apart silently.

---

# 1. Critical Invariants

## Deployment Invariant

**`clasp push` replaces the remote project. Always clone it and diff before you edit or push.**

One directory equals one Apps Script project: `dashboard/`. Its `.claspignore` is a whitelist
(`**/**`, then `!appsscript.json`, `!*.js`, `!*.html`), so push uploads that set and **deletes
anything on the remote that is not in it**.

A push also changes what people see before anyone deploys. The 6-hourly refresh trigger runs
the **latest pushed code**, and the dashboard shows the snapshot that trigger writes, so a push
that changes how numbers are computed moves the published figures at the next refresh. A deploy
only changes the web app's own code: the page and its server calls.

### Never

* Run `clasp push` without first cloning the remote and reviewing the diff.
* Assume the repo is newer than the deployment, or the reverse. Check.
* Resolve a divergence by picking one side wholesale without reading what the other side has.

### The trap this exists to prevent

On 2026-08-11, `dashboard/` in git was at commit `a3b8b72` and looked current. The deployed
Funding Cockpit was **about 1,030 lines ahead** across six files, `WebApp.js` +256,
`JavaScript.html` +209, `Aggregator.js` +166, `BudgetReader.js` +85, including an entire
`SETTINGS` and `PERMISSIONS` layer that existed nowhere in the repo. A `clasp push` would have
deleted all of it, silently and irreversibly.

Worse, the fork ran **both ways**. The repo held three `XeroClient.js` fixes that had never been
deployed, so neither `push` nor `pull` was safe on its own.

Worst of all, pulling the deployed code **reverted a security fix**: the browser copy predated
the XSS hardening in `a3b8b72`, so `esc()` fell back to escaping only `"` and nine of thirteen call
sites lost their wrapper. "The deployment is newer" was true for features and false for security,
and only a file-level comparison against the fix commit caught it.

### Rules for agents

* Before any push, clone the remote into a scratch directory and compare it with the commit you
  last pushed. Compare ignoring line endings: a clone on Windows is CRLF, so without
  `--strip-trailing-cr` every file looks drifted.

  ```bash
  mkdir -p /tmp/rc && cd /tmp/rc && clasp clone <scriptId>
  diff -rq --strip-trailing-cr <repo>/dashboard /tmp/rc
  ```

* After pushing, clone again and confirm every file matches the local copy, then deploy the
  existing deployment id so the link stays the same (`clasp deploy -i <deploymentId>`).
* `clasp show-file-status` shows exactly what push would upload. Read it before pushing.
* When reconciling a fork, work on a branch, pull over the committed state, and let `git diff`
  show you what the browser work added. Git is the safety net; use it.
* After reconciling, **check security-relevant files line by line** against the commit that last
  hardened them. Feature recency does not imply security recency.
* Use `-f` when the manifest differs, or push prompts and hangs in non-interactive shells.

---

## No Remote Code Loading Invariant

**Code is deployed, never fetched. Secrets live in Script Properties, never in source.**

### Never

* Fetch a script from a URL and run it through `eval` or `new Function`.
* Put a client id, client secret, token or password in a `.js` file, even a template, even with a
  "do not commit this" comment.
* Cache fetched code in Script or Document Properties.

### The trap this exists to prevent

This repo once shipped **three** loader scripts that fetched JavaScript from
`raw.githubusercontent.com` and executed it. Each one was remote code execution by design:

* the fetched code ran with the full Drive and Sheets permissions of whoever triggered it;
* `loader-budgets-template.js` passed the **live Xero client secret** straight into the fetched
  module;
* fetched code was cached in Script or Document Properties, so it kept running after the remote was
  cleaned up. Fixing the repo did not reach the caches;
* neither loader checked `getResponseCode()`, so a 404 body was handed to the interpreter, which is
  exactly what happened when a branch the URL pinned was deleted on merge;
* `loader_template.js` was wired to an `onOpen()` menu in a shared spreadsheet, so any user of that
  sheet could trigger it with their own Google permissions.

The loaders existed only to get updated code into Apps Script without copy-paste. `clasp push`
does that properly.

### Rules for agents

* Read secrets through a helper, and fail loudly when unset.
* Use `getScriptProperties()` for the OAuth token store, not Document Properties, which are
  **invisible in the Apps Script UI** and can only be cleared from code.
* Changing the property store makes an existing token unreachable: the app reports "not
  connected" and needs one re-consent. Expected, but say so before doing it.
* When removing anything that cached code or tokens, clear its cache key too.

---

## Line Ending Invariant

**`.gitattributes` sets `* text=auto eol=lf`,** so LF holds in both the stored blob and the working
tree. Before it, clasp wrote LF while a Windows checkout was CRLF, so `clasp pull` made whole files
appear modified with no content change.

* `clasp push` reads the **working tree**, not git. An editor that writes CRLF into a file sends
  CRLF to Apps Script, and the next comparison shows a whole-file diff. Check
  `git ls-files --eol` shows `w/lf` for every changed file before pushing.
* Use `git diff --ignore-cr-at-eol` to see real changes. A diff where insertions and deletions both
  equal the file's line count is an artifact, not an edit; restore it rather than commit it.
* After changing `.gitattributes`, renormalise with `git add --renormalize .`.

---

## Global Scope Invariant

**All files in one Apps Script project share a single global scope.** Two files defining the same
function name silently collide, last definition winning.

* Private helpers take a **trailing underscore** (`getFolderByName_`). Apps Script treats those as
  private, so they stay out of the IDE's Run menu.
* Only real entry points stay bare. `xeroAuthCallback` must stay bare: OAuth2 calls it by name.
* `create_quarterly_budgets.js` and `funding-aggregator.js` both defined `getFolderByName`. The
  collision was hidden only because the former was wrapped in a closure; flattening it for
  deployment exposed the clash, which is why the underscore convention is enforced.
* Name top-level constants distinctly, so a new file cannot shadow an existing one.

---

## Verify-Before-Applying Invariant

**Automated review suggestions are claims, not facts. Check them against the code, the docs and
the real data before applying.**

An automated reviewer once asked for project abbreviations `WAA` and `WLW`, justified by "the
README lists them as `WAA` and `WLW`". The README said `WAI` and `WW`; so did the code, the
funding-source files in Drive (`WAI_25_OMV`, `WW_25_TOI`, `WW_26_SALES`) and the Xero *Funding
source* tracking values. The justification was fabricated, and applying the suggestion would have
decoupled budgets from live data. Other findings in the same review were real. Judge each on
evidence.

Corollary: **green CI proves consistency, not correctness.** CI runs the test suite, the docs
checker, the content scan and GitGuardian's secret scan. None of them knows whether a published
figure is right, which is what the next invariant is for.

---

## Money Change Invariant

**Changes that move published numbers need a human decision and an explicit before and after.**

Ship each as its own commit, never inside an unrelated refactor, and say what moves and by how
much before it ships. When the figures live in the sheets rather than the code, measure them
first: `reportContributions()` in `Probe.js` is the model, a read-only dry run shipped before the
change it measures, run from the editor, whose output states the move.

The figures themselves go in the conversation and in `wildlife-ai-management`, **never in a
commit message or a PR description**: this repository is public (see `AGENTS.md`).

Examples of changes that moved numbers, all correct: removing `Math.abs()` from `normaliseLine_`,
so credit notes reduce spend; wiring up `EXCLUDED_ACCOUNTS`; counting only approved Xero
documents; removing an archived source's actuals from organisation totals; deriving General's
overhead from each sheet's `Contribution policy`.

---

# 2. The Four-Dimension Model

Every actual and every budget line is identified by four dimensions. This is the core of the
system; get it wrong and nothing reconciles.

| Concept | Xero mechanism | Example |
|---|---|---|
| Expense type | Chart of Accounts | `Salaries (477)` |
| Project | tracking category `Projects` | `General`, `Wildlife Watcher` |
| Funding source | tracking category `Funding source` | `WW_25_TOI` |
| Milestone | Product & Service (item) code | `WW_25_TOI_002` |

Budgets mirror this in Drive under the `Budgets` folder (`BUDGETS_ROOT_FOLDER_ID` in `Config.js`):

```
Budgets/
  <Project>/            e.g. Wildlife Watcher, Spyfish Aotearoa, Wild About AI, General
    secured/            one Google Sheet per funding source -> status 'secured'
    proposed/           -> status 'proposed'
    archived/           not read; each sheet named like a funding source, with or without
                        Z_ARCH_ or Z_ARCHIVED_, marks that Xero tag as archived
                        (archivedSourceName_), so its actuals leave the totals too
```

Rules that follow from this:

* A funding-source sheet is **named exactly as its Xero *Funding source* tracking value**.
* Status comes from the folder. *Secured* means `secured/` only; *proposed* means secured plus
  proposed.
* An archived source is archived everywhere: `isArchivedSource_` is the one definition, and it
  drops the source's actuals as well as its sheet, even though Xero keeps the tracking value's
  original name forever.
* A funding source can span projects: the per-line `Project` column overrides the parent folder.
* Xero transactions must carry **both** tracking categories plus the item code. A line with no
  `Projects` value is dropped from project and organisation totals (D1); a line with no `Funding
  source` falls out of Project tracking (D2).
* Project abbreviations are `SPY`, `GEN`, `WAI`, `WW`. Do not change them: see §1,
  Verify-Before-Applying.

---

# 3. Budget Sheet Contract

The full contract, every field and how each fails, is
[`docs/BUDGET_SHEET_TEMPLATE.md`](../../docs/BUDGET_SHEET_TEMPLATE.md). The rules that matter when
changing code:

* **At most four tabs** (`Funding_info`, `Budget`, `Forecast`, `Submitted_budget`), enforced by
  health check A3. Start new sheets from `docs/Budget_sheet_template.xlsx`.
* **Metadata lives in `Funding_info`.** A `key | value` block above the `Budget` columns is still
  read as a fallback, and `findHeaderRow_` locates the header row rather than assuming row 1.
* **The `Budget` tab is milestone-keyed, not account-keyed.** Columns read: `Description`,
  `Start`, `End`, `Cost`, `Income`, `Contribution`, `Milestone`, `Xero Inventory Item`, `Project`,
  and `*Account` where an older sheet still has one, though nothing uses it. Required: `Start`,
  `End`, `Cost`.
* **Forecasts are per sheet**, on each funding source's own `Forecast` tab, read by
  `parseForecastTab_`. The central sheet, Cockpit Settings, holds only the Permissions and
  Reserves tabs (`Permissions.js`).
* **A milestone row with no forecast falls back to the budget baseline**, never to zero.
  `forecastOrBaseline_` in `ForecastEngine.js` is the one statement of that rule, used by the
  tracking grid, D5 and E2. Reading zero made every source with an unmaintained `Forecast` tab look
  certain to underspend; the fallback was lost once and restored with a regression test. Do not
  "simplify" it back.
* **A row with any entry owns its tab's quarters**: `ownedForecast_` fills its blanks with 0, and
  with `CONFIG.PLAN_FROM_FORECAST` on, `planBudgets_` re-times the lines so every view (Overview,
  runway, timeline) follows the forecast. Quarters with no column keep the budget. `buildSnapshot`
  passes `planned` budgets to the views and `judged` ones (original lines, owned forecast) to the
  grid and health checks. See `docs/DESIGN.md`, decisions, 2026-09-30.
* **The plan runs from today**: with `CONFIG.PLAN_REMAINING` on, `remainingPlan_` rebuilds
  `planned` as actuals for months gone and, for months to come, the typed forecast or what is left
  of the budget, with income that has no Revenue row following its cost, capped at the source's
  budgeted income. It needs `CONFIG.ACTUALS_EARNED`: on the invoiced basis an upfront grant is
  income to date on no milestone, and its income to come would count it again. See
  `docs/DESIGN.md`, decisions, 2026-10-02.

**The parser reports rather than skips.** A line it cannot use becomes a health finding: both
`Cost` and `Income` zero (B1), an unparseable date (B2), an end before its start (B3), no item
code (B4). A sheet with no `Budget` tab or a missing required column still appears, as A1 or A2.
Never add a code path that drops data without a finding.

---

# 4. Xero Integration Rules

`dashboard/XeroClient.js` fetches actuals from **bank transactions and invoices**, and from
**posted manual journals** with `CONFIG.ACTUALS_EARNED` on (see the notes under Payroll).

* **Only approved documents count.** Status is filtered in `paginate_`, in one place, with an
  allowlist (`POSTED_STATUS`): invoices `AUTHORISED` or `PAID`, bank transactions `AUTHORISED`.
  Drafts and documents awaiting approval are reported by F6; voided and deleted ones are not.
  A collection with no policy passes through, so a new fetcher never silently returns nothing.
* **Balance-sheet accounts are excluded** by account **code**, in `fetchXeroActuals`, so a Xero
  rename cannot un-exclude one (`EXCLUDED_ACCOUNTS`, reported by F5).
* Scopes: `offline_access accounting.transactions.read accounting.settings.read
  accounting.reports.read`, the last for the Balance Sheet the reserves come from. Xero has
  deprecated the broad scopes in favour of granular ones (this app keeps them to September 2027);
  scopes are additive and cannot be removed from a live token without re-consent, so plan
  changes rather than making them casually. A token granted before a scope was added is refused
  that scope's endpoints, which F4 reports.

## Payroll

Since 2026-09-21 payroll posts through Xero Payroll as bills and bank transactions, both of which
the cockpit reads. A refresh that day showed no D1 or D2 finding across 306 actual lines, so every
payroll line carried both tracking categories. **Fetching is not the same as counting**: a payroll
bill with no `Projects` tag would be dropped from every total, so read D1 and D2 before trusting
any total that ought to contain salary.

Manual journals are read by `fetchManualJournalLines_`, with `CONFIG.ACTUALS_EARNED` on since
2026-10-02. The
probe of 2026-10-02 confirmed against the live organisation that the current connection
(`accounting.transactions.read`) can read them, that every P&L journal line carried both tracking
categories, and that none carried an item code. The rules the reader follows:

* `ManualJournalLine` **does** carry `Tracking`, at most two categories, which is exactly `Projects`
  and `Funding source`.
* `ManualJournalLine` has **no `ItemCode`**. The milestone must be recovered from the line
  description via `codeFromDescription_`, which requires the code as the first `' - '`-delimited
  segment, for example `WW_25_TOI_002 - Salaries`.
* An **unpaged** `GET /ManualJournals` returns no `JournalLines` at all, so a fetcher mirroring the
  existing ones would succeed and produce exactly nothing. `?page=1` is mandatory.
* `LineAmount` on journal lines is **signed**. Never `Math.abs()` it: an accrual and its reversal
  must net to zero.
* `LineAmount` **includes GST** on any document (invoice, bank transaction or manual journal)
  whose `LineAmountTypes` is `Inclusive`. `netLineAmount_` takes the line's `TaxAmount` off
  there, so the cockpit matches Xero's reports, which are net of GST.
* Filter to `Status === 'POSTED'` in the mapper, not via `where`, which `paginate_` overwrites when
  `modifiedAfter` is set.
* A grant paid upfront is invoiced to a revenue account, deferred by a quarter-end journal and
  released quarter by quarter as it is spent, so the releases lag by up to a quarter. A sheet
  marked `Income recognition: as spent` therefore earns its income from its own spend
  (`earnedActuals_`), and its invoice and release journals are dropped, or it would count twice.
* There is no repeating-journal endpoint, so future payroll cannot be read from Xero; forward salary
  cost must keep coming from the budget.

---

# 5. Overhead and Double-Funding Rules

> **This is a public repository.** Never paste real grant amounts, hourly rates, funder terms or
> invoice identifiers into tracked files, including examples and test fixtures. Describe the shape
> of a problem and invent the numbers.

## Overhead / General contribution

Projects contribute a share of their income to `General` at the rate each funding source declares
in its `Contribution policy`. The rates live in each sheet's `Funding_info`, not here, because a
list copied into this file drifts from the sheets: `reportContributions()` prints the current ones.

`contributionRate_` and `lineContribution_` in `Aggregator.js` are the one statement of the rule,
used by the Overview, the timeline, General's tracking view and G1.
`percent_of_income` takes its share from lines not already on General; `per_line` and `none`
derive nothing. Organisation totals and runway do not move; only the split between projects does.

G1 checks a source's actual margin against its policy with ten points either side
(`CONTRIBUTION_TOLERANCE`). It deliberately does not read the `Forecast` tab.

Any negative-cost "Overheads from projects" lines left in a General budget count the overhead
twice, and must be deleted.

## Double-funding

The same cost must not be charged to two funding sources for the same period. When preparing any
funding application, check whether the cost is already funded elsewhere, and make handoffs between
funders explicit with dates rather than comments. When two applications go to the same funder,
ensure neither budget charges management hours the other already covers.

It is enforced rather than remembered:

* **E3**: the same item code in two funding sources. Codes are `{SOURCE}_{NNN}` precisely so this
  cannot happen by accident.
* **E4**: the same `Description` budgeted in two sources over overlapping dates.
* **`Exclusivity group`** in `Funding_info`, for duplication that is *deliberate*: two applications
  chasing the same work in the hope one lands. Members share a label, exactly one carries the cost,
  and **G3** reports the ones whose cost was suppressed.
* **E4 stays silent inside an exclusivity group.** E4 is for duplication nobody declared; G3 is for
  duplication that was. Reporting both would charge the reader twice for one decision.

---

# 6. Working Practices

* **Victor approves every commit and push.** Prepare the change, show the diffstat, then ask.
* **No AI attribution** in commit messages or pull request descriptions: no `Co-Authored-By`
  trailer, no generated-with footer.
* Feature branch, PR against `dev`. `main` is the release branch. Merging `dev` into `main` has
  deleted `dev` before (GitHub's automatic head-branch deletion); if `gh pr create` fails with
  "Base ref must be a branch", check `git ls-remote --heads origin` and recreate `dev` from `main`,
  after asking.
* Use `--force-with-lease`, never bare `--force`, when a rewrite is authorised.
* Prefer amending over a follow-up commit when the original would otherwise leave a security
  regression in the pushed history, and say that a force-push is required.
* `Probe.js` holds read-only diagnostics run by hand. A one-off probe is deleted once its question
  is answered, and diagnostics stay out of feature commits.
* Findings belong in the repo docs. Anything left undone goes into `docs/DESIGN.md`'s open
  questions rather than living only in a conversation.

---

# Agent Self-Check

Before deploying or committing, verify:

* Have I cloned and diffed the Apps Script project before pushing, ignoring line endings?
* Did I compare security-relevant files against the commit that last hardened them?
* Am I introducing any fetched-and-executed code, or any secret in source?
* Have I checked review suggestions against the docs and the real Drive data?
* Do private helpers carry a trailing underscore?
* Will this change move published numbers, and have I said which and by how much, outside the
  repository? Remember the push alone moves them at the next refresh.
* Is every changed file LF in the working tree?
* Does the commit message or PR description carry a figure, or any AI attribution?

If any answer is wrong, stop and re-read the relevant invariant.
