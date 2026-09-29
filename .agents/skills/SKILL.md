---
name: open-accounting-agent
description: >
  Workflow, invariants and hard-won traps for any agent or developer working on Wildlife.ai's
  accounting tooling — the Funding Cockpit dashboard, quarterly budget generation, funding
  reports, and the Google Sheets ⇄ Xero integration. Read and follow this before editing any
  script, deploying to Apps Script, or touching Xero or budget data.
---

# Wildlife.ai Accounting Agent

`open_accounting` holds the Apps Script tooling that joins **budgets** (Google Sheets in Drive)
to **actuals** (Xero), so that one set of numbers serves the board, the GM, project leads and
funders.

> **Canonical documentation**
>
> * `AGENTS.md` — the root quickstart that points here (`CLAUDE.md` is just `@AGENTS.md`)
> * `dashboard/README.md` — Funding Cockpit architecture, setup, maintenance
> * `dashboard/GM_GUIDE.md` — what each dashboard panel means, for non-technical users
> * `dashboard/BUDGET_PROCEDURES_ADDENDUM.md` — how the dashboard changes budget procedures

**The most important thing to understand about this repo: it is not the running system.** Every
script executes as an Apps Script project in the cloud, and those projects can be — and have
been — edited directly in the browser. The repo and the deployment drift apart silently.

---

# 1. Critical Invariants

## Deployment Invariant

**`clasp push` replaces the remote project. Always `clasp pull` and diff before you edit or
push.**

One directory equals one Apps Script project. `.claspignore` here is a whitelist
(`**/**`, then `!appsscript.json`, `!*.js`, `!*.html`), so push uploads that set and **deletes
anything on the remote that is not in it**.

### Never

* Run `clasp push` without first pulling the remote and reviewing the diff.
* Assume the repo is newer than the deployment, or vice versa. Check.
* Resolve a divergence by picking one side wholesale without reading what the other side has.

### The trap this exists to prevent

On 2026-08-11, `dashboard/` in git was at commit `a3b8b72` and looked current. The deployed
Funding Cockpit was **~1,030 lines ahead** across six files — `WebApp.js` +256, `JavaScript.html`
+209, `Aggregator.js` +166, `BudgetReader.js` +85 — including an entire `SETTINGS` +
`PERMISSIONS` layer (a Cockpit Settings spreadsheet with per-user allowed projects) that existed
nowhere in the repo. A `clasp push` would have deleted all of it, silently and irreversibly.

Worse, the fork ran **both ways**. The repo held three `XeroClient.js` fixes from PR #6 review
that had never been deployed. So neither `push` nor `pull` was safe on its own.

Worst of all, pulling the deployed code **reverted a security fix**: the browser copy predated
the XSS hardening in `a3b8b72`, so `esc()` fell back to escaping only `"` and nine of thirteen
call sites lost their wrapper. "The deployment is newer" was true for features and false for
security, and only a file-level comparison against the fix commit caught it.

### Rules for agents

* Before any push, clone the remote into a scratch directory and diff:

  ```bash
  mkdir -p /tmp/rc && cd /tmp/rc && clasp clone-script <scriptId>
  diff -rq --strip-trailing-cr <repo-dir> /tmp/rc
  ```

* `clasp show-file-status` shows exactly what push would upload. Read it before pushing.
* When reconciling a fork, work on a branch, `clasp pull` over the committed state, and let
  `git diff` show you what the browser work added. Git is the safety net; use it.
* After reconciling, **check security-relevant files line by line** against the commit that last
  hardened them. Feature recency does not imply security recency.
* To push a subset without editing the committed `.claspignore`, pass a throwaway one:
  `clasp push -I /path/to/dir/containing/.claspignore`. Use `-f` when the manifest differs, or
  push prompts and hangs in non-interactive shells.

---

## No Remote Code Loading Invariant

**Code is deployed, never fetched. Secrets live in Script Properties, never in source.**

### Never

* Fetch a script from a URL and run it through `eval` or `new Function`.
* Put a client id, client secret, token or password in a `.js` file — even a template, even with
  a "do not commit this" comment.
* Cache fetched code in Script/Document Properties.

### The trap this exists to prevent

This repo shipped **three** loader scripts that fetched JavaScript from `raw.githubusercontent.com`
and executed it. Each one was remote code execution by design:

* the fetched code ran with the full Drive and Sheets permissions of whoever triggered it;
* `loader-budgets-template.js` passed `PRIVATE_CONFIG` — including the **live Xero client
  secret** — straight into the fetched module;
* fetched code was cached in Script/Document Properties, so it kept running after the remote was
  cleaned up. Fixing the repo did not reach the caches;
* neither loader checked `getResponseCode()`, so a 404 body was handed to the interpreter — which
  is exactly what happened when `feature/budget_xero` was deleted on merging PR #6, because the
  URL pinned a mutable branch ref;
* `loader_template.js` was wired to an `onOpen()` menu in a shared spreadsheet, so any user of
  that sheet could trigger it with their own Google permissions.

The loaders existed only to get updated code into Apps Script without copy-paste. `clasp push`
does that properly, so the justification is gone.

### Rules for agents

* Read secrets through a helper, and fail loudly when unset:

  ```js
  function getSecret_(key) {
    return PropertiesService.getScriptProperties().getProperty(key) || '';
  }
  ```

* Use `getScriptProperties()` for the OAuth token store, not
  `getDocumentProperties() || getScriptProperties()`. Document Properties are **invisible in the
  Apps Script UI** and can only be cleared from code.
* Changing the property store makes an existing token unreachable — the app reports
  "not connected" and needs one re-consent. Expected, but say so before doing it.
* When removing a loader, also clear its cache key in every project that ran it:
  `BUDGETS_SCRIPT_CACHE` (quarterly budgets), `XERO_SCRIPT_CACHE` (funding reports).

---

## Line Ending Invariant

**`.gitattributes` sets `* text=auto eol=lf`,** so LF holds in both the stored blob and the working
tree. It was added on 2026-08-11; before that, clasp wrote LF while a Windows checkout was CRLF, so
`clasp pull` made whole files appear modified with no content change.

* Use `git diff --ignore-cr-at-eol` to see real changes, and
  `git diff --ignore-cr-at-eol --numstat -- <file>` to confirm a file is line-endings-only.
* Restore line-endings-only files rather than committing them: `git checkout -- <file>`.
* A diff where insertions ≈ deletions ≈ the file's line count is an artifact, not an edit.
* After changing `.gitattributes`, renormalise with `git add --renormalize .`.
* Never commit a real grant amount, rate, funder term or invoice identifier — **this repository is
  public**. Describe the shape of a problem and invent the numbers, including in test fixtures.

---

## Global Scope Invariant

**All files in one Apps Script project share a single global scope.** Two files defining the same
function name silently collide, last definition winning.

* Private helpers take a **trailing underscore** (`getFolderByName_`). Apps Script treats those
  as private, so they stay out of the IDE's Run menu.
* Only real entry points stay bare. `authCallback` must stay bare — OAuth2 calls it by name.
* `create_quarterly_budgets.js` and `funding-aggregator.js` both defined `getFolderByName`. The
  collision was hidden only because the former was wrapped in a closure; flattening it for
  deployment exposed the clash, which is why the underscore convention is now enforced.
* Name top-level config objects distinctly (`BUDGETS_CONFIG`, not `CONFIG`) so two scripts can
  coexist in one project.

---

## Verify-Before-Applying Invariant

**Automated review suggestions are claims, not facts. Check them against the code, the docs and
the real data before applying.**

PR #6 was reviewed only by `gemini-code-assist`. One medium finding asked for project
abbreviations `WAA`/`WLW`, justified by "the `README.md` lists them as `WAA` and `WLW`". The
README says `WAI` and `WW`; so does the code; and so do the actual funding-source files in Drive
(`WAI_25_OMV`, `WW_25_TOI`, `WW_26_SALES`) and the matching Xero *Funding source* tracking
values. The justification was fabricated, and applying the suggestion would have decoupled
generated budgets from live data.

Other findings in the same review were real and worth fixing. Judge each on evidence.

Corollary: **a green CI tick here means almost nothing.** The only check is GitGuardian secret
scanning. `MERGEABLE / CLEAN` means "no conflicts", not "correct".

---

## Money Change Invariant

Changes that move published numbers need a human decision and an explicit before/after.

Two live examples, both correct fixes with visible consequences:

* Removing `Math.abs()` from `normaliseLine_` (deployed until 2026-08-11) makes credit notes,
  refunds and corrections reduce spend instead of adding to it. Every affected total moves.
* Wiring up `EXCLUDED_ACCOUNTS` (see §5) changes what counts as spend.

Ship each as its own change, note the totals before and after, and never let a numbers-moving
fix ride along inside an unrelated refactor.

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

Budgets mirror this in Drive under the `Budgets` folder
(`10105co6S5qHFSVVg0pb0fkoPidN3ScJZ`):

```
Budgets/
  <Project>/            e.g. Wildlife Watcher, Spyfish Aotearoa, Wild About AI, General
    secured/            one Google Sheet per funding source -> status 'secured'
    proposed/           -> status 'proposed'
    archived/           ignored, along with anything named Z_ARCH_*
```

Rules that follow from this:

* A funding-source sheet is **named exactly as its Xero *Funding source* tracking value**.
* Status comes from the folder. `secured` = confirmed; forecast definitions in `Aggregator.js`
  treat *secured* as `secured/` only and *proposed* as secured + proposed.
* A funding source can span projects: an optional per-line `Project` column overrides the parent
  folder, which is how `WW_25_TOI` books its general-management lines to `General`.
* Xero transactions must carry **both** tracking categories plus the item code. A line with no
  `Projects` value is dropped from project and org totals; a line with no `Funding source` falls
  out of the quarterly grid.
* Project abbreviations are `SPY`, `GEN`, `WAI`, `WW`. Do not change them — see §1,
  Verify-Before-Applying.

---

# 3. Budget Sheet Contract

**A funding-source spreadsheet has at most four tabs (rule set 2026-08-11):**

| Tab | Role |
|---|---|
| `Funding_info` | sheet-level metadata as `key \| value` rows in columns A and B |
| `Budget` | the live baseline the cockpit reads — the approved plan, changed only for a genuine re-budget |
| `Forecast` | per-quarter overrides where you know something the budget does not |
| `Submitted_budget` | frozen as-submitted record of what the funder was actually given |

Start from [`budget_templates/Budget_sheet_template.xlsx`](../../budget_templates/), which carries
all four tabs, the formulas and the dropdowns. Metadata may still appear as a block above the
`Budget` columns — `parseBudgetFile_` reads that as a fallback — but `Funding_info` wins where both
exist, and it is where new sheets should put it.

Everything else goes: `Budget, Actual, Forecast Tracking` grids, pasted Xero transaction exports,
milestone summaries, forecast breakdowns, income summaries, funding-tracking header blocks. Actuals
come live from Xero; a per-sheet copy of them is a second version of the truth.

**Forecasts are per-sheet, not central.** An earlier design kept them in one central Cockpit
Forecast sheet, and `BUDGET_PROCEDURES_ADDENDUM.md` still describes it that way — that is stale.
The old store is gone and its file is now `Permissions.js`; the central
sheet is **Cockpit Settings**, holding only the Permissions tab, and forecasts are read from each
funding source's own `Forecast` tab by `BudgetReader.parseForecastTab_`.

**A missing forecast falls back to the budget baseline.** `TrackingBuilder` treats a quarter with
no `Forecast` entry as the baseline, not as zero, so an unmaintained `Forecast` tab does not make a
source appear certain to underspend. That fallback is the difference between a forecast being an
exception you record and mandatory quarterly data entry across ~30 sheets; it was the original
tested behaviour, was lost in the per-sheet rewrite, and was restored on 2026-08-11 with a
regression test in `Tests.js`. Do not "simplify" it back to `0`.

Note the **current** quarter deliberately shows actual-to-date rather than the forecast, so mid-
quarter it understates that column, and with it annual Expected. Whether it should instead be
actual plus the remainder of the forecast is an open question.

Three consequences to handle rather than discover:

* **Sheet-level metadata needs a home.** Some sheets carried funding start/end dates in a separate
  header block. Under the two-tab rule that belongs in a header area of the `Budget` tab — along
  with the owner, last-reviewed date, status and contribution policy that the cockpit should be
  reading rather than inferring (§6).
* **Historical forecast is the one thing not recoverable.** Pasted actuals are redundant because
  Xero is the source, but the hand-maintained forecast figures in old tracking tabs exist nowhere
  else. If anyone wants historical forecast-vs-actual, snapshot those tabs before deleting them.
* **`CONFIG.TRACKING_TAB` in `dashboard/Config.js` is now a dead reference** and should be removed.
  `create_quarterly_budgets.js` reads that tab and stops working entirely under this rule — which
  is consistent with retiring it (§8), not a problem to fix.

The template, field meanings and validation rules are in
[`dashboard/BUDGET_SHEET_TEMPLATE.md`](../../dashboard/BUDGET_SHEET_TEMPLATE.md). Note it requires a
`BudgetReader` change first: the parser assumes row 1 is the column header, so a metadata block
above the columns must be **located** rather than assumed. Deploy the parser change before rolling
the template onto existing sheets, or every migrated sheet is skipped for a missing column.

The rule is enforced by health check A3 rather than by goodwill —
see [`dashboard/HEALTH_CHECKS.md`](../../dashboard/HEALTH_CHECKS.md).

`dashboard/BudgetReader.js` parses the `Budget` tab of each funding-source sheet. It is
**milestone-keyed**, not account-keyed.

Columns read: `Description`, `Start`, `End`, `Cost`, `Income`, `Contribution`, `*Account`
(optional), `Milestone`, `Xero Inventory Item`, `Project` (optional). Required: `Start`, `End`,
`Cost`.

**It skips silently.** Know these, because they make data invisible rather than noisy:

* a row where `Cost` and `Income` are both 0 → skipped as a blank/summary row;
* a row whose `Start` or `End` will not parse → skipped;
* a sheet with no `Budget` tab, or missing a required column → the whole file is skipped with only
  a `Logger.log`.

`WW_25_TOI` is the **reference implementation**: milestone-keyed, real item codes, `*Account`
present, per-line `Project` column working as designed. Copy its shape.

Known-bad sheets, as of 2026-08-11:

* **General 26-29 proposed** — chart-of-accounts values sit in the `Milestone` column, there is no
  `Income` or `Project` column, `Xero Inventory Item` is entirely empty, most costs are `$0`, and
  several `End` dates read `30/Jun/01` (parsed as year 2001, so end precedes start). Nearly every
  line is invisible to the dashboard. This is the *General* project — the one core funding
  applications are written against.
* **SPY_26_UOA, SPY_27_MAINT** — no `*Account` column at all despite being 100% labour;
  `SPY_27_MAINT`'s milestone codes read `SPY_27_HAN_*`, not matching their funding source.
* Several sheets still carry pasted raw Xero transaction exports and per-sheet tracking tabs.
  Those are retired: actuals come live from Xero. Do not add more.

---

# 4. Xero Integration Rules

`dashboard/XeroClient.js` fetches actuals. Current sources: **bank transactions and invoices
only**.

Scopes: `offline_access accounting.transactions.read accounting.settings.read`. Note Xero has
deprecated the broad scopes (available until September 2027) in favour of granular ones such as
`accounting.manualjournals.read`; scopes are additive and cannot be removed from a live token
without re-consent, so plan changes rather than making them casually.

## Payroll

**Changed 2026-09-21.** Payroll now posts through Xero Payroll as bills and bank transactions,
both of which `fetchXeroActuals` already reads, so salaries do reach the cockpit. It was
previously recurring biweekly manual journals per employee, which nothing fetched.

**Fetching is not the same as counting.** `Aggregator.js` drops any actual line carrying no
`Projects` tracking value before it reaches a single total, so an untagged payroll bill is
invisible in exactly the way an unfetched journal was, and just as silently. Health check **D1**
puts a figure on untagged spend, **D2** on spend missing `Funding source`. Read both after a
refresh before trusting any total that ought to contain salary. **This has not been confirmed
against a live refresh**, so treat "payroll is captured" as reported, not verified.

The manual-journal findings below are kept for the day something still has to be read from
journals. They came from official Xero documentation, the adversarial verification pass did
**not** complete, and they are therefore well-sourced and unconfirmed.

* `ManualJournalLine` **does** carry `Tracking` (field name singular, same accessor as invoice
  lines), max 2 categories — which is exactly `Projects` + `Funding source`.
* `ManualJournalLine` has **no `ItemCode`** and no item field, on GET or POST. The milestone
  dimension cannot be native. Recover it from the line description via the existing
  `codeFromDescription_`, which requires the code as the first `' - '`-delimited segment matching
  `^[A-Za-z0-9]+_\d{2}_[A-Za-z0-9]+_\d{3}$` — e.g. `WW_25_TOI_002 - Salaries, <name>`.
* An **unpaged** `GET /ManualJournals` returns no `JournalLines` at all. A fetcher mirroring the
  existing ones would appear to succeed and produce exactly $0 of salary with no error. `?page=1`
  is mandatory.
* `LineAmount` on journal lines is **signed** (debits positive, credits negative), unlike bank and
  invoice lines. Never `Math.abs()` it: an accrual and its reversal must net to zero. The file
  docblock claiming "amount is always positive" is wrong for journals.
* Filter to `Status === 'POSTED'`. GET returns DRAFT, DELETED and VOIDED by default. Filter in the
  mapper, not via `where` — `paginate_` hard-assigns `params['where']` when `modifiedAfter` is set
  and would clobber it.
* There is **no repeating-manual-journal endpoint**. Only posted instances are readable, so future
  payroll cannot be read from Xero; forward salary cost must keep coming from the budget.

## Attribution decision (2026-08-11)

Salary attribution lives in the **repeating Xero journal templates**, not in a Sheets allocation
table. Xero stays the single source of truth and the posted journal is the evidence a funder or
reviewer can be shown.

The accepted cost: a balanced journal can carry a completely wrong split — Xero enforces only that
debits equal credits, never that the attribution is right. Guards that make drift visible:

1. compare attributed salary actuals against budgeted salary lines per project and funding source;
2. flag any actual coded to a funding source whose budget end date has passed or whose sheet has
   moved to `archived/`;
3. review the templates whenever a funding source starts, ends, or an allocation changes — tied to
   the budget lifecycle, not a calendar reminder.

Core grant lines end around December 2026 while the Toi programme starts 1 October 2026, so
attribution must move funders mid-quarter. That transition is the first real test of this design.

---

# 5. Known Live Defects and Open Items

Verified against the deployed code on 2026-08-11. Do not "discover" these again; do not assume
they are fixed.

* **`EXCLUDED_ACCOUNTS` — fixed 2026-08-11, but the totals move on first deploy.** It was declared
  in `dashboard/Config.js` and read by zero executable lines, so the de facto filter on actuals was
  "does this line carry a `Projects` value" — a data-entry accident rather than a control, and the
  Wages Payable and PAYE Payable legs of a payroll settlement counted as spend whenever they
  happened to be tagged. `isExcludedAccount_` now filters inside `fetchXeroActuals`, in one place so
  every fetcher inherits it, matching on account **code** rather than label so a Xero rename cannot
  silently un-exclude. `lastExclusionSummary()` reports what was dropped. **Expect published spend
  figures to fall when this first deploys** — that is the miscounting being removed, not a
  regression, so capture the before/after.
* ~~**`OVERHEAD_ACCOUNT`, `REVENUE_ACCOUNTS` and `DEFERRED_ACCOUNT` are dead configuration.**~~
  **Removed 2026-09-29.**
* ~~**Payroll manual journals are not fetched.**~~ **Superseded 2026-09-21**: payroll moved to
  Xero Payroll bills, which are fetched. Whether those bills carry `Projects` tracking is
  unconfirmed, and D1 is the check that answers it (§4).
* **The invoice fetcher counts DRAFT and SUBMITTED invoices** as actuals — it excludes only
  DELETED and VOIDED.
* **Quarterly budget generation depends on a tab the dashboard has retired.**
  `create_quarterly_budgets.js` requires the `Budget, Actual, Forecast Tracking` tab and skips any
  funding-source file without it. But `dashboard/BUDGET_PROCEDURES_ADDENDUM.md` retires that tab
  and tells budget owners it "can be left in place for history or removed". Follow the documented
  dashboard procedure and quarterly budget generation silently stops producing output for that
  funding source. The two tools hold **competing definitions of a budget**: the cockpit reads the
  milestone-keyed `Budget` tab, the quarterly script reads the quarter columns (G, I, J, K, L) of
  the retired tracking tab. Migrating the quarterly script onto the `Budget` tab is the fix — and
  the maths it would need already exists in `ForecastEngine.js`, which day-weights `Cost` and
  `Income` across `Start`..`End` and has quarterly helpers.
* ~~**Duplicated infrastructure across projects.**~~ **Largely resolved.** There was one Xero
  OAuth2 client per project and two independent crawlers of the same Drive tree, each a place the
  definition of a budget could drift. `dashboard/XeroClient.js` is now the only Xero client:
  quarterly generation was retired on 2026-08-11 and `funding_reports/` was deleted on 2026-08-14.
  The root-level chart-of-accounts helpers went on 2026-09-29. See §8 for why the projects were separate.
* ~~**A third remote loader is still present.**~~ **Resolved 2026-08-14.** It lived in
  `funding_reports/`, cached under `XERO_SCRIPT_CACHE`, and fetched its code from a GitHub raw URL
  at runtime. The whole directory was deleted: its Xero client was superseded by the cockpit's, and
  it read two tabs the sheet schema now rejects outright (checked by A3). That also removed a
  misnamed `,gitignore` — a comma instead of a dot — which meant the file meant to stop credentials
  being committed had never done anything.
* ~~**`general_valid_accounts.js` and `variance_funding_source.js`** both define
  `updateAccountValidation()`.~~ **Resolved 2026-09-29**: both deleted, with the
  `*Account` column they served already retired.
* **Working capital and cash are not modelled at all**, and the current scopes cannot reach the
  balance sheet. Board reporting needs both.
* **Runway is not computed.** Decided 2026-09-21: the cockpit will report *funded* runway, not cash
  runway. A month-by-month cumulative walk of income against spend, actuals behind and budget
  ahead, reporting the first month cumulative net turns negative rather than dividing by an average
  burn rate, because grant income arrives in tranches lumpy enough to make that division lie. Three
  lines: secured as the floor, probability-weighted as the expected case, all-proposed as the
  ceiling, so the spread between their crossover months states fundraising urgency in months.
  Org-wide, on the Overview. **Cash runway is deliberately out of scope**: it needs
  `accounting.reports.read`, a Xero re-consent and a balance-sheet read, and scopes cannot be
  removed from a live token without re-consent, so adding one is not a casual change.
* **Nothing reports a dead refresh trigger.** On 2026-09-21 the snapshot file in Drive was
  seven days old against a six-hour trigger, roughly 28 consecutive missed runs, and the only
  symptom was a "last synced" label that reads as information rather than an alarm. There is no
  health check for it. A dashboard serving week-old numbers confidently is worse than one that is
  plainly broken, because nobody re-reads a figure they have no reason to doubt. `refreshSnapshot`
  calls `setContent` on every run, so the Drive file's `modifiedTime` is a reliable record of the
  last successful refresh and is what such a check should read.
* **No period freezing.** The snapshot cache is a performance cache, not an audit record. A figure
  reported to the board in August cannot currently be reproduced in November.
* ~~**No `.gitattributes`.**~~ **Resolved 2026-08-11**; §1 describes what it pins and why. This
  bullet contradicted §1 for six weeks, which is the argument for `check_docs.js` growing a check
  that reads prose claims about the repo's own state, not just ids and file lists.

---

# 6. Overhead and Double-Funding Rules

> **This is a public repository.** Never paste real grant amounts, hourly rates, funder terms or
> invoice identifiers into tracked files, including examples and test fixtures. Describe the shape
> of a problem and invent the numbers.

## Overhead / General contribution

Projects contribute a share of their income to `General`, at the rate each funding source
declares in its `Contribution policy`; most Wildlife Watcher grants contribute nothing because
they disallow overheads. The rates live in each sheet's `Funding_info`, not here, because a
list copied into this file drifts from the sheets: `reportContributions()` prints the current
ones.

Until 2026-09-28 the rule existed nowhere as data. The General budget carried it as quarterly
negative-cost lines (`Overheads from projects, −$30,000`) with the split written as prose in a
Comments cell (`Spyfish Aotearoa: $12,000 Wildlife Watcher: $18,000`, figures invented),
recomputed by hand every quarter, and project and General budgets drifted apart.

**Derived since 2026-09-28.** Each funding source declares a `Contribution policy` (`none`,
`percent_of_income:40`, `per_line`), and the cockpit derives General's inflow from it:
`contributionRate_` and `lineContribution_` in `Aggregator.js` are the one statement of the
rule, used by the Overview, the five-year plan, the planner, General's tracking view and G1.
`percent_of_income` takes its share from lines not already on General; `per_line` derives
nothing because its General lines are General's already. Organisation totals and runway do
not move; only the split between projects does. `reportContributions()` in `Probe.js` is a
dry run of the split.

Any negative-cost "Overheads from projects" lines left in a General budget now count the
overhead twice, and must be deleted.

## Double-funding

The same cost must not be charged to two funding sources for the same period. Signals found on
2026-08-11 that need resolving, not repeating:

* `WW_25_TOI_002` "General management" is budgeted inside the Wildlife Watcher Toi grant, and
  100% of its salary actuals are tracked to `Projects: General` — while General secured *also*
  budgets General management. (Amounts deliberately omitted: public repository.)
* General management 0.2 FTE appears in two sheets with a one-month date overlap; WW Product
  Management overlaps ~3 months at a combined 1.0 FTE; a third sheet budgets the same GM at
  1.0 FTE.
* At least one invoice appears under two funding sources at once.
* Handoffs between funders are recorded as free text ("covered by TOI funding"), not as structure.

Rule: when preparing any funding application, check whether the cost is already funded elsewhere,
and make handoffs explicit with dates rather than comments. When two applications go to the same
funder, ensure neither budget charges management hours the other already covers.

**Since 2026-08-13 this is enforced rather than remembered**, by three checks and one field:

* **E3** — the same item code in two funding sources. Codes are `{SOURCE}_{NNN}` precisely so
  this cannot happen accidentally.
* **E4** — the same `Description` budgeted in two sources over overlapping dates. This is the
  detector for the second and third bullets above.
* **`Exclusivity group`** in `Funding_info` — for duplication that is *deliberate*, i.e. two
  applications chasing the same work in the hope one lands. Members share a label, exactly one
  carries the cost, and **G3** reports the ones whose cost was suppressed. Without it, two
  parallel asks for one role put twice that role's cost on the organisation.
* **E4 stays silent inside an exclusivity group.** E4 is for duplication nobody declared; G3 is
  for duplication that was. Reporting both would charge the reader twice for one decision.

---

# 7. Working Practices

* **Victor approves every commit and push.** Prepare the change, show the diffstat, then ask.
* Feature branch, PR against `dev`. `main` is the release branch.
* Use `--force-with-lease`, never bare `--force`, when a rewrite is authorised.
* Prefer amending over a follow-up commit when the original would otherwise leave a security
  regression in the pushed history — and say that a force-push is required.
* Diagnostics (`Probe.js` and similar) are throwaway: read-only, GET-only, deleted when done, and
  kept out of feature commits.
* Findings belong in the repo docs. If something is left undone, write it into §5 rather than
  relying on a conversation.

---

# 8. Why These Are Separate Apps Script Projects

Mostly history, not design. `create_xero_budget_project.js` (root) came first — the cockpit's
`Config.js` still says its overhead logic was "ported from" it. The quarterly budgets script grew
next in the loader era, and the Funding Cockpit was built later with a cleaner model. Nothing was
retired along the way, so three generations coexist and duplicate each other (§5).

**Direction (decided 2026-08-11): the Funding Cockpit is the one place this work lives.**
`create_quarterly_budgets.js` is legacy and is to be retired, not maintained. Do not invest in it
— including the tracking-tab migration listed in §5, which becomes moot once it is gone.

Of its three outputs, two are already superseded by the cockpit and one is not:

| Output | Status |
|---|---|
| `YYQX_PROJECT` summary spreadsheets, tab per funding source | superseded — the dashboard breakdown and tracking grid do this |
| Aggregated monthly budget per project/funding source | superseded — `Aggregator.js` + `ForecastEngine.js` |
| `*_XERO_IMPORT.csv` + diff against Xero's Budgets endpoint | **not covered anywhere** |

**Resolved 2026-08-11: nobody uses Xero's budget-variance reports.** So the third output is not
needed either, and `project_reports/create_quarterly_budgets.js` can be **deleted outright** rather
than partially ported. Do not build a CSV export into the cockpit; there is no consumer for it.

This also makes Xero budgets a non-goal generally. A Xero budget is keyed on account and period
only — the funding source survives just as text inside the budget's name and the milestone dimension
is lost entirely — so it can never represent the four-dimension model in §2. The cockpit is the
budget surface.

The caution below applies to merging the legacy script **as written**, not to that reduced
function. Retire first, then move what survives:

* **The 6-minute execution limit.** The cockpit already needs its snapshot cache because crawling
  ~30 budget sheets plus a full Xero pull approaches the limit. Quarterly generation additionally
  creates or updates a summary spreadsheet per project and writes CSVs — that would not fit in one
  execution.
* **Write scope and blast radius.** The cockpit is a `DOMAIN`-access web app that is read-mostly on
  Drive. The quarterly script creates spreadsheets and CSV files in project folders. Merging gives
  a domain-accessible web app broad Drive write powers, and lets a CSV bug break the board's
  dashboard.
* **Cadence.** The cockpit refreshes automatically every 6 hours; budget generation is a
  deliberate quarterly act with a human reading the upload checklist.
* **Different Xero surfaces.** The cockpit reads transactions; the quarterly script reads the
  Budgets endpoint (GET only — there is no POST/PUT for Budgets, which is why it exports CSVs for
  manual import) and needs `accounting.reports.read`.

**What should be shared is the model, not the process.** One definition of: crawling the Budgets
tree, parsing a budget sheet, the chart of accounts, FY-quarter maths, and the Xero client. Apps
Script supports libraries and this codebase already consumes OAuth2 as one, so the pattern is
familiar; alternatively keep one repo directory of shared files and push it into both projects.

Order of work:

1. **Delete `project_reports/create_quarterly_budgets.js`** and its `.clasp.json` /
   `appsscript.json` scaffolding. Retire the `quarterly_budgets` Apps Script project
   (`18LAH4KW…`) with it. Nothing needs porting — see the resolution above. Merge
   `fix/remove-remote-loaders` first, since it touches the same files.
2. ~~Retire the other legacy generation.~~ Done 2026-09-29: `create_xero_budget_project.js`,
   `general_valid_accounts.js` and `variance_funding_source.js` deleted, and the
   `PROJECT_overview` aggregator (`funding-aggregator.js`) with them. None existed as a
   standalone Apps Script project in Drive.
3. ~~Remove the third remote loader.~~ Done 2026-08-14: `funding_reports/` deleted entirely.
4. Once the legacy paths are gone, the duplication in §5 largely resolves itself — the chart of
   accounts id, the FY-quarter maths and the Xero client end up defined once, in the cockpit. Only
   consider a shared Apps Script library if something outside the cockpit still needs them.

Do not start at step 4.

---

# Agent Self-Check

Before deploying or committing, verify:

* Have I pulled and diffed the Apps Script project before pushing?
* Did I compare security-relevant files against the commit that last hardened them?
* Am I introducing any fetched-and-executed code, or any secret in source?
* Have I checked review suggestions against the README and the real Drive data?
* Do private helpers carry a trailing underscore, and is my config object distinctly named?
* Will this change move published numbers — and have I said which, and by how much?
* Is this diff real, or line endings?

If any answer is wrong, stop and re-read the relevant invariant.
