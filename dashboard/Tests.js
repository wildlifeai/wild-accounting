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

  // A contract with milestones carrying Cost / Income / Contribution. Invented figures.
  var lines = [
    { milestone: 'Data cleaning', start: d(2025, 11, 1), end: d(2026, 1, 1),
      cost: 4000, income: 8000, contribution: 4000, project: 'Spyfish Aotearoa' },
    { milestone: 'Machine learning models', start: d(2026, 1, 1), end: d(2026, 3, 1),
      cost: 10000, income: 12000, contribution: 2000, project: 'Spyfish Aotearoa' },
    { milestone: 'Operational playbook', start: d(2025, 11, 1), end: d(2026, 4, 1),
      cost: 6000, income: 8000, contribution: 2000, project: 'General' }
  ];

  var fc = computeFundingSourceForecast(lines);

  check('expense total = 20,000', Math.abs(fc.totalBudgetExpense - 20000) < 1);
  check('income total = 28,000', Math.abs(fc.totalBudgetIncome - 28000) < 1);
  check('contribution total = 8,000', Math.abs(fc.totalContribution - 8000) < 1);

  // Cost spreads day-weighted across the months each milestone spans.
  check('expense spread over multiple months', Object.keys(fc.expenseByMonth).length >= 5);

  // Project shares by Cost: Spyfish = (4000+10000)/20000, General = 6000/20000.
  var shares = projectExpenseShares_(lines);
  check('Spyfish share 0.7', Math.abs(shares['Spyfish Aotearoa'] - 0.7) < 0.001);
  check('General share 0.3', Math.abs(shares['General'] - 0.3) < 0.001);

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
  // cannot make for itself. See docs/HEALTH_CHECKS.md.
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

  // Project tracking: one project's sources, each milestone's cells by quarter. Forecast
  // overrides live on the milestone itself, read from each funding source's own Forecast
  // tab by BudgetReader.parseForecastTab_.
  var trk = [
    { source: 'WW_25_TOI', status: 'secured', project: 'Wildlife Watcher', sheetUrl: 'u1',
      milestones: [
        { item: 'WW_25_TOI_002', milestone: 'General management', source: 'WW_25_TOI',
          project: 'Wildlife Watcher',
          baseline: { '25/26 Q3': 4992, '25/26 Q4': 7615,
            '26/27 Q1': 7703, '26/27 Q2': 2792, '26/27 Q3': 1000 },
          actual: { '25/26 Q3': 2000, '25/26 Q4': 2500 },
          costForecast: { '26/27 Q2': 5000 },   // override on one future quarter only
          incomeBaseline: { '26/27 Q1': 100 }, incomeActual: {}, incomeForecast: {},
          forecastComment: 'staffing ramp' },
        { item: 'WW_25_TOI_009', milestone: 'Admin', source: 'WW_25_TOI', project: 'General',
          baseline: { '26/27 Q2': 300 }, actual: {}, costForecast: {},
          incomeBaseline: {}, incomeActual: {}, incomeForecast: {}, forecastComment: '' },
        { item: '(unassigned)', milestone: 'Unassigned (no product/service)', source: 'WW_25_TOI',
          project: 'Wildlife Watcher', actualOnly: true,
          baseline: {}, actual: { '26/27 Q1': 40 }, costForecast: {},
          incomeBaseline: {}, incomeActual: {}, incomeForecast: {}, forecastComment: '' }] },
    { source: 'SPY_26_X', status: 'proposed', project: 'Spyfish Aotearoa', sheetUrl: null,
      milestones: [{ item: 'SPY_26_X_001', milestone: 'Dive', source: 'SPY_26_X',
        project: 'Spyfish Aotearoa', baseline: { '27/28 Q1': 10 }, actual: {},
        costForecast: {}, incomeBaseline: {}, incomeActual: {}, incomeForecast: {},
        forecastComment: '' }] }
  ];
  var tlines = [
    { project: 'Wildlife Watcher', milestone: 'General management', segments: [
      { source: 'WW_25_TOI', start: '2025-11', end: '2026-03' },
      { source: 'WW_25_TOI', start: '2026-04', end: '2026-12' }] }
  ];
  var pt = composeProjectTracking(trk, tlines, 'Wildlife Watcher', quarterSortNum('26/27 Q1'));
  var ptSrc = pt.sources[0];
  var m = ptSrc.milestones[0];
  function cellFor(label) { return (m.byQ[label] || {}).cost; }

  check('project tracking: only sources with a milestone on the project',
    pt.sources.length === 1 && ptSrc.source === 'WW_25_TOI' && ptSrc.status === 'secured' &&
    ptSrc.sheetUrl === 'u1');
  check('project tracking: a milestone tagged to another project is left out',
    ptSrc.milestones.map(function (x) { return x.milestone; }).join('|') ===
      'General management|Unassigned (no product/service)');
  check('project tracking: the General-tagged milestone appears under General',
    composeProjectTracking(trk, tlines, 'General', quarterSortNum('26/27 Q1'))
      .sources[0].milestones[0].milestone === 'Admin');
  check('past quarter: effective is the actual', cellFor('25/26 Q3').effective === 2000 &&
    cellFor('25/26 Q3').budget === 4992);
  check('future quarter uses its override', cellFor('26/27 Q2').effective === 5000 &&
    cellFor('26/27 Q2').forecast === 5000);
  // Regression guard: an unmaintained Forecast tab must fall back to the budget
  // baseline, never to 0. Reading 0 makes a source look certain to underspend.
  check('future quarter with no override falls back to baseline',
    cellFor('26/27 Q3').effective === 1000 && cellFor('26/27 Q3').forecast === null);
  check('current quarter uses actual, not baseline', cellFor('26/27 Q1').effective === 0);
  check('income is its own layer', m.byQ['26/27 Q1'].income.budget === 100 &&
    m.byQ['26/27 Q1'].income.effective === 0);
  check('comment carried through', m.comment === 'staffing ramp');
  check('the bar spans the segments, first to last quarter',
    m.from === '25/26 Q3' && m.to === '26/27 Q3');
  check('with no segment the bar spans the budgeted quarters',
    ptSrc.milestones[0].from === '25/26 Q3' &&
    composeProjectTracking(trk, [], 'Wildlife Watcher', quarterSortNum('26/27 Q1'))
      .sources[0].milestones[0].to === '26/27 Q3');
  check('an actual-only row has no bar',
    ptSrc.milestones[1].actualOnly === true && ptSrc.milestones[1].from === null);
  check('quarters run without a gap from the first to the last, and name the current one',
    pt.quarters.map(function (q) { return q.label; }).join('|') ===
      '25/26 Q3|25/26 Q4|26/27 Q1|26/27 Q2|26/27 Q3|26/27 Q4' &&
    pt.quarters[2].current === true && pt.quarters[1].past === true &&
    pt.quarters[3].past === false && pt.currentQuarter === '26/27 Q1');
  check('the current financial year is always there',
    composeProjectTracking(trk, tlines, 'Spyfish Aotearoa', quarterSortNum('26/27 Q1'))
      .quarters.map(function (q) { return q.label; }).join('|') ===
      '26/27 Q1|26/27 Q2|26/27 Q3|26/27 Q4|27/28 Q1');
  // Several projects: one heading per source, each row naming its project.
  var pt2 = composeProjectTracking(trk, tlines, ['Wildlife Watcher', 'General'],
    quarterSortNum('26/27 Q1'));
  check('several projects share each source heading, each row naming its project',
    pt2.project === 'Wildlife Watcher + General' && pt2.sources.length === 1 &&
    pt2.sources[0].milestones.map(function (x) { return x.milestone + '/' + x.project; })
      .join('|') === 'General management/Wildlife Watcher|Admin/General|' +
      'Unassigned (no product/service)/Wildlife Watcher');
  check('several projects: each bar keeps its own project\'s segments',
    pt2.sources[0].milestones[0].from === '25/26 Q3' &&
    pt2.sources[0].milestones[1].from === '26/27 Q2');
  // General's contribution from a project shown beside it is already in that project's
  // rows, so it is not counted again; one from a project not shown still is.
  var ctrk = [{ source: 'XXX_27_C', status: 'secured', contributionRate: 0.4, milestones: [
    { item: 'XXX_27_C_001', milestone: 'Build', project: 'Wildlife Watcher',
      baseline: { '26/27 Q2': 100 }, actual: {}, costForecast: {},
      incomeBaseline: { '26/27 Q2': 1000 }, incomeActual: {}, incomeForecast: {} }] }];
  var heads = function (projects) {
    return composeProjectTracking(ctrk, [], projects, quarterSortNum('26/27 Q1')).sources
      .map(function (s) { return s.source; }).join('|');
  };
  check('General alone gathers the contribution; with its project shown it is not doubled',
    heads('General') === CONTRIBUTIONS_HEADING &&
    heads(['General', 'Wildlife Watcher']) === 'XXX_27_C');

  // A source's tracking starts where the source does. The General option was renamed
  // GEN_27_CORE part way through a year, bringing years of history with it.
  var clipSrc = { name: 'GEN_27_X', status: 'secured', projectFolder: 'General',
    metadata: { 'funding start': '01/Apr/26' },
    lines: [{ item: 'GEN_27_X_001 - Ops', milestone: 'Ops', project: 'General',
      start: d(2026, 10, 1), end: d(2027, 3, 31), cost: 600, income: 0 }] };
  var clipActuals = [
    { date: d(2026, 3, 31), amount: 50, kind: 'expense', project: 'General',
      fundingSource: 'GEN_27_X', item: 'GEN_27_X_001' },
    { date: d(2026, 4, 1), amount: 20, kind: 'expense', project: 'General',
      fundingSource: 'GEN_27_X', item: 'GEN_27_X_001' },
    { date: d(2026, 2, 10), amount: 7, kind: 'income', project: 'General',
      fundingSource: 'GEN_27_X', item: '' }
  ];
  var clipped = buildTracking_([clipSrc], clipActuals)[0];
  check('tracking: actuals before the funding start are left out',
    JSON.stringify(clipped.milestones[0].actual) === '{"26/27 Q1":20}' &&
    clipped.milestones.length === 1);
  clipSrc.metadata = {};
  check('tracking: with no funding start, the first budget line is the start',
    Object.keys(buildTracking_([clipSrc], clipActuals)[0].milestones[0].actual).length === 0);
  clipSrc.metadata = { 'funding start': '01/Dec/26' };
  check('tracking: a line budgeted before the funding start keeps its spend',
    Object.keys(buildTracking_([clipSrc], clipActuals.concat([{ date: d(2026, 10, 5),
      amount: 9, kind: 'expense', project: 'General', fundingSource: 'GEN_27_X',
      item: 'GEN_27_X_001' }]))[0].milestones[0].actual).join() === '26/27 Q3');

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
  // The finding lists the lines, largest first, so they can be found in Xero.
  var d3Lines = [];
  for (var d3i = 1; d3i <= HEALTH_LINES_SHOWN + 2; d3i++) {
    d3Lines.push(spend_(d3i * 10, '2026-07-01', { item: '' }));
  }
  d3Lines.push(spend_(-5000, '2026-07-01', { item: '', contact: 'Acme Ltd',
    description: 'Refund of deposit', docType: 'Bill', reference: 'INV-7' }));
  var hOf = function (findings, id) {
    return findings.filter(function (f) { return f.id === id; })[0];
  };
  var d3 = hOf(buildHealth([sheet_()], d3Lines, { now: NOW, xeroConnected: true }), 'D3');
  check('D3 lists its lines, largest first by size, and counts the rest',
    d3.lines.length === HEALTH_LINES_SHOWN && d3.moreLines === 3 &&
    d3.lines[0].amount === -5000 && d3.lines[1].amount === (HEALTH_LINES_SHOWN + 2) * 10);
  check('D3 names the transaction: date, document, contact, description',
    d3.lines[0].date === '2026-07-01' && d3.lines[0].document === 'Bill INV-7' &&
    d3.lines[0].contact === 'Acme Ltd' && d3.lines[0].description === 'Refund of deposit' &&
    d3.lines[0].fundingSource === 'XXX_27_GOOD');
  // Archived spend is out of every total and grid, so coding it better changes nothing.
  check('D3 leaves out archived spend, by source or by project',
    idsFor([sheet_()], [
      spend_(900, '2026-07-01', { item: '', fundingSource: CONFIG.ARCHIVE_PREFIX + 'General' }),
      spend_(900, '2026-07-01', { item: '', project: CONFIG.ARCHIVE_PREFIX + 'Old' })
    ]).indexOf('D3') === -1);
  // Earlier years' books are closed, so the checks that ask for a Xero change look at this
  // financial year only. NOW is 14 Aug 2026, so the year began on 1 Apr 2026.
  var lastFY = buildHealth([sheet_()], [
    spend_(62, '2026-03-24', { item: '' }),
    spend_(70, '2026-03-31', { project: '' }),
    spend_(80, '2026-03-31', { fundingSource: '' })
  ], { now: NOW, xeroConnected: true }).map(function (f) { return f.id; });
  check('D1, D2 and D3 leave out lines from before this financial year',
    lastFY.indexOf('D1') === -1 && lastFY.indexOf('D2') === -1 && lastFY.indexOf('D3') === -1);
  check('D3 still counts a line from the first day of this financial year',
    idsFor([sheet_()], [spend_(62, '2026-04-01', { item: '' })]).indexOf('D3') !== -1);
  check('D4 still counts every year: its spend is in the totals whatever its date',
    idsFor([sheet_()], [spend_(900, '2025-06-01', { fundingSource: 'XXX_27_TYPO' })])
      .indexOf('D4') !== -1);
  check('D6 leaves out spend after the end that falls before this financial year',
    idsFor([sheet_({ metadata: { 'funding end': '31/Dec/25' } })],
      [spend_(500, '2026-02-01')]).indexOf('D6') === -1 &&
    idsFor([sheet_({ metadata: { 'funding end': '31/Dec/25' } })],
      [spend_(500, '2026-05-01')]).indexOf('D6') !== -1);
  check('D1 leaves out archived spend too',
    idsFor([sheet_()], [spend_(900, '2026-07-01',
      { project: '', fundingSource: CONFIG.ARCHIVE_PREFIX + 'General' })]).indexOf('D1') === -1);
  var d1 = hOf(buildHealth([sheet_()], [spend_(900, '2026-07-01', { project: '' })],
    { now: NOW, xeroConnected: true }), 'D1');
  check('D1 lists its lines', d1 && d1.lines.length === 1 && d1.lines[0].amount === 900);
  check('a finding about no Xero line carries no line list',
    !('lines' in hOf(buildHealth([sheet_()], [], { now: NOW, xeroConnected: true }), 'D5')));
  check('D4 catches actuals tagged to a source with no sheet',
    idsFor([sheet_()], [spend_(900, '2026-07-01', { fundingSource: 'XXX_27_TYPO' })])
      .indexOf('D4') !== -1);
  var d4 = hOf(buildHealth([sheet_()], [
    spend_(900, '2026-07-01', { fundingSource: 'XXX_27_TYPO' }),
    spend_(100, '2026-08-01', { fundingSource: 'XXX_27_TYPO' })
  ], { now: NOW, xeroConnected: true }), 'D4');
  check('D4 lists the lines behind its total',
    d4.amount === 1000 && d4.lines.length === 2 && d4.lines[1].date === '2026-08-01');
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
  var d6 = hOf(buildHealth([sheet_()], [spend_(500, '2027-06-01'), spend_(300, '2026-07-01')],
    { now: NOW, xeroConnected: true }), 'D6');
  check('D6 lists only the lines dated after the end',
    d6.lines.length === 1 && d6.lines[0].date === '2027-06-01');

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

  // Breakdown rows. The Overview sums per-quarter buckets by financial year, so a
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

  check('a secured source fills securedByQ', Object.keys(pr.securedByQ).length > 0);
  check('the Forecast comment reaches the breakdown row', pr.comment === 'phased over two years');
  check('cost splits across the two financial years it spans',
    sumFyQ(pr.budgetByQ, '25/26') > 0 && sumFyQ(pr.budgetByQ, '26/27') > 0);
  check('and the two years sum back to the line, not double it',
    Math.abs(sumFyQ(pr.budgetByQ, '25/26') + sumFyQ(pr.budgetByQ, '26/27') - 12000) < 1);

  // An application still out is not secured money, so the Secured column never counts it.
  var propEntry = JSON.parse(JSON.stringify(planEntry));
  propEntry.status = 'proposed';
  propEntry.budgetByQ = planEntry.budgetByQ; propEntry.incomeByQ = planEntry.incomeByQ;
  var propRow = buildBreakdownRows_({ 'General||XXX_27_ASK||Delivery': propEntry },
    {}, {}, {}, { XXX_27_ASK: 'proposed' })[0];
  check('a proposed source leaves securedByQ empty',
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

  // Work that goes ahead only if funded: its cost rides with its income, at its weight, and
  // never touches the secured line or the shared spend.
  var rwIf = runwayWalk_([
    { status: 'secured', cost: { '2026-11': 100 }, income: { '2026-11': 100 } },
    { status: 'proposed', probability: 0.5, ifFunded: true,
      cost: { '2026-11': 800 }, income: { '2026-11': 1000 } }], '2026-11');
  var rwIfNov = rwIf.months[0];
  check('only if funded: the cost leaves the secured line and the shared spend alone',
    rwIfNov.spend === 100 && rwIfNov.secured - rwIfNov.spend === 0);
  check('only if funded: the cost rides with the income, weighted and in full',
    rwIfNov.weighted - rwIfNov.spend === 100 && rwIfNov.proposed - rwIfNov.spend === 200);
  var rwAnyway = runwayWalk_([
    { status: 'secured', cost: { '2026-11': 100 }, income: { '2026-11': 100 } },
    { status: 'proposed', probability: 0.5,
      cost: { '2026-11': 800 }, income: { '2026-11': 1000 } }], '2026-11').months[0];
  check('regardless: a proposal\'s cost is spend on every line, as before',
    rwAnyway.spend === 900 && rwAnyway.secured - rwAnyway.spend === -800);

  var rwYear = runwayWalk_([{ status: 'secured',
    cost: { '2026-11': 100, '2026-12': 100, '2027-01': 100, '2027-02': 100 },
    income: { '2026-11': 350 } }], '2026-11');
  check('runway: months counted across a year boundary',
    rwYear.crossover.secured === '2027-02' && rwYear.monthsOfRunway.secured === 3);
  check('runway: no crossover reports null, not zero',
    rwNoProb.monthsOfRunway.proposed === null);

  // Reserves start the lines from money in hand: at the end of the figure's month every line
  // is the figure, and from there it is reserves plus funding against the plan.
  var rwRes = buildRunway_(rwBudgets, [
    { date: new Date(2026, 4, 10), amount: 3000, kind: 'expense',
      project: 'P', fundingSource: 'A', item: '' }
  ], rwNow, {}, {}, { amount: 20000, asAt: '2026-05-31', month: '2026-05' });
  var rwResMay = rwRes.months.filter(function (r) { return r.month === '2026-05'; })[0];
  check('reserves: every line is the figure at the end of its month',
    rwResMay.secured - rwResMay.spend === 20000 && rwResMay.proposed - rwResMay.spend === 20000);
  check('reserves: today starts from them', rwRes.openingNet === 20000);
  check('reserves: they push the crossover out',
    rw.crossover.secured === '2026-08' && rwRes.crossover.secured === null);
  check('reserves: travel with the snapshot', rwRes.reserves.amount === 20000);

  var resNow = new Date(2026, 9, 5);
  var res = latestReserves_([
    ['30/Jun/26', 80000, 'Q1 close'],
    ['30/Sep/26', '$95,000', 'Q2 close'],
    ['31/Dec/26', 70000, 'typed ahead'],
    ['15/Aug/26', '', 'no amount']
  ], resNow);
  check('reserves: the latest row, not one dated ahead or with no amount',
    res.amount === 95000 && res.asAt === '2026-09-30' && res.month === '2026-09');
  check('reserves: a date inside a month is the end of the month before',
    reservesMonth_(new Date(2026, 9, 2), resNow) === '2026-09');
  check('reserves: never this month, which is planned rather than read from Xero',
    reservesMonth_(new Date(2026, 9, 31), new Date(2026, 9, 31)) === '2026-09');
  check('reserves: an empty tab is no reserves', latestReserves_([], resNow) === null);

  // ---- quarter close --------------------------------------------------------
  // A grant invoiced to income, then part deferred by journal: earned to the quarter's end
  // minus what Xero shows to the same end is the journal still to post.
  var qcLine = function (y, m, kind, amount, source, extra) {
    return Object.assign({ date: d(y, m, 10), kind: kind, amount: amount,
      fundingSource: source, project: 'P', item: '' }, extra || {});
  };
  var qc = buildQuarterClose_([
    { name: 'XXX_27_T', metadata: { 'income recognition': 'as spent' }, lines: [] },
    { name: 'XXX_27_I', metadata: {}, lines: [] }
  ], [
    qcLine(2026, 4, 'income', 5000, 'XXX_27_T'),
    qcLine(2026, 6, 'income', -3600, 'XXX_27_T', { journal: true }),
    qcLine(2026, 5, 'income', 800, 'XXX_27_I')
  ], [
    qcLine(2026, 5, 'expense', 1000, 'XXX_27_T'),
    qcLine(2026, 5, 'income', 1000, 'XXX_27_T', { earned: true }),
    qcLine(2026, 8, 'expense', 500, 'XXX_27_T'),
    qcLine(2026, 8, 'income', 500, 'XXX_27_T', { earned: true }),
    qcLine(2026, 5, 'expense', 300, 'XXX_27_I')
  ], [
    { source: 'XXX_27_T', status: 'secured', sheetUrl: 'u', milestones: [
      { item: 'XXX_27_T_001', milestone: 'Staff', project: 'P',
        baseline: { '26/27 Q1': 1000, '26/27 Q2': 1000, '26/27 Q3': 1000 },
        costForecast: { '26/27 Q2': 900 },
        actual: { '26/27 Q1': 950, '26/27 Q2': 500 }, forecastComment: 'invoice late' }] },
    { source: 'XXX_27_P', status: 'proposed', milestones: [
      { item: 'XXX_27_P_001', milestone: 'Dive', project: 'P',
        baseline: { '26/27 Q2': 5000 }, actual: {} }] }
  ], quarterSortNum('26/27 Q3'));
  var qcT = qc.releases[0];
  check('quarter close: only grants marked as spent are released',
    qc.releases.length === 1 && qcT.source === 'XXX_27_T');
  check('quarter close: spend, earned and Xero income by quarter',
    JSON.stringify(qcT.byQ['26/27 Q1']) === '{"spend":1000,"earned":1000,"xero":1400}' &&
    JSON.stringify(qcT.byQ['26/27 Q2']) === '{"spend":500,"earned":500,"xero":0}');
  var qcPost = function (q) {
    return Object.keys(qcT.byQ).filter(function (k) { return qiOfLabel_(k) <= qiOfLabel_(q); })
      .reduce(function (t, k) { return t + qcT.byQ[k].earned - qcT.byQ[k].xero; }, 0);
  };
  check('quarter close: to Q1 defers the unspent part, to Q2 releases what Q2 spent',
    qcPost('26/27 Q1') === -400 && qcPost('26/27 Q2') === 100);
  check('quarter close: a shortfall on a secured milestone is an accrual candidate',
    qc.accruals.length === 1 && qc.accruals[0].quarter === '26/27 Q2' &&
    qc.accruals[0].expected === 900 && qc.accruals[0].actual === 500 &&
    qc.accruals[0].comment === 'invoice late');
  check('quarter close: finished quarters only, latest first',
    qc.quarters.join('|') === '26/27 Q2|26/27 Q1');

  // ---- reserves from Xero's Balance Sheet ------------------------------------
  // Account rows sit inside nested sections; the first value column is the date asked for.
  var bsRow = function (name, id, now, before) {
    return { RowType: 'Row', Cells: [
      { Value: name, Attributes: [{ Id: 'account', Value: id }] },
      { Value: now }, { Value: before }] };
  };
  var bs = parseBalanceSheet_({ Rows: [
    { RowType: 'Header', Cells: [{ Value: '' }, { Value: '30 Sep 2026' }, { Value: '30 Sep 2025' }] },
    { RowType: 'Section', Title: 'Assets', Rows: [
      { RowType: 'Section', Title: 'Bank', Rows: [
        bsRow('WILDLIFE.AI TRUST', 'id-600', '80000.50', '1.00'),
        bsRow('ANZ Term Deposit', 'id-605', '30000.00', '1.00'),
        { RowType: 'SummaryRow', Cells: [{ Value: 'Total Bank' }, { Value: '110000.50' }] }] },
      { RowType: 'Section', Title: 'Current Assets', Rows: [
        bsRow('Accounts Receivable', 'id-610', '2000', '0')] }] },
    { RowType: 'Section', Title: 'Liabilities', Rows: [
      bsRow('Accounts Payable', 'id-800', '12000', '0'),
      bsRow('Unused Donations and Grants with Conditions', 'id-8xx', '50000', '0')] }
  ] }, { 'id-600': '600', 'id-605': '605' });
  check('balance sheet: bank rows by code, from the first value column, totals skipped',
    bs.byCode['600'] === 80000.5 && bs.byCode['605'] === 30000 && !bs.byName['Total Bank']);
  var resX = reservesFromBalanceSheet_(bs, 38000);
  // 80000.5 + 30000 + 2000 owed to us - 12000 to pay - 50000 in advance + 38000 unposted.
  check('reserves from Xero: bank and invoices owed to us, less bills to pay and in advance, ' +
    'plus unposted releases', resX.amount === 88001);
  check('reserves from Xero: the note shows each part',
    resX.note.indexOf(RESERVES_AUTO_NOTE) === 0 &&
    resX.note.indexOf('Accounts Receivable 2000') !== -1 &&
    resX.note.indexOf('Accounts Payable 12000') !== -1 &&
    resX.note.indexOf('releases not yet posted 38000') !== -1);
  check('reserves from Xero: an in-advance account not on the sheet counts as nothing, and says so',
    reservesFromBalanceSheet_({ byCode: { '600': 100 }, byName: {} }, 0).note
      .indexOf('not on the balance sheet') !== -1);
  check('reserves from Xero: releases still to post, cumulative to the quarter',
    unpostedReleases_(qc, '26/27 Q1') === -400 && unpostedReleases_(qc, '26/27 Q2') === 100);
  var f4 = function (issue) {
    return buildHealth([], [], { now: d(2026, 10, 5), xeroConnected: true,
      exclusion: { count: 0, total: 0 }, unposted: { count: 0, total: 0 },
      secretsMissing: [], reservesIssue: issue })
      .filter(function (f) { return f.id === 'F4'; }).length;
  };
  check('F4 when Xero refused the Balance Sheet, quiet otherwise',
    f4('scope') === 1 && f4(null) === 0);

  // The page receives runwayWalk_ as its own source (Index.html), so it must stand alone:
  // a call to any server helper would work here and throw in the browser.
  check('runway: the walk calls nothing outside itself',
    !/\b(round_|monthsUntil_|addInto_|scaleMap_|distributeByMonth_|CONFIG|DateMath|clean_)\b/
      .test(runwayWalk_.toString()));

  // Parts split income the way the cards do: a 40% policy moves 40% of a non-General
  // line's income to a "(contribution)" part under General, budget and actual alike.
  var rwParts = runwayParts_([
    mSrc('S', 'secured', { 'contribution policy': 'percent_of_income:40' },
      [mLine(2026, 6, 500, 1000)])
  ], [{ date: new Date(2026, 4, 10), amount: 200, kind: 'income',
        project: 'P', fundingSource: 'S', item: '' }], {}, {});
  var rwOwn = rwParts.filter(function (p) { return p.project === 'P'; })[0];
  var rwGen = rwParts.filter(function (p) { return p.project === CONFIG.GENERAL_PROJECT; })[0];
  check('runway parts: the project keeps its share of budget income',
    Math.abs(rwOwn.income['2026-06'] - 600) < 0.01 && rwOwn.cost['2026-06'] === 500);
  check('runway parts: General gets the policy share, under the contribution milestone',
    Math.abs(rwGen.income['2026-06'] - 400) < 0.01 && rwGen.milestone === 'S (contribution)');
  // The actual carries no item code, so it sits on the project's "(unassigned)" part.
  var rwOwnActual = rwParts.filter(function (p) {
    return p.project === 'P' && p.milestone === '(unassigned)'; })[0];
  check('runway parts: actual income splits the same way',
    Math.abs(rwOwnActual.actualIncome['2026-05'] - 120) < 0.01 &&
    Math.abs(rwGen.actualIncome['2026-05'] - 80) < 0.01);

  // Lines per group must add up to the organisation's line, or grouping the chart would
  // change the total it is a breakdown of.
  var rwAll = runwayWalk_(rwParts, '2026-06');
  var rwAxis = rwAll.months.map(function (r) { return r.month; });
  var rwSum = rwParts.reduce(function (t, p) {
    var last = runwayWalk_([p], '2026-06', rwAxis).months.slice(-1)[0];
    return t + last.weighted - last.spend;
  }, 0);
  var rwLast = rwAll.months.slice(-1)[0];
  check('runway parts: group lines sum to the total line',
    Math.abs(rwSum - (rwLast.weighted - rwLast.spend)) < 1);

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

  // Only a funding-source name in archived/ hides a Xero tag. An old budget called
  // "General" there once hid everything tagged General.
  check('archived name: the prefix comes off a funding source',
    archivedSourceName_('Z_ARCH_WW_25_POW') === 'WW_25_POW');
  check('archived name: the older Z_ARCHIVED_ prefix is understood too',
    archivedSourceName_('Z_ARCHIVED_WW_24_DOC_COM') === 'WW_24_DOC_COM');
  check('archived name: an unprefixed funding source still counts',
    archivedSourceName_('WAI_25_OMV') === 'WAI_25_OMV');
  check('archived name: an old budget called General does not',
    archivedSourceName_('General') === '' && archivedSourceName_('General 26-29') === '');
  check('archived name: legacy files do not',
    archivedSourceName_('SPY_Xero_budgets') === '' &&
    archivedSourceName_('Z_ARCH_WAI_24_25_Budget_P&L_Expenses_Revenue') === '' &&
    archivedSourceName_('Spyfish_24_25_Project_Profit_Loss') === '');

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
  var draftBill = unpostedDoc_('Invoices', { Type: 'ACCPAY', Status: 'DRAFT',
    InvoiceNumber: 'B-12', Contact: { Name: 'Acme Ltd' }, DateString: '2026-06-01T00:00:00' }, 1000);
  var waitingSpend = unpostedDoc_('BankTransactions', { Type: 'SPEND', Status: 'SUBMITTED',
    Reference: 'Card', Contact: { Name: 'Shop' }, DateString: '2026-06-02T00:00:00' }, 234);
  check('unposted documents are named as Xero names them',
    draftBill.docType === 'Bill' && draftBill.reference === 'B-12' &&
    draftBill.description === 'draft' && waitingSpend.docType === 'Spend money' &&
    waitingSpend.description === 'awaiting approval');
  var f6 = hOf(buildHealth([], [], { now: d(2026, 6, 15), xeroConnected: true,
    exclusion: { count: 0, total: 0 },
    unposted: { count: 2, total: 1234, docs: [waitingSpend, draftBill] },
    secretsMissing: [] }), 'F6');
  check('F6 lists the documents, largest first',
    f6.lines.length === 2 && f6.lines[0].document === 'Bill B-12' &&
    f6.lines[0].contact === 'Acme Ltd' && f6.lines[1].date === '2026-06-02');
  var oldDraft = unpostedDoc_('Invoices', { Type: 'ACCPAY', Status: 'DRAFT',
    DateString: '2026-03-20T00:00:00' }, 5000);
  var f6Old = function (docs) {
    return hOf(buildHealth([], [], { now: d(2026, 6, 15), xeroConnected: true,
      exclusion: { count: 0, total: 0 }, secretsMissing: [],
      unposted: { count: docs.length, total: 0, docs: docs } }), 'F6');
  };
  check('F6 leaves out drafts dated before this financial year, from the count and total',
    !f6Old([oldDraft]) && f6Old([oldDraft, draftBill]).amount === 1000 &&
    /^1 document/.test(f6Old([oldDraft, draftBill]).detail));
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

  // Goes ahead: only if funded. The cost is expected at the ask's probability, for the cards.
  function goes(v) { return goesAhead_({ metadata: { 'goes ahead': v } }); }
  check('goes ahead: "Only if funded" is read, blank and "regardless" are the default',
    goes('Only if funded') === 'only if funded' && goes('') === 'regardless' &&
    goes('Regardless') === 'regardless');
  check('goes ahead: anything else is unknown, not guessed', goes('if funded') === 'unknown');
  var ifBudgets = [agSrc('XXX_28_D', 'proposed', { probability: '25',
    'goes ahead': 'only if funded' }, [agLine('Spyfish Aotearoa', 'M5', 'XXX_28_D_001', 4000, 5000)])];
  var ifRow = buildBreakdownRows_(aggregateBudgets_(ifBudgets, fyBounds_(d(2026, 9, 26)),
    chooseExclusivityReps_(ifBudgets)).budgetByKey, {}, {}, {}, {})[0];
  check('only if funded: the row says so and expects its cost at the probability',
    ifRow.ifFunded === true && Math.abs(agSum(ifRow.weightedCostByQ) - 1000) <= 2 &&
    agSum(ifRow.budgetByQ) === 4000);
  check('only if funded: a secured sheet is funded, so its cost always counts',
    !costIfFunded_({ status: 'secured', metadata: { 'goes ahead': 'only if funded' } }) &&
    !buildBreakdownRows_(ag.budgetByKey, {}, {}, {}, {})[0].ifFunded);

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

  // The timeline: General's contribution is one row per contributing source, running the
  // months the policy's share of its income falls in, with that source's status.
  var tl = buildTimeline_(cBudgets);
  var tlRow = tl.filter(function (r) {
    return r.milestone === contributionMilestone_('XXX_27_P'); })[0];
  var m1 = cBudgets[0].lines[0];
  check('timeline: a contribution row runs the months of the lines it comes from',
    tlRow && tlRow.project === 'General' && tlRow.segments.length === 1 &&
    tlRow.segments[0].source === 'XXX_27_P' && tlRow.segments[0].status === 'secured' &&
    tlRow.segments[0].start === DateMath.monthKey(m1.start) &&
    tlRow.segments[0].end === DateMath.monthKey(m1.end));
  check('timeline: a segment carries only its source, status, start and end',
    Object.keys(tlRow.segments[0]).sort().join(',') === 'end,source,start,status');
  check('timeline: only a percent policy gets a contribution row',
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
  // Cost a little over half the income, against a 40% policy.
  check('G1 quiet for a 45% overhead against a 40% policy',
    !g1For(g1Sheet(P40, 5500, 10000)));
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
  // No share for General: no overhead for spend to eat, so G1 leaves spend to E1 and E5.
  var e5Lines = g1Line(6000, 6000).concat([{ description: 'GM', milestone: 'GM',
    item: 'XXX_27_GOOD_002 - GM', project: 'General', start: d(2026, 4, 1),
    end: d(2027, 3, 31), cost: 9000, income: 9000, contribution: 0 }]);
  var e5Sheet = g1Sheet('percent_of_income:0', 6000, 6000, { lines: e5Lines });
  var e5Spend = [spend_(7500, '2026-07-01'),
    spend_(4000, '2026-07-01', { item: 'XXX_27_GOOD_002 - GM', project: 'General' })];
  var e5All = buildHealth([e5Sheet], e5Spend, { now: NOW, xeroConnected: true });
  var e5 = e5All.filter(function (f) { return f.id === 'E5'; })[0];
  check('G1 does not judge spend on a source with no share for General',
    !e5All.some(function (f) { return f.id === 'G1'; }));
  check('E5: project lines over their budget, with the General lines beside them',
    !!e5 && e5.amount === 1500 && e5.detail.indexOf('Spyfish Aotearoa lines: actual 7500 ' +
      'against budget 6000, 25% over') !== -1 &&
    e5.detail.indexOf('General lines: actual 4000 against budget 9000') !== -1);
  check('E5 quiet within ten percent, and on a source with no General lines',
    !buildHealth([e5Sheet], [spend_(6500, '2026-07-01')], { now: NOW, xeroConnected: true })
      .some(function (f) { return f.id === 'E5'; }) &&
    !buildHealth([g1Sheet('percent_of_income:0', 6000, 6000)], [spend_(7500, '2026-07-01')],
      { now: NOW, xeroConnected: true }).some(function (f) { return f.id === 'E5'; }));
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

  // ---- Planning from the Forecast tab (planBudgets_) ----
  // A contract re-phased to Oct-Jun, Jul-Sep left blank, meaning
  // nothing happens then. Under blank-means-budget the Jul-Sep budget was counted as well.
  var ml = function (desc, s, e, cost, income, code, mile) {
    return { description: desc, start: s, end: e, cost: cost, income: income,
      contribution: income - cost, milestone: mile, item: code + ' - ' + mile,
      project: 'Spyfish Aotearoa' };
  };
  var mLines = [
    ml('Dashboard', d(2026, 8, 1), d(2027, 2, 1), 12000, 24000, 'SPY_27_HAN_001', 'Dashboard'),
    ml('Run models', d(2026, 8, 1), d(2026, 10, 1), 4000, 8000, 'SPY_27_HAN_002', 'Machine learning models'),
    ml('Tune models', d(2026, 12, 1), d(2027, 1, 1), 2000, 4000, 'SPY_27_HAN_002', 'Machine learning models'),
    ml('Project manager', d(2026, 8, 1), d(2027, 6, 30), 2000, 8000, 'SPY_27_HAN_004', 'Maintenance and support')
  ];
  var hdr = ['Jul-Sep 26 Forecast', 'Oct-Dec 26 Forecast', 'Jan-Mar 27 Forecast', 'Apr-Jun 27 Forecast', 'Comments'];
  var grid = [
    ['Revenue'].concat(hdr),
    ['Dashboard', '', 8000, 8000, 8000, ''],
    ['Machine learning models', '', 4000, 4000, 4000, ''],
    ['Maintenance and support', '', 8000 / 3, 8000 / 3, 8000 / 3, ''],
    ['', '', '', '', '', ''],
    ['Expenses'].concat(hdr),
    ['Dashboard', '', 4000, 4000, 4000, ''],
    ['Machine learning models', '', 3000, 3000, '', ''],
    ['Maintenance and support', '', '', '', '', '']
  ];
  var fakeSs = { getUrl: function () { return 'u'; },
    getSheetByName: function () { return { getDataRange: function () {
      return { getValues: function () { return grid; } }; } }; } };
  var parsedFc = parseForecastTab_(fakeSs, mLines).data;
  var rqc = parsedFc.rowQuarters || { cost: {}, income: {} };
  check('Forecast tab: a row with an entry records every column it sat under, blanks too',
    (rqc.income.SPY_27_HAN_001 || []).indexOf('26/27 Q2') !== -1 &&
    (rqc.cost.SPY_27_HAN_002 || []).length === 4);
  check('Forecast tab: a row left entirely blank records nothing',
    !rqc.cost.SPY_27_HAN_004);

  var owned = ownedForecast_(parsedFc);
  check('ownedForecast_: a blank in a row with entries becomes 0',
    owned.income['SPY_27_HAN_001||26/27 Q2'] === 0 && owned.cost['SPY_27_HAN_002||27/28 Q1'] === 0);
  check('ownedForecast_: a row left entirely blank gains nothing, so its budget stands',
    owned.cost['SPY_27_HAN_004||26/27 Q2'] === undefined);
  check('ownedForecast_: without rowQuarters the forecast is unchanged',
    Object.keys(ownedForecast_({ cost: { 'X||26/27 Q3': 5 }, income: {} }).cost).length === 1);

  var planL = plannedLines_(mLines, owned);
  var fyQ = function (ls, kind, q) {
    return ls.reduce(function (t, l) {
      var m = bucketToQuarters(distributeByMonth_([l], kind));
      return t + (m[q] || 0);
    }, 0);
  };
  var sumK = function (ls, kind) { return ls.reduce(function (t, l) { return t + l[kind]; }, 0); };
  check('plan: income totals the forecast, 44,000, with nothing in Jul-Sep',
    Math.abs(sumK(planL, 'income') - 44000) < 1 && Math.abs(fyQ(planL, 'income', '26/27 Q2')) < 1);
  check('plan: each quarter carries its forecast, 14,667 of income from Oct',
    Math.abs(fyQ(planL, 'income', '26/27 Q3') - 14666.67) < 1 &&
    Math.abs(fyQ(planL, 'income', '27/28 Q1') - 14666.67) < 1);
  check('plan: a milestone row left blank keeps its Budget-tab cost, Jul-Sep included',
    Math.abs(fyQ(planL.filter(function (l) { return l.item.indexOf('SPY_27_HAN_004') === 0; }), 'cost', '26/27 Q2') -
      fyQ([mLines[3]], 'cost', '26/27 Q2')) < 1 && fyQ([mLines[3]], 'cost', '26/27 Q2') > 0);
  check('plan: a quarter is shared across a milestone\'s lines by their budget, 2:1',
    Math.abs(sumK(planL.filter(function (l) { return l.description === 'Run models'; }), 'cost') - 4000) < 1 &&
    Math.abs(sumK(planL.filter(function (l) { return l.description === 'Tune models'; }), 'cost') - 2000) < 1);
  check('plan: a forecast quarter becomes a line spanning the whole quarter',
    planL.some(function (l) { return l.start.getTime() === d(2027, 4, 1).getTime() &&
      l.end.getTime() === d(2027, 6, 30).getTime() && l.income > 0; }));
  var noFc = plannedLines_(mLines, { cost: {}, income: {} });
  check('plan: with no forecast the Budget tab\'s own lines come back untouched',
    noFc.length === mLines.length && noFc.every(function (l, i) { return l === mLines[i]; }));
  var pb = planBudgets_([{ name: 'S', lines: mLines, forecast: parsedFc }])[0];
  check('planBudgets_: plans from the resolved forecast and keeps the Budget tab on budgetLines',
    pb.budgetLines === mLines && Math.abs(sumK(pb.lines, 'income') - 44000) < 1 &&
    pb.forecast.income['SPY_27_HAN_001||26/27 Q2'] === 0);

  // A11: cost forecast with no income forecast beside it.
  var a11For = function (fcst, ls) {
    return buildHealth([{ name: 'S', projectFolder: 'P', metadata: {}, tabs: [], issues: [],
      lines: ls || mLines, forecast: fcst }], [], {}).filter(function (f) { return f.id === 'A11'; });
  };
  var costOnly = { cost: { 'SPY_27_HAN_001||26/27 Q3': 4000 }, income: {}, comments: {} };
  // A11 is raised only while the plan does not run from today; with it, a blank Revenue
  // row follows its cost, which is the fix A11 asks for.
  check('A11: quiet once the plan runs from today',
    CONFIG.PLAN_REMAINING !== true || a11For(costOnly).length === 0);
  var keepPlan = CONFIG.PLAN_REMAINING;
  CONFIG.PLAN_REMAINING = false;
  var a11 = a11For(costOnly);
  check('A11: a cost forecast with no income forecast is flagged, with the income at stake',
    a11.length === 1 && a11[0].amount === 24000 && /SPY_27_HAN_001/.test(a11[0].detail));
  check('A11: quiet once the income row has an entry',
    a11For({ cost: costOnly.cost, income: { 'SPY_27_HAN_001||26/27 Q3': 0 }, comments: {} }).length === 0);
  check('A11: quiet for a milestone that budgets no income',
    a11For(costOnly, [ml('Cost only', d(2026, 8, 1), d(2026, 9, 1), 500, 0, 'SPY_27_HAN_001', 'Dashboard')]).length === 0);
  CONFIG.PLAN_REMAINING = keepPlan; // shared global: leave it as it was found

  // The template's note ends the tab even when its "Funding Source Details" heading is
  // missing, as on SPY_27_MAINT, where the note was read as a milestone (A8).
  var noteGrid = [
    ['Expenses'].concat(hdr),
    ['Dashboard', '', 4000, 4000, 4000, ''],
    ['Nothing below this row is read. Keep working notes here.', '', '', '', '', '']
  ];
  var noteSs = { getUrl: function () { return 'u'; },
    getSheetByName: function () { return { getDataRange: function () {
      return { getValues: function () { return noteGrid; } }; } }; } };
  check('Forecast tab: the "nothing below is read" note ends the tab, raising no A8',
    !parseForecastTab_(noteSs, mLines).issues.some(function (x) { return x.check === 'A8'; }));

  // A12: a minus sign on the Forecast tab, as WW_26_SALES had on its costs.
  var negGrid = [
    ['Expenses'].concat(hdr),
    ['Dashboard', '', -1500, -1500, 4000, ''],
    ['Machine learning models', '', 0, 3000, '', '']
  ];
  var negSs = { getUrl: function () { return 'u'; },
    getSheetByName: function () { return { getDataRange: function () {
      return { getValues: function () { return negGrid; } }; } }; } };
  var negIssues = parseForecastTab_(negSs, mLines).issues.filter(function (x) { return x.check === 'A12'; });
  check('A12: a negative Forecast entry is named, with its row and quarters',
    negIssues.length === 1 && negIssues[0].row === 2 &&
    /26\/27 Q3, 26\/27 Q4/.test(negIssues[0].detail));
  check('A12: a 0 is not negative',
    !negIssues.some(function (x) { return /Machine learning/.test(x.detail); }));

  // ---- earned basis (CONFIG.ACTUALS_EARNED) ----------------------------------
  // Income recognition is matched after normalising, like Contribution policy.
  function recog(v) { return incomeRecognition_({ metadata: { 'income recognition': v } }); }
  check('income recognition: "As Spent" and "as_spent" both mean as spent',
    recog('As Spent') === 'as spent' && recog('as_spent') === 'as spent');
  check('income recognition: blank and "as invoiced" are the default',
    recog('') === 'as invoiced' && recog('As invoiced') === 'as invoiced');
  check('income recognition: anything else is unknown, not guessed', recog('spent') === 'unknown');

  // A marked sheet earns as it spends, capped at its budgeted income; its invoice goes.
  function eSheet(name, recognition, cost, income) {
    return { name: name, status: 'secured', metadata: { 'income recognition': recognition },
      lines: [{ cost: cost, income: income }] };
  }
  function eLine(source, kind, amount, y, m) {
    return { date: d(y, m, 15), kind: kind, amount: amount, fundingSource: source,
      project: 'P', item: 'XXX_25_A_001', account: 'Grants (102)' };
  }
  var eOut = earnedActuals_([
    eLine('XXX_25_A', 'income', 1000, 2025, 8),
    eLine('XXX_25_A', 'expense', 30, 2025, 9),
    eLine('XXX_25_A', 'expense', 50, 2025, 10),
    eLine('XXX_25_A', 'expense', 40, 2025, 11),
    eLine('XXX_25_A', 'expense', -10, 2025, 12),
    eLine('XXX_25_B', 'income', 500, 2025, 8),
    eLine('XXX_25_C', 'expense', 10, 2025, 9)
  ], [eSheet('XXX_25_A', 'as spent', 100, 100), eSheet('XXX_25_B', '', 100, 100),
      eSheet('XXX_25_C', 'as spent', 100, 200)]);
  var earnedA = eOut.filter(function (l) { return l.fundingSource === 'XXX_25_A' && l.kind === 'income'; });
  check('earned: a marked sheet\'s invoice no longer counts as income',
    !earnedA.some(function (l) { return !l.earned; }));
  check('earned: income follows spend month by month, up to the grant',
    earnedA.map(function (l) { return l.amount; }).join(',') === '30,50,20,-10');
  check('earned: it lands on the project, source and milestone that spent it',
    earnedA[0].project === 'P' && earnedA[0].item === 'XXX_25_A_001');
  check('earned: an unmarked sheet keeps its invoice',
    eOut.filter(function (l) { return l.fundingSource === 'XXX_25_B' && l.kind === 'income'; })
      .map(function (l) { return l.amount; }).join(',') === '500');
  check('earned: a margin earns at the budget\'s income-to-cost ratio',
    eOut.filter(function (l) { return l.fundingSource === 'XXX_25_C' && l.kind === 'income'; })
      .map(function (l) { return l.amount; }).join(',') === '20');
  check('earned: spend lines pass through unchanged',
    eOut.filter(function (l) { return l.kind === 'expense'; }).length === 5);

  // A line is what its account says it is, as in Xero's P&L.
  var receipt = { kind: 'income', amount: 500, account: 'Salaries (477)' };
  check('account class: a receipt on an expense account lowers spend',
    byAccountClass_(receipt, 'EXPENSE').kind === 'expense' &&
    byAccountClass_(receipt, 'EXPENSE').amount === -500 && receipt.amount === 500);
  check('account class: a line on a balance-sheet account is set aside',
    byAccountClass_(receipt, 'LIABILITY').offPnl === true);
  check('account class: an unknown class leaves the line alone',
    byAccountClass_(receipt, '') === receipt);
  var jl = { LineAmount: -2000, Description: 'Release deferred revenue to 30 Sept',
    Tracking: [{ Name: CONFIG.XERO.PROJECT_TRACKING_CATEGORY, Option: 'P' },
               { Name: CONFIG.XERO.FUNDING_TRACKING_CATEGORY, Option: 'XXX_25_A' }] };
  var jIncome = journalLineToActual_(jl, d(2025, 9, 30), 'REVENUE', 'Grants (102)');
  check('journal: a credit to income is positive income, tagged and marked as a journal',
    jIncome.kind === 'income' && jIncome.amount === 2000 && jIncome.fundingSource === 'XXX_25_A' &&
    jIncome.journal === true);
  check('journal: a deferral (a debit to income) is negative income, so it nets out',
    journalLineToActual_({ LineAmount: 2000, Tracking: [] }, d(2025, 9, 30), 'REVENUE', 'Grants (102)')
      .amount === -2000);
  check('journal: a balance-sheet line is not an actual',
    journalLineToActual_(jl, d(2025, 9, 30), 'LIABILITY', 'Deferred revenue (850)') === null);
  var jNamed = journalLineToActual_(jl, d(2025, 9, 30), 'REVENUE', 'Grants (102)', 'Q1 release');
  check('journal: the line says which journal it came from',
    jNamed.docType === 'Manual journal' && jNamed.reference === 'Q1 release' &&
    jNamed.description === 'Release deferred revenue to 30 Sept');

  // A Health finding names the transaction, so every line carries its document.
  var bankLine = normaliseLine_({ Description: 'Monthly fee', LineAmount: 5, Tracking: [] },
    d(2026, 4, 22), 'expense', xeroDoc_('BankTransactions',
      { Type: 'SPEND', Reference: 'FEE', Contact: { Name: 'The Bank' } }));
  check('line: a bank line carries its document, contact and description',
    bankLine.docType === 'Spend money' && bankLine.reference === 'FEE' &&
    bankLine.contact === 'The Bank' && bankLine.description === 'Monthly fee');

  // GST: Xero's reports are net of it. LineAmount includes it only on a document entered
  // tax-inclusive, so only there does it come off.
  var gstLine = function (amount, tax, types) {
    return normaliseLine_({ LineAmount: amount, TaxAmount: tax, Tracking: [] },
      d(2026, 10, 5), 'expense', {}, types).amount;
  };
  check('GST: a tax-inclusive line counts without its GST',
    gstLine(115, 15, 'Inclusive') === 100);
  check('GST: tax-exclusive and no-tax lines count as they are',
    gstLine(100, 15, 'Exclusive') === 100 && gstLine(100, 0, 'NoTax') === 100 &&
    gstLine(100, 0, undefined) === 100);
  check('GST: a negative inclusive line stays negative, whichever sign its tax has',
    gstLine(-115, -15, 'Inclusive') === -100 && gstLine(-115, 15, 'Inclusive') === -100);
  check('GST: a tax-inclusive journal line counts without its GST',
    journalLineToActual_({ LineAmount: -2300, TaxAmount: -300, Tracking: [] },
      d(2025, 9, 30), 'REVENUE', 'Grants (102)', '', 'Inclusive').amount === 2000);
  var billDoc = xeroDoc_('Invoices', { Type: 'ACCPAY', InvoiceNumber: '', Reference: 'R-9' });
  check('line: a bill with no number falls back to its reference',
    billDoc.docType === 'Bill' && billDoc.reference === 'R-9' && billDoc.contact === '' &&
    xeroDoc_('Invoices', { Type: 'ACCREC', InvoiceNumber: 'INV-1' }).docType === 'Invoice' &&
    xeroDoc_('BankTransactions', { Type: 'RECEIVE-PREPAYMENT' }).docType === 'Receive money');

  // C8, D8 and D3 on the earned basis.
  function eHealth(sheets, lines) { return buildHealth(sheets, lines, {}); }
  var eSheets = [Object.assign(eSheet('XXX_25_A', 'spent', 100, 100), { lines: [{ cost: 100,
    income: 100, milestone: 'M', item: 'XXX_25_A_001' }] })];
  check('C8: an Income recognition it does not understand is flagged',
    eHealth(eSheets, []).some(function (f) { return f.id === 'C8'; }));
  var gSheets = [Object.assign(eSheet('XXX_25_G', '', 100, 100), { metadata: {
    'goes ahead': 'maybe' }, lines: [{ cost: 100, income: 100, milestone: 'M',
    item: 'XXX_25_G_001' }] })];
  check('C9: a Goes ahead it does not understand is flagged',
    eHealth(gSheets, []).some(function (f) { return f.id === 'C9'; }));
  var jFor = function (src) { return Object.assign({}, jIncome, { fundingSource: src }); };
  var unmarked = [Object.assign(eSheet('XXX_25_B', '', 100, 100), { lines: [{ cost: 100,
    income: 100, milestone: 'M', item: 'XXX_25_B_001' }] })];
  check('D8: Xero deferring an unmarked sheet\'s income is flagged',
    eHealth(unmarked, [jFor('XXX_25_B')]).some(function (f) { return f.id === 'D8'; }));
  var markedSheet = [Object.assign(eSheet('XXX_25_B', 'as spent', 100, 100), { lines: [{ cost: 100,
    income: 100, milestone: 'M', item: 'XXX_25_B_001' }] })];
  check('D8: quiet once the sheet is marked as spent',
    !eHealth(markedSheet, [jFor('XXX_25_B')]).some(function (f) { return f.id === 'D8'; }));
  // ---- the plan from today (CONFIG.PLAN_REMAINING) ------------------------------
  // One milestone budgeting 1,200 of cost and 2,400 of income over 2026, judged in July.
  function rSrc(forecast, lines) {
    var ls = lines || [{ description: 'Work', milestone: 'M', item: 'XXX_26_R_001 - M',
      project: 'P', start: d(2026, 1, 1), end: d(2026, 12, 31), cost: 1200, income: 2400 }];
    return { name: 'XXX_26_R', status: 'secured', metadata: {}, lines: ls, budgetLines: ls,
      forecast: forecast || { cost: {}, income: {} } };
  }
  function rAct(kind, amount, y, m) {
    return { date: d(y, m, 15), kind: kind, amount: amount, fundingSource: 'XXX_26_R',
      project: 'P', item: 'XXX_26_R_001' };
  }
  function rSum(lines, field, from, to) {
    var m = distributeByMonth_(lines, field);
    return Object.keys(m).reduce(function (t, k) {
      return (!from || k >= from) && (!to || k < to) ? t + m[k] : t; }, 0);
  }
  var rPlan = remainingPlan_([rSrc()], [rAct('expense', 300, 2026, 3), rAct('income', 600, 2026, 3)],
    '2026-07')[0].lines;
  check('plan from today: months gone are the actuals',
    Math.abs(rSum(rPlan, 'cost', null, '2026-07') - 300) < 0.01 &&
    Math.abs(rSum(rPlan, 'cost', '2026-03', '2026-04') - 300) < 0.01);
  check('plan from today: what is left of the budget is spread over the months left',
    Math.abs(rSum(rPlan, 'cost', '2026-07') - 900) < 0.01 &&
    Math.abs(rSum(rPlan, 'cost', '2026-12', '2027-01') - 900 * 31 / 184) < 0.5);
  check('plan from today: income follows the cost at the budget\'s ratio, within what is left',
    Math.abs(rSum(rPlan, 'income', '2026-07') - 1800) < 0.01);
  var rCapped = remainingPlan_([rSrc()], [rAct('expense', 300, 2026, 3), rAct('income', 2000, 2026, 3)],
    '2026-07')[0].lines;
  check('plan from today: income stops at the budgeted income',
    Math.abs(rSum(rCapped, 'income', '2026-07') - 400) < 0.01);
  var rTyped = remainingPlan_([planBudgets_([rSrc({ cost: { 'XXX_26_R_001||26/27 Q3': 500 },
    income: {}, rowQuarters: { cost: { XXX_26_R_001: ['26/27 Q2', '26/27 Q3'] }, income: {} } })])[0]],
    [rAct('expense', 300, 2026, 3)], '2026-07')[0].lines;
  check('plan from today: a typed Forecast row wins over what is left',
    Math.abs(rSum(rTyped, 'cost', '2026-10', '2027-01') - 500) < 0.01 &&
    Math.abs(rSum(rTyped, 'cost', '2026-07', '2026-10')) < 0.01);
  check('plan from today: income follows a typed cost forecast too',
    Math.abs(rSum(rTyped, 'income', '2026-07') - 1000) < 0.01);
  var rEnded = remainingPlan_([rSrc(null, [{ description: 'Done', milestone: 'M',
    item: 'XXX_26_R_001', project: 'P', start: d(2026, 1, 1), end: d(2026, 3, 31),
    cost: 1200, income: 1200 }])], [rAct('expense', 300, 2026, 2)], '2026-07')[0].lines;
  check('plan from today: a line already ended plans nothing more',
    rSum(rEnded, 'cost', '2026-07') === 0 && Math.abs(rSum(rEnded, 'cost') - 300) < 0.01);
  // The cap is the grant's: one milestone overspent, another finished underspent, and the
  // overspent one still draws on what is left of the whole grant. Capping per milestone
  // dropped the last of WW_25_TOI's income from the plan.
  var gLines = [
    { description: 'A', milestone: 'A', item: 'XXX_26_R_001', project: 'P',
      start: d(2026, 1, 1), end: d(2026, 12, 31), cost: 100, income: 100 },
    { description: 'B', milestone: 'B', item: 'XXX_26_R_002', project: 'P',
      start: d(2026, 1, 1), end: d(2026, 3, 31), cost: 100, income: 100 }];
  var gSrc = rSrc({ cost: { 'XXX_26_R_001||26/27 Q2': 50 }, income: {},
    rowQuarters: { cost: { XXX_26_R_001: ['26/27 Q2'] }, income: {} } }, gLines);
  var gPlan = remainingPlan_([planBudgets_([gSrc])[0]], [
    rAct('expense', 130, 2026, 4), rAct('income', 130, 2026, 4),
    { date: d(2026, 2, 15), kind: 'expense', amount: 20, fundingSource: 'XXX_26_R', project: 'P', item: 'XXX_26_R_002' },
    { date: d(2026, 2, 15), kind: 'income', amount: 20, fundingSource: 'XXX_26_R', project: 'P', item: 'XXX_26_R_002' }
  ], '2026-07')[0].lines;
  check('plan from today: an overspent milestone draws on what is left of the whole grant',
    Math.abs(rSum(gPlan, 'income', '2026-07') - 50) < 0.01);
  check('plan from today: and the grant\'s total is never passed',
    rSum(gPlan, 'income') <= 200 + 0.01);
  var rStray = remainingPlan_([rSrc()], [{ date: d(2026, 4, 10), kind: 'expense', amount: 75,
    fundingSource: 'XXX_26_R', project: 'P', item: '' }], '2026-07')[0].lines;
  check('plan from today: spend on no budgeted milestone stays in, as unassigned',
    rStray.some(function (l) { return l.milestone === '(unassigned)' && l.cost === 75; }));

  check('D3: a journal\'s expense line is not asked for a Product/Service',
    !eHealth([], [{ kind: 'expense', amount: 10, item: '', journal: true, fundingSource: '',
      project: 'P', date: d(2025, 9, 1) }]).some(function (f) { return f.id === 'D3'; }));

  Logger.log(results.join('\n'));
  return results;
}
