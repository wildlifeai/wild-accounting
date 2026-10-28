/**
 * Board.js
 * The Board tab's Finance section: income, cost and surplus by project for the board pack,
 * this financial year against the budget the board approved, and next year's draft in three
 * scenarios. Worked out from the snapshot's runway parts, so it shows the same money as the
 * runway chart, and pure, so the same figures come out of a saved snapshot offline.
 *
 * A project shows its income as its funders give it, and beside it the margin it passes to
 * General (marginRule_). General shows its own income and, on its own row, the margins it
 * receives. That is how the board's budget was set out in March, where a project's surplus
 * was what it left for General.
 */

/**
 * The finance figures for the Board tab.
 *
 * `runway` is the snapshot's (buildRunway_): its parts, nowKey and reserves. `fyStartYear`
 * is the year the current financial year starts in. `budgetRows` are the Board budget tab's
 * rows (readBoardBudget_): { fy, project, income, cost, reserves }.
 *
 * Months before nowKey are Xero actuals on every line; from nowKey on, the plan: secured
 * money only, expected (each proposal at its probability, work that goes ahead only if funded
 * at the same weight), or full (every proposal lands). As in runwayWalk_.
 */
function boardFinance_(runway, fyStartYear, budgetRows) {
  const parts = (runway && runway.parts) || [];
  const nowKey = runway && runway.nowKey;
  const G = CONFIG.GENERAL_PROJECT;
  const years = [fyStartYear, fyStartYear + 1].map(y => ({
    label: fyLabel_(y), from: DateMath.monthKey(new Date(y, fyStartMonth_() - 1, 1)),
    to: DateMath.monthKey(new Date(y, fyStartMonth_() + 10, 1))
  }));

  // A margin part is General's income from one source; the project whose lines it came
  // from shows it as passed on. The project is the source's largest non-General part.
  const size = p => sumValues_(p.cost) + sumValues_(p.actualCost) +
    Math.abs(sumValues_(p.income)) + Math.abs(sumValues_(p.actualIncome));
  const marginOwner = {};
  parts.forEach(p => {
    if (p.project === G || isMarginPart_(p)) return;
    const o = marginOwner[p.fundingSource];
    if (!o || size(p) > o.size) marginOwner[p.fundingSource] = { project: p.project, size: size(p) };
  });

  const projects = (CONFIG.BOARD.PROJECTS || []).slice();
  parts.forEach(p => {
    if (projects.indexOf(p.project) === -1 && !isMarginPart_(p)) projects.push(p.project);
  });

  function blank() { return { income: 0, margin: 0, cost: 0 }; }
  function figures(year) {
    const out = {};
    projects.concat('All').forEach(pr => {
      out[pr] = { actual: blank(), secured: blank(), expected: blank(), full: blank() };
    });
    const inYear = k => k >= year.from && k <= year.to;
    parts.forEach(p => {
      const secured = p.status === 'secured';
      const w = secured ? 1 : (typeof p.probability === 'number' ? p.probability : 0);
      const ifFunded = !secured && !!p.ifFunded;
      const margin = isMarginPart_(p);
      const owner = margin && marginOwner[p.fundingSource] ? marginOwner[p.fundingSource].project : null;
      // Income on one scenario: a margin moves from its owner to General; anything else is
      // its own project's.
      function income(sc, v) {
        if (owner) {
          out[owner][sc].income += v; out[owner][sc].margin -= v;
          out[G][sc].margin += v;
        } else {
          out[p.project][sc].income += v;
        }
        // The organisation's income is every part's: a project's part is its income less
        // the margin, and the margin part holds the rest.
        out.All[sc].income += v;
      }
      function cost(sc, v) { out[p.project][sc].cost += v; out.All[sc].cost += v; }
      if (!out[p.project] && !owner) return;
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
    // Whole dollars, and the surplus from them, so a row always adds up on the page.
    Object.keys(out).forEach(pr => Object.keys(out[pr]).forEach(sc => {
      const f = out[pr][sc];
      f.income = Math.round(f.income); f.margin = Math.round(f.margin); f.cost = Math.round(f.cost);
      f.surplus = f.income - f.cost;
    }));
    return out;
  }

  const budgetOf = (fy, project) => (budgetRows || []).filter(r =>
    r.fy === fy && r.project === project)[0] || null;
  const walk = runwayWalk_(parts, nowKey, undefined, runway && runway.reserves);
  const at = k => walk.months.filter(m => m.month === k)[0] || null;
  const reservesAt = k => {
    const m = at(k);
    return m ? { month: k, secured: m.secured - m.spend, expected: m.weighted - m.spend,
      full: m.proposed - m.spend } : null;
  };

  return {
    nowKey: nowKey,
    // Xero actuals run to the end of the month before nowKey.
    actualTo: previousMonthKey_(nowKey),
    projects: projects,
    years: years.map(y => {
      const fig = figures(y);
      const total = budgetOf(y.label, CONFIG.BOARD.TOTAL_ROW);
      return {
        label: y.label, from: y.from, to: y.to,
        rows: projects.concat('All').map(pr => {
          const b = pr === 'All' ? sumBudget_(budgetRows, y.label) : budgetOf(y.label, pr);
          return { project: pr, budget: b ? { income: b.income, cost: b.cost,
            surplus: b.income - b.cost } : null, figures: fig[pr] };
        }).filter(r => r.budget || Object.keys(r.figures).some(sc =>
          r.figures[sc].income || r.figures[sc].cost || r.figures[sc].margin)),
        reserves: { budget: total && typeof total.reserves === 'number' ? total.reserves : null,
          yearEnd: reservesAt(y.to) }
      };
    }),
    reservesNow: (runway && runway.reserves) || null,
    monthsOfRunway: walk.monthsOfRunway,
    crossover: walk.crossover
  };
}

/** A "(margin)" part: General's income from one source's margin (runwayParts_). */
function isMarginPart_(p) {
  return p.project === CONFIG.GENERAL_PROJECT && p.milestone === marginMilestone_(p.fundingSource);
}

/** Every project row of one financial year on the Board budget tab, added up. */
function sumBudget_(rows, fy) {
  const mine = (rows || []).filter(r => r.fy === fy && r.project !== CONFIG.BOARD.TOTAL_ROW);
  if (!mine.length) return null;
  return mine.reduce((t, r) => ({ income: t.income + r.income, cost: t.cost + r.cost }),
    { income: 0, cost: 0 });
}

function sumValues_(map) {
  return Object.keys(map || {}).reduce((t, k) => t + (map[k] || 0), 0);
}

function previousMonthKey_(key) {
  if (!key) return null;
  const p = key.split('-');
  const d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 2, 1);
  return DateMath.monthKey(d);
}
