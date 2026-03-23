// Extract all USD-denominated values from EDGAR companyfacts JSON.
// Handles temporal windowing for rolling Benford analysis.

const VALID_FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A']);
const NAMESPACES = ['us-gaap', 'ifrs-full'];

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
