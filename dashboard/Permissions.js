/**
 * Permissions.js
 * Who may see what: the Permissions tab of the "Cockpit Settings" spreadsheet, which
 * getUserPermissions reads on every page load to scope the snapshot to a person's projects.
 * The same spreadsheet's Reserves tab, the working capital read at refresh, starts the runway
 * (readReserves_).
 *
 * This was ForecastStore.js until 2026-09-29. Forecasts were once stored centrally here;
 * they are now read from each funding source's own Forecast tab
 * (BudgetReader.parseForecastTab_), and only the settings sheet remained.
 */

// ---- Settings spreadsheet management ----

/**
 * Open the configured Settings spreadsheet, or create one inside the Budgets root folder
 * when none has ever been configured, persisting its id for next time.
 *
 * A configured sheet that will not open is an error, never a reason to make a new one. It
 * used to be: one failed open, a Drive hiccup or a revoked share, replaced the Permissions
 * tab with a fresh one naming only the script owner and pointed the cockpit at it, which
 * silently locked everyone else out until somebody noticed and repaired the property.
 */
function openOrCreateSettingsSpreadsheet_() {
  var id = getSettingsSheetId();
  if (!id) return createSettingsSpreadsheet_();
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('The Cockpit Settings sheet (' + id + ') could not be opened: ' + e.message +
      '. Check the script owner can still open it; the cockpit will not replace it.');
  }
}

function createSettingsSpreadsheet_() {
  var ss = SpreadsheetApp.create(CONFIG.SETTINGS.FILE_NAME);
  // Move it from My Drive into the Budgets root folder.
  try {
    var folder = DriveApp.getFolderById(CONFIG.BUDGETS_ROOT_FOLDER_ID);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
  } catch (e) {
    Logger.log('Settings sheet created but could not move to Budgets folder: ' + e.message);
  }
  setSecret(CONFIG.SETTINGS.PROPERTY_KEY, ss.getId());
  Logger.log('Created Settings sheet ' + ss.getId() + ' ("' + CONFIG.SETTINGS.FILE_NAME + '").');
  return ss;
}

// ---- Permissions ----

function getPermissionsSheet_() {
  var ss = openOrCreateSettingsSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.PERMISSIONS.TAB);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.PERMISSIONS.TAB);
    sheet.appendRow(CONFIG.PERMISSIONS.HEADER);
    sheet.setFrozenRows(1);

    // Seed with the script owner as admin.
    var email = Session.getEffectiveUser().getEmail() || 'admin@example.com';
    sheet.appendRow([email, '*']);
  }
  return sheet;
}

/**
 * Returns an array of allowed project names for the given email,
 * or ['*'] if they have full access. If no access is defined, returns [].
 */
function getUserPermissions(email) {
  if (!email) return [];
  var sheet = getPermissionsSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var rowEmail = String(data[i][0]).trim().toLowerCase();
    if (rowEmail === String(email).trim().toLowerCase()) {
      var projectsStr = String(data[i][1]).trim();
      if (projectsStr === '*') return ['*'];
      return projectsStr.split(',').map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });
    }
  }
  return []; // default to no access
}

// ---- Working capital (the Reserves tab) ----

/**
 * The latest working capital on the Reserves tab, or null, after writing the last
 * quarter-end's row from Xero (syncReservesFromXero_). Read at refresh; the tab is created
 * with its header the first time. A sheet that cannot be read leaves the runway as funded
 * money only rather than failing the refresh: the rest of the snapshot does not depend on it.
 * The tab keeps the name Reserves so the rows already on it still count; it is not the
 * Reserves funding source (CONFIG.RESERVES_SOURCE).
 */
function readReserves_(now, quarterClose) {
  _lastReservesIssue = null;
  try {
    var ss = openOrCreateSettingsSpreadsheet_();
    var sheet = ss.getSheetByName(CONFIG.RESERVES.TAB);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.RESERVES.TAB);
      sheet.appendRow(CONFIG.RESERVES.HEADER);
      sheet.setFrozenRows(1);
    }
    syncReservesFromXero_(sheet, now, quarterClose);
    return latestReserves_(sheet.getDataRange().getValues().slice(1), now);
  } catch (e) {
    Logger.log('Working capital not read, so the runway shows funded money only: ' +
      e.message);
    return null;
  }
}

// Why the last refresh could not write working capital from Xero: null, { kind: 'scope' }
// for F4, or { kind: 'sections', asAt, missing } for F8.
var _lastReservesIssue = null;
function lastReservesIssue() { return _lastReservesIssue; }

// Column C of a row the refresh wrote starts with this, which is how a typed row is told
// apart from it and left alone. Rows written before 2026-11-22 start with it too, so it
// must not change.
var RESERVES_AUTO_NOTE = 'From Xero: ';

/**
 * Write the last quarter-end's working capital from Xero's Balance Sheet into the tab,
 * replacing the row an earlier refresh wrote for that date. A row someone typed for that
 * date wins, so a correction is never overwritten. Without the reports scope Xero refuses
 * the report: F4 says so and the typed rows still work. A report without the sections the
 * figure is added up from writes nothing and raises F8, rather than guessing. `fetchReport`
 * stands in for fetchBalanceSheet_ in the tests, which have no Xero.
 */
function syncReservesFromXero_(sheet, now, quarterClose, fetchReport) {
  if (!fetchReport && !isXeroConnected()) return;
  var qi = qiOfDate_(now) - 1;
  var end = quarterBounds_(qi).end;
  var rows = sheet.getDataRange().getValues();
  var at = -1;
  for (var i = 1; i < rows.length; i++) {
    var d = parseSheetDate_(rows[i][0]);
    if (!d || d.getTime() !== end.getTime()) continue;
    if (String(rows[i][2] || '').indexOf(RESERVES_AUTO_NOTE) !== 0) return;
    at = i;
  }
  var bs;
  try {
    bs = (fetchReport || fetchBalanceSheet_)(isoDate_(end));
  } catch (e) {
    if (/Xero API 40[13]/.test(e.message)) _lastReservesIssue = { kind: 'scope' };
    Logger.log('Working capital not read from Xero: ' + e.message);
    return;
  }
  var r = workingCapitalFromBalanceSheet_(bs, unpostedReleases_(quarterClose, labelOfQi_(qi)));
  if (r.missing) {
    _lastReservesIssue = { kind: 'sections', asAt: isoDate_(end), missing: r.missing };
    Logger.log('Working capital not written: the Balance Sheet has no ' +
      r.missing.join(' and ') + ' section');
    return;
  }
  var row = [end, r.amount, r.note];
  if (at === -1) sheet.appendRow(row);
  else sheet.getRange(at + 1, 1, 1, 3).setValues([row]);
}

/**
 * Working capital, as the Treasurer works it out, from the Balance Sheet's section totals
 * (parseBalanceSheet_): Bank plus Current Assets, less Current Liabilities, plus the grant
 * releases still to post. Current liabilities hold the bills still to pay, GST, PAYE and
 * accruals, and the grants received but not yet released, under whatever name the
 * accountant gives that account. Fixed and non-current items are left out: they are what
 * separates working capital from equity. The runway already counts a bill or invoice from
 * its date, so what is unpaid on it at the quarter end comes off (or goes on) here. Until a
 * quarter's release journal is in, the liability still holds money that was spent, so the
 * unposted releases go back on.
 *
 * A Bank section inside Current Assets is already in its total, and a report with no Bank
 * section is taken to hold the bank accounts in Current Assets. With neither asset section,
 * or no Current Liabilities, it returns { missing: [section names] } and no amount, since a
 * figure without them is a guess. Otherwise { amount, note }, the note naming each part, so
 * the figure can be checked against Xero.
 */
function workingCapitalFromBalanceSheet_(bs, unposted) {
  var R = CONFIG.RESERVES;
  var key = function (t) { return String(t).replace(/\s+/g, ' ').trim().toLowerCase(); };
  var sections = (bs && bs.sections) || {};
  var bank = sections[key(R.BANK_SECTION)];
  var assets = sections[key(R.CURRENT_ASSETS_SECTION)];
  var owed = sections[key(R.CURRENT_LIABILITIES_SECTION)];
  var missing = [];
  if (!bank && !assets) missing.push(R.BANK_SECTION + ' or ' + R.CURRENT_ASSETS_SECTION);
  if (!owed) missing.push(R.CURRENT_LIABILITIES_SECTION);
  if (missing.length) return { missing: missing };

  var bankInAssets = !!(bank && assets &&
    bank.within.indexOf(key(R.CURRENT_ASSETS_SECTION)) !== -1);
  var bankApart = bank && !bankInAssets ? bank.total : 0;
  var assetsTotal = assets ? assets.total : 0;
  var amount = Math.round(bankApart + assetsTotal - owed.total + (unposted || 0));

  var parts;
  if (!assets) {
    parts = R.BANK_SECTION + ' ' + Math.round(bank.total) + ', plus ' +
      R.CURRENT_ASSETS_SECTION + ' 0 (no such section)';
  } else if (!bank) {
    parts = R.CURRENT_ASSETS_SECTION + ' ' + Math.round(assetsTotal) + ' (no ' +
      R.BANK_SECTION + ' section, so the bank is taken to be in it)';
  } else if (bankInAssets) {
    parts = R.CURRENT_ASSETS_SECTION + ' ' + Math.round(assetsTotal) + ' (' +
      R.BANK_SECTION + ' ' + Math.round(bank.total) + ' included)';
  } else {
    parts = R.BANK_SECTION + ' ' + Math.round(bank.total) + ', plus ' +
      R.CURRENT_ASSETS_SECTION + ' ' + Math.round(assetsTotal);
  }
  var note = RESERVES_AUTO_NOTE + 'working capital from the Balance Sheet, ' + parts +
    ', less ' + R.CURRENT_LIABILITIES_SECTION + ' ' + Math.round(owed.total) +
    ', plus releases not yet posted ' + Math.round(unposted || 0) +
    '. Type your own row for this date to override.';
  return { amount: amount, note: note };
}

/** What Quarter close says is still to post, all grants, cumulative to quarter `q`. */
function unpostedReleases_(quarterClose, q) {
  var qi = qiOfLabel_(q), total = 0;
  ((quarterClose && quarterClose.releases) || []).forEach(function (r) {
    Object.keys(r.byQ || {}).forEach(function (k) {
      if (qiOfLabel_(k) <= qi) total += (r.byQ[k].earned || 0) - (r.byQ[k].xero || 0);
    });
  });
  return Math.round(total);
}

/**
 * The row dated latest but not after `now` that has an amount, as
 * { amount, asAt: 'yyyy-MM-dd', month }. A row dated ahead is a figure nobody can know yet.
 */
function latestReserves_(rows, now) {
  var best = null;
  (rows || []).forEach(function (r) {
    var d = parseSheetDate_(r[0]);
    var raw = r[1];
    if (!d || d > now || raw === '' || raw === null || raw === undefined) return;
    if (!best || d >= best.date) best = { date: d, amount: parseAmount_(raw) };
  });
  if (!best) return null;
  return { amount: Math.round(best.amount), asAt: isoDate_(best.date),
    month: reservesMonth_(best.date, now) };
}

/**
 * The month whose closing position the figure is: its own month when dated on the last
 * day, otherwise the month before, since the runway walks whole months. Never this month
 * or later, which the runway plans rather than reads from Xero.
 */
function reservesMonth_(d, now) {
  var lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();
  var m = new Date(d.getFullYear(), d.getMonth() - (lastDay ? 0 : 1), 1);
  var cap = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return DateMath.monthKey(m < cap ? m : cap);
}

// ---- Board budget ----

/**
 * The budget the board approved, from the Board budget tab: see boardBudgetRows_. Read when
 * the page loads, so a typed correction shows without a refresh. The tab is created with
 * its header the first time; a tab made before the quarter column keeps its own header.
 */
function readBoardBudget_() {
  var ss = openOrCreateSettingsSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.BOARD.TAB);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.BOARD.TAB);
    sheet.appendRow(CONFIG.BOARD.HEADER);
    sheet.setFrozenRows(1);
  }
  return boardBudgetRows_(sheet.getDataRange().getDisplayValues().slice(1));
}

/**
 * Board budget rows, header gone, as { fy, project, quarter, income, cost, reserves }. A
 * financial year is written as the cockpit labels it ("26/27"); a row without one, or
 * without a project, is skipped. Read as displayed text, so "26/27" cannot arrive as a date.
 *
 * Column G, optional, names a quarter of that year (Q1 to Q4, or "26/27 Q1"): `quarter` is
 * its number, and the row's figures are that quarter's. Blank is the whole year, `quarter`
 * null, so a tab of six columns reads as it always has. A quarter that cannot be read, or
 * that names another year, skips the row rather than counting it as the whole year.
 * `reserves` is column E, the working capital the budget expected at the end of the year or
 * quarter. A blank amount is null, so a row that gives only working capital is not read as
 * budgeting nothing.
 */
function boardBudgetRows_(values) {
  var out = [];
  var amount = function (v) {
    return String(v == null ? '' : v).trim() === '' ? null : parseAmount_(v);
  };
  (values || []).forEach(function (r) {
    var fy = String(r[0] || '').trim(), project = String(r[1] || '').trim();
    if (!/^\d{2}\/\d{2}$/.test(fy) || !project) return;
    var q = String(r[6] || '').trim(), quarter = null;
    if (q !== '') {
      var m = /^(?:(\d{2}\/\d{2})\s+)?Q?\s*([1-4])$/i.exec(q);
      if (!m || (m[1] && m[1] !== fy)) return;
      quarter = parseInt(m[2], 10);
    }
    out.push({ fy: fy, project: project, quarter: quarter, income: amount(r[2]),
      cost: amount(r[3]), reserves: amount(r[4]) });
  });
  return out;
}
