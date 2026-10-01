# Using the Funding Cockpit

A plain-English guide to the dashboard: what it shows, where the numbers come from, and how to
change a budget or a Xero transaction so the dashboard reflects it. It is written for anyone
with access. Tasks only the GM can do are marked **GM**.

## Opening it

**<https://script.google.com/a/macros/wildlife.ai/s/AKfycbxCjtIS-xnIdySCtFF7vibrW0qhhnMcnzFs0GCPK0SXrzFzV5-WZtNnpkyTWfbLdAqs/exec>**

Sign in with your `wildlife.ai` Google account and bookmark it. The link never changes.

You see the projects you have been given access to. To get access, or access to more projects,
ask the GM.

**GM:** access lives in the **Cockpit Settings** sheet in the Budgets Drive folder, on its
`Permissions` tab: one row per person, their email in column A and the projects they may see in
column B, comma separated, or `*` for everything. A project lead sees only their projects'
figures and health findings, plus the warnings that mean every number on screen is stale.

The figure top-right ("synced 30 Sep 2026, 9:14 am", New Zealand time) says when the data was
last pulled, next to today's date. It
refreshes itself roughly every 6 hours; click **Refresh now** to pull the latest immediately. A
refresh takes about a minute, and a progress bar shows which phase it is in
(`Reading WW_25_TOI (6 of 9)`, `Fetching Xero Invoices, page 2`).

## Four tabs

- **Overview**: the organisation-wide picture, with a runway chart you can regroup and filter
  (below).
- **Quarterly tracking**: one funding source, or the whole General project, milestone by
  milestone and quarter by quarter. See [Tracking and forecasting](#tracking-and-forecasting-quarterly).
- **Project planner**: milestones on a timeline, coloured by funding status, with optional
  Cost, Income and Profit and loss columns.
- **Health**: sheet, Xero-coding and system problems found on the last refresh. The tab carries
  a badge: red when a number on screen is wrong right now, amber when one may be, nothing when
  clean. Each finding says what is wrong, where, the amount at stake and what to do, with a
  link to the sheet. [Health checks](HEALTH_CHECKS.md) explains every one.

## What you're looking at (Overview)

**Show** (secured, proposed) and **filter** (projects, funding sources), under the heading, apply
to everything on the tab: the cards and the runway. The year selector applies to the cards only,
because runway always runs from today.

1. **Summary cards**: totals for the period picked in the selector, the current
   financial year by default, a later one, or all time (finished years are only inside all
   time): forecast budget, secured funding, actual spent, the **unsecured gap** (budget not yet
   covered by secured funding) and the **gap after pipeline** (what is still uncovered once
   applications are counted at their probability). When income covers the budget, the card
   shows the **surplus** instead.
2. **Runway**: *Net position today* is income received minus spend to date. The tiles give the
   months until cumulative spend overtakes cumulative income: on secured money only, on the
   probability-weighted pipeline, and if every application lands, each naming the month it goes
   short. "Beyond *month*" means no shortfall before the last budgeted month, which is not the
   same as safe: the budgets may simply stop there. The chart is the same walk month by month,
   Xero actuals to last month and the plan from this month on; the vertical rule is today,
   shaded months are budget, and a hollow dot is where a line goes below zero. This is
   **funded** runway, not cash: the cockpit reads no bank balance. Because it is the whole
   organisation's position, only people with access to every project see it.

   **Group by** changes the chart only. **Status** draws the three lines above. **Project**,
   **Funding source** or **Milestone** draws one line per group, counting applications at their
   probability (secured money only if *Proposed* is unticked); the lines add up to the
   organisation's. The largest groups are named and the rest share an "Other" line. **Show as a
   table** lists every value the chart draws.

Grouped by project, General's line includes the share of each project's income its
`Contribution policy` sends to General to pay for overheads; the project's line keeps the rest.
Grouped by milestone, those shares appear as lines named like `SPY_26_UOA (contribution)`.

## Where each number comes from

| On the dashboard | Comes from | Lives where |
|---|---|---|
| Budget (Cost and Income per milestone) | The funding source's **`Budget` tab** | Budgets Drive |
| Secured vs proposed | Which **folder** the budget sits in (`secured/` or `proposed/`) | Budgets Drive |
| Which project a line counts toward | The **`Project` column** on the `Budget` tab; blank means the budget's own project folder | Budgets Drive |
| General's overhead from other projects, the `(contribution)` rows | Each sheet's **`Contribution policy`**: `percent_of_income:40` sends 40% of that source's income to General | `Funding_info` tab |
| Actual spent and received | **Approved Xero transactions**, split by the *Projects* and *Funding source* tracking categories | Xero |
| Milestone-level actuals | The **product/service** code on each Xero line (`WW_25_TOI_002` and so on) | Xero |
| Quarterly forecasts | The funding source's own **`Forecast` tab** | Budgets Drive |

## How to change what the dashboard shows

After any change below, the dashboard updates at the next 6-hourly refresh, or right away if you
click **Refresh now**.

- **A budgeted amount is wrong**: open that funding source's sheet, go to the **`Budget` tab**,
  and edit the `Cost`, `Income`, `Start` or `End` for the line. Change the `Budget` tab only for a
  genuine re-budget; routine changes of timing belong on the `Forecast` tab.
- **A line should count toward a different project**, such as a `WW_25_TOI` line that is really
  General overhead: set the **`Project`** column on that line to the project's exact Xero
  *Projects* name, for example `General`. Leave it blank for lines that belong to the budget's
  own project folder.
- **An actual looks wrong or missing**: the figure comes straight from Xero, so it is almost
  always a coding issue. See [Coding transactions in Xero](#coding-transactions-in-xero).
- **A proposal has been won**: move its sheet from `proposed/` to `secured/`. The folder is the
  status; the secured forecast counts `secured/` only, the proposed forecast counts both.
- **A funding source has finished**: see [Archiving a funding source](#archiving-a-funding-source).

## Tracking and forecasting (quarterly)

The **Quarterly tracking** tab replaces the old "Budget, Actual, Forecast Tracking" tab that
used to live in each sheet. You no longer keep one per funding source, and you no longer copy
Xero into each sheet by hand.

Pick something to track from the dropdown:

- **General (project)**: the whole General project, gathering its milestones from every funding
  source, plus the `(contribution)` rows from projects that pay overhead into it, over the
  elapsed quarters of this financial year and six quarters ahead.
- each **funding source**: an **"Up to last FY"** column lumping everything before this
  financial year, then this year's quarters, then next year's if the funding runs that long.

Quarters follow our **financial year (April to March)**: Q1 is Apr to Jun, Q2 Jul to Sep, Q3 Oct
to Dec, Q4 Jan to Mar, labelled like `25/26 Q1`. The **Cost / Income / Net** toggle switches what
the grid shows; Net is income minus cost, so whether each milestone pays for itself.

The grid has **milestones down the side and quarters across the top**, and each cell shows:

- the **budget** for that quarter, from the `Budget` tab, small underneath;
- for quarters already finished, what was actually spent, from Xero;
- for quarters to come, the **forecast** from the funding source's `Forecast` tab, or the budget
  where no forecast was written ("budget, no override").

**To change a forecast, edit the funding source's own `Forecast` tab**, not the dashboard; the
grid is read-only and picks the change up at the next refresh. Two rules matter:

- **A row left entirely blank means "the budget still stands"** for that milestone. An untouched
  `Forecast` tab therefore means the budget is still your best estimate, which is the normal state.
- **Once a row has any number, that row is the plan** for every quarter the tab has a column for,
  and its blank cells count as `0`. The `Budget` tab's dates stop applying to those quarters, on
  the grid, the Overview, the runway and the planner alike, so a row that starts in Oct-Dec needs
  nothing typed in the quarters before it. Quarters the tab has no column for keep the budget.

The `Comments` column on the `Forecast` tab appears beside each milestone: use it to say why a
forecast differs from the budget.

**Nothing from Xero is dropped.** Money coded to a product/service that is not a budget milestone
appears as its own **"(unbudgeted)"** row, and anything with no product/service at all lands in
an **"Unassigned"** row, so the totals always reconcile to Xero.

The totals on the right are **Budget**, **Actual to date**, **Expected** (actual for past quarters
plus the forecast for the rest) and **Variance** (Expected minus Budget: red is heading over,
green under). Review this once a quarter with the project leads: what actually landed, then
adjust the `Forecast` tabs.

## Coding transactions in Xero

Every number on the dashboard depends on how transactions are coded when they are entered. For
a transaction to reach the right place, each line needs:

- the **Projects** tracking category, for example `Wildlife Watcher`;
- the **Funding source** tracking category, for example `WW_25_TOI`, spelt exactly like the
  budget sheet's file name;
- the **product/service** item for the milestone, for example `WW_25_TOI_002`.

Only **approved** invoices and bills count. Drafts and anything awaiting approval are left out,
as they are from Xero's own reports; the Health tab says how many are waiting (F6). Payroll
posts through Xero Payroll as bills, so salary lines need the same three tags.

The Health tab reports what is missing: spend with no Projects tag (D1), no Funding source tag
(D2), no item code (D3), a Funding source with no budget sheet (D4), and spend still arriving
after a grant has ended (D6), which is usually a stale repeating template.

## Archiving a funding source

When a grant has finished and been reported, rename its sheet with the `Z_ARCH_` prefix and move
it to the project's `archived/` folder. It leaves the dashboard at the next refresh, and so does
its spend, so organisation totals never show spend with no budget beside it. Keep its item codes
unchanged in Xero, so historical actuals still reconcile.

## If a project looks off

1. Click **Refresh now** in case you are looking at stale data.
2. Read the **Health** tab. Most wrong numbers are already named there, with the fix.
3. Check the sheet's `Budget` tab totals make sense: `Cost`, `Income` and the dates.
4. Check the Xero coding for that project and funding source.
5. Still stuck? Ask the GM, who can see in the Apps Script editor's **Executions** log exactly
   what the last refresh read.
