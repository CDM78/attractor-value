#!/usr/bin/env node
// Session 4.5 Part 1: Price Checkpoints
// Computes 12 checkpoints per case (T+3 through T+36 months)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const CAL = resolve(import.meta.dirname, '..');
const CHECKPOINTS_DIR = join(CAL, 'cases', 'checkpoints');
const RESULTS_DIR = join(CAL, 'tests', 'results');

// ============================================================
// HELPERS
// ============================================================

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

function saveResume(phase, done, total) {
  writeFileSync(join(CAL, 'resume-state.json'), JSON.stringify({
    session: '4.5',
    phase,
    completed_parts: [],
    price_checkpoints_done: done,
    price_checkpoints_total: total,
    timestamp: new Date().toISOString(),
  }, null, 2));
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('SESSION 4.5 PART 1: PRICE CHECKPOINTS');
  console.log('='.repeat(60));

  const { getCompanyPrices, getSP500Prices, getPriceOnDate } = await import('../warehouse/connectors/yahoo-prices.js');

  // Load universe
  const universe = JSON.parse(readFileSync(join(CAL, 'cases', 'universe.json'), 'utf-8'));
  const allCases = Object.values(universe.cases);
  console.log(`Total cases: ${allCases.length}`);

  // Get unique tickers
  const tickers = [...new Set(allCases.map(c => c.ticker))];
  console.log(`Unique tickers: ${tickers.length}`);

  // Determine global date range for S&P 500
  const entryDates = allCases.map(c => c.entry_date).sort();
  const globalStart = addMonths(entryDates[0], -12);
  const globalEnd = addMonths(entryDates[entryDates.length - 1], 37);
  console.log(`Date range: ${globalStart} to ${globalEnd}`);

  // Step 1: Fetch S&P 500 prices
  console.log('\n--- Step 1: Fetching S&P 500 daily prices ---');
  let sp500 = await getSP500Prices(globalStart, globalEnd);
  console.log(`S&P 500: ${sp500.length} trading days loaded`);

  // Step 2: Fetch company prices and compute checkpoints
  console.log('\n--- Step 2: Fetching company prices & computing checkpoints ---');
  if (!existsSync(CHECKPOINTS_DIR)) mkdirSync(CHECKPOINTS_DIR, { recursive: true });

  // Group cases by ticker to avoid redundant fetches
  const casesByTicker = {};
  for (const c of allCases) {
    if (!casesByTicker[c.ticker]) casesByTicker[c.ticker] = [];
    casesByTicker[c.ticker].push(c);
  }

  const CHECKPOINT_MONTHS = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
  let processed = 0;
  let complete12 = 0;
  let partial = 0;
  let noData = 0;
  const trajCounts = {};
  const allSummaries = [];

  const tickerList = Object.keys(casesByTicker);
  for (let t = 0; t < tickerList.length; t++) {
    const ticker = tickerList[t];
    const cases = casesByTicker[ticker];

    // Determine date range for this ticker (across all its cases)
    const earliest = cases.reduce((m, c) => c.entry_date < m ? c.entry_date : m, cases[0].entry_date);
    const latest = cases.reduce((m, c) => c.entry_date > m ? c.entry_date : m, cases[0].entry_date);
    const fetchStart = addMonths(earliest, -12);
    const fetchEnd = addMonths(latest, 37);

    // Fetch prices (cached if available)
    let prices;
    try {
      prices = await getCompanyPrices(ticker, fetchStart, fetchEnd);
    } catch (err) {
      prices = [];
    }

    if ((t + 1) % 50 === 0 || t === tickerList.length - 1) {
      process.stdout.write(`\r  Tickers: ${t + 1}/${tickerList.length} | Cases: ${processed}/${allCases.length} | Complete: ${complete12} | No data: ${noData}`);
    }

    for (const c of cases) {
      processed++;
      const cpPath = join(CHECKPOINTS_DIR, `${c.case_id}.json`);

      // Get entry price from prices or case record
      const entryPriceRec = getPriceOnDate(prices, c.entry_date);
      const entrySP = getPriceOnDate(sp500, c.entry_date);

      if (!entryPriceRec || !entrySP) {
        noData++;
        allSummaries.push({ case_id: c.case_id, ticker, status: 'no_data' });
        continue;
      }

      const entryPrice = entryPriceRec.adjClose;
      const entrySPLevel = entrySP.adjClose;

      const checkpoints = [];
      for (const months of CHECKPOINT_MONTHS) {
        const cpDate = addMonths(c.entry_date, months);
        const stockRec = getPriceOnDate(prices, cpDate);
        const spRec = getPriceOnDate(sp500, cpDate);

        if (stockRec && spRec && stockRec.date > c.entry_date && spRec.date > c.entry_date) {
          const stockReturn = (stockRec.adjClose / entryPrice) - 1;
          const spReturn = (spRec.adjClose / entrySPLevel) - 1;

          checkpoints.push({
            months,
            date: cpDate,
            actual_date: stockRec.date,
            stock_price: stockRec.adjClose,
            sp500_level: spRec.adjClose,
            interim_return: Math.round(stockReturn * 10000) / 10000,
            sp500_return: Math.round(spReturn * 10000) / 10000,
            alpha: Math.round((stockReturn - spReturn) * 10000) / 10000,
          });
        }
      }

      const isComplete = checkpoints.length === 12;
      if (isComplete) complete12++;
      else if (checkpoints.length > 0) partial++;
      else noData++;

      // Classify trajectory
      let trajectory = null;
      if (checkpoints.length >= 10) {
        trajectory = classifyTrajectory(checkpoints, c.outcome?.classification);
      }
      if (trajectory) trajCounts[trajectory] = (trajCounts[trajectory] || 0) + 1;

      const cpData = {
        case_id: c.case_id,
        ticker,
        entry_date: c.entry_date,
        entry_price: entryPrice,
        entry_sp500: entrySPLevel,
        outcome: c.outcome?.classification,
        forward_return_3yr: c.outcome?.forward_return_3yr,
        checkpoints,
        checkpoint_count: checkpoints.length,
        trajectory,
      };

      writeFileSync(cpPath, JSON.stringify(cpData, null, 2));
      allSummaries.push({
        case_id: c.case_id,
        ticker,
        status: isComplete ? 'complete' : checkpoints.length > 0 ? 'partial' : 'no_data',
        checkpoint_count: checkpoints.length,
        trajectory,
      });
    }

    // Save resume every 100 tickers
    if ((t + 1) % 100 === 0) {
      saveResume(`price_checkpoints: ${t + 1}/${tickerList.length} tickers`, processed, allCases.length);
    }
  }

  console.log(`\n\nCheckpoints computed for ${processed} cases`);

  // Step 4: Coverage report
  console.log('\n--- Step 4: Coverage Report ---');
  const report = generateReport(allSummaries, allCases.length, complete12, partial, noData, trajCounts);

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, 'price-checkpoints-report-2026-03-26.md'), report);
  console.log(report);

  // Save final state
  writeFileSync(join(RESULTS_DIR, 'price-checkpoint-summaries.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    total: allCases.length,
    complete: complete12,
    partial,
    noData,
    trajectories: trajCounts,
    summaries: allSummaries,
  }, null, 2));
}

// ============================================================
// TRAJECTORY CLASSIFICATION
// ============================================================

function classifyTrajectory(checkpoints, outcome) {
  const returns = checkpoints.map(c => c.interim_return);
  const finalReturn = returns[returns.length - 1] || 0;
  const maxReturn = Math.max(...returns);
  const minReturn = Math.min(...returns);

  // Max drawdown from any peak
  let maxDrawdown = 0;
  let peak = returns[0];
  for (const r of returns) {
    if (r > peak) peak = r;
    const dd = peak > 0 ? (r - peak) / (1 + peak) : r - peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  // Check for sharp 3-month drops
  let hasSharpDrop = false;
  for (let i = 1; i < returns.length; i++) {
    const threeMonthChange = returns[i] - returns[i - 1];
    if (threeMonthChange < -0.30) hasSharpDrop = true;
  }

  // Dead money
  if (Math.abs(finalReturn) < 0.10) return 'dead_money';

  // Winner trajectories
  if (outcome === 'winner' || finalReturn > 0.20) {
    if (maxDrawdown > -0.20) return 'steady_winner';
    if (maxDrawdown < -0.25 && finalReturn > 0.20) return 'recovery_winner';
    if (maxReturn > 0.50 && (maxReturn - finalReturn) > 0.25) return 'peaked_winner';
    return 'steady_winner';
  }

  // Trap trajectories
  if (outcome === 'trap' || finalReturn < -0.20) {
    if (hasSharpDrop) return 'sharp_trap';
    return 'slow_trap';
  }

  // Mixed / underperform
  if (finalReturn < -0.10) return 'slow_trap';
  return 'dead_money';
}

// ============================================================
// REPORT
// ============================================================

function generateReport(summaries, total, complete, partial, noData, trajCounts) {
  const lines = [
    '# Price Checkpoint Coverage Report',
    `**Date**: 2026-03-26`,
    '',
    '```',
    'PRICE CHECKPOINT COVERAGE',
    '==========================',
    `Total cases: ${total}`,
    `Cases with complete 12-checkpoint prices: ${complete}`,
    `Cases with partial checkpoints: ${partial}`,
    `Cases with no price data: ${noData}`,
    `Coverage rate: ${(100 * (complete + partial) / total).toFixed(1)}%`,
    '',
    'Trajectory distribution:',
  ];

  const trajOrder = ['steady_winner', 'recovery_winner', 'peaked_winner', 'slow_trap', 'sharp_trap', 'dead_money'];
  for (const t of trajOrder) {
    lines.push(`  ${t.padEnd(20)} ${(trajCounts[t] || 0)}`);
  }
  lines.push('```');

  // By partition
  const byPartition = {};
  for (const s of summaries) {
    // We'd need partition data; skip for now
  }

  return lines.join('\n');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
