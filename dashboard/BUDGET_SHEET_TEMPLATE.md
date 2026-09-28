# Funding-source budget sheet — template and contract

> **Creating or updating a sheet?** Start from
> [`budget_templates/Budget_sheet_template.xlsx`](../budget_templates/Budget_sheet_template.xlsx)
> rather than transcribing the tables below. One import gives you all four tabs, correctly named,
> with the formulas and dropdowns already wired. This document is the reference for what every
> field means and how each one fails.

Every funding source has one Google Sheet in the Budgets Drive, named **exactly** as its Xero
*Funding source* tracking value (e.g. `WW_25_TOI`), living in its project's `secured/` or
`proposed/` folder.

**At most four tabs:**

| Tab | Role |
|---|---|
| `Funding_info` | sheet-level metadata as `key \| value` rows in columns A and B. |
| `Budget` | the live baseline the cockpit reads. Change only for a genuine re-budget. |
| `Forecast` | per-quarter overrides, where you know something the budget does not. Optional. |
| `Submitted_budget` | frozen record of what the funder was actually given. Never edited. |

Nothing else. Actuals come live from Xero, so a per-sheet copy of them is a second version of the
truth and will drift.

---

## Where metadata lives

Preferred: its own **`Funding_info`** tab, `key | value` in columns A and B, read by
`parseFundingInfoTab_`. Rows with an empty column B - the tab title, a legend, a section heading -
are skipped, so the tab can be laid out for humans.

Still supported: the same `key | value` pairs as a block **above** the `Budget` column header row,
which `parseBudgetFile_` reads as a fallback. Where both exist, `Funding_info` wins.

## `Budget` tab layout

With metadata on its own tab the header row is simply row 1. The example below shows the fallback
layout - a metadata block, one blank row, then the column header row, then the budget lines - since
the parser locates the header row either way.

```
A                        | B                      | C ...
-------------------------|------------------------|--------
Funding source           | XXX_27_EXAMPLE         |
Project                  | Wildlife Watcher       |
Funder                   | Example Funder Trust   |
Status                   | secured                |
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

All numbers in this document are invented. **This is a public repository — never paste real grant
amounts, rates, funder terms or invoice identifiers into it.**

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
| `Probability` | proposed only | 0-100: the chance this ask is won. Drives the "gap after pipeline" figure. Accepts `40`, `40%` or `0.4`; anything at or below 1 is read as a fraction, so `1` means certainty. A `secured` source is always 100 whatever this says. Absent means unknown, and the ask is left out of expected income rather than counted as zero (check **G2**). |
| `Exclusivity group` | when competing | A label shared by applications chasing the **same work**, e.g. `Advisory role 26/27`. Exactly one member carries the cost, the rest are asks against it. Without this, two parallel applications for one $48,000 role would put $96,000 of budget on the organisation. Secured beats proposed; then largest cost; then name, so the choice is stable between refreshes. Reported as **G3** on the members whose cost is suppressed. |
| `Link` | recommended | Where the grant folder, contract or funding agreement lives. A Drive URL, or a reference code such as `27_TOI_GENERAL`. What the budget is accountable to, one click from the budget itself. Read into metadata but not yet surfaced anywhere in the cockpit. |
| `Last reviewed` | yes | Date last checked against reality. Staleness is otherwise invisible. |
| `Notes` | no | Free text. Not parsed — never put a number here that something else needs. |

### `Contribution policy`

This replaces the current practice of hand-computing overheads each quarter and writing the split
as prose into a Comments cell, which nothing can read and which drifts from the project budgets.

| Value | Meaning |
|---|---|
| `none` | Project-specific grant that disallows overheads. Contributes nothing to General. |
| `percent_of_income:40` | 40% of the income on this source's lines that are not already on General funds General. The cockpit derives the amount and shows it as a `<source> (contribution)` row under General. `n` runs 0 to 100. |
| `per_line` | The split is expressed per budget line via the `Project` column, used where some lines are General work and others are project work (e.g. `WW_25_TOI`). Nothing further is derived: those lines are General's already. |

The margin a budget actually leaves need not match the policy exactly: health check G1 allows
ten points either side, on the budget and on actual spend, so a 40% policy is satisfied by
anything from 30 to 50.

**Delete any negative-cost "Overheads from projects" lines in a General budget.** They are a
hand-maintained copy of the derived number, and now that the cockpit derives it, keeping them
counts General's overhead twice.

## Column definitions

| Column | Required | Notes |
|---|---|---|
| `Description` | no | Human label. |
| `Start`, `End` | **yes** | A line with either unparseable is **silently skipped**. Use `DD/MMM/YY`. Check the year: `30/Jun/01` parses as 2001. |
| `Cost` | **yes** | GST-exclusive. Use `0`, not blank. |
| `Income` | yes | GST-exclusive. A line where `Cost` and `Income` are both `0` is **silently skipped**. |
| `Contribution` | optional | `Income − Cost`; the margin funding General. **Derived when the column is absent.** The template carries it as a formula so the number is visible. |
| `*Account` | omitted | Not in the template — nothing reads it. See below. |
| `Milestone` | **yes** | The grouping key for the Overview breakdown, the tracking-grid row label, and a filter dimension. Blank collapses the source into one `(unassigned)` group. |
| `Xero Inventory Item` | yes | The `{SOURCE}_{NNN}` product/service code, e.g. `WW_25_TOI_002`. This is the milestone dimension; without it a line falls out of the quarterly tracking grid. |
| `Project` | yes (column) | Per-line override. Blank means "use the `Project` metadata value". The column must exist even if every cell is blank. |
| `Comments` | no | Not parsed. |

## Budget at milestone level (decided 2026-08-11)

**Do not itemise a budget by Xero account.** Budget at milestone level, and split a milestone into
several rows only where that helps you think — by role, by phase — with every row carrying the same
`Xero Inventory Item`.

| Column | Status in the template |
|---|---|
| `*Account` | **Omitted.** Nothing in the code reads a budget line's account — the only `.account` reads anywhere are in a `WebApp.js` diagnostic over *actuals*. Health check A5 asked for it and has been retired. |
| `Contribution` | **Included as a formula** (`=Income−Cost`) so the number is visible, but the column is optional: the dashboard derives the same value when it is absent. |
| `Description` | **Included.** Read by nothing, but useful for the human detail when a milestone is split across rows — the template uses it for roles (Data Scientist, Project Manager). Just remember `Milestone` is the column that actually groups. |

The consequence to accept: budget-versus-actual is available at milestone level, not account level.
Actuals still carry their account codes from Xero, so an actual-only P&L by account remains
possible — you just cannot compare it against a budget that was never split that way.

**`Milestone` is the column that must be filled.** It is the grouping key for the Overview
breakdown (`project||source||milestone`, `Aggregator.js:76`), the row label in the tracking grid,
and one of the filter dimensions. Leave it blank and every line in that source collapses into a
single `(unassigned)` group. `Description`, by contrast, is decorative — so if you were going to
fill only one of the two, fill `Milestone`.

The minimum viable `Budget` tab is therefore: `Milestone`, `Xero Inventory Item`, `Start`, `End`,
`Cost`, plus `Income` wherever the source has any, plus `Project` where a line belongs elsewhere.

## `Forecast` tab

Optional, and only worth creating when you need to override the budget. **A quarter with no entry
here falls back to the budget baseline**, so an empty or absent `Forecast` tab is a valid state —
it means "the budget is still our best estimate". Record a forecast when you know something the
budget does not: a delayed hire, a grant ending early, a re-profiled milestone.

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
sheet carrying an `*Account` column or a metadata block above the header row.)

**Do not sort the `Budget` tab.** Inserting and deleting rows is safe, because Sheets re-points
cross-sheet references on insert and a delete gives you a loud `#REF!`. Sorting does neither: it
moves values while the formulas hold their positions, so every label silently re-points to a
different budget line while the figures beside it stay put. Health check **A10** catches the
duplicate labels this produces.

Matching ignores case and collapses repeated spaces. A label is matched **whole**, never split, so
a description containing ` - ` is safe. A label pointing at more than one item code is refused
rather than guessed at, and reported as **A8**. One milestone spanning several accounts is not
ambiguous: those lines share one code, so the candidates collapse to one.

Rules that are easy to get wrong:

- Section headers in column A must read exactly `Revenue` or `Expenses`. Rows before the first
  section header are ignored.
- **Quarter column headers must match `MMM-MMM YY Forecast` exactly** — e.g. `Jul-Sep 26 Forecast`.
  Anything else is silently ignored, so a typo in one heading quietly discards that quarter's
  forecast with no error. Health check **A7** exists for this.
- The template generates them with a formula anchored on `Funding_info!Funding start`, so nobody
  types a year. Do **not** re-anchor that formula on `TODAY()`: the header would then relabel itself
  each quarter while the figure beneath it stayed put, applying every forecast to the wrong quarter.
  The parser reads the computed value, so a formula header is fine.
- Column A rows under a section must resolve to exactly one `Budget` tab line. See *Naming rows in
  column A* above for the forms accepted. A row that resolves to nothing, or to more than one, is
  skipped and reported as **A8**.
- Blank rows and rows whose column A starts with `Total` are skipped.
- Parsing **stops entirely** at a column-A value of `Funding Source Details`. Anything below that
  line is invisible, which makes it a useful place for working notes.
- Each section can carry its own quarter columns; they are re-read per section header.
- A `Comments` column (header exactly `Comments`) attaches one free-text note per milestone,
  surfaced in the tracking grid. Use it to say *why* a forecast differs from the budget.

Forecast values are per quarter, not per month, and are absolute amounts rather than adjustments.

## Common failures

| Symptom | Cause |
|---|---|
| Budget missing from the dashboard entirely | no `Budget` tab, or a required column absent — the whole file is skipped with only a log line |
| Some lines missing | `Cost` and `Income` both `0`, or an unparseable/reversed date |
| Everything in one `(unassigned)` row | `Xero Inventory Item` blank |
| Actuals present, budget shows `0` | sheet name does not match the Xero *Funding source* value |
| Spend looks impossibly low | Xero transactions missing the `Projects` tracking tag are dropped entirely |

## Parser change this template requires

`BudgetReader.parseBudgetFile_` currently treats **row 1** as the column header row
(`const header = data[0]`). The metadata block above the columns therefore needs the parser to
**locate** the header row rather than assume it — scan the first ~30 rows for one containing both
`Start` and `Cost`, then read metadata as key/value pairs from column A/B of the rows above it.

Deploy that change **before** rolling the template out to existing sheets, or every sheet with a
metadata block will be skipped for a missing column.
