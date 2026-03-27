#!/usr/bin/env node

// Recompute Fisher, Benford, EPS, and Zipf signals on mid-cap cases.
// Handles both EDGAR raw file formats (our 754-set and agent's 333-set).

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { getCreditSpreadForCase } from '../warehouse/connectors/fred-credit-spread.js';
import { creditSpreadCSD, creditSpreadOU, computeAllSignals, extractTestableScores, siZipfVelocity, buildSectorSIRanking } from '../warehouse/connectors/market-dynamics.js';
import { fisherInformation } from '../services/fisher-information.js';
import { multiBaseBenford, roundNumberExcess } from '../services/multi-base-benford.js';

const CAL = resolve(import.meta.dirname, '..');

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }

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
  return { r: +(1 - (6 * sumD2) / (n * (n * n - 1))).toFixed(4), n };
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
  return { cvMean: +(mean(perFold)).toFixed(4), pass: perFold.filter(r => r > 0).length };
}

// Unified EDGAR data extractor — handles both file formats
function extractRevenue(ticker, beforeDate) {
  const path = join(CAL, 'midcap-edgar-raw', `${ticker}.json`);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf-8'));

  // Format 1: data.facts.Revenues = [{end, val, form, ...}]
  if (data.facts) {
    for (const concept of ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax']) {
      const entries = data.facts[concept];
      if (!entries || !Array.isArray(entries)) continue;
      const filtered = entries.filter(e => e.end && e.end <= beforeDate && (e.form === '10-Q' || e.form === '10-K'))
        .sort((a, b) => a.end.localeCompare(b.end));
      const seen = new Set();
      const deduped = filtered.filter(e => { if (seen.has(e.end)) return false; seen.add(e.end); return true; });
      if (deduped.length >= 8) return deduped.map(e => e.val);
    }
  }

  // Format 2: data.concepts.RevenueFromContract..._USD = [{end, val, form, ...}]
  if (data.concepts) {
    for (const key of Object.keys(data.concepts)) {
      if (!/revenue|sales/i.test(key)) continue;
      const entries = data.concepts[key];
      if (!entries || !Array.isArray(entries)) continue;
      const filtered = entries.filter(e => e.end && e.end <= beforeDate && (e.form === '10-Q' || e.form === '10-K'))
        .sort((a, b) => a.end.localeCompare(b.end));
      const seen = new Set();
      const deduped = filtered.filter(e => { if (seen.has(e.end)) return false; seen.add(e.end); return true; });
      if (deduped.length >= 8) return deduped.map(e => e.val);
    }
  }

  return [];
}

function extractAllValues(ticker, beforeDate) {
  const path = join(CAL, 'midcap-edgar-raw', `${ticker}.json`);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  const values = [];

  const source = data.facts || data.concepts || {};
  for (const [, entries] of Object.entries(source)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (e.end && e.end <= beforeDate && e.val > 0 && (e.form === '10-Q' || e.form === '10-K')) {
        values.push(e.val);
      }
    }
  }
  return values;
}

function extractEPS(ticker, beforeDate) {
  const path = join(CAL, 'midcap-edgar-raw', `${ticker}.json`);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf-8'));

  const source = data.facts || data.concepts || {};
  for (const key of Object.keys(source)) {
    if (!/earningspershare.*diluted/i.test(key)) continue;
    const entries = source[key];
    if (!Array.isArray(entries)) continue;
    return entries.filter(e => e.end && e.end <= beforeDate && e.form === '10-Q')
      .sort((a, b) => a.end.localeCompare(b.end)).map(e => e.val);
  }
  return [];
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RECOMPUTE MID-CAP SIGNALS (Fisher, Benford, EPS, Zipf)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load existing signal data
  const existing = JSON.parse(readFileSync(join(CAL, 'midcap-signals-merged.json'), 'utf-8'));
  const results = existing.results;
  console.log(`Cases: ${results.length}`);

  // Load SI data for Zipf
  const siDir = join(CAL, 'midcap-si');
  const siByTicker = {};
  if (existsSync(siDir)) {
    for (const f of readdirSync(siDir).filter(f => f.endsWith('.json'))) {
      const ticker = f.replace('.json', '');
      try { siByTicker[ticker] = JSON.parse(readFileSync(join(siDir, f), 'utf-8')); } catch {}
    }
  }

  // Load universe for sector info
  const universeData = JSON.parse(readFileSync(join(CAL, 'midcap-universe.json'), 'utf-8'));
  const sectorByTicker = {};
  for (const co of universeData.companies) {
    sectorByTicker[co.ticker] = co.sector || 'Unknown';
  }

  // Build sector groups for Zipf
  const sectorSI = {};
  for (const [ticker, si] of Object.entries(siByTicker)) {
    const sector = sectorByTicker[ticker] || 'Unknown';
    if (!sectorSI[sector]) sectorSI[sector] = {};
    sectorSI[sector][ticker] = si;
  }

  console.log('Sectors with SI data:');
  for (const [s, tickers] of Object.entries(sectorSI).sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length)) {
    console.log(`  ${s.padEnd(28)} ${Object.keys(tickers).length} companies`);
  }

  let fisherOk = 0, benfordOk = 0, epsOk = 0, zipfOk = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];

    // Fisher
    if (r.signals.fisher == null) {
      const revenue = extractRevenue(r.ticker, r.entry_date);
      if (revenue.length >= 8) {
        const fisher = fisherInformation(revenue);
        if (fisher) { r.signals.fisher = fisher.fisherMedian; fisherOk++; }
      }
    } else { fisherOk++; }

    // Benford
    if (r.signals.base10_excess == null) {
      const values = extractAllValues(r.ticker, r.entry_date);
      if (values.length >= 50) {
        const benford = multiBaseBenford(values);
        r.signals.structural_stress = benford.classification === 'STRUCTURAL_STRESS' ? 1 : 0;
        r.signals.base10_excess = benford.base10_excess;
        benfordOk++;
      }
    } else { benfordOk++; }

    // EPS
    if (r.signals.round_number_excess == null) {
      const eps = extractEPS(r.ticker, r.entry_date);
      if (eps.length >= 8) {
        const rn = roundNumberExcess(eps);
        if (rn) { r.signals.round_number_excess = rn.excess; epsOk++; }
      }
    } else { epsOk++; }

    // Zipf velocity (needs sector data)
    if (r.signals.si_zipf_velocity == null) {
      const si = siByTicker[r.ticker];
      const sector = sectorByTicker[r.ticker] || 'Unknown';
      const sectorData = sectorSI[sector];

      if (si && si.length >= 8 && sectorData && Object.keys(sectorData).length >= 5) {
        const preEntry = si.filter(s => s.date <= r.entry_date);
        if (preEntry.length >= 8) {
          // Generate evaluation dates
          const dates = preEntry.map(s => s.date).filter((_, idx) => idx % 4 === 0);
          if (dates.length >= 4) {
            const zipf = siZipfVelocity(r.ticker, sectorData, dates);
            if (zipf) {
              r.signals.si_zipf_velocity = zipf.velocity;
              r.signals.si_zipf_effort = zipf.effortAdjusted;
              zipfOk++;
            }
          }
        }
      }
    } else { zipfOk++; }

    if ((i + 1) % 300 === 0) process.stdout.write(`\r  [${i + 1}/${results.length}] fisher=${fisherOk} benford=${benfordOk} eps=${epsOk} zipf=${zipfOk}    `);
  }

  console.log(`\n\n  Updated coverage:`);
  console.log(`    Fisher: ${fisherOk}/${results.length}`);
  console.log(`    Benford: ${benfordOk}/${results.length}`);
  console.log(`    EPS: ${epsOk}/${results.length}`);
  console.log(`    Zipf: ${zipfOk}/${results.length}`);

  // Test new signals
  console.log('\n── UPDATED SIGNAL DISCRIMINATION ──\n');
  const wtCases = results.filter(r => r.classification === 'winner' || r.classification === 'trap');

  const newSignals = ['fisher', 'base10_excess', 'round_number_excess', 'si_zipf_velocity', 'structural_stress'];
  console.log('  Signal                     | r      | n    | CV mean | CV pass');
  console.log('  ' + '─'.repeat(70));

  for (const key of newSignals) {
    const valid = wtCases.filter(r => r.signals[key] != null && isFinite(r.signals[key]));
    if (valid.length < 30) { console.log(`  ${key.padEnd(28)} | —      | ${valid.length.toString().padStart(4)} | —       | (insufficient)`); continue; }
    const scores = valid.map(r => r.signals[key]);
    const outs = valid.map(r => r.classification === 'winner' ? 1 : -1);
    const corr = spearman(scores, outs);
    const cv = crossValidate(scores, outs);
    console.log(`  ${key.padEnd(28)} | ${corr.r.toFixed(3).padStart(6)} | ${String(corr.n).padStart(4)} | ${cv.cvMean.toFixed(3).padStart(7)} | ${cv.pass}/5`);
  }

  // Also reprint the key signals for full picture
  console.log('\n  Full signal table (all signals):');
  console.log('  Signal                     | r      | n    | CV mean | CV pass');
  console.log('  ' + '─'.repeat(70));
  const allKeys = ['spread_variance_slope', 'spread_theta', 'composite', 'si_zipf_velocity', 'si_csd', 'si_d1', 'si_d2', 'si_theta', 'si_beta', 'si_change', 'fisher', 'base10_excess', 'round_number_excess'];
  for (const key of allKeys) {
    const valid = wtCases.filter(r => r.signals[key] != null && isFinite(r.signals[key]));
    if (valid.length < 30) continue;
    const scores = valid.map(r => r.signals[key]);
    const outs = valid.map(r => r.classification === 'winner' ? 1 : -1);
    const corr = spearman(scores, outs);
    const cv = crossValidate(scores, outs);
    console.log(`  ${key.padEnd(28)} | ${corr.r.toFixed(3).padStart(6)} | ${String(corr.n).padStart(4)} | ${cv.cvMean.toFixed(3).padStart(7)} | ${cv.pass}/5`);
  }

  // Save updated
  writeFileSync(join(CAL, 'midcap-signals-merged.json'), JSON.stringify({ generated: new Date().toISOString(), total: results.length, results }, null, 2));
  console.log('\n  Updated midcap-signals-merged.json');
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
