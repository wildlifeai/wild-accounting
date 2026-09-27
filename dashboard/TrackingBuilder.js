/**
 * TrackingBuilder.js
 * Builds the quarterly tracking grid for one entity (a funding source, or the
 * General project aggregated across sources), merging the three layers:
 *   baseline (frozen budget)  +  actual (Xero)  +  forecast (GM-editable).
 *
 * Columns follow the financial year (CONFIG.FINANCIAL_YEAR_START_MONTH) and differ
 * by entity type:
 *   - funding source: an "Up to last FY" aggregate, then this FY's four quarters,
 *     then next FY's quarters if the source extends into it (+ a "Later" aggregate
 *     for anything beyond next FY).
 *   - General project: the elapsed quarters of this FY shown individually, plus a
 *     rolling 1.5-year (CONFIG.GENERAL_FORECAST_QUARTERS) forecast horizon.
 *
 * Per milestone x quarter the "effective" expected spend is actual for past
 * quarters, else the forecast override (or budget baseline). Aggregate columns are
 * always historical (show actual, not editable). Each milestone also carries one
 * free-text Comment explaining its forecast.
 *
 * `entity` = { id, label, type: 'source' | 'project', source?, status?, project?,
 *              milestones: [{ item, milestone, source, baseline:{q:n}, actual:{q:n} }] }
 */

function composeTracking(entity, currentQi, measure) {
  measure = measure || 'cost'; // 'cost' | 'income' | 'net'
  const columns = buildColumns_(entity, currentQi);

  // Pick the baseline/actual/forecast maps per measure.
  function layers_(m) {
    if (measure === 'income') return { base: m.incomeBaseline || {}, act: m.incomeActual || {},
      fc: m.incomeForecast || {} };
    if (measure === 'net') return { base: diffMap_(m.incomeBaseline, m.baseline),
      act: diffMap_(m.incomeActual, m.actual),
      fc: diffMap_(m.incomeForecast || {}, m.costForecast || {}) };
    return { base: m.baseline || {}, act: m.actual || {},
      fc: m.costForecast || {} };
  }

  const milestones = entity.milestones.map(m => {
    const L = layers_(m);
    const cells = columns.map(col => {
      if (col.type === 'aggregate') {
        const baseline = sumOver_(L.base, col.quarters);
        const actual = sumOver_(L.act, col.quarters);
        return { type: 'aggregate', baseline: Math.round(baseline), actual: Math.round(actual),
          forecast: null, effective: Math.round(actual), current: false };
      }
      const q = col.label;
      const baseline = L.base[q] || 0;
      const actual = L.act[q] || 0;
      const hasForecast = L.fc[q] !== undefined;
      // No entry in the funding source's Forecast tab means the budget baseline
      // carries forward. A forecast is an exception you record when you know
      // something the budget does not - not mandatory quarterly data entry.
      // Reading 0 here made every source with an unmaintained Forecast tab appear
      // certain to underspend, and silently understated org-wide expected spend.
      // The rule lives in forecastOrBaseline_ so health check D5 applies the same one.
      const forecast = forecastOrBaseline_(L.fc, L.base, q);
      const isCurrent = col.qi === currentQi;
      // Past quarters: effective = actual
      // Current quarter: effective = actual (partial, still accumulating)
      // Future quarters: effective = the Forecast-tab override, else the baseline
      const effective = col.past ? actual : (isCurrent ? actual : forecast);
      return { type: 'quarter', baseline: Math.round(baseline), actual: Math.round(actual),
        forecast: Math.round(forecast), hasForecast: hasForecast,
        effective: Math.round(effective), current: isCurrent };
    });
    const baselineTotal = sumField_(cells, 'baseline');
    const expectedTotal = sumField_(cells, 'effective');
    return {
      item: m.item, milestone: m.milestone, source: m.source,
      comment: m.forecastComment || '',
      cells: cells,
      baselineTotal: baselineTotal,
      actualToDate: sumField_(cells, 'actual'),
      expectedTotal: expectedTotal,
      variance: expectedTotal - baselineTotal
    };
  });

  const colTotals = columns.map((col, i) => ({
    label: col.label, type: col.type,
    baseline: sumAt_(milestones, i, 'baseline'),
    actual: sumAt_(milestones, i, 'actual'),
    effective: sumAt_(milestones, i, 'effective')
  }));

  // Collect sheet URLs from the entity's source tracking entries.
  const sheetUrls = {};
  (entity.sheetUrls || []).forEach(su => { if (su.source && su.url) sheetUrls[su.source] = su.url; });

  return {
    id: entity.id, label: entity.label, type: entity.type, measure: measure,
    status: entity.status || null, project: entity.project || null,
    currentQuarter: labelOfQi_(currentQi),
    sheetUrls: sheetUrls,
    columns: columns.map(c => ({ label: c.label, type: c.type,
      past: c.past || false, current: c.qi === currentQi })),
    milestones: milestones,
    colTotals: colTotals,
    totals: {
      baseline: sumField_(milestones, 'baselineTotal'),
      actual: sumField_(milestones, 'actualToDate'),
      expected: sumField_(milestones, 'expectedTotal'),
      variance: sumField_(milestones, 'variance')
    }
  };
}

/** Element-wise (a - b) over the union of quarter keys. */
function diffMap_(a, b) {
  a = a || {}; b = b || {};
  const out = {};
  Object.keys(a).forEach(q => (out[q] = (out[q] || 0) + a[q]));
  Object.keys(b).forEach(q => (out[q] = (out[q] || 0) - b[q]));
  return out;
}

/** Generate the ordered column spec for an entity. */
function buildColumns_(entity, currentQi) {
  const dataQis = collectDataQis_(entity.milestones);
  const fyStart = Math.floor(currentQi / 4) * 4; // qi of this FY's Q1
  const cols = [];

  if (entity.type === 'project') {
    // Elapsed quarters of this FY + rolling 1.5-year forecast horizon.
    const last = currentQi + (CONFIG.GENERAL_FORECAST_QUARTERS || 6);
    for (let qi = fyStart; qi <= last; qi++) cols.push(quarterCol_(qi, currentQi));
    return cols;
  }

  // funding source
  const prior = dataQis.filter(qi => qi < fyStart).sort((a, b) => a - b);
  if (prior.length) {
    cols.push({ type: 'aggregate', label: 'Up to last FY',
      quarters: prior.map(labelOfQi_), qi: prior[prior.length - 1] });
  }
  for (let qi = fyStart; qi <= fyStart + 3; qi++) cols.push(quarterCol_(qi, currentQi)); // this FY

  const maxQi = dataQis.length ? Math.max.apply(null, dataQis) : fyStart + 3;
  if (maxQi >= fyStart + 4) { // extends into next FY
    for (let qi = fyStart + 4; qi <= fyStart + 7; qi++) cols.push(quarterCol_(qi, currentQi));
    const later = dataQis.filter(qi => qi > fyStart + 7).sort((a, b) => a - b);
    if (later.length) {
      cols.push({ type: 'aggregate', label: 'Later', quarters: later.map(labelOfQi_),
        qi: later[later.length - 1] });
    }
  }
  return cols;
}

function quarterCol_(qi, currentQi) {
  return { type: 'quarter', qi: qi, label: labelOfQi_(qi), past: qi < currentQi };
}

function collectDataQis_(milestones) {
  const set = {};
  milestones.forEach(m => {
    [m.baseline, m.actual, m.costForecast, m.incomeForecast].forEach(map => {
      if (map) Object.keys(map).forEach(q => (set[qiOfLabel_(q)] = true));
    });
  });
  return Object.keys(set).map(Number);
}

function sumOver_(map, quarterLabels) {
  return quarterLabels.reduce((t, q) => t + (map[q] || 0), 0);
}
function sumField_(arr, field) {
  return Math.round(arr.reduce((t, x) => t + (x[field] || 0), 0));
}
function sumAt_(milestones, colIndex, field) {
  return Math.round(milestones.reduce((t, m) => t + (m.cells[colIndex][field] || 0), 0));
}
