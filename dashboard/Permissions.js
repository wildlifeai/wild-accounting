/**
 * Permissions.js
 * Who may see what: the Permissions tab of the "Cockpit Settings" spreadsheet, which
 * getUserPermissions reads on every page load to scope the snapshot to a person's projects.
 * The same spreadsheet's Reserves tab, read at refresh, starts the runway (readReserves_).
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

// ---- Reserves ----

/**
 * The latest reserves figure on the Reserves tab, or null, after writing the last
 * quarter-end's row from Xero (syncReservesFromXero_). Read at refresh; the tab is created
 * with its header the first time. A sheet that cannot be read leaves the runway as funded
 * money only rather than failing the refresh: the rest of the snapshot does not depend on it.
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
    Logger.log('Reserves not read, so the runway shows funded money only: ' + e.message);
    return null;
  }
}

// Why the last refresh could not read reserves from Xero, for F4: 'scope' or null.
var _lastReservesIssue = null;
function lastReservesIssue() { return _lastReservesIssue; }

// Column C of a row the refresh wrote starts with this, which is how a typed row is told
// apart from it and left alone.
var RESERVES_AUTO_NOTE = 'From Xero: ';

/**
 * Write the last quarter-end's reserves from Xero's Balance Sheet into the tab, replacing
 * the row an earlier refresh wrote for that date. A row someone typed for that date wins,
 * so a correction is never overwritten. Without the reports scope Xero refuses the report:
 * F4 says so and the typed rows still work.
 */
function syncReservesFromXero_(sheet, now, quarterClose) {
  if (!isXeroConnected()) return;
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
    bs = fetchBalanceSheet_(isoDate_(end));
  } catch (e) {
    if (/Xero API 40[13]/.test(e.message)) _lastReservesIssue = 'scope';
    Logger.log('Reserves not read from Xero: ' + e.message);
    return;
  }
  var r = reservesFromBalanceSheet_(bs, unpostedReleases_(quarterClose, labelOfQi_(qi)));
  var row = [end, r.amount, r.note];
  if (at === -1) sheet.appendRow(row);
  else sheet.getRange(at + 1, 1, 1, 3).setValues([row]);
}

/**
 * Free money from Balance Sheet balances: the bank accounts, less grants received in
 * advance, plus releases still to post. Until a quarter's release journal is in, the
 * liability still holds money that was spent, so the unposted releases go back on. The note
 * shows each part, so the figure can be checked against Xero.
 */
function reservesFromBalanceSheet_(bs, unposted) {
  var bank = 0;
  CONFIG.RESERVES.BANK_CODES.forEach(function (c) { bank += (bs.byCode || {})[c] || 0; });
  var name = CONFIG.RESERVES.IN_ADVANCE_ACCOUNT;
  var inAdvance = (bs.byName || {})[name];
  var amount = Math.round(bank - (inAdvance || 0) + (unposted || 0));
  var note = RESERVES_AUTO_NOTE + 'accounts ' + CONFIG.RESERVES.BANK_CODES.join(' + ') + ' ' +
    Math.round(bank) + ', less ' + name + ' ' +
    (inAdvance === undefined ? '0 (not on the balance sheet)' : Math.round(inAdvance)) +
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
