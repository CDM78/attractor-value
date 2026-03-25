#!/usr/bin/env node
// Anonymization pipeline for the blind research agent protocol.
// Loads all systematic cases, computes EDGAR financial features, attaches
// unconventional data, anonymizes identifiers, z-score normalizes, and
// splits into 5 non-overlapping samples.
//
// Usage: node scripts/anonymize-dataset.js

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash, randomBytes } from 'crypto';
import { loadSystematicCases } from './lib/calibration-data.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const UNCONV_DIR = resolve(DATA_DIR, 'unconventional');
const EDGAR_CACHE = resolve(DATA_DIR, 'edgar-cache');
const AGENT_DIR = resolve(DATA_DIR, 'agent');
mkdirSync(AGENT_DIR, { recursive: true });

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }
function stddev(arr) { const m = mean(arr); return m != null && arr.length > 1 ? Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)) : null; }
function linSlope(arr) {
  const n = arr.length; if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += arr[i]; sxy += i * arr[i]; sx2 += i * i; }
  const d = n * sx2 - sx * sx;
  return d === 0 ? 0 : (n * sxy - sx * sy) / d;
}
function cv(arr) { const m = mean(arr); const s = stddev(arr); return m && s != null ? s / Math.abs(m) : null; }
function pctChange(a, b) { return b && b !== 0 ? (a - b) / Math.abs(b) : null; }
function safeDiv(a, b) { return b && b !== 0 ? a / b : null; }
function round3(v) { return v != null ? Math.round(v * 1000) / 1000 : null; }

// Seeded PRNG (simple Mulberry32)
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================
// EDGAR FINANCIAL FEATURE EXTRACTION
// ============================================

// XBRL concept aliases — try multiple tags for each metric
const REVENUE_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'];
const ASSETS_TAGS = ['Assets'];
const EQUITY_TAGS = ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'];
const LIABILITIES_TAGS = ['Liabilities'];
const OP_INCOME_TAGS = ['OperatingIncomeLoss'];
const NET_INCOME_TAGS = ['NetIncomeLoss'];
const OCF_TAGS = ['NetCashProvidedByOperatingActivities'];
const GROSS_PROFIT_TAGS = ['GrossProfit'];
const CAPEX_TAGS = ['PaymentsToAcquirePropertyPlantAndEquipment'];
const RND_TAGS = ['ResearchAndDevelopmentExpense'];
const SGA_TAGS = ['SellingGeneralAndAdministrativeExpense'];
const AR_TAGS = ['AccountsReceivableNetCurrent', 'AccountsReceivableNet'];
const GOODWILL_TAGS = ['Goodwill'];
const LT_DEBT_TAGS = ['LongTermDebt', 'LongTermDebtNoncurrent'];
const SHARES_TAGS = ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'];
const INTEREST_TAGS = ['InterestExpense'];

function getFactValues(facts, tags, namespace = 'us-gaap') {
  const ns = facts?.facts?.[namespace];
  if (!ns) return [];
  for (const tag of tags) {
    const concept = ns[tag];
    if (!concept) continue;
    const units = concept.units;
    const values = units?.USD || units?.shares || Object.values(units || {})[0];
    if (values?.length) return values;
  }
  // Try dei namespace for shares
  if (namespace === 'us-gaap') {
    const dei = facts?.facts?.dei;
    if (dei) {
      for (const tag of tags) {
        const concept = dei[tag];
        if (!concept) continue;
        const values = concept.units?.shares || Object.values(concept.units || {})[0];
        if (values?.length) return values;
      }
    }
  }
  // Try IFRS namespace
  const ifrs = facts?.facts?.['ifrs-full'];
  if (ifrs) {
    const ifrsMap = {
      'Revenues': ['Revenue'],
      'Assets': ['Assets'],
      'StockholdersEquity': ['Equity', 'EquityAttributableToOwnersOfParent'],
      'Liabilities': ['Liabilities'],
      'OperatingIncomeLoss': ['ProfitLossFromOperatingActivities'],
      'NetIncomeLoss': ['ProfitLoss'],
      'GrossProfit': ['GrossProfit'],
    };
    for (const tag of tags) {
      const ifrsTags = ifrsMap[tag] || [];
      for (const it of ifrsTags) {
        const concept = ifrs[it];
        if (!concept) continue;
        const values = concept.units?.USD || concept.units?.EUR || concept.units?.GBP || Object.values(concept.units || {})[0];
        if (values?.length) return values;
      }
    }
  }
  return [];
}

// Get time series of annual values before target date
function getAnnualSeries(values, beforeDate, n = 5) {
  const annual = values
    .filter(v => (v.form === '10-K' || v.form === '20-F') && v.filed <= beforeDate && v.end <= beforeDate)
    .sort((a, b) => b.end.localeCompare(a.end));

  // Deduplicate by fiscal year
  const seen = new Set();
  const deduped = [];
  for (const v of annual) {
    const fy = v.fy || v.end.slice(0, 4);
    if (!seen.has(fy)) {
      seen.add(fy);
      deduped.push(v);
    }
  }
  return deduped.slice(0, n).reverse(); // oldest first
}

// Get most recent quarterly values before target date
function getQuarterlySeries(values, beforeDate, n = 8) {
  const quarterly = values
    .filter(v => (v.form === '10-Q' || v.form === '10-K' || v.form === '20-F') && v.filed <= beforeDate && v.end <= beforeDate)
    .sort((a, b) => b.end.localeCompare(a.end));

  const seen = new Set();
  const deduped = [];
  for (const v of quarterly) {
    const period = v.end;
    if (!seen.has(period)) {
      seen.add(period);
      deduped.push(v);
    }
  }
  return deduped.slice(0, n).reverse();
}

function getLatestValue(values, beforeDate) {
  const filtered = values
    .filter(v => v.filed <= beforeDate && v.end <= beforeDate)
    .sort((a, b) => b.end.localeCompare(a.end));
  return filtered[0]?.val ?? null;
}

function computeEdgarFeatures(facts, entryDate) {
  if (!facts) return {};
  const f = {};

  // Get raw time series
  const revVals = getFactValues(facts, REVENUE_TAGS);
  const assetsVals = getFactValues(facts, ASSETS_TAGS);
  const equityVals = getFactValues(facts, EQUITY_TAGS);
  const opIncVals = getFactValues(facts, OP_INCOME_TAGS);
  const netIncVals = getFactValues(facts, NET_INCOME_TAGS);
  const ocfVals = getFactValues(facts, OCF_TAGS);
  const gpVals = getFactValues(facts, GROSS_PROFIT_TAGS);
  const capexVals = getFactValues(facts, CAPEX_TAGS);
  const sgaVals = getFactValues(facts, SGA_TAGS);
  const arVals = getFactValues(facts, AR_TAGS);
  const goodwillVals = getFactValues(facts, GOODWILL_TAGS);
  const ltDebtVals = getFactValues(facts, LT_DEBT_TAGS);
  const interestVals = getFactValues(facts, INTEREST_TAGS);

  // Annual series for growth rates
  const revAnnual = getAnnualSeries(revVals, entryDate, 5).map(v => v.val);
  const assetsAnnual = getAnnualSeries(assetsVals, entryDate, 5).map(v => v.val);
  const equityAnnual = getAnnualSeries(equityVals, entryDate, 3).map(v => v.val);
  const ltDebtAnnual = getAnnualSeries(ltDebtVals, entryDate, 3).map(v => v.val);

  // Quarterly series for trend slopes
  const opIncQ = getQuarterlySeries(opIncVals, entryDate, 8).map(v => v.val);
  const gpQ = getQuarterlySeries(gpVals, entryDate, 8).map(v => v.val);
  const revQ = getQuarterlySeries(revVals, entryDate, 8).map(v => v.val);
  const sgaQ = getQuarterlySeries(sgaVals, entryDate, 8).map(v => v.val);
  const capexQ = getQuarterlySeries(capexVals, entryDate, 8).map(v => v.val);
  const netIncQ = getQuarterlySeries(netIncVals, entryDate, 8).map(v => v.val);
  const ocfQ = getQuarterlySeries(ocfVals, entryDate, 8).map(v => v.val);
  const arQ = getQuarterlySeries(arVals, entryDate, 8).map(v => v.val);

  // Latest values
  const latestRev = revAnnual.length ? revAnnual[revAnnual.length - 1] : null;
  const latestAssets = getLatestValue(assetsVals, entryDate);
  const latestEquity = getLatestValue(equityVals, entryDate);
  const latestOpInc = getLatestValue(opIncVals, entryDate);
  const latestNetInc = getLatestValue(netIncVals, entryDate);
  const latestOcf = getLatestValue(ocfVals, entryDate);
  const latestGP = getLatestValue(gpVals, entryDate);
  const latestCapex = getLatestValue(capexVals, entryDate);
  const latestSga = getLatestValue(sgaVals, entryDate);
  const latestAr = getLatestValue(arVals, entryDate);
  const latestGoodwill = getLatestValue(goodwillVals, entryDate);
  const latestLtDebt = getLatestValue(ltDebtVals, entryDate);
  const latestInterest = getLatestValue(interestVals, entryDate);

  // === REVENUE METRICS (f001-f004) ===
  if (revAnnual.length >= 2) {
    f.f001 = round3(pctChange(revAnnual[revAnnual.length - 1], revAnnual[revAnnual.length - 2]));
  }
  if (revQ.length >= 8) {
    const recent4 = revQ.slice(-4).reduce((s, v) => s + v, 0);
    const prior4 = revQ.slice(0, 4).reduce((s, v) => s + v, 0);
    f.f002 = round3(pctChange(recent4, prior4));
  }
  if (revQ.length >= 4) {
    f.f003 = round3(cv(revQ));
  }
  if (revAnnual.length >= 3) {
    const g1 = pctChange(revAnnual[revAnnual.length - 1], revAnnual[revAnnual.length - 2]);
    const g0 = pctChange(revAnnual[revAnnual.length - 2], revAnnual[revAnnual.length - 3]);
    if (g1 != null && g0 != null) f.f004 = round3(g1 - g0);
  }

  // === PROFITABILITY (f010-f015) ===
  f.f010 = round3(safeDiv(latestOpInc, latestRev));
  if (opIncQ.length >= 4 && revQ.length >= 4) {
    const margins = opIncQ.map((v, i) => revQ[i] ? v / revQ[i] : null).filter(v => v != null);
    f.f011 = round3(linSlope(margins));
  }
  f.f012 = round3(safeDiv(latestGP, latestRev));
  if (gpQ.length >= 4 && revQ.length >= 4) {
    const gMargins = gpQ.map((v, i) => revQ[i] ? v / revQ[i] : null).filter(v => v != null);
    f.f013 = round3(linSlope(gMargins));
  }
  const investedCapital = (latestEquity || 0) + (latestLtDebt || 0);
  f.f014 = round3(safeDiv(latestOpInc, investedCapital || null));
  // ROIC trend — need quarterly
  if (opIncQ.length >= 4) {
    const equitySeries = getQuarterlySeries(equityVals, entryDate, 8).map(v => v.val);
    const debtSeries = getQuarterlySeries(ltDebtVals, entryDate, 8).map(v => v.val);
    const roicSeries = opIncQ.map((v, i) => {
      const ic = (equitySeries[i] || 0) + (debtSeries[i] || 0);
      return ic > 0 ? v / ic : null;
    }).filter(v => v != null);
    if (roicSeries.length >= 3) f.f015 = round3(linSlope(roicSeries));
  }

  // === SCALE (f020-f022) ===
  f.f020 = latestAssets > 0 ? round3(Math.log(latestAssets)) : null;
  if (assetsAnnual.length >= 2) {
    f.f021 = round3(pctChange(assetsAnnual[assetsAnnual.length - 1], assetsAnnual[assetsAnnual.length - 2]));
  }
  f.f022 = latestRev > 0 ? round3(Math.log(latestRev)) : null;

  // === EFFICIENCY (f030-f035) ===
  f.f030 = round3(safeDiv(latestRev, latestAssets));
  if (revQ.length >= 4 && assetsAnnual.length >= 2) {
    f.f031 = round3(linSlope(revQ.map((v, i) => latestAssets > 0 ? v / latestAssets : null).filter(v => v != null)));
  }
  f.f032 = round3(safeDiv(latestSga, latestRev));
  if (sgaQ.length >= 4 && revQ.length >= 4) {
    const sgaPcts = sgaQ.map((v, i) => revQ[i] ? v / revQ[i] : null).filter(v => v != null);
    f.f033 = round3(linSlope(sgaPcts));
  }
  f.f034 = latestCapex != null && latestRev ? round3(Math.abs(latestCapex) / Math.abs(latestRev)) : null;
  if (capexQ.length >= 4 && revQ.length >= 4) {
    const capexPcts = capexQ.map((v, i) => revQ[i] ? Math.abs(v) / Math.abs(revQ[i]) : null).filter(v => v != null);
    f.f035 = round3(linSlope(capexPcts));
  }

  // === QUALITY (f040-f043) ===
  if (latestNetInc != null && latestOcf != null && latestAssets) {
    f.f040 = round3((latestNetInc - latestOcf) / Math.abs(latestAssets));
  }
  if (netIncQ.length >= 4 && ocfQ.length >= 4) {
    const accruals = netIncQ.map((v, i) => latestAssets ? (v - (ocfQ[i] || 0)) / Math.abs(latestAssets) : null).filter(v => v != null);
    f.f041 = round3(linSlope(accruals));
  }
  if (arQ.length >= 2 && revQ.length >= 2) {
    const arGrowth = pctChange(arQ[arQ.length - 1], arQ[0]);
    const revGrowth = pctChange(revQ[revQ.length - 1], revQ[0]);
    if (arGrowth != null && revGrowth != null) f.f042 = round3(arGrowth - revGrowth);
  }
  if (latestOcf != null && latestCapex != null && latestNetInc) {
    const fcf = latestOcf - Math.abs(latestCapex);
    f.f043 = round3(safeDiv(fcf, Math.abs(latestNetInc)));
  }

  // === LEVERAGE (f050-f052) ===
  f.f050 = round3(safeDiv(latestLtDebt, latestEquity));
  if (ltDebtAnnual.length >= 2 && equityAnnual.length >= 2) {
    const de1 = safeDiv(ltDebtAnnual[ltDebtAnnual.length - 1], equityAnnual[equityAnnual.length - 1]);
    const de0 = safeDiv(ltDebtAnnual[0], equityAnnual[0]);
    if (de1 != null && de0 != null) f.f051 = round3(de1 - de0);
  }
  f.f052 = latestInterest && latestInterest !== 0 ? round3(latestOpInc / Math.abs(latestInterest)) : null;

  // === SIGNAL SCORES (f060-f063) — computed later in sector context ===
  // f060: zipf_rank_velocity (needs sector peers)
  // f061: flywheel_momentum (needs sector rank)
  // f062: d1_growth_rate = same as f001
  f.f062 = f.f001 ?? null;
  // f063: scale_invariance_cv
  const metricCVs = [f.f003, cv(opIncQ), cv(assetsAnnual)].filter(v => v != null);
  f.f063 = metricCVs.length > 0 ? round3(mean(metricCVs)) : null;

  return f;
}

// ============================================
// SECTOR-RELATIVE FEATURES
// ============================================
function computeSectorFeatures(allCasesWithFeatures) {
  // Group by sector
  const bySector = {};
  for (const c of allCasesWithFeatures) {
    const s = c._sector || 'Unknown';
    if (!bySector[s]) bySector[s] = [];
    bySector[s].push(c);
  }

  for (const [sector, sectorCases] of Object.entries(bySector)) {
    // Compute sector medians
    const revGrowths = sectorCases.map(c => c.features.f001).filter(v => v != null).sort((a, b) => a - b);
    const margins = sectorCases.map(c => c.features.f010).filter(v => v != null).sort((a, b) => a - b);
    const sizes = sectorCases.map(c => c.features.f020).filter(v => v != null).sort((a, b) => a - b);

    const medianRevGrowth = revGrowths.length ? revGrowths[Math.floor(revGrowths.length / 2)] : null;
    const medianMargin = margins.length ? margins[Math.floor(margins.length / 2)] : null;

    for (const c of sectorCases) {
      // f070: revenue growth vs sector median
      if (c.features.f001 != null && medianRevGrowth != null) {
        c.features.f070 = round3(c.features.f001 - medianRevGrowth);
      }
      // f071: margin vs sector median
      if (c.features.f010 != null && medianMargin != null) {
        c.features.f071 = round3(c.features.f010 - medianMargin);
      }
      // f072: size percentile in sector
      if (c.features.f020 != null && sizes.length > 1) {
        const rank = sizes.filter(s => s <= c.features.f020).length;
        c.features.f072 = round3(rank / sizes.length);
      }

      // f060: Zipf rank velocity — rank change in revenue growth within sector
      // Simplified: use percentile rank of revenue growth within sector
      if (c.features.f001 != null && revGrowths.length > 1) {
        const rank = revGrowths.filter(g => g <= c.features.f001).length;
        c.features.f060 = round3(rank / revGrowths.length);
      }

      // f061: Flywheel momentum — asset_rank × ROIC_rank
      if (c.features.f020 != null && c.features.f014 != null && sizes.length > 1) {
        const sizeRank = sizes.filter(s => s <= c.features.f020).length / sizes.length;
        const roics = sectorCases.map(x => x.features.f014).filter(v => v != null).sort((a, b) => a - b);
        if (roics.length > 1) {
          const roicRank = roics.filter(r => r <= c.features.f014).length / roics.length;
          c.features.f061 = round3(sizeRank * roicRank);
        }
      }
    }
  }
}

// ============================================
// UNCONVENTIONAL DATA ATTACHMENT
// ============================================
function loadUnconventionalPools() {
  return {
    priceVolume: loadJSON(resolve(UNCONV_DIR, 'price-volume-dynamics.json')) || {},
    shortInterest: loadJSON(resolve(UNCONV_DIR, 'short-interest.json')) || {},
    fredContext: loadJSON(resolve(UNCONV_DIR, 'economic-context.json')) || {},
    secMetadata: loadJSON(resolve(UNCONV_DIR, 'sec-filing-metadata.json')) || {},
    customerConc: loadJSON(resolve(UNCONV_DIR, 'customer-concentration.json')) || {},
    execComp: loadJSON(resolve(UNCONV_DIR, 'exec-compensation.json')) || {},
    wikipedia: loadJSON(resolve(UNCONV_DIR, 'wikipedia-pageviews.json')) || {},
    clinicalTrials: loadJSON(resolve(UNCONV_DIR, 'clinical-trials.json')) || {},
    githubActivity: loadJSON(resolve(UNCONV_DIR, 'github-activity.json')) || {},
  };
}

function attachUnconventional(c, pools) {
  const u = {};
  const ticker = c._ticker;
  const entryDate = c._entry_date;
  const pvKey = `${ticker}|${entryDate}`;

  // Price/Volume (u150-u156)
  const pv = pools.priceVolume[pvKey];
  if (pv) {
    u.u150 = pv.momentum_6m ?? null;
    u.u151 = pv.momentum_12m ?? null;
    // u152: pct from 52-week high
    if (pv.weekly_closes?.length >= 2) {
      const high52 = Math.max(...pv.weekly_closes);
      const latest = pv.weekly_closes[pv.weekly_closes.length - 1];
      u.u152 = high52 > 0 ? round3((latest - high52) / high52) : null;
    }
    u.u153 = pv.volatility_annual ?? null;
    u.u154 = pv.relative_volume ?? null;
    // u155: up weeks pct
    if (pv.weekly_closes?.length >= 10) {
      let ups = 0;
      for (let i = 1; i < pv.weekly_closes.length; i++) {
        if (pv.weekly_closes[i] > pv.weekly_closes[i - 1]) ups++;
      }
      u.u155 = round3(ups / (pv.weekly_closes.length - 1));
    }
    // u156: max weekly drawdown
    if (pv.weekly_closes?.length >= 4) {
      let maxDD = 0, peak = pv.weekly_closes[0];
      for (const close of pv.weekly_closes) {
        if (close > peak) peak = close;
        const dd = peak > 0 ? (close - peak) / peak : 0;
        if (dd < maxDD) maxDD = dd;
      }
      u.u156 = round3(maxDD);
    }
    u.u157 = pv.volume_trend_slope ?? null;
  }

  // Short Interest (u158-u160)
  const si = pools.shortInterest[ticker];
  if (si) {
    u.u158 = si.short_ratio ?? null;
    u.u159 = si.short_pct_float ?? null;
    // short interest change (current vs prior month)
    if (si.shares_short && si.shares_short_prior_month) {
      u.u160_si = round3(pctChange(si.shares_short, si.shares_short_prior_month));
    }
  }

  // FRED Economic Context (u160-u165) — by entry date
  const econ = pools.fredContext[entryDate];
  if (econ) {
    u.u160 = econ.credit_spread ?? null;
    u.u161 = econ.yield_curve_10y2y ?? null;
    u.u162 = econ.vix ?? null;
    u.u163 = econ.unemployment ?? null;
    u.u164 = econ.fed_funds ?? null;
    u.u165 = econ.sp500_trailing_12m ?? null;
  }

  // SEC Filing Metadata (u020-u024)
  const sec = pools.secMetadata[ticker];
  if (sec) {
    u.u020 = sec.nt_filings ?? null;
    u.u021 = sec.total_10KA ?? null;
    u.u022 = sec.filing_size_trend ?? null;
    u.u023 = sec.amendment_rate ?? null;
    // u024: has any NT or amendment flag
    u.u024 = (sec.nt_filings > 0 || sec.total_10KA > 0 || sec.total_10QA > 0) ? 1 : 0;
  }

  // Customer Concentration (u080-u082)
  const cc = pools.customerConc[ticker];
  if (cc?.status === 'ok') {
    u.u080 = cc.concentration_disclosed ? 1 : 0;
    u.u081 = cc.largest_customer_pct ?? null;
    u.u082 = cc.customers_above_10pct ?? null;
  }

  // Executive Compensation (u070-u073)
  const ec = pools.execComp[ticker];
  if (ec?.status === 'ok' && ec.ceo_total_comp) {
    u.u070 = ec.ceo_total_comp;
    u.u071 = ec.ceo_salary_pct ?? null; // performance pct = 1 - salary_pct
    u.u072 = ec.ceo_salary_pct ?? null;
    u.u073 = ec.ceo_equity_pct ?? null; // rough equity pct
  }

  // Wikipedia (u130-u132)
  const wiki = pools.wikipedia[ticker];
  if (wiki?.status === 'ok' && wiki.monthly_views_24mo?.length) {
    u.u130 = wiki.mean_monthly_views ?? null;
    u.u131 = round3(linSlope(wiki.monthly_views_24mo));
    const spikes = wiki.monthly_views_24mo.filter(v => v > (wiki.mean_monthly_views || 0) * 2).length;
    u.u132 = spikes;
  }

  // Clinical Trials (u040-u043) — healthcare/pharma only
  const ct = pools.clinicalTrials[ticker];
  if (ct?.status === 'ok' && ct.total_trials_4yr > 0) {
    u.u040 = ct.total_trials_4yr;
    u.u041 = ct.phase3_count ?? null;
    // trial velocity: slope of trials by year
    if (ct.trials_by_year) {
      const yearVals = Object.entries(ct.trials_by_year).sort().map(([, v]) => v);
      u.u042 = round3(linSlope(yearVals));
    }
    u.u043 = ct.termination_rate ?? null;
  }

  // GitHub (u120-u122) — tech only
  const gh = pools.githubActivity[ticker];
  if (gh?.status === 'ok') {
    u.u120 = gh.public_repos ?? null;
    u.u121 = gh.followers ?? null;
  }

  // Build coverage flags
  u._coverage = {
    price_volume: pv != null,
    short_interest: si?.shares_short != null,
    economic_context: econ != null,
    sec_metadata: sec != null,
    customer_concentration: cc?.status === 'ok',
    exec_comp: ec?.status === 'ok',
    wikipedia: wiki?.status === 'ok',
    clinical_trials: ct?.status === 'ok' && (ct.total_trials_4yr || 0) > 0,
    github: gh?.status === 'ok',
  };

  return u;
}

// ============================================
// Z-SCORE NORMALIZATION
// ============================================
function zScoreNormalize(cases) {
  // Collect all feature keys
  const featureKeys = new Set();
  for (const c of cases) {
    for (const k of Object.keys(c.features || {})) featureKeys.add(k);
    for (const k of Object.keys(c.unconventional || {})) {
      if (!k.startsWith('_')) featureKeys.add(k);
    }
  }

  const stats = {};
  for (const key of featureKeys) {
    const vals = cases.map(c => c.features?.[key] ?? c.unconventional?.[key]).filter(v => v != null && typeof v === 'number');
    if (vals.length < 5) continue;
    const m = mean(vals);
    const s = stddev(vals);
    if (s != null && s > 0) stats[key] = { mean: m, std: s };
  }

  // Apply z-scores
  for (const c of cases) {
    for (const [key, { mean: m, std: s }] of Object.entries(stats)) {
      const val = c.features?.[key] ?? c.unconventional?.[key];
      if (val != null && typeof val === 'number') {
        const z = round3((val - m) / s);
        if (c.features?.[key] != null) c.features[key] = z;
        else if (c.unconventional?.[key] != null) c.unconventional[key] = z;
      }
    }
  }

  return stats;
}

// ============================================
// ANONYMIZATION
// ============================================
function anonymize(cases) {
  // Sector mapping
  const sectors = [...new Set(cases.map(c => c._sector).filter(Boolean))];
  const sectorMap = {};
  for (const s of sectors) {
    sectorMap[s] = 'S' + randomBytes(2).toString('hex');
  }

  // Period mapping (by calendar quarter)
  const periodMap = {};
  let periodCounter = 0;
  for (const c of cases) {
    const date = c._entry_date;
    if (!date) continue;
    const quarter = `${date.slice(0, 4)}-Q${Math.ceil(parseInt(date.slice(5, 7)) / 3)}`;
    if (!periodMap[quarter]) {
      periodMap[quarter] = `P${String(periodCounter++).padStart(3, '0')}`;
    }
  }

  // Shuffle period codes so temporal order is hidden
  const periodCodes = Object.values(periodMap);
  const shuffledCodes = seededShuffle(periodCodes, 42);
  const periodValues = Object.keys(periodMap);
  const shuffledPeriodMap = {};
  for (let i = 0; i < periodValues.length; i++) {
    shuffledPeriodMap[periodValues[i]] = shuffledCodes[i];
  }

  // Anonymize cases
  const anonymized = cases.map((c, i) => {
    const quarter = c._entry_date ? `${c._entry_date.slice(0, 4)}-Q${Math.ceil(parseInt(c._entry_date.slice(5, 7)) / 3)}` : null;
    return {
      case_id: `C${String(i).padStart(4, '0')}`,
      outcome: c._outcome === 'winner' ? 1 : 0,
      sector: c._sector ? sectorMap[c._sector] : null,
      period: quarter ? shuffledPeriodMap[quarter] : null,
      features: c.features || {},
      unconventional: (() => {
        const u = { ...c.unconventional };
        delete u._coverage;
        return u;
      })(),
      _coverage: c.unconventional?._coverage || {},
    };
  });

  // Build deanonymization key
  const dekey = {
    case_id_to_ticker: {},
    sector_code_to_name: Object.fromEntries(Object.entries(sectorMap).map(([k, v]) => [v, k])),
    period_code_to_quarter: Object.fromEntries(Object.entries(shuffledPeriodMap).map(([k, v]) => [v, k])),
    seed: 20260324,
  };
  for (let i = 0; i < cases.length; i++) {
    dekey.case_id_to_ticker[`C${String(i).padStart(4, '0')}`] = {
      ticker: cases[i]._ticker,
      entry_date: cases[i]._entry_date,
      company: cases[i]._company,
    };
  }

  return { anonymized, dekey, sectorMap, periodMap: shuffledPeriodMap };
}

// ============================================
// FEATURE DICTIONARY
// ============================================
function buildFeatureDictionary() {
  return {
    // EDGAR financial features — generic descriptions only
    f001: 'Financial metric: annual growth rate of primary business measure',
    f002: 'Financial metric: trailing-4-period vs prior-4-period growth',
    f003: 'Financial metric: volatility (coefficient of variation) of primary measure',
    f004: 'Financial metric: acceleration (2nd derivative of growth)',
    f010: 'Profitability: operating efficiency ratio (latest)',
    f011: 'Profitability: operating efficiency trend slope',
    f012: 'Profitability: gross efficiency ratio (latest)',
    f013: 'Profitability: gross efficiency trend slope',
    f014: 'Profitability: return on deployed capital (latest)',
    f015: 'Profitability: return on deployed capital trend slope',
    f020: 'Scale: log of total size measure',
    f021: 'Scale: size growth rate',
    f022: 'Scale: log of primary business volume',
    f030: 'Efficiency: business volume per unit of size',
    f031: 'Efficiency: volume/size ratio trend',
    f032: 'Efficiency: overhead as fraction of business volume',
    f033: 'Efficiency: overhead fraction trend slope',
    f034: 'Efficiency: reinvestment rate as fraction of business volume',
    f035: 'Efficiency: reinvestment rate trend slope',
    f040: 'Quality: accrual ratio (earnings quality measure)',
    f041: 'Quality: accrual ratio trend slope',
    f042: 'Quality: receivables growth vs business growth differential',
    f043: 'Quality: cash generation vs reported earnings ratio',
    f050: 'Leverage: borrowed capital to own capital ratio',
    f051: 'Leverage: change in borrowed/own capital ratio',
    f052: 'Leverage: operating income coverage of borrowing costs',
    f060: 'Signal: rank trajectory within peer group (velocity)',
    f061: 'Signal: compound rank score (size × profitability)',
    f062: 'Signal: primary business growth rate (same as f001)',
    f063: 'Signal: consistency across multiple metrics (avg CV)',
    f070: 'Relative: primary growth vs peer group median',
    f071: 'Relative: operating efficiency vs peer group median',
    f072: 'Relative: size percentile within peer group',

    // Unconventional features
    u020: 'Filing: count of late/delinquent regulatory submissions',
    u021: 'Filing: count of amended annual reports',
    u022: 'Filing: trend in document size over time',
    u023: 'Filing: amendment rate (amendments / primary filings)',
    u024: 'Filing: flag — has any late or amended filings (0/1)',
    u040: 'Sector-specific: R&D pipeline count (4yr)',
    u041: 'Sector-specific: late-stage R&D count',
    u042: 'Sector-specific: R&D pipeline velocity slope',
    u043: 'Sector-specific: R&D termination rate',
    u070: 'Governance: top executive total compensation',
    u071: 'Governance: fraction of comp that is base/fixed',
    u072: 'Governance: fraction of comp that is base salary',
    u073: 'Governance: fraction of comp that is equity/performance',
    u080: 'Concentration: whether major counterparty disclosed (0/1)',
    u081: 'Concentration: largest single counterparty as pct of business',
    u082: 'Concentration: count of counterparties above 10% threshold',
    u120: 'Alternative: public open-source project count',
    u121: 'Alternative: community followers count',
    u130: 'Alternative: mean monthly public attention measure',
    u131: 'Alternative: public attention trend slope',
    u132: 'Alternative: attention spike count (>2x mean)',
    u150: 'Market: 6-month price momentum',
    u151: 'Market: 12-month price momentum',
    u152: 'Market: pct from 52-week high (negative = below high)',
    u153: 'Market: annualized price volatility',
    u154: 'Market: relative trading activity (recent vs full year)',
    u155: 'Market: fraction of weeks with positive returns',
    u156: 'Market: maximum weekly drawdown from peak',
    u157: 'Market: trading activity trend slope',
    u158: 'Market: days-to-cover ratio (bearish positioning)',
    u159: 'Market: bearish positioning as pct of tradable supply',
    u160: 'Macro: credit risk spread',
    u160_si: 'Market: change in bearish positioning (current vs prior month)',
    u161: 'Macro: yield curve slope (long vs short rates)',
    u162: 'Macro: market fear index level',
    u163: 'Macro: labor market slack measure',
    u164: 'Macro: central bank policy rate',
    u165: 'Macro: broad market trailing 12-month return',
  };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${B}Anonymization Pipeline — Blind Research Agent${X}`);
  console.log('='.repeat(60));

  // STEP 1: Load all systematic cases
  console.log(`\n${C}Step 1: Loading systematic cases...${X}`);
  const rawCases = loadSystematicCases();
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) rawCases.push(...d.cases);
  }

  // Deduplicate
  const seen = new Set();
  const allCases = rawCases.filter(c => {
    const k = `${c.ticker}|${c.entry_date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(`  Total cases: ${allCases.length}`);

  // Filter to winner/trap only
  const wtCases = allCases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');
  console.log(`  Winner/trap cases: ${wtCases.length} (${wtCases.filter(c => c.outcome === 'winner').length}W / ${wtCases.filter(c => c.outcome === 'trap').length}T)`);

  // STEP 2: Load CIK cache
  console.log(`\n${C}Step 2: Loading CIK cache...${X}`);
  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};

  // STEP 3: Compute EDGAR features for each case
  console.log(`\n${C}Step 3: Computing EDGAR financial features...${X}`);
  const casesWithFeatures = [];
  let edgarHits = 0, edgarMisses = 0;

  for (let i = 0; i < wtCases.length; i++) {
    const c = wtCases[i];
    const cikEntry = cikCache[c.ticker];
    const cik = cikEntry?.cik || null;

    let features = {};
    if (cik) {
      const factsPath = resolve(EDGAR_CACHE, `${cik}.json`);
      const facts = loadJSON(factsPath);
      if (facts) {
        features = computeEdgarFeatures(facts, c.entry_date);
        edgarHits++;
      } else {
        edgarMisses++;
      }
    } else {
      edgarMisses++;
    }

    casesWithFeatures.push({
      _ticker: c.ticker,
      _company: c.company,
      _entry_date: c.entry_date,
      _outcome: c.outcome,
      _sector: c.sector,
      _source: c.source,
      features,
    });

    if ((i + 1) % 200 === 0 || i === wtCases.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${wtCases.length} cases processed (${edgarHits} EDGAR hits, ${edgarMisses} misses)`);
    }
  }
  console.log('');

  // STEP 4: Compute sector-relative features
  console.log(`\n${C}Step 4: Computing sector-relative features...${X}`);
  computeSectorFeatures(casesWithFeatures);
  console.log(`  ${G}Sector features computed${X}`);

  // STEP 5: Attach unconventional data
  console.log(`\n${C}Step 5: Attaching unconventional data pools...${X}`);
  const pools = loadUnconventionalPools();

  const coverageCounts = {};
  for (const c of casesWithFeatures) {
    c.unconventional = attachUnconventional(c, pools);
    for (const [k, v] of Object.entries(c.unconventional._coverage || {})) {
      if (!coverageCounts[k]) coverageCounts[k] = 0;
      if (v) coverageCounts[k]++;
    }
  }

  console.log('  Coverage:');
  for (const [k, v] of Object.entries(coverageCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round(v / casesWithFeatures.length * 100);
    console.log(`    ${k}: ${v}/${casesWithFeatures.length} (${pct}%)`);
  }

  // STEP 6: Z-score normalize
  console.log(`\n${C}Step 6: Z-score normalizing features...${X}`);
  const normStats = zScoreNormalize(casesWithFeatures);
  console.log(`  ${G}Normalized ${Object.keys(normStats).length} features${X}`);

  // STEP 7: Anonymize
  console.log(`\n${C}Step 7: Anonymizing...${X}`);
  const { anonymized, dekey, sectorMap, periodMap } = anonymize(casesWithFeatures);
  console.log(`  ${G}${anonymized.length} cases anonymized${X}`);
  console.log(`  Sectors: ${Object.keys(sectorMap).length} → anonymous codes`);
  console.log(`  Periods: ${Object.keys(periodMap).length} → shuffled codes`);

  // STEP 8: Split into 5 samples
  console.log(`\n${C}Step 8: Splitting into 5 non-overlapping samples...${X}`);
  const shuffled = seededShuffle(anonymized, 20260324);
  const sampleSize = Math.floor(shuffled.length / 5);
  const samples = {
    A: shuffled.slice(0, sampleSize),
    B: shuffled.slice(sampleSize, sampleSize * 2),
    C: shuffled.slice(sampleSize * 2, sampleSize * 3),
    D: shuffled.slice(sampleSize * 3, sampleSize * 4),
    E: shuffled.slice(sampleSize * 4),
  };

  for (const [name, sample] of Object.entries(samples)) {
    const winners = sample.filter(c => c.outcome === 1).length;
    const traps = sample.filter(c => c.outcome === 0).length;
    console.log(`  Sample ${name}: ${sample.length} cases (${winners}W / ${traps}T)`);
  }

  // STEP 9: Save everything
  console.log(`\n${C}Step 9: Saving output files...${X}`);

  for (const [name, sample] of Object.entries(samples)) {
    writeFileSync(resolve(AGENT_DIR, `sample-${name}.json`), JSON.stringify(sample, null, 2));
  }

  writeFileSync(resolve(AGENT_DIR, 'feature-dictionary.json'), JSON.stringify(buildFeatureDictionary(), null, 2));

  // Coverage summary
  const coverageSummary = {};
  for (const [k, v] of Object.entries(coverageCounts)) {
    coverageSummary[k] = { count: v, total: casesWithFeatures.length, pct: Math.round(v / casesWithFeatures.length * 100) };
  }
  writeFileSync(resolve(AGENT_DIR, 'coverage-summary.json'), JSON.stringify(coverageSummary, null, 2));

  // Normalization stats (so agent can understand scale)
  writeFileSync(resolve(AGENT_DIR, 'normalization-stats.json'), JSON.stringify(normStats, null, 2));

  // Deanonymization key
  writeFileSync(resolve(AGENT_DIR, 'deanonymization-key.json'), JSON.stringify(dekey, null, 2));

  // Sample assignment map
  const sampleAssignments = {};
  for (const [name, sample] of Object.entries(samples)) {
    sampleAssignments[name] = sample.map(c => c.case_id);
  }
  writeFileSync(resolve(AGENT_DIR, 'sample-assignments.json'), JSON.stringify(sampleAssignments, null, 2));

  console.log(`\n${B}${G}Anonymization complete!${X}`);
  console.log(`  Output directory: ${AGENT_DIR}`);
  console.log(`  Files: sample-A.json through sample-E.json`);
  console.log(`  Plus: feature-dictionary.json, coverage-summary.json, deanonymization-key.json`);

  // Print feature availability stats
  const featureKeys = new Set();
  for (const c of anonymized) {
    for (const k of Object.keys(c.features)) featureKeys.add(k);
    for (const k of Object.keys(c.unconventional)) {
      if (!k.startsWith('_')) featureKeys.add(k);
    }
  }
  let totalFeatures = 0, sparseFeaturesCount = 0;
  for (const key of featureKeys) {
    const nonNull = anonymized.filter(c => (c.features[key] ?? c.unconventional[key]) != null).length;
    totalFeatures++;
    if (nonNull < anonymized.length * 0.1) sparseFeaturesCount++;
  }
  console.log(`  Total features: ${totalFeatures} (${sparseFeaturesCount} sparse <10% coverage)`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
