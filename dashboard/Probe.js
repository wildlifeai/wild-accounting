/**
 * Probe.js
 * Read-only diagnostics, run by hand from the Apps Script editor. Nothing in a refresh
 * calls them, and none of them writes to Drive, the snapshot or Xero.
 *
 *   reportContributions()  : what deriving General's overhead from each sheet's
 *                            Contribution policy moves between projects.
 *   reportForecastPlan()   : what planning from each sheet's Forecast tab, instead of
 *                            the Budget tab's dates, moves on the Overview and runway.
 *   reportXeroJournals()   : which accounts the income the cockpit counts sits on, and what
 *                            Xero's manual journals would add if they were read.
 *
 * One-off probes are deleted once their question is answered. The two that asked whether
 * payroll reached the cockpit went on 2026-09-29: payroll posts as Xero Payroll bills,
 * which the cockpit already reads, and a live refresh showed every line tagged.
 */


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


/**
 * DRY RUN: what planning from each sheet's Forecast tab would move, against the Budget
 * tab's dates used today (CONFIG.PLAN_FROM_FORECAST). Reads the budget sheets the way a
 * refresh does and, when Xero is connected, the actuals for runway. Changes nothing: not
 * the snapshot, not a sheet, not Xero.
 */
function reportForecastPlan() {
  const out = [];
  const say = (s) => { out.push(s); Logger.log(s); };
  const money = n => (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toLocaleString('en-NZ');
  const pad = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s + ' '; };
  const lpad = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s + ' '; };

  const now = new Date();
  const fy = fyBounds_(now);
  const next = fyBounds_(new Date(fy.end.getFullYear(), fy.end.getMonth() + 1, 1));
  setArchivedSourceNames_(readArchivedSourceNames());
  const budgets = readAllBudgets();
  const planned = planBudgets_(budgets);
  const reps = chooseExclusivityReps_(budgets);

  say('==================== FORECAST PLAN DRY RUN ====================');
  say('Nothing is changed. "budget" is what the cockpit shows today, from the Budget tab');
  say('dates; "plan" is the Forecast tab where a row has an entry, its blanks then 0.');

  const fyOf = (lines, kind, b) => sumMonthsInFY_(distributeByMonth_(lines, kind), b);
  const total = (lines, kind) => lines.reduce((t, l) => t + (Number(l[kind]) || 0), 0);
  say('\nPer source that moves (' + fy.label + ' and ' + next.label + ', then all time):');
  say('  ' + pad('source', 14) + pad('', 7) + lpad(fy.label + ' budget', 13) +
    lpad('plan', 9) + lpad(next.label + ' budget', 13) + lpad('plan', 9) +
    lpad('all budget', 11) + lpad('plan', 9));
  let moved = 0;
  budgets.forEach((b, i) => {
    const p = planned[i];
    ['cost', 'income'].forEach(kind => {
      const v = [fyOf(b.lines, kind, fy), fyOf(p.lines, kind, fy),
        fyOf(b.lines, kind, next), fyOf(p.lines, kind, next),
        total(b.lines, kind), total(p.lines, kind)];
      if (Math.abs(v[0] - v[1]) < 1 && Math.abs(v[2] - v[3]) < 1 && Math.abs(v[4] - v[5]) < 1) return;
      moved++;
      say('  ' + pad(b.name, 14) + pad(kind, 7) + lpad(money(v[0]), 13) + lpad(money(v[1]), 9) +
        lpad(money(v[2]), 13) + lpad(money(v[3]), 9) + lpad(money(v[4]), 11) + lpad(money(v[5]), 9));
    });
  });
  if (!moved) say('  none: no Forecast tab changes any figure');

  const cards = (bs) => {
    const agg = aggregateBudgets_(bs, fy, reps);
    const t = { cost: 0, secured: 0, weighted: 0 };
    Object.keys(agg.projects).forEach(k => {
      const r = agg.projects[k];
      t.cost += r.proposedBudgetFY; t.secured += r.securedIncomeFY; t.weighted += r.weightedIncomeFY;
    });
    return t;
  };
  const a = cards(budgets), z = cards(planned);
  say('\nOverview cards, ' + fy.label + ' (budget -> plan):');
  say('  forecast budget   ' + money(a.cost) + ' -> ' + money(z.cost));
  say('  secured funding   ' + money(a.secured) + ' -> ' + money(z.secured));
  say('  expected income   ' + money(a.weighted) + ' -> ' + money(z.weighted));
  say('  secured minus cost ' + money(a.secured - a.cost) + ' -> ' + money(z.secured - z.cost));

  if (isXeroConnected()) {
    const actual = fetchXeroActuals(earliestBudgetStart_(budgets));
    const ra = buildRunway_(budgets, actual, now, reps), rz = buildRunway_(planned, actual, now, reps);
    const when = r => ['secured', 'weighted', 'proposed'].map(k =>
      k + ' ' + (r.crossover[k] || 'none')).join(', ');
    say('\nRunway, first month short (budget -> plan):');
    say('  budget: ' + when(ra));
    say('  plan:   ' + when(rz));
  } else {
    say('\nRunway not compared: Xero is not connected.');
  }

  const a11 = buildHealth(budgets.map(b => Object.assign({}, b, {
    forecast: ownedForecast_(b.forecast) })), [], {}).filter(f => f.id === 'A11');
  say('\nMilestones with a cost forecast and no income forecast (A11):');
  if (!a11.length) say('  none');
  a11.forEach(f => say('  ' + pad(f.fundingSource, 14) + f.detail));
  return out.join('\n');
}


/**
 * PROBE: before the cockpit counts income when it is earned, as Xero's P&L does, rather
 * than when it is invoiced. Answers three questions and changes nothing; it only sends
 * GET requests to Xero.
 *   1. Which account each income line the cockpit counts today sits on, so a grant
 *      invoiced to a liability such as Income in Advance shows up.
 *   2. Whether the current Xero connection can read manual journals at all.
 *   3. What the posted journals carry: account class, tracking, item codes in the
 *      description, and, per funding source and month, what reading them would add.
 * Journal amounts are signed in Xero (debit positive), so income is the negative of the
 * line amount and an accrual and its reversal net to zero.
 */
function reportXeroJournals() {
  const out = [];
  const say = (s) => { out.push(s); Logger.log(s); };
  const money = n => (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toLocaleString('en-NZ');
  const pad = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s + ' '; };
  const monthsOf = m => Object.keys(m).sort().map(k => k + ' ' + money(m[k])).join(', ');

  if (!isXeroConnected()) { say('Xero is not connected. Connect it from the web app first.'); return; }
  const now = new Date();
  const since = fyBounds_(new Date(now.getFullYear() - 1, now.getMonth(), 1)).start;
  say('==================== XERO JOURNALS PROBE ====================');
  say('Nothing is changed. Journals and income from ' + isoDate_(since) + ' on.');

  // Account code -> { name, class }. Class is ASSET, LIABILITY, EQUITY, REVENUE or EXPENSE.
  const accounts = {};
  (xeroGet_('/Accounts').Accounts || []).forEach(a => {
    accounts[a.Code] = { name: a.Name, cls: a.Class || '', type: a.Type || '' };
  });
  const classOfLabel = label => {
    const m = /\((\d+)\)\s*$/.exec(String(label || ''));
    return m && accounts[m[1]] ? accounts[m[1]].cls : '?';
  };

  // 1. Income the cockpit counts today, by account and funding source.
  say('\n1. Income the cockpit counts today, by account (invoices and bank receipts):');
  const income = {};
  fetchXeroActuals(since).forEach(l => {
    if (l.kind === 'expense') return;
    const k = l.account + '||' + (l.fundingSource || '(no funding source)');
    const e = income[k] || (income[k] = { total: 0, months: {} });
    const mk = DateMath.monthKey(new Date(l.date));
    e.total += l.amount;
    e.months[mk] = (e.months[mk] || 0) + l.amount;
  });
  const incomeKeys = Object.keys(income).sort();
  if (!incomeKeys.length) say('  none');
  incomeKeys.forEach(k => {
    const p = k.split('||'), cls = classOfLabel(p[0]);
    say('  ' + pad(p[0], 34) + pad(cls, 9) + pad(p[1], 16) + money(income[k].total) +
      (cls !== 'REVENUE' ? '   <- not income in Xero\'s P&L' : ''));
    say('      ' + monthsOf(income[k].months));
  });

  // 2. Can this connection read manual journals? Paged on purpose: an unpaged request
  // returns journals without their lines.
  say('\n2. Manual journals:');
  const journals = [];
  try {
    for (let page = 1; page < 200; page++) {
      const rows = (xeroGet_('/ManualJournals', { page: page }).ManualJournals) || [];
      rows.forEach(j => journals.push(j));
      if (rows.length < 100) break;
    }
  } catch (e) {
    say('  The current Xero connection cannot read them: ' + String(e.message).slice(0, 200));
    say('  Reading them needs a scope the connection does not hold, so a Xero re-consent.');
    return out.join('\n');
  }
  const posted = journals.filter(j => j.Status === 'POSTED' &&
    (parseXeroDate_(j.Date) || new Date(j.DateString)) >= since);
  const byStatus = {};
  journals.forEach(j => (byStatus[j.Status] = (byStatus[j.Status] || 0) + 1));
  say('  Readable. ' + journals.length + ' journal(s) in all (' + Object.keys(byStatus)
    .map(s => byStatus[s] + ' ' + s).join(', ') + '); ' + posted.length + ' posted since ' +
    isoDate_(since) + '.');

  // 3. What the posted journals carry.
  const P = CONFIG.XERO.PROJECT_TRACKING_CATEGORY, F = CONFIG.XERO.FUNDING_TRACKING_CATEGORY;
  const byClass = {}, bySource = {}, samples = { REVENUE: {}, EXPENSE: {} };
  posted.forEach(j => {
    const date = parseXeroDate_(j.Date) || new Date(j.DateString);
    const mk = DateMath.monthKey(date);
    (j.JournalLines || []).forEach(li => {
      const acct = accounts[li.AccountCode] || { name: '(' + li.AccountCode + ')', cls: '?' };
      const amt = Number(li.LineAmount) || 0;
      const project = trackingValue_(li.Tracking, P), source = trackingValue_(li.Tracking, F);
      const c = byClass[acct.cls] || (byClass[acct.cls] = { lines: 0, both: 0, one: 0,
        none: 0, coded: 0, effect: 0 });
      c.lines++;
      if (project && source) c.both++; else if (project || source) c.one++; else c.none++;
      if (codeFromDescription_(li.Description)) c.coded++;
      // P&L effect: income is a credit, so its sign flips; expense is a debit.
      const effect = acct.cls === 'REVENUE' ? -amt : amt;
      c.effect += effect;
      if (acct.cls !== 'REVENUE' && acct.cls !== 'EXPENSE') return;
      const s = bySource[(source || '(no funding source)') + '||' + acct.cls] ||
        (bySource[(source || '(no funding source)') + '||' + acct.cls] = { total: 0, months: {} });
      s.total += effect;
      s.months[mk] = (s.months[mk] || 0) + effect;
      const text = String(li.Description || j.Narration || '').slice(0, 60);
      if (Object.keys(samples[acct.cls]).length < 8) samples[acct.cls][text] = true;
    });
  });

  say('\n3. Posted journal lines by account class:');
  say('  ' + pad('class', 10) + pad('lines', 6) + pad('both tags', 10) + pad('one tag', 8) +
    pad('no tag', 7) + pad('item code', 10) + 'P&L effect');
  Object.keys(byClass).sort().forEach(k => {
    const c = byClass[k];
    say('  ' + pad(k, 10) + pad(c.lines, 6) + pad(c.both, 10) + pad(c.one, 8) +
      pad(c.none, 7) + pad(c.coded, 10) +
      (k === 'REVENUE' || k === 'EXPENSE' ? money(c.effect) : '(balance sheet, never counted)'));
  });

  say('\n4. What reading them would add, P&L lines by funding source:');
  const sourceKeys = Object.keys(bySource).sort();
  if (!sourceKeys.length) say('  nothing: no posted journal touches an income or expense account');
  sourceKeys.forEach(k => {
    const p = k.split('||');
    say('  ' + pad(p[0], 22) + pad(p[1] === 'REVENUE' ? 'income' : 'expense', 8) +
      money(bySource[k].total));
    say('      ' + monthsOf(bySource[k].months));
  });

  say('\n5. Sample descriptions (to see whether an item code leads them):');
  ['REVENUE', 'EXPENSE'].forEach(cls => {
    const t = Object.keys(samples[cls]);
    say('  ' + (cls === 'REVENUE' ? 'income' : 'expense') + ': ' +
      (t.length ? t.map(x => '"' + x + '"').join(' | ') : 'none'));
  });
  return out.join('\n');
}
