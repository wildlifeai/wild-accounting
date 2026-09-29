/**
 * Probe.js
 * Read-only diagnostics, run by hand from the Apps Script editor. Nothing in a refresh
 * calls them, and none of them writes to Drive, the snapshot or Xero.
 *
 *   reportContributions()  – what deriving General's overhead from each sheet's
 *                            Contribution policy moves between projects.
 *   reportForecastPlan()   – what planning from each sheet's Forecast tab, instead of
 *                            the Budget tab's dates, moves on the Overview and runway.
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
