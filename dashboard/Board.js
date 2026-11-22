/**
 * Board.js
 * The finance the board pack reports, under the Overview's runway chart: income, cost and
 * surplus by project (or by funding source or milestone, as the chart is grouped), for each
 * financial year ticked. This year against the budget the board approved, a later year on
 * secured money, expected and full. Worked out from the runway's parts, so it shows the same
 * money as the chart, by financeTable_, which the page runs as it runs runwayWalk_.
 *
 * Grouped by project, a project shows its income as its funders give it, so its surplus adds
 * to reserves and its loss draws on them, as the Treasurer sets it out, and General shows
 * only its own income and cost. The margin each source passes to General (marginRule_) goes
 * back here to the projects it came from, though every other view keeps it with General: it
 * moves money between projects and nets to zero, so the organisation's totals are the same
 * either way.
 */

/**
 * Income, cost and surplus by group for each year in `years`
 * ([{ label, from, to }], months as 'YYYY-MM'), from runway parts (runwayParts_):
 * [{ key, years: { <label>: { actual, secured, expected, full } } }], each scenario
 * { income, cost, surplus }, the groups in the order first met and 'All' last.
 *
 * Months before nowKey are Xero actuals in every scenario, and `actual` holds them alone;
 * from nowKey on, the plan: secured money only, expected (each application at its
 * probability, work that goes ahead only if funded at the same weight) or full (every
 * application won), as runwayWalk_ counts them.
 *
 * `groupBy` is the part's field to group on. By 'project', a margin part (General's income
 * from one source, milestone "<source> (margin)") goes back as income to the source's
 * projects off `general`, each month split in proportion to their income that month net of
 * the margin. Every part of a source has the same margin rate, so each project gets back
 * exactly the margin its own income gave. In a month where they net to nothing it goes to
 * the source's largest part; with no such part it stays with General. So a project's income
 * is what its funders give, and General keeps only its own. By any other field a margin part
 * groups as any part does.
 *
 * `shown`, by project only and optional, is the projects to count: a part, or a margin's
 * share, counts only when the project it lands on is among them, and 'All' is what they add
 * up to. So a project's figures do not depend on whether General is shown. Without it, every
 * part counts, and 'All' takes every part's income once, as it does whenever each share of a
 * margin is shown.
 *
 * Self-contained on purpose, like runwayWalk_: the page receives this function's own source
 * (Index.html), so the table runs exactly the code the tests run here. It may not call
 * anything outside itself.
 */
function financeTable_(parts, nowKey, years, groupBy, general, shown) {
  parts = parts || [];
  const byProject = groupBy === 'project';
  const isMargin = p => p.project === general && p.milestone === p.fundingSource + ' (margin)';
  const size = p => [p.cost, p.actualCost, p.income, p.actualIncome].reduce((t, m) =>
    t + Object.keys(m || {}).reduce((s, k) => s + Math.abs(m[k] || 0), 0), 0);
  const counts = key => !byProject || !shown || shown.indexOf(key) !== -1;

  // By project, each source's projects off General: their net income month by month, planned
  // and actual, which its margin is split back across, and the largest part's project.
  const bySource = {};
  if (byProject) {
    parts.forEach(p => {
      if (p.project === general || isMargin(p)) return;
      const s = bySource[p.fundingSource] || (bySource[p.fundingSource] =
        { income: {}, actualIncome: {}, top: null, size: -1 });
      ['income', 'actualIncome'].forEach(f => Object.keys(p[f] || {}).forEach(k => {
        const m = s[f][k] || (s[f][k] = {});
        m[p.project] = (m[p.project] || 0) + (p[f][k] || 0);
      }));
      if (size(p) > s.size) { s.top = p.project; s.size = size(p); }
    });
  }
  // Where a part's income in month k of map f lands: [group, share] pairs.
  function split(p, f, k) {
    const s = byProject && isMargin(p) ? bySource[p.fundingSource] : null;
    if (!s) return [[p[groupBy] || '(unassigned)', 1]];
    const m = s[f][k] || {};
    const net = Object.keys(m).reduce((t, j) => t + m[j], 0);
    if (Math.abs(net) < 0.005) return [[s.top, 1]];
    return Object.keys(m).filter(j => m[j]).map(j => [j, m[j] / net]);
  }

  const groups = {}, order = [];
  const blank = () => ({ income: 0, cost: 0 });
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
      // One month's income, `byCase` the amount in each scenario it counts in, to every group
      // it lands on that counts. The total takes the whole amount when every share counts,
      // so splitting a margin cannot move it.
      const income = (f, k, byCase) => {
        const to = split(p, f, k), seen = to.filter(d => counts(d[0]));
        if (!seen.length) return;
        Object.keys(byCase).forEach(sc => {
          const v = byCase[sc];
          let t = 0;
          seen.forEach(d => {
            const x = d[1] === 1 ? v : v * d[1];
            cell(d[0], y.label)[sc].income += x;
            t += x;
          });
          cell('All', y.label)[sc].income += seen.length === to.length ? v : t;
        });
      };
      const cost = (sc, v) => {
        if (!counts(own)) return;
        cell(own, y.label)[sc].cost += v;
        cell('All', y.label)[sc].cost += v;
      };
      Object.keys(p.actualCost || {}).forEach(k => {
        if (k >= nowKey || !inYear(k)) return;
        ['actual', 'secured', 'expected', 'full'].forEach(sc => cost(sc, p.actualCost[k]));
      });
      Object.keys(p.actualIncome || {}).forEach(k => {
        if (k >= nowKey || !inYear(k)) return;
        const v = p.actualIncome[k];
        income('actualIncome', k, { actual: v, secured: v, expected: v, full: v });
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
        income('income', k, secured ? { secured: v, expected: v * w, full: v }
          : { expected: v * w, full: v });
      });
    });
  });

  // Whole dollars, and the surplus from them, so a row always adds up on the page.
  Object.keys(groups).forEach(g => Object.keys(groups[g]).forEach(l =>
    Object.keys(groups[g][l]).forEach(sc => {
      const f = groups[g][l][sc];
      f.income = Math.round(f.income); f.cost = Math.round(f.cost);
      f.surplus = f.income - f.cost;
    })));
  return order.filter(k => k !== 'All').concat(groups.All ? ['All'] : [])
    .map(k => ({ key: k, years: groups[k] }));
}

/**
 * The board's budget to date, for the "Budget to" column beside the actual to date: this
 * financial year's quarter rows (boardBudgetRows_) summed up to the quarter before
 * `currentQuarter` ("26/27 Q3"). Null in a year's first quarter, which has none before it,
 * and when no quarter row covers the year: a whole-year row is never split.
 *
 * Returns { fy, quarter, through, projects, budgeted, reserves }: `through` the closing
 * month of that quarter ('YYYY-MM'); `projects` { <name>: { income, cost } } for each
 * project, `totalRow` among them, with a row for every quarter to date and an income or cost
 * on one of them, so a missing quarter leaves a project out rather than short; `budgeted`
 * the projects other than `totalRow` with an income or cost on any row of the year, whole
 * or quarter, so a total can tell a project with no budget from one missing its quarters;
 * `reserves` the working capital the `totalRow` row for that quarter gives, or null.
 */
function boardBudgetToDate_(rows, currentQuarter, totalRow) {
  const m = /^(\d{2}\/\d{2}) Q([1-4])$/.exec(currentQuarter || '');
  if (!m) return null;
  const fy = m[1], closed = parseInt(m[2], 10) - 1;
  if (closed < 1) return null;
  const by = {}, budgeted = [];
  let reserves = null;
  (rows || []).forEach(r => {
    if (r.fy !== fy) return;
    if (r.project !== totalRow && (r.income || r.cost) && budgeted.indexOf(r.project) === -1) {
      budgeted.push(r.project);
    }
    if (!r.quarter || r.quarter > closed) return;
    const t = by[r.project] || (by[r.project] = { seen: {}, income: null, cost: null });
    t.seen[r.quarter] = true;
    if (r.income !== null) t.income = (t.income || 0) + r.income;
    if (r.cost !== null) t.cost = (t.cost || 0) + r.cost;
    if (r.project === totalRow && r.quarter === closed && r.reserves !== null) {
      reserves = r.reserves;
    }
  });
  const projects = {};
  Object.keys(by).forEach(p => {
    const t = by[p];
    for (let q = 1; q <= closed; q++) if (!t.seen[q]) return;
    if (t.income === null && t.cost === null) return;
    projects[p] = { income: t.income || 0, cost: t.cost || 0 };
  });
  if (!Object.keys(projects).length && reserves === null) return null;
  const end = quarterBounds_(qiOfLabel_(fy + ' Q' + closed)).end;
  return { fy: fy, quarter: closed, through: DateMath.monthKey(end), projects: projects,
    budgeted: budgeted, reserves: reserves };
}

/**
 * The budget to date one group of the finance table shows, { income, cost, surplus } or
 * null, from boardBudgetToDate_'s `toDate`: a project's own, or with `project` null the
 * total. The total is `totalRow`'s own when `whole` (every project and source shown) and
 * it has them; otherwise the sum of the projects in `shown`, only when each of them that
 * has a budget this year has its quarters to date, since one left out would make the sum
 * short.
 *
 * Self-contained on purpose, like financeTable_: the page receives this function's own
 * source (Index.html), so it may not call anything outside itself.
 */
function budgetToDateOf_(toDate, project, shown, whole, totalRow) {
  if (!toDate) return null;
  const of = p => (toDate.projects || {})[p] || null;
  let t = null;
  if (project !== null && project !== undefined) t = of(project);
  else if (whole && of(totalRow)) t = of(totalRow);
  else {
    const list = (shown || []).filter(p => p !== totalRow);
    const budgeted = toDate.budgeted || [];
    if (list.some(p => !of(p) && budgeted.indexOf(p) !== -1)) return null;
    list.forEach(p => {
      const f = of(p);
      if (f) t = { income: (t ? t.income : 0) + f.income, cost: (t ? t.cost : 0) + f.cost };
    });
  }
  return t ? { income: t.income, cost: t.cost, surplus: t.income - t.cost } : null;
}

/**
 * What the page needs beside the parts to lay the finance table out, for people with full
 * access: the Board budget tab's rows (readBoardBudget_), the budget to date as of the
 * snapshot's `currentQuarter` (boardBudgetToDate_, which the page reads by budgetToDateOf_)
 * and the order the board's updates list the
 * projects in. A sheet that cannot be read leaves the budget columns out rather than failing
 * the page.
 */
function boardBudgetPayload_(currentQuarter) {
  let budget = [];
  try { budget = readBoardBudget_(); } catch (e) {
    Logger.log('Board budget not read: ' + e.message);
  }
  return { budget: budget,
    toDate: boardBudgetToDate_(budget, currentQuarter, CONFIG.BOARD.TOTAL_ROW),
    projects: CONFIG.BOARD.PROJECTS, totalRow: CONFIG.BOARD.TOTAL_ROW,
    general: CONFIG.GENERAL_PROJECT };
}
