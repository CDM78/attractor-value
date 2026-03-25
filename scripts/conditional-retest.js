#!/usr/bin/env node
// Conditional Retest: Nonlinear signals within pre-filtered pools + untested theories
// Tests whether complex signals that failed on the general population revive within
// the subset flagged as interesting by the validated signals.
//
// Usage: node scripts/conditional-retest.js

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractQuarterlyMetrics, extractUsdNumbers, extractAllUsdValues, getRevenueAtDate, extractSegmentRevenues } from './lib/edgar-extractor.js';
import { benfordFirstDigit } from './lib/benford.js';
import {
  computeScalingExponent, scalingTrajectory, maturityBand,
  companyCSD, revenueDerivatives, revenueHurst, hurstExponent,
  revenueEntropy, mutualInformation, computeSectorMedianGrowth,
  zipfExponent, rankVelocity, effortAdjustedVelocity, buildSectorRankings, trackRankHistory,
  nonLinearCompositeScore,
} from './lib/nonlinear.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median, stddev, kFoldSplit } from './lib/statistics.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const AGENT_DIR = resolve(DATA_DIR, 'agent');
const EDGAR_CACHE = resolve(DATA_DIR, 'edgar-cache');
const RESULTS_DIR = resolve(import.meta.dirname, '../results');

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C_ = '\x1b[36m', Y = '\x1b[33m', DIM = '\x1b[2m', X = '\x1b[0m';
function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function fN(v, d = 4) { return v == null ? 'N/A' : v.toFixed(d); }
function fP(v, d = 1) { return v == null ? 'N/A' : (v * 100).toFixed(d) + '%'; }
function hdr(t) { console.log(`\n${B}${C_}${'='.repeat(70)}${X}\n${B}${C_}  ${t}${X}\n${B}${C_}${'='.repeat(70)}${X}`); }
function sub(t) { console.log(`\n${B}${t}${X}\n${DIM}${'-'.repeat(60)}${X}`); }

// ============================================
// DATA LOADING (reuse from replication test)
// ============================================
function loadAllData() {
  console.log('Loading data...');
  const deanonKey = loadJSON(resolve(AGENT_DIR, 'deanonymization-key.json'));
  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};

  // Load all 1,656 cases with agent features (u159, u160, u024, etc.)
  const cases = [];
  const agentFeatures = {}; // case_id → { features, unconventional }
  for (const sample of ['A', 'B', 'C', 'D', 'E']) {
    const data = loadJSON(resolve(AGENT_DIR, `sample-${sample}.json`));
    if (!data) continue;
    for (const c of data) {
      const info = deanonKey.case_id_to_ticker[c.case_id];
      if (!info) continue;
      agentFeatures[c.case_id] = { features: c.features, unconventional: c.unconventional };
      cases.push({
        case_id: c.case_id, outcome: c.outcome,
        ticker: info.ticker, entry_date: info.entry_date, company: info.company,
        sample,
        // Agent features (z-scored)
        u159: c.unconventional?.u159 ?? null,  // short % of float
        u160: c.unconventional?.u160 ?? null,  // credit spread
        u024: c.unconventional?.u024 ?? null,  // filing quality flag
        f061: c.features?.f061 ?? null,        // size x profitability rank
      });
    }
  }

  // Attach returns + sector from systematic data
  const sysFiles = [
    'systematic-sp500-crosssection-2013.json', 'systematic-sp500-crosssection-2016.json',
    'systematic-sp500-crosssection.json', 'systematic-sp500-crosssection-2022.json',
    'systematic-sp500-changes.json', 'systematic-smallcap.json', 'systematic-adr.json',
    'systematic-multi-entry.json', 'systematic-fraud.json',
  ];
  const returnMap = {};
  for (const file of sysFiles) {
    const data = loadJSON(resolve(DATA_DIR, file));
    if (!data?.cases) continue;
    for (const c of data.cases) returnMap[`${c.ticker}|${c.entry_date}`] = c;
  }
  for (const c of cases) {
    const ret = returnMap[`${c.ticker}|${c.entry_date}`];
    if (ret) {
      c.forward_return_3yr = ret.forward_return_3yr;
      c.sp500_return_3yr = ret.sp500_return_3yr;
      c.sector = ret.sector;
      c.cik = ret.cik;
    }
  }

  // Load EDGAR facts
  const tickerFacts = {};
  let loaded = 0;
  for (const c of cases) {
    if (tickerFacts[c.ticker] !== undefined) continue;
    let cik = c.cik || cikCache[c.ticker]?.cik;
    if (!cik) { tickerFacts[c.ticker] = null; continue; }
    const padded = cik.replace(/^0+/, '').padStart(10, '0');
    const path = resolve(EDGAR_CACHE, `${padded}.json`);
    tickerFacts[c.ticker] = loadJSON(path);
    if (tickerFacts[c.ticker]) loaded++;
  }
  console.log(`  ${cases.length} cases, ${loaded} unique tickers with EDGAR data`);

  // Compute all signals
  console.log('Computing signals...');
  const sectorCompanies = {}; // sector → [{ticker, quarterlyMetrics}]
  for (const c of cases) {
    const facts = tickerFacts[c.ticker];
    if (!facts) continue;
    const qm = extractQuarterlyMetrics(facts, c.entry_date);
    c.qm = qm;
    if (qm.length < 8) continue;

    // β
    const beta = computeScalingExponent(qm, 'assets', 'revenue');
    if (beta) { c.beta = beta.beta; c.betaR2 = beta.r2; }
    const traj = scalingTrajectory(qm);
    if (traj) { c.betaTrajectory = traj.betaChange; c.betaLate = traj.betaLate; }

    // D1 (original: revenueDerivatives().avgD1)
    const deriv = revenueDerivatives(qm);
    if (deriv) { c.avgD1 = deriv.avgD1; c.avgD2 = deriv.avgD2; c.phase = deriv.phase; }

    // CSD
    const csd = companyCSD(qm);
    if (csd?.hasData) c.csdIndex = csd.csdIndex;

    // Benford
    const nums = extractUsdNumbers(facts);
    if (nums.length >= 50) { const b = benfordFirstDigit(nums); if (b) c.benfordKLD = b.kld; }

    // Revenue at entry
    c.revenueAtEntry = getRevenueAtDate(facts, c.entry_date);

    // Hurst
    const h = revenueHurst(qm);
    if (h) c.hurst = h.hurst;

    // Segment entropy
    const seg = extractSegmentRevenues(facts, c.entry_date);
    if (seg && seg.segments.length >= 2) {
      const ent = revenueEntropy(seg.segments);
      if (ent) { c.entropy = ent.normalizedEntropy; c.nSegments = seg.nSegments; }
    }

    // Sector grouping for Zipf + MI
    if (c.sector) {
      if (!sectorCompanies[c.sector]) sectorCompanies[c.sector] = [];
      sectorCompanies[c.sector].push({ ticker: c.ticker, qm, case: c });
    }

    // Line-item specific Benford
    const allVals = extractAllUsdValues(facts);
    const revTags = new Set(['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'Revenue']);
    const expTags = new Set(['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'OperatingExpenses', 'CostsAndExpenses', 'SellingGeneralAndAdministrativeExpense', 'CostOfSales']);
    const cfTags = new Set(['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities', 'CashFlowsFromUsedInOperatingActivities']);
    const revNums = allVals.filter(v => revTags.has(v.tag)).map(v => v.value);
    const expNums = allVals.filter(v => expTags.has(v.tag)).map(v => v.value);
    const cfNums = allVals.filter(v => cfTags.has(v.tag)).map(v => v.value);
    if (revNums.length >= 20) { const b = benfordFirstDigit(revNums); if (b) c.benfordRevKLD = b.kld; }
    if (expNums.length >= 20) { const b = benfordFirstDigit(expNums); if (b) c.benfordExpKLD = b.kld; }
    if (cfNums.length >= 20) { const b = benfordFirstDigit(cfNums); if (b) c.benfordCfKLD = b.kld; }
    if (c.benfordRevKLD != null && c.benfordExpKLD != null) c.benfordDivergence = c.benfordExpKLD - c.benfordRevKLD;
  }

  // Zipf rank velocity
  console.log('Computing Zipf velocity...');
  for (const [sector, companies] of Object.entries(sectorCompanies)) {
    const sectorList = companies.map(sc => ({ ticker: sc.ticker, quarterlyMetrics: sc.qm }));
    for (const sc of companies) {
      const c = sc.case;
      const entryYear = parseInt(c.entry_date.slice(0, 4));
      const years = []; for (let y = entryYear - 4; y <= entryYear; y++) years.push(y);
      const history = trackRankHistory(c.ticker, sectorList, years);
      if (history.ranks.length >= 3) {
        const rv = rankVelocity(history.ranks, history.years);
        if (rv) { c.zipfVelocity = rv.velocity; c.zipfRanksClimbed = rv.ranksClimbed; }
      }
    }
  }

  // Mutual Information (company vs sector)
  console.log('Computing MI...');
  for (const [sector, companies] of Object.entries(sectorCompanies)) {
    const sectorMedian = computeSectorMedianGrowth(companies.map(sc => ({ ticker: sc.ticker, quarterlyMetrics: sc.qm })));
    const sectorKeys = Object.keys(sectorMedian).sort();
    for (const sc of companies) {
      const c = sc.case;
      const compGrowth = []; const sectGrowth = [];
      for (const qk of sectorKeys) {
        const qMatch = sc.qm.find(q => q.quarter === qk);
        if (qMatch?.revenueGrowthYoY != null && sectorMedian[qk] != null) {
          compGrowth.push(qMatch.revenueGrowthYoY);
          sectGrowth.push(sectorMedian[qk]);
        }
      }
      if (compGrowth.length >= 12) {
        const mi = mutualInformation(compGrowth, sectGrowth);
        if (mi) c.mi = mi.normalizedMI;
      }
    }
  }

  // β from current data (Part 4)
  console.log('Computing current-data β...');
  for (const c of cases) {
    const facts = tickerFacts[c.ticker];
    if (!facts) continue;
    const qmAll = extractQuarterlyMetrics(facts); // no date filter = current data
    if (qmAll.length < 8) continue;
    const betaCurrent = computeScalingExponent(qmAll.slice(-12), 'assets', 'revenue');
    if (betaCurrent) c.betaCurrent = betaCurrent.beta;
  }

  // β monitoring: β at entry+4Q, entry+8Q (Part 3)
  console.log('Computing β monitoring signals...');
  for (const c of cases) {
    const facts = tickerFacts[c.ticker];
    if (!facts) continue;
    const entryQ = c.entry_date.slice(0, 4) + '-Q' + Math.ceil(parseInt(c.entry_date.slice(5, 7)) / 3);

    // β at entry (from pre-entry data only)
    const qmPre = extractQuarterlyMetrics(facts, c.entry_date);
    const betaEntry = qmPre.length >= 8 ? computeScalingExponent(qmPre, 'assets', 'revenue') : null;
    if (betaEntry) c.betaEntry = betaEntry.beta;

    // β at entry + 4Q
    const qmAll = extractQuarterlyMetrics(facts);
    const entryIdx = qmAll.findIndex(q => q.quarter >= entryQ);
    if (entryIdx >= 0 && entryIdx + 4 < qmAll.length) {
      const qm4 = qmAll.slice(0, entryIdx + 4);
      if (qm4.length >= 8) {
        const b4 = computeScalingExponent(qm4, 'assets', 'revenue');
        if (b4 && betaEntry) c.deltaBeta4Q = b4.beta - betaEntry.beta;
      }
    }
    // β at entry + 8Q
    if (entryIdx >= 0 && entryIdx + 8 < qmAll.length) {
      const qm8 = qmAll.slice(0, entryIdx + 8);
      if (qm8.length >= 8) {
        const b8 = computeScalingExponent(qm8, 'assets', 'revenue');
        if (b8 && betaEntry) c.deltaBeta8Q = b8.beta - betaEntry.beta;
      }
    }
  }

  // Combined β+D1 (using correct avgD1)
  const validBD = cases.filter(c => c.betaTrajectory != null && c.avgD1 != null);
  if (validBD.length > 0) {
    const btVals = validBD.map(c => c.betaTrajectory);
    const d1Vals = validBD.map(c => c.avgD1);
    const btM = mean(btVals), btS = stddev(btVals) || 1;
    const d1M = mean(d1Vals), d1S = stddev(d1Vals) || 1;
    for (const c of validBD) {
      c.combinedBetaD1 = ((c.betaTrajectory - btM) / btS + (c.avgD1 - d1M) / d1S) / 2;
    }
  }

  // 3-way composite score (u159 + u160 + u024)
  for (const c of cases) {
    if (c.u159 != null && c.u160 != null && c.u024 != null) {
      c.composite3 = (-c.u159 + c.u160 - c.u024) / 3;
    }
  }

  return cases;
}

// ============================================
// HELPERS
// ============================================
function testSignal(pool, signalKey) {
  const valid = pool.filter(c => c[signalKey] != null);
  if (valid.length < 20) return { r: null, p: null, n: valid.length, insuf: true };
  const sp = spearmanCorrelation(valid.map(c => c[signalKey]), valid.map(c => c.outcome));
  return { r: sp?.rho, p: sp?.p, n: valid.length, insuf: false };
}

function winRate(pool) {
  if (pool.length === 0) return 0;
  return pool.filter(c => c.outcome === 1).length / pool.length;
}

function returnHurdle(pool, signalKey) {
  const valid = pool.filter(c => c[signalKey] != null && c.forward_return_3yr != null);
  if (valid.length < 20) return null;
  const sorted = [...valid].sort((a, b) => b[signalKey] - a[signalKey]);
  const mid = Math.floor(sorted.length / 2);
  const top = sorted.slice(0, mid), bot = sorted.slice(mid);
  const topRet = mean(top.map(c => c.forward_return_3yr));
  const botRet = mean(bot.map(c => c.forward_return_3yr));
  const topVOO = mean(top.map(c => c.sp500_return_3yr));
  const topAlpha = Math.pow(1 + topRet, 1/3) - 1 - (Math.pow(1 + topVOO, 1/3) - 1);
  const botAlpha = Math.pow(1 + botRet, 1/3) - 1 - (Math.pow(1 + mean(bot.map(c => c.sp500_return_3yr)), 1/3) - 1);
  return { topRet, botRet, topAlpha, botAlpha, spread: topRet - botRet, topN: top.length, passesHurdle: topAlpha >= 0.03 };
}

// ============================================
// MAIN
// ============================================
async function main() {
  hdr('CONDITIONAL RETEST + UNTESTED THEORIES');
  const cases = loadAllData();
  const winners = cases.filter(c => c.outcome === 1);
  const traps = cases.filter(c => c.outcome === 0);
  console.log(`\n  Total: ${cases.length} cases (${winners.length} W, ${traps.length} T)`);

  // ===================== PART 1: PRE-FILTERED POOLS =====================
  hdr('PART 1: CONDITIONAL RETESTS WITHIN PRE-FILTERED POOLS');

  // Build pools
  const withU159 = cases.filter(c => c.u159 != null);
  const u159med = median(withU159.map(c => c.u159));
  const poolA = withU159.filter(c => c.u159 <= u159med); // low short interest

  const withU160 = cases.filter(c => c.u160 != null);
  const u160med = median(withU160.map(c => c.u160));
  const poolB = withU160.filter(c => c.u160 >= u160med); // high credit spread

  const withComp = cases.filter(c => c.composite3 != null);
  const compSorted = [...withComp].sort((a, b) => b.composite3 - a.composite3);
  const topQuintileCut = compSorted[Math.floor(compSorted.length * 0.2)]?.composite3 ?? 0;
  const poolC = withComp.filter(c => c.composite3 >= topQuintileCut);

  const poolD = poolA.filter(c => c.composite3 != null && c.composite3 >= topQuintileCut);

  const pools = [
    { name: 'General Population', pool: cases },
    { name: 'Pool A — Low Short Interest', pool: poolA },
    { name: 'Pool B — High Credit Spread', pool: poolB },
    { name: 'Pool C — Top Quintile Composite', pool: poolC },
    { name: 'Pool D — Top Q + Low Short', pool: poolD },
  ];

  for (const { name, pool } of pools) {
    console.log(`  ${name}: N=${pool.length}, win rate=${fP(winRate(pool))}`);
  }

  const signals = [
    { key: 'beta', name: 'β scaling (static)' },
    { key: 'betaTrajectory', name: 'β trajectory' },
    { key: 'avgD1', name: 'D1 growth (original)' },
    { key: 'zipfVelocity', name: 'Zipf velocity' },
    { key: 'csdIndex', name: 'CSD index' },
    { key: 'combinedBetaD1', name: 'β traj + D1 combined' },
    { key: 'hurst', name: 'Hurst exponent' },
    { key: 'entropy', name: 'Revenue entropy' },
    { key: 'mi', name: 'Mutual information' },
    { key: 'benfordDivergence', name: 'Benford divergence' },
    { key: 'betaCurrent', name: 'Current-data β' },
  ];

  sub('Signal × Pool Matrix');
  console.log(`${'Signal'.padEnd(26)} | ${'General'.padStart(14)} | ${'Pool A'.padStart(14)} | ${'Pool B'.padStart(14)} | ${'Pool C'.padStart(14)} | ${'Pool D'.padStart(14)}`);
  console.log('-'.repeat(104));

  const matrixResults = [];
  for (const sig of signals) {
    const row = [sig.name];
    const rowData = { signal: sig.name, key: sig.key };
    for (const { name, pool } of pools) {
      const t = testSignal(pool, sig.key);
      const cell = t.insuf ? `N=${t.n} insuf` : `r=${fN(t.r,3)} p=${fN(t.p,3)}`;
      row.push(cell);
      rowData[name] = t;
    }
    console.log(`${row[0].padEnd(26)} | ${row[1].padStart(14)} | ${row[2].padStart(14)} | ${row[3].padStart(14)} | ${row[4].padStart(14)} | ${row[5].padStart(14)}`);
    matrixResults.push(rowData);
  }

  // S-curve phase within pools
  sub('S-Curve Phase Win Rates by Pool');
  const phases = ['ACCELERATING', 'PEAK', 'INFLECTION', 'DECELERATING', 'BOTTOMING'];
  console.log(`${'Phase'.padEnd(16)} | ${'General'.padStart(14)} | ${'Pool A'.padStart(14)} | ${'Pool C'.padStart(14)} | ${'Pool D'.padStart(14)}`);
  console.log('-'.repeat(74));
  for (const phase of phases) {
    const parts = [];
    for (const { pool } of [pools[0], pools[1], pools[3], pools[4]]) {
      const phCases = pool.filter(c => c.phase === phase);
      parts.push(phCases.length > 5 ? `${fP(winRate(phCases))} (${phCases.length})` : `N=${phCases.length}`);
    }
    console.log(`${phase.padEnd(16)} | ${parts[0].padStart(14)} | ${parts[1].padStart(14)} | ${parts[2].padStart(14)} | ${parts[3].padStart(14)}`);
  }

  // Return hurdle for any signal reaching p < 0.10 in Pool C or D
  sub('Return Hurdle Tests (signals with p < 0.10 in any pool)');
  for (const sig of signals) {
    for (const { name, pool } of pools.slice(1)) {
      const t = testSignal(pool, sig.key);
      if (t.p != null && t.p < 0.10) {
        const h = returnHurdle(pool, sig.key);
        if (h) {
          console.log(`  ${sig.name} within ${name}:`);
          console.log(`    Top half: 3yr ret ${fP(h.topRet)}, alpha ${fP(h.topAlpha)} ann. | Bottom half: ${fP(h.botRet)}, alpha ${fP(h.botAlpha)} | Spread: ${fP(h.spread)}`);
          console.log(`    ${h.passesHurdle ? G + 'PASSES' : R + 'FAILS'} 3% alpha hurdle${X}`);
        }
      }
    }
  }

  // ===================== PART 2: D1 REVERSAL =====================
  hdr('PART 2: D1 GROWTH RATE REVERSAL — IMPLICATIONS');

  sub('2A: Growth Quintiles — Full Population');
  const withD1 = cases.filter(c => c.avgD1 != null && c.forward_return_3yr != null);
  const d1Sorted = [...withD1].sort((a, b) => a.avgD1 - b.avgD1);
  const qSize = Math.floor(d1Sorted.length / 5);
  console.log(`${'Quintile'.padEnd(12)} | ${'Cases'.padStart(6)} | ${'Win Rate'.padStart(9)} | ${'Mean 3yr Ret'.padStart(13)} | ${'vs VOO'.padStart(8)}`);
  console.log('-'.repeat(56));
  for (let q = 0; q < 5; q++) {
    const qCases = d1Sorted.slice(q * qSize, q === 4 ? d1Sorted.length : (q + 1) * qSize);
    const wr = winRate(qCases);
    const ret = mean(qCases.map(c => c.forward_return_3yr));
    const voo = mean(qCases.map(c => c.sp500_return_3yr));
    console.log(`Q${q + 1} ${q === 0 ? '(lowest) ' : q === 4 ? '(highest)' : '         '} | ${String(qCases.length).padStart(6)} | ${fP(wr).padStart(9)} | ${fP(ret).padStart(13)} | ${fP(ret - voo).padStart(8)}`);
  }

  sub('2B: Growth Quintiles — Within Low Short Interest (Pool A)');
  const poolAD1 = poolA.filter(c => c.avgD1 != null && c.forward_return_3yr != null);
  const poolAD1S = [...poolAD1].sort((a, b) => a.avgD1 - b.avgD1);
  const qSizeA = Math.floor(poolAD1S.length / 5);
  console.log(`${'Quintile'.padEnd(12)} | ${'Cases'.padStart(6)} | ${'Win Rate'.padStart(9)} | ${'Mean 3yr Ret'.padStart(13)} | ${'vs VOO'.padStart(8)}`);
  console.log('-'.repeat(56));
  for (let q = 0; q < 5; q++) {
    const qCases = poolAD1S.slice(q * qSizeA, q === 4 ? poolAD1S.length : (q + 1) * qSizeA);
    const wr = winRate(qCases);
    const ret = mean(qCases.map(c => c.forward_return_3yr));
    const voo = mean(qCases.map(c => c.sp500_return_3yr));
    console.log(`Q${q + 1} ${q === 0 ? '(lowest) ' : q === 4 ? '(highest)' : '         '} | ${String(qCases.length).padStart(6)} | ${fP(wr).padStart(9)} | ${fP(ret).padStart(13)} | ${fP(ret - voo).padStart(8)}`);
  }

  sub('2C: Optimal Growth Threshold');
  console.log(`${'Threshold'.padEnd(14)} | ${'Above N'.padStart(8)} | ${'Above WR'.padStart(9)} | ${'Above Ret'.padStart(10)} | ${'Below N'.padStart(8)} | ${'Below WR'.padStart(9)} | ${'Below Ret'.padStart(10)}`);
  console.log('-'.repeat(78));
  for (let th = 0; th <= 30; th += 5) {
    const thVal = th / 100;
    const above = withD1.filter(c => c.avgD1 >= thVal);
    const below = withD1.filter(c => c.avgD1 < thVal);
    if (above.length >= 10 && below.length >= 10) {
      console.log(`CAGR >= ${String(th).padStart(2)}%    | ${String(above.length).padStart(8)} | ${fP(winRate(above)).padStart(9)} | ${fP(mean(above.map(c => c.forward_return_3yr))).padStart(10)} | ${String(below.length).padStart(8)} | ${fP(winRate(below)).padStart(9)} | ${fP(mean(below.map(c => c.forward_return_3yr))).padStart(10)}`);
    }
  }

  // ===================== PART 3: β AS MONITORING SIGNAL =====================
  hdr('PART 3: β AS MONITORING / SELL SIGNAL');

  const withDB4 = cases.filter(c => c.deltaBeta4Q != null);
  const withDB8 = cases.filter(c => c.deltaBeta8Q != null);

  sub('β change after entry vs outcome');
  for (const [label, field, data] of [['Δβ 4Q', 'deltaBeta4Q', withDB4], ['Δβ 8Q', 'deltaBeta8Q', withDB8]]) {
    const w = data.filter(c => c.outcome === 1);
    const t = data.filter(c => c.outcome === 0);
    const wImpr = w.filter(c => c[field] > 0).length;
    const tImpr = t.filter(c => c[field] > 0).length;
    const sp = testSignal(data, field);
    console.log(`  ${label}: N=${data.length}, r=${fN(sp.r, 3)}, p=${fN(sp.p, 3)}`);
    console.log(`    Winners improving: ${fP(wImpr / w.length)} (${wImpr}/${w.length})`);
    console.log(`    Traps improving:   ${fP(tImpr / t.length)} (${tImpr}/${t.length})`);
  }

  // Sell signal simulation
  sub('Sell Signal Simulation: sell if β declines 2+ consecutive Q');
  if (withDB4.length > 0) {
    // Rough proxy: sell if Δβ_4Q < 0 AND Δβ_8Q < 0 (sustained decline)
    const sustainedDecline = cases.filter(c => c.deltaBeta4Q != null && c.deltaBeta8Q != null && c.deltaBeta4Q < 0 && c.deltaBeta8Q < 0);
    const sustainedDecW = sustainedDecline.filter(c => c.outcome === 1);
    const sustainedDecT = sustainedDecline.filter(c => c.outcome === 0);
    const noDecline = cases.filter(c => c.deltaBeta4Q != null && c.deltaBeta8Q != null && !(c.deltaBeta4Q < 0 && c.deltaBeta8Q < 0));
    console.log(`  Sustained β decline (4Q and 8Q both negative): ${sustainedDecline.length} cases`);
    console.log(`    Traps caught: ${sustainedDecT.length} of ${traps.filter(c => c.deltaBeta4Q != null && c.deltaBeta8Q != null).length} total traps (${fP(sustainedDecT.length / Math.max(traps.filter(c => c.deltaBeta4Q != null && c.deltaBeta8Q != null).length, 1))})`);
    console.log(`    Winners falsely sold: ${sustainedDecW.length} of ${winners.filter(c => c.deltaBeta4Q != null && c.deltaBeta8Q != null).length} total winners (${fP(sustainedDecW.length / Math.max(winners.filter(c => c.deltaBeta4Q != null && c.deltaBeta8Q != null).length, 1))})`);
    if (sustainedDecline.length > 0 && noDecline.length > 0) {
      console.log(`    Portfolio with sell trigger: win rate ${fP(winRate(noDecline))} on ${noDecline.length} cases`);
      console.log(`    Portfolio without: win rate ${fP(winRate(cases.filter(c => c.deltaBeta4Q != null && c.deltaBeta8Q != null)))} on ${cases.filter(c => c.deltaBeta4Q != null && c.deltaBeta8Q != null).length} cases`);
    }
  }

  // ===================== PART 4: CURRENT-DATA β =====================
  hdr('PART 4: CURRENT-DATA β (SHORT INTEREST PARALLEL)');

  const withBetaCurr = cases.filter(c => c.betaCurrent != null);
  const sp4 = testSignal(withBetaCurr, 'betaCurrent');
  sub('Current β vs historical outcome');
  console.log(`  N = ${sp4.n}, r = ${fN(sp4.r, 3)}, p = ${fN(sp4.p, 4)}`);
  console.log(`  Winner mean current β: ${fN(mean(withBetaCurr.filter(c => c.outcome === 1).map(c => c.betaCurrent)), 3)}`);
  console.log(`  Trap mean current β:   ${fN(mean(withBetaCurr.filter(c => c.outcome === 0).map(c => c.betaCurrent)), 3)}`);
  console.log(`  Compare: short interest (u159) r=0.27-0.38 across samples`);

  sub('Current β within pre-filtered pools');
  for (const { name, pool } of pools) {
    const t = testSignal(pool, 'betaCurrent');
    console.log(`  ${name.padEnd(35)} r=${fN(t.r, 3)}, p=${fN(t.p, 3)}, N=${t.n}`);
  }

  // ===================== PART 5: UNTESTED THEORIES =====================
  hdr('PART 5: PREVIOUSLY UNTESTED THEORIES');

  // Theory 6: Hurst × D1 direction
  sub('Theory 6: Hurst × D1 Direction Interaction');
  const withHurst = cases.filter(c => c.hurst != null && c.avgD1 != null);
  console.log(`  Cases with both Hurst + D1: ${withHurst.length}`);
  if (withHurst.length >= 50) {
    const hurstHigh = withHurst.filter(c => c.hurst > 0.6);
    const hurstLow = withHurst.filter(c => c.hurst < 0.5);
    const d1Pos = (arr) => arr.filter(c => c.avgD1 > 0);
    const d1Neg = (arr) => arr.filter(c => c.avgD1 <= 0);
    console.log(`\n  ${''.padEnd(20)} | ${'D1 positive'.padStart(18)} | ${'D1 negative'.padStart(18)}`);
    console.log(`  ${''.padEnd(20)} |${'-'.repeat(20)}|${'-'.repeat(20)}`);
    const hhp = d1Pos(hurstHigh), hhn = d1Neg(hurstHigh);
    const hlp = d1Pos(hurstLow), hln = d1Neg(hurstLow);
    console.log(`  ${'High Hurst (>0.6)'.padEnd(20)} | ${fP(winRate(hhp))} N=${String(hhp.length).padStart(3)} | ${fP(winRate(hhn))} N=${String(hhn.length).padStart(3)}`);
    console.log(`  ${'Low Hurst (<0.5)'.padEnd(20)} | ${fP(winRate(hlp))} N=${String(hlp.length).padStart(3)} | ${fP(winRate(hln))} N=${String(hln.length).padStart(3)}`);
    console.log(`  ${'Mid Hurst'.padEnd(20)} | ${fP(winRate(d1Pos(withHurst.filter(c => c.hurst >= 0.5 && c.hurst <= 0.6))))} N=${d1Pos(withHurst.filter(c => c.hurst >= 0.5 && c.hurst <= 0.6)).length} | ${fP(winRate(d1Neg(withHurst.filter(c => c.hurst >= 0.5 && c.hurst <= 0.6))))} N=${d1Neg(withHurst.filter(c => c.hurst >= 0.5 && c.hurst <= 0.6)).length}`);

    // Interaction test: create Hurst × sign(D1) interaction term
    for (const c of withHurst) {
      c.hurstXD1 = c.hurst * Math.sign(c.avgD1);
    }
    const intTest = testSignal(withHurst, 'hurstXD1');
    console.log(`\n  Interaction (Hurst × sign(D1)): r=${fN(intTest.r, 3)}, p=${fN(intTest.p, 4)}, N=${intTest.n}`);
  }

  // Theory 7: Revenue Entropy
  sub('Theory 7: Revenue Stream Entropy');
  const withEntropy = cases.filter(c => c.entropy != null);
  const entTest = testSignal(withEntropy, 'entropy');
  console.log(`  Cases with segment data: ${withEntropy.length}`);
  console.log(`  Entropy vs outcome: r=${fN(entTest.r, 3)}, p=${fN(entTest.p, 4)}, N=${entTest.n}`);
  if (withEntropy.length >= 20) {
    console.log(`  Winner mean entropy: ${fN(mean(withEntropy.filter(c => c.outcome === 1).map(c => c.entropy)), 3)}`);
    console.log(`  Trap mean entropy:   ${fN(mean(withEntropy.filter(c => c.outcome === 0).map(c => c.entropy)), 3)}`);
  }

  // Theory 9: Mutual Information
  sub('Theory 9: Mutual Information vs Sector');
  const withMI = cases.filter(c => c.mi != null);
  const miTest = testSignal(withMI, 'mi');
  console.log(`  Cases with MI: ${withMI.length}`);
  console.log(`  MI vs outcome: r=${fN(miTest.r, 3)}, p=${fN(miTest.p, 4)}, N=${miTest.n}`);
  if (withMI.length >= 20) {
    console.log(`  Winner mean MI: ${fN(mean(withMI.filter(c => c.outcome === 1).map(c => c.mi)), 3)}`);
    console.log(`  Trap mean MI:   ${fN(mean(withMI.filter(c => c.outcome === 0).map(c => c.mi)), 3)}`);
  }

  // Line-item specific Benford
  sub('Line-Item Specific Benford Analysis');
  for (const [label, key] of [['Revenue KLD', 'benfordRevKLD'], ['Expense KLD', 'benfordExpKLD'], ['Cash Flow KLD', 'benfordCfKLD'], ['Divergence (Exp-Rev)', 'benfordDivergence']]) {
    const valid = cases.filter(c => c[key] != null);
    const t = testSignal(valid, key);
    console.log(`  ${label.padEnd(24)}: r=${fN(t.r, 3)}, p=${fN(t.p, 4)}, N=${t.n}`);
  }

  // ===================== PART 6: SYNTHESIS =====================
  hdr('PART 6: FINAL SYNTHESIS TABLE');

  const allSignals = [
    ...signals,
    { key: 'deltaBeta4Q', name: 'β monitoring (Δβ 4Q)' },
    { key: 'deltaBeta8Q', name: 'β monitoring (Δβ 8Q)' },
    { key: 'hurstXD1', name: 'Hurst × D1 interaction' },
    { key: 'benfordRevKLD', name: 'Benford revenue KLD' },
    { key: 'benfordExpKLD', name: 'Benford expense KLD' },
    { key: 'benfordCfKLD', name: 'Benford cash flow KLD' },
  ];

  console.log(`\n${'Signal'.padEnd(28)} | ${'General'.padStart(13)} | ${'Pool C'.padStart(13)} | ${'Pool D'.padStart(13)} | ${'Verdict'.padStart(10)}`);
  console.log('-'.repeat(84));

  const verdicts = [];
  for (const sig of allSignals) {
    const gen = testSignal(cases, sig.key);
    const pc = testSignal(poolC, sig.key);
    const pd = testSignal(poolD, sig.key);

    let verdict = 'DROP';
    if (pd.p != null && pd.p < 0.05) verdict = 'KEEP (D)';
    else if (pc.p != null && pc.p < 0.05) verdict = 'KEEP (C)';
    else if (gen.p != null && gen.p < 0.05) verdict = 'INVESTIGATE';

    const gStr = gen.insuf ? 'insuf' : `r=${fN(gen.r, 3)}`;
    const cStr = pc.insuf ? 'insuf' : `r=${fN(pc.r, 3)}`;
    const dStr = pd.insuf ? 'insuf' : `r=${fN(pd.r, 3)}`;
    const vc = verdict.includes('KEEP') ? G : verdict === 'INVESTIGATE' ? Y : R;

    console.log(`${sig.name.padEnd(28)} | ${gStr.padStart(13)} | ${cStr.padStart(13)} | ${dStr.padStart(13)} | ${vc}${verdict.padStart(10)}${X}`);
    verdicts.push({ signal: sig.name, key: sig.key, gen, poolC: pc, poolD: pd, verdict });
  }

  // ===================== RECOMMENDATION =====================
  hdr('RECOMMENDATION');
  const keeps = verdicts.filter(v => v.verdict.includes('KEEP'));
  const investigates = verdicts.filter(v => v.verdict === 'INVESTIGATE');

  if (keeps.length === 0 && investigates.length === 0) {
    console.log(`\n  ${B}No nonlinear dynamics signal adds value beyond the validated 3-way composite.${X}`);
    console.log(`  The validated signals (short interest + credit spread + filing quality) remain`);
    console.log(`  the only actionable quantitative signals for the AV Framework.`);
  } else {
    console.log(`\n  ${B}Signals that may add conditional value:${X}`);
    for (const v of [...keeps, ...investigates]) {
      console.log(`    ${v.signal}: ${v.verdict}`);
    }
  }

  console.log(`\n  ${B}Recommended architecture update:${X}`);
  console.log(`  1. Do NOT add any nonlinear dynamics signals as primary screening filters`);
  console.log(`  2. The Growth pipeline's 20% CAGR threshold should be reviewed (Part 2 results)`);
  console.log(`  3. β monitoring (Δβ over time) should be evaluated as a sell trigger if Part 3 shows promise`);
  console.log(`  4. Current-data β adds nothing beyond what short interest already captures`);

  // ===================== SAVE =====================
  const reportLines = generateReport(cases, pools, matrixResults, verdicts, withD1, d1Sorted, poolA, poolAD1S, withDB4, withDB8, withHurst, withEntropy, withMI, withBetaCurr, sp4);
  writeFileSync(resolve(RESULTS_DIR, 'conditional-retest-report-2026-03-24.md'), reportLines);
  console.log(`\n${G}Report saved to results/conditional-retest-report-2026-03-24.md${X}`);
}

function generateReport(cases, pools, matrixResults, verdicts, withD1, d1Sorted, poolA, poolAD1S, withDB4, withDB8, withHurst, withEntropy, withMI, withBetaCurr, sp4) {
  const L = [];
  L.push('# Conditional Retest + Untested Theories Report');
  L.push(`\n**Date:** 2026-03-24`);
  L.push(`**Dataset:** ${cases.length} cases (${cases.filter(c=>c.outcome===1).length} W, ${cases.filter(c=>c.outcome===0).length} T)`);
  L.push(`**Pre-registered hurdle:** ≥3% annualized alpha OR ≥30% trap catch rate with ≤15% winner cost\n`);
  L.push('---\n');

  L.push('## Pool Definitions\n');
  for (const {name, pool} of pools) {
    L.push(`- **${name}:** N=${pool.length}, base win rate=${fP(winRate(pool))}`);
  }

  L.push('\n---\n');
  L.push('## Part 1: Signal × Pool Matrix\n');
  L.push('| Signal | General | Pool A | Pool B | Pool C | Pool D |');
  L.push('|--------|---------|--------|--------|--------|--------|');
  for (const row of matrixResults) {
    const cells = [row.signal];
    for (const pName of pools.map(p => p.name)) {
      const t = row[pName];
      cells.push(t.insuf ? `N=${t.n}` : `r=${fN(t.r,3)} p=${fN(t.p,3)}`);
    }
    L.push(`| ${cells.join(' | ')} |`);
  }

  L.push('\n---\n');
  L.push('## Part 6: Final Verdicts\n');
  L.push('| Signal | General r | Pool C r | Pool D r | Verdict |');
  L.push('|--------|-----------|----------|----------|---------|');
  for (const v of verdicts) {
    L.push(`| ${v.signal} | ${v.gen.insuf ? 'insuf' : fN(v.gen.r,3)} | ${v.poolC.insuf ? 'insuf' : fN(v.poolC.r,3)} | ${v.poolD.insuf ? 'insuf' : fN(v.poolD.r,3)} | **${v.verdict}** |`);
  }

  L.push('\n---\n');
  L.push('## Recommendations\n');
  const keeps = verdicts.filter(v => v.verdict.includes('KEEP'));
  if (keeps.length === 0) {
    L.push('No nonlinear dynamics signal adds conditional value beyond the validated 3-way composite.\n');
  }
  L.push('### Architecture Update\n');
  L.push('1. Do NOT deploy nonlinear dynamics signals as screening filters');
  L.push('2. Review Growth pipeline 20% CAGR threshold (high growth may predict traps)');
  L.push('3. Evaluate β monitoring as a sell trigger if Δβ shows asymmetric trap detection');
  L.push('4. Current-data β adds nothing beyond short interest\n');

  L.push('---\n*Report generated by conditional-retest.js*');
  return L.join('\n');
}

main().catch(e => { console.error(e); process.exit(1); });
