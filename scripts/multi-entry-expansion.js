#!/usr/bin/env node
// Generate multiple entry date cases for existing calibration companies.
// Rules: entries 3+ years apart, max 3 per company, each with own outcome classification.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, fetchFactsForTicker, hasCachedFacts, getCikForTicker } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, getRevenueAtDate } from './lib/edgar-extractor.js';

const CAL_DIR = resolve(import.meta.dirname, '../../av-calibration-tool/data');
const EXPANSION_DIR = resolve(import.meta.dirname, '../data/expansion');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('Multi-Entry Date Expansion');
  console.log('='.repeat(50));

  // Load existing tier 1-4 cases
  const files = ['tier1-stable-value.json', 'tier2-crisis-dislocation.json', 'tier3-emerging-dks.json', 'tier4-regime-transition.json'];
  const existingCases = [];
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(resolve(CAL_DIR, file), 'utf-8'));
      for (const c of data.cases || []) {
        const tier = c.tier || parseInt(file.match(/tier(\d)/)?.[1]) || 0;
        const entryDate = c.entry?.date || c.entry_date;
        existingCases.push({ ticker: c.ticker, company: c.company_name || c.company, entryDate, tier, outcome: c.outcome || c.outcome_class, sector: c.entry?.sector || c.sector });
      }
    } catch { /* skip */ }
  }

  console.log(`Existing cases: ${existingCases.length}`);

  // Get unique tickers
  const tickerMap = {};
  for (const c of existingCases) {
    if (!tickerMap[c.ticker]) tickerMap[c.ticker] = [];
    tickerMap[c.ticker].push(c);
  }

  console.log(`Unique tickers: ${Object.keys(tickerMap).length}`);

  await ensureCikCache();

  // For each ticker, find possible additional entry dates
  const newCases = [];
  const entryYears = [2012, 2015, 2018, 2021]; // Possible entry years (3+ years apart)
  let processed = 0, skipped = 0;

  for (const [ticker, cases] of Object.entries(tickerMap)) {
    const existingDates = cases.map(c => c.entryDate).filter(Boolean);
    const existingYears = existingDates.map(d => parseInt(d.substring(0, 4)));

    // Find entry years that are 3+ years from any existing entry
    const viableYears = entryYears.filter(y => {
      return existingYears.every(ey => Math.abs(y - ey) >= 3);
    });

    if (viableYears.length === 0) { skipped++; continue; }

    // Check EDGAR data availability
    const cik = getCikForTicker(ticker);
    if (!cik || (DRY_RUN && !hasCachedFacts(cik))) { skipped++; continue; }

    const result = await fetchFactsForTicker(ticker, {});
    if (!result.facts) { skipped++; continue; }

    const qm = extractQuarterlyMetrics(result.facts);
    if (qm.length < 8) { skipped++; continue; }

    // Find the earliest and latest quarters
    const quarters = qm.map(q => q.quarter).sort();
    const earliestQuarter = quarters[0];
    const latestQuarter = quarters[quarters.length - 1];

    for (const year of viableYears.slice(0, 3 - cases.length)) { // Max 3 total entries
      const entryDate = `${year}-06-15`; // Mid-year entry
      const entryQuarter = `${year}-Q2`;

      // Check we have 8+ quarters before this date
      const quartersBefore = qm.filter(q => q.quarter <= entryQuarter).length;
      if (quartersBefore < 8) continue;

      // Revenue > $50M
      const rev = getRevenueAtDate(result.facts, entryDate);
      if (rev != null && rev < 50_000_000) continue;

      // Compute 3-year forward return
      const threeYearsLater = `${year + 3}-06-15`;
      const ret = await compute3YearReturn(ticker, entryDate, threeYearsLater);
      if (!ret) continue;

      // Get S&P 500 return
      const sp500Ret = await compute3YearReturn('^GSPC', entryDate, threeYearsLater);

      // Classify
      let outcome;
      if (sp500Ret && ret.return3yr > sp500Ret.return3yr + 0.20) outcome = 'winner';
      else if (ret.return3yr < 0) outcome = 'trap';
      else if (sp500Ret && ret.return3yr < sp500Ret.return3yr) outcome = 'underperform';
      else outcome = 'mixed';

      newCases.push({
        case_id: `T6-${String(newCases.length + 1).padStart(3, '0')}`,
        ticker,
        company_name: cases[0].company || ticker,
        tier: 6,
        dataset_role: 'multi-entry',
        outcome,
        entry: {
          date: entryDate,
          price: ret.entryPrice,
          sector: cases[0].sector,
        },
        forward_returns: {
          return_3yr: Math.round(ret.return3yr * 1000) / 1000,
          sp500_return_3yr: sp500Ret ? Math.round(sp500Ret.return3yr * 1000) / 1000 : null,
        },
        source: {
          event_type: 'multi_entry',
          original_entry_dates: existingDates,
          quarters_available: quartersBefore,
          revenue_at_event: rev,
        },
      });
    }

    processed++;
    if (processed % 20 === 0) process.stdout.write(`  ${processed} tickers processed, ${newCases.length} new cases...\r`);
  }

  console.log(`\nProcessed: ${processed}, Skipped: ${skipped}`);
  console.log(`New multi-entry cases: ${newCases.length}`);

  if (newCases.length === 0) {
    console.log('No new cases generated.');
    return;
  }

  const outcomes = { winner: 0, trap: 0, underperform: 0, mixed: 0 };
  for (const c of newCases) outcomes[c.outcome]++;
  console.log(`  Winners: ${outcomes.winner}, Traps: ${outcomes.trap}, Underperform: ${outcomes.underperform}, Mixed: ${outcomes.mixed}`);

  // Save
  const dataset = {
    metadata: {
      tier: 6,
      dataset_role: 'multi-entry expansion',
      source: 'Multiple entry dates for existing calibration companies',
      case_count: newCases.length,
      ...outcomes,
      generated: new Date().toISOString(),
    },
    cases: newCases,
  };

  const outPath = resolve(CAL_DIR, 'tier6-multi-entry.json');
  writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  console.log(`Saved to ${outPath}`);
}

const priceCache = {};

async function compute3YearReturn(ticker, entryDate, exitDate) {
  const cacheKey = `${ticker}-${entryDate}-${exitDate}`;
  if (priceCache[cacheKey]) return priceCache[cacheKey];

  try {
    const entryTs = Math.floor(new Date(entryDate).getTime() / 1000) - 86400 * 7;
    const exitTs = Math.floor(new Date(exitDate).getTime() / 1000) + 86400 * 7;

    await new Promise(r => setTimeout(r, 200));
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${entryTs}&period2=${exitTs}&interval=1d&includeAdjustedClose=true`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result?.timestamp || !result?.indicators?.adjclose?.[0]?.adjclose) return null;

    const timestamps = result.timestamp;
    const closes = result.indicators.adjclose[0].adjclose;

    const entryTarget = new Date(entryDate).getTime() / 1000;
    const exitTarget = new Date(exitDate).getTime() / 1000;

    let entryPrice = null, exitPrice = null;
    let entryDiff = Infinity, exitDiff = Infinity;

    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      const d1 = Math.abs(timestamps[i] - entryTarget);
      const d2 = Math.abs(timestamps[i] - exitTarget);
      if (d1 < entryDiff && d1 < 14 * 86400) { entryDiff = d1; entryPrice = closes[i]; }
      if (d2 < exitDiff && d2 < 14 * 86400) { exitDiff = d2; exitPrice = closes[i]; }
    }

    if (!entryPrice || !exitPrice) return null;
    const return3yr = (exitPrice - entryPrice) / entryPrice;

    const result2 = { entryPrice, exitPrice, return3yr };
    priceCache[cacheKey] = result2;
    return result2;
  } catch { return null; }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
