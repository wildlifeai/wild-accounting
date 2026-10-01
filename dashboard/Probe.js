/**
 * Probe.js
 * Read-only diagnostics, run by hand from the Apps Script editor. Nothing in a refresh
 * calls them, and none of them writes to Drive, the snapshot or Xero.
 *
 *   reportContributions()  : what deriving General's overhead from each sheet's
 *                            Contribution policy moves between projects.
 *   reportEarnedPlan()     : what counting actuals on Xero's P&L terms and planning each
 *                            milestone from today, the two switches turned on together, moves.
 *
 * One-off probes are deleted once their question is answered. The two that asked whether
 * payroll reached the cockpit went on 2026-09-29: payroll posts as Xero Payroll bills,
 * which the cockpit already reads, and a live refresh showed every line tagged.
 * reportForecastPlan went on 2026-10-02, its switch on since 2026-09-30. reportXeroJournals
 * went the same day: journals are readable on the current Xero connection, a grant paid
 * upfront is deferred and released by quarter-end journals, and those journals carry both
 * tracking tags but no item code.
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
 * DRY RUN: what turning on CONFIG.ACTUALS_EARNED and CONFIG.PLAN_REMAINING together would
 * move. "now" is the refresh as configured; "on" counts actuals on Xero's P&L terms, with
 * sheets marked "as spent" earning income as they spend, and plans each milestone from
 * today: actuals for months gone, what is left for months to come. Reads the budget sheets
 * and Xero the way a refresh does, both ways, and changes nothing.
 */
function reportEarnedPlan() {
  const out = [];
  const say = (s) => { out.push(s); Logger.log(s); };
  const money = n => (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toLocaleString('en-NZ');
  const pad = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s + ' '; };
  const lpad = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s + ' '; };

  if (!isXeroConnected()) { say('Xero is not connected. Connect it from the web app first.'); return; }
  const now = new Date();
  const fy = fyBounds_(now);
  setArchivedSourceNames_(readArchivedSourceNames());
  const budgets = readAllBudgets();
  const reps = chooseExclusivityReps_(budgets);
  const since = earliestBudgetStart_(budgets);
  const forecastPlan = CONFIG.PLAN_FROM_FORECAST ? planBudgets_(budgets) : budgets;
  const actualNow = fetchXeroActuals(since);
  const actualOn = earnedActuals_(fetchXeroActuals(since, { earned: true }), budgets);
  const planOn = remainingPlan_(forecastPlan, actualOn, DateMath.monthKey(now));

  say('==================== EARNED PLAN DRY RUN ====================');
  say('Nothing is changed. "now" is the cockpit as it is; "on" counts actuals as Xero\'s');
  say('P&L does and plans each milestone from today: actuals so far, what is left after.');
  const marked = budgets.filter(b => incomeRecognition_(b) === 'as spent').map(b => b.name);
  say('\nMarked "Income recognition: as spent": ' + (marked.join(', ') || 'none'));

  const fyOf = (lines, kind) => sumMonthsInFY_(distributeByMonth_(lines, kind), fy);
  const all = (lines, kind) => lines.reduce((t, l) => t + (Number(l[kind]) || 0), 0);
  say('\nPlan per source that moves (' + fy.label + ', then all time):');
  say('  ' + pad('source', 14) + pad('', 7) + lpad(fy.label + ' now', 12) + lpad('on', 10) +
    lpad('all now', 10) + lpad('on', 10));
  let moved = 0;
  budgets.forEach((b, i) => {
    ['cost', 'income'].forEach(kind => {
      const v = [fyOf(forecastPlan[i].lines, kind), fyOf(planOn[i].lines, kind),
        all(forecastPlan[i].lines, kind), all(planOn[i].lines, kind)];
      if (v.every((x, j) => j % 2 || Math.abs(x - v[j + 1]) < 1)) return;
      moved++;
      say('  ' + pad(b.name, 14) + pad(kind, 7) + lpad(money(v[0]), 12) + lpad(money(v[1]), 10) +
        lpad(money(v[2]), 10) + lpad(money(v[3]), 10));
    });
  });
  if (!moved) say('  none');

  const cards = (plan, actual) => {
    const agg = aggregateBudgets_(plan, fy, reps);
    const t = { cost: 0, secured: 0, weighted: 0, actual: 0 };
    Object.keys(agg.projects).forEach(k => {
      const r = agg.projects[k];
      t.cost += r.proposedBudgetFY; t.secured += r.securedIncomeFY; t.weighted += r.weightedIncomeFY;
    });
    actual.forEach(l => {
      if (l.kind === 'expense' && l.project && !startsWith_(l.project, CONFIG.ARCHIVE_PREFIX) &&
          !isArchivedSource_(l.fundingSource) && new Date(l.date) >= fy.start &&
          new Date(l.date) <= fy.end) t.actual += Number(l.amount) || 0;
    });
    return t;
  };
  const a = cards(forecastPlan, actualNow), z = cards(planOn, actualOn);
  say('\nOverview cards, ' + fy.label + ' (now -> on):');
  say('  forecast budget -> expected cost  ' + money(a.cost) + ' -> ' + money(z.cost));
  say('  secured funding                   ' + money(a.secured) + ' -> ' + money(z.secured));
  say('  expected income                   ' + money(a.weighted) + ' -> ' + money(z.weighted));
  say('  actual                            ' + money(a.actual) + ' -> ' + money(z.actual));
  say('  secured minus cost                ' + money(a.secured - a.cost) + ' -> ' +
    money(z.secured - z.cost));

  const ra = buildRunway_(forecastPlan, actualNow, now, reps);
  const rz = buildRunway_(planOn, actualOn, now, reps);
  const when = r => ['secured', 'weighted', 'proposed'].map(k =>
    k + ' ' + (r.crossover[k] || 'none')).join(', ');
  say('\nRunway (now -> on):');
  say('  net position today  ' + money(ra.openingNet) + ' -> ' + money(rz.openingNet));
  say('  now: ' + when(ra));
  say('  on:  ' + when(rz));

  const found = buildHealth(budgets, actualOn, {}).filter(f => f.id === 'C8' || f.id === 'D7');
  say('\nFindings this would raise (C8, D7):');
  if (!found.length) say('  none');
  found.forEach(f => say('  ' + f.id + ' ' + pad(f.fundingSource || '', 14) + f.detail));
  return out.join('\n');
}
