// Extract all USD-denominated values from EDGAR companyfacts JSON.
// Handles temporal windowing for rolling Benford analysis.

const VALID_FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A']);
const NAMESPACES = ['us-gaap', 'ifrs-full'];
const ALL_NAMESPACES = ['us-gaap', 'ifrs-full', 'dei']; // dei for employee counts

// Extract ALL USD values from a companyfacts JSON object
export function extractAllUsdValues(facts) {
  if (!facts?.facts) return [];

  const values = [];

  for (const ns of NAMESPACES) {
    const nsFacts = facts.facts[ns];
    if (!nsFacts) continue;

    for (const [tag, tagData] of Object.entries(nsFacts)) {
      const usdEntries = tagData?.units?.USD;
      if (!usdEntries) continue;

      for (const entry of usdEntries) {
        if (!VALID_FORMS.has(entry.form)) continue;
        const val = Math.abs(entry.val);
        if (val === 0) continue;

        values.push({
          value: val,
          tag,
          end: entry.end,
          start: entry.start || null,
          fy: entry.fy,
          fp: entry.fp,
          form: entry.form,
          filed: entry.filed,
        });
      }
    }
  }

  return values;
}

// Extract just the numeric values (for Benford analysis)
export function extractUsdNumbers(facts) {
  return extractAllUsdValues(facts).map(v => v.value);
}

// Extract values within a date window
export function extractUsdValuesForWindow(facts, startDate, endDate) {
  return extractAllUsdValues(facts).filter(v => {
    if (!v.end) return false;
    return v.end >= startDate && v.end <= endDate;
  });
}

// Get the quarter key for a date string: "2023-06-30" → "2023-Q2"
function dateToQuarter(dateStr) {
  if (!dateStr) return null;
  const month = parseInt(dateStr.substring(5, 7));
  const year = dateStr.substring(0, 4);
  const q = Math.ceil(month / 3);
  return `${year}-Q${q}`;
}

// Parse quarter key to sortable number: "2023-Q2" → 2023.25
function quarterToSortKey(qk) {
  const [year, q] = qk.split('-Q');
  return parseInt(year) + (parseInt(q) - 1) * 0.25;
}

// Quarter key to approximate start/end dates
function quarterToDates(qk) {
  const [year, q] = qk.split('-Q');
  const qNum = parseInt(q);
  const startMonth = String((qNum - 1) * 3 + 1).padStart(2, '0');
  const endMonth = String(qNum * 3).padStart(2, '0');
  const endDay = [0, 31, 30, 31, 30][qNum]; // Q1=31Mar, Q2=30Jun, Q3=30Sep, Q4=31Dec
  // Actually: Q1 ends Mar 31, Q2 ends Jun 30, Q3 ends Sep 30, Q4 ends Dec 31
  const endDays = { 1: 31, 2: 30, 3: 30, 4: 31 };
  return {
    start: `${year}-${startMonth}-01`,
    end: `${year}-${endMonth}-${endDays[qNum]}`,
  };
}

// Build rolling windows of N quarters for temporal analysis
export function buildRollingWindows(facts, windowQuarters = 8, slideQuarters = 1) {
  const allValues = extractAllUsdValues(facts);
  if (allValues.length === 0) return [];

  // Group values by quarter
  const byQuarter = {};
  for (const v of allValues) {
    const qk = dateToQuarter(v.end);
    if (!qk) continue;
    if (!byQuarter[qk]) byQuarter[qk] = [];
    byQuarter[qk].push(v.value);
  }

  // Sort quarters chronologically
  const quarters = Object.keys(byQuarter).sort((a, b) => quarterToSortKey(a) - quarterToSortKey(b));

  if (quarters.length < windowQuarters) return [];

  const windows = [];
  for (let i = 0; i <= quarters.length - windowQuarters; i += slideQuarters) {
    const windowQuarterKeys = quarters.slice(i, i + windowQuarters);
    const values = [];
    for (const qk of windowQuarterKeys) {
      values.push(...byQuarter[qk]);
    }
    windows.push({
      label: `${windowQuarterKeys[0]}..${windowQuarterKeys[windowQuarterKeys.length - 1]}`,
      startQuarter: windowQuarterKeys[0],
      endQuarter: windowQuarterKeys[windowQuarterKeys.length - 1],
      values,
      quarterCount: windowQuarterKeys.length,
    });
  }

  return windows;
}

// Extract leading digits of key metrics at a given date for Test 8
export function extractKeyMetricDigits(facts, beforeDate) {
  if (!facts?.facts) return null;

  const findMostRecent = (tags) => {
    for (const ns of NAMESPACES) {
      const nsFacts = facts.facts[ns];
      if (!nsFacts) continue;
      for (const tag of tags) {
        const entries = nsFacts[tag]?.units?.USD;
        if (!entries) continue;
        // Find most recent annual value before the date
        const annual = entries
          .filter(e => VALID_FORMS.has(e.form) && (e.fp === 'FY' || e.form.includes('10-K')) && e.end <= beforeDate && Math.abs(e.val) > 0)
          .sort((a, b) => b.end.localeCompare(a.end));
        if (annual.length > 0) return Math.abs(annual[0].val);
      }
    }
    return null;
  };

  const revenue = findMostRecent(['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet']);
  const assets = findMostRecent(['Assets']);
  const ocf = findMostRecent(['NetCashProvidedByOperatingActivities']);
  const netIncome = findMostRecent(['NetIncomeLoss']);

  const leadingDigit = (n) => n ? parseInt(n.toExponential().charAt(0)) : null;

  return {
    revenue: { value: revenue, leadingDigit: leadingDigit(revenue) },
    totalAssets: { value: assets, leadingDigit: leadingDigit(assets) },
    operatingCashFlow: { value: ocf, leadingDigit: leadingDigit(ocf) },
    netIncome: { value: netIncome, leadingDigit: leadingDigit(netIncome) },
  };
}

// ============================================
// QUARTERLY METRIC EXTRACTION (for nonlinear dynamics tests)
// ============================================

// Tag alternatives for each metric (tried in order)
const METRIC_TAGS = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
  assets: ['Assets'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities'],
  grossProfit: ['GrossProfit'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  employees: ['EntityNumberOfEmployees'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  totalLiabilities: ['Liabilities'],
  operatingExpenses: ['OperatingExpenses', 'CostsAndExpenses'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  rAndD: ['ResearchAndDevelopmentExpense'],
  sga: ['SellingGeneralAndAdministrativeExpense'],
  accountsReceivable: ['AccountsReceivableNetCurrent'],
  inventory: ['InventoryNet'],
  deferredRevenue: ['ContractWithCustomerLiabilityCurrent', 'DeferredRevenueCurrent'],
  goodwill: ['Goodwill'],
  longTermDebt: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'],
  sharesOutstanding: ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'],
  dividendsPerShare: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
};

// Find the best quarterly value for a tag list from companyfacts
function findQuarterlyValues(facts, tagList, useAbsoluteValue = false) {
  if (!facts?.facts) return {};

  const byQuarter = {}; // quarter → { value, end, form, filed }

  const namespacesToSearch = tagList.includes('EntityNumberOfEmployees') ? ALL_NAMESPACES : NAMESPACES;

  for (const ns of namespacesToSearch) {
    const nsFacts = facts.facts[ns];
    if (!nsFacts) continue;

    for (const tag of tagList) {
      const tagData = nsFacts[tag];
      if (!tagData) continue;

      // Check USD units first, then pure (for employee counts)
      const entries = tagData.units?.USD || tagData.units?.pure || tagData.units?.[''] || [];

      for (const entry of entries) {
        if (!VALID_FORMS.has(entry.form)) continue;
        if (entry.val == null) continue;

        const qk = dateToQuarter(entry.end);
        if (!qk) continue;

        const val = useAbsoluteValue ? Math.abs(entry.val) : entry.val;

        // Prefer quarterly filings (10-Q) over annual (10-K) for quarterly granularity
        // But for cumulative metrics, we need to de-cumulate annual filings
        const isQuarterly = entry.fp && entry.fp !== 'FY';
        const existing = byQuarter[qk];

        if (!existing || (isQuarterly && !existing.isQuarterly) || (!existing && !isQuarterly)) {
          byQuarter[qk] = { value: val, end: entry.end, form: entry.form, fp: entry.fp, isQuarterly };
        }
      }
    }
  }

  return byQuarter;
}

// Extract structured quarterly metrics for a company
export function extractQuarterlyMetrics(facts, beforeDate = null) {
  if (!facts?.facts) return [];

  const raw = {};
  for (const [metric, tags] of Object.entries(METRIC_TAGS)) {
    const useAbsVal = ['assets', 'employees', 'equity', 'totalLiabilities', 'goodwill', 'accountsReceivable', 'inventory', 'capex'].includes(metric);
    raw[metric] = findQuarterlyValues(facts, tags, useAbsVal);
  }

  // Collect all quarters that have at least revenue or assets
  const allQuarters = new Set();
  for (const metric of Object.values(raw)) {
    for (const qk of Object.keys(metric)) allQuarters.add(qk);
  }

  const quarters = [...allQuarters]
    .sort((a, b) => quarterToSortKey(a) - quarterToSortKey(b))
    .filter(qk => !beforeDate || qk <= dateToQuarter(beforeDate));

  const result = [];
  for (const qk of quarters) {
    const q = { quarter: qk };
    for (const [metric, qMap] of Object.entries(raw)) {
      q[metric] = qMap[qk]?.value ?? null;
    }

    // Only include quarters that have at least revenue or assets
    if (q.revenue != null || q.assets != null) {
      result.push(q);
    }
  }

  // Add derived metrics
  for (let i = 0; i < result.length; i++) {
    const q = result[i];

    // Operating margin
    q.operatingMargin = (q.revenue && q.operatingIncome != null) ? q.operatingIncome / q.revenue : null;

    // FCF margin (using OCF as proxy)
    q.fcfMargin = (q.revenue && q.ocf != null) ? q.ocf / q.revenue : null;

    // Gross margin
    q.grossMargin = (q.revenue && q.grossProfit != null) ? q.grossProfit / q.revenue : null;

    // YoY revenue growth (4-quarter lag to remove seasonality)
    if (i >= 4 && result[i - 4].revenue > 0 && q.revenue != null) {
      q.revenueGrowthYoY = (q.revenue - result[i - 4].revenue) / Math.abs(result[i - 4].revenue);
    } else {
      q.revenueGrowthYoY = null;
    }
  }

  return result;
}

// Get revenue at or before a date (for maturity segmentation)
export function getRevenueAtDate(facts, date) {
  const metrics = extractQuarterlyMetrics(facts, date);
  // Find most recent quarter with revenue before date
  for (let i = metrics.length - 1; i >= 0; i--) {
    if (metrics[i].revenue != null && metrics[i].revenue > 0) {
      // Annualize quarterly revenue (×4)
      return metrics[i].revenue * 4;
    }
  }
  return null;
}

// Summary stats for extracted data
export function extractionSummary(facts) {
  const values = extractAllUsdValues(facts);
  const numbers = values.map(v => v.value);

  // Count unique quarters
  const quarters = new Set(values.map(v => dateToQuarter(v.end)).filter(Boolean));

  // Date range
  const dates = values.map(v => v.end).filter(Boolean).sort();

  return {
    totalValues: numbers.length,
    uniqueQuarters: quarters.size,
    dateRange: dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'N/A',
    d1Eligible: numbers.length >= 50,
    d1d2Eligible: numbers.length >= 200,
    temporalEligible: quarters.size >= 12, // ~3 years of quarterly data
  };
}

// ============================================
// SEGMENT REVENUE EXTRACTION (for Theory 7: Revenue Entropy)
// ============================================

// Extract segment revenue data from companyfacts JSON.
// Note: companyfacts API provides aggregate segment tags but not dimensional breakdowns.
// We extract distinct segment-related revenue tags as a proxy for segment count and distribution.
const SEGMENT_REVENUE_TAGS = [
  'SegmentReportingInformationRevenueForReportableSegment',
  'RevenueFromExternalCustomers',
  'SegmentReportingInformationRevenue',
];

export function extractSegmentRevenues(facts, beforeDate = null) {
  if (!facts?.facts) return null;

  // Approach: For each fiscal year, collect all distinct segment revenue values
  // reported under segment tags. Each unique accession+value pair for the same
  // period likely represents a different segment.
  const byYear = {};

  for (const ns of NAMESPACES) {
    const nsFacts = facts.facts[ns];
    if (!nsFacts) continue;

    for (const tag of SEGMENT_REVENUE_TAGS) {
      const tagData = nsFacts[tag];
      if (!tagData) continue;

      const entries = tagData.units?.USD;
      if (!entries) continue;

      for (const entry of entries) {
        if (!VALID_FORMS.has(entry.form)) continue;
        if (entry.val == null || entry.val <= 0) continue;
        if (entry.fp !== 'FY' && !entry.form.includes('10-K')) continue;
        if (beforeDate && entry.end > beforeDate) continue;

        const year = entry.fy || entry.end?.substring(0, 4);
        if (!year) continue;

        if (!byYear[year]) byYear[year] = new Map();
        // Use accession number + value as unique key to deduplicate
        const key = `${entry.accn}-${entry.val}`;
        byYear[year].set(key, entry.val);
      }
    }
  }

  // Find the most recent year with multiple segment values
  const years = Object.keys(byYear).sort().reverse();
  for (const year of years) {
    const segments = [...byYear[year].values()];
    if (segments.length >= 2) {
      return { year, segments, nSegments: segments.length };
    }
  }

  return null;
}
