/**
 * TrackingBuilder.js
 * Builds the Project tracking payload for one project or several: every funding source
 * with a milestone on them, and for each milestone its budget (frozen Budget tab),
 * actual (Xero) and forecast (the source's Forecast tab) per quarter, for cost and for
 * income, plus the quarters its bar spans. One call serves both views of the tab: the
 * client lays the quarters out as the actual-and-forecast grid or the timeline, picks
 * the quarters shown, the measure and the filters, and sums.
 *
 * Per quarter the "effective" figure is what we expect that quarter to end up as:
 * actual for past quarters and the current one (still accumulating), else the
 * Forecast-tab override, else the budget. No entry on the Forecast tab means the budget
 * carries forward: a forecast is an exception you record when you know something the
 * budget does not, not mandatory quarterly data entry. Reading 0 there once made every
 * source with an unmaintained Forecast tab look certain to underspend. The rule lives in
 * forecastOrBaseline_ so health check D5 applies the same one.
 *
 * `tracking` is snapshot.tracking: [{ source, status, sheetUrl, contributionRate,
 *   milestones: [{ item, milestone, project, baseline:{q:n}, actual, incomeBaseline,
 *   incomeActual, costForecast, incomeForecast, forecastComment, actualOnly }] }].
 * `timeline` is snapshot.timeline: [{ project, milestone, segments: [{ source, start:
 *   'YYYY-MM', end }] }], which gives each bar its first and last quarter.
 */

/** The heading General's inflow from the other projects' sources sits under. */
const CONTRIBUTIONS_HEADING = 'Contributions from other projects';

function composeProjectTracking(tracking, timeline, projects, currentQi) {
  // One project's name or several. Several share each funding source's heading, and each
  // milestone row carries its project so the page can tell same-named milestones apart.
  const list = [].concat(projects);
  const shown = {};
  list.forEach(p => (shown[p] = true));
  const spanKey = (project, source, milestone) => project + '||' + source + '||' + milestone;

  // Bar extents by project, source and milestone: the first and last quarter any budget
  // line of that milestone runs through, from the segments the budget lines were cut into.
  const span = {};
  (timeline || []).forEach(t => {
    if (!shown[t.project]) return;
    (t.segments || []).forEach(seg => {
      if (!seg.start || !seg.end) return;
      const key = spanKey(t.project, seg.source, t.milestone);
      const a = qiOfMonthKey_(seg.start), b = qiOfMonthKey_(seg.end);
      const s = span[key] || (span[key] = { from: a, to: b });
      if (a < s.from) s.from = a;
      if (b > s.to) s.to = b;
    });
  });

  const qis = {};
  const sources = [];
  (tracking || []).forEach(t => {
    // A milestone counts toward the project its lines name, not the folder its sheet
    // sits in, so a WW_25_TOI line tagged General lands under General.
    const mine = (t.milestones || []).filter(m => shown[m.project]);
    if (!mine.length) return;
    sources.push({
      source: t.source, status: t.status || null, sheetUrl: t.sheetUrl || null,
      milestones: mine.map(m =>
        milestoneRow_(m, span[spanKey(m.project, t.source, m.milestone)], currentQi, qis))
    });
  });

  // General's inflow from the other projects' sources, by each one's Contribution policy,
  // under a heading of its own. Each row keeps its source's status, since that is what
  // says whether the money is secured. A project shown alongside already has that income
  // in full on its own rows, so its share is left out rather than counted twice.
  if (shown[CONFIG.GENERAL_PROJECT]) {
    const statusOf = {};
    (tracking || []).forEach(t => (statusOf[t.source] = t.status || null));
    const rows = contributionMilestones_(tracking, shown).map(m => {
      const row = milestoneRow_(m, span[spanKey(m.project, m.source, m.milestone)],
        currentQi, qis);
      row.status = statusOf[m.source];
      return row;
    });
    if (rows.length) {
      sources.push({ source: CONTRIBUTIONS_HEADING, status: null, sheetUrl: null,
        contributions: true, milestones: rows });
    }
  }

  // Every quarter from the first with anything in it to the last, with no gaps, and the
  // current financial year whatever the data, so the default range has its columns.
  const fyStart = Math.floor(currentQi / 4) * 4;
  for (let qi = fyStart; qi < fyStart + 4; qi++) qis[qi] = true;
  const all = Object.keys(qis).map(Number);
  const lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
  const quarters = [];
  for (let qi = lo; qi <= hi; qi++) {
    quarters.push({ label: labelOfQi_(qi), past: qi < currentQi, current: qi === currentQi });
  }

  return { project: list.join(' + '), projects: list, currentQuarter: labelOfQi_(currentQi),
    quarters: quarters, sources: sources };
}

/**
 * One milestone: its cells by quarter label, each { cost, income } of
 * { budget, actual, forecast (null when the Forecast tab has no entry), effective },
 * and the quarters its bar runs from and to. With no segment to go by, the bar spans the
 * budgeted quarters; an actual-only row (unbudgeted or unassigned spend) has no bar.
 */
function milestoneRow_(m, span, currentQi, qis) {
  const byQ = {};
  const labels = {};
  [m.baseline, m.actual, m.incomeBaseline, m.incomeActual, m.costForecast, m.incomeForecast]
    .forEach(map => Object.keys(map || {}).forEach(q => (labels[q] = true)));
  Object.keys(labels).forEach(q => {
    const qi = qiOfLabel_(q);
    qis[qi] = true;
    byQ[q] = {
      cost: cell_(m.baseline, m.actual, m.costForecast, q, qi, currentQi),
      income: cell_(m.incomeBaseline, m.incomeActual, m.incomeForecast, q, qi, currentQi)
    };
  });

  let from = span ? span.from : null, to = span ? span.to : null;
  if (from === null) {
    const budgeted = Object.keys(m.baseline || {}).concat(Object.keys(m.incomeBaseline || {}))
      .map(qiOfLabel_);
    if (budgeted.length) {
      from = Math.min.apply(null, budgeted);
      to = Math.max.apply(null, budgeted);
    }
  }
  return {
    item: m.item, milestone: m.milestone, project: m.project, comment: m.forecastComment || '',
    actualOnly: !!m.actualOnly, byQ: byQ,
    from: from === null ? null : labelOfQi_(from),
    to: to === null ? null : labelOfQi_(to)
  };
}

function cell_(base, act, fc, q, qi, currentQi) {
  const budget = Math.round((base || {})[q] || 0);
  const actual = Math.round((act || {})[q] || 0);
  const entered = fc && fc[q] !== undefined;
  const forecast = Math.round(forecastOrBaseline_(fc, base, q));
  return { budget: budget, actual: actual, forecast: entered ? forecast : null,
    effective: qi <= currentQi ? actual : forecast };
}
