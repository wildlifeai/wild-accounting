# Self-policing and system health checks

The cockpit's numbers are only as good as the budgets in Drive and the coding in Xero, and both
fail **silently** today. `BudgetReader` skips a malformed line with a `Logger.log` nobody reads; an
untagged Xero transaction vanishes from every total without a trace. The purpose of health checks is
to convert silent wrongness into a named, owned, actionable item that the GM or a project lead can
fix themselves.

Design principle: **every finding names what is wrong, where, who owns it, and what to do.** A
check that only says "something looks off" creates work instead of removing it.

## Where it plugs in

There is already a mechanism: `Aggregator.buildSnapshot()` produces `dataFlags`, and
`JavaScript.html` renders them into `#flags`. Extend that rather than inventing a parallel path.

```
BudgetReader ──┐
XeroClient   ──┼──► Aggregator.buildSnapshot() ──► snapshot.health[] ──► Health panel
metadata     ──┘                                                        (grouped by owner)
```

Findings belong in the snapshot so they are cached with everything else and cost nothing to
display. `snapshot.dataFlags` becomes the legacy alias for `health` filtered to `severity=error`.

## Finding shape

```js
{
  id: 'B3',                            // stable check id, so a finding can be documented
  severity: 'error',                   // error | warning | info
  category: 'Data quality',
  title: 'Budget line ends before it starts',
  detail: 'WW_25_TOI line 24: End 30/Jun/01 precedes Start 01/Feb/26.',
  fundingSource: 'WW_25_TOI',
  project: 'Wildlife Watcher',
  owner: 'someone@wildlife.ai',         // from the sheet's metadata block
  amount: 2000,                        // value at risk, when quantifiable
  action: 'Fix the End date on that line. 30/Jun/01 parses as year 2001.',
  link: 'https://docs.google.com/spreadsheets/d/…'
}
```

`severity` means something specific:

| | Meaning |
|---|---|
| **error** | A number on the dashboard is currently wrong. |
| **warning** | A number may be wrong, or will be soon. |
| **info** | Hygiene. Nothing is wrong yet. |

`owner` comes from the `Owner` key in the sheet's metadata block (see
[BUDGET_SHEET_TEMPLATE.md](BUDGET_SHEET_TEMPLATE.md)), which is what makes per-lead filtering
possible. It pairs naturally with the existing `PERMISSIONS` layer: a project lead sees findings for
their projects, the GM sees everything.

## Check catalogue

### A. Sheet structure

| id | Sev | Check | Action shown |
|---|---|---|---|
| A1 | error | Funding-source file has no `Budget` tab | Whole file is invisible. Add or rename the tab. |
| A2 | error | `Budget` tab missing `Start`, `End` or `Cost` | Whole file is invisible. Add the column. |
| A3 | warning | Tabs beyond `Funding_info` / `Budget` / `Forecast` / `Submitted_budget` | Retire the extra tab; actuals live in Xero. |
| A4 | warning | No `Project` column | Lines cannot be split across projects. |
| ~~A5~~ | — | ~~No `*Account` column~~ | **Retired 2026-08-11.** Budgets are set at milestone level, not per account, so its absence is expected. Nothing in the code read a budget line's account in any case. |
| A6 | info | No `Submitted_budget` tab | No frozen record of what the funder was given. |
| A7 | error | `Forecast` tab column header does not match `MMM-MMM YY Forecast` | That quarter's forecast is silently discarded. Name the column exactly, e.g. `Jul-Sep 26 Forecast`. |
| A8 | warning | `Forecast` tab row whose column A resolves to no budget line, or to more than one | That row's forecast is discarded. Label it with the milestone, or `Description - Milestone`. |
| A9 | warning | `Forecast` entry for an item code absent from the `Budget` tab | Forecasting a milestone that no longer exists. Should now be unreachable, since labels are resolved against the `Budget` tab at read time; if it appears, a forecast key reached the snapshot without passing `resolveForecastLabel_`. |
| A10 | warning | Two `Forecast` rows in one section carry the same label | Usually a sorted `Budget` tab: the label formulas held their positions while the values moved underneath them. Amounts are still summed, so nothing is lost, but other lines have silently lost their forecast. |

A missing or empty `Forecast` tab is **not** a finding — a quarter with no override falls back to
the budget baseline, so an absent tab legitimately means "the budget is still our best estimate".

### B. Data quality

| id | Sev | Check | Action shown |
|---|---|---|---|
| B1 | warning | Lines skipped because `Cost` and `Income` are both 0 | Report count. Use 0 deliberately or delete the row. |
| B2 | error | Unparseable `Start` or `End` | Line is invisible. Use `DD/MMM/YY`. |
| B3 | error | `End` before `Start` | Check the year — `30/Jun/01` parses as 2001. |
| B4 | error | Blank `Xero Inventory Item` | Line falls out of the tracking grid. Report count **and share of budget value**. |
| B5 | warning | `Contribution` ≠ `Income − Cost` | Recompute or explain. |

### C. Metadata

| id | Sev | Check | Action shown |
|---|---|---|---|
| _(none implemented yet, see below)_ | | | |
| C1 | error | Required metadata key missing | Name the key. |
| C2 | error | `Status` disagrees with the folder | Move the file or fix the value — the cockpit trusts the folder for forecasts. |
| C3 | error | `Funding source` ≠ file name | Budgets and actuals will not join. |
| C4 | warning | `Last reviewed` older than 90 days | Review it, then update the date. |
| C5 | warning | `Funding end` in the past, sheet still in `secured/` | Archive it, or extend the end date. |
| C6 | error | `Contribution policy` missing or unparseable | General's income cannot be derived. The three values are `none`, `per_line` and `percent_of_income:<n>`. Case, surrounding spaces, hyphens for underscores and a space after the colon are all normalised before matching, so `None` and `Percent of income: 40` pass. The finding quotes the value back exactly as typed. `40%` is still rejected: it is a different statement, and guessing which was meant is not the checker's job. |
| C7 | warning | `proposed` with no `Decision date` | Needed for pipeline forecasting and funder forms. |

### D. Xero coding — aimed at the bookkeeper

| id | Sev | Check | Action shown |
|---|---|---|---|
| D1 | error | Actual lines with no `Projects` tag | **Dropped from every total.** Report count and value; link the transactions. |
| D2 | warning | Actual lines with no `Funding source` tag | Land in `(unassigned)`. |
| D3 | warning | Actual lines with no item code | Outside the tracking grid. |
| D4 | error | Actuals coded to a `Funding source` with no budget sheet | Either the sheet is missing or the tag is a typo. |
| D5 | warning | A secured source was expected to spend something by the end of the last finished quarter, and nothing is coded to it | Usually a missing or misspelt Xero tag. "Expected" is the tracking grid's rule: the `Forecast` entry where one was written, a 0 included, otherwise the `Budget` baseline. A blank cell is not a 0. If the work has slipped, enter 0 for those quarters. Finished quarters only, so it stays quiet while the first quarter of spend is under way; D4 catches a misspelt tag sooner. |
| D6 | error | Actuals against a funding source whose `Funding end` has passed, or whose sheet is archived | Almost always a stale recurring journal or template. |

### E. Reconciliation

| id | Sev | Check | Action shown |
|---|---|---|---|
| _(none implemented yet, see below)_ | | | |
| E1 | warning | Actuals exceed budget for a funding source | Re-budget or explain to the funder. |
| E2 | warning | A secured source has spent well below what was expected by the end of the last finished quarter, by the same rule as D5 | Funders care about underspend as much as overspend. Fires once at least half the budget was due (`UNDERSPEND_MIN_DUE`) and the shortfall is a quarter of the budget or more (`UNDERSPEND_GAP`). Spend so far this quarter counts toward catching up. If the work has slipped, move it to later quarters on the `Forecast` tab. |
| E3 | error | Same item code in two funding sources | One cost billed twice. |
| E4 | warning | Same `*Account` + `Description` in two sources with overlapping dates | Double-funding signal — e.g. the same FTE in two grants. |

### G. Funding pipeline — implemented 2026-08-13

Complements the planned **E4**: that one detects duplication nobody declared, these handle
duplication you *did* declare, via `Exclusivity group`.

| id | Sev | Check | Action shown |
|---|---|---|---|
| G1 | warning | A `secured` source's income exceeds its budgeted cost | Two applications for the same work both landed, so reallocate the surplus, or income is filed against the wrong milestone. Also catches projected revenue misfiled as secured, which is the live `WW_26_SALES` case. |
| G2 | info | A `proposed` source with no `Probability` in `Funding_info` | That ask is left out of expected income entirely rather than guessed at. "Unknown" is deliberately not "zero". |
| G3 | info | Cost suppressed because a competing application in the same `Exclusivity group` carries it | Expected, and reported so the suppression is never invisible arithmetic. Remove the group value if these are genuinely separate work. |

### F. System health — aimed at the GM and maintainer

| id | Sev | Check | Action shown |
|---|---|---|---|
| F1 | error | Xero not connected or token invalid | Run the reconnect step; actuals are stale meanwhile. |
| F3 | error | Required Script Properties missing | Name which. |
| F5 | info | Last refresh time, duration, sheets read, lines parsed | Trend tells you when the 6-minute limit is approaching. |
| F6 | info | Xero documents skipped because they are still in draft or awaiting approval | Approve them in Xero to have them count. Drafts are not on the ledger, so Xero's own reports ignore them too. A draft bill understates spend and flatters runway; a draft invoice does the reverse. Voided and deleted documents are not counted here: they are decisions somebody already made, not a queue to clear. |
| F2 | warning | Snapshot older than 2× the refresh interval | Press Refresh now, then look at Executions in the editor for why the trigger is failing. One missed run is a hiccup, two is a pattern. **Raised at serve time**, by `serveTimeHealth` in `getFilteredSnapshot_`, not by `buildHealth`: inside a refresh the snapshot is fresh by definition. The detail says how old the snapshot is and how often it is meant to refresh. |
| F7 | error | No time-based trigger calls `refreshSnapshot` | Run `installRefreshTrigger` from the editor. Until then nothing refreshes and every number is whatever was last cached, however old that gets. Also serve time, and read live: a check made during a refresh would describe the trigger as it was then, and a dead trigger runs no refresh to notice itself. When the trigger list cannot be read at all, nothing is raised: a false alarm sends somebody to reinstall a trigger that is fine. |

F2 and F7 are the only findings a project-scoped user sees besides F1 and F3, because each
one means the numbers they are looking at are old.

## UI

A **Health** panel on the Overview tab, collapsed by default, showing counts by severity
(`3 errors · 11 warnings · 6 info`) and expanding to a list grouped by category. Each row shows
title, where, the value at risk if any, and the action. Errors also surface as a persistent banner,
because an error means a number on screen is wrong right now.

Filter controls: **mine / all** (by `owner`), and by project. Project leads land on *mine*.

Do not sort purely by severity — sort by **value at risk** within severity, so a $40,000
misattribution outranks a missing description.

## Implementation notes

* Put the checks in a new `HealthCheck.js`, pure functions over `(budgets, actualLines, metadata)`
  returning findings. Keep it free of `DriveApp`/`UrlFetchApp` so `Tests.js` can cover it offline —
  it is the first part of this codebase that is genuinely unit-testable, so take the opportunity.
* `BudgetReader` must **report** what it currently discards. Today it `continue`s past bad rows;
  it needs to collect `{file, row, reason}` and return them alongside the lines. This is the single
  biggest change, and most of A and B depend on it.
* D1–D3 need the count **and** the summed value of affected lines; a count alone doesn't convey
  whether it matters.
* Cap each check's findings (say 20) and report the overflow count — never truncate silently, which
  is the failure mode the checks exist to prevent.
* Checks must never throw. A failing check reports itself as an `info` finding and the rest proceed.

## Sequencing

Two things gate this work:

1. **`sync-from-apps-script` must merge first.** It holds ~1,030 lines of `Aggregator.js`,
   `WebApp.js` and `JavaScript.html` changes. Building the health panel on a third branch before it
   lands guarantees conflicts in exactly those files.
2. **The metadata template drives categories C and much of D and E.** Those checks are
   were unimplementable until sheets carried `Owner`, `Status`, `Funding end` and
   `Contribution policy`. They now do, and C1 to C7 were built on 2026-08-14 as a result.

So: merge the sync branch, then implement the `BudgetReader` reporting change plus categories A, B
and F — which need no new sheet data and would surface real problems today. Categories C, D6, E4 and
E5 follow as the metadata block rolls out.

---

## Not yet implemented

Designed, not built. Nothing below appears in the Health tab, and nothing below is
enforced. Kept because the design work is worth keeping, separated because a backlog
that reads like behaviour is worse than no documentation: it tells the GM the cockpit is
watching something it is not.

Ids are reserved, so implementing one means moving its row up rather than renumbering.

| id | Sev | Check | Action shown |
|---|---|---|---|
| ~~B6~~ | — | ~~`*Account` not in the Xero chart of accounts~~ | **Moot.** The `*Account` column was retired with A5 on 2026-08-11: budgets are set at milestone level, so there is no account label to validate. |
| ~~D7~~ | — | ~~Spend counted on an excluded balance-sheet account~~ | **Superseded.** `EXCLUDED_ACCOUNTS` was wired up on 2026-08-11, so this can no longer happen. The exclusion count and total are reported by **F5**. |
| E5 | warning | Salary actuals attributed differently from budgeted salary lines | **Blocked, and worth unblocking.** The payroll-template drift detector. It needs budgets at account level to compare against, and budgets are now at milestone level by design, so there is nothing to compare. **D6** catches part of the same failure by a different route: spend still arriving after a grant has ended is usually a stale repeating journal. |
| E6 | info | Residual hand-entered overhead lines alongside a derived `Contribution policy` | **Blocked.** Identifying an overhead line reliably needs the `*Account` column, which is retired. Matching on description text would be guesswork. |
| F4 | warning | A Xero scope needed by a feature in use is absent | Not built. `accounting.transactions.read` covers everything currently fetched, so there is nothing to detect yet. Worth adding when a feature needs a scope beyond it. |

`dashboard/check_docs.js` fails if any id above appears in `HEALTH_CATALOGUE`, or if any
id in the catalogue is missing from the tables above it. That is what keeps this split
honest rather than aspirational.
