#!/usr/bin/env node
// Run Tests 4 and 5 (A-C) from the AV Framework Methodology Test Specification.
// Test 4: Graham Screen on unbiased data
// Test 5: Full Pipeline vs Simple Alternatives (quantitative parts only)
//
// Tests 1-3 require Anthropic API access (Sonnet calls).

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadSystematicCases } from './lib/calibration-data.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const EDGAR_CACHE = resolve(DATA_DIR, 'edgar-cache');
const UNCONV_DIR = resolve(DATA_DIR, 'unconventional');
const RESULTS_DIR = resolve(DATA_DIR, 'agent/results');

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function round3(v) { return v != null ? Math.round(v * 1000) / 1000 : null; }

// ============================================
// LOAD ALL CASES WITH RETURNS
// ============================================
function loadAllCases() {
  const rawCases = loadSystematicCases();
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) rawCases.push(...d.cases);
  }
  const seen = new Set();
  return rawCases.filter(c => {
    const k = `${c.ticker}|${c.entry_date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).filter(c =>
    (c.outcome === 'winner' || c.outcome === 'trap') &&
    c.forward_return_3yr != null
  );
}

// ============================================
// EDGAR FINANCIAL EXTRACTION
// ============================================
const REVENUE_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'];
const EQUITY_TAGS = ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'];
const LT_DEBT_TAGS = ['LongTermDebt', 'LongTermDebtNoncurrent'];
const ASSETS_CUR_TAGS = ['AssetsCurrent'];
const LIAB_CUR_TAGS = ['LiabilitiesCurrent'];
const EPS_TAGS = ['EarningsPerShareDiluted', 'EarningsPerShareBasic'];
const NI_TAGS = ['NetIncomeLoss'];
const SHARES_TAGS = ['CommonStockSharesOutstanding'];
const ASSETS_TAGS = ['Assets'];
const OP_INCOME_TAGS = ['OperatingIncomeLoss'];

function getFactValues(facts, tags, namespace = 'us-gaap') {
  for (const ns of [namespace, 'ifrs-full']) {
    const nsFacts = facts?.facts?.[ns];
    if (!nsFacts) continue;
    for (const tag of tags) {
      const concept = nsFacts[tag];
      if (!concept) continue;
      const units = concept.units;
      const values = units?.USD || units?.shares || units?.['USD/shares'] || Object.values(units || {})[0];
      if (values?.length) return values;
    }
  }
  // Check dei namespace for shares
  const dei = facts?.facts?.dei;
  if (dei) {
    for (const tag of tags) {
      const concept = dei[tag];
      if (!concept) continue;
      const values = concept.units?.shares || Object.values(concept.units || {})[0];
      if (values?.length) return values;
    }
  }
  return [];
}

function getAnnualValues(values, beforeDate, n = 12) {
  const annual = values
    .filter(v => (v.form === '10-K' || v.form === '20-F') && v.filed <= beforeDate && v.end <= beforeDate)
    .sort((a, b) => b.end.localeCompare(a.end));
  const seen = new Set();
  const deduped = [];
  for (const v of annual) {
    const fy = v.fy || v.end.slice(0, 4);
    if (!seen.has(fy)) { seen.add(fy); deduped.push(v); }
  }
  return deduped.slice(0, n).reverse();
}

function getLatest(values, beforeDate) {
  return values
    .filter(v => v.filed <= beforeDate && v.end <= beforeDate)
    .sort((a, b) => b.end.localeCompare(a.end))[0]?.val ?? null;
}

function extractGrahamMetrics(facts, entryDate, entryPrice, sector) {
  if (!facts || !entryPrice) return null;

  // EPS — get annual series for stability + latest for P/E
  const epsValues = getFactValues(facts, EPS_TAGS);
  const epsAnnual = getAnnualValues(epsValues, entryDate, 12);
  const epsList = epsAnnual.map(v => v.val);

  // If no EPS, try computing from NI / shares
  let latestEps = epsAnnual.length ? epsAnnual[epsAnnual.length - 1].val : null;
  if (latestEps == null) {
    const ni = getLatest(getFactValues(facts, NI_TAGS), entryDate);
    const shares = getLatest(getFactValues(facts, SHARES_TAGS), entryDate);
    if (ni != null && shares && shares > 0) latestEps = ni / shares;
  }

  // Book value per share
  const equity = getLatest(getFactValues(facts, EQUITY_TAGS), entryDate);
  const shares = getLatest(getFactValues(facts, SHARES_TAGS), entryDate);
  const bvps = (equity != null && shares && shares > 0) ? equity / shares : null;

  // Debt/Equity
  const ltDebt = getLatest(getFactValues(facts, LT_DEBT_TAGS), entryDate);
  const de = (ltDebt != null && equity != null && equity > 0) ? ltDebt / equity : null;

  // Current ratio
  const curAssets = getLatest(getFactValues(facts, ASSETS_CUR_TAGS), entryDate);
  const curLiab = getLatest(getFactValues(facts, LIAB_CUR_TAGS), entryDate);
  const currentRatio = (curAssets != null && curLiab != null && curLiab > 0) ? curAssets / curLiab : null;

  // ROE
  const ni = getLatest(getFactValues(facts, NI_TAGS), entryDate);
  const roe = (ni != null && equity != null && equity > 0) ? ni / equity : null;

  // Compute ratios
  const pe = (latestEps && latestEps > 0) ? entryPrice / latestEps : null;
  const pb = (bvps && bvps > 0) ? entryPrice / bvps : null;
  const pePb = (pe != null && pb != null) ? pe * pb : null;

  // Earnings stability
  const positiveYears = epsList.filter(e => e > 0).length;
  const totalYears = epsList.length;
  const stabilityRatio = totalYears > 0 ? positiveYears / totalYears : null;

  // Earnings growth (CAGR)
  let earningsGrowth = null;
  if (epsList.length >= 5) {
    const firstAvg = mean(epsList.slice(0, Math.min(3, Math.floor(epsList.length / 2))));
    const lastAvg = mean(epsList.slice(-Math.min(3, Math.floor(epsList.length / 2))));
    if (firstAvg > 0 && lastAvg > 0) {
      const span = Math.max(epsList.length - 3, 2);
      earningsGrowth = Math.pow(lastAvg / firstAvg, 1 / span) - 1;
    }
  }

  // Revenue growth
  const revValues = getFactValues(facts, REVENUE_TAGS);
  const revAnnual = getAnnualValues(revValues, entryDate, 12).map(v => v.val);
  let revenueGrowth = null;
  if (revAnnual.length >= 3) {
    const first = revAnnual[0];
    const last = revAnnual[revAnnual.length - 1];
    if (first > 0 && last > 0) {
      revenueGrowth = Math.pow(last / first, 1 / (revAnnual.length - 1)) - 1;
    }
  }

  const isFinancial = sector && (sector.toLowerCase().includes('financ') || sector === 'Financials');
  const isUtility = sector && (sector.toLowerCase().includes('utilit') || sector === 'Utilities' || sector === 'Real Estate');

  return {
    pe, pb, pePb, de, currentRatio, roe,
    earningsStability: stabilityRatio,
    earningsYears: totalYears,
    positiveEpsYears: positiveYears,
    earningsGrowth, revenueGrowth,
    isFinancial, isUtility,
    latestEps, bvps, equity, ltDebt,
  };
}

// ============================================
// GRAHAM SCREEN APPLICATION
// ============================================
function applyGrahamScreen(metrics, aaaYield) {
  if (!metrics) return { result: 'no_data', filters: {}, passCount: 0 };

  const filters = {};
  const eqRiskPremium = 0.015;
  const dynamicPEMax = aaaYield ? 1 / (aaaYield / 100 + eqRiskPremium) : 15;

  // Filter 1: P/E
  if (metrics.pe != null) {
    filters.pe = metrics.pe <= dynamicPEMax;
  } else {
    filters.pe = null; // can't evaluate
  }

  // Filter 2: P/E x P/B (with ROE modifier)
  let pePbCeiling = 40;
  if (metrics.roe != null) {
    if (metrics.roe >= 0.30) pePbCeiling = 60;
    else if (metrics.roe >= 0.20) pePbCeiling = 50;
  }
  if (metrics.pePb != null) {
    filters.pePb = metrics.pePb <= pePbCeiling;
  } else {
    filters.pePb = null;
  }

  // Filter 3: D/E
  if (metrics.isFinancial) {
    filters.de = true; // auto-pass
  } else if (metrics.de != null) {
    const threshold = metrics.isUtility ? 2.0 : 1.0;
    filters.de = metrics.de <= threshold;
  } else {
    filters.de = null;
  }

  // Filter 4: Current Ratio
  if (metrics.isFinancial) {
    filters.cr = true; // auto-pass
  } else if (metrics.currentRatio != null) {
    filters.cr = metrics.currentRatio >= 1.0;
  } else {
    filters.cr = null;
  }

  // Filter 5: Earnings Stability (8/10 or proportional)
  if (metrics.earningsYears >= 5) {
    const threshold = Math.max(Math.floor(metrics.earningsYears * 0.8), 4);
    filters.stability = metrics.positiveEpsYears >= threshold;
  } else {
    filters.stability = null;
  }

  // Filter 6: Earnings Growth (3% CAGR)
  if (metrics.earningsGrowth != null) {
    filters.growth = metrics.earningsGrowth >= 0.03;
  } else if (metrics.revenueGrowth != null) {
    filters.growth = metrics.revenueGrowth >= 0.03; // fallback to revenue growth
  } else {
    filters.growth = null;
  }

  // Count passes
  const evaluated = Object.values(filters).filter(v => v !== null);
  const passed = evaluated.filter(v => v === true).length;
  const total = evaluated.length;

  let result;
  if (total < 4) result = 'insufficient_data';
  else if (passed === total) result = 'full_pass';
  else if (passed >= total - 1) result = 'near_miss';
  else result = 'fail';

  return { result, filters, passCount: passed, totalFilters: total };
}

// ============================================
// MAIN TEST RUNNER
// ============================================
async function main() {
  console.log(`${B}AV Framework Methodology Tests${X}`);
  console.log('='.repeat(70));

  // Load data
  const cases = loadAllCases();
  console.log(`\nLoaded ${cases.length} winner/trap cases with returns`);

  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};
  const econContext = loadJSON(resolve(UNCONV_DIR, 'economic-context.json')) || {};
  const shortInterest = loadJSON(resolve(UNCONV_DIR, 'short-interest.json')) || {};
  const secMetadata = loadJSON(resolve(UNCONV_DIR, 'sec-filing-metadata.json')) || {};
  const priceVolume = loadJSON(resolve(UNCONV_DIR, 'price-volume-dynamics.json')) || {};

  // ============================================
  // TEST 4: GRAHAM SCREEN ON UNBIASED DATA
  // ============================================
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${B}${C}TEST 4: Graham Screen on Unbiased Data${X}`);
  console.log(`${'='.repeat(70)}\n`);

  const screenResults = [];
  let edgarHits = 0, edgarMisses = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const cikEntry = cikCache[c.ticker];
    const cik = cikEntry?.cik || null;

    let metrics = null;
    if (cik) {
      const facts = loadJSON(resolve(EDGAR_CACHE, `${cik}.json`));
      if (facts) {
        metrics = extractGrahamMetrics(facts, c.entry_date, c.entry_price, c.sector);
        edgarHits++;
      } else {
        edgarMisses++;
      }
    } else {
      edgarMisses++;
    }

    // Get AAA yield at entry date
    const econ = econContext[c.entry_date];
    const aaaYield = econ?.aaa_yield || null;

    const screen = applyGrahamScreen(metrics, aaaYield);

    screenResults.push({
      ticker: c.ticker,
      entry_date: c.entry_date,
      outcome: c.outcome,
      forward_return: c.forward_return_3yr,
      sp500_return: c.sp500_return_3yr,
      screen: screen.result,
      passCount: screen.passCount,
      totalFilters: screen.totalFilters,
      filters: screen.filters,
      metrics,
    });

    if ((i + 1) % 300 === 0) {
      process.stdout.write(`\r  Processing: ${i + 1}/${cases.length} (${edgarHits} EDGAR hits)`);
    }
  }
  console.log(`\r  Processed ${cases.length} cases (${edgarHits} EDGAR hits, ${edgarMisses} misses)  `);

  // Analyze Graham Screen results
  const byScreen = {};
  for (const r of screenResults) {
    if (!byScreen[r.screen]) byScreen[r.screen] = [];
    byScreen[r.screen].push(r);
  }

  console.log(`\n${B}Graham Screen Classification:${X}`);
  const baseWinRate = screenResults.filter(r => r.outcome === 'winner').length / screenResults.length;
  console.log(`  Base rate: ${(baseWinRate * 100).toFixed(1)}% winners\n`);

  for (const [label, group] of Object.entries(byScreen).sort()) {
    const winners = group.filter(r => r.outcome === 'winner');
    const winRate = winners.length / group.length;
    const returns = group.map(r => r.forward_return);
    const sp500Returns = group.filter(r => r.sp500_return != null).map(r => r.sp500_return);
    const meanReturn = mean(returns);
    const meanSP = sp500Returns.length ? mean(sp500Returns) : null;
    const alpha3yr = meanReturn - (meanSP || 0);
    const alphaAnn = meanSP != null ? (Math.pow((1 + meanReturn) / (1 + meanSP), 1/3) - 1) : null;

    console.log(`  ${label.padEnd(20)} N=${String(group.length).padStart(5)}  WinRate=${(winRate * 100).toFixed(1).padStart(5)}%  3yr_return=${(meanReturn * 100).toFixed(1).padStart(6)}%  SP500=${meanSP ? (meanSP * 100).toFixed(1) : 'N/A'}%  Alpha_3yr=${(alpha3yr * 100).toFixed(1)}%  Alpha_ann=${alphaAnn ? (alphaAnn * 100).toFixed(1) + '%' : 'N/A'}`);
  }

  // Full pass vs fail comparison
  const fullPass = screenResults.filter(r => r.screen === 'full_pass');
  const fail = screenResults.filter(r => r.screen === 'fail');
  if (fullPass.length > 0 && fail.length > 0) {
    const fpReturn = mean(fullPass.map(r => r.forward_return));
    const failReturn = mean(fail.map(r => r.forward_return));
    const fpSP = mean(fullPass.filter(r => r.sp500_return != null).map(r => r.sp500_return));
    const failSP = mean(fail.filter(r => r.sp500_return != null).map(r => r.sp500_return));
    const fpAlpha = Math.pow((1 + fpReturn) / (1 + fpSP), 1/3) - 1;
    const failAlpha = Math.pow((1 + failReturn) / (1 + failSP), 1/3) - 1;

    console.log(`\n${B}Test 4 Verdict:${X}`);
    console.log(`  full_pass alpha vs VOO: ${(fpAlpha * 100).toFixed(1)}% annualized`);
    console.log(`  fail alpha vs VOO: ${(failAlpha * 100).toFixed(1)}% annualized`);
    console.log(`  Hurdle: ≥3% annualized alpha`);

    if (fpAlpha >= 0.05) console.log(`  ${G}STRONG PASS — Graham screen adds real value${X}`);
    else if (fpAlpha >= 0.03) console.log(`  ${G}PASS — Graham screen adds value${X}`);
    else if (fpAlpha >= 0.01) console.log(`  ${Y}MARGINAL — Graham screen has slight edge${X}`);
    else if (fpAlpha >= 0) console.log(`  ${R}FAIL — Graham screen does not beat VOO enough${X}`);
    else console.log(`  ${R}FAIL — Graham screen destroys value vs VOO${X}`);
  }

  // ============================================
  // TEST 5: SIMPLE ALTERNATIVES (A, B, C)
  // ============================================
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${B}${C}TEST 5: Simple Alternatives vs VOO${X}`);
  console.log(`${'='.repeat(70)}\n`);

  // Prepare enriched data
  for (const r of screenResults) {
    const si = shortInterest[r.ticker];
    r.shortPctFloat = si?.short_pct_float ?? null;

    const econ = econContext[r.entry_date];
    r.creditSpread = econ?.credit_spread ?? null;
    r.aaaYield = econ?.aaa_yield ?? null;

    const sec = secMetadata[r.ticker];
    r.hasFilingIssues = sec ? ((sec.nt_filings || 0) > 0 || (sec.total_10KA || 0) > 0 || (sec.total_10QA || 0) > 0 ? 1 : 0) : null;
    r.amendmentRate = sec?.amendment_rate ?? null;
  }

  // Helper: evaluate an alternative strategy
  function evaluateStrategy(name, buyFilter) {
    const buys = screenResults.filter(buyFilter);
    const nonBuys = screenResults.filter(r => !buyFilter(r));

    if (buys.length < 10) {
      console.log(`  ${name}: Only ${buys.length} BUY signals — insufficient data`);
      return null;
    }

    const buyWinners = buys.filter(r => r.outcome === 'winner');
    const buyReturn = mean(buys.map(r => r.forward_return));
    const buySP = mean(buys.filter(r => r.sp500_return != null).map(r => r.sp500_return));
    const alphaAnn = Math.pow((1 + buyReturn) / (1 + buySP), 1/3) - 1;
    const precision = buyWinners.length / buys.length;
    const frequency = buys.length / screenResults.length;

    // Worst case
    const worstReturn = Math.min(...buys.map(r => r.forward_return));

    const verdict = alphaAnn >= 0.05 ? 'STRONG PASS' : alphaAnn >= 0.03 ? 'PASS' : alphaAnn >= 0.01 ? 'MARGINAL' : 'FAIL';
    const verdictColor = alphaAnn >= 0.03 ? G : alphaAnn >= 0.01 ? Y : R;

    console.log(`  ${B}${name}${X}`);
    console.log(`    BUY signals: ${buys.length}/${screenResults.length} (${(frequency * 100).toFixed(0)}% of universe)`);
    console.log(`    Precision: ${(precision * 100).toFixed(1)}% winners (base: ${(baseWinRate * 100).toFixed(1)}%)`);
    console.log(`    Mean 3yr return: ${(buyReturn * 100).toFixed(1)}% (VOO: ${(buySP * 100).toFixed(1)}%)`);
    console.log(`    Alpha 3yr cumulative: ${((buyReturn - buySP) * 100).toFixed(1)}pp`);
    console.log(`    ${B}Alpha annualized: ${(alphaAnn * 100).toFixed(1)}%${X}`);
    console.log(`    Worst BUY return: ${(worstReturn * 100).toFixed(1)}%`);
    console.log(`    Verdict: ${verdictColor}${verdict}${X}`);
    console.log('');

    return { name, buys: buys.length, precision, buyReturn, buySP, alphaAnn, frequency, verdict, worstReturn };
  }

  // Compute medians for splitting
  const siValues = screenResults.map(r => r.shortPctFloat).filter(v => v != null);
  const siMedian = median(siValues);
  const csValues = screenResults.map(r => r.creditSpread).filter(v => v != null);
  const csMedian = median(csValues);

  console.log(`  Short interest median: ${(siMedian * 100).toFixed(2)}%`);
  console.log(`  Credit spread median: ${csMedian?.toFixed(3)}%`);
  console.log('');

  // Alternative A: Short Interest Filter Only
  const altA = evaluateStrategy(
    'Alt A: Short Interest Below Median',
    r => r.shortPctFloat != null && r.shortPctFloat < siMedian
  );

  // Alternative B: 3-Way Composite (top quintile)
  // Compute composite score for each case
  for (const r of screenResults) {
    let sum = 0, count = 0;
    if (r.shortPctFloat != null) { sum += (r.shortPctFloat < siMedian ? 1 : 0); count++; }
    if (r.creditSpread != null) { sum += (r.creditSpread > csMedian ? 1 : 0); count++; }
    if (r.hasFilingIssues != null) { sum += (r.hasFilingIssues === 0 ? 1 : 0); count++; }
    r.compositeScore = count >= 2 ? sum / count : null;
  }

  const altB = evaluateStrategy(
    'Alt B: 3-Way Composite (all 3 favorable)',
    r => r.compositeScore != null && r.compositeScore >= 0.99  // all 3 must be favorable
  );

  // Alternative B2: top half of composite
  const altB2 = evaluateStrategy(
    'Alt B2: 3-Way Composite (2+ of 3 favorable)',
    r => r.compositeScore != null && r.compositeScore >= 0.66
  );

  // Alternative C: Low P/E + Fear
  const altC = evaluateStrategy(
    'Alt C: P/E < 15 During High Credit Spread',
    r => r.metrics?.pe != null && r.metrics.pe > 0 && r.metrics.pe < 15 &&
         r.creditSpread != null && r.creditSpread > csMedian
  );

  // Alternative: Graham full_pass + Low Short Interest
  const altD = evaluateStrategy(
    'Alt D: Graham Full Pass + Low Short Interest',
    r => r.screen === 'full_pass' && r.shortPctFloat != null && r.shortPctFloat < siMedian
  );

  // Alternative: Graham (full/near) + 3-Way Composite
  const altE = evaluateStrategy(
    'Alt E: Graham Pass + 3-Way Composite (all favorable)',
    r => (r.screen === 'full_pass' || r.screen === 'near_miss') &&
         r.compositeScore != null && r.compositeScore >= 0.99
  );

  // Alternative: Just the best cell from interaction analysis
  const altF = evaluateStrategy(
    'Alt F: Low Short Interest + High Credit Spread',
    r => r.shortPctFloat != null && r.shortPctFloat < siMedian &&
         r.creditSpread != null && r.creditSpread > csMedian
  );

  // Baseline: VOO (everything)
  const allReturns = mean(screenResults.map(r => r.forward_return));
  const allSP = mean(screenResults.filter(r => r.sp500_return != null).map(r => r.sp500_return));
  console.log(`  ${B}Baseline: Buy Everything (= VOO proxy)${X}`);
  console.log(`    Mean 3yr return: ${(allReturns * 100).toFixed(1)}% (VOO: ${(allSP * 100).toFixed(1)}%)`);
  console.log('');

  // ============================================
  // SUMMARY TABLE
  // ============================================
  console.log(`${'='.repeat(70)}`);
  console.log(`${B}SUMMARY: All Strategies Ranked by Annualized Alpha vs VOO${X}`);
  console.log(`${'='.repeat(70)}`);
  console.log('Strategy'.padEnd(45) + 'Alpha_Ann  Precision  Freq   Verdict');
  console.log('-'.repeat(90));

  const allResults = [altA, altB, altB2, altC, altD, altE, altF].filter(Boolean);
  allResults.sort((a, b) => b.alphaAnn - a.alphaAnn);

  for (const r of allResults) {
    const alphaStr = (r.alphaAnn * 100).toFixed(1) + '%';
    const precStr = (r.precision * 100).toFixed(0) + '%';
    const freqStr = (r.frequency * 100).toFixed(0) + '%';
    const color = r.alphaAnn >= 0.03 ? G : r.alphaAnn >= 0.01 ? Y : R;
    console.log(
      r.name.padEnd(45) +
      color + alphaStr.padStart(7) + X + '  ' +
      precStr.padStart(9) + '  ' +
      freqStr.padStart(4) + '   ' +
      r.verdict
    );
  }

  console.log('-'.repeat(90));
  console.log(`\nHurdle: ≥3% annualized alpha (≈9pp cumulative over 3 years)`);
  console.log(`Base win rate: ${(baseWinRate * 100).toFixed(1)}%`);

  // ============================================
  // SAVE RESULTS
  // ============================================
  const output = {
    test4: {
      screenDistribution: Object.fromEntries(Object.entries(byScreen).map(([k, v]) => [k, {
        count: v.length,
        winners: v.filter(r => r.outcome === 'winner').length,
        winRate: v.filter(r => r.outcome === 'winner').length / v.length,
        meanReturn: mean(v.map(r => r.forward_return)),
        meanSP500: mean(v.filter(r => r.sp500_return != null).map(r => r.sp500_return)),
      }])),
      edgarHits, edgarMisses,
    },
    test5: allResults.map(r => ({ ...r, buys: undefined })),
    metadata: {
      totalCases: screenResults.length,
      baseWinRate,
      siMedian,
      csMedian,
      timestamp: new Date().toISOString(),
    },
  };

  writeFileSync(resolve(RESULTS_DIR, 'methodology-test-results.json'), JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${RESULTS_DIR}/methodology-test-results.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
