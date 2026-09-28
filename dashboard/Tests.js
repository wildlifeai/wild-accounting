/**
 * Tests.js
 * Lightweight checks runnable from the Apps Script editor (Run > runTests).
 * No Drive/Xero needed - they exercise the pure forecast math against synthetic
 * funding-source budget lines (Cost/Income/milestone shape, matching the real
 * `Budget` tab parsed by BudgetReader).
 */

function runTests() {
  var results = [];
  function check(name, cond) { results.push((cond ? 'PASS  ' : 'FAIL  ') + name); }

  var d = function (y, m, day) { return new Date(y, m - 1, day); };

  // Mirrors SPY_26_HAND: milestones with Cost / Income / Contribution.
  var lines = [
    { milestone: 'Data cleaning', start: d(2025, 11, 1), end: d(2026, 1, 1),
      cost: 5600, income: 10000, contribution: 4400, project: 'Spyfish Aotearoa' },
    { milestone: 'Machine learning models', start: d(2026, 1, 1), end: d(2026, 3, 1),
      cost: 14000, income: 15000, contribution: 1000, project: 'Spyfish Aotearoa' },
    { milestone: 'Operational playbook', start: d(2025, 11, 1), end: d(2026, 4, 1),
      cost: 7560, income: 10000, contribution: 2440, project: 'General' }
  ];

  var fc = computeFundingSourceForecast(lines);

  check('expense total = 27,160', Math.abs(fc.totalBudgetExpense - 27160) < 1);
  check('income total = 35,000', Math.abs(fc.totalBudgetIncome - 35000) < 1);
  check('contribution total = 7,840', Math.abs(fc.totalContribution - 7840) < 1);

  // Cost spreads day-weighted across the months each milestone spans.
  check('expense spread over multiple months', Object.keys(fc.expenseByMonth).length >= 5);

  // Project shares by Cost: Spyfish = (5600+14000)/27160, General = 7560/27160.
  var shares = projectExpenseShares_(lines);
  check('Spyfish share ~0.722', Math.abs(shares['Spyfish Aotearoa'] - (19600 / 27160)) < 0.001);
  check('General share ~0.278', Math.abs(shares['General'] - (7560 / 27160)) < 0.001);

  // Financial-year quarter helpers (FY starts April).
  check('May 2026 -> 26/27 Q1', quarterOfMonthKey_('2026-05') === '26/27 Q1');
  check('Jan 2026 -> 25/26 Q4', quarterOfMonthKey_('2026-01') === '25/26 Q4');
  check('itemCode strips name', itemCode_('WW_25_TOI_002 - General management') === 'WW_25_TOI_002');
  var qb = bucketToQuarters({ '2026-01': 100, '2026-02': 50, '2026-04': 30 });
  check('bucketToQuarters sums FY Q4', qb['25/26 Q4'] === 150);
  check('bucketToQuarters next FY Q1', qb['26/27 Q1'] === 30);
  check('quarterSortNum order', quarterSortNum('26/27 Q1') > quarterSortNum('25/26 Q4'));

  // Budget tab: the column header row is located, not assumed, so a key|value
  // metadata block can sit above it (see BUDGET_SHEET_TEMPLATE.md).
  var sheetRows = [
    ['Funding source', 'WW_25_TOI'],
    ['Status', 'secured'],
    ['Contribution policy', 'percent_of_income:40'],
    [],
    ['Description', 'Start', 'End', 'Cost', 'Income', 'Milestone'],
    ['Delivery lead', '03/Nov/25', '02/Aug/26', 20000, 0, 'Delivery']
  ];
  check('header row located below metadata block', findHeaderRow_(sheetRows) === 4);
  check('header row is 0 when there is no metadata block',
    findHeaderRow_([['Description', 'Start', 'End', 'Cost']]) === 0);
  check('no header row returns -1', findHeaderRow_([['Notes', 'x'], ['more', 'y']]) === -1);

  var meta = readMetadataBlock_(sheetRows, 4);
  check('metadata keys are lower-cased', meta['funding source'] === 'WW_25_TOI');
  check('metadata carries contribution policy',
    meta['contribution policy'] === 'percent_of_income:40');
  check('metadata stops at the header row', meta['description'] === undefined);
  check('isoDate_ zero-pads', isoDate_(new Date(2026, 5, 3)) === '2026-06-03');

  // Balance-sheet exclusions match on account code, not label, so renaming an
  // account in Xero cannot silently un-exclude it.
  check('excludes Wages Payable', isExcludedAccount_('Wages Payable - Payroll (814)'));
  check('excludes PAYE Payable', isExcludedAccount_('PAYE Payable (825)'));
  check('excludes after a Xero rename', isExcludedAccount_('Renamed In Xero (814)'));
  check('keeps Salaries', !isExcludedAccount_('Salaries (477)'));
  check('keeps an untagged/blank account', !isExcludedAccount_(''));
  check('keeps an unknown code', !isExcludedAccount_('Something New (999)'));

  // Health findings: severity order, value at risk, and the checks the reader
  // cannot make for itself. See dashboard/HEALTH_CHECKS.md.
  var hBudgets = [{
    name: 'WW_25_TOI', status: 'secured', projectFolder: 'Wildlife Watcher', sheetUrl: '',
    metadata: { owner: 'someone@wildlife.ai' },
    tabs: ['Budget', 'Forecast', 'Xero export'],
    lines: [{ item: 'WW_25_TOI_002', cost: 100, income: 0, contribution: 0 },
            { item: '', cost: 5000, income: 0, contribution: 0 }],
    forecast: { cost: { 'WW_25_TOI_099||26/27 Q1': 50 }, income: {}, comments: {} },
    issues: [{ check: 'B4', detail: '1 line without an item code' },
             { check: 'A1', detail: 'missing column Cost' }]
  }];
  var hActuals = [{ kind: 'expense', project: '', fundingSource: '', amount: 4053 },
                  { kind: 'expense', project: 'General', fundingSource: '', amount: 200 }];
  var health = buildHealth(hBudgets, hActuals,
    { xeroConnected: false, exclusion: { count: 3, total: 3090 }, secretsMissing: [] });
  var hIds = health.map(function (f) { return f.id; });

  check('missing column reported as A2, not A1', hIds.indexOf('A2') !== -1);
  check('A3 flags a tab outside the three allowed', hIds.indexOf('A3') !== -1);
  check('A6 flags the missing Submitted_budget tab', hIds.indexOf('A6') !== -1);
  check('A9 flags a forecast for a milestone not in the budget', hIds.indexOf('A9') !== -1);
  check('B4 carries value at risk, not just a count',
    health.some(function (f) { return f.id === 'B4' && f.amount === 5000; }));
  check('D1 counts only untagged expense',
    health.some(function (f) { return f.id === 'D1' && f.amount === 4053; }));
  check('D2 does not double-count the D1 line',
    health.some(function (f) { return f.id === 'D2' && f.amount === 200; }));
  check('F1 raised when Xero is disconnected', hIds.indexOf('F1') !== -1);
  check('errors sort before warnings before info', (function () {
    var rank = { error: 0, warning: 1, info: 2 };
    for (var i = 1; i < health.length; i++) {
      if (rank[health[i].severity] < rank[health[i - 1].severity]) return false;
    }
    return true;
  })());
  check('owner carried through from sheet metadata',
    health.some(function (f) { return f.owner === 'someone@wildlife.ai'; }));
  check('legacy dataFlags strings exclude info findings',
    healthToFlags(health).length === health.filter(function (f) {
      return f.severity !== 'info'; }).length);

  // Forecast row labels. The Forecast tab may name a budget line by item code,
  // by milestone, by "Description - Milestone", or by a description unique in the
  // file. Mirrors SPY_26_UOA: two milestones, one item code each, with the same
  // two descriptions appearing under both.
  var uoaLines = [
    { description: 'Data Scientist', milestone: 'Baseline model assessment and data ingestion',
      item: 'SPY_26_UOA_001 - Baseline model assessment' },
    { description: 'Project Manager', milestone: 'Baseline model assessment and data ingestion',
      item: 'SPY_26_UOA_001 - Baseline model assessment' },
    { description: 'Data Scientist', milestone: 'Final validation and co-authored manuscript',
      item: 'SPY_26_UOA_002 - Final validation and manuscript' },
    { description: 'Project Manager', milestone: 'Final validation and co-authored manuscript',
      item: 'SPY_26_UOA_002 - Final validation and manuscript' }
  ];
  var uoaMap = buildForecastLabelMap_(uoaLines);
  function resolves(label) { return resolveForecastLabel_(label, uoaMap).code; }

  check('milestone name resolves', resolves('Baseline model assessment and data ingestion')
    === 'SPY_26_UOA_001');
  check('"Description - Milestone" resolves',
    resolves('Data Scientist - Final validation and co-authored manuscript') === 'SPY_26_UOA_002');
  check('bare item code still resolves', resolves('SPY_26_UOA_001') === 'SPY_26_UOA_001');
  check('full "CODE - Name" still resolves',
    resolves('SPY_26_UOA_001 - Baseline model assessment') === 'SPY_26_UOA_001');
  check('label matching ignores case and extra spaces',
    resolves('data scientist  -  final validation and co-authored manuscript')
    === 'SPY_26_UOA_002');
  // A description under two milestones must be refused, not guessed at. These two
  // cost $936 in both milestones, so no amount of cleverness could pick one.
  check('a description spanning two milestones is refused', !resolves('Project Manager'));
  check('and the refusal names both candidates', (function () {
    var e = resolveForecastLabel_('Project Manager', uoaMap).error || '';
    return e.indexOf('SPY_26_UOA_001') !== -1 && e.indexOf('SPY_26_UOA_002') !== -1;
  })());
  check('an unknown label is refused', !resolves('Data Engineer'));
  // One milestone spanning several accounts is not ambiguous: those lines share a
  // code, so the candidate set collapses to one. This is the normal shape.
  check('one milestone over three accounts resolves', resolveForecastLabel_('Data science',
    buildForecastLabelMap_([
      { description: 'Recruitment fees', milestone: 'Data science', item: 'X_001 - Data science' },
      { description: 'Contractor', milestone: 'Data science', item: 'X_001 - Data science' },
      { description: 'Software', milestone: 'Data science', item: 'X_001 - Data science' }
    ])).code === 'X_001');
  // Labels are matched whole, never split, so " - " inside a description is safe.
  check('a description containing " - " is not mis-split', resolveForecastLabel_(
    'Travel - domestic', buildForecastLabelMap_([{ description: 'Travel - domestic',
      milestone: 'Fieldwork', item: 'Y_001 - Fieldwork' }])).code === 'Y_001');
  check('a line with no item code offers no label',
    Object.keys(buildForecastLabelMap_([{ description: 'Thing', milestone: 'M', item: '' }]))
      .length === 0);

  // Forecast merge with FY columns: aggregate 'Up to last FY' + this FY quarters.
  // Forecast overrides live on the milestone itself, read from each funding
  // source's own Forecast tab by BudgetReader.parseForecastTab_.
  var entity = {
    id: 'WW_25_TOI', label: 'WW_25_TOI', type: 'source', source: 'WW_25_TOI',
    status: 'secured', project: 'Wildlife Watcher',
    milestones: [{ item: 'WW_25_TOI_002', milestone: 'General management', source: 'WW_25_TOI',
      baseline: { '25/26 Q3': 4992, '25/26 Q4': 7615,
        '26/27 Q1': 7703, '26/27 Q2': 2792, '26/27 Q3': 1000 },
      actual: { '25/26 Q3': 2000, '25/26 Q4': 2500 },
      costForecast: { '26/27 Q2': 5000 },   // override on one future quarter only
      forecastComment: 'staffing ramp' }]
  };
  var grid = composeTracking(entity, quarterSortNum('26/27 Q1'), 'cost');
  var m = grid.milestones[0];

  // Look columns up by label - index arithmetic is brittle as columns evolve.
  function cellFor(label) {
    for (var i = 0; i < grid.columns.length; i++) {
      if (grid.columns[i].label === label) return m.cells[i];
    }
    return null;
  }

  check('first column is aggregate', grid.columns[0].type === 'aggregate');
  check('aggregate sums prior FY actual', m.cells[0].effective === 4500);
  check('future quarter uses its override', cellFor('26/27 Q2').effective === 5000
    && cellFor('26/27 Q2').hasForecast === true);
  // Regression guard: an unmaintained Forecast tab must fall back to the budget
  // baseline, never to 0. Reading 0 makes a source look certain to underspend.
  check('future quarter with no override falls back to baseline',
    cellFor('26/27 Q3').effective === 1000 && cellFor('26/27 Q3').hasForecast === false);
  check('current quarter uses actual, not baseline', cellFor('26/27 Q1').effective === 0);
  check('expected = 4500 + 0 + 5000 + 1000 + 0', m.expectedTotal === 10500);

  // "Forecast entered" counts only quarters with an override; Expected still falls back to
  // the baseline. Two different questions: what we have said we will spend, and what we
  // expect to spend. The client sums the first, so this mirrors its rule to guard it.
  var entered = 0, withBaseline = 0;
  m.cells.forEach(function (c, i) {
    var col = grid.columns[i];
    if (col.past || col.type !== 'quarter') return;
    withBaseline += c.forecast;
    if (c.hasForecast) entered += c.forecast;
  });
  check('forecast entered counts only the override', entered === 5000, String(entered));
  // Current + future, baseline where there is no override: 7703 + 5000 + 1000 + 0. Note the
  // current quarter is in here, which is why this column and Expected never agree: Expected
  // uses the current quarter's actual instead.
  check('the old baseline-inclusive figure was nearly 3x larger',
    withBaseline === 13703, String(withBaseline));
  check('expected still carries the baseline for un-forecast quarters',
    m.expectedTotal === 10500);
  check('baseline total = 24102', m.baselineTotal === 24102);
  check('comment carried through', m.comment === 'staffing ramp');

  // Per-quarter buckets, which let the Overview total any financial year rather than
  // only the current one. A line spanning Jan to Dec 2026 crosses FY25/26 Q4 into
  // FY26/27 Q1-Q3, so the split must be day-weighted and the partition exhaustive.
  var straddler = { milestone: 'M', item: 'X_001 - M', project: 'General',
    start: d(2026, 1, 1), end: d(2026, 12, 31), cost: 12000, income: 12000, contribution: 0 };
  var strMonths = distributeByMonth_([straddler], 'cost');
  var strQ = bucketToQuarters(strMonths);
  function sumMap(m) {
    return Object.keys(m).reduce(function (a, k) { return a + m[k]; }, 0);
  }
  function sumFyQ(m, fy) {
    return Object.keys(m).filter(function (q) { return q.split(' ')[0] === fy; })
      .reduce(function (a, q) { return a + m[q]; }, 0);
  }
  check('quarter buckets sum to the line cost', Math.abs(sumMap(strQ) - 12000) < 0.01);
  check('a straddling line lands in two financial years',
    sumFyQ(strQ, '25/26') > 0 && sumFyQ(strQ, '26/27') > 0);
  check('summing both years reproduces the whole line',
    Math.abs(sumFyQ(strQ, '25/26') + sumFyQ(strQ, '26/27') - 12000) < 0.01);
  // The per-quarter total must agree with the scalar the old FY-only view used, or the
  // FY selector would quietly disagree with every previously reported figure.
  check('per-quarter FY total equals sumMonthsInFY_',
    Math.abs(sumMonthsInFY_(strMonths, fyBounds_(d(2026, 8, 13))) - sumFyQ(strQ, '26/27')) < 0.01);
  var accQ = {};
  addInto_(accQ, { '26/27 Q1': 10, '26/27 Q2': 5 });
  addInto_(accQ, { '26/27 Q1': 7 });
  check('addInto_ accumulates rather than overwrites',
    accQ['26/27 Q1'] === 17 && accQ['26/27 Q2'] === 5);

  // The C, D and E checks. All were unimplementable until sheets carried Owner, Status,
  // Funding end and Contribution policy. `now` is injected so they stay reproducible.
  var NOW = d(2026, 8, 14);
  function sheet_(over) {
    var b = { name: 'XXX_27_GOOD', status: 'secured', projectFolder: 'General',
      sheetUrl: '', tabs: ['Funding_info', 'Budget', 'Forecast', 'Submitted_budget'],
      metadata: { 'funding source': 'XXX_27_GOOD', 'project': 'General',
        'funder': 'Example Funder Trust', 'status': 'secured',
        'funding start': '01/Apr/26', 'funding end': '31/Mar/27',
        'owner': 'someone@wildlife.ai', 'contribution policy': 'none',
        'last reviewed': '01/Aug/26' },
      lines: [{ description: 'Delivery lead', milestone: 'Delivery',
        item: 'XXX_27_GOOD_001 - Delivery', project: 'General',
        start: d(2026, 4, 1), end: d(2027, 3, 31),
        cost: 10000, income: 10000, contribution: 0 }],
      hasProjectColumn: true, forecast: { cost: {}, income: {}, comments: {} }, issues: [] };
    Object.keys(over || {}).forEach(function (k) {
      if (k === 'metadata') Object.keys(over[k]).forEach(function (mk) {
        if (over[k][mk] === null) delete b.metadata[mk]; else b.metadata[mk] = over[k][mk];
      });
      else b[k] = over[k];
    });
    return b;
  }
  function idsFor(budgets, actuals) {
    return buildHealth(budgets, actuals || [],
      { now: NOW, xeroConnected: true }).map(function (f) { return f.id; });
  }
  var spend_ = function (amount, date, over) {
    var l = { kind: 'expense', project: 'General', fundingSource: 'XXX_27_GOOD',
      item: 'XXX_27_GOOD_001 - Delivery', amount: amount, date: date };
    Object.keys(over || {}).forEach(function (k) { l[k] = over[k]; });
    return l;
  };

  check('a well-formed sheet raises nothing',
    idsFor([sheet_()], [spend_(5000, '2026-07-01')])
      .filter(function (i) { return i !== 'F5'; }).length === 0);

  check('C1 names the missing metadata key',
    idsFor([sheet_({ metadata: { owner: null } })]).indexOf('C1') !== -1);
  check('C2 catches Status disagreeing with the folder',
    idsFor([sheet_({ metadata: { status: 'proposed' } })]).indexOf('C2') !== -1);
  check('C3 catches Funding source not matching the file name',
    idsFor([sheet_({ metadata: { 'funding source': 'TYPO' } })]).indexOf('C3') !== -1);
  check('C4 catches a stale review date',
    idsFor([sheet_({ metadata: { 'last reviewed': '01/Jan/26' } })]).indexOf('C4') !== -1);
  check('C5 catches a secured grant past its end date',
    idsFor([sheet_({ metadata: { 'funding end': '31/Mar/26' } })]).indexOf('C5') !== -1);
  check('C6 rejects an invented contribution policy',
    idsFor([sheet_({ metadata: { 'contribution policy': 'all_income_contributes' } })])
      .indexOf('C6') !== -1);
  check('C6 accepts percent_of_income:40',
    idsFor([sheet_({ metadata: { 'contribution policy': 'percent_of_income:40' } })])
      .indexOf('C6') === -1);
  check('C7 asks only proposed sheets for a decision date',
    idsFor([sheet_({ status: 'proposed', metadata: { status: 'proposed' } })])
      .indexOf('C7') !== -1 && idsFor([sheet_()]).indexOf('C7') === -1);

  check('D3 counts spend with no item code',
    idsFor([sheet_()], [spend_(900, '2026-07-01', { item: '' })]).indexOf('D3') !== -1);
  check('D4 catches actuals tagged to a source with no sheet',
    idsFor([sheet_()], [spend_(900, '2026-07-01', { fundingSource: 'XXX_27_TYPO' })])
      .indexOf('D4') !== -1);
  check('D5 catches a started grant with nothing coded to it',
    idsFor([sheet_()], []).indexOf('D5') !== -1);

  // D5 asks whether spend was expected in a finished quarter, by the grid's own rule,
  // not whether Funding start has passed. Mirrors SPY_27_MAINT: contract from August,
  // work scheduled later, nothing coded, which is correct and must stay quiet.
  function d5Line(start) {
    return [{ description: 'Delivery lead', milestone: 'Delivery',
      item: 'XXX_27_GOOD_001 - Delivery', project: 'General', start: start,
      end: d(2027, 3, 31), cost: 10000, income: 10000, contribution: 0 }];
  }
  function d5Fc(amount) {
    var c = {}; c['XXX_27_GOOD_001||26/27 Q1'] = amount;
    return { cost: c, income: {}, comments: {} };
  }
  check('D5 quiet when the work is scheduled after the funding start',
    idsFor([sheet_({ lines: d5Line(d(2026, 10, 1)) })], []).indexOf('D5') === -1);
  // A written 0 is a statement: nothing that quarter. D5 takes it at its word.
  check('D5 quiet when the Forecast says 0 for the finished quarter',
    idsFor([sheet_({ forecast: d5Fc(0) })], []).indexOf('D5') === -1);
  // The forecast wins both ways: spend moved into a finished quarter counts.
  check('D5 fires when the Forecast moved spend into a finished quarter',
    idsFor([sheet_({ lines: d5Line(d(2026, 10, 1)), forecast: d5Fc(500) })], [])
      .indexOf('D5') !== -1);
  // Quiet through the quarter in which spend begins, however late in it we are.
  check('D5 quiet during the first quarter spend is expected',
    idsFor([sheet_({ lines: d5Line(d(2026, 7, 1)) })], []).indexOf('D5') === -1);
  var d5 = buildHealth([sheet_()], [], { now: NOW, xeroConnected: true })
    .filter(function (f) { return f.id === 'D5'; })[0];
  check('D5 amount is the spend expected to date, not the whole budget',
    d5 && d5.amount > 0 && d5.amount < 10000);
  check('D5 detail names the end of the last finished quarter',
    d5 && d5.detail.indexOf('2026-06-30') !== -1);

  check('forecastOrBaseline_: an entry wins, a 0 included',
    forecastOrBaseline_({ q: 0 }, { q: 900 }, 'q') === 0 &&
    forecastOrBaseline_({ q: 400 }, { q: 900 }, 'q') === 400);
  check('forecastOrBaseline_: a blank falls back to the baseline',
    forecastOrBaseline_({}, { q: 900 }, 'q') === 900 &&
    forecastOrBaseline_(undefined, undefined, 'q') === 0);
  check('quarterStartDate_ rolls Q4 into the next calendar year',
    isoDate_(quarterStartDate_(qiOfDate_(d(2027, 2, 10)))) === '2027-01-01');
  // The stale repeating-journal detector: nothing in Xero reports one.
  check('D6 catches spend dated after the grant ended',
    idsFor([sheet_()], [spend_(500, '2027-06-01')]).indexOf('D6') !== -1);

  check('E1 catches overspend',
    idsFor([sheet_()], [spend_(12000, '2026-07-01')]).indexOf('E1') !== -1);
  // Under half the budget due by the end of June, so quiet though almost nothing is spent.
  check('E2 stays quiet before half the budget is due',
    idsFor([sheet_()], [spend_(100, '2026-07-01')]).indexOf('E2') === -1);
  // E2 judges the schedule, not the funding dates, the same way D5 does. Under the old
  // rule this fired: the contract "ends" in September while the budget runs to March, so
  // three quarters of the period looked elapsed with a quarter of the money due.
  check('E2 quiet when the funding dates run ahead of the schedule',
    idsFor([sheet_({ metadata: { 'funding end': '30/Sep/26' } })],
           [spend_(100, '2026-05-01')]).indexOf('E2') === -1);
  // Twelve months to September: three quarters of it was due by the end of June.
  function e2Sheet(over) {
    var o = { lines: [{ description: 'Delivery lead', milestone: 'Delivery',
      item: 'XXX_27_GOOD_001 - Delivery', project: 'General', start: d(2025, 10, 1),
      end: d(2026, 9, 30), cost: 12000, income: 12000, contribution: 0 }] };
    Object.keys(over || {}).forEach(function (k) { o[k] = over[k]; });
    return sheet_(o);
  }
  check('E2 fires when well under what the schedule expected',
    idsFor([e2Sheet()], [spend_(2000, '2026-03-01')]).indexOf('E2') !== -1);
  check('E2 counts this quarter\'s spend toward catching up',
    idsFor([e2Sheet()], [spend_(2000, '2026-03-01'), spend_(6000, '2026-08-01')])
      .indexOf('E2') === -1);
  var e2Slipped = { cost: {}, income: {}, comments: {} };
  ['25/26 Q3', '25/26 Q4', '26/27 Q1'].forEach(function (q) {
    e2Slipped.cost['XXX_27_GOOD_001||' + q] = 0;
  });
  check('E2 respects a Forecast that moved the work later',
    idsFor([e2Sheet({ forecast: e2Slipped })], [spend_(2000, '2026-03-01')])
      .indexOf('E2') === -1);
  check('E2 ignores an application that has not been won',
    idsFor([e2Sheet({ status: 'proposed' })], [spend_(2000, '2026-03-01')])
      .indexOf('E2') === -1);
  var e2 = buildHealth([e2Sheet()], [spend_(2000, '2026-03-01')],
    { now: NOW, xeroConnected: true }).filter(function (f) { return f.id === 'E2'; })[0];
  check('E2 amount is the shortfall against the schedule, not the unspent budget',
    e2 && e2.amount > 0 && e2.amount < 12000 - 2000);
  check('E2 detail names the date the spend was expected by',
    e2 && e2.detail.indexOf('2026-06-30') !== -1);

  check('E3 catches one item code in two sources',
    idsFor([sheet_(), sheet_({ name: 'XXX_27_OTHER',
      metadata: { 'funding source': 'XXX_27_OTHER' } })]).indexOf('E3') !== -1);
  check('E4 catches the same description in two sources over overlapping dates', (function () {
    var other = sheet_({ name: 'XXX_27_OTHER', metadata: { 'funding source': 'XXX_27_OTHER' } });
    other.lines = [{ description: 'Delivery lead', milestone: 'Delivery',
      item: 'XXX_27_OTHER_001 - Delivery', project: 'General',
      start: d(2026, 6, 1), end: d(2026, 12, 31), cost: 8000, income: 8000, contribution: 0 }];
    return idsFor([sheet_(), other]).indexOf('E4') !== -1;
  })());
  // Declared alternatives are G3's business, not E4's. Reporting both would double-charge
  // the reader for one decision they already made.
  check('E4 stays quiet when the two are declared alternatives', (function () {
    var a = sheet_({ metadata: { 'exclusivity group': 'Delivery 26/27' } });
    var other = sheet_({ name: 'XXX_27_OTHER', metadata: {
      'funding source': 'XXX_27_OTHER', 'exclusivity group': 'Delivery 26/27' } });
    other.lines = [{ description: 'Delivery lead', milestone: 'Delivery',
      item: 'XXX_27_OTHER_001 - Delivery', project: 'General',
      start: d(2026, 6, 1), end: d(2026, 12, 31), cost: 8000, income: 8000, contribution: 0 }];
    return idsFor([a, other]).indexOf('E4') === -1;
  })());

  // Probability parsing. "Unknown" must stay distinguishable from zero, or an ask with no
  // stated probability would silently count as hopeless.
  check('secured is always certain', sourceProbability_('secured', {}) === 1);
  check('secured ignores a stated probability',
    sourceProbability_('secured', { probability: '40' }) === 1);
  check('proposed with no probability is null, not 0',
    sourceProbability_('proposed', {}) === null);
  check('blank probability is null', sourceProbability_('proposed', { probability: '  ' }) === null);
  check('"40" reads as 40%', sourceProbability_('proposed', { probability: '40' }) === 0.4);
  check('"40%" reads as 40%', sourceProbability_('proposed', { probability: '40%' }) === 0.4);
  check('0.4 reads as 40%', sourceProbability_('proposed', { probability: 0.4 }) === 0.4);
  check('1 is certainty, not one percent',
    sourceProbability_('proposed', { probability: 1 }) === 1);
  check('over 100 clamps to certainty',
    sourceProbability_('proposed', { probability: '150' }) === 1);
  check('nonsense is null, not 0',
    sourceProbability_('proposed', { probability: 'maybe' }) === null);

  // Exclusivity groups: one piece of work, several asks. Exactly one member carries the
  // cost or the work is multiplied across the organisation budget.
  function src_(name, status, cost, group) {
    return { name: name, status: status,
      metadata: group ? { 'exclusivity group': group } : {},
      lines: [{ cost: cost, income: cost, milestone: 'M', item: name + '_001 - M',
                project: 'General' }] };
  }
  var reps = chooseExclusivityReps_([
    src_('XXX_27_ALPHA', 'proposed', 40000, 'Advisory role 26/27'),
    src_('XXX_27_BETA', 'proposed', 30000, 'Advisory role 26/27')
  ]);
  check('largest cost carries the work', reps['Advisory role 26/27'] === 'XXX_27_ALPHA');

  var reps2 = chooseExclusivityReps_([
    src_('XXX_27_ALPHA', 'proposed', 40000, 'Advisory role 26/27'),
    src_('XXX_27_BETA', 'secured', 30000, 'Advisory role 26/27')
  ]);
  check('a secured source wins even when smaller, it is the money being spent',
    reps2['Advisory role 26/27'] === 'XXX_27_BETA');

  var reps3 = chooseExclusivityReps_([
    src_('B_SOURCE', 'proposed', 1000, 'tie'),
    src_('A_SOURCE', 'proposed', 1000, 'tie')
  ]);
  check('ties break by name, so the choice is stable across refreshes',
    reps3['tie'] === 'A_SOURCE');

  check('a source with no group is never suppressed',
    Object.keys(chooseExclusivityReps_([src_('SOLO', 'proposed', 500, '')])).length === 0);
  check('two groups are decided independently', (function () {
    var r = chooseExclusivityReps_([
      src_('X1', 'proposed', 10, 'g1'), src_('X2', 'proposed', 20, 'g1'),
      src_('Y1', 'proposed', 40, 'g2'), src_('Y2', 'proposed', 30, 'g2')]);
    return r['g1'] === 'X2' && r['g2'] === 'Y1';
  })());

  check('scaleMap_ zeroes a suppressed cost without mutating the source', (function () {
    var m = { '26/27 Q1': 100 };
    var z = scaleMap_(m, 0);
    return z['26/27 Q1'] === 0 && m['26/27 Q1'] === 100;
  })());

  // Five-year plan rows. The plan sums per-quarter buckets by financial year, so a
  // milestone spanning two years must split, not double.
  var planKey = 'General||XXX_27_PLAN||Delivery';
  var planEntry = { budget: 0, income: 0, status: 'secured', budgetFY: 0, incomeFY: 0,
    budgetByQ: {}, incomeByQ: {}, weightedByQ: {}, comment: 'phased over two years',
    start: null, end: null };
  var planLine = { description: 'Delivery lead', milestone: 'Delivery',
    item: 'XXX_27_PLAN_001 - Delivery', project: 'General',
    start: d(2026, 1, 1), end: d(2026, 12, 31), cost: 12000, income: 12000, contribution: 0 };
  addInto_(planEntry.budgetByQ, bucketToQuarters(distributeByMonth_([planLine], 'cost')));
  addInto_(planEntry.incomeByQ, bucketToQuarters(distributeByMonth_([planLine], 'income')));
  planEntry.budget = 12000; planEntry.income = 12000;
  var planRows = buildBreakdownRows_({ 'General||XXX_27_PLAN||Delivery': planEntry },
    {}, {}, {}, { XXX_27_PLAN: 'secured' });
  var pr = planRows[0];

  check('a secured source fills securedByQ and leaves proposedByQ empty',
    Object.keys(pr.securedByQ).length > 0 && Object.keys(pr.proposedByQ).length === 0);
  check('the Forecast comment reaches the plan row', pr.comment === 'phased over two years');
  check('cost splits across the two financial years it spans',
    sumFyQ(pr.budgetByQ, '25/26') > 0 && sumFyQ(pr.budgetByQ, '26/27') > 0);
  check('and the two years sum back to the line, not double it',
    Math.abs(sumFyQ(pr.budgetByQ, '25/26') + sumFyQ(pr.budgetByQ, '26/27') - 12000) < 1);

  // A proposed source must populate the other column, so the plan never blends committed
  // money with an application still out.
  var propEntry = JSON.parse(JSON.stringify(planEntry));
  propEntry.status = 'proposed';
  propEntry.budgetByQ = planEntry.budgetByQ; propEntry.incomeByQ = planEntry.incomeByQ;
  var propRow = buildBreakdownRows_({ 'General||XXX_27_ASK||Delivery': propEntry },
    {}, {}, {}, { XXX_27_ASK: 'proposed' })[0];
  check('a proposed source fills proposedByQ and leaves securedByQ empty',
    Object.keys(propRow.proposedByQ).length > 0 &&
    Object.keys(propRow.securedByQ).length === 0);

  // Project-lead scoped access. filterSnapshotForProjects_ is pure precisely so this can
  // run without a second Google account signed in.
  var snap = {
    generatedAt: '2026-08-12T00:00:00Z', xeroConnected: true, currentQuarter: '26/27 Q2',
    coverage: {},
    totals: { budget: 999, secured: 999, actual: 999, unsecuredGap: 999,
              budgetFY: 999, securedFY: 999, actualFY: 999, unsecuredGapFY: 999 },
    projects: [
      { project: 'Spyfish Aotearoa', proposedBudget: 100, securedIncome: 60,
        actualExpense: 40, unsecuredGap: 40, proposedBudgetFY: 10, securedIncomeFY: 6,
        actualExpenseFY: 4, unsecuredGapFY: 4 },
      { project: 'Wildlife Watcher', proposedBudget: 200, securedIncome: 50,
        actualExpense: 70, unsecuredGap: 150, proposedBudgetFY: 20, securedIncomeFY: 5,
        actualExpenseFY: 7, unsecuredGapFY: 15 }
    ],
    fundingSources: [{ project: 'Spyfish Aotearoa', name: 'SPY_26_UOA' },
                     { project: 'Wildlife Watcher', name: 'WW_25_TOI' }],
    breakdownRows: [{ project: 'Spyfish Aotearoa' }, { project: 'Wildlife Watcher' }],
    tracking: [{ id: 'SPY_26_UOA', milestones: [{ project: 'Spyfish Aotearoa' }] },
               { id: 'WW_25_TOI', milestones: [{ project: 'Wildlife Watcher' }] }],
    timeline: [{ project: 'Spyfish Aotearoa' }, { project: 'Wildlife Watcher' }],
    health: [
      { id: 'B4', severity: 'error', project: 'Spyfish Aotearoa',
        fundingSource: 'SPY_26_UOA', title: 'mine', detail: '', amount: 1,
        owner: 'a@wildlife.ai', link: 'https://sheet/spy' },
      { id: 'A1', severity: 'error', project: 'Wildlife Watcher',
        fundingSource: 'WW_25_TOI', title: 'not mine', detail: '', amount: 2,
        owner: 'b@wildlife.ai', link: 'https://sheet/ww' },
      { id: 'D1', severity: 'error', project: '', fundingSource: '',
        title: 'org-wide untagged spend', detail: '', amount: 5000 },
      { id: 'F5', severity: 'info', project: '', fundingSource: '',
        title: 'Refresh summary', detail: '11 funding source(s) read' },
      { id: 'F1', severity: 'error', project: '', fundingSource: '',
        title: 'Xero is not connected', detail: '' }
    ],
    dataFlags: ['stale flag that must be rebuilt from the filtered findings']
  };

  var lead = filterSnapshotForProjects_(JSON.parse(JSON.stringify(snap)),
                                        ['Spyfish Aotearoa']);
  check('scoped: access level is filtered', lead._accessLevel === 'filtered');
  check('scoped: only their project', lead.projects.length === 1 &&
    lead.projects[0].project === 'Spyfish Aotearoa');
  check('scoped: funding sources filtered', lead.fundingSources.length === 1 &&
    lead.fundingSources[0].name === 'SPY_26_UOA');
  check('scoped: breakdown filtered', lead.breakdownRows.length === 1);
  check('scoped: tracking filtered', lead.tracking.length === 1 &&
    lead.tracking[0].id === 'SPY_26_UOA');
  check('scoped: timeline filtered', lead.timeline.length === 1);
  // Totals must be rebuilt, never inherited: 999 would leak the org-wide figure.
  check('scoped: totals recomputed from their project only',
    lead.totals.budget === 100 && lead.totals.secured === 60 &&
    lead.totals.actual === 40 && lead.totals.unsecuredGap === 40);
  check('scoped: FY totals recomputed too',
    lead.totals.budgetFY === 10 && lead.totals.actualFY === 4);

  var hIds2 = lead.health.map(function (f) { return f.id; });
  check('scoped: keeps their own finding', hIds2.indexOf('B4') !== -1);
  check('scoped: hides another project\'s finding', hIds2.indexOf('A1') === -1);
  check('scoped: hides org-wide untagged spend (D1)', hIds2.indexOf('D1') === -1);
  check('scoped: hides the org-wide refresh summary (F5)', hIds2.indexOf('F5') === -1);
  check('scoped: keeps Xero disconnected (F1), their numbers are stale too',
    hIds2.indexOf('F1') !== -1);
  check('scoped: no other sheet link survives', lead.health.every(function (f) {
    return !f.link || f.link.indexOf('/ww') === -1; }));
  check('scoped: no other owner email survives', lead.health.every(function (f) {
    return f.owner !== 'b@wildlife.ai'; }));
  check('scoped: dataFlags rebuilt from the filtered findings, not inherited',
    lead.dataFlags.length === healthToFlags(lead.health).length &&
    lead.dataFlags.join(' ').indexOf('stale flag') === -1);

  var none = filterSnapshotForProjects_(JSON.parse(JSON.stringify(snap)), []);
  check('no access: everything empty', none._accessLevel === 'none' &&
    none.projects.length === 0 && none.health.length === 0 &&
    none.dataFlags.length === 0 && none.totals.budget === 0);

  var admin = filterSnapshotForProjects_(JSON.parse(JSON.stringify(snap)), ['*']);
  check('admin: sees everything', admin._accessLevel === 'admin' &&
    admin.health.length === 5 && admin.projects.length === 2);

  // ---- funded runway -------------------------------------------------------
  // The invariant that matters is ordering: secured must run out no later than weighted,
  // and weighted no later than all-proposed. If that ever inverts, the chart is telling a
  // board that winning more money shortened the runway.
  var rwNow = new Date(2026, 5, 15); // 2026-06
  function mSrc(name, status, meta, lines) {
    return { name: name, status: status, metadata: meta || {}, lines: lines };
  }
  function mLine(y, m, cost, income) {
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0),
      cost: cost, income: income, milestone: 'M', project: 'P' };
  }

  var rwBudgets = [
    mSrc('A', 'secured', {}, [
      mLine(2026, 6, 0, 10000),
      mLine(2026, 6, 4000, 0), mLine(2026, 7, 4000, 0), mLine(2026, 8, 4000, 0),
      mLine(2026, 9, 4000, 0), mLine(2026, 10, 4000, 0)
    ]),
    mSrc('B', 'proposed', { probability: 50 }, [mLine(2026, 8, 0, 8000)])
  ];
  var rw = buildRunway_(rwBudgets, [], rwNow, {});

  check('runway: secured crosses first', rw.crossover.secured === '2026-08');
  check('runway: weighted crosses later', rw.crossover.weighted === '2026-09');
  check('runway: all-proposed crosses last', rw.crossover.proposed === '2026-10');
  check('runway: months counted from the current month',
    rw.monthsOfRunway.secured === 2 && rw.monthsOfRunway.weighted === 3 &&
    rw.monthsOfRunway.proposed === 4);
  check('runway: ordering holds, secured <= weighted <= proposed',
    rw.monthsOfRunway.secured <= rw.monthsOfRunway.weighted &&
    rw.monthsOfRunway.weighted <= rw.monthsOfRunway.proposed);
  check('runway: opens at zero when there is no history', rw.openingNet === 0);
  check('runway: with no actuals every row is forecast',
    rw.months.length === 5 && rw.months.every(function (r) { return !r.actual; }));

  // A proposed source with no Probability is unknown, not zero: it must lift the
  // all-proposed ceiling while leaving the weighted line exactly where secured is.
  var rwNoProb = buildRunway_([
    mSrc('A', 'secured', {}, [mLine(2026, 6, 4000, 0), mLine(2026, 7, 4000, 0)]),
    mSrc('B', 'proposed', {}, [mLine(2026, 6, 0, 9000)])
  ], [], rwNow, {});
  check('runway: no Probability leaves weighted level with secured',
    rwNoProb.crossover.weighted === rwNoProb.crossover.secured &&
    rwNoProb.crossover.weighted === '2026-06');
  check('runway: no Probability still lifts the all-proposed ceiling',
    rwNoProb.crossover.proposed === null);

  // Actuals behind, budget ahead: months before this one collapse into openingNet.
  var rwActuals = buildRunway_(rwBudgets, [
    { date: new Date(2026, 4, 10), amount: 3000, kind: 'expense',
      project: 'P', fundingSource: 'A', item: '' },
    { date: new Date(2026, 4, 12), amount: 5000, kind: 'income',
      project: 'P', fundingSource: 'A', item: '' }
  ], rwNow, {});
  check('runway: openingNet is income minus spend before this month',
    rwActuals.openingNet === 2000);
  check('runway: past months are flagged actual',
    rwActuals.months[0].month === '2026-05' && rwActuals.months[0].actual === true);
  check('runway: a positive opening pushes the crossover out',
    rwActuals.crossover.secured === '2026-09');

  // An archived source must not reach runway, or it would disagree with the org cards.
  var rwArch = buildRunway_(rwBudgets, [
    { date: new Date(2026, 4, 10), amount: 9999, kind: 'expense',
      project: CONFIG.ARCHIVE_PREFIX + 'Old', fundingSource: 'A', item: '' }
  ], rwNow, {});
  check('runway: archived project actuals are excluded', rwArch.openingNet === 0);

  check('runway: months counted across a year boundary',
    monthsUntil_('2026-11', '2027-02') === 3);
  check('runway: no crossover reports null, not zero',
    monthsUntil_('2026-06', null) === null);

  // ---- archiving actually archives ----------------------------------------
  // Archiving happens in Drive; Xero keeps the original tracking name forever. Matching
  // only on the prefix meant an archived sheet vanished from the dashboard while its
  // spend stayed in the organisation totals with no budget beside it.
  setArchivedSourceNames_({ 'WW_25_OLD': true });
  check('archived: prefixed Xero tag still matches',
    isArchivedSource_(CONFIG.ARCHIVE_PREFIX + 'WW_25_OLD') === true);
  check('archived: bare Xero tag matches the name archived in Drive',
    isArchivedSource_('WW_25_OLD') === true);
  check('archived: a live source is untouched', isArchivedSource_('WW_25_TOI') === false);
  check('archived: an empty tag is not archived, it is unassigned',
    isArchivedSource_('') === false && isArchivedSource_(null) === false);

  var rwArchName = buildRunway_([
    mSrc('A', 'secured', {}, [mLine(2026, 6, 4000, 0)])
  ], [
    { date: new Date(2026, 4, 10), amount: 7777, kind: 'expense',
      project: 'P', fundingSource: 'WW_25_OLD', item: '' }
  ], rwNow, {});
  check('archived: spend on an archived source stays out of runway',
    rwArchName.openingNet === 0);
  setArchivedSourceNames_({}); // shared global: leave it as it was found

  // The folder is the status. Requiring a second copy only created something that
  // could contradict it.
  check('status is not a required metadata key',
    (CONFIG.REQUIRED_META || []).indexOf('status') === -1);

  // ---- only approved documents are actuals --------------------------------
  // The load-bearing one is DRAFT income: it was counted here, Xero's own P&L never
  // counted it, and on the runway chart it bought months that did not exist.
  check('posted: an authorised invoice counts',
    isPosted_('Invoices', 'AUTHORISED') === true);
  check('posted: a paid invoice counts',
    isPosted_('Invoices', 'PAID') === true);
  check('posted: a DRAFT invoice does not count',
    isPosted_('Invoices', 'DRAFT') === false);
  check('posted: a SUBMITTED invoice does not count',
    isPosted_('Invoices', 'SUBMITTED') === false);
  check('posted: voided and deleted invoices still do not count',
    isPosted_('Invoices', 'VOIDED') === false && isPosted_('Invoices', 'DELETED') === false);
  check('posted: an authorised bank transaction counts',
    isPosted_('BankTransactions', 'AUTHORISED') === true);
  check('posted: a deleted bank transaction does not count',
    isPosted_('BankTransactions', 'DELETED') === false);
  // An allowlist, so a status nobody has considered stays out of the money.
  check('posted: an unrecognised status is not assumed to be on the ledger',
    isPosted_('Invoices', 'SOME_NEW_XERO_STATUS') === false);
  check('posted: a missing status is not assumed to be on the ledger',
    isPosted_('Invoices', null) === false && isPosted_('Invoices', '') === false);
  check('posted: case does not decide whether money counts',
    isPosted_('Invoices', 'authorised') === true);
  // The opposite failure: a future fetcher whose collection has no policy yet must
  // return its rows, not silently return none.
  check('posted: a collection with no status policy passes through',
    isPosted_('CreditNotes', 'AUTHORISED') === true &&
    isPosted_('CreditNotes', null) === true);

  // Cancelled is not unposted. Only one of the two is a queue somebody can clear.
  check('cancelled: voided and deleted are cancelled',
    isCancelled_('VOIDED') === true && isCancelled_('DELETED') === true);
  check('cancelled: a draft is not cancelled, it is waiting',
    isCancelled_('DRAFT') === false && isCancelled_('SUBMITTED') === false);
  check('cancelled: an approved document is not cancelled',
    isCancelled_('AUTHORISED') === false && isCancelled_(null) === false);

  // F6 reports the draft pile only when there is one, so a tidy org sees no finding.
  var hUnp = buildHealth([], [], { now: d(2026, 6, 15), xeroConnected: true,
    exclusion: { count: 0, total: 0 }, unposted: { count: 2, total: 1234 },
    secretsMissing: [] });
  check('F6 reports drafts when some exist',
    hUnp.filter(function (f) { return f.id === 'F6'; }).length === 1);
  var hClean = buildHealth([], [], { now: d(2026, 6, 15), xeroConnected: true,
    exclusion: { count: 0, total: 0 }, unposted: { count: 0, total: 0 },
    secretsMissing: [] });
  check('F6 stays quiet when there are none',
    hClean.filter(function (f) { return f.id === 'F6'; }).length === 0);

  // ---- C6 accepts the spellings people type --------------------------------
  function policyOk(v) {
    return (CONFIG.CONTRIBUTION_POLICIES || [])
      .some(function (re) { return re.test(normalisePolicy_(v)); });
  }
  check('policy: the three canonical tokens pass',
    policyOk('none') && policyOk('per_line') && policyOk('percent_of_income:40'));
  check('policy: capitals do not decide whether a sheet is right',
    policyOk('None') && policyOk('PER_LINE') && policyOk('Percent_Of_Income:40'));
  check('policy: a space or hyphen reads as an underscore',
    policyOk('per line') && policyOk('Per-Line'));
  check('policy: a space after the colon is still a percentage',
    policyOk('percent of income: 40') && policyOk('Percent of income : 12.5'));
  check('policy: surrounding whitespace is ignored',
    policyOk('  none  '));
  // Normalising spellings must not start guessing at meanings.
  check('policy: a different statement is still rejected',
    policyOk('40%') === false && policyOk('all_income_contributes') === false &&
    policyOk('') === false);
  check('policy: a percentage still needs a number',
    policyOk('percent_of_income:') === false && policyOk('percent_of_income:abc') === false);
  // Above 100 it would send General more than the source receives.
  check('policy: a percentage runs 0 to 100',
    policyOk('percent_of_income:100') && policyOk('percent_of_income:0') &&
    policyOk('percent_of_income:150') === false);

  // ---- contribution: which share of a source's income funds General ------------
  function cSrc(policy, status, lines) {
    return { name: 'XXX_27_C', status: status || 'secured', projectFolder: 'Spyfish Aotearoa',
      metadata: policy === undefined ? {} : { 'contribution policy': policy },
      lines: lines || [] };
  }
  check('contribution: percent_of_income:40 is a rate of 0.4',
    contributionRate_(cSrc('percent_of_income:40')) === 0.4);
  check('contribution: read through the same normalising as C6',
    contributionRate_(cSrc('Percent of income: 12.5')) === 0.125);
  // per_line lines are already on General through the Project column; deriving on top
  // would count them twice.
  check('contribution: none and per_line derive nothing',
    contributionRate_(cSrc('none')) === 0 && contributionRate_(cSrc('per_line')) === 0);
  check('contribution: a missing or unreadable policy derives nothing',
    contributionRate_(cSrc(undefined)) === 0 && contributionRate_(cSrc('40%')) === 0 &&
    contributionRate_(cSrc('percent_of_income:150')) === 0);
  check('contribution: a line already on General owes nothing',
    lineContribution_({ project: 'General', income: 1000 }, 0.4) === 0 &&
    lineContribution_({ project: 'Spyfish Aotearoa', income: 1000 }, 0.4) === 400 &&
    lineContribution_({ project: 'Spyfish Aotearoa', income: 1000 }, 0) === 0);

  var cMoves = contributionMoves_([
    cSrc('percent_of_income:40', 'secured', [
      { project: 'Spyfish Aotearoa', income: 10000, cost: 6000 },
      { project: 'General', income: 2000, cost: 2000 }]),
    cSrc('percent_of_income:40', 'proposed', [
      { project: 'Wildlife Watcher', income: 5000, cost: 3000 }]),
    cSrc('per_line', 'secured', [{ project: 'General', income: 3000, cost: 3000 }])
  ]).moves;
  check('contribution: secured income moves from the project to General',
    cMoves['secured||Spyfish Aotearoa'] === -4000 && cMoves['secured||General'] === 4000);
  check('contribution: an application moves as proposed, not secured',
    cMoves['proposed||Wildlife Watcher'] === -2000 && cMoves['proposed||General'] === 2000);
  check('contribution: organisation totals do not move',
    Object.keys(cMoves).reduce(function (t, k) { return t + cMoves[k]; }, 0) === 0);

  // ---- aggregateBudgets_: the budget side of the Overview, reachable by a test ----
  // It ran inline in buildSnapshot, behind Drive and Xero, so nothing could test which
  // project is credited with which money. These pin what it does.
  function agSrc(name, status, meta, lines) {
    return { name: name, status: status, projectFolder: 'Spyfish Aotearoa', metadata: meta,
      forecast: { cost: {}, income: {}, comments: {} }, lines: lines };
  }
  function agLine(project, mile, code, cost, income) {
    return { project: project, milestone: mile, item: code + ' - ' + mile,
      start: d(2026, 4, 1), end: d(2027, 3, 31), cost: cost, income: income };
  }
  var agBudgets = [
    agSrc('XXX_27_A', 'secured', {}, [
      agLine('Spyfish Aotearoa', 'M1', 'XXX_27_A_001', 6000, 10000),
      agLine('General', 'GM', 'XXX_27_A_002', 2000, 2000)]),
    agSrc('XXX_28_B', 'proposed', { probability: '50', 'exclusivity group': 'G' },
      [agLine('Spyfish Aotearoa', 'M2', 'XXX_28_B_001', 5000, 8000)]),
    agSrc('XXX_28_C', 'proposed', { probability: '30', 'exclusivity group': 'G' },
      [agLine('Spyfish Aotearoa', 'M2', 'XXX_28_C_001', 5000, 5000)])
  ];
  var agReps = chooseExclusivityReps_(agBudgets);
  var ag = aggregateBudgets_(agBudgets, fyBounds_(d(2026, 9, 26)), agReps);
  function agSum(map) {
    return Object.keys(map || {}).reduce(function (t, k) { return t + map[k]; }, 0);
  }
  check('aggregate: income is credited to each line\'s own project',
    ag.budgetByKey['Spyfish Aotearoa||XXX_27_A||M1'].income === 10000 &&
    ag.budgetByKey['General||XXX_27_A||GM'].income === 2000);
  check('aggregate: item codes map to their milestone',
    ag.itemToMilestone['XXX_27_A||XXX_27_A_001'] === 'M1');
  var agLoser = agReps.G === 'XXX_28_B' ? 'XXX_28_C' : 'XXX_28_B';
  check('aggregate: a competing application keeps its ask but not the work',
    ag.budgetByKey['Spyfish Aotearoa||' + agLoser + '||M2'].budget === 0 &&
    ag.budgetByKey['Spyfish Aotearoa||' + agLoser + '||M2'].income > 0 &&
    ag.costSuppressed[agLoser].countedIn === agReps.G);
  check('aggregate: expected income weights a proposal by its probability',
    Math.abs(agSum(ag.budgetByKey['Spyfish Aotearoa||XXX_28_B||M2'].weightedByQ) - 4000) < 1);
  check('aggregate: the project rollup totals what the entries total',
    Math.abs(Object.keys(ag.projects).reduce(function (t, p) {
      return t + ag.projects[p].securedIncome; }, 0) - 12000) < 1);

  // ---- deriving contribution: General's income comes from the policy ----------
  var cBudgets = [
    agSrc('XXX_27_P', 'secured', { 'contribution policy': 'percent_of_income:40' }, [
      agLine('Spyfish Aotearoa', 'M1', 'XXX_27_P_001', 6000, 10000),
      agLine('General', 'GM', 'XXX_27_P_002', 2000, 2000)]),
    agSrc('XXX_28_Q', 'proposed', { 'contribution policy': 'percent_of_income:40',
      probability: '50' }, [agLine('Spyfish Aotearoa', 'M3', 'XXX_28_Q_001', 3000, 5000)]),
    agSrc('XXX_27_N', 'secured', { 'contribution policy': 'per_line' },
      [agLine('Spyfish Aotearoa', 'M4', 'XXX_27_N_001', 4000, 4000)])
  ];
  var cg = aggregateBudgets_(cBudgets, fyBounds_(d(2026, 9, 26)),
    chooseExclusivityReps_(cBudgets));
  var cRow = cg.budgetByKey['General||XXX_27_P||' + contributionMilestone_('XXX_27_P')];
  var qRow = cg.budgetByKey['General||XXX_28_Q||' + contributionMilestone_('XXX_28_Q')];
  check('derive: the project keeps what its policy leaves it',
    Math.abs(cg.budgetByKey['Spyfish Aotearoa||XXX_27_P||M1'].income - 6000) < 1e-6);
  check('derive: General receives the rest as this source\'s contribution, as income',
    cRow && Math.abs(cRow.income - 4000) < 1e-6 && cRow.budget === 0 &&
    cRow.status === 'secured');
  check('derive: a line already on General is not charged overhead',
    cg.budgetByKey['General||XXX_27_P||GM'].income === 2000);
  check('derive: the contribution follows the line quarter by quarter',
    !!cRow && Math.abs(agSum(cRow.incomeByQ) - 4000) < 1 &&
    Object.keys(cRow.incomeByQ).length === 4);
  check('derive: a source still totals exactly what its funder gives',
    !!cRow && Math.abs(cg.budgetByKey['Spyfish Aotearoa||XXX_27_P||M1'].income +
      cg.budgetByKey['General||XXX_27_P||GM'].income + cRow.income - 12000) < 1e-6);
  check('derive: an application contributes as proposed, at its probability',
    qRow && qRow.status === 'proposed' && Math.abs(agSum(qRow.weightedByQ) - 1000) < 1);
  check('derive: per_line and none add no contribution row',
    !cg.budgetByKey['General||XXX_27_N||' + contributionMilestone_('XXX_27_N')]);
  // The rollup splits a source's income by cost share, 75/25 here, and then moves the
  // policy's share of the non-General part.
  check('derive: the project rollup moves the same way, and totals do not',
    Math.abs(cg.projects['General'].securedIncome - 6600) < 1e-6 &&
    Math.abs(cg.projects['Spyfish Aotearoa'].securedIncome - 9400) < 1e-6);

  // The planner: General's contribution is income, one row per contributing source.
  var tl = buildTimeline_(cBudgets, [], {}, fyBounds_(d(2026, 9, 26)), d(2026, 9, 26));
  var tlRow = tl.filter(function (r) {
    return r.milestone === contributionMilestone_('XXX_27_P'); })[0];
  check('planner: a contribution is income to General, not cost',
    tlRow && tlRow.project === 'General' && tlRow.segments[0].cost === 0 &&
    tlRow.segments[0].income === 4000 && tlRow.totalBudget === 0);
  check('planner: only a percent policy gets a contribution row',
    tl.filter(function (r) {
      return r.milestone === contributionMilestone_('XXX_27_N'); }).length === 0);

  // General's tracking view: income layers only, by each milestone's own forecast rule.
  var tm = contributionMilestones_([
    { source: 'XXX_27_P', contributionRate: 0.4, milestones: [
      { project: 'Spyfish Aotearoa', incomeBaseline: { '26/27 Q1': 1000, '26/27 Q2': 1000 },
        incomeActual: { '26/27 Q1': 900 }, incomeForecast: { '26/27 Q2': 500 } },
      { project: 'Spyfish Aotearoa', incomeBaseline: { '26/27 Q2': 2000 },
        incomeActual: {}, incomeForecast: {} },
      { project: 'General', incomeBaseline: { '26/27 Q1': 9999 }, incomeActual: {},
        incomeForecast: {} }] },
    { source: 'XXX_27_N', contributionRate: 0, milestones: [
      { project: 'Spyfish Aotearoa', incomeBaseline: { '26/27 Q1': 5000 } }] }
  ]);
  check('tracking: one contribution row per contributing source',
    tm.length === 1 && tm[0].milestone === contributionMilestone_('XXX_27_P'));
  check('tracking: no cost layers, so General\'s spend is not counted twice',
    !!tm[0] && Object.keys(tm[0].baseline).length === 0 &&
    Object.keys(tm[0].actual).length === 0 && Object.keys(tm[0].costForecast).length === 0);
  check('tracking: the policy share of income on non-General milestones',
    !!tm[0] && tm[0].incomeBaseline['26/27 Q1'] === 400 &&
    tm[0].incomeBaseline['26/27 Q2'] === 1200 && tm[0].incomeActual['26/27 Q1'] === 360);
  // One milestone's forecast must not erase another's budget in the same quarter.
  check('tracking: forecasts fall back per milestone before they are summed',
    !!tm[0] && tm[0].incomeForecast['26/27 Q2'] === 1000);

  // G1: overhead within ten points of the policy is fine, either side.
  function g1Line(cost, income, end) {
    return [{ description: 'Delivery lead', milestone: 'Delivery',
      item: 'XXX_27_GOOD_001 - Delivery', project: 'Spyfish Aotearoa', start: d(2026, 4, 1),
      end: end || d(2027, 3, 31), cost: cost, income: income, contribution: income - cost }];
  }
  function g1Sheet(policy, cost, income, over) {
    var o = { metadata: { 'contribution policy': policy }, lines: g1Line(cost, income) };
    Object.keys(over || {}).forEach(function (k) { o[k] = over[k]; });
    return sheet_(o);
  }
  function g1For(sheet, actuals) {
    return buildHealth([sheet], actuals || [spend_(5000, '2026-07-01')],
      { now: NOW, xeroConnected: true }).filter(function (f) { return f.id === 'G1'; })[0];
  }
  var P40 = 'percent_of_income:40';
  // Mirrors SPY_27_MAINT: 55,000 of income, cost a little over half, a 40% policy.
  check('G1 quiet for a 45% overhead against a 40% policy',
    !g1For(g1Sheet(P40, 29984, 55000)));
  check('G1 quiet at exactly the policy',
    !g1For(g1Sheet(P40, 6000, 10000)));
  check('G1 quiet at either edge of the band, 30% and 50%',
    !g1For(g1Sheet(P40, 7000, 10000)) && !g1For(g1Sheet(P40, 5000, 10000)));
  check('G1 fires above the band',
    !!g1For(g1Sheet(P40, 4000, 10000)));
  check('G1 fires below the band, when costs eat the overhead',
    !!g1For(g1Sheet(P40, 8000, 10000)));
  var g1Detail = g1For(g1Sheet(P40, 4000, 10000));
  check('G1 says the planned overhead, the policy and its band, and the money off it',
    !!g1Detail && g1Detail.detail.indexOf('60% of income planned') !== -1 &&
    g1Detail.detail.indexOf('policy of 40% (30% to 50% is fine)') !== -1 &&
    g1Detail.amount === 2000);
  check('G1 still reports a margin on a source that owes no overhead',
    !!g1For(g1Sheet('none', 6000, 10000)) && !g1For(g1Sheet('none', 9500, 10000)));
  check('G1 covers applications as well as secured funding',
    !!g1For(g1Sheet(P40, 4000, 10000, { status: 'proposed' })));
  // A line already on General pays for General's work and is left out of the share.
  check('G1 leaves General lines out of the share',
    !g1For(g1Sheet(P40, 6000, 10000, { lines: g1Line(6000, 10000).concat([{
      description: 'GM', milestone: 'GM', item: 'XXX_27_GOOD_002 - GM', project: 'General',
      start: d(2026, 4, 1), end: d(2027, 3, 31), cost: 5000, income: 5000,
      contribution: 0 }]) })));
  // Actual, while the work continues: only spend that has already eaten the overhead.
  // A 40% plan on 10,000 can absorb 7,000 of spend before it drops under 30%.
  check('G1 quiet while spend to date leaves the overhead in the band',
    !g1For(g1Sheet(P40, 6000, 10000), [spend_(7000, '2026-07-01')]));
  var g1Eaten = g1For(g1Sheet(P40, 6000, 10000), [spend_(7500, '2026-07-01')]);
  check('G1 fires once spend to date has already taken the overhead below the band',
    !!g1Eaten && g1Eaten.detail.indexOf('already 25% on spend to date') !== -1 &&
    g1Eaten.amount === 1500);
  // Actual, once the work is done: both directions, because now it is final.
  var g1Done = g1For(g1Sheet(P40, 6000, 10000, { lines: g1Line(6000, 10000, d(2026, 6, 30)) }),
    [spend_(4000, '2026-06-01')]);
  check('G1 judges the actual overhead once the work is done',
    !!g1Done && g1Done.detail.indexOf('60% actual') !== -1);
  check('G1 quiet when finished work lands inside the band',
    !g1For(g1Sheet(P40, 6000, 10000, { lines: g1Line(6000, 10000, d(2026, 6, 30)) }),
      [spend_(5500, '2026-06-01')]));
  // Spend on an item whose lines are all General's is General's work, not this source's.
  check('G1 leaves spend on General lines out of the actual',
    !g1For(g1Sheet(P40, 6000, 10000, { lines: g1Line(6000, 10000).concat([{
      description: 'GM', milestone: 'GM', item: 'XXX_27_GOOD_002 - GM', project: 'General',
      start: d(2026, 4, 1), end: d(2027, 3, 31), cost: 9000, income: 9000,
      contribution: 0 }]) }), [spend_(5000, '2026-07-01'),
      spend_(9000, '2026-07-01', { item: 'XXX_27_GOOD_002 - GM', project: 'General' })]));

  // The organisation's gap is taken on its totals, so one project's surplus offsets
  // another's shortfall.
  var ot = orgTotals_([
    { proposedBudget: 100, securedIncome: 60, actualExpense: 0,
      proposedBudgetFY: 100, securedIncomeFY: 60, actualExpenseFY: 0 },
    { proposedBudget: 50, securedIncome: 80, actualExpense: 0,
      proposedBudgetFY: 50, securedIncomeFY: 80, actualExpenseFY: 0 }]);
  check('totals: the gap is the organisation\'s, not a sum of floored gaps',
    ot.unsecuredGap === 10 && ot.unsecuredGapFY === 10);

  // ---- serve-time health: staleness and the trigger ------------------------
  // Judged when a cached snapshot is served, because inside a refresh the snapshot is
  // fresh by definition and a dead trigger runs no refresh to notice itself.
  var stNow = new Date(2026, 8, 26, 12, 0, 0);
  function stIds(ctx) {
    return serveTimeHealth(ctx).map(function (f) { return f.id; });
  }
  function hoursAgo(h) { return new Date(stNow.getTime() - h * 3600000).toISOString(); }

  check('serve: a fresh snapshot with a trigger raises nothing',
    stIds({ now: stNow, generatedAt: hoursAgo(1), triggerInstalled: true,
            refreshHours: 6 }).length === 0);
  check('serve: F2 after more than two missed runs',
    stIds({ now: stNow, generatedAt: hoursAgo(13), triggerInstalled: true,
            refreshHours: 6 }).indexOf('F2') !== -1);
  check('serve: exactly two intervals is not yet stale',
    stIds({ now: stNow, generatedAt: hoursAgo(12), triggerInstalled: true,
            refreshHours: 6 }).indexOf('F2') === -1);
  check('serve: F2 detail says how old and how often it should run',
    (function () {
      var f = serveTimeHealth({ now: stNow, generatedAt: hoursAgo(72),
        triggerInstalled: true, refreshHours: 6 })[0];
      return f && f.id === 'F2' && f.detail.indexOf('3 day(s)') !== -1 &&
        f.detail.indexOf('every 6 hour') !== -1;
    })());
  check('serve: F7 when the trigger is missing',
    stIds({ now: stNow, generatedAt: hoursAgo(1), triggerInstalled: false,
            refreshHours: 6 }).indexOf('F7') !== -1);
  check('serve: F7 is an error, because nothing will ever refresh',
    serveTimeHealth({ now: stNow, generatedAt: hoursAgo(1), triggerInstalled: false,
      refreshHours: 6 })[0].severity === 'error');
  // "Could not tell" must not read as "missing".
  check('serve: an unknown trigger state raises nothing',
    stIds({ now: stNow, generatedAt: hoursAgo(1), triggerInstalled: null,
            refreshHours: 6 }).length === 0);
  check('serve: both fire together, error before warning',
    (function () {
      var ids = stIds({ now: stNow, generatedAt: hoursAgo(100), triggerInstalled: false,
        refreshHours: 6 });
      return ids.length === 2 && ids[0] === 'F7' && ids[1] === 'F2';
    })());
  // A snapshot with an unreadable timestamp is a different problem; this check must
  // neither crash the page nor cry wolf about it.
  check('serve: an unreadable generatedAt raises no F2',
    stIds({ now: stNow, generatedAt: 'not a date', triggerInstalled: true,
            refreshHours: 6 }).length === 0 &&
    stIds({ now: stNow, generatedAt: undefined, triggerInstalled: true,
            refreshHours: 6 }).length === 0);
  check('serve: falls back to the configured interval',
    stIds({ now: stNow, generatedAt: hoursAgo(2 * CONFIG.REFRESH_TRIGGER_HOURS + 1),
            triggerInstalled: true }).indexOf('F2') !== -1);

  // A project lead must see these two: each one means their numbers are old.
  var stSnap = { generatedAt: hoursAgo(1), projects: [], fundingSources: [],
    breakdownRows: [], tracking: [], timeline: [],
    health: serveTimeHealth({ now: stNow, generatedAt: hoursAgo(100),
      triggerInstalled: false, refreshHours: 6 }) };
  var stScoped = filterSnapshotForProjects_(stSnap, ['Spyfish Aotearoa']);
  check('serve: scoped users still see F2 and F7',
    stScoped.health.length === 2);

  check('finding_ returns null for an id not in the catalogue',
    finding_('ZZ9', {}) === null);

  // Runway is organisation-wide, so only full access receives it.
  var rwSnap = { generatedAt: hoursAgo(1), runway: { months: [{ month: '2026-09' }] },
    projects: [], fundingSources: [], breakdownRows: [], tracking: [], timeline: [],
    health: [] };
  check('runway: full access keeps it',
    filterSnapshotForProjects_(rwSnap, ['*']).runway !== undefined);
  check('runway: a project lead does not receive it',
    filterSnapshotForProjects_(rwSnap, ['Spyfish Aotearoa']).runway === undefined);
  check('runway: no access does not receive it',
    filterSnapshotForProjects_(rwSnap, []).runway === undefined);

  Logger.log(results.join('\n'));
  return results;
}
