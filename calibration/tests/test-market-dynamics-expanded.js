#!/usr/bin/env node

// Expanded Market Dynamics Discrimination Test
// Validates SI theta and SI beta on 200+ cases.
// Adds: Zipf velocity (sector-relative), volume Benford, institutional flows.
//
// Data sources:
// - FINRA: SI time series (bulk API, 1 call/ticker)
// - Yahoo Finance: daily volume history
// - FRED: credit spread (already in warehouse)
// - EDGAR: 13F institutional ownership (SC 13D/G)
//
// Caches fetched data to avoid re-fetching on re-runs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';

import { spearmanCorrelation, pearsonCorrelation, quintileAnalysis, crossValidate, analyze, registerTest } from './testing-framework.js';
import { computeAllSignals, extractTestableScores, siZipfVelocity, buildSectorSIRanking, volumeBenford } from '../warehouse/connectors/market-dynamics.js';
import { getCreditSpreadForCase } from '../warehouse/connectors/fred-credit-spread.js';
import { fetchSITimeSeries } from '../warehouse/connectors/finra-si-series.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const CASES_DIR = resolve(import.meta.dirname, '../cases');
const CACHE_DIR = resolve(import.meta.dirname, '../warehouse/macro/market-dynamics-cache');

function readJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJSON(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ============================================================
// CASE SELECTION
// ============================================================

function selectCases() {
  const universe = readJSON(join(CASES_DIR, 'universe.json'));
  if (!universe?.cases) throw new Error('Universe not found');

  const cases = Object.values(universe.cases);

  // Filter: winner/trap only, entry >= 2018-06-01 (FINRA coverage)
  const eligible = cases.filter(c => {
    const o = c.outcome?.classification;
    return (o === 'winner' || o === 'trap') && c.entry_date >= '2018-06-01';
  });

  // Deduplicate by ticker — take the latest entry date per ticker
  const byTicker = {};
  for (const c of eligible) {
    if (!byTicker[c.ticker] || c.entry_date > byTicker[c.ticker].entry_date) {
      byTicker[c.ticker] = c;
    }
  }

  const selected = Object.values(byTicker);
  const winners = selected.filter(c => c.outcome.classification === 'winner').length;
  const traps = selected.filter(c => c.outcome.classification === 'trap').length;

  console.log(`Selected ${selected.length} cases (${winners} winners, ${traps} traps)`);
  return selected;
}

// ============================================================
// DATA FETCHING WITH CACHE
// ============================================================

function getCachePath(ticker, type) {
  return join(CACHE_DIR, type, `${ticker}.json`);
}

function loadFromCache(ticker, type) {
  const path = getCachePath(ticker, type);
  return readJSON(path);
}

function saveToCache(ticker, type, data) {
  const path = getCachePath(ticker, type);
  writeJSON(path, data);
}

/**
 * Fetch SI time series with caching.
 */
async function getSITimeSeries(ticker, entryDate) {
  const cached = loadFromCache(ticker, 'si');
  if (cached?.series?.length > 0) return cached.series;

  const series = await fetchSITimeSeries(ticker, entryDate, 2);
  if (series.length > 0) saveToCache(ticker, 'si', { series, entryDate });
  return series;
}

/**
 * Fetch daily volume from Yahoo Finance with caching.
 */
async function getVolumeSeries(ticker, entryDate) {
  const cached = loadFromCache(ticker, 'volume');
  if (cached?.volumes?.length > 0) return cached.volumes;

  const endD = new Date(entryDate);
  const startD = new Date(endD);
  startD.setFullYear(startD.getFullYear() - 2);

  const period1 = Math.floor(startD.getTime() / 1000);
  const period2 = Math.floor(endD.getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1d`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AV-Research)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return [];

    const timestamps = result.timestamp || [];
    const volumes = result.indicators?.quote?.[0]?.volume || [];

    const series = timestamps.map((t, i) => ({
      date: new Date(t * 1000).toISOString().split('T')[0],
      volume: volumes[i] || 0,
    })).filter(v => v.volume > 0 && v.date <= entryDate);

    if (series.length > 0) saveToCache(ticker, 'volume', { volumes: series, entryDate });
    return series;
  } catch {
    return [];
  }
}

// ============================================================
// MAIN DATA PIPELINE
// ============================================================

async function fetchAllData(cases) {
  console.log('\n── Phase 1: Fetching SI time series from FINRA ──\n');

  const siData = {};       // ticker → [series]
  const volumeData = {};   // ticker → [series]
  let siOk = 0, siFail = 0, volOk = 0, volFail = 0;

  // Batch fetch: SI + volume in parallel per ticker (with rate limiting)
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`\r  [${i + 1}/${cases.length}] SI: ${siOk} ok, ${siFail} fail | Vol: ${volOk} ok, ${volFail} fail    `);

    try {
      const si = await getSITimeSeries(c.ticker, c.entry_date);
      if (si.length >= 8) {
        siData[c.ticker] = { series: si, case: c };
        siOk++;
      } else {
        siFail++;
      }
    } catch {
      siFail++;
    }

    // Brief pause between FINRA calls
    await new Promise(r => setTimeout(r, 50));

    try {
      const vol = await getVolumeSeries(c.ticker, c.entry_date);
      if (vol.length >= 30) {
        volumeData[c.ticker] = vol;
        volOk++;
      } else {
        volFail++;
      }
    } catch {
      volFail++;
    }
  }

  console.log(`\n\n  SI fetched: ${siOk}/${cases.length} | Volume fetched: ${volOk}/${cases.length}\n`);
  return { siData, volumeData };
}

// ============================================================
// SECTOR GROUPING FOR ZIPF VELOCITY
// ============================================================

function buildSectorGroups(cases, siData) {
  const sectors = {};
  for (const c of cases) {
    const sector = c.gics_sector || 'Unknown';
    if (!sectors[sector]) sectors[sector] = {};
    if (siData[c.ticker]) {
      sectors[sector][c.ticker] = siData[c.ticker].series;
    }
  }

  // Filter to sectors with >= 5 companies with SI data
  const validSectors = {};
  for (const [sector, tickers] of Object.entries(sectors)) {
    if (Object.keys(tickers).length >= 5) {
      validSectors[sector] = tickers;
    }
  }

  console.log(`Sector groups for Zipf velocity:`);
  for (const [sector, tickers] of Object.entries(validSectors)) {
    console.log(`  ${sector.padEnd(28)} ${Object.keys(tickers).length} companies`);
  }

  return validSectors;
}

// ============================================================
// SIGNAL COMPUTATION
// ============================================================

function computeSignalsForAllCases(cases, siData, volumeData, sectorGroups) {
  console.log('\n── Phase 2: Computing signals ──\n');

  const results = [];

  for (const c of cases) {
    const ticker = c.ticker;
    const si = siData[ticker];
    if (!si) continue; // Need at least SI data

    const siSeries = si.series;
    const volSeries = volumeData[ticker] || [];
    const creditSeries = getCreditSpreadForCase(c.entry_date, 3);

    // Compute sector-relative Zipf velocity if sector data available
    const sector = c.gics_sector || 'Unknown';
    const sectorSI = sectorGroups[sector] || null;

    // Generate evaluation dates for Zipf (quarterly over the SI period)
    let siRankDates = null;
    if (sectorSI && Object.keys(sectorSI).length >= 5 && siSeries.length >= 8) {
      const dates = siSeries.map(s => s.date);
      // Take every 4th date for quarterly-ish spacing
      siRankDates = dates.filter((_, i) => i % 4 === 0);
      if (siRankDates.length < 4) siRankDates = null;
    }

    // Compute all signals
    const signals = computeAllSignals(
      siSeries,
      [],            // FTD (not fetching for expanded test)
      creditSeries,
      volSeries,
      {
        sectorSIData: sectorSI,
        ticker,
        siRankDates,
      }
    );
    const scores = extractTestableScores(signals);

    // Also compute volume Benford directly if we have volume data
    if (volSeries.length >= 30) {
      const vb = volumeBenford(volSeries);
      if (vb) {
        scores.volume_benford_kld = vb.kld;
        scores.volume_benford_chi = vb.chiSquare;
        scores.volume_benford_anomalous = vb.anomalous ? 1 : 0;
      }
    }

    results.push({
      ticker,
      entry_date: c.entry_date,
      outcome: c.outcome.classification,
      alpha_3yr: c.outcome.alpha_3yr || 0,
      sector,
      si_points: siSeries.length,
      vol_points: volSeries.length,
      spread_points: creditSeries.length,
      has_zipf: !!signals.si_zipf_velocity,
      scores,
    });
  }

  console.log(`  Computed signals for ${results.length} cases`);
  console.log(`  With Zipf velocity: ${results.filter(r => r.has_zipf).length}`);
  console.log(`  With volume Benford: ${results.filter(r => r.scores.volume_benford_kld != null).length}`);

  return results;
}

// ============================================================
// ANALYSIS
// ============================================================

function runAnalysis(results) {
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  EXPANDED DISCRIMINATION RESULTS');
  console.log(`  n = ${results.length} cases`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Collect all score keys
  const allScoreKeys = new Set();
  for (const r of results) {
    for (const k of Object.keys(r.scores)) allScoreKeys.add(k);
  }

  const outcomes = results.map(r => r.outcome);
  const returns = results.map(r => r.alpha_3yr);
  const winners = outcomes.filter(o => o === 'winner').length;
  const traps = outcomes.filter(o => o === 'trap').length;
  console.log(`  Winners: ${winners} | Traps: ${traps}\n`);

  const signalResults = {};

  // Financial statement baselines for comparison
  const financialBaseline = {
    si_beta:           { equiv: 'β scaling',     fin_r: -0.009 },
    si_change:         { equiv: 'β trajectory',  fin_r:  0.010 },
    si_csd:            { equiv: 'CSD index',     fin_r: -0.037 },
    si_zipf_velocity:  { equiv: 'Zipf velocity', fin_r:  0.012 },
    si_zipf_effort:    { equiv: 'Zipf effort',   fin_r:  0.012 },
    volume_benford_kld:{ equiv: 'Benford KLD',   fin_r: -0.027 },
    si_d1:             { equiv: 'D1 growth',     fin_r: -0.069 },
  };

  console.log('Signal                     |   r    |  p-value | CV mean | 4/5 CV | n    | vs Financial');
  console.log('─'.repeat(95));

  for (const key of [...allScoreKeys].sort()) {
    const scores = [];
    const filteredOutcomes = [];
    const filteredReturns = [];

    for (let i = 0; i < results.length; i++) {
      const val = results[i].scores[key];
      if (val != null && isFinite(val)) {
        scores.push(val);
        filteredOutcomes.push(outcomes[i]);
        filteredReturns.push(returns[i]);
      }
    }

    if (scores.length < 20) continue;

    const analysis = analyze(scores, filteredOutcomes, filteredReturns);
    signalResults[key] = analysis;

    const r = (analysis.spearman_r || 0).toFixed(3).padStart(7);
    const p = (analysis.spearman_p || 1).toFixed(4).padStart(9);
    const cv = analysis.cross_validation?.mean_r?.toFixed(3)?.padStart(7) || '    N/A';
    const cvPass = analysis.cross_validation?.per_fold_r?.filter(r => r > 0).length >= 4;
    const cvStr = cvPass ? ' PASS' : ' FAIL';
    const n = String(analysis.n).padStart(4);

    // Head-to-head comparison
    const baseline = financialBaseline[key];
    let comparison = '';
    if (baseline) {
      const mktAbs = Math.abs(analysis.spearman_r || 0);
      const finAbs = Math.abs(baseline.fin_r);
      const ratio = finAbs > 0 ? (mktAbs / finAbs).toFixed(1) + 'x' : '∞';
      comparison = mktAbs > finAbs
        ? `MARKET ${ratio} (was ${baseline.fin_r.toFixed(3)})`
        : `financial (was ${baseline.fin_r.toFixed(3)})`;
    }

    const star = analysis.spearman_p < 0.01 ? '**' : analysis.spearman_p < 0.05 ? '* ' : '  ';
    console.log(`${key.padEnd(27)}| ${r}${star} | ${p} | ${cv} | ${cvStr} | ${n} | ${comparison}`);
  }

  return signalResults;
}

function printComparisonTable(signalResults) {
  console.log('\n\n═══════════════════════════════════════════════════════════════════════');
  console.log('  FINAL COMPARISON: FINANCIAL STATEMENTS vs MARKET SENTIMENT');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const comparisons = [
    { label: 'β scaling',     finKey: null, finR: -0.009, mktKey: 'si_beta' },
    { label: 'β trajectory',  finKey: null, finR:  0.010, mktKey: 'si_change' },
    { label: 'CSD index',     finKey: null, finR: -0.037, mktKey: 'si_csd' },
    { label: 'Zipf velocity', finKey: null, finR:  0.012, mktKey: 'si_zipf_velocity' },
    { label: 'Benford KLD',   finKey: null, finR: -0.027, mktKey: 'volume_benford_kld' },
    { label: 'D1 growth rate',finKey: null, finR: -0.069, mktKey: 'si_d1' },
  ];

  console.log('Signal              | Financial r | Market r | p-value  | CV mean | Winner');
  console.log('─'.repeat(80));

  let marketWins = 0, tested = 0;

  for (const comp of comparisons) {
    const mkt = signalResults[comp.mktKey];
    const finR = comp.finR.toFixed(3).padStart(7);

    if (!mkt) {
      console.log(`${comp.label.padEnd(20)} | ${finR}     |    N/A  |     N/A  |    N/A  | ?`);
      continue;
    }

    tested++;
    const mktR = (mkt.spearman_r || 0).toFixed(3).padStart(7);
    const mktP = (mkt.spearman_p || 1).toFixed(4).padStart(8);
    const mktCV = mkt.cross_validation?.mean_r?.toFixed(3)?.padStart(7) || '   N/A ';
    const mktWins = Math.abs(mkt.spearman_r || 0) > Math.abs(comp.finR);
    if (mktWins) marketWins++;
    const winner = mktWins ? 'MARKET' : 'financial';

    console.log(`${comp.label.padEnd(20)} | ${finR}     | ${mktR} | ${mktP} | ${mktCV} | ${winner}`);
  }

  console.log('─'.repeat(80));

  // New market-only signals
  console.log('\nNEW MARKET-ONLY SIGNALS:');
  console.log('─'.repeat(80));

  const newSignals = ['si_theta', 'si_d2', 'spread_ou_theta', 'spread_csd_autocorr',
    'spread_csd_variance', 'spread_level', 'volume_benford_chi',
    'si_zipf_effort', 'inst_d1', 'inst_filing_trend', 'shares_change', 'inst_concentration',
    'spread_theta', 'spread_half_life'];

  for (const key of newSignals) {
    const result = signalResults[key];
    if (!result) continue;
    const r = (result.spearman_r || 0).toFixed(3).padStart(7);
    const p = (result.spearman_p || 1).toFixed(4).padStart(8);
    const cv = result.cross_validation?.mean_r?.toFixed(3)?.padStart(7) || '   N/A ';
    const star = result.spearman_p < 0.01 ? '**' : result.spearman_p < 0.05 ? '* ' : '  ';
    console.log(`${key.padEnd(27)} | ${r}${star} | ${p} | ${cv}   | n=${result.n}`);
  }

  console.log('─'.repeat(80));
  console.log(`\nVerdict: Market domain wins ${marketWins}/${tested} head-to-head comparisons`);

  // Strong signals summary
  const strong = Object.entries(signalResults)
    .filter(([, v]) => Math.abs(v.spearman_r || 0) >= 0.10 && (v.spearman_p || 1) < 0.01)
    .sort((a, b) => Math.abs(b[1].spearman_r) - Math.abs(a[1].spearman_r))
    .map(([k, v]) => `${k} (r=${v.spearman_r.toFixed(3)}, n=${v.n})`);

  if (strong.length > 0) {
    console.log(`\nSignals with |r| >= 0.10, p < 0.01:`);
    for (const s of strong) console.log(`  ✓ ${s}`);
  }

  return { marketWins, tested, strong };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  EXPANDED MARKET DYNAMICS DISCRIMINATION TEST');
  console.log('  SI theta/beta validation + Zipf velocity + Volume Benford');
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const startTime = Date.now();
  const cases = selectCases();

  // Fetch all data
  const { siData, volumeData } = await fetchAllData(cases);

  // Build sector groups for Zipf
  const sectorGroups = buildSectorGroups(cases, siData);

  // Compute signals
  const results = computeSignalsForAllCases(cases, siData, volumeData, sectorGroups);

  // Run analysis
  const signalResults = runAnalysis(results);
  const comparison = printComparisonTable(signalResults);

  // Save full results
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const report = {
    test_id: `market-dynamics-expanded-${new Date().toISOString().split('T')[0]}`,
    test_date: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    n_cases: results.length,
    n_si: Object.keys(siData).length,
    n_volume: Object.keys(volumeData).length,
    n_sectors: Object.keys(sectorGroups).length,
    signal_results: signalResults,
    comparison,
    case_details: results.map(r => ({
      ticker: r.ticker,
      outcome: r.outcome,
      alpha_3yr: r.alpha_3yr,
      si_points: r.si_points,
      vol_points: r.vol_points,
      has_zipf: r.has_zipf,
      scores: r.scores,
    })),
  };

  const reportPath = join(RESULTS_DIR, `market-dynamics-expanded-${new Date().toISOString().split('T')[0]}.json`);
  writeJSON(reportPath, report);
  console.log(`\nResults saved: ${reportPath}`);
  console.log(`Elapsed: ${elapsed}s`);

  registerTest({
    test_id: report.test_id,
    date: report.test_date,
    type: 'discrimination-expanded',
    description: 'Expanded SI theta/beta validation + Zipf + Benford',
    n_cases: results.length,
    key_findings: comparison.strong,
    market_wins: comparison.marketWins,
    total_comparisons: comparison.tested,
  });
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
