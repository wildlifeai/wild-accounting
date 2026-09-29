# Funding Cockpit

A dashboard web app for the General Manager that closes the gap between **budgets in
Google Sheets**, **actuals in Xero**, and the existing **Apps Script** glue. It shows, per
**project / funding source / General**:

- how each is tracking against budget (budget vs actual variance), with a flexible
  **breakdown** you can group by any combination of project / funding source / status
  (secured vs proposed),
- the **secured forecast** (secured funding only) and **proposed forecast** (secured +
  proposed pipeline),
- a **quarterly tracking** screen where the GM maintains a forward forecast per milestone.

It is a Google Apps Script web app. It reads **budgets from the Budgets GDrive** and pulls
**actuals live from Xero** via the Xero API (OAuth2), using the apps-script-oauth2 library.

### ▶ Live dashboard
**<https://script.google.com/a/macros/wildlife.ai/s/AKfycbxCjtIS-xnIdySCtFF7vibrW0qhhnMcnzFs0GCPK0SXrzFzV5-WZtNnpkyTWfbLdAqs/exec>**

Sign in with your `wildlife.ai` Google account. This URL is permanent — bookmark it. (It
only changes if a *new* deployment is created; publishing a new **version** of the existing
deployment keeps the same link.)

- **General Manager / non-technical users:** see [GM_GUIDE.md](GM_GUIDE.md) — what each
  panel means, where the numbers come from, and how to change a budget (Sheets) or a
  transaction (Xero) so the dashboard updates.
- **Budget owners / PMs:** see [BUDGET_PROCEDURES_ADDENDUM.md](BUDGET_PROCEDURES_ADDENDUM.md)
  for the small additions to the Create / Maintain / Archive procedures that this dashboard
  introduces.
- **Maintainers / developers:** the rest of this README.

---

## 1. How it works (architecture)

```
Apps Script Web App (HtmlService)  ──►  GM opens a URL, Google login
        │
        ▼
  Aggregator  ── joins ──┐
        │                │
  ForecastEngine         │   (day-weighted Cost/Income distribution + quarterly
  (pure maths)           │    helpers)
        │                │
   ┌────┴─────┐    ┌─────┴───────┐
   │ Budgets  │    │   Xero API   │
   │ (Drive)  │    │  (OAuth2)    │
   │ secured/ │    │ actuals by   │
   │ proposed/│    │ Project ×    │
   └──────────┘    │ Funding ×    │
                   │ Item × Acct  │
                   └──────────────┘
        │
        ▼
  Snapshot cache (JSON file in Drive)
  rebuilt every 6h by a time trigger + manual "Refresh now"
        │
        ▼
  Quarterly tracking screen  ──►  budget + Xero actuals + each funding
  (baseline + actual + forecast)   source's own Forecast tab, per
                                   milestone × quarter
```

### Why a cache
Crawling ~30 budget sheets plus a full Xero pull can approach Apps Script's 6-minute limit.
So the crawl runs on a **time trigger** and stores a JSON snapshot; the dashboard reads the
snapshot instantly and shows "synced Nh ago". `Refresh now` forces a rebuild.

### The data model it relies on
Every Xero transaction is tagged with four things, which is what makes a milestone span
multiple account types *and* a funding source span multiple projects:

| Concept | Xero mechanism | Example |
|---|---|---|
| Expense type | Chart of Accounts | `Contractors (310)` |
| Project | Tracking category `Projects` | `Wildlife Watcher`, `General` |
| Funding source | Tracking category `Funding source` | `WW_25_TOI` |
| Milestone | Product & Service code | `WW_25_TOI_002` |

Budgets mirror this: one Gsheet per funding source (named exactly as the Xero funding-source
tracking value), in `secured/` or `proposed/` folders under each project. Forecast
definitions are fixed in `Aggregator.js`: **secured = `secured/` only; proposed = secured +
`proposed/`.**

### Files
| File | Responsibility |
|---|---|
| `appsscript.json` | Manifest: OAuth2 library, scopes, web-app config |
| `Config.js` | All non-secret config (folder ids, account lists, tuning). Edit this. |
| `XeroClient.js` | Xero OAuth2 + fetch actuals as normalised lines |
| `BudgetReader.js` | Walk Drive, parse `Budget` tabs into budget lines |
| `ForecastEngine.js` | Pure forecasting math + quarterly helpers, unit-testable |
| `Aggregator.js` | Join budgets + actuals → snapshot; forecast definitions; breakdown rows; quarterly baseline+actual |
| `Permissions.js` | The Permissions tab of the Cockpit Settings sheet: which projects each person may see |
| `TrackingBuilder.js` | Merge baseline + actual + forecast into the quarterly grid |
| `HealthCheck.js` | Turns silent wrongness into named findings. Pure, so it runs offline |
| `Snapshot.js` | Cache (JSON file in Drive), refresh trigger, and refresh-progress writes |
| `WebApp.js` | `doGet`, client API (`google.script.run`), admin menu |
| `Index/Stylesheet/JavaScript.html` | The dashboard UI |
| `Tests.js` | `runTests()` — checks the math with no Drive/Xero |
| `Probe.js` | Read-only diagnostics run by hand from the editor, currently the contribution dry run. Never on a trigger |
| `check_docs.js` | Node, not Apps Script. Fails when these docs disagree with the code |

---

## 2. How to run it (first-time setup)

### Prerequisites
- A Google account in the `wildlife.ai` Workspace with access to the Budgets GDrive.
- A **Xero app** (free): create one at <https://developer.xero.com/app/manage> →
  *New app* → *Web app*. You'll get a **Client ID** and **Client Secret**.

### Step A — create the Apps Script project
You can do this two ways.

**Option 1 — clasp (recommended, keeps it in git):**
```bash
npm install -g @google/clasp
clasp login
cd dashboard
clasp create --type webapp --title "Funding Cockpit"   # creates .clasp.json
clasp push
```
(There's a `.clasp.json.example` to copy if you already have a script id.)

**Option 2 — manual:** create a project at <https://script.google.com>, then copy each
`.js` file into a script file of the same name and each `.html` file into an HTML file of
the same name. Replace the default manifest with `appsscript.json` (enable
*Show "appsscript.json"* in Project Settings).

### Step B — fill in config
In `Config.js` set `BUDGETS_ROOT_FOLDER_ID` to the id of the top-level **Budgets** Drive
folder (from its URL). Then create an empty Google Sheet to hold the GM's forward forecast,
and set its id as `FORECAST.SPREADSHEET_ID` (or as Script Property
`COCKPIT_FORECAST_SHEET_ID`). The app creates the `Forecast` tab + header itself on first
use. Adjust account names / tuning only if your chart of accounts differs.

### Step C — store the Xero secrets (never commit these)
In the Apps Script editor: **Project Settings → Script Properties → Add**:

| Property | Value |
|---|---|
| `XERO_CLIENT_ID` | from your Xero app |
| `XERO_CLIENT_SECRET` | from your Xero app |

(Leave `XERO_TENANT_ID` blank — it's resolved and stored automatically on first connect.)

### Step D — register the Xero redirect URI
Run `logXeroRedirectUri` once (Run menu) and copy the URL from the execution log. In the
Xero app settings, add it under **Redirect URIs**. It looks like
`https://script.google.com/macros/d/XXXX/usercallback`.

### Step E — connect Xero
Run `apiXeroStatus` (or, if the script is bound to a sheet, use **Cockpit → Connect Xero**)
and open the returned `authUrl`. Approve the Wildlife.ai organisation. You should see
"Xero connected".

### Step F — build the first snapshot and schedule refreshes
Run `refreshSnapshot` once (this does the full crawl), then run `installRefreshTrigger` to
schedule it every 6 hours. If this step is skipped, or the trigger is later deleted, the
Health tab raises **F7** on every page load; if the trigger exists but stops firing, **F2**
says how old the snapshot is.

### Step G — deploy the web app
**Deploy → New deployment → Web app.** Set *Execute as* = **Me**, *Who has access* =
**Anyone within wildlife.ai**. Share the deployment URL with the GM.

### Sanity check
Run `runTests` (Run menu) and confirm all checks PASS in the log. This validates the
forecasting math independently of Drive/Xero.

---

## 3. How to maintain it

### Routine
- **Nothing day-to-day.** The snapshot self-refreshes every 6 hours. Project managers keep
  doing the existing *Create / Maintain / Archive Funding Source Budget* procedures.
- The dashboard reflects new funding sources automatically the next refresh after a Gsheet
  lands in a `secured/` or `proposed/` folder and its name matches the Xero funding-source
  tracking value.

### When something looks wrong
1. Open the deployment URL and click **Refresh now** to force a fresh crawl.
2. Check the **⚠ flags** at the bottom of the dashboard — e.g. "no Project column" means a
   funding source was attributed to its folder's project because it had no per-line split.
3. In the editor, **Executions** shows `refreshSnapshot` runs and any errors (a renamed tab,
   a budget sheet missing `Start`/`End`/`Cost`, an expired Xero token).
4. If the Xero token expired, re-run the connect step (Step E).

### Common adjustments (all in `Config.js`)
- New balance-sheet account to exclude → add to `EXCLUDED_ACCOUNTS`.
- Chart-of-accounts rename → nothing to change: excluded accounts match on the code.
- Refresh frequency → `REFRESH_TRIGGER_HOURS` (re-run `installRefreshTrigger` after changing).

### Deploying code changes
With clasp: `clasp push`, then **Deploy → Manage deployments → Edit → Version: New**. The
GM's URL stays the same.

### Known assumptions / extension points (documented in code)
- **Budget tab shape**: the funding-source `Budget` tab is keyed on milestone, not
  chart-of-accounts. Columns read: `Start, End, Cost, Income, Contribution, Milestone,
  Xero Inventory Item` (+ optional `Project`). Matching is case-insensitive/trimmed and
  strips stray zero-width spaces. Forecast spend = day-weighted `Cost`; secured income =
  day-weighted `Income`. What General receives is decided by each sheet's
  `Contribution policy`, not by the `Contribution` column: `percent_of_income:<n>` moves
  that share of the income on lines not already on General into a
  `<source> (contribution)` row under General, in the Overview, five-year plan, planner
  and General's tracking view alike. The `Contribution` column (= Income − Cost) is the
  sheet's own arithmetic, checked by B5, and G1 reports any margin beyond the policy.
- **Budget → project split**: per line via an optional `Project` column. A line uses its
  `Project` value when set; if there's no column or the cell is blank, the line belongs to
  its parent project folder. This lets one funding source (e.g. `WW_25_TOI`, folder
  Wildlife Watcher) book its `General management` lines to General while everything else
  stays Wildlife Watcher. Actuals are *always* split exactly, by Xero's Projects tracking
  category.
- **Xero sources**: `XeroClient.js` reads bank transactions + invoices. If you book
  accruals/payroll via **manual journals**, add a `fetchManualJournalLines_` mirroring the
  existing fetchers.
- **GST**: line amounts use Xero `LineAmount`. If budgets are GST-exclusive but some Xero
  lines are inclusive, normalise in `XeroClient.js`.

---

## 4. How to use it (for the GM)

Full non-technical walkthrough: [GM_GUIDE.md](GM_GUIDE.md). In brief — the dashboard has two
tabs: **Overview** and **Quarterly tracking**.

### Overview tab
Open the deployment URL (Google login). Two things, top to bottom:

**Summary cards** — org totals: forecast budget, secured funding, actual to date, and the
headline **unsecured gap** (proposed budget − secured funding).

**Breakdown** — a table you regroup on the fly with the `group by:` checkboxes:
- **Project**, **Funding source**, **Status** (secured vs proposed) — tick any combination.
- Each group shows *Budget* (proposed forecast), *Secured* (confirmed funding), *Actual*
  (live from Xero) and a *Spent vs budget* bar (green within budget, red over budget).
- Grouping happens in the browser, so toggling is instant.

`Refresh now` pulls the latest Xero actuals on demand; otherwise figures are at most ~6 hours
old (timestamp top right).

### Quarterly tracking tab — replaces the per-sheet "Budget, Actual, Forecast Tracking"
Pick a funding source. You get a grid of milestones × quarters with three layers:
- **Baseline** — the frozen budget (from the `Budget` tab), shown under each cell.
- **Actual** — past quarters, live from Xero (read-only).
- **Forecast** — current and future quarters are editable inputs. Type a number to override
  the baseline (the cell highlights), or clear it to revert. Saving writes to the central
  Forecast Sheet and recomputes totals instantly.

Right-hand columns show, per milestone, **Budget / Actual to date / Expected (actual +
forecast) / Variance** (red = heading over budget, green = under). This is the same job the
old tracking tab did, but actuals are automatic and the forecast lives in one place instead
of one tab per funding source.

> Numbers are only as good as the coding in Xero and the budgets in Drive. If a project
> looks off, the *Maintain a Funding Source Budget* reconcile loop (Gsheet ↔ Xero) is
> usually where the fix belongs.
