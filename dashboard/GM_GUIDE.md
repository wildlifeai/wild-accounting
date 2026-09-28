# Funding Cockpit - guide for the General Manager

A plain-English guide to the dashboard: what it shows, where the numbers come from, and how
to change a budget or a Xero transaction so the dashboard reflects it.

## Opening it

**<https://script.google.com/a/macros/wildlife.ai/s/AKfycbxCjtIS-xnIdySCtFF7vibrW0qhhnMcnzFs0GCPK0SXrzFzV5-WZtNnpkyTWfbLdAqs/exec>**

Sign in with your `wildlife.ai` Google account and bookmark it. The link never changes.

The figure top-right ("synced Nh ago") tells you how fresh the data is, next to today's date.
It refreshes itself roughly every 6 hours; click **Refresh now** to pull the latest
immediately.

A refresh takes about a minute, and a progress bar shows which phase it is in
(`Reading WW_25_TOI (6 of 9)`, `Fetching Xero Invoices, page 2`). Most of that minute is
Drive and Xero, not the dashboard.

## Five tabs

- **Overview** - the org-wide picture with a flexible breakdown (below).
- **Quarterly tracking** - where you track spend against one funding source at a time. This
  replaces the old per-funding-source "Budget, Actual, Forecast Tracking" tab - see
  ["Tracking and forecasting"](#tracking-and-forecasting-quarterly) below.
- **Project planner** - milestone segments on a timeline, coloured by funding status.
- **Five-year plan** - the tabular view for project leads: one row per funding source,
  milestone and financial year, showing what it costs, what is secured and what is still
  an application. Answers "what am I delivering, when, and is it paid for".
- **Health** - sheet, Xero-coding and system problems found on the last refresh. The tab
  carries a count badge: red for errors, amber for warnings, nothing when clean. **If that
  badge is showing, a number somewhere on the dashboard is wrong.**

## What you're looking at (Overview)

1. **Summary cards** - organisation totals: forecast budget, secured funding, actual spent
   to date, and the headline **unsecured gap** (money still to be raised = proposed budget
   minus secured funding).
2. **Runway** - organisation-wide and outside every filter on the page. *Net position
   today* is secured income received minus spend to date. The three tiles give the months
   until cumulative spend overtakes cumulative income: on secured money only, on the
   probability-weighted pipeline, and if every application lands, each naming the month
   it goes short. "Beyond *month*" means no shortfall before the last budgeted month,
   which is not the same as safe: the budgets may simply stop there. The chart is the
   same walk month by month, Xero actuals to last month and the Budget tabs from this
   month on; the vertical rule is today, shaded months are budget, and a hollow dot is
   where a line goes below zero. This is **funded** runway, not cash; the cockpit reads
   no bank balance.
3. **Breakdown** - a table you can slice with the `group by:` checkboxes at the top right.
   Tick any combination of:
   - **Project** (e.g. Wildlife Watcher, Spyfish, General),
   - **Funding source** (e.g. WW_25_TOI), and
   - **Status** (secured/confirmed vs proposed).

   For each group you see *Budget* (proposed forecast), *Secured* (confirmed funding),
   *Actual* (live from Xero), and a *Spent vs budget* bar (green within budget, red over
   budget). The table regroups instantly when you change the checkboxes - e.g. tick just
   Project for the org view, or Funding source + Status to see each grant split into its
   confirmed and proposed parts.

## Where each number comes from

| On the dashboard | Comes from | Lives where |
|---|---|---|
| Budget (Cost / Income per milestone) | The funding source's **`Budget` tab** | Budgets GDrive |
| Secured vs proposed | Which **folder** the budget sits in (`secured/` vs `proposed/`) | Budgets GDrive |
| Which project a line counts toward | The optional **`Project` column** on the `Budget` tab; blank = the budget's parent project folder | Budgets GDrive |
| General's overhead from other projects, the `(contribution)` rows under General | Each sheet's **`Contribution policy`**: `percent_of_income:40` sends 40% of that source's income to General | `Funding_info` tab |
| Actual spent | **Xero transactions**, split by the *Projects* and *Funding source* tracking categories | Xero |
| Milestone-level actuals | The **product/service** code on each Xero transaction (`WW_25_TOI_002` etc.) | Xero |

## How to change what the dashboard shows

After any change below, the dashboard updates at the next 6-hourly refresh, or right away if
you click **Refresh now**.

- **A budgeted amount is wrong** - open that funding source's Gsheet, go to the **`Budget`
  tab**, and edit the `Cost`, `Income`, `Start`, or `End` for the line. (The dashboard reads
  the `Budget` tab, not the tracking tab.)
- **A milestone should count toward a different project** (e.g. a `WW_25_TOI` line that's
  really General overhead) - set the **`Project`** column on that line to the project's exact
  Xero *Projects* name (e.g. `General`). Leave it blank for lines that belong to the budget's
  own project folder.
- **An actual looks wrong or missing** - the figure is straight from Xero, so it's almost
  always a coding issue. Find the transaction in Xero and check it's tagged with the right
  *Project*, *Funding source*, and *product/service* item. This is the same reconcile loop as
  "Maintain a Funding Source Budget".
- **Move a proposal to secured** (or vice-versa) - move the Gsheet between the `proposed/`
  and `secured/` folders. Secured forecast counts `secured/` only; proposed forecast counts
  both.
- **Retire a finished funding source** - follow "Archive Funding Source Budget" (rename with
  `Z_ARCH_`, move to the archived folder). It drops off the dashboard automatically.

## Tracking and forecasting (quarterly)

The **Quarterly tracking** tab is your replacement for the old "Budget, Actual, Forecast
Tracking" sheet - but you no longer keep one per funding source, and you no longer sync Xero
into each sheet by hand.

Pick something to track from the dropdown. It lists:
- **General (project)** - the whole General project, aggregating its milestones across every
  funding source, with a rolling **1.5-year** forecast horizon (the elapsed quarters of this
  financial year plus six quarters ahead).
- each **funding source** - shown as **"Up to last FY"** (one column lumping everything before
  this financial year), then this financial year's quarters, then next year's quarters if the
  funding runs that long.

Quarters follow our **financial year (April-March)**: Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 =
Oct-Dec, Q4 = Jan-Mar, labelled like `25/26 Q1`.

Use the **Cost / Income / Net** toggle to switch what the grid shows:
- **Cost** - what you spend on each milestone.
- **Income** - what you've *received* for each milestone (from Xero), against the budgeted
  income.
- **Net** - income minus cost, i.e. whether each milestone is paying for itself. Net is
  derived, so it's read-only.

You get a grid: **milestones down the side, quarters across the top**. Each cell has three
layers:

- **Baseline** (shown small under each cell) - the original budget from the `Budget` tab.
  It's frozen, so you can always see how far you've drifted from the plan.
- **Actual** - for quarters that have already passed (and the "Up to last FY" column), the
  cell shows real spend from Xero. You can't edit these - they're facts.
- **Forecast** - for the current quarter and future quarters, the cell is an **editable box**.
  It starts at the budget baseline. Type a new number if you now expect to spend more or less;
  the box highlights to show it's an override. Clear the box to snap back to budget.

- **Comment** - the last column on each milestone row is a free-text box to record **why**
  you're forecasting what you are (e.g. "contractor starts Q3", "grant extension pending").
  One comment per milestone; it saves with the forecast.

**Nothing from Xero is dropped.** If money is coded to a product/service that isn't a budget
milestone (e.g. income booked to a "Cash received" item), it appears as its own
**"… (unbudgeted)"** row. Anything with no product/service at all (and no code in its
description) lands in an **"Unassigned"** row. This keeps the **Total** line reconciled to
Xero - so total income received and total spend always match the funder report - even when
coding doesn't line up perfectly with the budget.

Your edits save immediately to a shared Forecast sheet, and the totals on the right recompute:

- **Budget** - original planned total for that milestone.
- **Actual to date** - spent so far (from Xero).
- **Expected** - actual for past quarters + your forecast for the rest.
- **Variance** - Expected minus Budget. Red means you're heading **over** budget, green means
  **under**.

Do this once a quarter (with input from the project managers): review what actually landed,
then adjust the forward forecast. The Overview totals then reflect your latest view.

What you no longer need to do: pull Xero transactions into each funding-source sheet, or keep
a separate tracking tab per source. Actuals are automatic; the forecast lives in one place.

## If a project looks off

1. Click **Refresh now** in case you're looking at stale data.
2. Check the budget's `Budget` tab totals make sense (`Cost`/`Income`, dates).
3. Check Xero coding for that project / funding source (miscoded or untagged transactions are
   the usual cause of a wrong *Actual*).
4. Still stuck? Contact the maintainer (see the technical README) - the *Executions* log shows
   exactly what the last refresh read.
