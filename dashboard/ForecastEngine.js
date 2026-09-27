/**
 * ForecastEngine.js
 * Pure forecasting math, ported from create_xero_budget_project.js and reshaped
 * into side-effect-free functions that operate on parsed budget lines rather than
 * live spreadsheets. No SpreadsheetApp / DriveApp here — that makes it unit-testable.
 *
 * A budget line is: { account, start: Date, end: Date, amount: Number,
 *                     milestone, item, project }
 *
 * The three behaviours preserved from the original script:
 *   1. day-weighted distribution of each line across the months it spans
 *   2. overhead (account 500) split across quarters weighted by expense load
 *   3. grant revenue recognition: recognise income as expense is incurred,
 *      defer the remainder (FIFO by income date).
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
