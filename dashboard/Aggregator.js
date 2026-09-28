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
 * General's overhead is derived from each source's Contribution policy, see
 * contributionRate_. Actuals come pre-split by Xero's Projects tracking category, so
 * actual numbers are exact, not approximated.
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
 * Share of a funding source's income that funds General, from its Contribution policy.
 *
 * Only percent_of_income derives anything. A per_line source already puts its General
 * work on General line by line, through the Project column, so deriving on top would
 * count it twice. None contributes nothing, and neither does a missing or unreadable
 * policy: C6 reports those, and guessing a rate would move money on a typo.
 */
function contributionRate_(src) {
  const raw = clean_(((src && src.metadata) || {})['contribution policy'] || '');
  const m = /^percent_of_income:(\d+(?:\.\d+)?)$/.exec(normalisePolicy_(raw));
  if (!m) return 0;
  const pct = parseFloat(m[1]);
  return pct > 0 && pct <= 100 ? pct / 100 : 0;
}

/** The part of one budget line's income owed to General: none if the line is General's. */
function lineContribution_(line, rate) {
  if (!rate || !line) return 0;
  if ((line.project || CONFIG.DEFAULT_PROJECT) === CONFIG.GENERAL_PROJECT) return 0;
  return (Number(line.income) || 0) * rate;
}

/** The milestone General's inflow from one source appears under, in every view. */
function contributionMilestone_(sourceName) { return sourceName + ' (contribution)'; }

/**
 * What deriving contribution moves between projects, per source and per (status,
 * project), without changing anything. The Overview credits income to each line's own
 * project, so this does the same: a dry run reports what the breakdown will show.
 */
function contributionMoves_(budgets) {
  const sources = [], moves = {};
  (budgets || []).forEach(src => {
    const rate = contributionRate_(src);
    let toGeneral = 0;
    (src.lines || []).forEach(l => {
      const c = lineContribution_(l, rate);
      if (!c) return;
      toGeneral += c;
      const from = src.status + '||' + (l.project || CONFIG.DEFAULT_PROJECT);
      const to = src.status + '||' + CONFIG.GENERAL_PROJECT;
      moves[from] = (moves[from] || 0) - c;
      moves[to] = (moves[to] || 0) + c;
    });
    sources.push({ name: src.name, status: src.status, rate: rate, toGeneral: toGeneral,
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
  const actualSince = earliestBudgetStart_(budgets);
  const actualLines = isXeroConnected() ? fetchXeroActuals(actualSince) : [];
  setRefreshProgress_('Aggregating ' + actualLines.length + ' actual line(s)', 0, 0, 90);

  // Competing applications for the same work share an Exclusivity group, and only one
  // member of each group carries the cost. See chooseExclusivityReps_.
  const exclusivityReps = chooseExclusivityReps_(budgets);
  const agg = aggregateBudgets_(budgets, fy, exclusivityReps);
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

  // Quarterly tracking grid (baseline + actual per funding source / milestone /
  // quarter). Forecast is layered on at view time from the live Forecast sheet,
  // so GM edits show immediately without a full refresh.
  const tracking = buildTracking_(budgets, actualLines);

  // Project planner timeline: milestone segments color-coded by funding status.
  const timeline = buildTimeline_(budgets, actualLines, itemToMilestone, fy, now);

  // Funded runway: cumulative income against cumulative spend, month by month.
  const runway = buildRunway_(budgets, actualLines, now, exclusivityReps);

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
    fyLabel: fy.label,
    fyStart: fy.start.toISOString(),
    fyEnd: fy.end.toISOString(),
    forecastStart: isoOrNull_(earliestBudgetStart_(budgets)),
    forecastEnd: isoOrNull_(latestBudgetEnd_(budgets))
  };

  // Health findings. `dataFlags` was declared and never populated, so the warning
  // area on the dashboard had never shown anything; it is now the error/warning
  // summary of `health`.
  const xeroOk = isXeroConnected();
  const secretsMissing = ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'].filter(k => !getSecret(k));
  const health = buildHealth(budgets, actualLines, {
    now: now,
    xeroConnected: xeroOk,
    exclusion: lastExclusionSummary(),
    unposted: lastUnpostedSummary(),
    secretsMissing: secretsMissing,
    // So G3 can name which source had its cost suppressed and which carries it instead.
    exclusivity: { reps: exclusivityReps, suppressed: costSuppressed }
  });

  return {
    generatedAt: now.toISOString(),
    xeroConnected: xeroOk,
    currentQuarter: currentQuarterLabel(),
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
    health: health,
    dataFlags: dataFlags.concat(healthToFlags(health))
  };
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
    const group = clean_((src.metadata || {})[CONFIG.META.exclusivityGroup] || '');
    const rep = group ? exclusivityReps[group] : null;
    // A non-representative still contributes its ask, just not the work behind it.
    const carriesCost = !group || rep === src.name;
    if (!carriesCost) costSuppressed[src.name] = { group: group, countedIn: rep };
    const costFactor = carriesCost ? 1 : 0;
    const probability = sourceProbability_(src.status, src.metadata);

    // Per-line project attribution is handled in BudgetReader: a line uses its
    // `Project` value when set, otherwise the parent project folder. Falling back
    // to the folder is expected, so it is not flagged here.
    const fc = computeFundingSourceForecast(src.lines);
    const shares = projectExpenseShares_(src.lines); // {project: 0..1}

    const expenseFY = sumMonthsInFY_(fc.expenseByMonth, fy);
    const incomeFY = sumMonthsInFY_(fc.incomeByMonth, fy);

    // The share of this source's income its Contribution policy sends to General.
    const rate = contributionRate_(src);

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
    // follows the cost share, and the policy's share of it is General's.
    Object.keys(shares).forEach(pName => {
      const share = shares[pName];
      const p = project_(pName);
      const toGeneral = pName === CONFIG.GENERAL_PROJECT ? 0 : rate;
      const incTotal = fc.totalBudgetIncome * share;
      const incFY = incomeFY * share;
      p.proposedBudget += fc.totalBudgetExpense * share * costFactor;
      p.proposedBudgetFY += expenseFY * share * costFactor;
      creditIncome(p, incTotal * (1 - toGeneral), incFY * (1 - toGeneral));
      if (toGeneral) {
        creditIncome(project_(CONFIG.GENERAL_PROJECT), incTotal * toGeneral, incFY * toGeneral);
      }
    });

    // Build budgetByKey at (project, source, milestone) granularity.
    // Each budget line carries its own cost, income, milestone, and project.
    src.lines.forEach(l => {
      const pName = l.project || CONFIG.DEFAULT_PROJECT;
      const mile = l.milestone || '(unassigned)';
      const bkey = pName + '||' + src.name + '||' + mile;

      // Build item-to-milestone lookup for actuals mapping
      const code = itemCode_(l.item);
      if (code) itemToMilestone[src.name + '||' + code] = mile;

      // Day-weighted FY portion for this single line
      const lineCostByMonth = distributeByMonth_([l], 'cost');
      const lineIncByMonth = distributeByMonth_([l], 'income');
      const lineCostFY = sumMonthsInFY_(lineCostByMonth, fy);
      const lineIncFY = sumMonthsInFY_(lineIncByMonth, fy);

      const entry = budgetByKey[bkey] || (budgetByKey[bkey] = newBudgetEntry_(src.status));
      // costFactor is 0 when a competing application in the same exclusivity group carries
      // the work. The ask still shows; the work is counted once, on the representative.
      entry.budget += l.cost * costFactor;
      entry.budgetFY += lineCostFY * costFactor;
      // Per-quarter as well as per-FY, so the Overview can be shown for any financial
      // year rather than only the current one. The day-weighted month buckets already
      // exist; bucketToQuarters just folds them into FY quarters.
      addInto_(entry.budgetByQ, scaleMap_(bucketToQuarters(lineCostByMonth), costFactor));

      // The policy's share of this line's income is General's, and shows under General as
      // this source's contribution; the project keeps the rest. lineContribution_ is what
      // the dry run used, so what it reported is what this does.
      const toGeneral = lineContribution_(l, rate) ? rate : 0;
      creditLineIncome_(entry, l, lineIncByMonth, lineIncFY, probability, 1 - toGeneral);
      if (toGeneral) {
        const gkey = CONFIG.GENERAL_PROJECT + '||' + src.name + '||' +
          contributionMilestone_(src.name);
        const g = budgetByKey[gkey] || (budgetByKey[gkey] = newBudgetEntry_(src.status));
        creditLineIncome_(g, l, lineIncByMonth, lineIncFY, probability, toGeneral);
      }

      if (!entry.comment && code && src.forecast && src.forecast.comments) {
        entry.comment = src.forecast.comments[code] || '';
      }
    });

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
    budgetByQ: {}, incomeByQ: {}, weightedByQ: {}, comment: '', start: null, end: null };
}

/**
 * Credit `share` of one budget line's income to an entry, in every form it keeps: total,
 * this FY, by quarter, and expected. One function, so the part a project keeps and the
 * part General receives cannot be computed two different ways.
 */
function creditLineIncome_(entry, l, lineIncByMonth, lineIncFY, probability, share) {
  const byQ = scaleMap_(bucketToQuarters(lineIncByMonth), share);
  entry.income += l.income * share;
  entry.incomeFY += lineIncFY * share;
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
    return {
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
      // Income from a source that is still an application. Kept separate from secured so
      // the five-year plan can show committed and hoped-for money in different columns
      // rather than blending them into one number nobody can act on.
      proposedByQ: status === 'proposed' ? roundMapValues_(b.incomeByQ || {}) : {},
      actualByQ: roundMapValues_(actualByKeyQ[key] || {}),
      // Secured in full plus proposed at its probability. What we expect to have, as
      // opposed to what is committed.
      weightedByQ: roundMapValues_(b.weightedByQ || {}),
      comment: b.comment || '',
      start: b.start || null,
      end: b.end || null
    };
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
 * Build timeline data for the Project Planner view.
 * For each (project, milestone) pair, produces an array of funding-source segments
 * with date ranges and monthly cost distributions, plus actual spend to date.
 * The UI renders these as a Gantt chart with green (secured), amber (proposed),
 * and gray (unplanned gap) bars.
 */
function buildTimeline_(budgets, actualLines, itemToMilestone, fy, now) {
  // Group budget lines by project+milestone, keeping each funding source as a segment.
  const byProjMile = {}; // 'project||milestone' -> { segments: [], actualExpense: 0 }

  budgets.forEach(src => {
    src.lines.forEach(l => {
      const pName = l.project || CONFIG.DEFAULT_PROJECT;
      const mile = l.milestone || '(unassigned)';
      const pmKey = pName + '||' + mile;
      if (!byProjMile[pmKey]) byProjMile[pmKey] = { project: pName, milestone: mile, segments: [], actualExpense: 0 };

      // Income as well as cost, so the planner can offer Cost / Income / Profit and loss
      // per milestone. Profit and loss is derived in the client rather than stored: it is
      // income minus cost, and storing a third series invites the three to disagree.
      const monthlyCost = distributeByMonth_([l], 'cost');
      const monthlyIncome = distributeByMonth_([l], 'income');
      byProjMile[pmKey].segments.push({
        source: src.name,
        status: src.status,
        start: l.start ? DateMath.monthKey(l.start) : null,
        end: l.end ? DateMath.monthKey(l.end) : null,
        cost: round_(l.cost),
        income: round_(l.income),
        monthlyCost: roundMapValues_(monthlyCost),
        monthlyIncome: roundMapValues_(monthlyIncome)
      });
    });
  });

  // Sum actuals per (project, milestone) using itemToMilestone lookup.
  actualLines.forEach(l => {
    if (l.kind !== 'expense') return;
    if (!l.project || startsWith_(l.project, CONFIG.ARCHIVE_PREFIX)) return;
    const fs = l.fundingSource || '(unassigned)';
    const code = itemCode_(l.item);
    const mile = (code && itemToMilestone[fs + '||' + code]) || '(unassigned)';
    const pmKey = l.project + '||' + mile;
    if (byProjMile[pmKey]) {
      byProjMile[pmKey].actualExpense += l.amount;
    }
  });

  // General's contribution: one row per contributing source, carrying the share of that
  // source's income its Contribution policy sends to General, from lines not already on
  // General. One row per source rather than one row of many segments, because the
  // planner reads each month from a single segment and overlapping sources would hide
  // one another. Income, not cost: this used to be every source's whole margin entered
  // as cost, which both ignored the policy and turned General's inflow into spend.
  budgets.forEach(src => {
    const rate = contributionRate_(src);
    if (!rate) return;
    const monthly = {};
    src.lines.forEach(l => {
      if (lineContribution_(l, rate)) addInto_(monthly, scaleMap_(distributeByMonth_([l], 'income'), rate));
    });
    const months = Object.keys(monthly).sort();
    if (!months.length) return;
    const mile = contributionMilestone_(src.name);
    const total = months.reduce((t, mk) => t + monthly[mk], 0);
    byProjMile[CONFIG.GENERAL_PROJECT + '||' + mile] = {
      project: CONFIG.GENERAL_PROJECT, milestone: mile, actualExpense: 0,
      segments: [{ source: src.name, status: src.status, start: months[0],
        end: months[months.length - 1], cost: 0, income: round_(total),
        monthlyCost: {}, monthlyIncome: roundMapValues_(monthly) }]
    };
  });

  // Horizon: FY start through today + 16 months.
  const horizonStart = DateMath.monthKey(fy.start);
  const hEnd = new Date(now.getFullYear(), now.getMonth() + 16, 1);
  const horizonEnd = DateMath.monthKey(hEnd);

  return Object.keys(byProjMile).map(key => {
    const entry = byProjMile[key];
    // Sort segments by start date.
    entry.segments.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    const totalBudget = entry.segments.reduce((t, s) => t + s.cost, 0);
    return {
      project: entry.project,
      milestone: entry.milestone,
      segments: entry.segments,
      totalBudget: round_(totalBudget),
      totalActual: round_(entry.actualExpense),
      horizonStart: horizonStart,
      horizonEnd: horizonEnd
    };
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
 * Per funding source: baseline (frozen budget) and actual (from Xero) spend,
 * bucketed by milestone (item code) and quarter. Returns an array ready for the
 * quarterly tracking screen; the live forecast layer is merged in WebApp/UI.
 */
/**
 * Funded runway: the month cumulative income stops covering cumulative spend.
 *
 * This is NOT cash runway. There is no bank balance anywhere in this system and the Xero
 * scopes cannot reach one, so it answers "when does the plan go underwater on money we have
 * actually won", not "when does the account empty". Anyone quoting it to a board must say
 * which one they mean.
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
 * only diverge ahead of today.
 *
 * A single burn-rate division was rejected deliberately: grant income arrives in tranches,
 * and dividing by an average burn rate reports a crossover no month actually experiences.
 */
function buildRunway_(budgets, actualLines, now, exclusivityReps) {
  const nowKey = DateMath.monthKey(now);

  const budgetCost = {};   // monthKey -> budgeted cost, exclusivity-adjusted
  const incSecured = {};
  const incWeighted = {};
  const incProposed = {};

  budgets.forEach(src => {
    const group = clean_((src.metadata || {})[CONFIG.META.exclusivityGroup] || '');
    const carriesCost = !group || (exclusivityReps || {})[group] === src.name;
    const probability = sourceProbability_(src.status, src.metadata);

    const cost = distributeByMonth_(src.lines, 'cost');
    const income = distributeByMonth_(src.lines, 'income');

    addInto_(budgetCost, scaleMap_(cost, carriesCost ? 1 : 0));
    addInto_(incProposed, income);
    if (src.status === 'secured') {
      addInto_(incSecured, income);
      addInto_(incWeighted, income);
    } else if (probability !== null) {
      // A proposed source with no Probability contributes nothing here rather than being
      // guessed at, exactly as in the org totals. G2 asks for the number.
      addInto_(incWeighted, scaleMap_(income, probability));
    }
  });

  const actualCost = {};
  const actualIncome = {};
  actualLines.forEach(l => {
    // Same exclusions as the org totals, or runway would disagree with the cards above it.
    if (!l.project || startsWith_(l.project, CONFIG.ARCHIVE_PREFIX)) return;
    if (isArchivedSource_(l.fundingSource)) return;
    const key = DateMath.monthKey(new Date(l.date));
    const target = l.kind === 'expense' ? actualCost : actualIncome;
    target[key] = (target[key] || 0) + l.amount;
  });

  const seen = {};
  [budgetCost, incSecured, incWeighted, incProposed, actualCost, actualIncome]
    .forEach(m => Object.keys(m).forEach(k => (seen[k] = true)));
  const months = Object.keys(seen).sort();

  const empty = { months: [], openingNet: 0, crossover: { secured: null, weighted: null,
    proposed: null }, monthsOfRunway: { secured: null, weighted: null, proposed: null } };
  if (!months.length) return empty;

  let spend = 0, secured = 0, weighted = 0, proposed = 0;
  let openingNet = null;
  const rows = [];
  const crossover = { secured: null, weighted: null, proposed: null };

  months.forEach(key => {
    const past = key < nowKey;
    if (!past && openingNet === null) openingNet = round_(secured - spend);

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

    rows.push({ month: key, actual: past, spend: round_(spend), secured: round_(secured),
      weighted: round_(weighted), proposed: round_(proposed) });
  });

  // Every month is in the past: the budget has run out, not the money. Say so with nulls
  // rather than reporting a crossover that the data cannot support.
  if (openingNet === null) openingNet = round_(secured - spend);

  return { months: rows, openingNet: openingNet, crossover: crossover,
    monthsOfRunway: {
      secured: monthsUntil_(nowKey, crossover.secured),
      weighted: monthsUntil_(nowKey, crossover.weighted),
      proposed: monthsUntil_(nowKey, crossover.proposed)
    } };
}

/** Whole months from one monthKey to another, or null when there is no crossover. */
function monthsUntil_(fromKey, toKey) {
  if (!toKey) return null;
  const a = fromKey.split('-');
  const b = toKey.split('-');
  return (parseInt(b[0], 10) - parseInt(a[0], 10)) * 12 +
         (parseInt(b[1], 10) - parseInt(a[1], 10));
}

function buildTracking_(budgets, actualLines) {
  // Index Xero actuals by source||itemCode -> { quarter: amount }, split by
  // expense (cost) vs income. Also remember a display name per item code.
  const costActuals = {};
  const incomeActuals = {};
  const actualNames = {}; // source||code -> Xero item name
  actualLines.forEach(l => {
    if (!l.fundingSource || isArchivedSource_(l.fundingSource)) return;
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
      // So General's tracking view can show its contribution by the same policy.
      contributionRate: contributionRate_(src) };
  });
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

function projectExpenseShares_(lines) {
  const totals = {};
  let grand = 0;
  lines.forEach(l => {
    totals[l.project] = (totals[l.project] || 0) + l.cost;
    grand += l.cost;
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
 * Once General receives its contribution it can end a period in surplus, and summed
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
