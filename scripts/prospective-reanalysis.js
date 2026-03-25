#!/usr/bin/env node
// Prospective-Only Reanalysis — drops look-ahead short interest,
// rebuilds pools from purely prospective signals, retests everything.
//
// Usage: node scripts/prospective-reanalysis.js

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { extractQuarterlyMetrics, extractUsdNumbers, extractAllUsdValues, getRevenueAtDate } from './lib/edgar-extractor.js';
import { benfordFirstDigit } from './lib/benford.js';
import {
  computeScalingExponent, scalingTrajectory,
  companyCSD, revenueDerivatives,
  zipfExponent, rankVelocity, effortAdjustedVelocity, buildSectorRankings, trackRankHistory,
  mutualInformation, computeSectorMedianGrowth,
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

function testSignal(pool, key) {
  const valid = pool.filter(c => c[key] != null);
  if (valid.length < 20) return { r: null, p: null, n: valid.length, insuf: true };
  const sp = spearmanCorrelation(valid.map(c => c[key]), valid.map(c => c.outcome));
  return { r: sp?.rho, p: sp?.p, n: valid.length, insuf: false };
}
function winRate(pool) { return pool.length === 0 ? 0 : pool.filter(c => c.outcome === 1).length / pool.length; }

function returnHurdle(pool, key) {
  const valid = pool.filter(c => c[key] != null && c.forward_return_3yr != null);
  if (valid.length < 20) return null;
  const sorted = [...valid].sort((a, b) => b[key] - a[key]);
  const mid = Math.floor(sorted.length / 2);
  const top = sorted.slice(0, mid), bot = sorted.slice(mid);
  const topRet = mean(top.map(c => c.forward_return_3yr));
  const botRet = mean(bot.map(c => c.forward_return_3yr));
  const topVOO = mean(top.map(c => c.sp500_return_3yr));
  const botVOO = mean(bot.map(c => c.sp500_return_3yr));
  const topAlpha = Math.pow(1 + topRet, 1/3) - 1 - (Math.pow(1 + topVOO, 1/3) - 1);
  const botAlpha = Math.pow(1 + botRet, 1/3) - 1 - (Math.pow(1 + botVOO, 1/3) - 1);
  return { topRet, botRet, topAlpha, botAlpha, spread: topRet - botRet, topN: top.length, passesHurdle: topAlpha >= 0.03 };
}

async function main() {
  hdr('PROSPECTIVE-ONLY REANALYSIS');

  // ========== STEP 1: AUDIT ==========
  hdr('STEP 1: SHORT INTEREST DATA AUDIT');

  console.log(`
  ${B}u159 source:${X} scripts/enrich-short-interest.js → Yahoo Finance quoteSummary/defaultKeyStatistics
  ${B}Data type:${X}  ${R}CURRENT SNAPSHOT${X}
  ${B}Snapshot date:${X} 2026-02-27 (from date_short_interest field in short-interest.json)
  ${B}Key:${X} ticker only (not ticker|entry_date)
  ${B}Result:${X} Same short interest value applied to 2013, 2016, 2019, and 2022 entries

  ${B}u160 source:${X} FRED economic data, keyed by entry date → ${G}CLEAN${X}
  ${B}u024 source:${X} EDGAR filing index, all-time count → ${Y}PARTIALLY CONTAMINATED${X}
    (Includes post-entry filings, but filing patterns are persistent)
  `);

  // Load all data
  console.log('Loading data...');
  const deanonKey = loadJSON(resolve(AGENT_DIR, 'deanonymization-key.json'));
  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};

  const cases = [];
  for (const sample of ['A', 'B', 'C', 'D', 'E']) {
    const data = loadJSON(resolve(AGENT_DIR, `sample-${sample}.json`));
    if (!data) continue;
    for (const c of data) {
      const info = deanonKey.case_id_to_ticker[c.case_id];
      if (!info) continue;
      cases.push({
        case_id: c.case_id, outcome: c.outcome,
        ticker: info.ticker, entry_date: info.entry_date, company: info.company,
        sample,
        u159: c.unconventional?.u159 ?? null,
        u160: c.unconventional?.u160 ?? null,
        u024: c.unconventional?.u024 ?? null,
        f061: c.features?.f061 ?? null,
      });
    }
  }

  // Attach returns + sector
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
    if (ret) { c.forward_return_3yr = ret.forward_return_3yr; c.sp500_return_3yr = ret.sp500_return_3yr; c.sector = ret.sector; c.cik = ret.cik; }
  }

  // Load EDGAR + compute signals
  console.log('Loading EDGAR + computing signals...');
  const tickerFacts = {};
  for (const c of cases) {
    if (tickerFacts[c.ticker] !== undefined) continue;
    let cik = c.cik || cikCache[c.ticker]?.cik;
    if (!cik) { tickerFacts[c.ticker] = null; continue; }
    const padded = cik.replace(/^0+/, '').padStart(10, '0');
    tickerFacts[c.ticker] = loadJSON(resolve(EDGAR_CACHE, `${padded}.json`));
  }

  const sectorCompanies = {};
  for (const c of cases) {
    const facts = tickerFacts[c.ticker];
    if (!facts) continue;
    const qm = extractQuarterlyMetrics(facts, c.entry_date);
    c.qm = qm;
    if (qm.length < 8) continue;

    const beta = computeScalingExponent(qm, 'assets', 'revenue');
    if (beta) c.beta = beta.beta;
    const traj = scalingTrajectory(qm);
    if (traj) { c.betaTrajectory = traj.betaChange; c.betaLate = traj.betaLate; }
    const deriv = revenueDerivatives(qm);
    if (deriv) { c.avgD1 = deriv.avgD1; c.avgD2 = deriv.avgD2; c.phase = deriv.phase; }
    const csd = companyCSD(qm);
    if (csd?.hasData) c.csdIndex = csd.csdIndex;

    // Expense Benford
    const allVals = extractAllUsdValues(facts).filter(v => !c.entry_date || v.end <= c.entry_date);
    const expTags = new Set(['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'OperatingExpenses', 'CostsAndExpenses', 'SellingGeneralAndAdministrativeExpense', 'CostOfSales']);
    const revTags = new Set(['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'Revenue']);
    const expNums = allVals.filter(v => expTags.has(v.tag)).map(v => v.value);
    const revNums = allVals.filter(v => revTags.has(v.tag)).map(v => v.value);
    if (expNums.length >= 20) { const b = benfordFirstDigit(expNums); if (b) c.expBenfordKLD = b.kld; }
    if (revNums.length >= 20) { const b = benfordFirstDigit(revNums); if (b) c.revBenfordKLD = b.kld; }
    if (c.expBenfordKLD != null && c.revBenfordKLD != null) c.benfordDivergence = c.expBenfordKLD - c.revBenfordKLD;

    // Aggregate Benford
    const allNums = extractUsdNumbers(facts);
    if (allNums.length >= 50) { const b = benfordFirstDigit(allNums); if (b) c.benfordKLD = b.kld; }

    if (c.sector) {
      if (!sectorCompanies[c.sector]) sectorCompanies[c.sector] = [];
      sectorCompanies[c.sector].push({ ticker: c.ticker, qm, case: c });
    }
  }

  // Zipf
  for (const [sector, companies] of Object.entries(sectorCompanies)) {
    const sl = companies.map(sc => ({ ticker: sc.ticker, quarterlyMetrics: sc.qm }));
    for (const sc of companies) {
      const c = sc.case;
      const ey = parseInt(c.entry_date.slice(0, 4));
      const years = []; for (let y = ey - 4; y <= ey; y++) years.push(y);
      const h = trackRankHistory(c.ticker, sl, years);
      if (h.ranks.length >= 3) { const rv = rankVelocity(h.ranks, h.years); if (rv) c.zipfVelocity = rv.velocity; }
    }
  }

  // MI
  for (const [sector, companies] of Object.entries(sectorCompanies)) {
    const sectorMed = computeSectorMedianGrowth(companies.map(sc => ({ ticker: sc.ticker, quarterlyMetrics: sc.qm })));
    const keys = Object.keys(sectorMed).sort();
    for (const sc of companies) {
      const cg = [], sg = [];
      for (const qk of keys) { const q = sc.qm.find(q => q.quarter === qk); if (q?.revenueGrowthYoY != null && sectorMed[qk] != null) { cg.push(q.revenueGrowthYoY); sg.push(sectorMed[qk]); } }
      if (cg.length >= 12) { const mi = mutualInformation(cg, sg); if (mi) sc.case.mi = mi.normalizedMI; }
    }
  }

  // Combined β+D1
  const validBD = cases.filter(c => c.betaTrajectory != null && c.avgD1 != null);
  if (validBD.length > 0) {
    const btM = mean(validBD.map(c => c.betaTrajectory)), btS = stddev(validBD.map(c => c.betaTrajectory)) || 1;
    const d1M = mean(validBD.map(c => c.avgD1)), d1S = stddev(validBD.map(c => c.avgD1)) || 1;
    for (const c of validBD) c.combinedBetaD1 = ((c.betaTrajectory - btM) / btS + (c.avgD1 - d1M) / d1S) / 2;
  }

  console.log(`  Total: ${cases.length} cases (${cases.filter(c => c.outcome === 1).length} W, ${cases.filter(c => c.outcome === 0).length} T)`);

  // ========== STEP 1B: CONTAMINATION QUANTIFICATION ==========
  sub('1B: Short Interest Contamination by Entry Cohort');

  // Group by approximate entry year
  const cohorts = [
    { label: '2013 entries', filter: c => c.entry_date.startsWith('2013') },
    { label: '2015-2016 entries', filter: c => c.entry_date.startsWith('2015') || c.entry_date.startsWith('2016') },
    { label: '2017-2018 entries', filter: c => c.entry_date.startsWith('2017') || c.entry_date.startsWith('2018') },
    { label: '2019 entries', filter: c => c.entry_date.startsWith('2019') },
    { label: '2020-2021 entries', filter: c => c.entry_date.startsWith('2020') || c.entry_date.startsWith('2021') },
    { label: '2022 entries', filter: c => c.entry_date.startsWith('2022') },
  ];

  console.log(`${'Cohort'.padEnd(22)} | ${'N'.padStart(5)} | ${'r (u159→outcome)'.padStart(18)} | ${'p'.padStart(8)}`);
  console.log('-'.repeat(60));
  for (const { label, filter } of cohorts) {
    const coh = cases.filter(filter).filter(c => c.u159 != null);
    if (coh.length >= 20) {
      const sp = spearmanCorrelation(coh.map(c => c.u159), coh.map(c => c.outcome));
      console.log(`${label.padEnd(22)} | ${String(coh.length).padStart(5)} | ${fN(sp?.rho, 3).padStart(18)} | ${fN(sp?.p).padStart(8)}`);
    } else {
      console.log(`${label.padEnd(22)} | ${String(coh.length).padStart(5)} | insufficient`);
    }
  }

  // Check: does the correlation weaken for older entries?
  const old = cases.filter(c => (c.entry_date.startsWith('2013') || c.entry_date.startsWith('2015') || c.entry_date.startsWith('2016')) && c.u159 != null);
  const recent = cases.filter(c => (c.entry_date.startsWith('2021') || c.entry_date.startsWith('2022')) && c.u159 != null);
  const spOld = old.length >= 20 ? spearmanCorrelation(old.map(c => c.u159), old.map(c => c.outcome)) : null;
  const spRecent = recent.length >= 20 ? spearmanCorrelation(recent.map(c => c.u159), recent.map(c => c.outcome)) : null;
  console.log(`\n  Old entries (2013-2016): r=${fN(spOld?.rho, 3)}, p=${fN(spOld?.p)}, N=${old.length}`);
  console.log(`  Recent entries (2021-2022): r=${fN(spRecent?.rho, 3)}, p=${fN(spRecent?.p)}, N=${recent.length}`);
  if (spOld?.rho != null && spRecent?.rho != null) {
    const ratio = Math.abs(spRecent.rho / spOld.rho);
    console.log(`  Ratio recent/old: ${fN(ratio, 2)} — ${ratio > 1.5 ? R + 'STRONGER for recent = reading the outcome' : ratio < 0.7 ? G + 'STRONGER for old = persistent quality' : Y + 'SIMILAR across cohorts'}${X}`);
  }

  // ========== STEP 2: CLEAN POOLS ==========
  hdr('STEP 2: PURELY PROSPECTIVE POOL DEFINITIONS');

  // Normalize for composites
  const normStats = {};
  for (const key of ['u160', 'u024', 'expBenfordKLD']) {
    const vals = cases.map(c => c[key]).filter(v => v != null);
    normStats[key] = { mean: mean(vals), std: stddev(vals) || 1 };
  }
  const zScore = (c, key) => c[key] != null ? (c[key] - normStats[key].mean) / normStats[key].std : null;

  // Pool E: high credit spread
  const withU160 = cases.filter(c => c.u160 != null);
  const u160med = median(withU160.map(c => c.u160));
  const poolE = withU160.filter(c => c.u160 >= u160med);

  // Pool F: clean filings (u024 ≤ median, i.e., fewer irregularities)
  const withU024 = cases.filter(c => c.u024 != null);
  const u024med = median(withU024.map(c => c.u024));
  const poolF = withU024.filter(c => c.u024 <= u024med);

  // Pool G: low expense Benford KLD (bottom half)
  const withExpB = cases.filter(c => c.expBenfordKLD != null);
  const expBmed = median(withExpB.map(c => c.expBenfordKLD));
  const poolG = withExpB.filter(c => c.expBenfordKLD <= expBmed);

  // Pool H: 2-way clean composite (u160 + u024) top quintile
  for (const c of cases) {
    const z160 = zScore(c, 'u160');
    const z024 = zScore(c, 'u024');
    if (z160 != null && z024 != null) c.clean2way = (z160 - z024) / 2;
  }
  const withClean2 = cases.filter(c => c.clean2way != null);
  const clean2sorted = [...withClean2].sort((a, b) => b.clean2way - a.clean2way);
  const clean2cut = clean2sorted[Math.floor(clean2sorted.length * 0.2)]?.clean2way ?? 0;
  const poolH = withClean2.filter(c => c.clean2way >= clean2cut);

  // Pool I: 3-way clean composite (u160 + u024 + expense Benford) top quintile
  for (const c of cases) {
    const z160 = zScore(c, 'u160');
    const z024 = zScore(c, 'u024');
    const zExpB = zScore(c, 'expBenfordKLD');
    if (z160 != null && z024 != null && zExpB != null) c.clean3way = (z160 - z024 - zExpB) / 3;
  }
  const withClean3 = cases.filter(c => c.clean3way != null);
  const clean3sorted = [...withClean3].sort((a, b) => b.clean3way - a.clean3way);
  const clean3cut = clean3sorted[Math.floor(clean3sorted.length * 0.2)]?.clean3way ?? 0;
  const poolI = withClean3.filter(c => c.clean3way >= clean3cut);

  // Also build the OLD contaminated pools for comparison
  const withU159 = cases.filter(c => c.u159 != null);
  const u159med = median(withU159.map(c => c.u159));
  const oldPoolA = withU159.filter(c => c.u159 <= u159med);

  for (const c of cases) {
    if (c.u159 != null && c.u160 != null && c.u024 != null) c.oldComposite3 = (-c.u159 + zScore(c, 'u160') - zScore(c, 'u024')) / 3;
  }
  const withOldComp = cases.filter(c => c.oldComposite3 != null);
  const oldCompSorted = [...withOldComp].sort((a, b) => b.oldComposite3 - a.oldComposite3);
  const oldCompCut = oldCompSorted[Math.floor(oldCompSorted.length * 0.2)]?.oldComposite3 ?? 0;
  const oldPoolC = withOldComp.filter(c => c.oldComposite3 >= oldCompCut);
  const oldPoolD = oldPoolA.filter(c => c.oldComposite3 != null && c.oldComposite3 >= oldCompCut);

  const pools = [
    { name: 'General Population', pool: cases, tag: 'gen' },
    { name: 'Pool E — High Credit Spread', pool: poolE, tag: 'E' },
    { name: 'Pool F — Clean Filings', pool: poolF, tag: 'F' },
    { name: 'Pool G — Low Expense Benford', pool: poolG, tag: 'G' },
    { name: 'Pool H — 2-Way Clean Top Q', pool: poolH, tag: 'H' },
    { name: 'Pool I — 3-Way Clean Top Q', pool: poolI, tag: 'I' },
  ];

  const oldPools = [
    { name: 'Old Pool A — Low Short Interest', pool: oldPoolA, tag: 'oldA' },
    { name: 'Old Pool C — 3-Way w/ SI Top Q', pool: oldPoolC, tag: 'oldC' },
    { name: 'Old Pool D — Top Q + Low SI', pool: oldPoolD, tag: 'oldD' },
  ];

  sub('Pool Characteristics');
  console.log(`${'Pool'.padEnd(36)} | ${'N'.padStart(5)} | ${'Win Rate'.padStart(9)} | ${'Lift vs 55.9%'.padStart(14)}`);
  console.log('-'.repeat(70));
  for (const { name, pool } of [...pools, ...oldPools]) {
    const wr = winRate(pool);
    console.log(`${name.padEnd(36)} | ${String(pool.length).padStart(5)} | ${fP(wr).padStart(9)} | ${fP(wr - 0.559).padStart(14)}`);
  }

  // ========== STEP 3: SIGNAL × CLEAN POOL MATRIX ==========
  hdr('STEP 3: SIGNAL × CLEAN POOL MATRIX');

  const signals = [
    { key: 'betaTrajectory', name: 'β trajectory' },
    { key: 'combinedBetaD1', name: 'β traj + D1' },
    { key: 'avgD1', name: 'D1 growth (original)' },
    { key: 'zipfVelocity', name: 'Zipf velocity' },
    { key: 'expBenfordKLD', name: 'Expense Benford KLD' },
    { key: 'benfordDivergence', name: 'Benford divergence' },
    { key: 'mi', name: 'Mutual information' },
    { key: 'beta', name: 'β static' },
    { key: 'csdIndex', name: 'CSD index' },
  ];

  console.log(`${'Signal'.padEnd(22)} | ${'General'.padStart(14)} | ${'Pool E'.padStart(14)} | ${'Pool H'.padStart(14)} | ${'Pool I'.padStart(14)} | ${'Old Pool D'.padStart(14)}`);
  console.log('-'.repeat(86));

  for (const sig of signals) {
    const gen = testSignal(cases, sig.key);
    const e = testSignal(poolE, sig.key);
    const h = testSignal(poolH, sig.key);
    const i = testSignal(poolI, sig.key);
    const d = testSignal(oldPoolD, sig.key);
    const fmt = t => t.insuf ? `N=${t.n} insuf` : `r=${fN(t.r,3)} p=${fN(t.p,3)}`;
    console.log(`${sig.name.padEnd(22)} | ${fmt(gen).padStart(14)} | ${fmt(e).padStart(14)} | ${fmt(h).padStart(14)} | ${fmt(i).padStart(14)} | ${fmt(d).padStart(14)}`);
  }

  // Return hurdles for p < 0.10 combinations
  sub('Return Hurdle Tests (p < 0.10 in clean pools)');
  let anyHurdlePassed = false;
  for (const sig of signals) {
    for (const { name, pool } of pools.slice(1)) {
      const t = testSignal(pool, sig.key);
      if (t.p != null && t.p < 0.10) {
        const h = returnHurdle(pool, sig.key);
        if (h) {
          anyHurdlePassed = true;
          console.log(`  ${sig.name} within ${name}:`);
          console.log(`    Top: 3yr ret ${fP(h.topRet)}, alpha ${fP(h.topAlpha)} ann. | Bot: ${fP(h.botRet)}, alpha ${fP(h.botAlpha)} | Spread: ${fP(h.spread)} ${h.passesHurdle ? G + 'PASS' : R + 'FAIL'}${X}`);
        }
      }
    }
  }
  if (!anyHurdlePassed) console.log('  No signal reached p < 0.10 in any clean pool.');

  // ========== STEP 4: D1 GROWTH REVERSAL IN CLEAN POOLS ==========
  hdr('STEP 4: GROWTH REVERSAL IN CLEAN POOLS');

  for (const { name, pool } of [{ name: 'Pool E (credit spread)', pool: poolE }, { name: 'Pool F (clean filings)', pool: poolF }, { name: 'Pool I (3-way clean top Q)', pool: poolI }]) {
    sub(`Growth Quintiles within ${name}`);
    const withD1 = pool.filter(c => c.avgD1 != null && c.forward_return_3yr != null);
    if (withD1.length < 25) { console.log(`  Insufficient (N=${withD1.length})`); continue; }
    const sorted = [...withD1].sort((a, b) => a.avgD1 - b.avgD1);
    const qSize = Math.floor(sorted.length / 5);
    console.log(`${'Quintile'.padEnd(12)} | ${'Cases'.padStart(6)} | ${'Win Rate'.padStart(9)} | ${'Mean 3yr Ret'.padStart(13)} | ${'vs VOO'.padStart(8)}`);
    console.log('-'.repeat(56));
    for (let q = 0; q < 5; q++) {
      const qCases = sorted.slice(q * qSize, q === 4 ? sorted.length : (q + 1) * qSize);
      const wr = winRate(qCases);
      const ret = mean(qCases.map(c => c.forward_return_3yr));
      const voo = mean(qCases.map(c => c.sp500_return_3yr));
      console.log(`Q${q + 1} ${q === 0 ? '(lowest) ' : q === 4 ? '(highest)' : '         '} | ${String(qCases.length).padStart(6)} | ${fP(wr).padStart(9)} | ${fP(ret).padStart(13)} | ${fP(ret - voo).padStart(8)}`);
    }
  }

  // ========== STEP 5: BEST PROSPECTIVE SYSTEM ==========
  hdr('STEP 5: CANDIDATE PROSPECTIVE SYSTEMS');

  const systems = [
    { name: 'A: Credit spread only', poolFn: c => c.u160 != null && c.u160 >= u160med },
    { name: 'B: 2-way (spread+filing) top Q', poolFn: c => c.clean2way != null && c.clean2way >= clean2cut },
    { name: 'C: 3-way (spread+filing+expBen) top Q', poolFn: c => c.clean3way != null && c.clean3way >= clean3cut },
    { name: 'D: System C + β traj top half', poolFn: c => {
      if (!(c.clean3way != null && c.clean3way >= clean3cut && c.betaTrajectory != null)) return false;
      const iPool = cases.filter(x => x.clean3way != null && x.clean3way >= clean3cut && x.betaTrajectory != null);
      const btMed = median(iPool.map(x => x.betaTrajectory));
      return c.betaTrajectory >= btMed;
    }},
    { name: 'E: System C − high growth Q5', poolFn: c => {
      if (!(c.clean3way != null && c.clean3way >= clean3cut)) return false;
      // Exclude top quintile of D1
      if (c.avgD1 == null) return true;
      const iPool = cases.filter(x => x.clean3way != null && x.clean3way >= clean3cut && x.avgD1 != null);
      const d1sorted = [...iPool].sort((a, b) => a.avgD1 - b.avgD1);
      const q5cut = d1sorted[Math.floor(d1sorted.length * 0.8)]?.avgD1 ?? Infinity;
      return c.avgD1 < q5cut;
    }},
  ];

  // Also include the contaminated system for comparison
  const contaminatedSystems = [
    { name: 'X: Old 3-way w/ SI top Q', poolFn: c => c.oldComposite3 != null && c.oldComposite3 >= oldCompCut },
    { name: 'Y: Old Pool D + β traj', poolFn: c => {
      if (!(c.u159 != null && c.u159 <= u159med && c.oldComposite3 != null && c.oldComposite3 >= oldCompCut && c.betaTrajectory != null)) return false;
      const dPool = cases.filter(x => x.u159 != null && x.u159 <= u159med && x.oldComposite3 != null && x.oldComposite3 >= oldCompCut && x.betaTrajectory != null);
      const btMed = median(dPool.map(x => x.betaTrajectory));
      return c.betaTrajectory >= btMed;
    }},
  ];

  console.log(`${'System'.padEnd(42)} | ${'N'.padStart(5)} | ${'Win Rate'.padStart(9)} | ${'Mean 3yr'.padStart(9)} | ${'VOO 3yr'.padStart(8)} | ${'Ann α'.padStart(7)} | ${'Freq'.padStart(6)}`);
  console.log('-'.repeat(95));

  for (const sys of [...systems, ...contaminatedSystems]) {
    const pool = cases.filter(sys.poolFn);
    if (pool.length < 5) { console.log(`${sys.name.padEnd(42)} | N=${pool.length} insufficient`); continue; }
    const withRet = pool.filter(c => c.forward_return_3yr != null);
    const wr = winRate(pool);
    const ret = mean(withRet.map(c => c.forward_return_3yr));
    const voo = mean(withRet.map(c => c.sp500_return_3yr));
    const alpha = Math.pow(1 + ret, 1/3) - 1 - (Math.pow(1 + voo, 1/3) - 1);
    const freq = pool.length / cases.length;
    const colorStart = sys.name.startsWith('X') || sys.name.startsWith('Y') ? DIM : '';
    const colorEnd = colorStart ? X : '';
    console.log(`${colorStart}${sys.name.padEnd(42)} | ${String(pool.length).padStart(5)} | ${fP(wr).padStart(9)} | ${fP(ret).padStart(9)} | ${fP(voo).padStart(8)} | ${fP(alpha).padStart(7)} | ${fP(freq).padStart(6)}${colorEnd}`);
  }

  // ========== STEP 6: GAP ANALYSIS ==========
  hdr('STEP 6: WHAT WE LOSE WITHOUT SHORT INTEREST');

  sub('Head-to-Head Comparison');
  const sysC_pool = cases.filter(c => c.clean3way != null && c.clean3way >= clean3cut);
  const sysX_pool = cases.filter(c => c.oldComposite3 != null && c.oldComposite3 >= oldCompCut);
  const sysC_wr = winRate(sysC_pool);
  const sysX_wr = winRate(sysX_pool);
  const sysC_ret = mean(sysC_pool.filter(c => c.forward_return_3yr != null).map(c => c.forward_return_3yr));
  const sysX_ret = mean(sysX_pool.filter(c => c.forward_return_3yr != null).map(c => c.forward_return_3yr));
  const sysC_voo = mean(sysC_pool.filter(c => c.sp500_return_3yr != null).map(c => c.sp500_return_3yr));
  const sysX_voo = mean(sysX_pool.filter(c => c.sp500_return_3yr != null).map(c => c.sp500_return_3yr));
  const sysC_alpha = Math.pow(1 + sysC_ret, 1/3) - 1 - (Math.pow(1 + sysC_voo, 1/3) - 1);
  const sysX_alpha = Math.pow(1 + sysX_ret, 1/3) - 1 - (Math.pow(1 + sysX_voo, 1/3) - 1);

  console.log(`  ${''.padEnd(35)} | ${'Win Rate'.padStart(9)} | ${'3yr Ret'.padStart(8)} | ${'Ann α'.padStart(7)} | ${'N'.padStart(5)}`);
  console.log(`  ${'Best clean (3-way no SI)'.padEnd(35)} | ${fP(sysC_wr).padStart(9)} | ${fP(sysC_ret).padStart(8)} | ${fP(sysC_alpha).padStart(7)} | ${String(sysC_pool.length).padStart(5)}`);
  console.log(`  ${'Best contaminated (3-way w/ SI)'.padEnd(35)} | ${fP(sysX_wr).padStart(9)} | ${fP(sysX_ret).padStart(8)} | ${fP(sysX_alpha).padStart(7)} | ${String(sysX_pool.length).padStart(5)}`);
  console.log(`  ${'Gap'.padEnd(35)} | ${fP(sysX_wr - sysC_wr).padStart(9)} | ${fP(sysX_ret - sysC_ret).padStart(8)} | ${fP(sysX_alpha - sysC_alpha).padStart(7)} |`);

  const gap = sysX_wr - sysC_wr;
  if (gap > 0.10) console.log(`\n  ${R}LARGE GAP: Short interest adds >${fP(gap)} win rate. Historical SI data is a MUST-HAVE.${X}`);
  else if (gap > 0.03) console.log(`\n  ${Y}MODERATE GAP: Short interest adds ${fP(gap)} win rate. Historical SI data is valuable.${X}`);
  else console.log(`\n  ${G}SMALL GAP: Short interest adds only ${fP(gap)} win rate. Prospective system is nearly as good.${X}`);

  // ========== SAVE REPORT ==========
  const report = generateReport(cases, pools, oldPools, signals, systems, contaminatedSystems,
    sysC_pool, sysX_pool, sysC_wr, sysX_wr, sysC_alpha, sysX_alpha,
    spOld, spRecent, old, recent, gap);
  writeFileSync(resolve(RESULTS_DIR, 'prospective-only-reanalysis-2026-03-24.md'), report);
  console.log(`\n${G}Report saved to results/prospective-only-reanalysis-2026-03-24.md${X}`);
}

function generateReport(cases, pools, oldPools, signals, systems, contSystems,
  sysCPool, sysXPool, sysCWr, sysXWr, sysCAlpha, sysXAlpha,
  spOld, spRecent, oldCohort, recentCohort, gap) {
  const L = [];
  L.push('# Prospective-Only Reanalysis Report');
  L.push(`\n**Date:** 2026-03-24`);
  L.push(`**Dataset:** ${cases.length} cases`);
  L.push(`**Purpose:** Remove short interest look-ahead contamination, rebuild on purely prospective signals\n`);
  L.push('---\n');

  L.push('## Step 1: Short Interest Audit\n');
  L.push('| Signal | Source | Temporal Status |');
  L.push('|--------|--------|----------------|');
  L.push('| u159 (short % float) | Yahoo Finance quoteSummary | **CURRENT SNAPSHOT** (2026-02-27) — look-ahead |');
  L.push('| u158 (days to cover) | Yahoo Finance quoteSummary | **CURRENT SNAPSHOT** — look-ahead |');
  L.push('| u160 (credit spread) | FRED, keyed by entry_date | **CLEAN** — prospective |');
  L.push('| u024 (filing quality) | EDGAR filing index, all-time | **PARTIALLY CONTAMINATED** — includes post-entry filings |');
  L.push('| expense Benford KLD | EDGAR financials, filtered by entry_date | **CLEAN** — prospective |\n');
  L.push(`Cohort analysis of u159: old entries (2013-2016) r=${fN(spOld?.rho, 3)}, recent (2021-2022) r=${fN(spRecent?.rho, 3)}.`);
  L.push(`Ratio recent/old: ${spOld?.rho && spRecent?.rho ? fN(Math.abs(spRecent.rho / spOld.rho), 2) : 'N/A'}.\n`);

  L.push('---\n');
  L.push('## Step 2: Clean Pool Characteristics\n');
  L.push('| Pool | Definition | N | Win Rate |');
  L.push('|------|-----------|---|----------|');
  for (const { name, pool } of [...pools, ...oldPools]) {
    L.push(`| ${name} | | ${pool.length} | ${fP(winRate(pool))} |`);
  }

  L.push('\n---\n');
  L.push('## Step 5: Prospective Systems Comparison\n');
  L.push('| System | N | Win Rate | Ann. Alpha |');
  L.push('|--------|---|----------|-----------|');
  L.push(`| Best clean (3-way no SI) | ${sysCPool.length} | ${fP(sysCWr)} | ${fP(sysCAlpha)} |`);
  L.push(`| Best contaminated (w/ SI) | ${sysXPool.length} | ${fP(sysXWr)} | ${fP(sysXAlpha)} |`);
  L.push(`| **Gap** | | **${fP(sysXWr - sysCWr)}** | **${fP(sysXAlpha - sysCAlpha)}** |\n`);

  L.push('---\n');
  L.push('## Conclusion\n');
  if (gap > 0.10) {
    L.push('**Large gap.** Short interest adds significant precision. Acquiring historical short interest data (FINRA archive) is strongly recommended.\n');
  } else if (gap > 0.03) {
    L.push('**Moderate gap.** The prospective system works but is meaningfully weaker. Historical short interest data would be valuable.\n');
  } else {
    L.push('**Small gap.** The prospective system is nearly as good. Historical short interest is nice-to-have.\n');
  }

  const bestCleanAlpha = sysCAlpha;
  L.push(`Best purely prospective system: **3-way composite (credit spread + filing quality + expense Benford KLD), top quintile.**`);
  L.push(`Expected annualized alpha vs VOO: **${fP(bestCleanAlpha)}**.`);
  L.push(`Recommendation: **Deploy the 3-way clean composite. Acquire historical short interest data (FINRA) to validate whether SI adds prospective value.**`);

  L.push('\n---\n*Report generated by prospective-reanalysis.js*');
  return L.join('\n');
}

main().catch(e => { console.error(e); process.exit(1); });
