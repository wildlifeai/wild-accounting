# open_accounting

Scripts and documentation related to the budgeting and accounting frameworks of Wildlife.ai.

These are Google Apps Script projects that join **budgets** (Google Sheets in Drive) to
**actuals** (Xero), so the board, the GM, project leads and funders all work from the same
numbers.

## Why this exists

Wildlife.ai runs on restricted funding. Money arrives tied to a funder, a period, a project and a
set of milestones, and it has to be reported back in that shape while the organisation is
simultaneously answering "can we pay the rent". That is fund accounting, and no single tool we can
buy does it for us:

- **Xero allows two tracking categories.** We need four dimensions: account × project × funding
  source × milestone. The fourth is carried on the Product/Service item code, which is a workaround,
  not a preference.
- **Xero reports by account, not by milestone.** Budget-versus-actual add-ons (Syft, Fathom,
  Spotlight) inherit that, so none of them can produce the per-milestone variance a funder asks for.
- **Overhead recovery is capped at 40%** by what funders will accept, so there is no headroom to
  fund a commercial fund-accounting platform out of grant overhead.
- **Sheets stays in the architecture** because collaborators build one budget at a time and must not
  see the org-wide picture. That is why aggregation lives in the cockpit rather than in a master
  spreadsheet.

The cost of this decision is roughly 4,000 lines of bespoke Apps Script for 11 funding sources. The
milestone dimension is what we are paying for.

## Who it is for

| # | Persona | The question they are asking | Cadence |
|---|---|---|---|
| 1 | **Board and Treasurer** | Are we solvent and on plan? | Quarterly |
| 2 | **GM** | Where do I put the next dollar, and what do I ask for next? | Continuous |
| 3 | **Project lead** | Am I over or under on my funder's money? | Monthly |
| 4 | **Bookkeeper** | Code it right, pay it on time. | Fortnightly / monthly |
| 5 | **Funder** | What did our money do? | Per funding round |
| 6 | **Collaborator** | Help me build this one budget. | Ad hoc |

**Board and Treasurer** want quarterly forecast, annual budget, quarterly P&L and working capital.
Read-only, org-wide, no interest in individual lines. Their defining need is completeness and
immutability: the number reported in August must still be reproducible in November. Once a year this
persona becomes the independent reviewer, and needs budget → Xero → statement traceability.

**GM** is the power user and the only persona needing every dimension at once: unsecured gap,
overhead flowing into General, which funder pays for which milestone, and what to put in the next
application.

**Project lead** needs per-funding-source variance monthly, a project rollup across funding sources,
and remaining budget per milestone without opening Xero.

**Bookkeeper** never opens the cockpit but determines whether it works, because every downstream
number depends on four tags being present at the moment of entry. Historically the weakest link,
because nothing told them when a tag was missing.

**Funder** sees one funding source, their period, their format, and nothing else.

**Collaborator** edits a single sheet and needs zero org visibility.

## The eleven requirements

Status as at 14 August 2026. This table is the test specification: "does the cockpit work" means
"does it answer these".

| # | What | Freq | Persona | Source of truth | Today |
|---|---|---|---|---|---|
| 1 | Forecast reported to Board | Q | Board | Cockpit: secured + weighted pipeline, frozen | Weighting now exists: `Probability` per proposed source drives a "gap after pipeline" figure. **Freezing still does not**: `storeSnapshot_` overwrites one Drive file and the trigger runs every 6 hours, so August's number is gone by November |
| 2 | Annual organisation budget | A | Board, GM | Cockpit: all funding sources + General | The unreadable pre-migration sheets were archived on 13 August. General's overhead from other projects is derived from each sheet's `Contribution policy` and shown the same way in the Overview, five-year plan, planner and General's tracking view |
| 3 | P&L (income and expenses) | Q | Board | Xero | Derived from bank and invoices only. Payroll posts as manual journals, which **are** reachable (`GET /ManualJournals?page=1`, `LineAmount` signed) and carry Tracking, but have **no `ItemCode`**, so payroll cannot reach milestone grain |
| 4 | Working capital balance and forecast | Q | Board, Treasurer | Xero balance sheet + deferred grants | Absent. No scope, no endpoint called |
| 5 | Bill payments | M | Bookkeeper | Xero | Native Xero. Deliberately out of scope for the cockpit |
| 6 | Payroll | F | Bookkeeper | Xero Payroll | Native, but must carry all four tags and a manual journal can carry only two. The health panel now flags untagged spend (D1, D2), spend with no item code (D3), spend tagged to a source with no sheet (D4), and **spend still arriving after a grant ended (D6), which is how a stale repeating journal surfaces**. The feedback loop exists; **it is still not routed to the bookkeeper** |
| 7 | Funding source income and expense variance | M | Project lead | Cockpit | Exists. Monthly cadence not enforced |
| 8 | Funding source budget | per funder | GM | Sheets template | Template and validation both exist: **37 health checks** across sheet structure, data quality, metadata, Xero coding, reconciliation and the funding pipeline. Legacy-schema files archived 13 August |
| 9 | Funding source summary | per funder | Funder | Cockpit export | Absent. **No funder-facing output of any kind**; every funder report is hand-built |
| 10 | Project budget overview | per project | Project lead, GM | Cockpit rollup | Exists (group by project) |
| 11 | YTD P&L | Q | Project lead → Board | Cockpit, per project YTD | Partial |

### The gaps that cost the most

Ranked by how badly they hurt the persona who depends on them:

1. **No immutability (#1).** The Board's defining need, and the refresh trigger destroys it four
   times a day. Nothing else on this list is a regression of a stated requirement.
2. **General's overhead income is invisible in two of the three views (#2).** Makes the
   organisational core look unfunded in exactly the view the GM and Board look at.
3. **No funder-facing output (#9).** Requirement 9 has no implementation at all, and it is the one
   an external party sees.
4. **Payroll cannot reach milestone grain (#3, #6).** The largest expense line is the least
   attributable.
5. **Working capital is entirely absent (#4).**

## Documentation

| | |
|---|---|
| **Start here** | [`AGENTS.md`](AGENTS.md) — quickstart, commands, non-negotiables, repo map |
| **Deep guide** | [`.agents/skills/SKILL.md`](.agents/skills/SKILL.md) — invariants, the Xero data model, known defects, and the traps that have actually bitten |
| Funding Cockpit dashboard | [`dashboard/README.md`](dashboard/README.md) |
| — for non-technical users | [`dashboard/GM_GUIDE.md`](dashboard/GM_GUIDE.md) |
| — what each health finding means | [`dashboard/HEALTH_CHECKS.md`](dashboard/HEALTH_CHECKS.md) |
| — how to lay out a budget sheet | [`dashboard/BUDGET_SHEET_TEMPLATE.md`](dashboard/BUDGET_SHEET_TEMPLATE.md) |
| — effect on budget procedures | [`dashboard/BUDGET_PROCEDURES_ADDENDUM.md`](dashboard/BUDGET_PROCEDURES_ADDENDUM.md) |
| Importable sheet templates | [`budget_templates/README.md`](budget_templates/README.md) |
| `PROJECT_overview` sheet aggregator | [`project_reports/README.md`](project_reports/README.md) — predates the cockpit and overlaps requirement 10 |

`CLAUDE.md` is just `@AGENTS.md`, so AI assistants and developers read the same guide.

> **Before pushing to Apps Script, read the Deployment Invariant in `SKILL.md`.** The deployed
> projects can be edited in the browser and have drifted ahead of this repo before;
> `clasp push` replaces the remote and deletes anything not present locally.
