/**
 * Probe.js — one-off, READ-ONLY diagnostics. Delete once the questions are answered.
 *
 * Answers, in one run each:
 *   probeManualJournals()  – is the scope enough? does paging return JournalLines?
 *                            do payroll journal lines carry Projects + Funding source?
 *                            does the milestone survive via codeFromDescription_?
 *   probePayrollSources()  – is salary spend arriving as journals, or as bank
 *                            payments / bills (which the cockpit ALREADY sees)?
 *   reportContributions()  – what deriving General's overhead from each sheet's
 *                            Contribution policy would move between projects.
 *
 * All make read calls only. Nothing in Xero or Drive is modified.
 */

// Accounts that carry labour cost. Codes, not labels, so a Xero rename can't hide them.
const PROBE_LABOUR_CODES = ['477', '478', '410'];

// How many pages to walk before giving up (guards the 6-minute Apps Script limit).
const PROBE_MAX_PAGES = 10;


/** MAIN PROBE — run this first. */
function probeManualJournals() {
  const out = [];
  const say = (s) => { out.push(s); Logger.log(s); };

  say('==================== MANUAL JOURNAL PROBE ====================');

  if (!isXeroConnected()) {
    say('NOT CONNECTED. Run logXeroAuthUrl(), open the URL, then re-run.');
    return out.join('\n');
  }
  say('Connected. Tenant id: ' + getXeroTenantId());

  // ---- [1] Scope, and what an UNPAGED call returns -------------------------
  let unpaged;
  try {
    unpaged = xeroGet_('/ManualJournals');
    say('\n[1] SCOPE OK — GET /ManualJournals succeeded with the current scope.');
    say('    No scope change, no re-consent needed.');
  } catch (e) {
    say('\n[1] SCOPE FAILED — ' + e.message);
    say('    A 403 here means CONFIG.XERO.SCOPE needs accounting.manualjournals.read,');
    say('    then resetXeroConnection() + logXeroAuthUrl() + re-consent as the deploying user.');
    return out.join('\n');
  }
  const unpagedRows = unpaged.ManualJournals || [];
  const unpagedHasLines = unpagedRows.length > 0 &&
    Object.prototype.hasOwnProperty.call(unpagedRows[0], 'JournalLines');
  say('    Unpaged returned ' + unpagedRows.length + ' journals; JournalLines key present: ' +
      (unpagedHasLines ? 'YES' : 'NO'));

  // ---- [2] The load-bearing question: does ?page=1 return lines? -----------
  const paged = xeroGet_('/ManualJournals', { page: 1 });
  const rows = paged.ManualJournals || [];
  say('\n[2] PAGED (?page=1) returned ' + rows.length + ' journals.');
  say('    pagination: ' + (paged.pagination ? JSON.stringify(paged.pagination) : 'ABSENT'));
  const withLines = rows.filter(j => (j.JournalLines || []).length > 0).length;
  say('    journals with populated JournalLines: ' + withLines + ' of ' + rows.length);
  if (withLines === 0) {
    say('    >>> VERDICT: paging does NOT return lines on this tenant.');
    say('    >>> fetchManualJournalLines_ must do list-then-detail (N+1) or use /Journals.');
  } else {
    say('    >>> VERDICT: paging DOES return lines. A single-pass fetcher works.');
  }

  // ---- [3] Which statuses come back --------------------------------------
  const statuses = {};
  rows.forEach(j => { statuses[j.Status] = (statuses[j.Status] || 0) + 1; });
  say('\n[3] STATUSES on page 1: ' + JSON.stringify(statuses));
  say('    Anything other than POSTED confirms the fetcher needs a POSTED whitelist.');

  // ---- [4] Line-level anatomy of the most recent POSTED journals ----------
  const posted = rows
    .filter(j => j.Status === 'POSTED' && (j.JournalLines || []).length > 0)
    .sort((a, b) => (parseXeroDate_(b.Date) || 0) - (parseXeroDate_(a.Date) || 0))
    .slice(0, 3);

  say('\n[4] LINE ANATOMY — ' + posted.length + ' most recent POSTED journals');

  const excluded = {};
  (CONFIG.EXCLUDED_ACCOUNTS || []).forEach(a => { excluded[a] = true; });
  let nLines = 0, nProj = 0, nFund = 0, nMilestone = 0, nNegative = 0, nItemField = 0;

  posted.forEach((j, idx) => {
    const d = parseXeroDate_(j.Date);
    say('\n  --- [' + (idx + 1) + '] ' + (d ? Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd') : '?') +
        ' | ' + (j.Narration || '(no narration)') + ' ---');
    (j.JournalLines || []).forEach(jl => {
      nLines++;
      const label = accountLabelFromCode_(jl.AccountCode);
      const proj  = trackingValue_(jl.Tracking, CONFIG.XERO.PROJECT_TRACKING_CATEGORY);
      const fund  = trackingValue_(jl.Tracking, CONFIG.XERO.FUNDING_TRACKING_CATEGORY);
      const code  = codeFromDescription_(jl.Description);
      const amt   = Number(jl.LineAmount);
      if (proj) nProj++;
      if (fund) nFund++;
      if (code) nMilestone++;
      if (amt < 0) nNegative++;
      const hasItem = Object.prototype.hasOwnProperty.call(jl, 'Item') ||
                      Object.prototype.hasOwnProperty.call(jl, 'ItemCode');
      if (hasItem) nItemField++;

      say('   ' + (amt >= 0 ? 'DR' : 'CR') + ' ' + amt +
          '  ' + (label || '(no account)') + (excluded[label] ? '   <-- on EXCLUDED_ACCOUNTS' : ''));
      say('        description : "' + (jl.Description || '') + '"');
      say('        milestone   : ' + (code || 'NONE (codeFromDescription_ did not match)'));
      say('        Projects    : ' + (proj || '*** MISSING ***'));
      say('        Funding src : ' + (fund || '*** MISSING ***'));
      say('        Tracking raw: ' + JSON.stringify(jl.Tracking || []));
      if (hasItem) say('        !!! Item/ItemCode field present: ' +
                       JSON.stringify(jl.Item !== undefined ? jl.Item : jl.ItemCode));
    });
  });

  // ---- [5] Verdicts -------------------------------------------------------
  say('\n[5] VERDICTS over ' + nLines + ' sampled lines');
  say('    with Projects tracking      : ' + nProj + '/' + nLines);
  say('    with Funding source tracking: ' + nFund + '/' + nLines);
  say('    with parseable milestone    : ' + nMilestone + '/' + nLines);
  say('    negative (credit) amounts   : ' + nNegative + '/' + nLines +
      (nNegative ? '   -> signed amounts confirmed; do NOT Math.abs()' : ''));
  say('    lines exposing an Item field: ' + nItemField + '/' + nLines +
      (nItemField === 0 ? '   -> confirms milestone must come from the description' : ''));

  if (nLines > 0 && nProj < nLines) {
    say('\n    ACTION: lines without Projects tracking are DROPPED at Aggregator.js:96.');
  }
  if (nLines > 0 && nMilestone < nLines) {
    say('    ACTION: prefix each line description with "<CODE> - " e.g.');
    say('            "WW_25_TOI_002 - Salaries, <name>"  (pattern: XX_25_YYY_001)');
  }
  return out.join('\n');
}


/**
 * SECOND PROBE — settles where salary cost is actually coming from.
 * Compares labour spend the cockpit ALREADY sees (bank + invoices) against
 * labour spend sitting in manual journals it currently ignores.
 *
 * @param {string=} sinceISO e.g. '2026-01-01'. Defaults to 1 Apr of the current FY.
 */
function probePayrollSources(sinceISO) {
  const out = [];
  const say = (s) => { out.push(s); Logger.log(s); };

  if (!isXeroConnected()) { say('NOT CONNECTED.'); return out.join('\n'); }

  const since = sinceISO ? new Date(sinceISO) : new Date(new Date().getFullYear(), 3, 1);
  say('==================== PAYROLL SOURCE PROBE ====================');
  say('Window: everything modified since ' + Utilities.formatDate(since, 'UTC', 'yyyy-MM-dd'));

  const labour = {};
  PROBE_LABOUR_CODES.forEach(c => { labour[accountLabelFromCode_(c)] = c; });
  say('Labour accounts watched: ' + Object.keys(labour).join(', '));

  // --- what the cockpit sees today (bank transactions + invoices) ---
  const seen = fetchXeroActuals(since);
  let seenTotal = 0, seenCount = 0;
  seen.forEach(l => {
    if (labour[l.account] && l.kind === 'expense') { seenTotal += l.amount; seenCount++; }
  });
  say('\n[A] ALREADY VISIBLE via bank + invoices:');
  say('    ' + seenCount + ' lines, total ' + seenTotal.toFixed(2));

  // --- what is sitting in manual journals ---
  let mjTotal = 0, mjCount = 0, mjNoProject = 0, mjNoMilestone = 0, page = 1, journals = 0;
  const byAccount = {};
  while (page <= PROBE_MAX_PAGES) {
    const data = xeroGet_('/ManualJournals', { page: page });
    const rows = data.ManualJournals || [];
    if (!rows.length) break;
    rows.forEach(j => {
      journals++;
      if (j.Status !== 'POSTED') return;
      (j.JournalLines || []).forEach(jl => {
        const label = accountLabelFromCode_(jl.AccountCode);
        if (!labour[label]) return;
        const amt = Number(jl.LineAmount) || 0;
        mjTotal += amt;
        mjCount++;
        byAccount[label] = (byAccount[label] || 0) + amt;
        if (!trackingValue_(jl.Tracking, CONFIG.XERO.PROJECT_TRACKING_CATEGORY)) mjNoProject++;
        if (!codeFromDescription_(jl.Description)) mjNoMilestone++;
      });
    });
    if (rows.length < 100) break;
    page++;
  }

  say('\n[B] IN MANUAL JOURNALS (currently ignored by the cockpit):');
  say('    scanned ' + journals + ' journals across ' + page + ' page(s)');
  say('    ' + mjCount + ' labour lines, net total ' + mjTotal.toFixed(2));
  Object.keys(byAccount).forEach(k => say('      ' + k + ': ' + byAccount[k].toFixed(2)));
  say('    lines missing Projects tracking : ' + mjNoProject + '/' + mjCount);
  say('    lines missing a milestone code  : ' + mjNoMilestone + '/' + mjCount);

  say('\n[C] READ THIS AS:');
  if (mjCount === 0) {
    say('    No labour cost in manual journals. Payroll is reaching the cockpit already');
    say('    via bank/bills — the journal gap is PROSPECTIVE, and wiring up');
    say('    EXCLUDED_ACCOUNTS is the more urgent fix.');
  } else if (Math.abs(mjTotal) < 1) {
    say('    Journal labour lines net to ~zero — these are accruals and their reversals,');
    say('    not pay runs. Preserve signs so they keep netting to zero.');
    say('    Payroll itself is arriving via bank/bills.');
  } else {
    say('    ' + mjTotal.toFixed(2) + ' of labour cost is invisible to the dashboard today.');
    say('    Compare against [A]: that is the scale of the understatement.');
  }
  return out.join('\n');
}


/**
 * DRY RUN: what deriving General's overhead from each sheet's Contribution policy would
 * move between projects on the Overview. Reads the budget sheets the way a refresh does
 * and changes nothing: not the snapshot, not a sheet, not Xero. Drive only, no Xero call.
 */
function reportContributions() {
  const out = [];
  const say = (s) => { out.push(s); Logger.log(s); };
  const money = n => (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toLocaleString('en-NZ');
  const pad = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s + ' '; };

  say('==================== CONTRIBUTION DRY RUN ====================');
  say('Nothing is changed. Organisation totals and runway do not move; only the split');
  say('of income between projects does.');

  const r = contributionMoves_(readAllBudgets());
  const valid = p => (CONFIG.CONTRIBUTION_POLICIES || []).some(re => re.test(normalisePolicy_(p)));

  say('\nPer source:');
  r.sources.forEach(s => {
    let what;
    if (s.rate) {
      what = Math.round(s.rate * 1000) / 10 + '% of income on non-General lines, ' +
        money(s.toGeneral) + ' to General';
    } else if (!s.policy) {
      what = 'nothing derived: no policy set (C6)';
    } else if (!valid(s.policy)) {
      what = 'nothing derived: not a policy the code understands (C6)';
    } else if (normalisePolicy_(s.policy) === 'per_line') {
      what = 'nothing derived: its General lines are already on General';
    } else {
      what = 'nothing derived';
    }
    say('  ' + pad(s.name, 14) + pad(s.status, 9) + pad('"' + s.policy + '"', 24) + what);
  });

  say('\nIncome moved, by status and project:');
  const keys = Object.keys(r.moves).sort();
  if (!keys.length) say('  none: no sheet has a percent_of_income policy');
  keys.forEach(k => {
    const p = k.split('||');
    say('  ' + pad(p[0], 9) + pad(p[1], 20) + (r.moves[k] > 0 ? '+' : '') + money(r.moves[k]));
  });
  return out.join('\n');
}
