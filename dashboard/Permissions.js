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
 * The latest reserves figure on the Reserves tab, or null. Read at refresh, and the tab is
 * created with its header the first time, so there is somewhere to type the figure. A
 * sheet that cannot be read leaves the runway as funded money only rather than failing
 * the refresh: the rest of the snapshot does not depend on it.
 */
function readReserves_(now) {
  try {
    var ss = openOrCreateSettingsSpreadsheet_();
    var sheet = ss.getSheetByName(CONFIG.RESERVES.TAB);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.RESERVES.TAB);
      sheet.appendRow(CONFIG.RESERVES.HEADER);
      sheet.setFrozenRows(1);
      return null;
    }
    return latestReserves_(sheet.getDataRange().getValues().slice(1), now);
  } catch (e) {
    Logger.log('Reserves not read, so the runway shows funded money only: ' + e.message);
    return null;
  }
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
