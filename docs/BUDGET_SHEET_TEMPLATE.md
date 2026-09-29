# Funding-source budget sheets

Every funding source has one Google Sheet in the Budgets Drive, named **exactly** as its Xero
*Funding source* tracking value (for example `WW_25_TOI`), living in its project's `secured/` or
`proposed/` folder. This is how to create one, and the reference for what every field means and
how each one fails.

**At most four tabs:**

| Tab | Role |
|---|---|
| `Funding_info` | sheet-level metadata as `key \| value` rows in columns A and B |
| `Budget` | the live baseline the cockpit reads. Change it only for a genuine re-budget |
| `Forecast` | per-quarter overrides, where you know something the budget does not. Optional |
| `Submitted_budget` | frozen record of what the funder was actually given. Never edited |

Nothing else. Actuals come live from Xero, so a per-sheet copy of them is a second version of the
truth and will drift.

All numbers in this document are invented. **This is a public repository: never paste real grant
amounts, rates, funder terms or invoice identifiers into it.**

---

## Starting a new funding source

Start from [`Budget_sheet_template.xlsx`](Budget_sheet_template.xlsx) rather than building a sheet
by hand. One import gives you all four tabs, correctly named, with the formulas and dropdowns
already wired. It is an `.xlsx` rather than CSVs because CSV cannot carry formulas, validation,
number formats or more than one tab.

1. Upload `Budget_sheet_template.xlsx` to the right project folder in the Budgets Drive
   (`secured/` or `proposed/`).
2. Right-click it, then **Open with, Google Sheets**. Drive converts it, keeping the tab names,
   formulas, dropdowns and formatting.
3. Rename the new sheet **exactly** as its Xero *Funding source* tracking value, for example
   `SPY_27_UOA`. Budgets and actuals join on this string, so a mismatch shows a budget with no
   spend against it.
4. Delete the original `.xlsx` upload once the Sheet exists.
5. Fill in `Funding_info`, then replace the example rows on `Budget`.
6. At submission, copy the `Budget` rows onto `Submitted_budget` and never touch them again.

**What is already wired up.** `Contribution` is `Income − Cost` per row, and `Funding_info` derives
the amount requested, total cost, total income, total contribution and contribution as a share
of income from the `Budget` tab, so the header can never disagree with the rows beneath it.
Dropdowns cover `Contribution policy` and the `Budget` tab's `Project` column. Yellow cells are
yours to fill; grey cells are formulas, so leave them alone; green is a header row. The
template's `Status` row can be deleted: the folder is the status.

**Two things that will bite:**

- **Do not add a totals row to the `Budget` tab.** It would be read as a budget line. Totals live
  on `Funding_info`, derived. (`Total` rows *are* safe on the `Forecast` tab, which skips them.)
- **Do not retype the `Forecast` column headers.** Each is a formula anchored on
  `Funding_info!Funding start`, producing `Jul-Sep 26 Forecast` and the quarters after it, so set
  the funding start date and the headers follow. They are deliberately not anchored on `TODAY()`,
  which would relabel a header each quarter while the figure beneath it stayed put. For more than
  four quarters, copy a header cell sideways and add 3 to both `EOMONTH` offsets.

**Checking your work.** Open the Funding Cockpit and look at the **Health** tab, which names the
sheet, the row and what to do. The template imported unaltered produces no findings, so anything
reported afterwards is your own data. If a new sheet does not appear at all, the usual causes are a
tab not named `Budget`, a missing `Start`, `End` or `Cost` column, or a file name that does not
match the Xero tracking value. For Xero to fill in the actuals, transactions need the tags in the
[user guide](USER_GUIDE.md#coding-transactions-in-xero).

---

## Where metadata lives

Preferred: its own **`Funding_info`** tab, `key | value` in columns A and B, read by
`parseFundingInfoTab_`. Rows with an empty column B, such as the tab title, a legend or a section
heading, are skipped, so the tab can be laid out for humans.

Still supported: the same `key | value` pairs as a block **above** the `Budget` column header row,
which `parseBudgetFile_` reads as a fallback. Where both exist, `Funding_info` wins.

## Metadata fields

| Key | Required | Meaning |
|---|---|---|
| `Funding source` | yes | Must equal the file name **and** the Xero *Funding source* tracking value. The cockpit joins budgets to actuals on this string. |
| `Project` | yes | Default project for lines with a blank `Project` cell. Must be a Xero *Projects* tracking value. |
| `Funder` | yes | The organisation. Free text; for reporting and for spotting two applications to the same funder. |
| `Status` | no | Optional, and better left out. The `secured/` or `proposed/` folder the sheet sits in **is** the status, and the cockpit trusts the folder over this field. A second copy can only agree, which adds nothing, or disagree, which is C2. Keep it and it must match the folder. |
| `Funding start` / `Funding end` | yes | The grant period. `Funding end` is what lets the cockpit flag actuals still landing against a finished grant. |
| `Contribution policy` | yes | How much of this source's income funds `General`. One of `none`, `percent_of_income:<n>`, `per_line`. See below. |
| `Amount requested` | yes | GST-exclusive total sought. |
| `Amount secured` | proposed: `0` | GST-exclusive total confirmed. |
| `Decision date` | proposed only | When the funder decides. Blank for secured. Funders ask for this on application forms. |
| `Owner` | yes | Email of whoever maintains this sheet. Health checks are addressed to this person. |
| `Probability` | proposed only | 0 to 100: the chance this ask is won. Drives the "gap after pipeline" figure. Accepts `40`, `40%` or `0.4`; anything at or below 1 is read as a fraction, so `1` means certainty. A `secured` source is always 100 whatever this says. Absent means unknown, and the ask is left out of expected income rather than counted as zero (check **G2**). |
| `Exclusivity group` | when competing | A label shared by applications chasing the **same work**, for example `Advisory role 26/27`. Exactly one member carries the cost; the rest are asks against it. Without this, two parallel applications for one $48,000 role would put $96,000 of budget on the organisation. Secured beats proposed, then largest cost, then name, so the choice is stable between refreshes. Reported as **G3** on the members whose cost is suppressed. |
| `Link` | recommended | Where the grant folder, contract or funding agreement lives. A Drive URL, or a reference code such as `27_TOI_GENERAL`. What the budget is accountable to, one click from the budget itself. Read into metadata but not yet surfaced anywhere in the cockpit. |
| `Last reviewed` | yes | Date last checked against reality. Staleness is otherwise invisible. |
| `Notes` | no | Free text. Not parsed, so never put a number here that something else needs. |

### `Contribution policy`

This replaces hand-computing overheads each quarter and writing the split as prose into a Comments
cell, which nothing could read and which drifted from the project budgets.

| Value | Meaning |
|---|---|
| `none` | Project-specific grant that disallows overheads. Contributes nothing to General. |
| `percent_of_income:40` | 40% of the income on this source's lines that are not already on General funds General. The cockpit derives the amount and shows it as a `<source> (contribution)` row under General. `n` runs 0 to 100. |
| `per_line` | The split is expressed per budget line via the `Project` column, used where some lines are General work and others are project work (for example `WW_25_TOI`). Nothing further is derived: those lines are General's already. |

The margin a budget actually leaves need not match the policy exactly: health check G1 allows ten
points either side, on the budget and on actual spend, so a 40% policy is satisfied by anything
from 30 to 50.

**Delete any negative-cost "Overheads from projects" lines in a General budget.** They are a
hand-maintained copy of the derived number, and now that the cockpit derives it, keeping them
counts General's overhead twice.

## `Budget` tab

With metadata on its own tab, the header row is simply row 1. The example below shows the fallback
layout, a metadata block, one blank row, then the column header row and the budget lines, since the
parser locates the header row either way.

```
A                        | B                      | C ...
-------------------------|------------------------|--------
Funding source           | XXX_27_EXAMPLE         |
Project                  | Wildlife Watcher       |
Funder                   | Example Funder Trust   |
Funding start            | 01/Jul/26              |
Funding end              | 30/Jun/27              |
Contribution policy      | percent_of_income:40   |
Amount requested         | 50000                  |
Amount secured           | 50000                  |
Decision date            |                        |
Owner                    | someone@wildlife.ai    |
Last reviewed            | 01/Jul/26              |
Link                     | https://drive.googl... |
Notes                    | Illustrative only      |
                         |                        |
Description | Start | End | Cost | Income | Contribution | Milestone | Xero Inventory Item | Project | Comments
Delivery lead 0.2 FTE | 01/Jul/26 | 30/Jun/27 | 18000 | 30000 | 12000 | Delivery | XXX_27_EXAMPLE_001 | | invented figures
Product management    | 01/Jul/26 | 30/Jun/27 | 12000 | 20000 | 8000  | Product | XXX_27_EXAMPLE_002 | General | invented figures
```

### Column definitions

| Column | Required | Notes |
|---|---|---|
| `Description` | no | Human label. Read by nothing, but useful when a milestone is split across rows, for example by role. |
| `Start`, `End` | **yes** | A line with either unparseable is **silently skipped**. Use `DD/MMM/YY`. Check the year: `30/Jun/01` parses as 2001, and a line whose End precedes its Start is dropped. |
| `Cost` | **yes** | GST-exclusive. Use `0`, not blank. |
| `Income` | yes | GST-exclusive. A line where `Cost` and `Income` are both `0` is **silently skipped**. |
| `Contribution` | optional | `Income − Cost`, the sheet's own arithmetic, checked by B5. What General receives is decided by the `Contribution policy`, not by this column. **Derived when the column is absent.** |
| `Milestone` | **yes** | The grouping key for the Overview breakdown, the tracking-grid row label and a filter dimension. Blank collapses the source into one `(unassigned)` group. |
| `Xero Inventory Item` | yes | The `{SOURCE}_{NNN}` product/service code, for example `WW_25_TOI_002`. This is the milestone dimension; without it a line falls out of the quarterly tracking grid. |
| `Project` | yes (column) | Per-line override, so one funding source can book some lines to General and the rest to its own project. Blank means "use the `Project` metadata value". The column must exist even if every cell is blank. |
| `Comments` | no | Not parsed. |

### Budget at milestone level (decided 2026-08-11)

**Do not itemise a budget by Xero account.** Budget at milestone level, and split a milestone into
several rows only where that helps you think, by role or by phase, with every row carrying the same
`Xero Inventory Item`. There is no `*Account` column: nothing reads a budget line's account, and
predicting the account split months ahead is wasted effort. Budget versus actual is therefore
available at milestone level, not account level; actuals still carry their account codes from
Xero, so an actuals-only P&L by account remains possible.

**`Milestone` is the column that must be filled.** `Description` is decorative, so if you were
going to fill only one of the two, fill `Milestone`. The minimum viable `Budget` tab is
`Milestone`, `Xero Inventory Item`, `Start`, `End` and `Cost`, plus `Income` wherever the source has
any, plus `Project` where a line belongs elsewhere.

## `Forecast` tab

Optional, and only worth using when you need to override the budget. **A quarter with no entry
here falls back to the budget baseline**, so an empty or absent `Forecast` tab is a valid state: it
means "the budget is still our best estimate". Record a forecast when you know something the budget
does not: a delayed hire, a grant ending early, a re-profiled milestone.

**When you move work to a later quarter, enter `0` in the quarter it left.** A blank there means
the budget still stands, so the grid counts that quarter's budget as well as your new forecast, and
the same work appears twice.

Layout, as parsed by `BudgetReader.parseForecastTab_`:

```
A                                     | B                   | C                   | D
--------------------------------------|---------------------|---------------------|----------
Revenue                               | Jul-Sep 26 Forecast | Oct-Dec 26 Forecast | Comments
Phase one                             | 20000               |                     | on signing
Phase two                             |                     | 20000               | on completion
                                      |                     |                     |
Expenses                              | Jul-Sep 26 Forecast | Oct-Dec 26 Forecast | Comments
Delivery lead - Phase one             | 12000               |                     | invented figures
Delivery lead - Phase two             |                     | 12000               | invented figures
                                      |                     |                     |
Funding Source Details                |                     |                     |
```

### Naming rows in column A

You do not have to type item codes. Column A is resolved against the `Budget` tab at read time
(`buildForecastLabelMap_`), and any of these forms works:

| Form | Example | When to use it |
|---|---|---|
| the milestone | `Baseline model assessment and data ingestion` | **Revenue.** Income sits at milestone grain, and these are the same words as `Submitted_budget` |
| `Description - Milestone` | `Data Scientist - Baseline model assessment and data ingestion` | **Expenses.** The only form that survives a description appearing under two milestones |
| the bare item code | `SPY_26_UOA_001` | existing sheets, still supported |
| the whole `Xero Inventory Item` cell | `SPY_26_UOA_001 - Baseline model assessment` | existing sheets, still supported |
| a description unique in the file | `Coworking desks` | only when nothing else shares that description |

Generate the composite form rather than typing it, so it cannot drift from the `Budget` tab:

```
=Budget!A2 & " - " & Budget!G2
```

(`A` is `Description`, `G` is `Milestone` in the standard column order. Both letters shift on a
sheet carrying extra columns or a metadata block above the header row.)

**Do not sort the `Budget` tab.** Inserting and deleting rows is safe, because Sheets re-points
cross-sheet references on insert and a delete gives you a loud `#REF!`. Sorting does neither: it
moves values while the formulas hold their positions, so every label silently re-points to a
different budget line while the figures beside it stay put. Health check **A10** catches the
duplicate labels this produces.

Matching ignores case and collapses repeated spaces. A label is matched **whole**, never split, so
a description containing ` - ` is safe. A label pointing at more than one item code is refused
rather than guessed at, and reported as **A8**. One milestone spanning several rows is not
ambiguous: those rows share one code, so the candidates collapse to one.

Rules that are easy to get wrong:

- Section headers in column A must read exactly `Revenue` or `Expenses`. Rows before the first
  section header are ignored.
- **Quarter column headers must match `MMM-MMM YY Forecast` exactly**, for example
  `Jul-Sep 26 Forecast`. Anything else is ignored, discarding that quarter's forecast; health
  check **A7** reports it. The template generates the headers, so do not retype them.
- Column A rows under a section must resolve to exactly one `Budget` tab line. A row that resolves
  to nothing, or to more than one, is skipped and reported as **A8**.
- Blank rows and rows whose column A starts with `Total` are skipped.
- Parsing **stops entirely** at a column-A value of `Funding Source Details`. Anything below that
  line is invisible, which makes it a useful place for working notes.
- Each section can carry its own quarter columns; they are re-read per section header.
- A `Comments` column (header exactly `Comments`) attaches one free-text note per milestone,
  shown in the tracking grid. Use it to say *why* a forecast differs from the budget.

Forecast values are per quarter, not per month, and are absolute amounts rather than adjustments.

## Common failures

| Symptom | Cause |
|---|---|
| Budget missing from the dashboard entirely | no `Budget` tab, or a required column absent: the whole file is skipped, and the Health tab reports it |
| Some lines missing | `Cost` and `Income` both `0`, or an unparseable or reversed date |
| Everything in one `(unassigned)` row | `Xero Inventory Item` blank |
| Actuals present, budget shows `0` | sheet name does not match the Xero *Funding source* value |
| Spend looks impossibly low | Xero transactions missing the `Projects` tracking tag are dropped (D1) |
| Forecast total looks doubled | work moved to a later quarter with the old quarter left blank rather than `0` |
