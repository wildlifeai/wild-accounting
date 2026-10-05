# Health checks

The cockpit's numbers are only as good as the budgets in Drive and the coding in Xero, and both
can fail silently: a malformed budget line, or an untagged Xero transaction, simply vanishes from
every total. Health checks turn that silent wrongness into a named, owned, actionable item that the
GM or a project lead can fix themselves.

Design principle: **every finding names what is wrong, where, who owns it, and what to do.** A
check that only says "something looks off" creates work instead of removing it.

## How findings reach you

Every refresh runs the checks over what it has just read and stores the findings in the snapshot
with everything else, so they cost nothing to display. Two checks, F2 and F7, are judged instead
each time the page loads, because a stale snapshot or a dead refresh trigger cannot be noticed by
the refresh that is not running.

The **Health** tab lists them most severe first, then by the amount at stake, so a large
misattribution outranks a missing description. Each shows what is wrong, where, the amount, what
to do and a link to the sheet. A finding about Xero transactions (D1, D2, D3, D4, D6 and F6) also
lists them under **Show the lines**, largest first: date, document and reference, contact,
description, account, funding source and amount, up to 50, with a count of any left off. The tab's badge is red when there are errors, amber when there are
only warnings, and absent when nothing is wrong; info findings are listed underneath and never
badged. A project lead sees the findings for their own projects, plus F1, F2, F3 and F7.

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
  link: 'https://docs.google.com/spreadsheets/d/…',
  lines: [{ date: '2026-04-22', document: 'Spend money FEE', contact: 'The Bank',
            description: 'Monthly fee', account: 'Bank Fees (404)',
            fundingSource: 'GEN_27_CORE', amount: 5 }],
  moreLines: 0                         // lines and moreLines on Xero-transaction findings only
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
| ~~A5~~ | - | ~~No `*Account` column~~ | **Retired 2026-08-11.** Budgets are set at milestone level, not per account, so its absence is expected. Nothing in the code read a budget line's account in any case. |
| A6 | info | No `Submitted_budget` tab | No frozen record of what the funder was given. |
| A7 | error | `Forecast` tab column header does not match `MMM-MMM YY Forecast` | That quarter's forecast is silently discarded. Name the column exactly, e.g. `Jul-Sep 26 Forecast`. |
| A8 | warning | `Forecast` tab row whose column A resolves to no budget line, or to more than one | That row's forecast is discarded. Label it with the milestone, or `Description - Milestone`. |
| A9 | warning | `Forecast` entry for an item code absent from the `Budget` tab | Forecasting a milestone that no longer exists. Should now be unreachable, since labels are resolved against the `Budget` tab at read time; if it appears, a forecast key reached the snapshot without passing `resolveForecastLabel_`. |
| A10 | warning | Two `Forecast` rows in one section carry the same label | Usually a sorted `Budget` tab: the label formulas held their positions while the values moved underneath them. Amounts are still summed, so nothing is lost, but other lines have silently lost their forecast. |
| A11 | warning | A milestone that budgets income has a cost forecast on the `Forecast` tab and nothing on its Revenue row | **Not raised since 2026-10-02**: a blank Revenue row now follows its cost, which is what A11 asked for. Retired with the switch that made it so. |
| A12 | warning | A negative number in a `Forecast` tab row | Costs and income are both entered as positive amounts. A negative cost is read as money coming in, so it lowers planned spend instead of adding to it. The amount is kept as entered, so the fix is on the sheet. |

A missing or empty `Forecast` tab is **not** a finding: a milestone row with no entry plans what is
left of its budget, and the tracking grid, D5 and E2 judge it against the budget baseline. Once a
row has any entry, its blank cells count as 0 for every quarter the tab has a column for.

### B. Data quality

| id | Sev | Check | Action shown |
|---|---|---|---|
| B1 | warning | Lines skipped because `Cost` and `Income` are both 0 | Report count. Use 0 deliberately or delete the row. |
| B2 | error | Unparseable `Start` or `End` | Line is invisible. Use `DD/MMM/YY`. |
| B3 | error | `End` before `Start` | Check the year: `30/Jun/01` parses as 2001. |
| B4 | error | Blank `Xero Inventory Item` | Line falls out of the tracking grid. Report count **and share of budget value**. |
| B5 | warning | `Contribution` ≠ `Income − Cost` | Recompute or explain. |

### C. Metadata

| id | Sev | Check | Action shown |
|---|---|---|---|
| C1 | error | Required metadata key missing | Name the key. |
| C2 | error | `Status` disagrees with the folder | Move the file or fix the value; the cockpit trusts the folder for forecasts. |
| C3 | error | `Funding source` ≠ file name | Budgets and actuals will not join. |
| C4 | warning | `Last reviewed` older than 90 days | Review it, then update the date. |
| C5 | warning | `Funding end` in the past, sheet still in `secured/` | Archive it, or extend the end date. |
| C6 | error | `Contribution policy` missing or unparseable | General's income cannot be derived. The three values are `none`, `per_line` and `percent_of_income:<n>`, with `n` from 0 to 100. Case, surrounding spaces, hyphens for underscores and a space after the colon are all normalised before matching, so `None` and `Percent of income: 40` pass. The finding quotes the value back exactly as typed. `40%` is still rejected: it is a different statement, and guessing which was meant is not the checker's job. |
| C7 | warning | `proposed` with no `Decision date` | Needed for pipeline forecasting and funder forms. |
| C8 | warning | `Income recognition` is something other than `as spent`, `as invoiced` or blank | Fix the value. Until then its income counts when invoiced. |

### D. Xero coding, aimed at the bookkeeper

| id | Sev | Check | Action shown |
|---|---|---|---|
| D1 | error | Actual lines with no `Projects` tag | **Dropped from every total.** Report count and value. |
| D2 | warning | Actual lines with no `Funding source` tag | Land in `(unassigned)`. |
| D3 | warning | Actual lines with no item code | Outside the tracking grid. Manual-journal lines are not counted: Xero journals cannot carry a Product/Service. |
| D4 | error | Actuals coded to a `Funding source` with no budget sheet | Either the sheet is missing, the tag is a typo, or the source was archived and its project's `archived` folder has been renamed or moved. Renaming the Xero tag with `Z_ARCH_` archives it whatever the folders say. |
| D5 | warning | A secured source was expected to spend something by the end of the last finished quarter, and nothing is coded to it | Usually a missing or misspelt Xero tag. "Expected" is the tracking grid's rule: the `Forecast` row where it has any entry, its blanks counting as 0, otherwise the `Budget` baseline. If the work has slipped, put the new timing on the `Forecast` tab. Finished quarters only, so it stays quiet while the first quarter of spend is under way; D4 catches a misspelt tag sooner. |
| D6 | error | Actuals against a funding source whose `Funding end` has passed | Almost always a stale recurring journal or template. |
| D8 | warning | Xero moves a source's income by manual journal (the accountant's deferral and release), but its sheet is not marked `Income recognition: as spent` | If the grant is released as it is spent, mark it; otherwise its income follows the releases, which lag by up to a quarter. |

D1 to D4 and D6 leave out spend on an archived funding source or project: no total or grid
includes it, so coding it better would change nothing.

D1, D2, D3, D6 and F6 look only at transactions dated in the current financial year: they ask for
a change in Xero, and earlier years' books are closed. D4 looks at every year, because its spend
is in the totals whatever its date and its fix is usually in Drive.

### E. Reconciliation

| id | Sev | Check | Action shown |
|---|---|---|---|
| E1 | warning | Actuals exceed budget for a funding source | Re-budget or explain to the funder. |
| E2 | warning | A secured source has spent well below what was expected by the end of the last finished quarter, by the same rule as D5 | Funders care about underspend as much as overspend. Fires once at least half the budget was due (`UNDERSPEND_MIN_DUE`) and the shortfall is a quarter of the budget or more (`UNDERSPEND_GAP`). Spend so far this quarter counts toward catching up. If the work has slipped, move it to later quarters on the `Forecast` tab. |
| E3 | error | Same item code in two funding sources | One cost billed twice. |
| E4 | warning | Same `Description` in two sources with overlapping dates | Double-funding signal, for example the same FTE in two grants. |

### G. Funding pipeline

Complements **E4**: that one detects duplication nobody declared, these handle duplication you
*did* declare, via `Exclusivity group`.

| id | Sev | Check | Action shown |
|---|---|---|---|
| G1 | warning | A source's overhead, its margin over the cost of its own work as a share of the income on lines not already General's, is more than `CONTRIBUTION_TOLERANCE` (10 points) from its `Contribution policy` | At 40%, anything from 30 to 50 is fine. Judged on the budget; on actual spend while work continues only once it has already taken the overhead below the band; and on actual spend in both directions once every one of those lines has ended. The Forecast tab is deliberately not used: the budget is what was agreed with the funder, and re-timing work does not change its margin. Above the band: two applications for the same work both landed, income is on the wrong milestone, or work is underspent. Below it: costs are eating the overhead. Secured and proposed sources both, so an application's budget is checked before it goes in. |
| G2 | info | A `proposed` source with no `Probability` in `Funding_info` | That ask is left out of expected income entirely rather than guessed at. "Unknown" is deliberately not "zero". |
| G3 | info | Cost suppressed because a competing application in the same `Exclusivity group` carries it | Expected, and reported so the suppression is never invisible arithmetic. Remove the group value if these are genuinely separate work. |

### F. System health, aimed at the GM and maintainer

| id | Sev | Check | Action shown |
|---|---|---|---|
| F1 | error | Xero not connected or token invalid | Run the reconnect step; actuals are stale meanwhile. |
| F3 | error | Required Script Properties missing | Name which. |
| F4 | warning | Xero refused a report because the connection lacks a scope a feature needs | Today that is `accounting.reports.read`, for the Balance Sheet the reserves come from. Run `resetXeroConnection`, then `logXeroAuthUrl`, and approve, in one sitting, since actuals stop in between. Until then the Reserves rows typed by hand still start the runway. |
| F5 | info | Last refresh time, duration, sheets read, lines parsed | Trend tells you when the 6-minute limit is approaching. |
| F6 | info | Xero documents skipped because they are still in draft or awaiting approval | Approve them in Xero to have them count. Drafts are not on the ledger, so Xero's own reports ignore them too. A draft bill understates spend and flatters runway; a draft invoice does the reverse. Voided and deleted documents are not counted here: they are decisions somebody already made, not a queue to clear. |
| F2 | warning | Snapshot older than 2× the refresh interval | Press Refresh now, then look at Executions in the editor for why the trigger is failing. One missed run is a hiccup, two is a pattern. **Raised at serve time**, by `serveTimeHealth` in `getFilteredSnapshot_`, not by `buildHealth`: inside a refresh the snapshot is fresh by definition. The detail says how old the snapshot is and how often it is meant to refresh. |
| F7 | error | No time-based trigger calls `refreshSnapshot` | Run `installRefreshTrigger` from the editor. Until then nothing refreshes and every number is whatever was last cached, however old that gets. Also serve time, and read live: a check made during a refresh would describe the trigger as it was then, and a dead trigger runs no refresh to notice itself. When the trigger list cannot be read at all, nothing is raised: a false alarm sends somebody to reinstall a trigger that is fine. |

F2 and F7 are the only findings a project-scoped user sees besides F1 and F3, because each
one means the numbers they are looking at are old.

---

## Not yet implemented

Designed, not built. Nothing below appears in the Health tab, and nothing below is
enforced. Kept because the design work is worth keeping, separated because a backlog
that reads like behaviour is worse than no documentation: it tells the GM the cockpit is
watching something it is not.

Ids are reserved, so implementing one means moving its row up rather than renumbering.

| id | Sev | Check | Action shown |
|---|---|---|---|
| ~~B6~~ | - | ~~`*Account` not in the Xero chart of accounts~~ | **Moot.** The `*Account` column was retired with A5 on 2026-08-11: budgets are set at milestone level, so there is no account label to validate. |
| ~~D7~~ | - | ~~Spend counted on an excluded balance-sheet account~~ | **Superseded.** `EXCLUDED_ACCOUNTS` was wired up on 2026-08-11, so this can no longer happen. The exclusion count and total are reported by **F5**. |
| E5 | warning | Salary actuals attributed differently from budgeted salary lines | **Blocked, and worth unblocking.** The payroll-template drift detector. It needs budgets at account level to compare against, and budgets are now at milestone level by design, so there is nothing to compare. **D6** catches part of the same failure by a different route: spend still arriving after a grant has ended is usually a stale repeating journal. |
| E6 | info | Residual hand-entered overhead lines alongside a derived `Contribution policy` | **Blocked.** Identifying an overhead line reliably needs the `*Account` column, which is retired. Matching on description text would be guesswork. |
`tools/check_docs.js` fails if any id above appears in `HEALTH_CATALOGUE`, or if any
id in the catalogue is missing from the tables above it. That is what keeps this split
honest rather than aspirational.
