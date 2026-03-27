#!/usr/bin/env node

// Wave 2A: Compute all validated signals on mid-cap cases.
// Signals: credit spread (macro), SI dynamics (company), Fisher, Benford, EPS quality.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { getCreditSpreadForCase } from '../warehouse/connectors/fred-credit-spread.js';
import { creditSpreadCSD, creditSpreadOU, siBetaScaling, siTrajectory, siMeanReversion, siCSD, siDerivatives, computeAllSignals, extractTestableScores } from '../warehouse/connectors/market-dynamics.js';
import { fisherInformation } from '../services/fisher-information.js';
import { multiBaseBenford, roundNumberExcess } from '../services/multi-base-benford.js';

const CAL = resolve(import.meta.dirname, '..');

function mean(a) { return a.length ? a.reduce((s,v) => s+v, 0) / a.length : 0; }

function assignRanks(arr) {
  const n = arr.length;
  const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && idx[j + 1].v === idx[j].v) j++;
    const avg = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

function spearman(x, y) {
  const n = x.length;
  if (n < 10) return { r: 0, p: 1, n };
  const rx = assignRanks(x), ry = assignRanks(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
  const r = 1 - (6 * sumD2) / (n * (n * n - 1));
  return { r: +r.toFixed(4), n };
}

function crossValidate(scores, outcomes, folds = 5) {
  const n = scores.length;
  let seed = 42;
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [indices[i], indices[j]] = [indices[j], indices[i]]; }
  const foldSize = Math.ceil(n / folds);
  const perFold = [];
  for (let f = 0; f < folds; f++) {
    const testIdx = new Set(indices.slice(f * foldSize, (f + 1) * foldSize));
    const ts = [], to = [];
    for (let i = 0; i < n; i++) { if (testIdx.has(i)) { ts.push(scores[i]); to.push(outcomes[i]); } }
    if (ts.length >= 10) perFold.push(spearman(ts, to).r);
  }
  return { cvMean: +(mean(perFold)).toFixed(4), perFold, folds: perFold.length, pass: perFold.filter(r => r > 0).length };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  WAVE 2A: MID-CAP SIGNAL COMPUTATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const mcData = JSON.parse(readFileSync(join(CAL, 'midcap-cases.json'), 'utf-8'));
  const cases = mcData.cases;
  console.log(`Mid-cap cases: ${cases.length}`);

  // Load SI data
  const siDir = join(CAL, 'midcap-si');
  const siByTicker = {};
  if (existsSync(siDir)) {
    for (const f of readdirSync(siDir).filter(f => f.endsWith('.json'))) {
      const ticker = f.replace('.json', '');
      try {
        siByTicker[ticker] = JSON.parse(readFileSync(join(siDir, f), 'utf-8'));
      } catch {}
    }
  }
  console.log(`SI data loaded for: ${Object.keys(siByTicker).length} tickers`);

  // Load EDGAR data for Fisher/Benford
  const edgarDir = join(CAL, 'midcap-edgar-raw');

  function getQuarterlyRevenue(ticker, beforeDate) {
    const path = join(edgarDir, `${ticker}.json`);
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    const revConcepts = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'];
    for (const concept of revConcepts) {
      const entries = data.facts?.[concept];
      if (!entries) continue;
      const quarterly = entries
        .filter(e => (e.form === '10-Q' || e.form === '10-K') && e.end && e.end <= beforeDate)
        .sort((a, b) => a.end.localeCompare(b.end));
      const seen = new Set();
      const deduped = quarterly.filter(e => { if (seen.has(e.end)) return false; seen.add(e.end); return true; });
      if (deduped.length >= 8) return deduped.map(e => e.val);
    }
    return [];
  }

  function getAllFinancialValues(ticker, beforeDate) {
    const path = join(edgarDir, `${ticker}.json`);
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    const values = [];
    for (const [concept, entries] of Object.entries(data.facts || {})) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (e.end && e.end <= beforeDate && e.val > 0 && (e.form === '10-Q' || e.form === '10-K')) {
          values.push(e.val);
        }
      }
    }
    return values;
  }

  function getEPS(ticker, beforeDate) {
    const path = join(edgarDir, `${ticker}.json`);
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    const entries = data.facts?.EarningsPerShareDiluted || data.facts?.EarningsPerShareBasic;
    if (!entries) return [];
    return entries
      .filter(e => e.end && e.end <= beforeDate && e.form === '10-Q')
      .sort((a, b) => a.end.localeCompare(b.end))
      .map(e => e.val);
  }

  // Compute signals for each case
  const results = [];
  let spreadOk = 0, siOk = 0, fisherOk = 0, benfordOk = 0, epsOk = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const signals = {};

    // Credit spread (macro — same for all cases at same date)
    const spreadSeries = getCreditSpreadForCase(c.entry_date, 3);
    if (spreadSeries.length >= 25) {
      const csd = creditSpreadCSD(spreadSeries, 10);
      const ou = creditSpreadOU(spreadSeries);
      signals.spread_variance_slope = csd?.varianceSlope ?? null;
      signals.spread_theta = ou?.theta ?? null;
      if (csd) spreadOk++;
    }

    // SI dynamics
    const si = siByTicker[c.ticker];
    if (si && si.length >= 8) {
      const preEntry = si.filter(s => s.date <= c.entry_date);
      if (preEntry.length >= 8) {
        const allSig = computeAllSignals(preEntry);
        const scores = extractTestableScores(allSig);
        Object.assign(signals, scores);
        siOk++;
      }
    }

    // Fisher information
    const revenue = getQuarterlyRevenue(c.ticker, c.entry_date);
    if (revenue.length >= 8) {
      const fisher = fisherInformation(revenue);
      if (fisher) { signals.fisher = fisher.fisherMedian; fisherOk++; }
    }

    // Multi-base Benford
    const finValues = getAllFinancialValues(c.ticker, c.entry_date);
    if (finValues.length >= 50) {
      const benford = multiBaseBenford(finValues);
      signals.structural_stress = benford.classification === 'STRUCTURAL_STRESS' ? 1 : 0;
      signals.base10_excess = benford.base10_excess;
      benfordOk++;
    }

    // EPS quality
    const eps = getEPS(c.ticker, c.entry_date);
    if (eps.length >= 8) {
      const rn = roundNumberExcess(eps);
      if (rn) { signals.round_number_excess = rn.excess; epsOk++; }
    }

    results.push({
      case_id: c.case_id,
      ticker: c.ticker,
      entry_date: c.entry_date,
      classification: c.classification,
      alpha_3yr: c.alpha_3yr,
      forward_return_3yr: c.forward_return_3yr,
      market_cap: c.market_cap,
      cross_section: c.cross_section,
      signals,
    });

    if ((i + 1) % 200 === 0) {
      process.stdout.write(`\r  [${i + 1}/${cases.length}] spread=${spreadOk} si=${siOk} fisher=${fisherOk} benford=${benfordOk} eps=${epsOk}    `);
    }
  }

  console.log(`\n\n  Signal coverage:`);
  console.log(`    Spread: ${spreadOk}/${cases.length}`);
  console.log(`    SI dynamics: ${siOk}/${cases.length}`);
  console.log(`    Fisher: ${fisherOk}/${cases.length}`);
  console.log(`    Benford: ${benfordOk}/${cases.length}`);
  console.log(`    EPS quality: ${epsOk}/${cases.length}`);

  // Test signal discrimination on mid-cap data
  console.log('\n── SIGNAL DISCRIMINATION (Mid-Cap) ──\n');

  const wtCases = results.filter(r => r.classification === 'winner' || r.classification === 'trap');
  const outcomeNums = wtCases.map(r => r.classification === 'winner' ? 1 : -1);

  const signalKeys = ['spread_variance_slope', 'spread_theta', 'composite', 'si_change', 'si_d1', 'si_d2', 'si_theta', 'si_csd', 'si_beta', 'si_zipf_velocity', 'fisher', 'base10_excess', 'round_number_excess'];

  console.log('  Signal                     | r      | n    | CV mean | CV pass');
  console.log('  ' + '─'.repeat(70));

  for (const key of signalKeys) {
    const valid = wtCases.filter(r => r.signals[key] != null && isFinite(r.signals[key]));
    if (valid.length < 30) continue;
    const scores = valid.map(r => r.signals[key]);
    const outs = valid.map(r => r.classification === 'winner' ? 1 : -1);
    const corr = spearman(scores, outs);
    const cv = crossValidate(scores, outs);
    console.log(`  ${key.padEnd(28)} | ${corr.r.toFixed(3).padStart(6)} | ${String(corr.n).padStart(4)} | ${cv.cvMean.toFixed(3).padStart(7)} | ${cv.pass}/5`);
  }

  // Save merged signals
  writeFileSync(join(CAL, 'midcap-signals-merged.json'), JSON.stringify({
    generated: new Date().toISOString(),
    total: results.length,
    results,
  }, null, 2));

  writeFileSync(join(CAL, 'midcap-signals-merged.flag'), `ready ${new Date().toISOString()}`);
  console.log('\n  Saved midcap-signals-merged.json');
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
