/**
 * Permissions.js
 * Who may see what: the Permissions tab of the "Cockpit Settings" spreadsheet, which
 * getUserPermissions reads on every page load to scope the snapshot to a person's projects.
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
