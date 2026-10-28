/**
 * Performance.js
 * The Board tab's Performance section: the strategy's KPIs by pou. Their values come from the
 * Performance sheet, a KPIs tab (one row per KPI) and a Values tab (one row per KPI per
 * period), except the three the cockpit works out itself from Xero and the runway
 * (computedKpis_). Read at refresh into the snapshot, so a value ages with every other number;
 * performanceView_ lays one financial year out, and missingKpis_ feeds health check P1.
 */

/**
 * The Performance sheet as read: { url, kpis, values }, or { issue } when it cannot be: no
 * sheet, a missing tab, or an error opening it. Never throws, so a refresh does not depend on
 * it; P2 reports the issue.
 */
function readPerformance_() {
  try {
    const id = performanceSheetId_();
    if (!id) return { issue: 'no sheet named "' + CONFIG.PERFORMANCE.FILE_NAME +
      '" in the Budgets folder' };
    const ss = SpreadsheetApp.openById(id);
    const kpis = ss.getSheetByName(CONFIG.PERFORMANCE.KPIS_TAB);
    const values = ss.getSheetByName(CONFIG.PERFORMANCE.VALUES_TAB);
    if (!kpis || !values) return { url: ss.getUrl(), issue: 'it needs a "' +
      CONFIG.PERFORMANCE.KPIS_TAB + '" tab and a "' + CONFIG.PERFORMANCE.VALUES_TAB + '" tab' };
    // Displayed text, so a period such as "25/26" cannot arrive as a date.
    return { url: ss.getUrl(), kpis: kpiRows_(kpis.getDataRange().getDisplayValues()),
      values: kpiValueRows_(values.getDataRange().getDisplayValues()) };
  } catch (e) {
    Logger.log('Performance sheet not read: ' + e.message);
    return { issue: 'it could not be opened: ' + e.message };
  }
}

/** The Performance sheet's id: its Script Property, or the sheet of that name in the Budgets folder. */
function performanceSheetId_() {
  const id = getSecret(CONFIG.PERFORMANCE.PROPERTY_KEY);
  if (id) return id;
  const files = DriveApp.getFolderById(CONFIG.BUDGETS_ROOT_FOLDER_ID)
    .getFilesByName(CONFIG.PERFORMANCE.FILE_NAME);
  while (files.hasNext()) {
    const f = files.next();
    if (f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    setSecret(CONFIG.PERFORMANCE.PROPERTY_KEY, f.getId());
    return f.getId();
  }
  return '';
}

/** A tab's rows, header first, as objects keyed by the header's lower-cased names. */
function headedRows_(values) {
  const head = (values[0] || []).map(h => clean_(h).toLowerCase());
  return (values || []).slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { if (h) o[h] = clean_(r[i]); });
    return o;
  });
}

/** The KPIs tab: { id, name, pou, unit, cadence, reportedTo, status, replaces, owner, computed, ytd }. */
function kpiRows_(values) {
  return headedRows_(values || []).filter(r => r['kpi id'] && r['kpi']).map(r => ({
    id: r['kpi id'], name: r['kpi'], pou: r['pou'] || '', unit: r['unit'] || '',
    cadence: (r['cadence'] || '').toLowerCase(), reportedTo: r['reported to'] || '',
    status: (r['status'] || '').toLowerCase(), since: r['since'] || '',
    replaces: r['replaces'] || '', retired: r['retired'] || '', owner: r['owner'] || '',
    computed: /^(yes|y|true)$/i.test(r['computed'] || ''),
    // How the year to date is made from the quarters: added up, or the latest one.
    ytd: /^latest$/i.test(r['year to date'] || '') ? 'latest' : 'sum'
  }));
}

/** The Values tab: { period, id, project, value, evidence, note }, value a number or null. */
function kpiValueRows_(values) {
  return headedRows_(values || []).filter(r => r['period'] && r['kpi id']).map(r => {
    const raw = r['value'] || '';
    return { period: r['period'], id: r['kpi id'], project: r['project'] || '',
      value: raw === '' ? null : parseAmount_(raw), evidence: r['evidence'] || '',
      note: r['note'] || '' };
  });
}

/**
 * The three Toitūtanga KPIs the cockpit works out, by quarter of the financial year starting
 * `fyStartYear`, with their year to date: { T1: { byQ, ytd }, T2: { byQ, ytd, funder }, T3 }.
 *
 * T1 earned income share: income on the accounts in CONFIG.PERFORMANCE.EARNED_INCOME_ACCOUNTS
 * over all income, from Xero. T2 income concentration: the largest funder's share of income,
 * by each sheet's Funder. T3 months of runway: the secured line's, as at this refresh, under
 * the current quarter. Percentages run 0 to 100.
 */
function computedKpis_(actualLines, budgets, runway, fyStartYear, now) {
  const funderOf = {};
  (budgets || []).forEach(b => {
    funderOf[b.name] = clean_((b.metadata || {})['funder'] || '') || b.name;
  });
  const earned = {};
  (CONFIG.PERFORMANCE.EARNED_INCOME_ACCOUNTS || []).forEach(c => (earned[c] = true));
  const fy = fyLabel_(fyStartYear);
  const byQ = {};          // quarter -> { total, earned, funders: { name: amount } }
  const ytd = { total: 0, earned: 0, funders: {} };
  (actualLines || []).forEach(l => {
    if (l.kind === 'expense') return;
    if (!l.project || startsWith_(l.project, CONFIG.ARCHIVE_PREFIX)) return;
    if (isArchivedSource_(l.fundingSource)) return;
    const q = quarterOfMonthKey_(DateMath.monthKey(new Date(l.date)));
    if (q.indexOf(fy) !== 0) return;
    const amount = Number(l.amount) || 0;
    const code = (/\((\w+)\)\s*$/.exec(l.account || '') || [])[1] || '';
    const funder = funderOf[clean_(l.fundingSource || '')] || clean_(l.fundingSource || '') ||
      '(no funding source)';
    const b = byQ[q] || (byQ[q] = { total: 0, earned: 0, funders: {} });
    [b, ytd].forEach(t => {
      t.total += amount;
      if (earned[code]) t.earned += amount;
      t.funders[funder] = (t.funders[funder] || 0) + amount;
    });
  });
  const share = (part, whole) => whole > 0 ? Math.round(1000 * part / whole) / 10 : null;
  const top = t => Object.keys(t.funders).sort((a, b) => t.funders[b] - t.funders[a])[0] || null;
  const out = { T1: { byQ: {}, ytd: share(ytd.earned, ytd.total) },
    T2: { byQ: {}, ytd: ytd.total > 0 && top(ytd) ? share(ytd.funders[top(ytd)], ytd.total) : null,
      funder: top(ytd) },
    T3: { byQ: {}, ytd: null } };
  Object.keys(byQ).forEach(q => {
    const b = byQ[q];
    out.T1.byQ[q] = share(b.earned, b.total);
    if (top(b)) out.T2.byQ[q] = share(b.funders[top(b)], b.total);
  });
  const months = runway && runway.monthsOfRunway ? runway.monthsOfRunway.secured : null;
  if (months !== null && months !== undefined) {
    const q = currentQuarterLabel(now);
    out.T3.byQ[q] = months;
    out.T3.ytd = months;
  }
  return out;
}

/**
 * One financial year of the Performance section, from the snapshot's `performance` (as read,
 * with `computed`): each pou with its KPIs that have a value this year or last, every quarter,
 * the year to date and last year's figure as the comparative; the KPIs not measured yet, by
 * pou; and the KPIs added, changed, carried or retired. Pure.
 */
function performanceView_(perf, fyStartYear) {
  const fy = fyLabel_(fyStartYear), prior = fyLabel_(fyStartYear - 1);
  const quarters = [1, 2, 3, 4].map(n => fy + ' Q' + n);
  if (!perf || perf.issue) {
    return { fy: fy, comparative: prior, quarters: quarters, pous: [], changed: [],
      issue: perf ? perf.issue : 'not read yet: refresh', url: perf ? perf.url || '' : '' };
  }
  const computed = perf.computed || {};
  const byKpi = {};
  (perf.values || []).forEach(v => {
    if (v.value === null) return;
    const k = byKpi[v.id] || (byKpi[v.id] = {});
    (k[v.period] = k[v.period] || []).push(v.value);
  });
  const pous = [];
  const pouOf = {};
  (perf.kpis || []).forEach(k => {
    if (k.status === 'retired') return;
    if (!pouOf[k.pou]) { pouOf[k.pou] = { pou: k.pou, kpis: [], notMeasured: [] }; pous.push(pouOf[k.pou]); }
    // Several rows for one period, one per project, add up; a percentage or score averages.
    const avg = /^(%|score)$/i.test(k.unit);
    const periodValue = p => {
      const list = (byKpi[k.id] || {})[p];
      if (!list || !list.length) return null;
      const sum = list.reduce((t, x) => t + x, 0);
      return avg ? Math.round(10 * sum / list.length) / 10 : sum;
    };
    const values = {};
    const c = computed[k.id];
    quarters.forEach(q => {
      const v = k.computed && c ? (c.byQ || {})[q] : periodValue(q);
      if (v !== null && v !== undefined) values[q] = v;
    });
    const filled = quarters.filter(q => values[q] !== undefined);
    let ytd = periodValue(fy);
    if (k.computed && c) ytd = c.ytd;
    else if (ytd === null && filled.length) {
      ytd = k.ytd === 'latest' ? values[filled[filled.length - 1]]
        : filled.reduce((t, q) => t + values[q], 0);
      if (avg && k.ytd !== 'latest') ytd = Math.round(10 * ytd / filled.length) / 10;
    }
    const comparative = periodValue(prior);
    const row = { id: k.id, name: k.name, unit: k.unit, owner: k.owner,
      reportedTo: k.reportedTo, computed: k.computed, values: values,
      ytd: ytd === undefined ? null : ytd, comparative: comparative,
      note: k.computed && k.id === 'T2' && c && c.funder ? 'largest: ' + c.funder : '' };
    if (filled.length || row.ytd !== null || comparative !== null) pouOf[k.pou].kpis.push(row);
    else pouOf[k.pou].notMeasured.push({ id: k.id, name: k.name, owner: k.owner });
  });
  const changed = (perf.kpis || []).filter(k => k.status && k.status !== 'current')
    .map(k => ({ id: k.id, name: k.name, status: k.status, replaces: k.replaces,
      retired: k.retired }));
  return { fy: fy, comparative: prior, quarters: quarters, pous: pous, changed: changed,
    url: perf.url || '' };
}

/** What health checks P1 and P2 need: { issue, url, quarter, missing }. */
function performanceHealth_(perf, quarter) {
  return { issue: (perf && perf.issue) || null, url: (perf && perf.url) || '', quarter: quarter,
    missing: missingKpis_(perf, quarter) };
}

/**
 * KPIs owed a value for `quarter`, by owner, for P1: [{ owner, kpis: [{ id, name }] }]. A
 * quarterly KPI the cockpit does not work out, not retired, with no value for that quarter.
 */
function missingKpis_(perf, quarter) {
  if (!perf || perf.issue || !quarter) return [];
  const has = {};
  (perf.values || []).forEach(v => { if (v.value !== null) has[v.id + '||' + v.period] = true; });
  const byOwner = {};
  (perf.kpis || []).forEach(k => {
    if (k.status === 'retired' || k.computed || k.cadence !== 'quarterly') return;
    if (has[k.id + '||' + quarter]) return;
    const o = k.owner || '(no owner)';
    (byOwner[o] = byOwner[o] || []).push({ id: k.id, name: k.name });
  });
  return Object.keys(byOwner).sort().map(o => ({ owner: o, kpis: byOwner[o] }));
}
