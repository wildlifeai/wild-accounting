# Design: why Wild Accounting exists and what it is for

The reasoning behind the tools, the people they serve, what they are required to do and how far
they get, the decisions that shaped them, and how the repository got here. For how to use the
cockpit see the [user guide](USER_GUIDE.md); for how to change it, [`AGENTS.md`](../AGENTS.md).

## Why this exists

Wildlife.ai runs on restricted funding. Money arrives tied to a funder, a period, a project and a
set of milestones, and it has to be reported back in that shape while the organisation is
simultaneously answering "can we pay the rent". That is fund accounting, and no single tool we can
buy does it for us:

- **Xero allows two tracking categories.** We need four dimensions: account, project, funding
  source and milestone. The fourth is carried on the Product/Service item code, which is a
  workaround, not a preference.
- **Xero reports by account, not by milestone.** Budget-versus-actual add-ons (Syft, Fathom,
  Spotlight) inherit that, so none of them can produce the per-milestone variance a funder asks
  for.
- **Overhead recovery is capped at 40%** by what funders will accept, so there is no headroom to
  fund a commercial fund-accounting platform out of grant overhead.
- **Sheets stays in the architecture** because collaborators build one budget at a time and must
  not see the organisation-wide picture. That is why aggregation lives in the cockpit rather than
  in a master spreadsheet.

The cost of this decision is about 3,900 lines of bespoke server-side Apps Script, plus the
dashboard's interface, for about ten funding sources. The milestone dimension is what we are
paying for.

## Who it is for

| # | Persona | The question they are asking | Cadence |
|---|---|---|---|
| 1 | **Board and Treasurer** | Are we solvent and on plan? | Quarterly |
| 2 | **GM** | Where do I put the next dollar, and what do I ask for next? | Continuous |
| 3 | **Project lead** | Am I over or under on my funder's money? | Monthly |
| 4 | **Bookkeeper** | Code it right, pay it on time. | Fortnightly or monthly |
| 5 | **Funder** | What did our money do? | Per funding round |
| 6 | **Collaborator** | Help me build this one budget. | Ad hoc |

**Board and Treasurer** want quarterly forecast, annual budget, quarterly P&L and working capital.
Read-only, organisation-wide, no interest in individual lines. Their defining need is completeness
and immutability: the number reported in August must still be reproducible in November. Once a
year this persona becomes the independent reviewer, and needs budget to Xero to statement
traceability.

**GM** is the power user and the only persona needing every dimension at once: unsecured gap,
overhead flowing into General, which funder pays for which milestone, and what to put in the next
application.

**Project lead** needs per-funding-source variance monthly, a project rollup across funding
sources, and remaining budget per milestone without opening Xero.

**Bookkeeper** never opens the cockpit but determines whether it works, because every downstream
number depends on the tags being present at the moment of entry. Historically the weakest link,
because nothing said when a tag was missing.

**Funder** sees one funding source, their period, their format, and nothing else.

**Collaborator** edits a single sheet and needs no organisation-wide visibility.

## The eleven requirements

Status as at 29 September 2026. This table is the test specification: "does the cockpit work"
means "does it answer these".

| # | What | Freq | Persona | Source of truth | Today |
|---|---|---|---|---|---|
| 1 | Forecast reported to Board | Q | Board | Cockpit: secured + weighted pipeline, frozen | Runway on the Overview on secured, weighted and all-proposed money, and a gap after pipeline. **Freezing does not exist**: the snapshot is overwritten every 6 hours, so August's figure is gone by November |
| 2 | Annual organisation budget | A | Board, GM | Cockpit: all funding sources + General | Exists. General's overhead is derived from each sheet's `Contribution policy`, the same way in every view |
| 3 | P&L (income and expenses) | Q | Board | Xero | Approved bank transactions, invoices and bills. Payroll posts as Xero Payroll bills and reaches the cockpit; milestone grain depends on each line carrying an item code, which D3 reports |
| 4 | Working capital balance and forecast | Q | Board, Treasurer | Xero balance sheet + deferred grants | **Absent.** Needs a Xero scope the cockpit does not hold |
| 5 | Bill payments | M | Bookkeeper | Xero | Native Xero. Deliberately out of scope |
| 6 | Payroll | F | Bookkeeper | Xero Payroll | Posts as bills with both tracking categories. The Health tab flags untagged spend (D1, D2), missing item codes (D3), tags with no sheet (D4) and spend after a grant ended (D6). **Not routed to the bookkeeper**: someone has to read the Health tab |
| 7 | Funding source income and expense variance | M | Project lead | Cockpit | Exists, on Quarterly tracking. Monthly cadence not enforced |
| 8 | Funding source budget | per funder | GM | Sheets template | Template and validation exist: 40 health checks across sheet structure, data quality, metadata, Xero coding, reconciliation and the funding pipeline |
| 9 | Funding source summary | per funder | Funder | Cockpit export | **Absent.** No funder-facing output of any kind; every funder report is hand-built |
| 10 | Project budget overview | per project | Project lead, GM | Cockpit rollup | Exists: Overview grouped by project, and the Five-year plan |
| 11 | YTD P&L | Q | Project lead, then Board | Cockpit, per project YTD | Partial |

### The gaps that cost the most

Ranked by how badly they hurt the persona who depends on them:

1. **No immutability (#1).** The Board's defining need, and the refresh trigger overwrites the
   snapshot four times a day.
2. **No funder-facing output (#9).** The one requirement an external party sees has no
   implementation at all.
3. **Working capital and cash are absent (#4).** The Board cannot see the balance sheet here.
4. **Findings reach nobody unprompted (#6).** Every sheet names an `Owner`, but nothing tells that
   person, or the bookkeeper, that a finding is theirs.

## Open questions and known limits

- **Period freezing.** The snapshot is a performance cache, not an audit record. Freezing needs a
  dated copy per reporting period and a way to show it.
- **The current quarter shows actual to date** in the tracking grid rather than the forecast, so
  mid-quarter it understates that column and annual Expected with it. Whether it should be actual
  plus the rest of the forecast is undecided.
- **Two income attributions.** The project rollup behind the organisation totals splits a source's
  income by each project's share of its cost, while the Overview breakdown credits each line's own
  income. They agree for most sheets and can differ slightly for one whose lines are not priced in
  proportion to their cost. Only the breakdown is on screen.
- **Cash runway is out of scope** (decided 2026-09-21). It needs `accounting.reports.read`, a Xero
  re-consent and a balance-sheet read, and scopes cannot be removed from a live token without
  re-consent, so adding one is not a casual change.
- **Manual journals are not read.** Payroll no longer needs them, but anything still booked as a
  journal is invisible. What reading them would take is recorded in
  [`SKILL.md`](../.agents/skills/SKILL.md) §4.

## Decisions

- **2026-08-11: the Funding Cockpit is the one place this work lives.** Earlier tools were retired
  rather than maintained. When something outside the cockpit needs the same logic, share the model
  (the Budgets crawl, the sheet parser, the quarter maths, the Xero client), not the process: a
  second tool merged into the cockpit would share its 6-minute execution limit, give a
  domain-accessible web app broad Drive write access, and tie a deliberate quarterly act to an
  automatic 6-hourly refresh.
- **2026-08-11: Xero budgets are a non-goal.** A Xero budget is keyed on account and period only;
  the funding source survives as text in the budget's name and the milestone is lost, so it cannot
  represent the four-dimension model. Nobody used Xero's budget-variance reports.
- **2026-08-11: budgets are set at milestone level, not by account**, and a funding-source sheet
  has at most four tabs. Actuals come live from Xero, so a per-sheet copy of them was retired.
- **2026-08-11: salary attribution lives in Xero, not in a Sheets allocation table**, so the posted
  transaction is the evidence a funder or reviewer can be shown. The accepted cost is that Xero
  checks only that a journal balances, never that its split is right, so drift is caught by
  health checks instead (D6 for spend after a grant has ended). Payroll moved from repeating
  manual journals to Xero Payroll bills on 2026-09-21.
- **2026-08-13: competing applications share an `Exclusivity group`**, exactly one of which carries
  the cost. E3 and E4 catch duplication nobody declared; G3 reports the suppression.
- **2026-09-21: runway is funded runway, not cash runway.** A month-by-month cumulative walk of
  income against spend, actuals behind and budget ahead, reporting the first month the cumulative
  net turns negative rather than dividing by an average burn rate, because grant income arrives in
  tranches lumpy enough to make that division lie. Three lines: secured as the floor, weighted as
  the expected case, all-proposed as the ceiling.
- **September 2026: only approved Xero documents are actuals.** Drafts and documents awaiting
  approval are not on the ledger and Xero's own reports ignore them.
- **September 2026: D5 and E2 judge a grant by its schedule**, what the budget or forecast expected
  by the end of the last finished quarter, not by its contract dates.
- **2026-09-28: General's overhead is derived from each sheet's `Contribution policy`**, and G1
  allows ten points either side of it.
- **2026-09-30: once a milestone has a forecast, the forecast is its plan.** The `Budget` tab's
  dates are for building the budget; after it is confirmed, leads re-profile by quarter against it.
  A `Forecast` row with any number owns every quarter the tab has a column for, its blanks counting
  as 0, in every view (`CONFIG.PLAN_FROM_FORECAST`). A row left blank keeps the budget. This
  replaced "a blank cell means the budget stands", which made work moved to a later quarter count
  twice unless the quarter it left was zeroed. G1 still judges the budget, the agreement with the
  funder, not the forecast.

## History

The repository accumulated three generations of tooling before the cockpit became the one place
the work lives:

- **The first, account-keyed tools**: `create_xero_budget_project.js`, which built Xero budget
  projects and whose day-weighting the cockpit kept, and two scripts filling a `*Account` dropdown
  on budget sheets (`general_valid_accounts.js`, `variance_funding_source.js`). All three were
  removed on 2026-09-29.
- **Quarterly budget generation** produced per-project summary sheets and Xero budget import files.
  Retired on 2026-08-11 with its Apps Script project.
- **The remote-code loaders**, which fetched scripts from GitHub and executed them at runtime, one
  of them passing the Xero client secret to the fetched code. Removed on 2026-08-10; the last
  directory that carried one, `funding_reports/`, went on 2026-08-14. Why this matters is the No
  Remote Code Loading Invariant in `SKILL.md`.
- **The `PROJECT_overview` aggregator** (`funding-aggregator.js`), which gathered funding data into
  per-project overview sheets. The cockpit's Overview replaced it, and it was removed on
  2026-09-29.

Two episodes shaped the rules in `SKILL.md`. On 2026-08-11 the deployed cockpit turned out to be
about 1,030 lines ahead of the repository, including a whole permissions layer, and a blind push
would have erased it: that is the Deployment Invariant. And the health checks were designed before
they were built: `BudgetReader` first had to report what it discarded instead of skipping it with
a log line nobody read, then categories A, B and F went in, with C, D and E following once sheets
carried the metadata they need.

On 2026-09-29 the documentation was consolidated from eleven files into seven, by audience, and
moved into `docs/`.
