/**
 * Probe.js
 * Read-only diagnostics, run by hand from the Apps Script editor. Nothing in a refresh
 * calls them, and none of them writes to Drive, the snapshot or Xero.
 *
 *   reportContributions()  – what deriving General's overhead from each sheet's
 *                            Contribution policy moves between projects.
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
