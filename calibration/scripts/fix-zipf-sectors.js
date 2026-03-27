#!/usr/bin/env node

// Task A: Fix SI Zipf sector mapping using IWB holdings GICS sectors.
// Then recompute Zipf velocity and rerun combined holdout.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { getCreditSpreadForCase } from '../warehouse/connectors/fred-credit-spread.js';
import { creditSpreadCSD, siZipfVelocity, computeAllSignals, extractTestableScores } from '../warehouse/connectors/market-dynamics.js';

const CAL = resolve(import.meta.dirname, '..');

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function assignRanks(arr) {
  const n = arr.length;
  const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  let i = 0;
  while (i < n) { let j = i; while (j < n - 1 && idx[j + 1].v === idx[j].v) j++; const avg = (i + 1 + j + 1) / 2; for (let k = i; k <= j; k++) ranks[idx[k].i] = avg; i = j + 1; }
  return ranks;
}
function spearman(x, y) {
  const n = x.length; if (n < 10) return { r: 0, n };
  const rx = assignRanks(x), ry = assignRanks(y);
  let sumD2 = 0; for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
  return { r: +(1 - (6 * sumD2) / (n * (n * n - 1))).toFixed(4), n };
}
function crossValidate(scores, outcomes) {
  const n = scores.length; let seed = 42;
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [indices[i], indices[j]] = [indices[j], indices[i]]; }
  const foldSize = Math.ceil(n / 5); const perFold = [];
  for (let f = 0; f < 5; f++) {
    const testIdx = new Set(indices.slice(f * foldSize, (f + 1) * foldSize));
    const ts = [], to = [];
    for (let i = 0; i < n; i++) { if (testIdx.has(i)) { ts.push(scores[i]); to.push(outcomes[i]); } }
    if (ts.length >= 10) perFold.push(spearman(ts, to).r);
  }
  return { cvMean: +(mean(perFold)).toFixed(4), pass: perFold.filter(r => r > 0).length };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TASK A: FIX SI ZIPF SECTOR MAPPING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Parse IWB holdings for sector mapping
  const csv = readFileSync(join(CAL, 'iwb-holdings.csv'), 'utf-8');
  const lines = csv.split('\n');
  const sectorMap = {};
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Ticker,') || lines[i].startsWith('"Ticker"')) { headerIdx = i; break; }
  }

  if (headerIdx < 0) { console.error('Cannot find header in IWB CSV'); return; }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Parse CSV with quoted fields
    const parts = [];
    let current = '', inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { parts.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    parts.push(current.trim());

    const ticker = parts[0];
    const sector = parts[2];
    if (ticker && sector && sector !== 'Cash and/or Derivatives') {
      sectorMap[ticker] = sector;
    }
  }

  console.log(`  IWB sector map: ${Object.keys(sectorMap).length} tickers`);

  // Step 2: Patch mid-cap universe
  const universeData = JSON.parse(readFileSync(join(CAL, 'midcap-universe.json'), 'utf-8'));
  let iwbMatch = 0, stillUnknown = 0;
  const unknownTickers = [];

  for (const co of universeData.companies) {
    if (sectorMap[co.ticker]) {
      co.sector = sectorMap[co.ticker];
      iwbMatch++;
    } else if (co.sector === 'Unknown') {
      stillUnknown++;
      unknownTickers.push(co.ticker);
    }
  }

  console.log(`  IWB match: ${iwbMatch}, Still Unknown: ${stillUnknown}`);
  if (unknownTickers.length > 0 && unknownTickers.length <= 20) {
    console.log(`  Unknown tickers: ${unknownTickers.join(', ')}`);
  }

  // Sector distribution
  const sectorDist = {};
  universeData.companies.forEach(c => { sectorDist[c.sector] = (sectorDist[c.sector] || 0) + 1; });
  console.log('\n  Sector distribution:');
  for (const [s, n] of Object.entries(sectorDist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(28)} ${n}`);
  }

  writeFileSync(join(CAL, 'midcap-universe-sectors-fixed.json'), JSON.stringify(universeData, null, 2));

  // Step 3: Recompute SI Zipf with fixed sectors
  console.log('\n── Recomputing SI Zipf Velocity ──\n');

  const siDir = join(CAL, 'midcap-si');
  const siByTicker = {};
  if (existsSync(siDir)) {
    for (const f of readdirSync(siDir).filter(f => f.endsWith('.json'))) {
      const ticker = f.replace('.json', '');
      try { siByTicker[ticker] = JSON.parse(readFileSync(join(siDir, f), 'utf-8')); } catch {}
    }
  }

  // Build sector SI groups
  const sectorSI = {};
  for (const co of universeData.companies) {
    const sector = co.sector;
    if (!sector || sector === 'Unknown') continue;
    if (!siByTicker[co.ticker]) continue;
    if (!sectorSI[sector]) sectorSI[sector] = {};
    sectorSI[sector][co.ticker] = siByTicker[co.ticker];
  }

  // Also add S&P 500 SI data to sectors for small sectors
  const sp500SI = join(CAL, 'warehouse/macro/market-dynamics-cache/si');
  if (existsSync(sp500SI)) {
    const universe500 = JSON.parse(readFileSync(join(CAL, 'cases/universe.json'), 'utf-8'));
    const sp500SectorMap = {};
    for (const c of Object.values(universe500.cases)) {
      if (c.gics_sector) sp500SectorMap[c.ticker] = c.gics_sector;
    }
    for (const f of readdirSync(sp500SI).filter(f => f.endsWith('.json'))) {
      const ticker = f.replace('.json', '');
      const sector = sp500SectorMap[ticker];
      if (!sector) continue;
      if (sectorSI[sector] && Object.keys(sectorSI[sector]).length < 10) {
        try {
          const data = JSON.parse(readFileSync(join(sp500SI, f), 'utf-8'));
          if (data.series?.length >= 6) sectorSI[sector][ticker] = data.series;
        } catch {}
      }
    }
  }

  console.log('  Sector SI groups:');
  for (const [s, tickers] of Object.entries(sectorSI).sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length)) {
    console.log(`    ${s.padEnd(28)} ${Object.keys(tickers).length} companies`);
  }

  // Load and update mid-cap signals
  const signals = JSON.parse(readFileSync(join(CAL, 'midcap-signals-merged.json'), 'utf-8'));
  let zipfComputed = 0;

  for (const r of signals.results) {
    const co = universeData.companies.find(c => c.ticker === r.ticker);
    const sector = co?.sector;
    if (!sector || sector === 'Unknown') continue;

    const sectorData = sectorSI[sector];
    if (!sectorData || Object.keys(sectorData).length < 5) continue;

    const si = siByTicker[r.ticker];
    if (!si || si.length < 8) continue;

    const preEntry = si.filter(s => s.date <= r.entry_date);
    if (preEntry.length < 8) continue;

    const dates = preEntry.map(s => s.date).filter((_, idx) => idx % 4 === 0);
    if (dates.length < 4) continue;

    const zipf = siZipfVelocity(r.ticker, sectorData, dates);
    if (zipf) {
      r.signals.si_zipf_velocity_fixed = zipf.velocity;
      r.signals.si_zipf_effort_fixed = zipf.effortAdjusted;
      zipfComputed++;
    }
  }

  console.log(`\n  Zipf recomputed: ${zipfComputed} cases`);

  // Step 4: Report updated signal strengths
  console.log('\n── SIGNAL COMPARISON ──\n');

  const wtCases = signals.results.filter(r => r.classification === 'winner' || r.classification === 'trap');

  const compareSignals = [
    { key: 'si_zipf_velocity', label: 'SI Zipf (before)', sp500: 0.219 },
    { key: 'si_zipf_velocity_fixed', label: 'SI Zipf (fixed)', sp500: 0.219 },
    { key: 'si_csd', label: 'SI CSD', sp500: 0.163 },
    { key: 'si_d1', label: 'SI D1', sp500: 0.161 },
    { key: 'si_d2', label: 'SI D2', sp500: 0.111 },
    { key: 'si_theta', label: 'SI theta', sp500: 0.138 },
  ];

  console.log('  Signal                 | Mid-Cap r | n    | CV mean | CV pass | S&P 500');
  console.log('  ' + '─'.repeat(80));

  for (const sig of compareSignals) {
    const valid = wtCases.filter(r => r.signals[sig.key] != null && isFinite(r.signals[sig.key]));
    if (valid.length < 30) { console.log(`  ${sig.label.padEnd(24)} | —         | ${valid.length.toString().padStart(4)} | —       | —       | ${sig.sp500}`); continue; }
    const scores = valid.map(r => r.signals[sig.key]);
    const outs = valid.map(r => r.classification === 'winner' ? 1 : -1);
    const corr = spearman(scores, outs);
    const cv = crossValidate(scores, outs);
    console.log(`  ${sig.label.padEnd(24)} | ${corr.r.toFixed(3).padStart(9)} | ${String(corr.n).padStart(4)} | ${cv.cvMean.toFixed(3).padStart(7)} | ${cv.pass}/5     | ${sig.sp500}`);
  }

  // Step 5: Rerun combined holdout with fixed Zipf
  console.log('\n── COMBINED HOLDOUT (Fixed Zipf) ──\n');

  const universe500 = JSON.parse(readFileSync(join(CAL, 'cases/universe.json'), 'utf-8'));
  const sp500Holdout = Object.values(universe500.cases)
    .filter(c => c.partition === 'holdout' && (c.outcome?.classification === 'winner' || c.outcome?.classification === 'trap'));

  const mdResults = JSON.parse(readFileSync(join(CAL, 'tests/results/market-dynamics-expanded-2026-03-26.json'), 'utf-8'));
  const mdByTicker = {};
  for (const c of (mdResults?.case_details || [])) mdByTicker[c.ticker] = c;

  // Build rows
  const rows = [];

  // S&P 500 holdout
  for (const c of sp500Holdout) {
    const spread = getCreditSpreadForCase(c.entry_date, 3);
    let spreadVar = null;
    if (spread.length >= 25) { const csd = creditSpreadCSD(spread, 10); spreadVar = csd?.varianceSlope ?? null; }
    const md = mdByTicker[c.ticker];
    rows.push({
      universe: 'SP500', outcome: c.outcome.classification === 'winner' ? 1 : 0,
      alpha: c.outcome.alpha_3yr || 0, forward_return: c.outcome.forward_return_3yr || 0,
      spread_variance_slope: spreadVar,
      si_zipf: md?.scores?.si_csd ?? null, // Use CSD as SI signal (more reliable)
    });
  }

  // Mid-cap
  for (const r of wtCases) {
    rows.push({
      universe: 'MIDCAP', outcome: r.classification === 'winner' ? 1 : 0,
      alpha: r.alpha_3yr || 0, forward_return: r.forward_return_3yr || 0,
      spread_variance_slope: r.signals.spread_variance_slope ?? null,
      si_zipf: r.signals.si_csd ?? null, // Use CSD here too for consistency
    });
  }

  // Rank-based composite
  function runComposite(subset, label) {
    const signalKeys = ['spread_variance_slope', 'si_zipf'];
    const ranks = {};
    for (const k of signalKeys) {
      const vals = subset.map(r => r[k]);
      const validIdx = vals.map((v, i) => v != null ? i : -1).filter(i => i >= 0);
      const validVals = validIdx.map(i => vals[i]);
      const r = assignRanks(validVals);
      ranks[k] = new Array(vals.length).fill(null);
      validIdx.forEach((idx, j) => { ranks[k][idx] = r[j] / validVals.length; });
    }
    const compositeScores = subset.map((_, i) => {
      const vals = signalKeys.map(k => ranks[k][i]).filter(v => v != null);
      return vals.length === signalKeys.length ? mean(vals) : null;
    });
    const valid = compositeScores.map((s, i) => s != null ? i : -1).filter(i => i >= 0);
    const vs = valid.map(i => compositeScores[i]);
    const vo = valid.map(i => subset[i].outcome);
    if (vs.length < 30) return null;
    const corr = spearman(vs, vo);
    const topHalf = valid.filter(i => compositeScores[i] >= 0.5);
    const topAlpha = mean(topHalf.map(i => subset[i].alpha));
    return { label, n: vs.length, r: corr.r, topAlpha };
  }

  const sp500Only = rows.filter(r => r.universe === 'SP500');
  const mcOnly = rows.filter(r => r.universe === 'MIDCAP');

  const rSP = runComposite(sp500Only, 'S&P 500');
  const rMC = runComposite(mcOnly, 'Mid-Cap');
  const rCombined = runComposite(rows, 'Combined');

  console.log('  Universe         | n    | r     | Top-half α/yr');
  console.log('  ' + '─'.repeat(55));
  for (const r of [rSP, rMC, rCombined].filter(Boolean)) {
    const annAlpha = ((1 + r.topAlpha) ** (1/3) - 1) * 100;
    console.log(`  ${r.label.padEnd(18)} | ${String(r.n).padStart(4)} | ${r.r.toFixed(3).padStart(6)} | ${annAlpha.toFixed(1)}%`);
  }

  // Save updated signals
  writeFileSync(join(CAL, 'midcap-signals-merged.json'), JSON.stringify(signals, null, 2));

  // Save report
  let md = `# SI Zipf Sector Fix Report\n\n**Date:** ${new Date().toISOString().split('T')[0]}\n\n`;
  md += `## Sector Mapping\n- IWB match: ${iwbMatch}\n- Still Unknown: ${stillUnknown}\n\n`;
  md += `## Zipf Recomputed: ${zipfComputed} cases\n\n`;
  md += `## Signal Comparison\n(see console output)\n`;
  writeFileSync(join(CAL, 'test-zipf-sector-fix.md'), md);

  console.log('\n  Saved test-zipf-sector-fix.md');
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
