/**
 * Board.js
 * The finance the board pack reports, under the Overview's runway chart: income, cost and
 * surplus by project (or by funding source or milestone, as the chart is grouped), for each
 * financial year ticked. This year against the budget the board approved, a later year on
 * secured money, expected and full. Worked out from the runway's parts, so it shows the same
 * money as the chart, by financeTable_, which the page runs as it runs runwayWalk_.
 *
 * Grouped by project, a project shows its income as its funders give it and, on its own line,
 * the margin it passes to General (marginRule_); General shows the margins it receives. That
 * is how the board's updates set out a project's surplus.
 */

/**
 * Income, margin, cost and surplus by group for each year in `years`
 * ([{ label, from, to }], months as 'YYYY-MM'), from runway parts (runwayParts_):
 * [{ key, years: { <label>: { actual, secured, expected, full } } }], each scenario
 * { income, margin, cost, surplus }, the groups in the order first met and 'All' last.
 *
 * Months before nowKey are Xero actuals in every scenario, and `actual` holds them alone;
 * from nowKey on, the plan: secured money only, expected (each application at its
 * probability, work that goes ahead only if funded at the same weight) or full (every
 * application won), as runwayWalk_ counts them.
 *
 * `groupBy` is the part's field to group on. By 'project', a margin part (General's income
 * from one source, milestone "<source> (margin)") is shown against the project it came from,
 * the source's largest part off `general`, as that project's margin to General; by any other
 * field it groups as any part does.
 *
 * Self-contained on purpose, like runwayWalk_: the page receives this function's own source
 * (Index.html), so the table runs exactly the code the tests run here. It may not call
 * anything outside itself.
 */
function financeTable_(parts, nowKey, years, groupBy, general) {
  parts = parts || [];
  const isMargin = p => p.project === general && p.milestone === p.fundingSource + ' (margin)';
  const size = p => [p.cost, p.actualCost, p.income, p.actualIncome].reduce((t, m) =>
    t + Object.keys(m || {}).reduce((s, k) => s + Math.abs(m[k] || 0), 0), 0);
  const owner = {};
  if (groupBy === 'project') {
    parts.forEach(p => {
      if (p.project === general || isMargin(p)) return;
      const o = owner[p.fundingSource];
      if (!o || size(p) > o.size) owner[p.fundingSource] = { key: p.project, size: size(p) };
    });
  }

  const groups = {}, order = [];
  const blank = () => ({ income: 0, margin: 0, cost: 0 });
  function cell(key, label) {
    if (!groups[key]) { groups[key] = {}; order.push(key); }
    return groups[key][label] || (groups[key][label] =
      { actual: blank(), secured: blank(), expected: blank(), full: blank() });
  }

  (years || []).forEach(y => {
    const inYear = k => k >= y.from && k <= y.to;
    parts.forEach(p => {
      const secured = p.status === 'secured';
      const w = secured ? 1 : (typeof p.probability === 'number' ? p.probability : 0);
      const ifFunded = !secured && !!p.ifFunded;
      const own = p[groupBy] || '(unassigned)';
      const from = groupBy === 'project' && isMargin(p) && owner[p.fundingSource]
        ? owner[p.fundingSource].key : null;
      // A margin passes from the project it came from to General. The total takes every
      // part's income once: a project's part is its income less the margin, the margin part
      // the rest.
      const income = (sc, v) => {
        if (from) {
          cell(from, y.label)[sc].income += v;
          cell(from, y.label)[sc].margin -= v;
          cell(own, y.label)[sc].margin += v;
        } else {
          cell(own, y.label)[sc].income += v;
        }
        cell('All', y.label)[sc].income += v;
      };
      const cost = (sc, v) => {
        cell(own, y.label)[sc].cost += v;
        cell('All', y.label)[sc].cost += v;
      };
      Object.keys(p.actualCost || {}).forEach(k => {
        if (k >= nowKey || !inYear(k)) return;
        ['actual', 'secured', 'expected', 'full'].forEach(sc => cost(sc, p.actualCost[k]));
      });
      Object.keys(p.actualIncome || {}).forEach(k => {
        if (k >= nowKey || !inYear(k)) return;
        ['actual', 'secured', 'expected', 'full'].forEach(sc => income(sc, p.actualIncome[k]));
      });
      Object.keys(p.cost || {}).forEach(k => {
        if (k < nowKey || !inYear(k)) return;
        const c = p.cost[k];
        if (ifFunded) { cost('expected', c * w); cost('full', c); return; }
        ['secured', 'expected', 'full'].forEach(sc => cost(sc, c));
      });
      Object.keys(p.income || {}).forEach(k => {
        if (k < nowKey || !inYear(k)) return;
        const v = p.income[k];
        if (secured) income('secured', v);
        income('expected', v * w);
        income('full', v);
      });
    });
  });

  // Whole dollars, and the surplus from them, so a row always adds up on the page.
  Object.keys(groups).forEach(g => Object.keys(groups[g]).forEach(l =>
    Object.keys(groups[g][l]).forEach(sc => {
      const f = groups[g][l][sc];
      f.income = Math.round(f.income); f.margin = Math.round(f.margin);
      f.cost = Math.round(f.cost); f.surplus = f.income - f.cost;
    })));
  return order.filter(k => k !== 'All').concat(groups.All ? ['All'] : [])
    .map(k => ({ key: k, years: groups[k] }));
}

/**
 * What the page needs beside the parts to lay the finance table out, for people with full
 * access: the Board budget tab's rows (readBoardBudget_) and the order the board's updates
 * list the projects in. A sheet that cannot be read leaves the budget columns out rather than
 * failing the page.
 */
function boardBudgetPayload_() {
  let budget = [];
  try { budget = readBoardBudget_(); } catch (e) {
    Logger.log('Board budget not read: ' + e.message);
  }
  return { budget: budget, projects: CONFIG.BOARD.PROJECTS, totalRow: CONFIG.BOARD.TOTAL_ROW,
    general: CONFIG.GENERAL_PROJECT };
}
