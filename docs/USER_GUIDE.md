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

The line under **Refresh now** ("synced 30 Sep 2026, 9:14 am", New Zealand time) says when the
data was last pulled. It refreshes itself roughly every 6 hours; click the button to pull the
latest immediately. A refresh takes about a minute, and a progress bar shows which phase it is
in (`Reading WW_25_TOI (6 of 9)`, `Fetching Xero Invoices, page 2`).

## Three tabs

- **Overview**: the organisation-wide picture, with a runway chart you can regroup and filter
  (below).
- **Project tracking**: one project at a time, its funding sources and their milestones quarter
  by quarter, as an actual-and-forecast grid or as a timeline. See
  [Tracking and forecasting](#tracking-and-forecasting-quarterly).
- **Health**: sheet, Xero-coding and system problems found on the last refresh. The tab carries
  a badge: red when a number on screen is wrong right now, amber when one may be, nothing when
  clean. Each finding says what is wrong, where, the amount at stake and what to do, with a
  link to the sheet. [Health checks](HEALTH_CHECKS.md) explains every one.

Each tab's controls sit in a ribbon of dropdown boxes, grouped and named underneath. The title
under the ribbon names what was chosen, so a screenshot says what it is, and the **?** at its
right opens a short reminder of what is on screen; this guide has the rest.

## What you're looking at (Overview)

The ribbon at the top has three groups. **Filter** (the year, projects, funding sources) and
**Show** (secured, proposed) apply to everything on the tab, the cards and the runway, except
that the year applies to the cards only, because runway always runs from today. **Group by**
changes the runway chart only. The title under the ribbon names what was chosen, and the **?**
at its right explains the cards and the chart. Under the line come the cards, then the chart.

1. **Summary cards**: totals for the period picked in the selector, the current
   financial year by default, a later one, or every year from this one on together (finished
   years are left out): **expected cost** (actual spend for the months gone, plus the plan for the rest),
   secured funding, actual spent, the **unsecured gap** (expected cost not yet covered by secured
   funding) and the **gap after pipeline** (what is still uncovered once applications are counted
   at their probability). When income covers the cost, the card shows the **surplus** instead.
2. **Runway**: income minus spend, walked month by month, Xero actuals to last month and the
   plan from this month on. The chart starts three months before the current financial year.
   The vertical rule is today, labelled with the *net position*, income received minus spend to
   date; shaded months are budget, and a hollow dot is where a line goes below zero. The three
   lines are secured money only, the probability-weighted pipeline, and every application
   landing. Each line's label at the right edge gives the months until cumulative spend
   overtakes cumulative income and the month it goes short. "Beyond *month*" means no shortfall
   before the last budgeted month, which is not the same as safe: the budgets may simply stop
   there. Because it is the whole organisation's position, only people with access to every
   project see it.

   **Reserves** make it the actual runway. Xero cannot give the cockpit a bank balance, so at
   each quarter-end close add a row to the `Reserves` tab of the **Cockpit Settings** sheet:
   the date (a month end), the money free to spend that day, and how you worked it out. Free
   money is the bank balance minus grant money received but not yet spent, which the chart
   already counts as income as it is spent. The next refresh uses the latest row: with every
   project and source shown and grouped by status, all three lines start from it, so
   **Secured only** is reserves plus secured funding against the plan, and the label at today
   reads "with reserves". Any narrower view, filtered or grouped, is funded money only, because
   reserves belong to no one project. With no row, every view is funded money only.

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
| Actual spent and received | **Approved Xero transactions and the accountant's posted journals**, counted as Xero's P&L counts them, split by the *Projects* and *Funding source* tracking categories. A sheet marked `Income recognition: as spent` earns its income as it spends instead | Xero |
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

The **Project tracking** tab replaces the old "Budget, Actual, Forecast Tracking" tab that used
to live in each sheet. You no longer keep one per funding source, and you no longer copy Xero
into each sheet by hand.

Pick a **project**. The tab shows every funding source with a milestone on it, each under its
own heading with a 📄 link to its sheet and its own subtotals; click the heading to fold its
milestones away and back. General also gathers the `(contribution)` rows from the projects that
pay overhead into it. The ribbon narrows what is
shown, in both views:

- **View**: Actual and forecast, with its Cost / Income / Net measure, or Timeline, with its
  optional columns.
- **Filter**: the quarters, from and to (the default runs from this financial year's first
  quarter to the last quarter any source in the project budgets), funding sources and
  milestones.
- **Show**: secured or proposed money, and finished milestones; untick those to drop the ones
  with nothing in the quarters shown and over before them.

Quarters follow our **financial year (April to March)**: Q1 is Apr to Jun, Q2 Jul to Sep, Q3 Oct
to Dec, Q4 Jan to Mar, labelled like `25/26 Q1`.

**Actual and forecast** has milestones down the side and quarters across the top. A first
**"Before"** column lumps every quarter earlier than the first shown, so the totals on the right
are always the whole funding source. The **Cost / Income / Net** box switches what the grid
shows; Net is income minus cost, so whether each milestone pays for itself. Each cell shows:

- the **budget** for that quarter, from the `Budget` tab, small underneath;
- for quarters already finished, what was actually spent, from Xero;
- for quarters to come, the **forecast** from the funding source's `Forecast` tab, or the budget
  where no forecast was written ("budget, no override").

**Timeline** draws a bar across the quarters each milestone runs, green when the money paying
for it is secured and amber when proposed. Hover a quarter for its budget, and its actual once
the quarter has begun. Optional **Cost**, **Income** and **Profit and loss** columns total the
quarters shown, per milestone and per source.

**To change a forecast, edit the funding source's own `Forecast` tab**, not the dashboard; the
grid is read-only and picks the change up at the next refresh. On the Overview, the timeline and
the runway the plan works like this:

- **Months already gone are what Xero shows.** A forecast only shapes the months to come.
- **A row left entirely blank means "what is left of the budget"**: the budget minus what has
  been spent so far, spread over the line's remaining months in the `Budget` tab's shape. So an
  untouched `Forecast` tab is fine, and an underspend rolls forward on its own. A line whose end
  date has passed plans nothing more: if the work is late, type it into a later quarter.
- **Once a row has any number, that row is the plan** for every quarter the tab has a column for,
  and its blank cells count as `0`, so a row that starts in Oct-Dec needs nothing typed in the
  quarters before it. Quarters the tab has no column for keep the budget.
- **Leave a Revenue row blank when income follows the spend**, as a grant's does: it then follows
  the milestone's cost forecast at the budget's income-to-cost ratio, and never takes the funding
  source past its budgeted income. Type a Revenue row only when the money arrives on its own
  timetable, such as a contract paid per milestone.

The grid itself still shows the budget as each quarter's baseline, and the forecast or the budget
for quarters to come, so it stays the place to compare against what was agreed.

The `Comments` column on the `Forecast` tab appears beside each milestone: use it to say why a
forecast differs from the budget.

**Nothing from Xero is dropped.** Money coded to a product/service that is not a budget milestone
appears as its own **"(unbudgeted)"** row, and anything with no product/service at all lands in
an **"Unassigned"** row, so the totals always reconcile to Xero. The one exception: a source's
grid starts at the earlier of its `Funding start` and its first budget line, so spend dated
before then, such as a renamed Xero option's history, is left out of the grid. The Overview and
the runway still count it.

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

The accountant's **posted manual journals** count too, as Xero's P&L counts them, so each journal
line needs the Projects and Funding source tags. Journals cannot carry an item code, so they land
on the funding source rather than a milestone. A refund coded to an expense account lowers that
spend. A grant paid upfront and released by journal as it is spent is marked
`Income recognition: as spent` on its sheet, and then earns its income from its own spend; D8
names any the journals defer that are not marked.

The Health tab reports what is missing: spend with no Projects tag (D1), no Funding source tag
(D2), no item code (D3), a Funding source with no budget sheet (D4), and spend still arriving
after a grant has ended (D6), which is usually a stale repeating template. **Show the lines**
under each lists the transactions to fix in Xero. All but D4 look at this financial year only,
since earlier years' books are closed.

## Archiving a funding source

When a grant has finished and been reported, rename its sheet with the `Z_ARCH_` prefix and move
it to the project's `archived/` folder. It leaves the dashboard at the next refresh, and so does
its spend, so organisation totals never show spend with no budget beside it. Keep its item codes
unchanged in Xero, so historical actuals still reconcile.

**Keep only archived funding-source sheets in `archived/`.** The cockpit drops Xero money tagged
with the name of a sheet there that is shaped like a funding source (`WW_25_TOI`, with or without
`Z_ARCH_`), and ignores anything else, so other old files do no harm, but they belong in
`Z_ARCH_old_budgets`.

## If a project looks off

1. Click **Refresh now** in case you are looking at stale data.
2. Read the **Health** tab. Most wrong numbers are already named there, with the fix.
3. Check the sheet's `Budget` tab totals make sense: `Cost`, `Income` and the dates.
4. Check the Xero coding for that project and funding source.
5. Still stuck? Ask the GM, who can see in the Apps Script editor's **Executions** log exactly
   what the last refresh read.
