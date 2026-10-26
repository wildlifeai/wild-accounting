/**
 * Probe.js
 * Read-only diagnostics, run by hand from the Apps Script editor. Nothing in a refresh
 * calls them, and none of them writes to Drive, the snapshot or Xero.
 *
 *   reportMargins()  : what moving each source's margin to General moves between
 *                      projects, beside what its Contribution policy expects.
 *
 * One-off probes are deleted once their question is answered. The two that asked whether
 * payroll reached the cockpit went on 2026-09-29: payroll posts as Xero Payroll bills,
 * which the cockpit already reads, and a live refresh showed every line tagged.
 * reportForecastPlan and reportEarnedPlan went on 2026-10-02, their switches on.
 * reportXeroJournals went the same day: journals are readable on the current Xero
 * connection, a grant paid upfront is deferred and released by quarter-end journals, and
 * those journals carry both tracking tags but no item code. reportContributions became
 * reportMargins on 2026-10-25, when General started taking each source's whole margin.
 */


/**
 * DRY RUN: what moving each source's margin to General moves between projects on the
 * Overview, on the Budget tab's own lines, beside the share its Contribution policy expects.
 * Reads the budget sheets the way a refresh does and changes nothing: not the snapshot, not
 * a sheet, not Xero. Drive only, no Xero call, so the margins are budgeted, not planned.
 */
function reportMargins() {
  const out = [];
  const say = (s) => { out.push(s); Logger.log(s); };
  const money = n => (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toLocaleString('en-NZ');
  const pad = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s + ' '; };

  say('==================== MARGIN DRY RUN ====================');
  say('Nothing is changed. Organisation totals and runway do not move; only the split');
  say('of income between projects does.');

  const r = marginMoves_(readAllBudgets());

  say('\nPer source:');
  r.sources.forEach(s => {
    let what;
    if (!s.rule) what = 'no margin: its own lines\' income equals their cost, or it has none';
    else if (s.rule.byCost) what = 'no income on its own lines, so General carries their cost';
    else what = Math.round(s.rule.rate * 1000) / 10 + '% margin';
    say('  ' + pad(s.name, 14) + pad(s.status, 9) + pad(what, 44) + money(s.toGeneral) +
      ' to General; "' + s.policy + '" expects ' + money(s.policyShare));
  });

  say('\nIncome moved, by status and project:');
  const keys = Object.keys(r.moves).sort();
  if (!keys.length) say('  none: no sheet has a margin');
  keys.forEach(k => {
    const p = k.split('||');
    say('  ' + pad(p[0], 9) + pad(p[1], 20) + (r.moves[k] > 0 ? '+' : '') + money(r.moves[k]));
  });
  return out.join('\n');
}
