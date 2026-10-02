/**
 * XeroClient.js
 * OAuth2 connection to Xero and retrieval of actuals as normalised transaction lines.
 *
 * Uses the apps-script-oauth2 library, declared in appsscript.json as `OAuth2`.
 *
 * A "normalised line" is the atomic unit the rest of the app reasons about:
 *   { date: Date, account: String, project: String, fundingSource: String,
 *     item: String, amount: Number, kind: 'expense' | 'income',
 *     docType: String, reference: String, contact: String, description: String }
 * `amount` is always positive; direction is carried by `kind`. The last four say which
 * Xero transaction the line came from, so a Health finding can name it.
 */

/** Build (or fetch) the OAuth2 service for Xero. */
function getXeroService() {
  return OAuth2.createService('xero')
    .setAuthorizationBaseUrl(CONFIG.XERO.AUTH_URL)
    .setTokenUrl(CONFIG.XERO.TOKEN_URL)
    .setClientId(getSecret('XERO_CLIENT_ID'))
    .setClientSecret(getSecret('XERO_CLIENT_SECRET'))
    .setCallbackFunction('xeroAuthCallback')
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setScope(CONFIG.XERO.SCOPE)
    .setParam('response_type', 'code')
    // Xero requires a fixed redirect URI registered on the app; getRedirectUri()
    // returns the script's callback URL — register exactly that value in Xero.
    .setTokenHeaders({
      'Authorization': 'Basic ' + Utilities.base64Encode(
        getSecret('XERO_CLIENT_ID') + ':' + getSecret('XERO_CLIENT_SECRET'))
    });
}

/** OAuth2 redirect handler (named in setCallbackFunction above). */
function xeroAuthCallback(request) {
  const ok = getXeroService().handleCallback(request);
  return HtmlService.createHtmlOutput(
    ok ? 'Xero connected. You can close this tab.' : 'Xero authorisation denied.');
}

/** The redirect URI to register in the Xero developer app. Run + read the log. */
function logXeroRedirectUri() {
  Logger.log('Register this redirect URI in your Xero app:\n' +
    getXeroService().getRedirectUri());
}

/** Log whether Xero is connected right now (run this from the editor to check). */
function checkXeroConnection() {
  const connected = isXeroConnected();
  Logger.log(connected
    ? 'Xero IS connected.'
    : 'Xero is NOT connected - run logXeroAuthUrl and open the URL to authorise.');
  return connected;
}

/** Log the Xero authorisation URL. Open it (as the deploying user) to connect. */
function logXeroAuthUrl() {
  const service = getXeroService();
  if (service.hasAccess()) { Logger.log('Already connected.'); return; }
  if (!getSecret('XERO_CLIENT_ID') || !getSecret('XERO_CLIENT_SECRET')) {
    Logger.log('Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in Script Properties first.');
    return;
  }
  Logger.log('Open this URL (signed in as the account that DEPLOYED the web app) ' +
    'to connect Xero:\n' + service.getAuthorizationUrl());
}

/** Clear the stored Xero token so you can re-authorise from scratch. */
function resetXeroConnection() {
  getXeroService().reset();
  setSecret('XERO_TENANT_ID', '');
  Logger.log('Xero token cleared. Run logXeroAuthUrl to reconnect.');
}

/** True once a valid Xero token exists. */
function isXeroConnected() {
  return getXeroService().hasAccess();
}

/** Resolve and cache the Xero tenant (organisation) id. */
function getXeroTenantId() {
  let tenantId = getSecret('XERO_TENANT_ID');
  if (tenantId) return tenantId;

  const resp = UrlFetchApp.fetch(CONFIG.XERO.CONNECTIONS_URL, {
    headers: { Authorization: 'Bearer ' + getXeroService().getAccessToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('Xero connections API ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  const connections = JSON.parse(resp.getContentText());
  if (!connections.length) throw new Error('No Xero organisations connected to this app.');
  tenantId = connections[0].tenantId;
  setSecret('XERO_TENANT_ID', tenantId);
  return tenantId;
}

/**
 * Log every Xero organisation this app is connected to, with its tenant id.
 * Run from the editor AFTER a successful connection. Copy the tenantId into the
 * XERO_TENANT_ID Script Property only if you want to pin a specific org (e.g. if
 * the app is connected to more than one).
 */
function logXeroConnections() {
  if (!isXeroConnected()) {
    Logger.log('Not connected yet - authorise Xero first (logXeroAuthUrl).');
    return;
  }
  const resp = UrlFetchApp.fetch(CONFIG.XERO.CONNECTIONS_URL, {
    headers: { Authorization: 'Bearer ' + getXeroService().getAccessToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    Logger.log('Error fetching Xero connections (' + resp.getResponseCode() + '): ' + resp.getContentText());
    return;
  }
  const connections = JSON.parse(resp.getContentText());
  if (!connections.length) { Logger.log('No organisations connected.'); return; }
  connections.forEach(c => Logger.log(
    'Org: ' + c.tenantName + '  |  tenantId: ' + c.tenantId + '  |  type: ' + c.tenantType));
}

/** Low-level GET against the Xero Accounting API, returns parsed JSON. */
function xeroGet_(path, params) {
  const query = params
    ? '?' + Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&')
    : '';
  const resp = UrlFetchApp.fetch(CONFIG.XERO.API_BASE + path + query, {
    headers: {
      Authorization: 'Bearer ' + getXeroService().getAccessToken(),
      'Xero-tenant-id': getXeroTenantId(),
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('Xero API ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  return JSON.parse(resp.getContentText());
}

/**
 * Pull all actuals since `sinceDate` and return normalised lines.
 * Sources: bank transactions (cash) + invoices (accrual).
 *
 * With `opts.earned` (CONFIG.ACTUALS_EARNED) the lines follow Xero's P&L instead: posted
 * manual journals are read too, each line's account class decides whether it is income or
 * expense (a receipt coded to an expense account reduces spend), and anything not on a
 * profit-and-loss account is left out. earnedActuals_ then replaces the income of sheets
 * marked "as spent".
 */
function fetchXeroActuals(sinceDate, opts) {
  const earned = !!(opts && opts.earned);
  const modifiedHeader = sinceDate ? Utilities.formatDate(
    sinceDate, 'UTC', "yyyy-MM-dd'T'HH:mm:ss") : null;
  let lines = [];

  _lastUnposted = { count: 0, total: 0, docs: [] };
  lines.push.apply(lines, fetchBankTransactionLines_(modifiedHeader));
  lines.push.apply(lines, fetchInvoiceLines_(modifiedHeader));
  if (earned) {
    lines = lines.map(l => byAccountClass_(l, accountClassFromLabel_(l.account)));
    lines.push.apply(lines, fetchManualJournalLines_(sinceDate));
  }

  // Apply the balance-sheet exclusions in ONE place so every present and future
  // fetcher inherits it. Filtering downstream in Aggregator would mean touching
  // both the rollup loop and buildTracking_, and leaving the next consumer to
  // remember.
  const kept = [];
  let count = 0, total = 0;
  lines.forEach(l => {
    if (l.offPnl || isExcludedAccount_(l.account)) {
      count++; total += Number(l.amount) || 0;
      return;
    }
    kept.push(l);
  });
  _lastExclusion = { count: count, total: Math.round(total) };
  if (count) {
    Logger.log('Excluded ' + count + ' actual line(s) on balance-sheet accounts, total ' +
      Math.round(total));
  }
  return kept;
}

// ---- Balance-sheet exclusions ---------------------------------------------
// CONFIG.EXCLUDED_ACCOUNTS lists balance-sheet and non-operational accounts that
// must never count as spend - notably the Wages Payable and PAYE Payable legs of
// a payroll settlement. The list was declared but read by nothing, so those lines
// counted as expense whenever they happened to carry a Projects tracking tag. The
// de facto filter on actuals was "does this line have a Projects value", which is
// a data-entry accident rather than a control.
//
// Match on the account CODE, not the label: labels are built from live Xero
// account names by accountLabelFromCode_, so renaming an account in Xero would
// otherwise silently un-exclude it.

let _excludedCodes = null;
let _lastExclusion = { count: 0, total: 0 };

/** What the last fetch excluded, for the Health panel. */
function lastExclusionSummary() { return _lastExclusion; }

function excludedCodes_() {
  if (!_excludedCodes) {
    _excludedCodes = {};
    (CONFIG.EXCLUDED_ACCOUNTS || []).forEach(label => {
      const m = /\((\d+)\)\s*$/.exec(String(label));
      if (m) _excludedCodes[m[1]] = label;
      else Logger.log('EXCLUDED_ACCOUNTS entry has no "(code)" so is ignored: ' + label);
    });
  }
  return _excludedCodes;
}

/** True when a normalised line sits on an excluded balance-sheet account. */
function isExcludedAccount_(accountLabel) {
  const m = /\((\d+)\)\s*$/.exec(String(accountLabel == null ? '' : accountLabel));
  return m ? Object.prototype.hasOwnProperty.call(excludedCodes_(), m[1]) : false;
}

// ---- Unposted and cancelled documents --------------------------------------
// A Xero invoice only reaches the general ledger once it is approved. DRAFT and
// SUBMITTED (awaiting approval) sit outside it, which is why Xero's own P&L and
// tracking-category reports ignore them. The invoice fetcher excluded DELETED and
// VOIDED only, so a draft counted here and nowhere in Xero, and the two could never
// be reconciled against each other.
//
// It matters most to runway. A draft sales invoice is income nobody has agreed to
// pay yet; counting it as actual income pushes the crossover month later, which is
// the flattering direction and the one worth being strict about.
//
// Bank transactions carried the same trap in a smaller form: their only statuses are
// AUTHORISED and DELETED, and status was not looked at there at all.
//
// An allowlist rather than a denylist, for the same reason the docs checker stopped
// using one: a status nobody has thought about stays out of the numbers until
// somebody decides what it means.

const POSTED_STATUS = {
  // The full set is DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED.
  Invoices: { AUTHORISED: true, PAID: true },
  BankTransactions: { AUTHORISED: true }
};

// Cancelled is not the same as unposted, and only one of them is worth reporting.
// A voided invoice is a decision somebody already made; a draft is money sitting in
// a queue. Tallying the two together would bury the actionable number under history.
const CANCELLED_STATUS = { VOIDED: true, DELETED: true };

let _lastUnposted = { count: 0, total: 0, docs: [] };

/** What the last fetch skipped as unapproved, and which documents, for the Health panel. */
function lastUnpostedSummary() { return _lastUnposted; }

/** True when a Xero document's status means it has reached the general ledger. */
function isPosted_(collectionKey, status) {
  const allowed = POSTED_STATUS[collectionKey];
  // A collection with no status policy declared passes through rather than being
  // dropped. A new fetcher that silently returns nothing is a much worse failure
  // than one that counts too much, and it is far harder to notice.
  if (!allowed) return true;
  return allowed[String(status == null ? '' : status).toUpperCase()] === true;
}

/** True when the document was cancelled, as opposed to merely not approved yet. */
function isCancelled_(status) {
  return CANCELLED_STATUS[String(status == null ? '' : status).toUpperCase()] === true;
}

/** Paginate a Xero endpoint and flatten line items via `mapper`. */
function paginate_(path, collectionKey, mapper, modifiedAfter) {
  const out = [];
  let page = 1;
  while (true) {
    // Page count is unknown until the last one comes back short, so there is no honest
    // total. Creep through the 50-90% band instead, five points a page, capped. Xero is
    // the largest phase by wall clock: ~30s of a ~60s refresh at 9 sources, and it grows
    // with the history window that earliestBudgetStart_ derives from the oldest budget line.
    setRefreshProgress_('Fetching Xero ' + collectionKey + ', page ' + page, 0, 0,
                        Math.min(88, 50 + (page - 1) * 5));
    const params = { page: page };
    if (modifiedAfter) params['where'] = 'UpdatedDateUTC>=DateTime(' +
      modifiedAfter.substring(0, 10).split('-').join(',') + ')';
    const data = xeroGet_(path, params);
    const rows = data[collectionKey] || [];
    if (!rows.length) break;
    // Status is filtered here, not in each fetcher, for the same reason the
    // balance-sheet exclusion sits in fetchXeroActuals: one place to state the rule,
    // and the next endpoint somebody adds inherits it instead of forgetting it.
    rows.forEach(r => {
      if (!isPosted_(collectionKey, r.Status)) {
        if (!isCancelled_(r.Status)) {
          // SubTotal, because the app's line amounts are LineAmount and so tax-exclusive.
          const amount = Math.abs(Number(r.SubTotal == null ? r.Total : r.SubTotal) || 0);
          _lastUnposted.count++;
          _lastUnposted.total += amount;
          _lastUnposted.docs.push(unpostedDoc_(collectionKey, r, amount));
        }
        return;
      }
      mapper(r, out);
    });
    if (rows.length < 100) break; // Xero pages at 100
    page++;
  }
  return out;
}

function trackingValue_(tracking, categoryName) {
  if (!tracking) return '';
  const hit = tracking.filter(t => t.Name === categoryName)[0];
  return hit ? hit.Option : '';
}

function parseXeroDate_(value) {
  // Xero returns "/Date(1612137600000+0000)/"
  const m = /\/Date\((\d+)/.exec(value || '');
  return m ? new Date(parseInt(m[1], 10)) : null;
}

function fetchBankTransactionLines_(modifiedAfter) {
  return paginate_('/BankTransactions', 'BankTransactions', (tx, out) => {
    const date = parseXeroDate_(tx.DateString ? null : tx.Date) || new Date(tx.DateString);
    const kind = tx.Type === 'RECEIVE' ? 'income' : 'expense';
    const doc = xeroDoc_('BankTransactions', tx);
    (tx.LineItems || []).forEach(li => out.push(normaliseLine_(li, date, kind, doc)));
  }, modifiedAfter);
}

function fetchInvoiceLines_(modifiedAfter) {
  return paginate_('/Invoices', 'Invoices', (inv, out) => {
    const date = new Date(inv.DateString || parseXeroDate_(inv.Date));
    const kind = inv.Type === 'ACCREC' ? 'income' : 'expense';
    const doc = xeroDoc_('Invoices', inv);
    (inv.LineItems || []).forEach(li => out.push(normaliseLine_(li, date, kind, doc)));
  }, modifiedAfter);
}

/**
 * Which Xero document a line sits on, named as Xero's own screens name it, so a Health
 * finding can say which transaction to open rather than only count them.
 */
function xeroDoc_(collectionKey, r) {
  const type = String(r.Type || '');
  return {
    docType: collectionKey === 'Invoices' ? (type === 'ACCREC' ? 'Invoice' : 'Bill')
      : (type.indexOf('RECEIVE') === 0 ? 'Receive money' : 'Spend money'),
    reference: String(r.InvoiceNumber || r.Reference || ''),
    contact: String((r.Contact && r.Contact.Name) || '')
  };
}

/** A document skipped as unapproved, in the line shape, for F6 to list. */
function unpostedDoc_(collectionKey, r, amount) {
  const status = String(r.Status || '').toUpperCase();
  return Object.assign(xeroDoc_(collectionKey, r), {
    date: r.DateString ? new Date(r.DateString) : parseXeroDate_(r.Date),
    description: status === 'DRAFT' ? 'draft'
      : (status === 'SUBMITTED' ? 'awaiting approval' : status.toLowerCase()),
    amount: amount
  });
}

/** Normalise a Xero line item into the app's actual-line shape. */
function normaliseLine_(li, date, kind, doc) {
  // Prefer the product/service code; if absent, recover a {SOURCE}_{NNN} code
  // from the line description (some lines, e.g. bank fees, carry the code only
  // in the description). This keeps such amounts attached to their milestone.
  const code = li.Item ? li.Item.Code : codeFromDescription_(li.Description);
  doc = doc || {};
  return {
    date: date,
    account: accountLabelFromCode_(li.AccountCode),
    project: trackingValue_(li.Tracking, CONFIG.XERO.PROJECT_TRACKING_CATEGORY),
    fundingSource: trackingValue_(li.Tracking, CONFIG.XERO.FUNDING_TRACKING_CATEGORY),
    item: code,
    itemName: li.Item ? (li.Item.Name || '') : '',
    amount: Number(li.LineAmount) || 0,
    kind: kind,
    docType: doc.docType || '',
    reference: doc.reference || '',
    contact: doc.contact || '',
    description: String(li.Description || '')
  };
}

/** Extract a leading {SOURCE}_{NNN}-style code from a description, or ''. */
function codeFromDescription_(desc) {
  const c = String(desc == null ? '' : desc).split(' - ')[0].trim();
  return /^[A-Za-z0-9]+_\d{2}_[A-Za-z0-9]+_\d{3}$/.test(c) ? c : '';
}

/**
 * Map a Xero account *code* (e.g. "500") to the "Name (code)" label used in budgets.
 * Cached per run from the Accounts endpoint so budgets and actuals share one key.
 */
let _accountLabelCache = null;
let _accountClassCache = null;
function loadAccounts_() {
  if (_accountLabelCache) return;
  _accountLabelCache = {};
  _accountClassCache = {};
  const data = xeroGet_('/Accounts');
  (data.Accounts || []).forEach(a => {
    _accountLabelCache[a.Code] = a.Name + ' (' + a.Code + ')';
    _accountClassCache[a.Code] = a.Class || '';
  });
}
function accountLabelFromCode_(code) {
  if (code == null || code === '') return '';
  loadAccounts_();
  return _accountLabelCache[code] || ('(' + code + ')');
}

/** ASSET, LIABILITY, EQUITY, REVENUE or EXPENSE for a "Name (code)" label, or ''. */
function accountClassFromLabel_(label) {
  const m = /\((\d+)\)\s*$/.exec(String(label == null ? '' : label));
  if (!m) return '';
  loadAccounts_();
  return _accountClassCache[m[1]] || '';
}

// ---- Earned basis (CONFIG.ACTUALS_EARNED) ----------------------------------
// Xero's P&L decides what a line is by its account, not by the document it sits on. A
// receipt coded to Salaries is a refund that lowers salary cost, not income; a grant
// invoiced to a revenue account and then deferred by journal is income only as the
// journals release it. These two functions apply that rule; earnedActuals_ in
// Aggregator.js handles sheets whose income is earned as they spend.

const PNL_CLASSES = { REVENUE: true, EXPENSE: true };

/**
 * One invoice or bank line on the P&L's terms. Income or expense follows the account's
 * class, with the sign flipped when the document says the opposite, and a line on a
 * balance-sheet account is marked offPnl so the exclusion count reports it. A line whose
 * class is unknown passes through unchanged rather than vanishing.
 */
function byAccountClass_(line, cls) {
  if (!cls) return line;
  if (!PNL_CLASSES[cls]) return Object.assign({}, line, { offPnl: true });
  const kind = cls === 'REVENUE' ? 'income' : 'expense';
  if (kind === line.kind) return line;
  return Object.assign({}, line, { kind: kind, amount: -(Number(line.amount) || 0) });
}

/**
 * One manual-journal line as an actual line, or null if it is not on a P&L account.
 * LineAmount is signed, debit positive, so income is its negative and an accrual and its
 * reversal net to zero; never Math.abs() it. Journal lines carry tracking but no item
 * code, so a milestone can only come from a code leading the description.
 */
function journalLineToActual_(li, date, cls, accountLabel, narration) {
  if (!PNL_CLASSES[cls]) return null;
  const amount = Number(li.LineAmount) || 0;
  return {
    date: date,
    account: accountLabel,
    project: trackingValue_(li.Tracking, CONFIG.XERO.PROJECT_TRACKING_CATEGORY),
    fundingSource: trackingValue_(li.Tracking, CONFIG.XERO.FUNDING_TRACKING_CATEGORY),
    item: codeFromDescription_(li.Description),
    itemName: '',
    amount: cls === 'REVENUE' ? -amount : amount,
    kind: cls === 'REVENUE' ? 'income' : 'expense',
    journal: true,
    docType: 'Manual journal',
    reference: String(narration || ''),
    contact: '',
    description: String(li.Description || '')
  };
}

/**
 * Posted manual journals dated on or after `sinceDate`, as actual lines. Paged on
 * purpose: an unpaged request returns journals without their lines. Status is filtered
 * here rather than through `where`, and by the journal's own date, not when it was last
 * edited, so an old journal touched yesterday does not reappear in the wrong month.
 */
function fetchManualJournalLines_(sinceDate) {
  setRefreshProgress_('Fetching Xero manual journals', 0, 0, 88);
  const out = [];
  for (let page = 1; page < 200; page++) {
    const rows = (xeroGet_('/ManualJournals', { page: page }).ManualJournals) || [];
    rows.forEach(j => {
      if (j.Status !== 'POSTED') return;
      const date = parseXeroDate_(j.Date) || new Date(j.DateString);
      if (sinceDate && date < sinceDate) return;
      (j.JournalLines || []).forEach(li => {
        const label = accountLabelFromCode_(li.AccountCode);
        const line = journalLineToActual_(li, date, accountClassFromLabel_(label), label,
          j.Narration);
        if (line) out.push(line);
      });
    });
    if (rows.length < 100) break; // Xero pages at 100
  }
  return out;
}
