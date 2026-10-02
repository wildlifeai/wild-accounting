/**
 * BudgetReader.js
 * Walks the Budgets Drive tree and parses each funding source's `Budget` tab into
 * structured budget lines. Funding sources are discovered from folder structure:
 *
 *   BUDGETS_ROOT_FOLDER_ID
 *     |- <project folder>
 *          |- secured/   <funding-source Gsheet>  -> status 'secured'
 *          |- proposed/  <funding-source Gsheet>  -> status 'proposed'
 *
 * Funding sources whose name starts with ARCHIVE_PREFIX are skipped.
 *
 * The funding-source `Budget` tab is keyed on milestone, not chart-of-accounts.
 * Real columns: Description, Start, End, Cost, Income, Contribution, Comments,
 * Milestone, Xero Inventory Item. A budget line is therefore:
 *   { description, start, end, cost, income, contribution, milestone, item, project }
 */

/**
 * Everything this reader discards is reported rather than silently dropped: a
 * malformed line used to vanish behind a Logger.log nobody reads. Each entry
 * carries `issues: [{ check, row?, detail }]` where `check` is a health-check id
 * from docs/HEALTH_CHECKS.md.
 *
 * @return {Array<{name, status, projectFolder, lines, hasProjectColumn, metadata,
 *                 tabs, forecast, sheetUrl, issues}>}
 *   one entry per funding-source spreadsheet found.
 */
function readAllBudgets() {
  const root = DriveApp.getFolderById(CONFIG.BUDGETS_ROOT_FOLDER_ID);

  // Two passes. The first only walks folders, which is cheap. The second opens each
  // spreadsheet, which costs 1-3 seconds apiece and is the bulk of a refresh. Counting
  // first is what lets the progress bar say "4 of 12" instead of animating meaninglessly.
  const found = [];
  const projectFolders = root.getFolders();
  while (projectFolders.hasNext()) {
    const projectFolder = projectFolders.next();
    if (startsWithArchive_(projectFolder.getName())) continue;
    collectStatusFolder_(projectFolder, CONFIG.SECURED_FOLDER_NAME, 'secured', found);
    collectStatusFolder_(projectFolder, CONFIG.PROPOSED_FOLDER_NAME, 'proposed', found);
  }

  const sources = [];
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    // Reading occupies the 20-50% band: measured at ~14s of a ~60s refresh.
    setRefreshProgress_('Reading ' + f.file.getName(), i + 1, found.length,
                        20 + Math.round(30 * i / Math.max(1, found.length)));
    readBudgetFile_(f.projectFolder, f.status, f.file, sources);
  }
  setRefreshProgress_('Read ' + found.length + ' funding source(s)',
                      found.length, found.length, 50);
  return sources;
}

function startsWithArchive_(name) {
  return name.indexOf(CONFIG.ARCHIVE_PREFIX) === 0;
}

/**
 * Names of archived funding sources, with ARCHIVE_PREFIX stripped off.
 *
 * Archiving is an act in Drive: the sheet moves to `archived/` and is usually renamed
 * with the prefix. Neither of those touches Xero, where the tracking option keeps the
 * name it was created with, forever. So filtering actuals on the tag starting with the
 * prefix only ever caught sources somebody had also renamed inside Xero, which in
 * practice is none of them. The archived sheet vanished from the dashboard while its
 * spend stayed in the organisation totals with no budget beside it, which is precisely
 * the mismatch that filter was written to prevent.
 *
 * Returned by name so the caller can match on the Xero tag as it actually reads.
 * Folder walk only, nothing is opened, so this costs about what counting costs.
 */
function readArchivedSourceNames() {
  const root = DriveApp.getFolderById(CONFIG.BUDGETS_ROOT_FOLDER_ID);
  const names = {};
  const note = n => {
    const bare = archivedSourceName_(n);
    if (bare) names[bare] = true;
  };

  const projectFolders = root.getFolders();
  while (projectFolders.hasNext()) {
    const projectFolder = projectFolders.next();
    if (startsWithArchive_(projectFolder.getName())) {
      // A whole archived project: everything beneath it is archived with it.
      [CONFIG.SECURED_FOLDER_NAME, CONFIG.PROPOSED_FOLDER_NAME,
       CONFIG.ARCHIVED_FOLDER_NAME].forEach(sub => eachSheetName_(projectFolder, sub, note));
      continue;
    }
    eachSheetName_(projectFolder, CONFIG.ARCHIVED_FOLDER_NAME, note);
    // A prefixed file still sitting in secured/ or proposed/ is archived in intent, and
    // the crawl already skips it, so its actuals must go the same way.
    [CONFIG.SECURED_FOLDER_NAME, CONFIG.PROPOSED_FOLDER_NAME].forEach(sub =>
      eachSheetName_(projectFolder, sub, n => { if (startsWithArchive_(n)) note(n); }));
  }
  return names;
}

/**
 * The funding-source name an archived sheet stands for, or '' when it is not one.
 *
 * Every sheet in `archived/` used to count, so an old budget there called "General" made
 * the cockpit drop everything Xero tagged General, and any legacy file's name became a tag
 * to ignore. Only a name shaped like a funding source (PROJECT_YY_SOURCE, upper case) now
 * counts, after its archive prefix is removed: Z_ARCH_, or the older Z_ARCHIVED_.
 */
function archivedSourceName_(fileName) {
  let n = String(fileName == null ? '' : fileName).trim();
  ['Z_ARCHIVED_', CONFIG.ARCHIVE_PREFIX].forEach(p => {
    if (n.indexOf(p) === 0) n = n.slice(p.length);
  });
  return /^[A-Z][A-Z0-9]*_\d{2}_[A-Z0-9_]+$/.test(n) ? n : '';
}

function eachSheetName_(projectFolder, subName, fn) {
  const subs = projectFolder.getFoldersByName(subName);
  if (!subs.hasNext()) return;
  const files = subs.next().getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) fn(files.next().getName());
}

/** Folder walk only. Nothing here opens a spreadsheet, so it stays cheap. */
function collectStatusFolder_(projectFolder, subName, status, out) {
  const subs = projectFolder.getFoldersByName(subName);
  if (!subs.hasNext()) return;
  const files = subs.next().getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const file = files.next();
    if (startsWithArchive_(file.getName())) continue;
    out.push({ projectFolder: projectFolder, status: status, file: file });
  }
}

/** Read one funding-source spreadsheet. This is the expensive step. */
function readBudgetFile_(projectFolder, status, file, out) {
  const entry = { name: file.getName(), status: status,
    projectFolder: projectFolder.getName(), lines: [], hasProjectColumn: false,
    metadata: {}, tabs: [], sheetUrl: '',
    forecast: { cost: {}, income: {}, comments: {} }, issues: [] };
  try {
    // Open once and share. This file used to be opened twice - once for the
    // Budget tab, once for Forecast - and the crawl already approaches the
    // Apps Script 6-minute limit.
    const ss = SpreadsheetApp.openById(file.getId());
    entry.sheetUrl = ss.getUrl();
    entry.tabs = ss.getSheets().map(s => s.getName());

    const parsed = parseBudgetFile_(ss, projectFolder.getName());
    entry.lines = parsed.lines;
    entry.hasProjectColumn = parsed.hasProjectColumn;
    entry.issues = entry.issues.concat(parsed.issues);

    // Metadata: the Funding_info tab wins where present, falling back to a
    // `key | value` block above the Budget columns.
    entry.metadata = parsed.metadata || {};
    const info = parseFundingInfoTab_(ss);
    if (info) Object.keys(info).forEach(k => { entry.metadata[k] = info[k]; });

    // Budget lines are passed in so Forecast row labels can be resolved against
    // them. Order matters: the Budget tab must be parsed first.
    const forecast = parseForecastTab_(ss, parsed.lines);
    entry.forecast = forecast.data;
    entry.issues = entry.issues.concat(forecast.issues);
  } catch (e) {
    // A file that will not parse is invisible on the dashboard. Report it as a
    // finding instead of only logging, and still push the entry so the source
    // appears in Health rather than disappearing without trace.
    entry.issues.push({ check: 'A1', detail: e.message });
    Logger.log('Skipped ' + file.getName() + ': ' + e.message);
  }
  out.push(entry);
}

function parseBudgetFile_(ss, projectFolderName) {
  const sheet = ss.getSheetByName(CONFIG.BUDGET_TAB);
  if (!sheet) throw new Error('no "' + CONFIG.BUDGET_TAB + '" tab');
  const data = sheet.getDataRange().getValues();

  // The header row is located, not assumed: a `key | value` metadata block may sit
  // above it (see BUDGET_SHEET_TEMPLATE.md).
  const headerRow = findHeaderRow_(data);
  if (headerRow === -1) {
    throw new Error('no column header row found in the first ' +
      (CONFIG.HEADER_SCAN_ROWS || 40) + ' rows (needs both "' +
      CONFIG.BUDGET_COLUMNS.start + '" and "' + CONFIG.BUDGET_COLUMNS.cost + '")');
  }
  const metadata = readMetadataBlock_(data, headerRow);

  const header = data[headerRow];
  const col = {};
  Object.keys(CONFIG.BUDGET_COLUMNS).forEach(k => {
    const expected = clean_(CONFIG.BUDGET_COLUMNS[k]).toLowerCase();
    col[k] = header.findIndex(h => clean_(h).toLowerCase() === expected);
  });
  CONFIG.BUDGET_REQUIRED_COLUMNS.forEach(req => {
    if (col[req] === -1) throw new Error('missing column ' + CONFIG.BUDGET_COLUMNS[req]);
  });
  const hasProjectColumn = col.project !== -1;

  const lines = [];
  const issues = [];
  let zeroRows = 0, missingItem = 0;

  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    const rowNo = i + 1; // 1-based, as it appears in Sheets
    const cost = parseAmount_(col.cost !== -1 ? row[col.cost] : 0);
    const income = parseAmount_(col.income !== -1 ? row[col.income] : 0);
    if (cost === 0 && income === 0) { zeroRows++; continue; } // blank/summary row

    const start = parseSheetDate_(row[col.start]);
    const end = parseSheetDate_(row[col.end]);
    if (!start || !end) {
      issues.push({ check: 'B2', row: rowNo, detail: 'unparseable date (Start "' +
        clean_(row[col.start]) + '", End "' + clean_(row[col.end]) + '") - line ignored' });
      continue;
    }
    if (end < start) {
      // Day-weighting a reversed range yields nonsense. Two-digit years are the
      // usual cause: "30/Jun/01" parses as the year 2001.
      issues.push({ check: 'B3', row: rowNo, detail: 'End ' + isoDate_(end) +
        ' precedes Start ' + isoDate_(start) + ' - line ignored' });
      continue;
    }

    // Project attribution: a line's `Project` value wins when set; otherwise
    // (no column, or blank cell) the line belongs to its parent project folder.
    const project = hasProjectColumn && row[col.project]
      ? clean_(row[col.project])
      : (projectFolderName || CONFIG.DEFAULT_PROJECT);

    const item = col.item !== -1 ? clean_(row[col.item]) : '';
    if (!item) missingItem++;

    lines.push({
      description: col.description !== -1 ? clean_(row[col.description]) : '',
      start: start, end: end,
      cost: cost, income: income,
      contribution: col.contribution !== -1 ? parseAmount_(row[col.contribution]) : (income - cost),
      account: col.account !== -1 ? clean_(row[col.account]) : '',
      milestone: col.milestone !== -1 ? clean_(row[col.milestone]) : '',
      item: item,
      project: project
    });
  }

  if (zeroRows) {
    issues.push({ check: 'B1', detail: zeroRows +
      ' line(s) skipped because Cost and Income are both 0' });
  }
  if (missingItem) {
    issues.push({ check: 'B4', detail: missingItem +
      ' line(s) have no "' + CONFIG.BUDGET_COLUMNS.item +
      '", so they fall outside milestone tracking' });
  }
  if (!hasProjectColumn) {
    issues.push({ check: 'A4', detail: 'no "' + CONFIG.BUDGET_COLUMNS.project +
      '" column, so lines cannot be split across projects' });
  }

  return { lines: lines, hasProjectColumn: hasProjectColumn,
    metadata: metadata, issues: issues };
}

/**
 * Locate the column header row: the first row (within HEADER_SCAN_ROWS) carrying
 * both the Start and Cost header names. Requiring both means a metadata row such
 * as `Funding start | 10/Aug/25` cannot be mistaken for it.
 */
function findHeaderRow_(data) {
  const startName = clean_(CONFIG.BUDGET_COLUMNS.start).toLowerCase();
  const costName = clean_(CONFIG.BUDGET_COLUMNS.cost).toLowerCase();
  const limit = Math.min(data.length, CONFIG.HEADER_SCAN_ROWS || 40);
  for (let i = 0; i < limit; i++) {
    const row = (data[i] || []).map(h => clean_(h).toLowerCase());
    if (row.indexOf(startName) !== -1 && row.indexOf(costName) !== -1) return i;
  }
  return -1;
}

/**
 * Read the Funding_info tab as `key | value` pairs from columns A and B.
 * Returns null when the tab is absent, so the caller can fall back to a metadata
 * block above the Budget columns. Rows with no value in column B - the tab title,
 * any legend, section headings - are skipped.
 */
function parseFundingInfoTab_(ss) {
  const sheet = ss.getSheetByName(CONFIG.FUNDING_INFO_TAB);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  const meta = {};
  for (let i = 0; i < data.length; i++) {
    const row = data[i] || [];
    const key = clean_(row[0]);
    if (!key) continue;
    const raw = row.length > 1 ? row[1] : '';
    const val = (raw instanceof Date) ? raw : clean_(raw);
    if (val === '') continue;
    meta[key.toLowerCase()] = val;
  }
  return meta;
}

/** Read the `key | value` block above the header row into a lower-cased map. */
function readMetadataBlock_(data, headerRow) {
  const meta = {};
  for (let i = 0; i < headerRow; i++) {
    const row = data[i] || [];
    const key = clean_(row[0]);
    if (!key) continue;
    const raw = row.length > 1 ? row[1] : '';
    meta[key.toLowerCase()] = (raw instanceof Date) ? raw : clean_(raw);
  }
  return meta;
}

/** yyyy-MM-dd without depending on Utilities/Session, so it stays unit-testable. */
function isoDate_(d) {
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** Parse "$5,600" / 5600 / "" into a Number (0 when blank/unparseable). */
function parseAmount_(value) {
  if (typeof value === 'number') return value;
  const n = parseFloat(String(value == null ? '' : value).replace(/[^0-9.\-]+/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Trim and strip stray zero-width / non-breaking spaces seen in some cells. */
function clean_(value) {
  return String(value == null ? '' : value)
    .replace(/[​-‍﻿ ]/g, '')
    .trim();
}

/** Accepts Date objects, DD/MMM/YY strings, and standard date strings. */
function parseSheetDate_(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'string' && value.trim()) {
    const m = /^(\d{2})\/([A-Za-z]{3})\/(\d{2})$/.exec(value.trim());
    if (m) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months.indexOf(m[2]);
      if (month === -1) return null;
      return new Date(2000 + parseInt(m[3], 10), month, parseInt(m[1], 10));
    }
    const d = new Date(value);
    if (!isNaN(d)) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

// ---- Forecast tab reader --------------------------------------------------

/**
 * Lowercase, collapse internal whitespace, trim. A stray double space typed into
 * one tab must not stop a label matching the same words in another.
 */
function normaliseLabel_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Build the map that lets the Forecast tab name budget lines in words a human
 * reads, rather than in item codes nobody wants to type.
 *
 * Every label form below points at the same item code, so any of them may appear
 * in Forecast column A:
 *
 *   the whole Inventory Item cell   "SPY_26_UOA_001 - Baseline model assessment"
 *   the bare item code              "SPY_26_UOA_001"
 *   the milestone                   "Baseline model assessment and data ingestion"
 *   description + " - " + milestone "Data Scientist - Baseline model assessment..."
 *   the description alone           "Data Scientist"
 *
 * Labels are matched whole and never split, so a description containing " - "
 * cannot be mis-parsed, and the composite form built by
 * `=Budget!A2 & " - " & Budget!G2` resolves even though its first segment is a
 * description rather than a code.
 *
 * A label pointing at more than one distinct item code is ambiguous. One
 * milestone spanning several accounts is not ambiguous: those lines share a code,
 * so the set collapses to one. Two milestones do not, and "Data Scientist"
 * appearing under both is reported rather than guessed at.
 */
function buildForecastLabelMap_(lines) {
  const map = {};
  function put(label, code) {
    const key = normaliseLabel_(label);
    if (!key || !code) return;
    if (!map[key]) map[key] = {};
    map[key][code] = true;
  }
  (lines || []).forEach(l => {
    const code = itemCode_(l.item);
    if (!code) return; // no code, nothing a forecast could attach to. B4 reports it.
    put(l.item, code);
    put(code, code);
    if (l.milestone) {
      put(l.milestone, code);
      if (l.description) put(l.description + ' - ' + l.milestone, code);
    }
    if (l.description) put(l.description, code);
  });
  return map;
}

/**
 * Resolve a Forecast column A cell to exactly one item code.
 * Returns { code } or { error } saying why not, never a guess.
 */
function resolveForecastLabel_(cellA, labelMap) {
  function lookup(label) {
    const hit = labelMap[normaliseLabel_(label)];
    return hit ? Object.keys(hit).sort() : [];
  }
  // Whole string first. This is what makes the composite label work: splitting it
  // would reduce "Data Scientist - <milestone>" back to an ambiguous description.
  let codes = lookup(cellA);
  if (codes.length === 1) return { code: codes[0] };
  if (codes.length > 1) {
    return { error: 'is ambiguous, matching ' + codes.join(' and ') +
      '. Name the milestone as well, e.g. "' + cellA + ' - <milestone>"' };
  }
  // Then the historic "CODE - Name" split, so sheets already carrying item codes
  // keep working untouched.
  const split = itemCode_(cellA);
  codes = lookup(split);
  if (codes.length === 1) return { code: codes[0] };
  if (codes.length > 1) {
    return { error: 'is ambiguous: "' + split + '" matches ' + codes.join(' and ') +
      '. Name the milestone as well' };
  }
  return { error: 'matches no line on the Budget tab' };
}

/**
 * Read the "Forecast" tab from a funding source spreadsheet.
 * Returns { data: { cost, income, comments }, sheetUrl, issues }.
 * The Forecast tab has Revenue and Expenses sections, a row label in column A and
 * quarter forecasts in subsequent columns. Stops at "Funding Source Details" or at the
 * "Nothing below this row is read" note.
 *
 * `budgetLines` are the already-parsed Budget tab lines. Row labels are resolved
 * against them at read time, so every key this returns is a real item code and
 * the rest of the system needs no knowledge of label forms.
 */
function parseForecastTab_(ss, budgetLines) {
  const sheetUrl = ss.getUrl();
  const sheet = ss.getSheetByName(CONFIG.FORECAST_TAB);
  const issues = [];
  const empty = { data: { cost: {}, income: {}, comments: {} },
    sheetUrl: sheetUrl, issues: issues };
  // An absent or empty Forecast tab is a valid state, not a finding: a quarter
  // with no override falls back to the budget baseline.
  if (!sheet) return empty;

  const data = sheet.getDataRange().getValues();
  if (!data.length) return empty;

  const labelMap = buildForecastLabelMap_(budgetLines);
  if (!Object.keys(labelMap).length) {
    // No budget line carries an item code, so there is nothing any forecast row
    // could attach to. One finding, not one per row - B4 already names the cause.
    issues.push({ check: 'A8', detail: 'the Forecast tab cannot be used: no line ' +
      'on the Budget tab has an "' + CONFIG.BUDGET_COLUMNS.item + '"' });
    return empty;
  }

  const result = { cost: {}, income: {}, comments: {}, rowQuarters: { cost: {}, income: {} } };
  const seenLabels = {}; // 'section||label' -> row number first seen on
  var section = null; // 'revenue' | 'expenses'
  var quarterCols = []; // [{ col, label }]
  var commentCol = -1;

  for (var i = 0; i < data.length; i++) {
    var cellA = clean_(String(data[i][0] || ''));

    // Stop at "Funding Source Details", or at the template's note saying nothing below is
    // read: a tab that kept the note but lost the heading had its note read as a milestone.
    if (cellA === 'Funding Source Details' || /^Nothing below this row is read/i.test(cellA)) break;

    // Detect section headers
    if (cellA === 'Revenue' || cellA === 'Expenses') {
      section = cellA.toLowerCase();
      quarterCols = [];
      commentCol = -1;
      for (var j = 1; j < data[i].length; j++) {
        var header = clean_(String(data[i][j] || ''));
        if (!header) continue;
        if (header.toLowerCase() === 'comments') { commentCol = j; continue; }
        var ql = parseQuarterHeader_(header);
        if (ql) { quarterCols.push({ col: j, label: ql }); continue; }
        // A header that does not match "MMM-MMM YY Forecast" is ignored, which
        // silently discards a whole quarter of forecast. Say so.
        issues.push({ check: 'A7', row: i + 1, detail: 'Forecast column header "' +
          header + '" does not match "MMM-MMM YY Forecast" (e.g. "Jul-Sep 26 ' +
          'Forecast") - that column is ignored' });
      }
      continue;
    }

    if (!section) continue;
    // Skip blank, Total, and summary rows
    if (!cellA || cellA.indexOf('Total') === 0) continue;

    // Resolve the label to an item code. Anything unresolvable or ambiguous is
    // reported against its row rather than being silently dropped, which is what
    // used to happen to every forecast written in words instead of codes.
    var resolved = resolveForecastLabel_(cellA, labelMap);
    if (!resolved.code) {
      issues.push({ check: 'A8', row: i + 1, detail: 'Forecast row "' + cellA +
        '" ' + resolved.error + ' - the row is ignored' });
      continue;
    }
    var code = resolved.code;

    // Two rows in one section carrying the same label is the signature of a sorted
    // Budget tab: `=Budget!A2 & " - " & Budget!G2` formulas hold their positions
    // while the values move underneath them, so labels duplicate and other lines
    // lose their forecast. The amounts are still summed - reporting must not cost
    // you data - but the duplication is named.
    var seenKey = section + '||' + normaliseLabel_(cellA);
    if (seenLabels[seenKey]) {
      issues.push({ check: 'A10', row: i + 1, detail: 'Forecast row "' + cellA +
        '" repeats the label on row ' + seenLabels[seenKey] + ' of the same ' +
        'section. If the Budget tab was sorted, the label formulas now point at ' +
        'the wrong lines' });
    } else {
      seenLabels[seenKey] = i + 1;
    }

    var kind = (section === 'revenue') ? 'income' : 'cost';
    var bucket = result[kind];
    var wrote = false;
    var negative = [];
    quarterCols.forEach(function (qc) {
      var val = data[i][qc.col];
      if (val !== null && val !== '' && !isNaN(Number(val))) {
        var key = code + '||' + qc.label;
        bucket[key] = (bucket[key] || 0) + Number(val);
        wrote = true;
        if (Number(val) < 0) negative.push(qc.label);
      }
    });
    // Cost and income are both entered as positive amounts; a minus sign on a cost
    // row turns spend into income. Kept as entered, but named.
    if (negative.length) {
      issues.push({ check: 'A12', row: i + 1, detail: (kind === 'cost' ? 'Expenses' :
        'Revenue') + ' row "' + cellA + '" is negative in ' + negative.join(', ') });
    }
    // The columns a row with an entry sat under. Once a row has a number in it, its
    // blanks mean 0 rather than "the budget stands"; see ownedForecast_.
    if (wrote) {
      var rq = result.rowQuarters[kind];
      var seenQ = rq[code] || (rq[code] = []);
      quarterCols.forEach(function (qc) {
        if (seenQ.indexOf(qc.label) === -1) seenQ.push(qc.label);
      });
    }

    if (commentCol >= 0) {
      var comment = clean_(String(data[i][commentCol] || ''));
      if (comment) result.comments[code] = comment;
    }
  }

  return { data: result, sheetUrl: sheetUrl, issues: issues };
}

/**
 * Parse a forecast tab header like "Jul-Sep 26 Forecast" into an FY quarter
 * label like "26/27 Q2". Returns null if the header doesn't match.
 */
function parseQuarterHeader_(header) {
  var m = /^([A-Za-z]{3})-[A-Za-z]{3}\s+(\d{2})\s+Forecast$/i.exec(header);
  if (!m) return null;
  var months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  var monthIdx = months.indexOf(m[1].toLowerCase());
  if (monthIdx === -1) return null;
  var year = 2000 + parseInt(m[2], 10);
  return labelOfQi_(qiOfDate_(new Date(year, monthIdx, 1)));
}
