/**
 * Config.js
 * Central configuration for the Funding Cockpit dashboard.
 *
 * Secrets (Xero client id/secret, tenant id) are NOT stored here. They live in
 * Script Properties so they never end up in source control. Set them once via the
 * "Cockpit > Setup" menu, or in Project Settings > Script Properties.
 *
 * Everything in CONFIG below is non-secret structural config and is safe to commit.
 */

const CONFIG = {
  // ---- Google Drive: where the budget Gsheets live -------------------------
  // The dashboard walks every project folder under BUDGETS_ROOT_FOLDER_ID and
  // reads the `secured/` and `proposed/` subfolders. Get the id from the Drive
  // URL of the top-level "Budgets" folder: drive.google.com/drive/folders/<ID>
  BUDGETS_ROOT_FOLDER_ID: '10105co6S5qHFSVVg0pb0fkoPidN3ScJZ',
  SECURED_FOLDER_NAME: 'secured',
  PROPOSED_FOLDER_NAME: 'proposed',
  ARCHIVED_FOLDER_NAME: 'archived',
  ARCHIVE_PREFIX: 'Z_ARCH_', // funding sources / projects with this prefix are ignored

  // ---- Budget sheet structure ---------------------------------------------
  // A funding-source spreadsheet carries at most these three tabs. Anything else
  // is a second version of the truth: actuals come live from Xero, and forecast
  // overrides belong in the `Forecast` tab. Health check A3 flags extras.
  BUDGET_TAB: 'Budget',
  FORECAST_TAB: 'Forecast',
  SUBMITTED_TAB: 'Submitted_budget',
  // Sheet-level metadata (owner, status, funding dates, contribution policy) lives
  // on its own tab as `key | value` rows in columns A and B. It used to sit as a
  // block above the Budget columns; that still works and is read as a fallback.
  FUNDING_INFO_TAB: 'Funding_info',
  // The `Budget` tab may carry a `key | value` metadata block above the column
  // header row (owner, status, funding dates, contribution policy - see
  // BUDGET_SHEET_TEMPLATE.md). The header row is therefore located, not assumed:
  // we scan this many rows for one containing both `Start` and `Cost`.
  HEADER_SCAN_ROWS: 40,
  // Columns on the funding-source `Budget` tab (keyed on milestone, not accounts).
  // Two real variants exist and both are supported:
  //   Description, Start, End, Cost, Income, Contribution, Comments, Milestone,
  //     Xero Inventory Item                              (e.g. SPY_26_HAND)
  //   ...same, plus an *Account column                  (e.g. WW_25_TOI)
  // `account` and `project` are optional. When `*Account` is present it's captured
  // for drill-down/reconciliation (a single milestone can span several accounts).
  // `Project` is per line: a line uses its `Project` value when set; if there's no
  // column or the cell is blank, the line belongs to the parent project folder.
  // Matching is case-insensitive and trimmed.
  BUDGET_COLUMNS: {
    description: 'Description',
    start: 'Start',
    end: 'End',
    cost: 'Cost',
    income: 'Income',
    contribution: 'Contribution',
    account: '*Account',         // optional
    milestone: 'Milestone',
    item: 'Xero Inventory Item', // the {SOURCE}_{NNN} product/service code
    project: 'Project'           // optional
  },
  BUDGET_REQUIRED_COLUMNS: ['start', 'end', 'cost'],

  // ---- Health-check tuning ------------------------------------------------
  // Keys a sheet must carry. C1 names any that are missing.
  // `status` is deliberately NOT required: the secured/ or proposed/ folder the sheet
  // sits in IS the status, and the code trusts the folder over the field. Requiring a
  // second copy only created something that could disagree, which is what C2 reports.
  // A sheet may still carry Status, and C2 still checks it when present.
  REQUIRED_META: ['funding source', 'project', 'funder',
                  'funding start', 'funding end', 'owner'],
  // C4: a sheet nobody has looked at in this long is probably no longer true.
  STALE_REVIEW_DAYS: 90,
  // E2: only worth asking about underspend once at least this share of the budget should
  // have been spent, by the tracking grid's rule, and only when the shortfall is at
  // least UNDERSPEND_GAP of the whole budget.
  UNDERSPEND_MIN_DUE: 0.5,
  UNDERSPEND_GAP: 0.25,
  // Contribution policy values the code understands. Anything else is C6.
  CONTRIBUTION_POLICIES: [/^none$/, /^per_line$/, /^percent_of_income:\d+(\.\d+)?$/],

  // ---- Funding_info keys read by code -------------------------------------
  // Metadata keys are lower-cased by parseFundingInfoTab_, so these are the lower-case
  // forms. Everything else in Funding_info is documentation for humans.
  META: {
    owner: 'owner',
    link: 'link',                          // grant folder, contract, or a reference code
    // 0-100. Chance this proposed application is won, used for the weighted pipeline.
    // Accepts "40", "40%" or "0.4". Secured sources are always treated as 100.
    probability: 'probability',
    // Competing applications for the same work share a label here. Exactly one member of
    // a group carries the cost; the rest are asks against it. Without this, two parallel
    // applications for one role would double that role in the organisation budget.
    exclusivityGroup: 'exclusivity group'
  },
  DEFAULT_PROJECT: 'Unallocated',
  GENERAL_PROJECT: 'General',

  // ---- Chart of accounts: ported from create_xero_budget_project.js --------
  REVENUE_ACCOUNTS: ['Grants (102)', 'Project Contract Income (181)'],
  OVERHEAD_ACCOUNT: 'Overhead Allocation (500)',
  DEFERRED_ACCOUNT: 'Unused Donations and Grants with Conditions (835)',
  // Balance-sheet / non-operational accounts excluded from spend + forecast.
  EXCLUDED_ACCOUNTS: [
    'Accounts Payable (800)', 'Accounts Receivable (610)', 'ANZ Term Deposit (605)',
    'Computer Equipment (720)', 'GST (820)', 'Historical Adjustment (840)',
    'Income Tax (830)', 'Inventory (630)',
    'Less Accumulated Depreciation on Computer Equipment (721)',
    'Less Accumulated Depreciation on Office Equipment (711)',
    'less Provision for Doubtful Debts (611)', 'Loan (900)',
    'Office Equipment (710)', 'Owner A Drawings (980)', 'Owner A Funds Introduced (970)',
    'PAYE Payable (825)', 'Payroll Accrual (834)', 'Prepayments (620)',
    'Retained Earnings (960)', 'Suspense (850)', 'Tracking Transfers (877)',
    'Unpaid Expense Claims (801)', 'Visa Prezzy Card (622)',
    'Wages Deductions Payable (816)', 'Wages Payable - Payroll (814)',
    'WILDLIFE.AI TRUST (600)', 'Withholding tax paid (625)'
  ],

  // ---- Xero --------------------------------------------------------------
  XERO: {
    AUTH_URL: 'https://login.xero.com/identity/connect/authorize',
    TOKEN_URL: 'https://identity.xero.com/connect/token',
    API_BASE: 'https://api.xero.com/api.xro/2.0',
    CONNECTIONS_URL: 'https://api.xero.com/connections',
    // Minimal read-only scopes. accounting.transactions.read covers bank
    // transactions + invoices; accounting.settings.read covers the chart of
    // accounts and tracking categories; offline_access enables token refresh.
    SCOPE: 'offline_access accounting.transactions.read accounting.settings.read',
    PROJECT_TRACKING_CATEGORY: 'Projects',
    FUNDING_TRACKING_CATEGORY: 'Funding source'
  },

  // ---- Cockpit Settings spreadsheet ---------------------------------------
  // A single central Google Sheet stored in the Budgets root folder. Contains
  // the Permissions tab for role-based access control. Auto-created on first
  // use if SPREADSHEET_ID is unset.
  SETTINGS: {
    SPREADSHEET_ID: '',          // leave blank to auto-create
    FILE_NAME: 'Cockpit Settings',
    PROPERTY_KEY: 'COCKPIT_SETTINGS_SHEET_ID'
  },

  // ---- Permissions layer -------------------------------------------------
  // Stored as a tab in the Cockpit Settings spreadsheet.
  PERMISSIONS: {
    TAB: 'Permissions',
    HEADER: ['Email', 'Allowed Projects (comma separated, or * for all)']
  },

  // ---- Financial year -----------------------------------------------------
  // Quarters in the tracking screen follow this financial year. 4 = April start
  // (Apr-Mar), so Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar.
  FINANCIAL_YEAR_START_MONTH: 4,
  // How far ahead the General project view forecasts (quarters past current).
  GENERAL_FORECAST_QUARTERS: 6, // 1.5 years

  // ---- Caching ------------------------------------------------------------
  // The snapshot is stored as a JSON file in Drive (no size ceiling, unlike
  // Script Properties). The file id is kept in a Script Property.
  SNAPSHOT_FILE_NAME: 'cockpit_snapshot.json',
  SNAPSHOT_FILE_ID_PROPERTY: 'COCKPIT_SNAPSHOT_FILE_ID',
  REFRESH_TRIGGER_HOURS: 6,

  // ---- Refresh progress ---------------------------------------------------
  // Apps Script cannot stream to a client, so refreshSnapshot writes its current phase
  // here and the browser polls apiRefreshProgress for it. CacheService rather than
  // PropertiesService: transient, written many times per refresh, and it must not
  // outlive a crashed run. The TTL is the backstop for a run that dies without clearing.
  PROGRESS_CACHE_KEY: 'COCKPIT_REFRESH_PROGRESS',
  PROGRESS_CACHE_TTL_SECONDS: 600
};

/** Settings spreadsheet id from Config or Script Property. */
function getSettingsSheetId() {
  return getSecret(CONFIG.SETTINGS.PROPERTY_KEY) || getSecret('COCKPIT_FORECAST_SHEET_ID') || CONFIG.SETTINGS.SPREADSHEET_ID;
}

/** Read a secret from Script Properties (returns '' if unset). */
function getSecret(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

/** Store a secret in Script Properties. */
function setSecret(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}
