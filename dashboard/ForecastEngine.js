/**
 * ForecastEngine.js
 * Pure forecasting maths over parsed budget lines. No SpreadsheetApp or DriveApp here,
 * which is what makes it unit-testable. A budget line is the shape BudgetReader produces:
 * { description, start, end, cost, income, contribution, milestone, item, project }.
 *
 * It does three things: day-weighted distribution of each line's Cost and Income across
 * the months it spans; financial-year quarter labels and indexes; and the tracking grid's
 * rule for what a quarter is expected to cost, forecastOrBaseline_.
 *
 * The day-weighting came from an earlier account-keyed budget script, removed on
 * 2026-09-29. That script also split an overhead account across quarters and deferred
 * grant income; neither survived into the cockpit, which derives overhead from each
 * sheet's Contribution policy instead (contributionRate_ in Aggregator.js).
 */

const DateMath = {
  monthKey(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  },
  firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); },
  lastOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); },

  monthsBetween(start, end) {
    const out = [];
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= last) { out.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }
    return out;
  },

  /** Inclusive overlap in days between [aStart,aEnd] and [bStart,bEnd]. */
  overlapDays(aStart, aEnd, bStart, bEnd) {
    const start = Math.max(aStart.getTime(), bStart.getTime());
    const end = Math.min(aEnd.getTime(), bEnd.getTime());
    return Math.max(0, (end - start) / 86400000 + 1);
  },

  quartersBetween(start, end) {
    const quarters = [];
    for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
      for (let q = 1; q <= 4; q++) {
        const qStart = new Date(y, (q - 1) * 3, 1);
        const qEnd = new Date(y, q * 3, 0);
        if (qStart > end) break;
        if (qEnd >= start) quarters.push({ label: y + ' Q' + q, start: qStart, end: qEnd });
      }
    }
    return quarters;
  }
};

// ---- financial-year quarter helpers (for the forecast/tracking layer) ------
// Quarters follow the organisation's financial year (FY starts in
// CONFIG.FINANCIAL_YEAR_START_MONTH, default April). A quarter is identified
// internally by a sortable integer index `qi`, and labelled like "25/26 Q1"
// (the FY running Apr 2025 - Mar 2026, first quarter Apr-Jun).

function fyStartMonth_() { return CONFIG.FINANCIAL_YEAR_START_MONTH || 4; } // 1-based

/** Quarter index (sortable int) containing a Date. */
function qiOfDate_(date) {
  const fs = fyStartMonth_();
  const m1 = date.getMonth() + 1;                 // 1-based month
  const offset = ((m1 - fs) + 12) % 12;           // months since FY start
  const q = Math.floor(offset / 3);               // 0..3
  const fyStartYear = (m1 >= fs) ? date.getFullYear() : date.getFullYear() - 1;
  return fyStartYear * 4 + q;
}

function qiOfMonthKey_(monthKey) {
  const p = monthKey.split('-');
  return qiOfDate_(new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1));
}

/** "25/26 Q1" label for a quarter index. */
function labelOfQi_(qi) {
  const fyStartYear = Math.floor(qi / 4);
  const q = (qi % 4) + 1;
  const a = ('0' + (fyStartYear % 100)).slice(-2);
  const b = ('0' + ((fyStartYear + 1) % 100)).slice(-2);
  return a + '/' + b + ' Q' + q;
}

/** Parse a "25/26 Q1" label back to its quarter index. */
function qiOfLabel_(label) {
  const m = /^(\d{2})\/(\d{2}) Q([1-4])$/.exec(label);
  if (!m) return 0;
  return (2000 + parseInt(m[1], 10)) * 4 + (parseInt(m[3], 10) - 1);
}

/** First day of quarter index `qi`. Date rolls month 12+ into the next year. */
function quarterStartDate_(qi) {
  return new Date(Math.floor(qi / 4), fyStartMonth_() - 1 + 3 * (qi % 4), 1);
}

function quarterOfMonthKey_(monthKey) { return labelOfQi_(qiOfMonthKey_(monthKey)); }
function currentQuarterLabel(date) { return labelOfQi_(qiOfDate_(date || new Date())); }
function quarterSortNum(label) { return qiOfLabel_(label); }

/** Short financial-year label for a FY-start year, e.g. 2025 -> "25/26". */
function fyLabel_(fyStartYear) {
  return ('0' + (fyStartYear % 100)).slice(-2) + '/' + ('0' + ((fyStartYear + 1) % 100)).slice(-2);
}

/** The financial-year bounds containing `date`. */
function fyBounds_(date) {
  const fs = fyStartMonth_();
  const fyStartYear = Math.floor(qiOfDate_(date || new Date()) / 4);
  return {
    startYear: fyStartYear,
    label: fyLabel_(fyStartYear),
    start: new Date(fyStartYear, fs - 1, 1),
    end: new Date(fyStartYear + 1, fs - 1, 0) // last day before the next FY starts
  };
}

/** Roll a { 'YYYY-MM': n } month map up into FY-quarter labels. */
function bucketToQuarters(monthMap) {
  const out = {};
  Object.keys(monthMap).forEach(k => {
    const ql = quarterOfMonthKey_(k);
    out[ql] = (out[ql] || 0) + monthMap[k];
  });
  return out;
}

/**
 * Normalise an inventory-item string to its Xero product code so budgets and
 * actuals join on one key. Budget cells read "WW_25_TOI_002 - General
 * management"; Xero line items are already the code "WW_25_TOI_002".
 */
function itemCode_(value) {
  return String(value == null ? '' : value).split(' - ')[0].trim();
}

/**
 * Day-weighted distribution of a numeric field (`cost` or `income`) across the
 * months each line spans, into { monthKey: amount }.
 */
function distributeByMonth_(lines, field) {
  const byMonth = {};
  lines.forEach(l => {
    const amount = l[field];
    if (!l.start || !l.end || !amount) return;
    const totalDays = (l.end - l.start) / 86400000 + 1;
    DateMath.monthsBetween(l.start, l.end).forEach(m => {
      const days = DateMath.overlapDays(l.start, l.end, DateMath.firstOfMonth(m), DateMath.lastOfMonth(m));
      const key = DateMath.monthKey(m);
      byMonth[key] = (byMonth[key] || 0) + (amount * days) / totalDays;
    });
  });
  return byMonth;
}

/**
 * One quarter's expected figure: the Forecast-tab entry where one was written, a 0
 * included, otherwise the budget baseline. A blank cell is not an entry, so an
 * unmaintained Forecast tab means "the budget is still our best estimate", never
 * "nothing". The single statement of the rule, used by the tracking grid and by health
 * check D5, so a finding cannot contradict the grid it sends you to.
 */
function forecastOrBaseline_(forecast, baseline, q) {
  return (forecast && forecast[q] !== undefined) ? forecast[q] : ((baseline && baseline[q]) || 0);
}

/**
 * What a funding source expects to spend in each FY quarter: forecastOrBaseline_ per
 * item, summed. Items are grouped exactly as buildTracking_ groups them.
 */
function expectedCostByQuarter_(src) {
  const fc = (src && src.forecast && src.forecast.cost) || {};
  const byItem = {};
  ((src && src.lines) || []).forEach(l => {
    const code = itemCode_(l.item) || ('(' + (l.milestone || 'unassigned') + ')');
    (byItem[code] = byItem[code] || []).push(l);
  });
  const out = {};
  Object.keys(byItem).forEach(code => {
    const base = bucketToQuarters(distributeByMonth_(byItem[code], 'cost'));
    const entered = {};
    Object.keys(fc).forEach(k => {
      const cut = k.indexOf('||');
      if (k.slice(0, cut) === code) entered[k.slice(cut + 2)] = fc[k];
    });
    const quarters = {};
    Object.keys(base).concat(Object.keys(entered)).forEach(q => { quarters[q] = true; });
    Object.keys(quarters).forEach(q => {
      out[q] = (out[q] || 0) + forecastOrBaseline_(entered, base, q);
    });
  });
  return out;
}

/**
 * A Forecast tab with its blanks resolved. A milestone row with any number in it is the
 * whole plan for the quarters its section has columns for, so its blank cells become 0.
 * A row left entirely blank keeps meaning "the budget still stands" and gains nothing.
 *
 * Needs `rowQuarters`, the columns each row with an entry sat under, which
 * parseForecastTab_ records. Without it the forecast comes back unchanged.
 */
function ownedForecast_(forecast) {
  const f = forecast || {};
  const out = { cost: Object.assign({}, f.cost || {}), income: Object.assign({}, f.income || {}),
    comments: f.comments || {}, rowQuarters: f.rowQuarters };
  const rq = f.rowQuarters || {};
  ['cost', 'income'].forEach(kind => {
    const rows = rq[kind] || {};
    Object.keys(rows).forEach(code => {
      rows[code].forEach(q => {
        const key = code + '||' + q;
        if (out[kind][key] === undefined) out[kind][key] = 0;
      });
    });
  });
  return out;
}

/** First and last day of quarter index `qi`. */
function quarterBounds_(qi) {
  const s = quarterStartDate_(qi);
  return { start: s, end: new Date(s.getFullYear(), s.getMonth() + 3, 0) };
}

/**
 * The plan for one funding source as budget lines: the Budget tab's lines, with every
 * quarter a Forecast entry covers replaced by that entry.
 *
 * The Budget tab is the budget as agreed with the funder and stays the baseline the
 * tracking grid compares against. Once a source is under way its Forecast tab, quarter by
 * quarter, is the plan, so everything that shows what is expected when (the Overview,
 * runway, the planner and the five-year plan) reads these lines instead.
 *
 * A quarter's forecast is shared between a milestone's lines in proportion to each
 * line's budget for that field, or evenly when the milestone budgets none of it, and
 * becomes a line spanning the whole quarter. The rest of each line keeps its Budget-tab
 * timing. A line with nothing forecast is returned untouched, so a source with no
 * Forecast tab plans exactly what it budgeted.
 *
 * Pass a forecast already resolved by ownedForecast_; blanks are otherwise "budget".
 */
function plannedLines_(lines, forecast) {
  const fc = forecast || {};
  const byCode = {};
  (lines || []).forEach(l => {
    const code = itemCode_(l.item);
    if (code) (byCode[code] = byCode[code] || []).push(l);
  });
  // code -> kind -> { quarter label: amount } for that code's forecast entries
  const entries = {};
  ['cost', 'income'].forEach(kind => {
    Object.keys(fc[kind] || {}).forEach(k => {
      const cut = k.indexOf('||');
      const code = k.slice(0, cut);
      if (!byCode[code]) return;
      const e = (entries[code] = entries[code] || { cost: {}, income: {} });
      e[kind][k.slice(cut + 2)] = fc[kind][k];
    });
  });

  const out = [];
  (lines || []).forEach(l => {
    const code = itemCode_(l.item);
    const e = entries[code];
    if (!e || !l.start || !l.end) { out.push(l); return; }
    const pieces = {}; // quarter index -> { cost, income } for the whole quarter or a part
    const piece = (qi, start, end) => {
      const key = qi + '|' + start.getTime() + '|' + end.getTime();
      return pieces[key] || (pieces[key] = { qi: qi, start: start, end: end, cost: 0, income: 0 });
    };
    const totalDays = (l.end - l.start) / 86400000 + 1;
    ['cost', 'income'].forEach(kind => {
      const own = e[kind];
      // The Budget-tab timing, for the quarters nothing was forecast in.
      if (l[kind]) {
        for (let qi = qiOfDate_(l.start); qi <= qiOfDate_(l.end); qi++) {
          if (own[labelOfQi_(qi)] !== undefined) continue;
          const b = quarterBounds_(qi);
          const start = l.start > b.start ? l.start : b.start;
          const end = l.end < b.end ? l.end : b.end;
          const days = DateMath.overlapDays(l.start, l.end, b.start, b.end);
          if (days > 0) piece(qi, start, end)[kind] += l[kind] * days / totalDays;
        }
      }
      // The forecast, shared across the milestone's lines.
      const siblings = byCode[code];
      const budgeted = siblings.reduce((t, s) => t + (Number(s[kind]) || 0), 0);
      const share = budgeted ? (Number(l[kind]) || 0) / budgeted : 1 / siblings.length;
      Object.keys(own).forEach(q => {
        const amount = own[q] * share;
        if (!amount) return;
        const qi = qiOfLabel_(q);
        const b = quarterBounds_(qi);
        piece(qi, b.start, b.end)[kind] += amount;
      });
    });
    Object.keys(pieces).map(k => pieces[k]).sort((a, b) => a.start - b.start).forEach(p => {
      if (!p.cost && !p.income) return;
      out.push(Object.assign({}, l, { start: p.start, end: p.end, cost: p.cost,
        income: p.income, contribution: p.income - p.cost }));
    });
  });
  return out;
}

/**
 * Budgets as planned: each source's lines through plannedLines_, and its forecast with
 * blanks resolved. The Budget tab's own lines stay on `budgetLines` for anything that
 * judges against the agreed budget.
 */
function planBudgets_(budgets) {
  return (budgets || []).map(src => {
    const forecast = ownedForecast_(src.forecast);
    return Object.assign({}, src, { forecast: forecast, budgetLines: src.lines,
      lines: plannedLines_(src.lines, forecast) });
  });
}

/**
 * Top-level: compute the forecast bundle for one funding source's budget lines.
 * The funding-source `Budget` tab is keyed on milestone, not chart-of-accounts:
 *   expense = day-weighted `Cost`, income = day-weighted `Income`.
 * (`Contribution` = Income − Cost is the margin that funds General/overhead;
 *  it's already embedded in Income, so we don't double-count it here.)
 */
function computeFundingSourceForecast(lines) {
  const expenseByMonth = distributeByMonth_(lines, 'cost');
  const incomeByMonth = distributeByMonth_(lines, 'income');
  const sum = obj => Object.keys(obj).reduce((t, k) => t + obj[k], 0);
  return {
    expenseByMonth, incomeByMonth,
    totalBudgetExpense: sum(expenseByMonth),
    totalBudgetIncome: sum(incomeByMonth),
    totalContribution: sum(distributeByMonth_(lines, 'contribution'))
  };
}
