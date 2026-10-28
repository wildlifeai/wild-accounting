/**
 * Aggregator.js
 * Joins parsed budgets (from BudgetReader) with Xero actuals (from XeroClient)
 * and produces the snapshot the dashboard renders. This is where the confirmed
 * definitions live:
 *
 *   Secured forecast  = budgets in `secured/` folders only.
 *   Proposed forecast = `secured/` + `proposed/`.
 *   Prioritisation    = shortfall (budget − secured income) AND timing
 *                       (month secured income stops covering forecast spend).
 *
 * Project-level attribution of a funding source's expense uses each project's
 * day-weighted share of that source's operating expense, and the rollup allocates income
 * by the same share; the Overview breakdown credits income to each line's own project.
 * Each source's margin is General's, see marginRule_. Actuals come pre-split by Xero's
 * Projects tracking category, so actual numbers are exact, not approximated.
 */

/**
 * Funding sources archived in Drive, keyed by the name Xero still knows them by.
 *
 * Set once per refresh by buildSnapshot. Apps Script gives the whole project one global
 * scope, and this mirrors lastExclusionSummary() in XeroClient: a value established during
 * the crawl that half a dozen later passes need, without threading an extra argument
 * through six signatures that have nothing else to do with archiving.
 */
var ARCHIVED_SOURCE_NAMES = {};

function setArchivedSourceNames_(names) { ARCHIVED_SOURCE_NAMES = names || {}; }

/**
 * One definition of "this funding source is archived", because there were nine.
 *
 * Matches either the Xero tag carrying the prefix, which happens only if somebody renamed
 * the tracking option too, or the bare name appearing in the archived set built from Drive,
 * which is what actually happens.
 */
function isArchivedSource_(name) {
  const n = String(name == null ? '' : name);
  if (!n) return false;
  if (startsWith_(n, CONFIG.ARCHIVE_PREFIX)) return true;
  return ARCHIVED_SOURCE_NAMES[n] === true;
}

/**
 * The share of a funding source's income its Contribution policy expects to fund General.
 *
 * Since 2026-10-25 this moves no money: General takes each source's whole margin
 * (marginRule_), and the policy is the margin G1 expects. Only percent_of_income states a
 * rate. None states none, and so does a missing or unreadable policy: C6 reports those.
 */
function contributionRate_(src) {
  const raw = clean_(((src && src.metadata) || {})['contribution policy'] || '');
  const m = /^percent_of_income:(\d+(?:\.\d+)?)$/.exec(normalisePolicy_(raw));
  if (!m) return 0;
  const pct = parseFloat(m[1]);
  return pct > 0 && pct <= 100 ? pct / 100 : 0;
}

/** A line of General's own work, whichever sheet it is on. */
function isGeneralLine_(l) {
  return (l.project || CONFIG.DEFAULT_PROJECT) === CONFIG.GENERAL_PROJECT;
}

/**
 * How a source's margin reaches General: all of it, so every project nets to zero over a
 * source's life, and General keeps what the work leaves or covers what it overruns.
 *
 * The margin is the income on the source's lines not already General's, less their cost,
 * over the lines given: the plan, actuals to date and what is left, so it follows the work
 * as it turns out. It lands with the income, at the source's margin rate, so a project
 * still shows its spend running ahead of a tranche. A source with no such income has
 * nothing for it to ride on, so its loss lands with its cost instead. Null when there is
 * nothing to move.
 */
function marginRule_(src) {
  let income = 0, cost = 0;
  ((src && src.lines) || []).forEach(l => {
    if (isGeneralLine_(l)) return;
    income += Number(l.income) || 0;
    cost += Number(l.cost) || 0;
  });
  if (income > 0) return Math.abs(income - cost) < 0.005 ? null : { rate: (income - cost) / income };
  return cost ? { byCost: true } : null;
}

/** One line's margin to General, month by month: nothing for a line already General's. */
function lineMargin_(line, rule) {
  if (!rule || !line || isGeneralLine_(line)) return {};
  return rule.byCost ? scaleMap_(distributeByMonth_([line], 'cost'), -1)
    : scaleMap_(distributeByMonth_([line], 'income'), rule.rate);
}

/** Every source's margin rule, by name, from the plan, for the views that are not given it. */
function marginRules_(budgets) {
  const out = {};
  (budgets || []).forEach(src => { out[src.name] = marginRule_(src); });
  return out;
}

/** The milestone General's margin from one source appears under, in every view. */
function marginMilestone_(sourceName) { return sourceName + ' (margin)'; }

/** A map less another, key by key. */
function lessMap_(map, minus) {
  const out = Object.assign({}, map);
  Object.keys(minus || {}).forEach(k => { out[k] = (out[k] || 0) - minus[k]; });
  return out;
}

/** A milestone's name as two sheets are matched on it: trimmed, any case. */
function milestoneKey_(name) { return clean_(name || '').toLowerCase(); }

/**
 * The milestones of Reserves' own General lines, by milestoneKey_, each to its name as Reserves
 * spells it: what other sheets' lines are matched on.
 */
function reservesMilestones_(reserves) {
  const names = {};
  ((reserves && (reserves.budgetLines || reserves.lines)) || []).forEach(l => {
    const k = milestoneKey_(l.milestone);
    if (isGeneralLine_(l) && k && !names[k]) names[k] = clean_(l.milestone);
  });
  return names;
}

/**
 * The months Reserves holds each milestone's cost over, by milestoneKey_: { from, to } as
 * 'YYYY-MM', from its Budget tab's General lines, out to whole quarters. Other sheets' lines
 * come off Reserves only inside them: outside, Reserves holds nothing of that cost, so there
 * is nothing to net. Whole quarters, because a Forecast entry spreads over its quarter: a line
 * from 16 November still pays October's share of a payer's October to December entry.
 */
function reservesSpans_(reserves) {
  const spans = {};
  ((reserves && (reserves.budgetLines || reserves.lines)) || []).forEach(l => {
    const k = milestoneKey_(l.milestone);
    if (!isGeneralLine_(l) || !k || !l.start || !l.end) return;
    const from = DateMath.monthKey(quarterBounds_(qiOfDate_(l.start)).start);
    const to = DateMath.monthKey(quarterBounds_(qiOfDate_(l.end)).end);
    const s = spans[k] || (spans[k] = { from: from, to: to });
    if (from < s.from) s.from = from;
    if (to > s.to) s.to = to;
  });
  return spans;
}

/** The first and last day of a 'YYYY-MM' month. */
function monthBounds_(mk) {
  const p = mk.split('-');
  const start = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1);
  return { start: start, end: new Date(start.getFullYear(), start.getMonth() + 1, 0) };
}

/**
 * Reserves (CONFIG.RESERVES_SOURCE) holds the full cost of General's work, whoever pays for
 * it. A line on any other sheet tagged General, on a milestone Reserves also has, pays part of
 * that cost, so it comes off Reserves month by month, inside the months Reserves holds that
 * milestone over (reservesSpans_). The milestone's name is the match: no column on either
 * sheet says which line covers which.
 *
 * Returned as offsets rather than by changing Reserves' lines: one source per paying sheet,
 * named Reserves, holding that sheet's cost on those milestones as negative cost, with the
 * paying sheet's status, probability and Goes ahead. So an offset counts exactly where the
 * cost it mirrors does, in every view and on every runway line: a proposal takes nothing off
 * Reserves on the secured line and its probability's worth on the expected one, and organisation
 * totals stay at Reserves' full cost. A sheet whose cost another in its exclusivity group
 * carries takes nothing off. More paid than Reserves holds leaves Reserves negative, which H1
 * reports.
 *
 * From `fromKey` on only, the month the plan turns from actuals to what is left: before it,
 * each sheet's plan is what Xero coded to it, which already says who paid.
 */
function reservesOffsets_(budgets, exclusivityReps, fromKey) {
  const reserves = (budgets || []).filter(b => b.name === CONFIG.RESERVES_SOURCE)[0];
  const names = reservesMilestones_(reserves);
  if (!reserves || !Object.keys(names).length) return [];
  const spans = reservesSpans_(reserves);
  const out = [];
  budgets.forEach(src => {
    if (src.name === reserves.name || src.offsetFor) return;
    const meta = src.metadata || {};
    const group = clean_(meta[CONFIG.META.exclusivityGroup] || '');
    if (group && (exclusivityReps || {})[group] !== src.name) return;
    const lines = [];
    (src.lines || []).forEach(l => {
      const k = milestoneKey_(l.milestone);
      const mile = isGeneralLine_(l) && names[k];
      if (!mile) return;
      const span = spans[k] || { from: '', to: '' };
      const byMonth = distributeByMonth_([l], 'cost');
      Object.keys(byMonth).sort().forEach(mk => {
        if (!byMonth[mk] || (fromKey && mk < fromKey) || mk < span.from || mk > span.to) return;
        const m = monthBounds_(mk);
        // Under Reserves' own spelling, so it groups with Reserves' line by milestone.
        lines.push({ description: l.description, milestone: mile, item: '',
          project: CONFIG.GENERAL_PROJECT, start: m.start, end: m.end, cost: -byMonth[mk],
          income: 0, contribution: byMonth[mk] });
      });
    });
    if (!lines.length) return;
    const keep = {};
    [CONFIG.META.probability, CONFIG.META.goesAhead].forEach(k => {
      if (meta[k] !== undefined) keep[k] = meta[k];
    });
    out.push({ name: reserves.name, status: src.status, projectFolder: reserves.projectFolder,
      metadata: keep, forecast: { cost: {}, income: {}, comments: {} }, lines: lines,
      offsetFor: src.name });
  });
  return out;
}

/**
 * Months where other sheets pay more of a Reserves milestone than Reserves' full cost, every
 * proposal counted as won, for H1: [{ milestone, months: [{ month, full, paid }], by }].
 * `offsets` are reservesOffsets_ over the same `budgets`.
 */
function reservesOverPaid_(budgets, offsets) {
  const reserves = (budgets || []).filter(b => b.name === CONFIG.RESERVES_SOURCE)[0];
  if (!reserves || !(offsets || []).length) return [];
  const full = {}, paid = {}, label = {}, by = {};
  reserves.lines.forEach(l => {
    if (!isGeneralLine_(l) || !l.milestone) return;
    const k = milestoneKey_(l.milestone);
    label[k] = label[k] || l.milestone;
    addInto_(full[k] = full[k] || {}, distributeByMonth_([l], 'cost'));
  });
  offsets.forEach(o => o.lines.forEach(l => {
    const k = milestoneKey_(l.milestone);
    addInto_(paid[k] = paid[k] || {}, scaleMap_(distributeByMonth_([l], 'cost'), -1));
    (by[k] = by[k] || {})[o.offsetFor] = true;
  }));
  return Object.keys(paid).sort().map(k => {
    const months = Object.keys(paid[k]).sort()
      .filter(mk => paid[k][mk] - ((full[k] || {})[mk] || 0) >= 1)
      .map(mk => ({ month: mk, full: Math.round((full[k] || {})[mk] || 0),
        paid: Math.round(paid[k][mk]) }));
    return { milestone: label[k], months: months, by: Object.keys(by[k]).sort() };
  }).filter(o => o.months.length);
}

/**
 * A sheet's Income recognition, normalised: 'as spent', 'as invoiced' (also the blank
 * default) or 'unknown' for anything else, which C8 reports rather than guessing.
 */
function incomeRecognition_(src) {
  const raw = clean_(((src && src.metadata) || {})[CONFIG.META.incomeRecognition] || '')
    .toLowerCase().replace(/[\s_]+/g, ' ').trim();
  if (!raw || raw === 'as invoiced') return 'as invoiced';
  return raw === 'as spent' ? 'as spent' : 'unknown';
}

/**
 * A sheet's Goes ahead, normalised: 'regardless' (also the blank default), 'only if funded',
 * or 'unknown' for anything else, which C9 reports rather than guessing.
 */
function goesAhead_(src) {
  const raw = clean_(((src && src.metadata) || {})[CONFIG.META.goesAhead] || '')
    .toLowerCase().replace(/[\s_]+/g, ' ').trim();
  if (!raw || raw === 'regardless') return 'regardless';
  return raw === 'only if funded' ? 'only if funded' : 'unknown';
}

/**
 * True when a source's cost is spend only if it is funded: a proposed sheet marked "Goes
 * ahead: only if funded". Its cost then counts where its income counts, at the same weight:
 * not where only secured money counts, at its probability where expected money does, and in
 * full where every application lands. A secured source is funded, so it never is.
 */
function costIfFunded_(src) {
  return !!src && src.status === 'proposed' && goesAhead_(src) === 'only if funded';
}

/**
 * Income earned as it is spent, for sheets marked "Income recognition: as spent"
 * (CONFIG.ACTUALS_EARNED).
 *
 * A grant paid upfront is invoiced once and released by the accountant, quarter by
 * quarter, as the money is spent; the releases lag by up to a quarter. Rather than wait
 * for them, a marked sheet's income is its actual spend to date times its budget's
 * income-to-cost ratio, capped at its budgeted income. That is the accountant's own rule,
 * so it matches Xero at each release and stays current between them. The sheet's own
 * invoices, receipts and release journals are dropped, or the grant would count twice.
 *
 * Earned income lands on the same project, source and milestone as the spend that earned
 * it. A refund lowers it again; the cap holds it between zero and the grant.
 */
function earnedActuals_(actualLines, budgets) {
  const marked = {};
  (budgets || []).forEach(b => {
    if (incomeRecognition_(b) !== 'as spent') return;
    const cost = (b.lines || []).reduce((t, l) => t + (Number(l.cost) || 0), 0);
    const income = (b.lines || []).reduce((t, l) => t + (Number(l.income) || 0), 0);
    if (cost > 0) marked[b.name] = { ratio: income / cost, cap: income, earned: 0 };
  });

  const out = [], spend = [];
  (actualLines || []).forEach(l => {
    const m = marked[clean_(l.fundingSource || '')];
    if (m && l.kind !== 'expense') return;
    out.push(l);
    if (m) spend.push(l);
  });

  spend.sort((a, b) => new Date(a.date) - new Date(b.date));
  spend.forEach(l => {
    const m = marked[clean_(l.fundingSource || '')];
    const target = Math.min(m.cap, Math.max(0, m.earned + (Number(l.amount) || 0) * m.ratio));
    const amount = target - m.earned;
    if (!amount) return;
    m.earned = target;
    out.push({ date: l.date, account: '(earned as spent)', project: l.project,
      fundingSource: l.fundingSource, item: l.item, itemName: l.itemName || '',
      amount: amount, kind: 'income', earned: true });
  });
  return out;
}

/**
 * What moving each source's margin to General moves between projects, per source and per
 * (status, project), without changing anything, beside what its Contribution policy
 * expects. The Overview credits income to each line's own project, so this does the same:
 * a dry run reports what the breakdown will show.
 */
function marginMoves_(budgets) {
  const sources = [], moves = {};
  const total = m => Object.keys(m).reduce((t, k) => t + m[k], 0);
  (budgets || []).forEach(src => {
    const rule = marginRule_(src);
    const rate = contributionRate_(src);
    let toGeneral = 0, policyShare = 0;
    (src.lines || []).forEach(l => {
      if (!isGeneralLine_(l)) policyShare += (Number(l.income) || 0) * rate;
      const c = total(lineMargin_(l, rule));
      if (!c) return;
      toGeneral += c;
      const from = src.status + '||' + (l.project || CONFIG.DEFAULT_PROJECT);
      const to = src.status + '||' + CONFIG.GENERAL_PROJECT;
      moves[from] = (moves[from] || 0) - c;
      moves[to] = (moves[to] || 0) + c;
    });
    sources.push({ name: src.name, status: src.status, rule: rule, toGeneral: toGeneral,
      policyShare: policyShare,
      policy: clean_(((src.metadata) || {})['contribution policy'] || '') });
  });
  return { sources: sources, moves: moves };
}

function buildSnapshot() {
  const now = new Date();
  const fy = fyBounds_(now);
  // Before any actual is bucketed: every pass below asks isArchivedSource_ about a tag.
  setArchivedSourceNames_(readArchivedSourceNames());

  // The folder walk is not free: measured at ~13s of a ~60s refresh, because DriveApp
  // folder and file iterators are slow even though nothing is opened yet.
  setRefreshProgress_('Finding budget sheets', 0, 0, 2);
  const budgets = readAllBudgets();
  // What is expected when: the Forecast tab where one was written, the Budget tab where
  // not (planBudgets_). The Budget tab itself stays the baseline, so the tracking grid and
  // the health checks keep the sheets' own lines and only gain the resolved forecast.
  const forecastPlan = CONFIG.PLAN_FROM_FORECAST ? planBudgets_(budgets) : budgets;
  const judged = CONFIG.PLAN_FROM_FORECAST
    ? budgets.map(b => Object.assign({}, b, { forecast: ownedForecast_(b.forecast) }))
    : budgets;
  const actualSince = earliestBudgetStart_(budgets);
  // On the earned basis, actuals follow Xero's P&L (journals included), and a sheet marked
  // "as spent" earns its income as it spends rather than when it was invoiced.
  const earnedBasis = !!CONFIG.ACTUALS_EARNED;
  const fetched = isXeroConnected() ? fetchXeroActuals(actualSince, { earned: earnedBasis }) : [];
  const actualLines = earnedBasis ? earnedActuals_(fetched, budgets) : fetched;
  // From today: actuals for months gone, what is left of each milestone for months to come.
  const planned = CONFIG.PLAN_REMAINING
    ? remainingPlan_(forecastPlan, actualLines, DateMath.monthKey(now)) : forecastPlan;
  setRefreshProgress_('Aggregating ' + actualLines.length + ' actual line(s)', 0, 0, 90);

  // Competing applications for the same work share an Exclusivity group, and only one
  // member of each group carries the cost. See chooseExclusivityReps_.
  const exclusivityReps = chooseExclusivityReps_(budgets);
  // Reserves holds General's full cost; what other sheets pay of it comes off, in the views
  // that count money (reservesOffsets_). Project tracking nets its own (netReservesTracking_).
  const offsets = reservesOffsets_(planned, exclusivityReps,
    CONFIG.PLAN_REMAINING ? DateMath.monthKey(now) : null);
  const counted = planned.concat(offsets);
  const agg = aggregateBudgets_(counted, fy, exclusivityReps);
  const projects = agg.projects;             // name -> rollup accumulator
  const fundingSources = agg.fundingSources; // per-source summary
  const budgetByKey = agg.budgetByKey;       // 'project||source||milestone' -> entry
  const sourceStatus = agg.sourceStatus;     // source name -> 'secured' | 'proposed'
  const itemToMilestone = agg.itemToMilestone; // 'source||itemCode' -> milestone name
  const costSuppressed = agg.costSuppressed; // source -> the source carrying its cost
  const dataFlags = [];
  const actualByKey = {}; // 'project||source||milestone' -> actual expense
  const actualByKeyFY = {}; // 'project||source||milestone' -> FY actual expense
  const actualByKeyQ = {}; // 'project||source||milestone' -> { quarter label -> actual }
  const quartersSeen = {};    // quarter label -> true, for the Overview's FY selector

  // Actuals can name a project no budget does, so the rollup still grows here.
  function project_(name) {
    return projects[name] || (projects[name] = newProjectRollup_(name));
  }

  // Actuals from Xero, split by project, funding-source, and milestone.
  actualLines.forEach(l => {
    if (l.kind !== 'expense') return;
    if (!l.project || startsWith_(l.project, CONFIG.ARCHIVE_PREFIX)) return;
    // An archived source's budget file is skipped by the crawl (collectStatusFolder_),
    // so keeping its actuals guaranteed a mismatch: spend with no budget beside it,
    // inflating org actuals and making the whole organisation look overspent.
    // buildTimeline_ already filtered both, so the two views disagreed.
    if (isArchivedSource_(l.fundingSource)) return;
    const p = project_(l.project);
    p.actualExpense += l.amount;
    
    const isFY = (new Date(l.date) >= fy.start && new Date(l.date) <= fy.end);
    if (isFY) p.actualExpenseFY += l.amount;

    const fs = l.fundingSource || '(unassigned)';
    // Map actual to milestone via item code lookup
    const code = itemCode_(l.item);
    const mile = (code && itemToMilestone[fs + '||' + code]) || '(unassigned)';
    const akey = l.project + '||' + fs + '||' + mile;
    actualByKey[akey] = (actualByKey[akey] || 0) + l.amount;
    if (isFY) actualByKeyFY[akey] = (actualByKeyFY[akey] || 0) + l.amount;

    // Actuals bucketed by the FY quarter the transaction falls in, so any financial
    // year can be shown, not only the current one.
    const q = quarterOfMonthKey_(DateMath.monthKey(new Date(l.date)));
    if (q) {
      if (!actualByKeyQ[akey]) actualByKeyQ[akey] = {};
      actualByKeyQ[akey][q] = (actualByKeyQ[akey][q] || 0) + l.amount;
    }
  });

  // Every quarter any budget or actual touches. Drives the Overview's FY selector, so
  // it offers only years there is something to show.
  Object.keys(budgetByKey).forEach(k => {
    Object.keys(budgetByKey[k].budgetByQ).forEach(q => (quartersSeen[q] = true));
    Object.keys(budgetByKey[k].incomeByQ).forEach(q => (quartersSeen[q] = true));
  });
  Object.keys(actualByKeyQ).forEach(k => {
    Object.keys(actualByKeyQ[k]).forEach(q => (quartersSeen[q] = true));
  });
  const quarters = Object.keys(quartersSeen)
    .sort((a, b) => quarterSortNum(a) - quarterSortNum(b));

  const breakdownRows = buildBreakdownRows_(budgetByKey, actualByKey, actualByKeyFY,
                                            actualByKeyQ, sourceStatus);

  // Project tracking grid (baseline + actual per funding source / milestone /
  // quarter). Forecast is layered on at view time from the live Forecast sheet,
  // so GM edits show immediately without a full refresh.
  const tracking = netReservesTracking_(
    buildTracking_(judged, actualLines, marginRules_(planned)));

  // Project tracking timeline: the months each milestone's funding runs, by source.
  const timeline = buildTimeline_(planned);

  // For the accountant's close, on the Health tab: grant income to release or defer, and
  // spend expected but not in Xero. Before the runway, because the reserves Xero gives need
  // the releases still to post.
  const quarterClose = buildQuarterClose_(judged, earnedBasis ? fetched : [], actualLines,
    tracking, quarterSortNum(currentQuarterLabel(now)));

  // Runway: cumulative income against cumulative spend, month by month, starting from the
  // reserves on Cockpit Settings, whose last quarter-end row the refresh writes from Xero.
  const runway = buildRunway_(counted, actualLines, now, exclusivityReps, itemToMilestone,
    readReserves_(now, quarterClose));

  // Per-project rollups (feed the summary cards / org totals).
  const rows = Object.keys(projects).map(name => {
    const p = projects[name];
    return {
      project: name,
      proposedBudget: round_(p.proposedBudget),
      securedIncome: round_(p.securedIncome),
      actualExpense: round_(p.actualExpense),
      unsecuredGap: round_(Math.max(0, p.proposedBudget - p.securedIncome)),
      weightedIncome: round_(p.weightedIncome),
      proposedBudgetFY: round_(p.proposedBudgetFY),
      securedIncomeFY: round_(p.securedIncomeFY),
      actualExpenseFY: round_(p.actualExpenseFY),
      unsecuredGapFY: round_(Math.max(0, p.proposedBudgetFY - p.securedIncomeFY)),
      weightedIncomeFY: round_(p.weightedIncomeFY)
    };
  });

  // fy and now are already defined at the top
  const coverage = {
    today: now.toISOString(),
    // The page shows dates in the script's zone, not the viewer's: the FY starts at
    // midnight 1 April in Auckland, which in UTC is still 31 March.
    timeZone: typeof Session !== 'undefined' ? Session.getScriptTimeZone() : 'Pacific/Auckland',
    fyLabel: fy.label,
    fyStart: fy.start.toISOString(),
    fyEnd: fy.end.toISOString(),
    forecastStart: isoOrNull_(earliestBudgetStart_(planned)),
    forecastEnd: isoOrNull_(latestBudgetEnd_(planned))
  };

  // Health findings. `dataFlags` was declared and never populated, so the warning
  // area on the dashboard had never shown anything; it is now the error/warning
  // summary of `health`.
  const xeroOk = isXeroConnected();
  const secretsMissing = ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'].filter(k => !getSecret(k));
  const health = buildHealth(judged, actualLines, {
    now: now,
    xeroConnected: xeroOk,
    exclusion: lastExclusionSummary(),
    unposted: lastUnpostedSummary(),
    secretsMissing: secretsMissing,
    // F4: the connection predates the reports scope, so reserves could not be read.
    reservesIssue: lastReservesIssue(),
    // So G3 can name which source had its cost suppressed and which carries it instead.
    exclusivity: { reps: exclusivityReps, suppressed: costSuppressed },
    // H1: months other sheets pay more of a Reserves milestone than its full cost.
    reservesOverPaid: reservesOverPaid_(planned, offsets)
  });

  return {
    generatedAt: now.toISOString(),
    xeroConnected: xeroOk,
    currentQuarter: currentQuarterLabel(),
    // 'remaining' when the plan is actuals to date plus what is left (CONFIG.PLAN_REMAINING),
    // so the Overview calls its cost card expected cost rather than forecast budget.
    planBasis: CONFIG.PLAN_REMAINING ? 'remaining' : 'forecast',
    // Every FY quarter any budget or actual touches, oldest first. The Overview's FY
    // selector is built from these, so it only offers years with something in them.
    quarters: quarters,
    // Which source carries the cost in each exclusivity group, and which had theirs
    // suppressed as a result. Health check G3 turns this into a visible finding, because
    // a silently suppressed cost is exactly the kind of invisible arithmetic this
    // dashboard exists to stop.
    exclusivity: { reps: exclusivityReps, suppressed: costSuppressed },
    coverage: coverage,
    totals: orgTotals_(rows),
    projects: rows,
    fundingSources: fundingSources,
    breakdownRows: breakdownRows,
    tracking: tracking,
    timeline: timeline,
    runway: runway,
    quarterClose: quarterClose,
    health: health,
    dataFlags: dataFlags.concat(healthToFlags(health))
  };
}

/**
 * What the accountant needs at a quarter close, for every finished quarter.
 *
 * `releases`: each grant marked "as spent", by project and quarter, with its spend, the
 * income it earned by the cockpit's rule (earnedActuals_, so `actualLines` must be on the
 * earned basis) and the income Xero's P&L shows for it (`xeroLines`, the lines as fetched).
 * Earned to a quarter's end minus Xero's to the same end is the journal still to post:
 * positive releases income received in advance, negative defers it. Cumulative, not one
 * quarter's difference, so a release missed or posted short shows again until it is right.
 *
 * `accruals`: milestones on secured sheets whose spend in a finished quarter fell short of
 * what the grid expected for it (forecastOrBaseline_) by CONFIG.ACCRUAL_MIN_SHORTFALL or
 * more, with the Forecast comment. Either work done and not yet billed, to accrue, or work
 * that slipped, to move on the Forecast tab: the comment is what tells them apart.
 */
function buildQuarterClose_(budgets, xeroLines, actualLines, tracking, currentQi) {
  const asSpent = {};
  (budgets || []).forEach(b => { if (incomeRecognition_(b) === 'as spent') asSpent[b.name] = true; });
  const quarterOf = l => quarterOfMonthKey_(DateMath.monthKey(new Date(l.date)));
  const finished = q => qiOfLabel_(q) < currentQi;

  const rel = {};
  function cell(l) {
    const project = l.project || '(no project)';
    const k = clean_(l.fundingSource) + '||' + project;
    const r = rel[k] || (rel[k] = { source: clean_(l.fundingSource), project: project, byQ: {} });
    const q = quarterOf(l);
    return r.byQ[q] || (r.byQ[q] = { spend: 0, earned: 0, xero: 0 });
  }
  (actualLines || []).forEach(l => {
    if (!asSpent[clean_(l.fundingSource || '')]) return;
    if (l.kind === 'expense') cell(l).spend += Number(l.amount) || 0;
    else if (l.earned) cell(l).earned += Number(l.amount) || 0;
  });
  (xeroLines || []).forEach(l => {
    if (!asSpent[clean_(l.fundingSource || '')] || l.kind === 'expense') return;
    cell(l).xero += Number(l.amount) || 0;
  });
  const releases = Object.keys(rel).sort().map(k => {
    const r = rel[k];
    Object.keys(r.byQ).forEach(q => {
      const c = r.byQ[q];
      r.byQ[q] = { spend: Math.round(c.spend), earned: Math.round(c.earned),
        xero: Math.round(c.xero) };
    });
    return r;
  });

  const accruals = [];
  (tracking || []).forEach(t => {
    if (t.status !== 'secured') return;
    (t.milestones || []).forEach(m => {
      if (m.actualOnly) return;
      const qs = {};
      [m.baseline, m.costForecast].forEach(map => Object.keys(map || {}).forEach(q => (qs[q] = true)));
      Object.keys(qs).filter(finished).forEach(q => {
        const expected = Math.round(forecastOrBaseline_(m.costForecast, m.baseline, q));
        const actual = Math.round((m.actual || {})[q] || 0);
        if (expected - actual < CONFIG.ACCRUAL_MIN_SHORTFALL) return;
        accruals.push({ quarter: q, source: t.source, project: m.project,
          milestone: m.milestone, expected: expected, actual: actual,
          comment: m.forecastComment || '', sheetUrl: t.sheetUrl || null });
      });
    });
  });
  accruals.sort((a, b) => (b.expected - b.actual) - (a.expected - a.actual));

  // Finished quarters with anything to show, latest first: the page opens on the latest.
  const seen = {};
  releases.forEach(r => Object.keys(r.byQ).forEach(q => (seen[q] = true)));
  accruals.forEach(a => (seen[a.quarter] = true));
  const quarters = Object.keys(seen).filter(finished)
    .sort((a, b) => qiOfLabel_(b) - qiOfLabel_(a));

  return { quarters: quarters, releases: releases, accruals: accruals };
}

/**
 * Budgets -> the per-project rollup and the (project, source, milestone) entries the
 * Overview is built from. Pure over its inputs, so the arithmetic deciding which project
 * is credited with which money can be tested without Drive or Xero. It used to run inline
 * in buildSnapshot, where no test could reach it.
 */
function aggregateBudgets_(budgets, fy, exclusivityReps) {
  const projects = {};        // name -> rollup accumulator
  const fundingSources = [];  // per-source summary
  const budgetByKey = {};     // 'project||source||milestone' -> { budget, income, status }
  const sourceStatus = {};    // source name -> 'secured' | 'proposed'
  const itemToMilestone = {}; // 'source||itemCode' -> milestone name
  const costSuppressed = {};  // source name -> the source that carries the cost instead
  function project_(name) {
    return projects[name] || (projects[name] = newProjectRollup_(name));
  }

  budgets.forEach(src => {
    // An offset (reservesOffsets_) is Reserves' cost less what one other sheet pays of it.
    // Its entries key apart from Reserves' own, to keep that sheet's status, and it is no
    // funding source of its own.
    const offset = src.offsetFor ? '||less ' + src.offsetFor : '';
    const group = clean_((src.metadata || {})[CONFIG.META.exclusivityGroup] || '');
    const rep = group ? exclusivityReps[group] : null;
    // A non-representative still contributes its ask, just not the work behind it.
    const carriesCost = !group || rep === src.name;
    if (!carriesCost) costSuppressed[src.name] = { group: group, countedIn: rep };
    const costFactor = carriesCost ? 1 : 0;
    const probability = sourceProbability_(src.status, src.metadata);
    const ifFunded = costIfFunded_(src);

    // Per-line project attribution is handled in BudgetReader: a line uses its
    // `Project` value when set, otherwise the parent project folder. Falling back
    // to the folder is expected, so it is not flagged here.
    const fc = computeFundingSourceForecast(src.lines);
    const shares = projectExpenseShares_(src.lines); // {project: 0..1}

    const expenseFY = sumMonthsInFY_(fc.expenseByMonth, fy);
    const incomeFY = sumMonthsInFY_(fc.incomeByMonth, fy);
    // This FY's figures split by this FY's cost, not the whole life's: a source running two
    // years can spend on one project in the first and another in the second.
    const sharesFY = expenseFY ? projectExpenseShares_(src.lines, fy) : shares;

    // This source's margin, which is General's: see marginRule_.
    const rule = marginRule_(src);
    const margin = {};
    src.lines.forEach(l => addInto_(margin, lineMargin_(l, rule)));
    const marginTotal = Object.keys(margin).reduce((t, k) => t + margin[k], 0);
    const marginFY = sumMonthsInFY_(margin, fy);

    // Income into a project's rollup, in every form the rollup keeps. Expected income:
    // secured counts in full, proposed at its stated probability. A proposed source with
    // no probability contributes nothing here rather than being guessed at, and check G2
    // asks for the number.
    const creditIncome = (p, inc, incFY) => {
      p.proposedIncome += inc;
      p.proposedIncomeFY += incFY;
      if (src.status === 'secured') {
        p.securedIncome += inc;
        p.securedIncomeFY += incFY;
      }
      if (probability !== null) {
        p.weightedIncome += inc * probability;
        p.weightedIncomeFY += incFY * probability;
      }
    };

    // Project-level rollups, for the org totals and a project lead's totals. Income
    // follows the cost share, and the margin moves from the other projects to General, each
    // giving up its part by its share of the cost off General.
    const otherOf = s => Object.keys(s).reduce((t, pName) =>
      pName === CONFIG.GENERAL_PROJECT ? t : t + s[pName], 0);
    const otherShare = otherOf(shares), otherShareFY = otherOf(sharesFY);
    Object.keys(shares).forEach(pName => {
      const share = shares[pName], shareFY = sharesFY[pName] || 0;
      const p = project_(pName);
      const out = pName === CONFIG.GENERAL_PROJECT || !otherShare ? 0 : share / otherShare;
      const outFY = pName === CONFIG.GENERAL_PROJECT ? 0 :
        otherShareFY ? shareFY / otherShareFY : out;
      p.proposedBudget += fc.totalBudgetExpense * share * costFactor;
      p.proposedBudgetFY += expenseFY * shareFY * costFactor;
      creditIncome(p, fc.totalBudgetIncome * share - marginTotal * out,
        incomeFY * shareFY - marginFY * outFY);
    });
    if (marginTotal || marginFY) {
      creditIncome(project_(CONFIG.GENERAL_PROJECT), marginTotal, marginFY);
    }

    // Build budgetByKey at (project, source, milestone) granularity.
    // Each budget line carries its own cost, income, milestone, and project.
    src.lines.forEach(l => {
      const pName = l.project || CONFIG.DEFAULT_PROJECT;
      const mile = l.milestone || '(unassigned)';
      const bkey = pName + '||' + src.name + '||' + mile + offset;

      // Build item-to-milestone lookup for actuals mapping
      const code = itemCode_(l.item);
      if (code) itemToMilestone[src.name + '||' + code] = mile;

      // Day-weighted FY portion for this single line
      const lineCostByMonth = distributeByMonth_([l], 'cost');
      const lineIncByMonth = distributeByMonth_([l], 'income');
      const lineCostFY = sumMonthsInFY_(lineCostByMonth, fy);

      const entry = budgetByKey[bkey] || (budgetByKey[bkey] = newBudgetEntry_(src.status));
      // costFactor is 0 when a competing application in the same exclusivity group carries
      // the work. The ask still shows; the work is counted once, on the representative.
      entry.budget += l.cost * costFactor;
      entry.budgetFY += lineCostFY * costFactor;
      // Per-quarter as well as per-FY, so the Overview can be shown for any financial
      // year rather than only the current one. The day-weighted month buckets already
      // exist; bucketToQuarters just folds them into FY quarters.
      addInto_(entry.budgetByQ, scaleMap_(bucketToQuarters(lineCostByMonth), costFactor));
      // Work that goes ahead only if funded is expected at the ask's probability, as its
      // income is; a missing probability counts as none, as it does for the income (G2).
      if (ifFunded) {
        entry.ifFunded = true;
        addInto_(entry.weightedCostByQ, scaleMap_(bucketToQuarters(lineCostByMonth),
          costFactor * (probability || 0)));
      }

      // The margin on this line is General's, and shows under General as this source's
      // margin; the project keeps the rest of the line's income. lineMargin_ is what the dry
      // run uses, so what it reports is what this does.
      const lineToGeneral = lineMargin_(l, rule);
      const moved = Object.keys(lineToGeneral).reduce((t, k) => t + lineToGeneral[k], 0);
      creditLineIncome_(entry, l, lessMap_(lineIncByMonth, lineToGeneral),
        (Number(l.income) || 0) - moved, fy, probability);
      if (Object.keys(lineToGeneral).length) {
        const gkey = CONFIG.GENERAL_PROJECT + '||' + src.name + '||' + marginMilestone_(src.name);
        const g = budgetByKey[gkey] || (budgetByKey[gkey] = newBudgetEntry_(src.status));
        creditLineIncome_(g, l, lineToGeneral, moved, fy, probability);
      }

      if (!entry.comment && code && src.forecast && src.forecast.comments) {
        entry.comment = src.forecast.comments[code] || '';
      }
    });

    if (offset) return;
    sourceStatus[src.name] = src.status;
    fundingSources.push({ name: src.name, status: src.status,
      project: src.projectFolder, budgetExpense: fc.totalBudgetExpense,
      budgetIncome: fc.totalBudgetIncome,
      probability: probability, exclusivityGroup: group || '',
      carriesCost: carriesCost,
      link: clean_((src.metadata || {})[CONFIG.META.link] || '') });
  });

  return { projects: projects, fundingSources: fundingSources, budgetByKey: budgetByKey,
    sourceStatus: sourceStatus, itemToMilestone: itemToMilestone,
    costSuppressed: costSuppressed };
}

function newProjectRollup_(name) {
  return { name: name, proposedBudget: 0, securedIncome: 0,
    proposedIncome: 0, actualExpense: 0, weightedIncome: 0,
    proposedBudgetFY: 0, securedIncomeFY: 0, proposedIncomeFY: 0, actualExpenseFY: 0,
    weightedIncomeFY: 0 };
}

function newBudgetEntry_(status) {
  return { budget: 0, income: 0, status: status, budgetFY: 0, incomeFY: 0,
    budgetByQ: {}, incomeByQ: {}, weightedByQ: {}, weightedCostByQ: {}, ifFunded: false,
    comment: '', start: null, end: null };
}

/**
 * Credit income from one budget line to an entry, in every form it keeps: `total`, and from
 * `incByMonth` this FY, by quarter, and expected. One function, so the part a project keeps
 * and the part General receives cannot be computed two different ways. The total is passed
 * rather than summed from the months, which day-weighting leaves a fraction of a cent off.
 */
function creditLineIncome_(entry, l, incByMonth, total, fy, probability) {
  const byQ = bucketToQuarters(incByMonth);
  entry.income += total;
  entry.incomeFY += sumMonthsInFY_(incByMonth, fy);
  addInto_(entry.incomeByQ, byQ);
  if (probability !== null) addInto_(entry.weightedByQ, scaleMap_(byQ, probability));
  if (l.start && (!entry.start || l.start < new Date(entry.start)))
    entry.start = isoOrNull_(l.start);
  if (l.end && (!entry.end || l.end > new Date(entry.end)))
    entry.end = isoOrNull_(l.end);
}

/**
 * Finest-grain rows for the Overview breakdown: one per (project, funding source,
 * milestone) with budget (forecast spend), secured funding (income on secured
 * sources only), and actual spend. The UI groups these by any combination of
 * project / funding source / status / milestone. Built from the union of budget
 * and actual keys so spend that has no matching budget line still shows up.
 */
function buildBreakdownRows_(budgetByKey, actualByKey, actualByKeyFY, actualByKeyQ,
                             sourceStatus) {
  const keys = {};
  Object.keys(budgetByKey).forEach(k => (keys[k] = true));
  Object.keys(actualByKey).forEach(k => (keys[k] = true));

  return Object.keys(keys).map(key => {
    const parts = key.split('||');
    const project = parts[0];
    const source = parts[1];
    const milestone = parts[2] || '(unassigned)';
    const b = budgetByKey[key] || { budget: 0, income: 0, budgetFY: 0, incomeFY: 0,
      budgetByQ: {}, incomeByQ: {}, weightedByQ: {}, comment: '',
      start: null, end: null };
    const status = (b.status || sourceStatus[source] || 'unknown');
    // Work that goes ahead only if funded: its cost is expected at its probability and
    // committed not at all, so the Overview's gaps judge it as they judge its income.
    const ifFunded = b.ifFunded
      ? { ifFunded: true, weightedCostByQ: roundMapValues_(b.weightedCostByQ || {}) } : {};
    return Object.assign({
      project: project,
      fundingSource: source,
      milestone: milestone,
      status: status,
      budget: round_(b.budget || 0),
      secured: round_(status === 'secured' ? (b.income || 0) : 0),
      actual: round_(actualByKey[key] || 0),
      budgetFY: round_(b.budgetFY || 0),
      securedFY: round_(status === 'secured' ? (b.incomeFY || 0) : 0),
      actualFY: round_(actualByKeyFY[key] || 0),
      // Per-quarter, so the client can total any financial year. Secured mirrors income
      // for secured sources and is empty otherwise, matching the scalar above.
      budgetByQ: roundMapValues_(b.budgetByQ || {}),
      securedByQ: status === 'secured' ? roundMapValues_(b.incomeByQ || {}) : {},
      actualByQ: roundMapValues_(actualByKeyQ[key] || {}),
      // Secured in full plus proposed at its probability. What we expect to have, as
      // opposed to what is committed.
      weightedByQ: roundMapValues_(b.weightedByQ || {}),
      comment: b.comment || '',
      start: b.start || null,
      end: b.end || null
    }, ifFunded);
  });
}

/** Add every value of `src` into `dst`, in place. */
function addInto_(dst, src) {
  Object.keys(src || {}).forEach(k => { dst[k] = (dst[k] || 0) + src[k]; });
  return dst;
}

/** Scale every value of a map by `f`, returning a new map. */
function scaleMap_(map, f) {
  const out = {};
  Object.keys(map || {}).forEach(k => { out[k] = map[k] * f; });
  return out;
}

/**
 * Chance a source's income actually arrives, as 0..1.
 *
 * Secured means the money is committed, so it is always 1 whatever the sheet says.
 * A proposed source with no Probability returns null: that is "unknown", not "zero", and
 * the caller must not silently treat it as either. Check G2 reports it.
 *
 * Accepts "40", "40%", 40 or 0.4. Anything at or below 1 is read as a fraction, so 0.4
 * and 40% mean the same thing. 1 is therefore certainty, not one percent.
 */
function sourceProbability_(status, metadata) {
  if (status === 'secured') return 1;
  const raw = (metadata || {})[CONFIG.META.probability];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = parseFloat(String(raw).replace('%', '').trim());
  if (isNaN(n) || n < 0) return null;
  const p = n > 1 ? n / 100 : n;
  return Math.min(1, p);
}

/**
 * Decide which source carries the cost in each exclusivity group.
 *
 * A group is one piece of work that several applications are chasing. Counting every
 * member's cost would multiply the work: two parallel asks for one $48,000 role would put
 * $96,000 of budget on the organisation. So exactly one member carries it.
 *
 * Secured wins, because once an application lands that is the money being spent. Otherwise
 * the largest cost wins, since a budget should not understate the work. Name breaks ties so
 * the choice is stable between refreshes rather than depending on Drive's ordering.
 *
 * @return {Object} group label -> source name that carries the cost
 */
function chooseExclusivityReps_(budgets) {
  const groups = {};
  (budgets || []).forEach(src => {
    const label = clean_((src.metadata || {})[CONFIG.META.exclusivityGroup] || '');
    if (!label) return;
    const cost = (src.lines || []).reduce((a, l) => a + (l.cost || 0), 0);
    const cand = { name: src.name, secured: src.status === 'secured', cost: cost };
    const best = groups[label];
    if (!best ||
        (cand.secured && !best.secured) ||
        (cand.secured === best.secured && cand.cost > best.cost) ||
        (cand.secured === best.secured && cand.cost === best.cost && cand.name < best.name)) {
      groups[label] = cand;
    }
  });
  const reps = {};
  Object.keys(groups).forEach(label => { reps[label] = groups[label].name; });
  return reps;
}

/**
 * The timeline for Project tracking: for each (project, milestone) pair, the funding
 * sources paying for it, each with its status and the months its budget lines run from
 * and to. composeProjectTracking turns those into each bar's first and last quarter;
 * amounts come from the tracking entries, not from here. A line counts toward the
 * project it names, not the folder its sheet sits in.
 */
function buildTimeline_(budgets) {
  const byProjMile = {}; // 'project||milestone' -> { project, milestone, segments }

  budgets.forEach(src => {
    src.lines.forEach(l => {
      const pName = l.project || CONFIG.DEFAULT_PROJECT;
      const mile = l.milestone || '(unassigned)';
      const pmKey = pName + '||' + mile;
      if (!byProjMile[pmKey]) byProjMile[pmKey] = { project: pName, milestone: mile, segments: [] };
      byProjMile[pmKey].segments.push({
        source: src.name,
        status: src.status,
        start: l.start ? DateMath.monthKey(l.start) : null,
        end: l.end ? DateMath.monthKey(l.end) : null
      });
    });
  });

  // General's margins: one row per source with one, running the months its margin lands
  // in, from lines not already on General.
  budgets.forEach(src => {
    const rule = marginRule_(src);
    const monthly = {};
    src.lines.forEach(l => addInto_(monthly, lineMargin_(l, rule)));
    const months = Object.keys(monthly).filter(k => monthly[k]).sort();
    if (!months.length) return;
    const mile = marginMilestone_(src.name);
    byProjMile[CONFIG.GENERAL_PROJECT + '||' + mile] = {
      project: CONFIG.GENERAL_PROJECT, milestone: mile,
      segments: [{ source: src.name, status: src.status, start: months[0],
        end: months[months.length - 1] }]
    };
  });

  return Object.keys(byProjMile).map(key => {
    const entry = byProjMile[key];
    entry.segments.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    return entry;
  }).sort((a, b) => a.project.localeCompare(b.project) || a.milestone.localeCompare(b.milestone));
}

/**
 * Round every value, and preserve the total while doing it.
 *
 * Rounding each entry independently drifts: a $12,000 line day-weighted across four
 * quarters gives four values near x.5, which round to $12,001 (INVENTED-OK). Consumers
 * maps then shows a total a few dollars off the budget it came from, and nobody can
 * explain the difference.
 *
 * Largest remainder: round everything, then push the shortfall onto the entries whose
 * fractions sat closest to the boundary, so the map always sums to its unrounded total.
 */
function roundMapValues_(map) {
  const keys = Object.keys(map || {});
  const out = {};
  let sum = 0;
  keys.forEach(k => { out[k] = Math.round(map[k]); sum += out[k]; });

  let diff = Math.round(keys.reduce((a, k) => a + map[k], 0)) - sum;
  if (diff !== 0 && keys.length) {
    const frac = k => map[k] - Math.floor(map[k]);
    // Adding? Take the entries rounded down hardest. Removing? Those rounded up hardest.
    const order = keys.slice().sort((a, b) => diff > 0 ? frac(b) - frac(a) : frac(a) - frac(b));
    for (let i = 0; diff !== 0 && i < order.length; i++) {
      const step = diff > 0 ? 1 : -1;
      out[order[i]] += step;
      diff -= step;
    }
  }
  return out;
}

/**
 * The organisation's runway (runwayWalk_ over every part, from `reserves` when given), plus
 * the parts and the reserves, so the Overview can redraw it for any filter or grouping
 * without a round trip.
 */
function buildRunway_(budgets, actualLines, now, exclusivityReps, itemToMilestone, reserves) {
  const nowKey = DateMath.monthKey(now);
  const parts = runwayParts_(budgets, actualLines, exclusivityReps, itemToMilestone);
  const walk = runwayWalk_(parts, nowKey, undefined, reserves);
  // The parts travel with the snapshot so the Overview can walk any selection of them.
  // Whole dollars, each map rounded so it still sums to its unrounded total.
  walk.nowKey = nowKey;
  walk.reserves = reserves || null;
  walk.parts = parts.map(p => Object.assign({}, p, {
    cost: roundMapValues_(p.cost), income: roundMapValues_(p.income),
    actualCost: roundMapValues_(p.actualCost), actualIncome: roundMapValues_(p.actualIncome)
  }));
  return walk;
}

/**
 * The runway's building blocks: one part per project, funding source and milestone, with
 * its budgeted cost and income and its Xero actual cost and income, month by month.
 *
 * Income is split the way the Overview's cards split it. A source's margin (marginRule_)
 * moves from each non-General line to a "(margin)" part under General, and from that
 * source's actuals by the same rule, so a project's line does not jump at today. A source
 * whose exclusivity group another source carries has no cost here, as in the org totals.
 */
function runwayParts_(budgets, actualLines, exclusivityReps, itemToMilestone) {
  const parts = {};
  function part(project, source, milestone, status, probability, offset) {
    const k = project + '||' + source + '||' + milestone + (offset || '');
    return parts[k] || (parts[k] = { project: project, fundingSource: source,
      milestone: milestone, status: status, probability: probability,
      cost: {}, income: {}, actualCost: {}, actualIncome: {} });
  }

  const bySource = {};
  (budgets || []).forEach(src => {
    // Reserves less what one other sheet pays (reservesOffsets_): its own parts, with that
    // sheet's status, as in the Overview's entries.
    const offset = src.offsetFor ? '||less ' + src.offsetFor : '';
    const group = clean_((src.metadata || {})[CONFIG.META.exclusivityGroup] || '');
    const carriesCost = !group || (exclusivityReps || {})[group] === src.name;
    // A proposed source with no Probability counts nothing towards expected income rather
    // than being guessed at, exactly as in the org totals. G2 asks for the number.
    const probability = sourceProbability_(src.status, src.metadata);
    const rule = marginRule_(src);
    const ifFunded = costIfFunded_(src);
    if (!offset) bySource[src.name] = { status: src.status, probability: probability, rule: rule };
    (src.lines || []).forEach(l => {
      const p = part(l.project || CONFIG.DEFAULT_PROJECT, src.name,
        l.milestone || '(unassigned)', src.status, probability, offset);
      if (ifFunded) p.ifFunded = true;
      addInto_(p.cost, scaleMap_(distributeByMonth_([l], 'cost'), carriesCost ? 1 : 0));
      const margin = lineMargin_(l, rule);
      addInto_(p.income, lessMap_(distributeByMonth_([l], 'income'), margin));
      if (Object.keys(margin).length) {
        addInto_(part(CONFIG.GENERAL_PROJECT, src.name, marginMilestone_(src.name),
          src.status, probability).income, margin);
      }
    });
  });

  (actualLines || []).forEach(l => {
    // Same exclusions as the org totals, or runway would disagree with the cards above it.
    if (!l.project || startsWith_(l.project, CONFIG.ARCHIVE_PREFIX)) return;
    if (isArchivedSource_(l.fundingSource)) return;
    const fs = l.fundingSource || '(unassigned)';
    // Money already spent or received is real whatever its sheet says, so a tag with no
    // sheet counts as secured.
    const s = bySource[fs] || { status: 'secured', probability: 1, rule: null };
    const code = itemCode_(l.item);
    const mile = (code && (itemToMilestone || {})[fs + '||' + code]) || '(unassigned)';
    const key = DateMath.monthKey(new Date(l.date));
    const amount = Number(l.amount) || 0;
    const p = part(l.project, fs, mile, s.status, s.probability);
    if (l.kind === 'expense') p.actualCost[key] = (p.actualCost[key] || 0) + amount;
    else p.actualIncome[key] = (p.actualIncome[key] || 0) + amount;
    // The margin on what was actually spent and received, by the plan's rule.
    const rule = l.project === CONFIG.GENERAL_PROJECT ? null : s.rule;
    if (!rule || !!rule.byCost !== (l.kind === 'expense')) return;
    const toGeneral = rule.byCost ? -amount : amount * rule.rate;
    p.actualIncome[key] = (p.actualIncome[key] || 0) - toGeneral;
    const g = part(CONFIG.GENERAL_PROJECT, fs, marginMilestone_(fs), s.status, s.probability);
    g.actualIncome[key] = (g.actualIncome[key] || 0) + toGeneral;
  });

  return Object.keys(parts).map(k => parts[k]);
}

/**
 * Funded runway over any set of parts (runwayParts_): the month cumulative income stops
 * covering cumulative spend.
 *
 * Self-contained on purpose. The page receives this function's own source (Index.html),
 * so the chart runs exactly the code the tests run here. It may not call
 * anything outside itself.
 *
 * On its own this is funded runway, not cash: the Xero scopes cannot reach a bank balance,
 * so it answers "when does the plan go underwater on money we have actually won". The
 * money already in hand comes from `reserves` ({ amount, month }, latestReserves_): the
 * free money at the end of `month` as the bookkeeper worked it out at a quarter close.
 * Every line moves by one amount so that its position at the end of that month is the
 * figure; from there on the secured line is reserves plus secured funding against the
 * plan, the organisation's actual runway. Only the whole organisation has reserves, so
 * the Overview passes them for that view alone.
 *
 * Months before the current one use Xero actuals; the current month and every month after
 * use the budget. The current month is deliberately budget rather than actual-so-far,
 * because a part-elapsed month of actuals understates spend and would push the crossover
 * later, which is the flattering direction.
 *
 * Everything before the current month collapses into `openingNet`, and the crossover is
 * only looked for from the current month on. Opening the walk at zero on the earliest
 * budgeted month would report a crossover in month one for any grant-funded organisation,
 * since spend always precedes the first tranche. That number would be arithmetically
 * correct and completely useless.
 *
 * Three income lines, because the distance between them is the fundraising question stated
 * in months rather than dollars:
 *   secured   secured sources only, the floor
 *   weighted  secured, plus each proposed source's income at its stated probability
 *   proposed  secured, plus every proposed source in full, the ceiling
 * All three share the same past, because a proposed grant has paid nothing yet, so they can
 * only diverge ahead of today. Spend is every part's cost whatever its status, except work
 * that goes ahead only if funded (a part marked ifFunded): its cost is not spend whatever
 * lands, so it comes off the lines that count its funding, at the same weight as its
 * income, and never off the secured line. `spend` is therefore the work done whatever
 * lands, and each line is its funding net of the work that funding would pay for.
 *
 * A single burn-rate division was rejected deliberately: grant income arrives in tranches,
 * and dividing by an average burn rate reports a crossover no month actually experiences.
 *
 * `months`, optional, fixes the axis, so several walks line up on one chart.
 */
function runwayWalk_(parts, nowKey, months, reserves) {
  function add(m, k, v) { m[k] = (m[k] || 0) + (v || 0); }
  function monthsUntil(fromKey, toKey) {
    if (!toKey) return null;
    const a = fromKey.split('-'), b = toKey.split('-');
    return (parseInt(b[0], 10) - parseInt(a[0], 10)) * 12 +
           (parseInt(b[1], 10) - parseInt(a[1], 10));
  }

  const budgetCost = {}, incSecured = {}, incWeighted = {}, incProposed = {};
  const actualCost = {}, actualIncome = {};
  (parts || []).forEach(p => {
    const secured = p.status === 'secured';
    const weight = secured ? 1 : (typeof p.probability === 'number' ? p.probability : 0);
    const ifFunded = !secured && !!p.ifFunded;
    Object.keys(p.cost || {}).forEach(k => {
      if (!ifFunded) { add(budgetCost, k, p.cost[k]); return; }
      add(incProposed, k, -p.cost[k]);
      add(incWeighted, k, -p.cost[k] * weight);
    });
    Object.keys(p.income || {}).forEach(k => {
      add(incProposed, k, p.income[k]);
      if (secured) add(incSecured, k, p.income[k]);
      add(incWeighted, k, p.income[k] * weight);
    });
    Object.keys(p.actualCost || {}).forEach(k => add(actualCost, k, p.actualCost[k]));
    Object.keys(p.actualIncome || {}).forEach(k => add(actualIncome, k, p.actualIncome[k]));
  });

  if (!months) {
    const seen = {};
    [budgetCost, incSecured, incWeighted, incProposed, actualCost, actualIncome]
      .forEach(m => Object.keys(m).forEach(k => (seen[k] = true)));
    months = Object.keys(seen).sort();
  }

  const crossover = { secured: null, weighted: null, proposed: null };
  if (!months.length) {
    return { months: [], openingNet: 0, crossover: crossover,
      monthsOfRunway: { secured: null, weighted: null, proposed: null } };
  }

  // The past is actuals on every line alike, so one offset puts all three at the reserves
  // figure at the end of its month.
  let offset = 0;
  if (reserves && typeof reserves.amount === 'number' && reserves.month) {
    let base = 0;
    months.forEach(k => {
      if (k <= reserves.month && k < nowKey) {
        base += (actualIncome[k] || 0) - (actualCost[k] || 0);
      }
    });
    offset = reserves.amount - base;
  }

  let spend = 0, secured = offset, weighted = offset, proposed = offset;
  let openingNet = null;
  const rows = [];
  months.forEach(key => {
    const past = key < nowKey;
    if (!past && openingNet === null) openingNet = Math.round(secured - spend);

    spend += past ? (actualCost[key] || 0) : (budgetCost[key] || 0);
    if (past) {
      const inc = actualIncome[key] || 0;
      secured += inc; weighted += inc; proposed += inc;
    } else {
      secured += incSecured[key] || 0;
      weighted += incWeighted[key] || 0;
      proposed += incProposed[key] || 0;
    }

    if (!past) {
      if (crossover.secured === null && secured - spend < 0) crossover.secured = key;
      if (crossover.weighted === null && weighted - spend < 0) crossover.weighted = key;
      if (crossover.proposed === null && proposed - spend < 0) crossover.proposed = key;
    }

    rows.push({ month: key, actual: past, spend: Math.round(spend),
      secured: Math.round(secured), weighted: Math.round(weighted),
      proposed: Math.round(proposed) });
  });

  // Every month is in the past: the budget has run out, not the money. Say so with nulls
  // rather than reporting a crossover that the data cannot support.
  if (openingNet === null) openingNet = Math.round(secured - spend);

  return { months: rows, openingNet: openingNet, crossover: crossover,
    monthsOfRunway: {
      secured: monthsUntil(nowKey, crossover.secured),
      weighted: monthsUntil(nowKey, crossover.weighted),
      proposed: monthsUntil(nowKey, crossover.proposed)
    } };
}

/**
 * Per funding source: baseline (frozen budget) and actual (from Xero) spend,
 * bucketed by milestone (item code) and quarter. Returns an array ready for the
 * quarterly tracking screen; the live forecast layer is merged in WebApp/UI.
 * `margins` is each source's marginRule_ from the plan, by name (marginRules_), since the
 * sheets given here are the Budget tab's own lines.
 */
function buildTracking_(budgets, actualLines, margins) {
  // A source's grid starts where the source does. A Xero option can be renamed onto a new
  // source part way through a year (General became GEN_27_CORE), and the history it brings
  // would otherwise fill the Before column and the totals. Runway and the Overview keep it.
  const startOf = {};
  budgets.forEach(b => (startOf[b.name] = sourceStart_(b)));

  // Index Xero actuals by source||itemCode -> { quarter: amount }, split by
  // expense (cost) vs income. Also remember a display name per item code.
  const costActuals = {};
  const incomeActuals = {};
  const actualNames = {}; // source||code -> Xero item name
  actualLines.forEach(l => {
    if (!l.fundingSource || isArchivedSource_(l.fundingSource)) return;
    const start = startOf[l.fundingSource];
    if (start && new Date(l.date) < start) return;
    const q = quarterOfMonthKey_(DateMath.monthKey(new Date(l.date)));
    const code = itemCode_(l.item);
    const key = l.fundingSource + '||' + code;
    const bucket = l.kind === 'income' ? incomeActuals : costActuals;
    (bucket[key] = bucket[key] || {});
    bucket[key][q] = (bucket[key][q] || 0) + l.amount;
    if (code && l.itemName && !actualNames[key]) actualNames[key] = l.itemName;
  });

  return budgets.map(src => {
    // Per-source forecast from the Forecast tab (may be empty if tab is missing).
    const fc = src.forecast || { cost: {}, income: {}, comments: {} };

    // Group budget lines by milestone (item code).
    const byItem = {};
    src.lines.forEach(l => {
      const code = itemCode_(l.item) || ('(' + (l.milestone || 'unassigned') + ')');
      byItem[code] = byItem[code] || { milestone: l.milestone || code, lines: [] };
      byItem[code].lines.push(l);
    });

    const milestones = Object.keys(byItem).map(code => {
      const key = src.name + '||' + code;
      // Build per-quarter forecast maps for this item from the Forecast tab.
      const costForecast = {};
      const incomeForecast = {};
      Object.keys(fc.cost).forEach(k => {
        if (k.indexOf(code + '||') === 0) costForecast[k.split('||')[1]] = fc.cost[k];
      });
      Object.keys(fc.income).forEach(k => {
        if (k.indexOf(code + '||') === 0) incomeForecast[k.split('||')[1]] = fc.income[k];
      });
      return {
        item: code, milestone: byItem[code].milestone, source: src.name,
        project: dominantProject_(byItem[code].lines),
        baseline: roundMap_(bucketToQuarters(distributeByMonth_(byItem[code].lines, 'cost'))),
        actual: roundMap_(costActuals[key] || {}),
        incomeBaseline: roundMap_(bucketToQuarters(distributeByMonth_(byItem[code].lines, 'income'))),
        incomeActual: roundMap_(incomeActuals[key] || {}),
        costForecast: roundMap_(costForecast),
        incomeForecast: roundMap_(incomeForecast),
        forecastComment: fc.comments[code] || ''
      };
    });

    // Add a row for every actual item code NOT in the budget, so unbudgeted
    // income (e.g. cash-received items) and miscoded expenses still show and the
    // totals reconcile to Xero. Codeless actuals go to an "Unassigned" row.
    const prefix = src.name + '||';
    const seenCodes = {};
    Object.keys(costActuals).concat(Object.keys(incomeActuals)).forEach(k => {
      if (k.indexOf(prefix) === 0) seenCodes[k.substring(prefix.length)] = true;
    });
    Object.keys(seenCodes).forEach(code => {
      if (byItem[code]) return; // already a budget milestone
      const key = prefix + code;
      const actual = roundMap_(costActuals[key] || {});
      const incomeActual = roundMap_(incomeActuals[key] || {});
      if (!Object.keys(actual).length && !Object.keys(incomeActual).length) return;
      const blank = (code === '');
      milestones.push({
        item: blank ? '(unassigned)' : code,
        milestone: blank ? 'Unassigned (no product/service)'
          : (actualNames[key] || code) + ' (unbudgeted)',
        source: src.name, project: src.projectFolder, actualOnly: true,
        baseline: {}, actual: actual, incomeBaseline: {}, incomeActual: incomeActual,
        costForecast: {}, incomeForecast: {}, forecastComment: ''
      });
    });

    const quarterSet = {};
    milestones.forEach(m => [m.baseline, m.actual, m.incomeBaseline, m.incomeActual,
      m.costForecast, m.incomeForecast]
      .forEach(map => Object.keys(map).forEach(q => (quarterSet[q] = true))));
    const quarters = Object.keys(quarterSet).sort((a, b) => quarterSortNum(a) - quarterSortNum(b));
    return { source: src.name, status: src.status, project: src.projectFolder,
      quarters: quarters, milestones: milestones, sheetUrl: src.sheetUrl || null,
      // So General's tracking view can show its margin by the same rule.
      margin: (margins || {})[src.name] || null };
  });
}

/**
 * Reserves' rows in Project tracking show what is left for reserves to pay, so they compare
 * with what Xero codes to Reserves: its full cost less what other sheets' rows on the same
 * General milestones cost, quarter by quarter, budget and forecast alike by the grid's own
 * rule (forecastOrBaseline_), in the quarters Reserves holds that milestone over, as
 * reservesOffsets_ does by month. Only secured sheets come off. The grid has no expected
 * case, and a proposal shows beside Reserves until it is won, when it moves to secured.
 *
 * Each row keeps, per quarter, its full cost and what each sheet pays of it (`cover`), for
 * the cell's hover. A milestone on two years' item codes shares each quarter's cover between
 * its rows by their full cost that quarter. Pure over the tracking entries, which it returns
 * with Reserves' rows replaced.
 */
function netReservesTracking_(tracking) {
  const res = (tracking || []).filter(t => t.source === CONFIG.RESERVES_SOURCE)[0];
  if (!res) return tracking;
  const own = {}; // milestone key -> Reserves' rows
  res.milestones.forEach(m => {
    if (m.actualOnly || m.project !== CONFIG.GENERAL_PROJECT) return;
    (own[milestoneKey_(m.milestone)] = own[milestoneKey_(m.milestone)] || []).push(m);
  });
  const paying = {}; // milestone key -> [{ source, m }]
  tracking.forEach(t => {
    if (t === res || t.status !== 'secured') return;
    (t.milestones || []).forEach(m => {
      const k = milestoneKey_(m.milestone);
      if (m.actualOnly || m.project !== CONFIG.GENERAL_PROJECT || !own[k]) return;
      (paying[k] = paying[k] || []).push({ source: t.source, m: m });
    });
  });

  const netted = {}; // the Reserves row it replaces -> its netted copy
  Object.keys(paying).forEach(k => {
    const rows = own[k].map(m => Object.assign({}, m, { baseline: Object.assign({}, m.baseline),
      costForecast: Object.assign({}, m.costForecast), cover: {} }));
    own[k].forEach((m, i) => { netted[m.item] = rows[i]; });
    // The quarters Reserves holds this milestone over: its first to its last with any cost.
    const held = [];
    own[k].forEach(m => [m.baseline, m.costForecast].forEach(map =>
      Object.keys(map || {}).forEach(q => { if (map[q]) held.push(qiOfLabel_(q)); })));
    const from = Math.min.apply(null, held), to = Math.max.apply(null, held);
    const qs = {};
    own[k].concat(paying[k].map(p => p.m)).forEach(m => [m.baseline, m.costForecast]
      .forEach(map => Object.keys(map || {}).forEach(q => (qs[q] = true))));
    Object.keys(qs).filter(q => qiOfLabel_(q) >= from && qiOfLabel_(q) <= to).forEach(q => {
      const expected = m => forecastOrBaseline_(m.costForecast, m.baseline, q);
      const fullOf = own[k].map(expected), baseOf = own[k].map(m => (m.baseline || {})[q] || 0);
      const share = (list, i) => {
        const t = list.reduce((a, v) => a + v, 0);
        return t ? list[i] / t : (i === 0 ? 1 : 0);
      };
      const typed = own[k].concat(paying[k].map(p => p.m))
        .some(m => (m.costForecast || {})[q] !== undefined);
      const paidBase = paying[k].reduce((t, p) => t + ((p.m.baseline || {})[q] || 0), 0);
      rows.forEach((r, i) => {
        const by = paying[k].map(p => ({ source: p.source,
          amount: Math.round(expected(p.m) * share(fullOf, i)) })).filter(b => b.amount);
        const base = baseOf[i] - Math.round(paidBase * share(baseOf, i));
        if (base || r.baseline[q] !== undefined) r.baseline[q] = base;
        if (typed && (fullOf[i] || by.length || r.costForecast[q] !== undefined)) {
          r.costForecast[q] = fullOf[i] - by.reduce((t, b) => t + b.amount, 0);
        }
        if (by.length) r.cover[q] = { full: fullOf[i], by: by };
      });
    });
  });

  return tracking.map(t => t !== res ? t : Object.assign({}, t,
    { milestones: t.milestones.map(m => netted[m.item] || m) }));
}

/** The project carrying the most budgeted cost across a milestone's lines. */
function dominantProject_(lines) {
  const byProject = {};
  lines.forEach(l => (byProject[l.project] = (byProject[l.project] || 0) + (l.cost || 0)));
  let best = null, bestVal = -1;
  Object.keys(byProject).forEach(p => { if (byProject[p] > bestVal) { bestVal = byProject[p]; best = p; } });
  return best || (lines[0] && lines[0].project) || CONFIG.DEFAULT_PROJECT;
}

function roundMap_(map) {
  const out = {};
  Object.keys(map).forEach(k => (out[k] = Math.round(map[k])));
  return out;
}

// ---- helpers ---------------------------------------------------------------

function projectExpenseShares_(lines, fy) {
  const totals = {};
  let grand = 0;
  lines.forEach(l => {
    // With `fy`, the part of the line's cost that falls in that financial year.
    const cost = fy ? sumMonthsInFY_(distributeByMonth_([l], 'cost'), fy) : l.cost;
    totals[l.project] = (totals[l.project] || 0) + cost;
    grand += cost;
  });
  const shares = {};
  if (grand === 0) { // no operating expense — attribute evenly to seen projects
    const names = uniqueProjects_(lines);
    names.forEach(n => (shares[n] = 1 / names.length));
    return shares;
  }
  Object.keys(totals).forEach(p => (shares[p] = totals[p] / grand));
  return shares;
}

function uniqueProjects_(lines) {
  const set = {};
  lines.forEach(l => (set[l.project] = true));
  const names = Object.keys(set);
  return names.length ? names : [CONFIG.DEFAULT_PROJECT];
}

function round_(n) { return Math.round(n); }
function startsWith_(s, p) { return String(s).indexOf(p) === 0; }

function earliestBudgetStart_(budgets) {
  let min = null;
  budgets.forEach(b => b.lines.forEach(l => {
    if (l.start && (!min || l.start < min)) min = l.start;
  }));
  return min || new Date(new Date().getFullYear() - 1, 0, 1);
}

/**
 * Where one source begins: the earlier of its Funding start and its first budget line, so
 * a line budgeted before the funding start still has its spend tracked. Null with neither.
 */
function sourceStart_(b) {
  let min = parseSheetDate_(((b && b.metadata) || {})['funding start']);
  ((b && b.lines) || []).forEach(l => {
    if (l.start && (!min || l.start < min)) min = l.start;
  });
  return min;
}

function latestBudgetEnd_(budgets) {
  let max = null;
  budgets.forEach(b => b.lines.forEach(l => {
    if (l.end && (!max || l.end > max)) max = l.end;
  }));
  return max;
}

function isoOrNull_(d) { return d ? d.toISOString() : null; }

/**
 * Totals across the rows given: the whole organisation, or a project lead's projects.
 *
 * The gap is taken on the totals, not summed from each row's gap. Each row's gap is
 * floored at zero, so summing them let no project's surplus offset another's shortfall.
 * Once General receives the margins it can end a period in surplus, and summed
 * gaps would then report the organisation short of money that its own figures show it has.
 */
function orgTotals_(rows) {
  const t = { budget: 0, secured: 0, actual: 0, unsecuredGap: 0, weighted: 0,
              budgetFY: 0, securedFY: 0, actualFY: 0, unsecuredGapFY: 0, weightedFY: 0 };
  (rows || []).forEach(r => {
    t.budget += r.proposedBudget; t.secured += r.securedIncome;
    t.actual += r.actualExpense;
    t.weighted += r.weightedIncome || 0; t.weightedFY += r.weightedIncomeFY || 0;
    t.budgetFY += r.proposedBudgetFY; t.securedFY += r.securedIncomeFY;
    t.actualFY += r.actualExpenseFY;
  });
  t.unsecuredGap = Math.max(0, t.budget - t.secured);
  t.unsecuredGapFY = Math.max(0, t.budgetFY - t.securedFY);
  Object.keys(t).forEach(k => (t[k] = round_(t[k])));
  return t;
}

function sumMonthsInFY_(monthMap, fy) {
  let sum = 0;
  Object.keys(monthMap).forEach(k => {
    const p = k.split('-');
    const d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1);
    if (d >= fy.start && d <= fy.end) sum += monthMap[k];
  });
  return sum;
}
