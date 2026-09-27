/**
 * HealthCheck.js
 * Turns silent wrongness into named, owned, actionable findings.
 *
 * The cockpit's numbers are only as good as the budgets in Drive and the coding in
 * Xero, and both used to fail invisibly: BudgetReader skipped a malformed line
 * behind a Logger.log nobody reads, and an untagged Xero transaction vanished from
 * every total without trace. Every finding here states what is wrong, where, who
 * owns it and what to do.
 *
 * Check ids and severities match dashboard/HEALTH_CHECKS.md.
 *   error   - a number on the dashboard is wrong right now
 *   warning - a number may be wrong, or will be soon
 *   info    - hygiene; nothing is wrong yet
 *
 * Pure over its inputs - no Drive or Xero calls - so it can be exercised offline.
 */

const HEALTH_CATALOGUE = {
  A1: { severity: 'error', category: 'Sheet structure',
    title: 'Budget sheet could not be read',
    action: 'The entire file is invisible on the dashboard until this is fixed.' },
  A2: { severity: 'error', category: 'Sheet structure',
    title: 'Required column missing',
    action: 'Add the column. Without it the whole file is skipped.' },
  A3: { severity: 'warning', category: 'Sheet structure',
    title: 'Unexpected tab',
    action: 'Keep only Budget, Forecast and Submitted_budget. Actuals live in Xero.' },
  A4: { severity: 'warning', category: 'Sheet structure',
    title: 'No Project column',
    action: 'Add it so lines can be attributed across projects.' },
  // A5 (no *Account column) was retired on 2026-08-11. Budgets are set at
  // milestone level, not per account, so its absence is expected rather than a
  // finding - and nothing in the code read a budget line's account anyway.
  A6: { severity: 'info', category: 'Sheet structure',
    title: 'No Submitted_budget tab',
    action: 'No frozen record of what the funder was actually given.' },
  A7: { severity: 'error', category: 'Sheet structure',
    title: 'Forecast column header not recognised',
    action: 'Name it exactly "MMM-MMM YY Forecast", e.g. "Jul-Sep 26 Forecast".' },
  A8: { severity: 'warning', category: 'Sheet structure',
    title: 'Forecast row does not match a budget line',
    action: 'Label it with the milestone, or "Description - Milestone" from the ' +
      'Budget tab. The row\'s forecast is discarded until it resolves.' },
  A9: { severity: 'warning', category: 'Sheet structure',
    title: 'Forecast for a milestone not in the budget',
    action: 'Either the budget line was removed, or the code is a typo.' },
  A10: { severity: 'warning', category: 'Sheet structure',
    title: 'Two forecast rows share one label',
    action: 'Usually a sorted Budget tab: the label formulas now point at the ' +
      'wrong lines. Re-point them and do not sort the Budget tab.' },
  B1: { severity: 'warning', category: 'Data quality',
    title: 'Lines skipped as empty',
    action: 'Set Cost/Income deliberately, or delete the row.' },
  B2: { severity: 'error', category: 'Data quality',
    title: 'Unparseable date',
    action: 'Use DD/MMM/YY. The line is ignored entirely.' },
  B3: { severity: 'error', category: 'Data quality',
    title: 'End date precedes Start date',
    action: 'Check the year: a two-digit year can land in the wrong century. ' +
      'The line is ignored.' },
  B4: { severity: 'error', category: 'Data quality',
    title: 'Lines with no Xero Inventory Item',
    action: 'Add the milestone code, or these fall outside quarterly tracking.' },
  B5: { severity: 'warning', category: 'Data quality',
    title: 'Contribution does not equal Income minus Cost',
    action: 'Recompute the Contribution column, or explain it in Comments.' },
  C1: { severity: 'error', category: 'Metadata',
    title: 'Required metadata key missing',
    action: 'Add it to Funding_info. See BUDGET_SHEET_TEMPLATE.md.' },
  C2: { severity: 'error', category: 'Metadata',
    title: 'Status disagrees with the folder',
    action: 'The cockpit trusts the folder. Move the file, or fix the Status value.' },
  C3: { severity: 'error', category: 'Metadata',
    title: 'Funding source does not match the file name',
    action: 'Budgets and actuals join on this string. Make the two identical.' },
  C4: { severity: 'warning', category: 'Metadata',
    title: 'Last reviewed is stale',
    action: 'Check the sheet against reality, then update the date.' },
  C5: { severity: 'warning', category: 'Metadata',
    title: 'Funding end has passed but the sheet is still secured',
    action: 'Archive it, or extend Funding end. Note that archiving removes its ' +
      'actuals from organisation totals.' },
  C6: { severity: 'error', category: 'Metadata',
    title: 'Contribution policy missing or unparseable',
    action: 'Use none, per_line, or percent_of_income:<n>.' },
  C7: { severity: 'warning', category: 'Metadata',
    title: 'Proposed source with no Decision date',
    action: 'Funders ask for it, and the pipeline cannot be timed without it.' },
  D3: { severity: 'warning', category: 'Xero coding',
    title: 'Actual spend with no item code',
    action: 'Falls outside the quarterly tracking grid. Set the Product/Service in Xero.' },
  D4: { severity: 'error', category: 'Xero coding',
    title: 'Actuals coded to a funding source with no budget sheet',
    action: 'Either the sheet is missing, or the Xero tag is a typo.' },
  D5: { severity: 'warning', category: 'Xero coding',
    title: 'Spend was expected, nothing is coded',
    action: 'Usually a missing or misspelt Xero tag. If the work has slipped, enter 0 ' +
      'for those quarters on the Forecast tab.' },
  D6: { severity: 'error', category: 'Xero coding',
    title: 'Actuals dated after the grant ended',
    action: 'Almost always a stale repeating journal or template still pointing here.' },
  E1: { severity: 'warning', category: 'Reconciliation',
    title: 'Actuals exceed the budget',
    action: 'Re-budget, or explain the overspend to the funder.' },
  E2: { severity: 'warning', category: 'Reconciliation',
    title: 'Underspend risk',
    action: 'Funders care about underspend as much as overspend. If the work has ' +
      'slipped, move it to later quarters on the Forecast tab; otherwise re-profile or spend.' },
  E3: { severity: 'error', category: 'Reconciliation',
    title: 'Same item code in two funding sources',
    action: 'One cost is billed to two funders. Item codes are {SOURCE}_{NNN} for a reason.' },
  E4: { severity: 'warning', category: 'Reconciliation',
    title: 'Same description budgeted in two sources over the same dates',
    action: 'Double-funding signal, e.g. one FTE in two grants. If the two are competing ' +
      'applications for the same work, put both sheets in one Exclusivity group so the ' +
      'cost counts once. If it is genuinely different work that happens to share a ' +
      'description, reword one: an Exclusivity group would zero one side\'s cost and ' +
      'understate the budget.' },
  G1: { severity: 'warning', category: 'Funding',
    title: 'Secured funding exceeds the budgeted cost',
    action: 'Either two applications for the same work both landed, in which case ' +
      'reallocate the surplus, or income is filed against the wrong milestone.' },
  G2: { severity: 'info', category: 'Funding',
    title: 'Proposed source with no Probability',
    action: 'Add Probability to Funding_info (0-100). Without it this ask is left out ' +
      'of expected income entirely, rather than guessed at.' },
  G3: { severity: 'info', category: 'Funding',
    title: 'Cost not counted, a competing application carries it',
    action: 'Expected: one exclusivity group is one piece of work. Remove the ' +
      'Exclusivity group value if these are genuinely separate work.' },
  D1: { severity: 'error', category: 'Xero coding',
    title: 'Actual spend with no Projects tag',
    action: 'Tag these in Xero. Untagged lines are dropped from every total.' },
  D2: { severity: 'warning', category: 'Xero coding',
    title: 'Actual spend with no Funding source tag',
    action: 'Tag these in Xero, or they land in "(unassigned)".' },
  F1: { severity: 'error', category: 'System',
    title: 'Xero is not connected',
    action: 'Run logXeroAuthUrl and authorise. Actuals are stale until you do.' },
  F3: { severity: 'error', category: 'System',
    title: 'Xero credentials not configured',
    action: 'Set them in Project Settings > Script Properties.' },
  F5: { severity: 'info', category: 'System',
    title: 'Refresh summary',
    action: '' },
  F6: { severity: 'info', category: 'System',
    title: 'Unapproved Xero documents skipped',
    action: 'Approve them in Xero to have them count. Drafts are not on the ledger, ' +
            'so Xero\'s own reports ignore them too. A draft bill understates spend ' +
            'and flatters runway; a draft invoice does the reverse.' },
  // F2 and F7 are raised at serve time by serveTimeHealth, not by buildHealth.
  F2: { severity: 'warning', category: 'System',
    title: 'Snapshot is stale',
    action: 'The refresh has missed at least two runs. Press Refresh now, then look at ' +
            'Executions in the editor for why the trigger is failing.' },
  F7: { severity: 'error', category: 'System',
    title: 'No auto-refresh trigger installed',
    action: 'Run installRefreshTrigger from the editor. Until then nothing refreshes, ' +
            'and every number here is whatever was last cached, however old that gets.' }
};

const HEALTH_SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

/**
 * @param {Array} budgets  from readAllBudgets()
 * @param {Array} actualLines  normalised Xero lines
 * @param {Object} ctx  { now, xeroConnected, exclusion: {count,total},
 *                       unposted: {count,total}, secretsMissing: [],
 *                       exclusivity: {reps, suppressed} }
 * @return {Array} findings, most severe first, and by value at risk within severity
 */
function buildHealth(budgets, actualLines, ctx) {
  ctx = ctx || {};
  const out = [];
  // Passed in rather than read from the clock, so the date-based checks (C4, C5, D5, D6,
  // E2) are reproducible in a test.
  const now = ctx.now ? new Date(ctx.now) : null;

  function add(id, fields) {
    const f = finding_(id, fields);
    if (f) out.push(f);
  }

  (budgets || []).forEach(b => {
    const meta = b.metadata || {};
    const base = { fundingSource: b.name, project: b.projectFolder,
      owner: meta['owner'] || '', link: b.sheetUrl || '' };

    // --- findings the reader already collected ---
    (b.issues || []).forEach(iss => {
      // A missing required column arrives as a parse failure; it is really A2.
      const id = (iss.check === 'A1' && /missing column/i.test(iss.detail || '')) ? 'A2' : iss.check;
      const fields = { detail: iss.detail, row: iss.row };
      for (var k in base) fields[k] = base[k];
      // Value at risk for missing milestone codes is worth more than a count.
      if (id === 'B4') fields.amount = sumCostWhere_(b.lines, l => !l.item);
      add(id, fields);
    });

    // --- A3 / A6: tab hygiene ---
    const allowedTabs = [CONFIG.FUNDING_INFO_TAB, CONFIG.BUDGET_TAB,
      CONFIG.FORECAST_TAB, CONFIG.SUBMITTED_TAB];
    const allowed = {};
    allowedTabs.forEach(t => { allowed[t] = true; });
    (b.tabs || []).forEach(t => {
      if (!allowed[t]) {
        add('A3', withBase_(base, { detail: 'tab "' + t + '" is not one of ' +
          allowedTabs.join(' / ') }));
      }
    });
    if ((b.tabs || []).length && (b.tabs || []).indexOf(CONFIG.SUBMITTED_TAB) === -1) {
      add('A6', withBase_(base, { detail: 'no "' + CONFIG.SUBMITTED_TAB + '" tab' }));
    }

    // --- A9: forecast for a milestone the budget no longer has ---
    // Compare codes with codes. This used to key on the raw Inventory Item cell,
    // which holds "CODE - Name", while forecast keys are the bare code - so it
    // fired on every correctly coded sheet in the org and never on a real fault.
    // Since parseForecastTab_ now resolves labels against the Budget tab before
    // storing them, this should be unreachable: if it ever appears, a forecast key
    // reached the snapshot without going through resolveForecastLabel_.
    const budgetItems = {};
    (b.lines || []).forEach(l => {
      const code = itemCode_(l.item);
      if (code) budgetItems[code] = true;
    });
    const forecastItems = {};
    ['cost', 'income'].forEach(kind => {
      const map = (b.forecast && b.forecast[kind]) || {};
      Object.keys(map).forEach(key => { forecastItems[String(key).split('||')[0]] = true; });
    });
    Object.keys(forecastItems).forEach(code => {
      if (!budgetItems[code]) {
        add('A9', withBase_(base, { detail: 'Forecast references "' + code +
          '", which has no line on the Budget tab' }));
      }
    });

    // --- B5: contribution arithmetic ---
    var b5 = 0;
    (b.lines || []).forEach(l => {
      if (Math.abs((l.income - l.cost) - l.contribution) > 1) b5++;
    });
    if (b5) {
      add('B5', withBase_(base, { detail: b5 +
        ' line(s) where Contribution does not equal Income minus Cost' }));
    }

    // --- C1-C7: metadata. Every one of these was unimplementable until the sheets
    // started carrying Owner, Status, Funding end and Contribution policy. ---
    const missingKeys = (CONFIG.REQUIRED_META || []).filter(k => !meta[k]);
    if (missingKeys.length) {
      add('C1', withBase_(base, { detail: 'missing: ' + missingKeys.join(', ') }));
    }

    // The folder is what the code believes; the value is what a human wrote. When they
    // disagree, one of them is reading a different story to the dashboard.
    const declaredStatus = clean_(meta['status'] || '').toLowerCase();
    if (declaredStatus && declaredStatus !== b.status) {
      add('C2', withBase_(base, { detail: 'Funding_info says "' + declaredStatus +
        '" but the sheet sits in the ' + b.status + '/ folder, which is what counts' }));
    }

    const declaredName = clean_(meta['funding source'] || '');
    if (declaredName && declaredName !== b.name) {
      add('C3', withBase_(base, { detail: 'Funding_info says "' + declaredName +
        '" but the file is named "' + b.name + '". Actuals join on the file name.' }));
    }

    const reviewed = parseSheetDate_(meta['last reviewed']);
    if (reviewed && now) {
      const days = Math.round((now - reviewed) / 86400000);
      if (days > (CONFIG.STALE_REVIEW_DAYS || 90)) {
        add('C4', withBase_(base, { detail: 'last reviewed ' + days + ' days ago' }));
      }
    }

    const fundingEnd = parseSheetDate_(meta['funding end']);
    if (b.status === 'secured' && fundingEnd && now && fundingEnd < now) {
      add('C5', withBase_(base, { detail: 'ended ' + isoDate_(fundingEnd) +
        ' and is still in secured/' }));
    }

    // The value is reported back exactly as typed, and matched after normalising.
    // A check that accepts "none" and rejects "None" sends somebody hunting through a
    // sheet that was already right, which is worse than no check at all.
    const policyRaw = clean_(meta['contribution policy'] || '');
    if (!policyRaw) {
      add('C6', withBase_(base, { detail: 'no "contribution policy"' }));
    } else if (!(CONFIG.CONTRIBUTION_POLICIES || [])
        .some(re => re.test(normalisePolicy_(policyRaw)))) {
      add('C6', withBase_(base, { detail: '"' + policyRaw + '" is not one of none, ' +
        'per_line, percent_of_income:<n>' }));
    }

    if (b.status === 'proposed' && !meta['decision date'] && (b.lines || []).length) {
      add('C7', withBase_(base, { detail: 'no "decision date"' }));
    }

    // --- G1: secured income beyond the work it pays for ---
    // Two applications for the same thing both landing is a good problem, but it has to
    // surface or the surplus is never reallocated. The same check catches income filed
    // against the wrong milestone, and projected revenue misfiled as secured.
    if (b.status === 'secured') {
      var cost = 0, income = 0;
      (b.lines || []).forEach(l => { cost += l.cost || 0; income += l.income || 0; });
      if (income - cost > 1) {
        add('G1', withBase_(base, { amount: Math.round(income - cost),
          detail: 'secured income ' + Math.round(income) + ' exceeds budgeted cost ' +
            Math.round(cost) + ' by ' + Math.round(income - cost) }));
      }
    }

    // --- G2: a proposed ask with no stated probability ---
    if (b.status === 'proposed' &&
        sourceProbability_(b.status, meta) === null &&
        (b.lines || []).length) {
      add('G2', withBase_(base, { detail: 'no "' + CONFIG.META.probability +
        '" in Funding_info, so this ask is absent from expected income' }));
    }

    // --- G3: cost suppressed because a competing application carries it ---
    var supp = ((ctx || {}).exclusivity || {}).suppressed || {};
    if (supp[b.name]) {
      add('G3', withBase_(base, { detail: 'exclusivity group "' + supp[b.name].group +
        '": the cost is counted on ' + supp[b.name].countedIn + ' instead, so this ' +
        'sheet contributes its ask but not the work behind it' }));
    }
  });

  // --- Cross-source checks. These need every sheet at once, so they sit outside the
  // per-budget loop above. ---
  (function crossSource() {
    const live = (budgets || []).filter(b => (b.lines || []).length);
    const byName = {};
    live.forEach(b => { byName[b.name] = b; });

    // D3: spend with no item code falls out of the quarterly grid entirely.
    let noItem = 0, noItemTotal = 0;
    (actualLines || []).forEach(l => {
      if (l.kind !== 'expense') return;
      if (!itemCode_(l.item)) { noItem++; noItemTotal += Number(l.amount) || 0; }
    });
    if (noItem) {
      add('D3', { detail: noItem + ' expense line(s) carry no Product/Service, so they ' +
        'sit outside the quarterly tracking grid', amount: Math.round(noItemTotal) });
    }

    // D4 / D6: actuals pointing at a source that has no sheet, or at one that has ended.
    // D6 is how a stale repeating payroll journal surfaces; nothing in Xero reports one.
    const orphan = {}, afterEnd = {};
    (actualLines || []).forEach(l => {
      if (l.kind !== 'expense') return;
      const fs = clean_(l.fundingSource || '');
      if (!fs || isArchivedSource_(fs)) return;
      if (!byName[fs]) {
        orphan[fs] = (orphan[fs] || 0) + (Number(l.amount) || 0);
        return;
      }
      const end = parseSheetDate_((byName[fs].metadata || {})['funding end']);
      if (end && l.date && new Date(l.date) > end) {
        afterEnd[fs] = (afterEnd[fs] || 0) + (Number(l.amount) || 0);
      }
    });
    Object.keys(orphan).forEach(fs => {
      add('D4', { fundingSource: fs, amount: Math.round(orphan[fs]),
        detail: 'Xero has spend tagged "' + fs + '" but no budget sheet of that name' });
    });
    Object.keys(afterEnd).forEach(fs => {
      const b = byName[fs];
      add('D6', { fundingSource: fs, project: b.projectFolder,
        owner: (b.metadata || {})['owner'] || '', link: b.sheetUrl || '',
        amount: Math.round(afterEnd[fs]),
        detail: 'spend dated after Funding end ' +
          isoDate_(parseSheetDate_((b.metadata || {})['funding end'])) });
    });

    // Actual spend per source, for D5, E1 and E2.
    const spend = {};
    (actualLines || []).forEach(l => {
      if (l.kind !== 'expense') return;
      const fs = clean_(l.fundingSource || '');
      if (fs) spend[fs] = (spend[fs] || 0) + (Number(l.amount) || 0);
    });

    live.forEach(b => {
      const meta = b.metadata || {};
      const bse = { fundingSource: b.name, project: b.projectFolder,
        owner: meta['owner'] || '', link: b.sheetUrl || '' };
      const cost = (b.lines || []).reduce((a, l) => a + (l.cost || 0), 0);
      const actual = spend[b.name] || 0;

      // What should have been spent by the end of the last finished quarter, by the
      // tracking grid's own rule, forecastOrBaseline_: the Forecast entry where one was
      // written, otherwise the budget baseline. D5 and E2 both judge against this. They
      // used to judge against the funding dates instead, which flagged every grant whose
      // work was scheduled later than its contract.
      let due = 0, dueBy = '';
      if (now) {
        const curQi = qiOfDate_(now);
        const exp = expectedCostByQuarter_(b);
        due = Object.keys(exp).reduce((t, q) => (qiOfLabel_(q) < curQi ? t + exp[q] : t), 0);
        const qs = quarterStartDate_(curQi);
        dueBy = isoDate_(new Date(qs.getFullYear(), qs.getMonth(), 0));
      }

      // D5: a secured grant that should have spent something by now, with nothing coded
      // to it, is almost always a Xero tag that does not match the sheet name. Finished
      // quarters only, so it stays quiet while the first quarter of spend is under way;
      // a misspelt tag is caught sooner than that, by D4.
      if (b.status === 'secured' && actual === 0 && due >= 1) {
        add('D5', withBase_(bse, { amount: Math.round(due),
          detail: Math.round(due) + ' expected by ' + dueBy + ', nothing coded to it at all' }));
      }

      // E1: overspend against the sheet's own budget.
      if (cost > 0 && actual > cost) {
        add('E1', withBase_(bse, { amount: Math.round(actual - cost),
          detail: 'actual ' + Math.round(actual) + ' against budget ' + Math.round(cost) }));
      }

      // E2: underspend against the same expected-to-date figure as D5, once at least half
      // the budget should have been spent and only when the shortfall is wide enough to
      // act on. Secured only, as D5: an application not yet won has nothing to underspend.
      // Spend so far this quarter counts, so a source that has since caught up is not
      // flagged for last quarter's lag.
      if (b.status === 'secured' && cost > 0 && due >= 1) {
        const dueShare = due / cost, spentShare = actual / cost;
        if (dueShare >= (CONFIG.UNDERSPEND_MIN_DUE || 0.5) &&
            (dueShare - spentShare) >= (CONFIG.UNDERSPEND_GAP || 0.25)) {
          add('E2', withBase_(bse, { amount: Math.round(due - actual),
            detail: Math.round(dueShare * 100) + '% of the budget was expected by ' + dueBy +
              ', ' + Math.round(spentShare * 100) + '% has been spent' }));
        }
      }
    });

    // E3: one item code in two sources means one cost billed to two funders. Codes are
    // {SOURCE}_{NNN} precisely so this cannot happen by accident.
    const codeOwners = {};
    live.forEach(b => {
      (b.lines || []).forEach(l => {
        const code = itemCode_(l.item);
        if (!code) return;
        (codeOwners[code] = codeOwners[code] || {})[b.name] = true;
      });
    });
    Object.keys(codeOwners).forEach(code => {
      const owners = Object.keys(codeOwners[code]);
      if (owners.length > 1) {
        add('E3', { detail: 'item code "' + code + '" appears in ' + owners.join(' and ') });
      }
    });

    // E4: the same description budgeted in two sources over overlapping dates. The
    // undeclared twin of an Exclusivity group: G3 reports duplication you declared, this
    // reports duplication you did not.
    const byDesc = {};
    live.forEach(b => {
      (b.lines || []).forEach(l => {
        const d = clean_(l.description || '').toLowerCase();
        if (!d || !l.start || !l.end) return;
        (byDesc[d] = byDesc[d] || []).push({ source: b.name, start: l.start, end: l.end,
          cost: l.cost || 0, group: clean_((b.metadata || {})[CONFIG.META.exclusivityGroup] || '') });
      });
    });
    Object.keys(byDesc).forEach(d => {
      const rows = byDesc[d];
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          if (rows[i].source === rows[j].source) continue;
          // Already declared as alternatives, so G3 covers it. Not a finding twice.
          if (rows[i].group && rows[i].group === rows[j].group) continue;
          if (rows[i].start <= rows[j].end && rows[j].start <= rows[i].end) {
            add('E4', { amount: Math.round(Math.min(rows[i].cost, rows[j].cost)),
              detail: '"' + d + '" is budgeted in both ' + rows[i].source + ' and ' +
                rows[j].source + ' over overlapping dates' });
            return; // one finding per description is enough to act on
          }
        }
      }
    });
  })();

  // --- D1 / D2: Xero coding. An untagged line is silently dropped from totals. ---
  var noProject = 0, noProjectTotal = 0, noSource = 0, noSourceTotal = 0;
  (actualLines || []).forEach(l => {
    if (l.kind !== 'expense') return;
    if (!l.project) { noProject++; noProjectTotal += Number(l.amount) || 0; }
    else if (!l.fundingSource) { noSource++; noSourceTotal += Number(l.amount) || 0; }
  });
  if (noProject) {
    add('D1', { detail: noProject + ' expense line(s) carry no Projects tracking value, ' +
      'so they are excluded from every project and organisation total',
      amount: Math.round(noProjectTotal) });
  }
  if (noSource) {
    add('D2', { detail: noSource + ' expense line(s) carry no Funding source value, ' +
      'so they fall outside the quarterly tracking grid',
      amount: Math.round(noSourceTotal) });
  }

  // --- F: system ---
  if (ctx.xeroConnected === false) {
    add('F1', { detail: 'actuals shown are whatever was last cached' });
  }
  (ctx.secretsMissing || []).forEach(k => {
    add('F3', { detail: 'Script Property "' + k + '" is not set' });
  });
  const excl = ctx.exclusion || { count: 0, total: 0 };
  add('F5', { detail: (budgets || []).length + ' funding source(s) read, ' +
    countLines_(budgets) + ' budget line(s) parsed, ' +
    (actualLines || []).length + ' actual line(s) after excluding ' + excl.count +
    ' on balance-sheet accounts (' + excl.total + ')' });
  const unp = ctx.unposted || { count: 0, total: 0 };
  if (unp.count) {
    add('F6', { detail: unp.count + ' document(s) in draft or awaiting approval, ' +
      'totalling ' + Math.round(unp.total), amount: Math.round(unp.total) });
  }

  out.sort(healthOrder_);
  return out;
}

/** One finding in the shape the panel renders, or null for an id not in the catalogue. */
function finding_(id, fields) {
  const spec = HEALTH_CATALOGUE[id];
  if (!spec) return null; // never let an unknown id break a refresh or a page load
  fields = fields || {};
  return {
    id: id, severity: spec.severity, category: spec.category, title: spec.title,
    action: spec.action,
    detail: fields.detail || '',
    fundingSource: fields.fundingSource || '',
    project: fields.project || '',
    owner: fields.owner || '',
    row: fields.row || null,
    amount: fields.amount || 0,
    link: fields.link || ''
  };
}

/** Most severe first, then value at risk. One comparator so build and serve agree. */
function healthOrder_(a, b) {
  const s = HEALTH_SEVERITY_RANK[a.severity] - HEALTH_SEVERITY_RANK[b.severity];
  if (s !== 0) return s;
  return (b.amount || 0) - (a.amount || 0);
}

// ---- Serve-time findings ---------------------------------------------------
// buildHealth runs inside a refresh, so at that moment the snapshot is fresh by
// definition and a check on its age can only ever pass. A trigger check made there would
// describe the trigger as it was at the last refresh, which is the one moment that tells
// you least: if the trigger has died, there is no refresh to run the check. So these two
// are evaluated when a cached snapshot is served, against the clock and the trigger list
// as they are at that moment.
//
// The refresh trigger was missing for an unknown stretch before 2026-09-21 and nothing
// on the dashboard said so. Every figure on screen was old and looked current.

// One missed run is a hiccup, Apps Script time triggers do occasionally skip. Two is a
// pattern.
const STALE_AFTER_INTERVALS = 2;

/**
 * @param {Object} ctx { now: Date, generatedAt: string, triggerInstalled: boolean|null,
 *                       refreshHours: number }
 *   triggerInstalled null means "could not tell", which must not read as "missing": a
 *   false alarm sends somebody to reinstall a trigger that is fine.
 * @return {Array} findings, most severe first
 */
function serveTimeHealth(ctx) {
  ctx = ctx || {};
  const out = [];
  const refreshHours = ctx.refreshHours || CONFIG.REFRESH_TRIGGER_HOURS;

  if (ctx.triggerInstalled === false) {
    out.push(finding_('F7', { detail: 'no time-based trigger calls refreshSnapshot' }));
  }

  const hours = ageHours_(ctx.generatedAt, ctx.now);
  if (hours !== null && hours > STALE_AFTER_INTERVALS * refreshHours) {
    out.push(finding_('F2', { detail: 'last refreshed ' + ageLabel_(hours) +
      ' ago; the trigger is meant to run every ' + refreshHours + ' hour(s)' }));
  }

  return out.filter(Boolean).sort(healthOrder_);
}

/** Hours between generatedAt and now, or null when either cannot be read. */
function ageHours_(generatedAt, now) {
  const t = Date.parse(generatedAt);
  if (isNaN(t) || !now || typeof now.getTime !== 'function') return null;
  return (now.getTime() - t) / 3600000;
}

function ageLabel_(hours) {
  if (hours < 48) return Math.round(hours) + ' hour(s)';
  return Math.round(hours / 24) + ' day(s)';
}

/** Short strings for the legacy dataFlags list, errors and warnings only. */
function healthToFlags(health) {
  return (health || [])
    .filter(f => f.severity !== 'info')
    .map(f => (f.severity === 'error' ? '[error] ' : '[warning] ') +
      (f.fundingSource ? f.fundingSource + ': ' : '') + f.title +
      (f.detail ? ' - ' + f.detail : ''));
}

/**
 * Fold the spellings a person actually types onto the three policy tokens.
 * Every rule here maps a spelling onto the same meaning, never one meaning onto
 * another: "40%" stays rejected, because it is a different statement from
 * percent_of_income:40 and guessing which was meant is not the checker's job.
 */
function normalisePolicy_(value) {
  return clean_(value).toLowerCase()
    .replace(/[\s-]+/g, '_')  // "Per line" and "per-line" are both per_line
    .replace(/_*:_*/g, ':');  // "percent of income: 40" is percent_of_income:40
}

function withBase_(base, fields) {
  const o = {};
  for (var k in base) o[k] = base[k];
  for (var j in fields) o[j] = fields[j];
  return o;
}

function sumCostWhere_(lines, pred) {
  var t = 0;
  (lines || []).forEach(l => { if (pred(l)) t += Number(l.cost) || 0; });
  return Math.round(t);
}

function countLines_(budgets) {
  var n = 0;
  (budgets || []).forEach(b => { n += ((b.lines || []).length); });
  return n;
}
