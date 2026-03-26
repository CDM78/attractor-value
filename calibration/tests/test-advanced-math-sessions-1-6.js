#!/usr/bin/env node

// Advanced Mathematical Signal Testing — Sessions 1, 2, 3, 5, 6
// Tests RMT cleaning, multiplicative interactions, Fisher information,
// multi-base Benford, and spectral decomposition.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { spearmanCorrelation, analyze, crossValidate, registerTest } from './testing-framework.js';
import { rmtAnalysis } from '../services/rmt-analysis.js';
import { fisherInformation } from '../services/fisher-information.js';
import { multiBaseBenford, roundNumberExcess } from '../services/multi-base-benford.js';
import { spectralEnergy } from '../services/spectral-analysis.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const CACHE_DIR = resolve(import.meta.dirname, '../warehouse/macro/market-dynamics-cache');
const EDGAR_DIR = resolve(import.meta.dirname, '../../data/edgar-cache');

function readJSON(p) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; }
function writeJSON(p, d) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(d, null, 2)); }

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

// ============================================================
// DATA LOADING
// ============================================================

function loadMarketDynamicsCases() {
  const report = readJSON(join(RESULTS_DIR, 'market-dynamics-expanded-2026-03-26.json'));
  if (!report) throw new Error('Expanded test results not found — run test-market-dynamics-expanded.js first');
  return report.case_details;
}

function loadUniverseCases() {
  const u = readJSON(resolve(import.meta.dirname, '../cases/universe.json'));
  if (!u?.cases) throw new Error('Universe not found');
  return Object.values(u.cases);
}

/**
 * Extract quarterly revenue from EDGAR XBRL cache by CIK.
 */
function getQuarterlyRevenue(cik, beforeDate) {
  if (!cik) return [];
  const numericCik = String(parseInt(cik, 10)).padStart(10, '0');
  const path = join(EDGAR_DIR, `${numericCik}.json`);
  const data = readJSON(path);
  if (!data?.facts?.['us-gaap']) return [];

  const gaap = data.facts['us-gaap'];
  const revConcepts = [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
  ];

  for (const concept of revConcepts) {
    if (!gaap[concept]?.units?.USD) continue;
    const entries = gaap[concept].units.USD
      .filter(e => e.form === '10-Q' || e.form === '10-K')
      .filter(e => e.end && e.end <= beforeDate)
      .filter(e => !e.frame || /Q\d/.test(e.frame)) // quarterly, not annual
      .sort((a, b) => a.end.localeCompare(b.end));

    // Deduplicate by end date
    const seen = new Set();
    const deduped = entries.filter(e => {
      if (seen.has(e.end)) return false;
      seen.add(e.end);
      return true;
    });

    if (deduped.length >= 8) return deduped.map(e => ({ date: e.end, value: e.val }));
  }

  return [];
}

/**
 * Get all financial values for multi-base Benford (revenue, assets, expenses, etc).
 */
function getAllFinancialValues(cik, beforeDate) {
  if (!cik) return [];
  const numericCik = String(parseInt(cik, 10)).padStart(10, '0');
  const path = join(EDGAR_DIR, `${numericCik}.json`);
  const data = readJSON(path);
  if (!data?.facts?.['us-gaap']) return [];

  const gaap = data.facts['us-gaap'];
  const values = [];

  // Collect all USD values from any concept
  for (const concept of Object.keys(gaap)) {
    const entries = gaap[concept]?.units?.USD;
    if (!entries) continue;
    for (const e of entries) {
      if (e.end && e.end <= beforeDate && e.val > 0 && (e.form === '10-Q' || e.form === '10-K')) {
        values.push(e.val);
      }
    }
  }

  return values;
}

/**
 * Get EPS values for round-number analysis.
 */
function getEPSValues(cik, beforeDate) {
  if (!cik) return [];
  const numericCik = String(parseInt(cik, 10)).padStart(10, '0');
  const path = join(EDGAR_DIR, `${numericCik}.json`);
  const data = readJSON(path);
  if (!data?.facts?.['us-gaap']) return [];

  const gaap = data.facts['us-gaap'];
  const epsConcepts = ['EarningsPerShareDiluted', 'EarningsPerShareBasic'];

  for (const concept of epsConcepts) {
    const entries = gaap[concept]?.units?.['USD/shares'];
    if (!entries) continue;
    const filtered = entries
      .filter(e => e.end && e.end <= beforeDate && e.form === '10-Q')
      .sort((a, b) => a.end.localeCompare(b.end));
    const seen = new Set();
    const deduped = filtered.filter(e => { if (seen.has(e.end)) return false; seen.add(e.end); return true; });
    if (deduped.length >= 8) return deduped.map(e => e.val);
  }
  return [];
}

// ============================================================
// SESSION 1: RMT EIGENVALUE CLEANING
// ============================================================

function runSession1(cases) {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SESSION 1: RMT EIGENVALUE CLEANING (Marchenko-Pastur)     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // The 11 signals from the expanded test (excluding composite — it's derived)
  const signalKeys = [
    'spread_variance_slope', 'spread_theta', 'si_zipf_velocity',
    'spread_half_life', 'si_csd', 'si_d1', 'si_theta',
    'volume_benford_kld', 'volume_benford_chi', 'si_d2', 'si_beta',
  ];

  // Build signal matrix
  const validCases = [];
  const dataMatrix = [];
  const outcomes = [];
  const returns = [];

  for (const c of cases) {
    const row = [];
    let valid = true;
    for (const key of signalKeys) {
      const val = c.scores[key];
      if (val == null || !isFinite(val)) { valid = false; break; }
      row.push(val);
    }
    if (!valid) continue;

    dataMatrix.push(row);
    outcomes.push(c.outcome);
    returns.push(c.alpha_3yr || 0);
    validCases.push(c);
  }

  console.log(`  Signal matrix: ${dataMatrix.length} cases × ${signalKeys.length} signals`);

  const rmt = rmtAnalysis(dataMatrix, signalKeys);

  console.log(`  Aspect ratio q = ${rmt.q}`);
  console.log(`  MP upper bound λ₊ = ${rmt.lambda_plus}`);
  console.log(`  MP lower bound λ₋ = ${rmt.lambda_minus}\n`);

  console.log('  Eigenvalue spectrum:');
  for (const f of rmt.factors) {
    const marker = f.significant ? '  ** SIGNIFICANT **' : '';
    console.log(`    λ${String(f.index).padStart(2)} = ${f.eigenvalue.toFixed(3).padStart(6)}  variance: ${(f.variance_explained * 100).toFixed(1).padStart(5)}%  cumulative: ${(f.cumulative_variance * 100).toFixed(1).padStart(5)}%${marker}`);
  }

  console.log(`\n  Significant factors: ${rmt.n_significant}`);
  const sigVarExpl = rmt.significantFactors.reduce((s, f) => s + f.variance_explained, 0);
  console.log(`  Variance explained by significant factors: ${(sigVarExpl * 100).toFixed(1)}%\n`);

  // Interpret eigenvectors
  for (const f of rmt.significantFactors) {
    console.log(`  Factor ${f.index} (λ=${f.eigenvalue}, ${(f.variance_explained * 100).toFixed(1)}% variance):`);
    const sorted = Object.entries(f.loadings).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    for (const [name, loading] of sorted) {
      const bar = '█'.repeat(Math.round(Math.abs(loading) * 20));
      console.log(`    ${name.padEnd(25)} ${loading >= 0 ? '+' : ''}${loading.toFixed(3)}  ${bar}`);
    }
    console.log('');
  }

  // Test RMT composite
  const rmtScores = rmt.rmtComposite;
  const numOutcomes = outcomes.map(o => o === 'winner' ? 1 : -1);
  const rmtAnalysisResult = analyze(rmtScores, outcomes, returns);

  console.log('  RMT COMPOSITE RESULTS:');
  console.log(`    r = ${rmtAnalysisResult.spearman_r?.toFixed(3)} (compare to equal-weight composite r = 0.142)`);
  console.log(`    p = ${rmtAnalysisResult.spearman_p?.toFixed(6)}`);
  console.log(`    CV mean = ${rmtAnalysisResult.cross_validation?.mean_r?.toFixed(3)}`);
  console.log(`    CV gap = ${(Math.abs((rmtAnalysisResult.spearman_r || 0) - (rmtAnalysisResult.cross_validation?.mean_r || 0))).toFixed(3)}\n`);

  // Test each factor individually
  console.log('  Factor-by-factor discrimination:');
  for (const f of rmt.significantFactors) {
    const fScores = rmt.factorScores.map(s => s[`factor_${f.index}`] || 0);
    const fResult = analyze(fScores, outcomes, returns);
    console.log(`    Factor ${f.index}: r = ${fResult.spearman_r?.toFixed(3)}, p = ${fResult.spearman_p?.toFixed(6)}, CV = ${fResult.cross_validation?.mean_r?.toFixed(3)}`);
  }

  // Step 1E: Optimal weighting grid search
  console.log('\n  Optimal factor weighting (5-fold CV):');
  if (rmt.n_significant >= 2) {
    const weightCombos = [];
    const nf = rmt.n_significant;
    // Generate weight combinations
    for (let w1 = 0; w1 <= 10; w1 += 2) {
      for (let w2 = 0; w2 <= 10; w2 += 2) {
        if (nf >= 3) {
          for (let w3 = 0; w3 <= 10; w3 += 2) {
            if (w1 + w2 + w3 === 0) continue;
            weightCombos.push([w1/10, w2/10, w3/10].slice(0, nf));
          }
        } else {
          if (w1 + w2 === 0) continue;
          weightCombos.push([w1/10, w2/10].slice(0, nf));
        }
      }
    }

    const cvResults = [];
    for (const weights of weightCombos) {
      const scores = rmt.factorScores.map(s => {
        let composite = 0;
        for (let i = 0; i < weights.length; i++) {
          composite += weights[i] * (s[`factor_${rmt.significantFactors[i].index}`] || 0);
        }
        return composite;
      });
      const cv = crossValidate(scores, outcomes);
      cvResults.push({ weights, cvMean: cv.mean_r, cvStd: cv.sd_r });
    }

    cvResults.sort((a, b) => b.cvMean - a.cvMean);
    for (const r of cvResults.slice(0, 5)) {
      console.log(`    Weights [${r.weights.map(w => w.toFixed(1)).join(', ')}]: CV mean = ${r.cvMean?.toFixed(3)}, CV std = ${r.cvStd?.toFixed(3)}`);
    }
  }

  // Save factor structure for Session 8
  const factorStructure = {
    n_significant_factors: rmt.n_significant,
    factors: rmt.significantFactors.map(f => ({
      eigenvalue: f.eigenvalue,
      variance_explained: f.variance_explained,
      loadings: f.loadings,
    })),
  };
  writeJSON(join(CACHE_DIR, 'rmt/factor-structure.json'), factorStructure);

  return { rmt, rmtAnalysis: rmtAnalysisResult, validCases, outcomes, returns };
}

// ============================================================
// SESSION 2: MULTIPLICATIVE INTERACTION TESTING
// ============================================================

function runSession2(cases) {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SESSION 2: MULTIPLICATIVE INTERACTION TESTING             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const companySignals = ['si_zipf_velocity', 'si_csd', 'si_d1', 'si_theta', 'si_d2', 'si_beta', 'volume_benford_kld'];

  // Normalize all signals to [0, 1]
  const ranges = {};
  for (const key of companySignals) {
    const vals = cases.map(c => c.scores[key]).filter(v => v != null && isFinite(v));
    ranges[key] = { min: Math.min(...vals), max: Math.max(...vals) };
  }

  function normalize(val, key) {
    const r = ranges[key];
    if (!r || r.max === r.min) return 0.5;
    return (val - r.min) / (r.max - r.min);
  }

  // Filter to valid cases
  const valid = cases.filter(c => {
    return companySignals.every(k => c.scores[k] != null && isFinite(c.scores[k]));
  });
  const outcomes = valid.map(c => c.outcome);
  const returns = valid.map(c => c.alpha_3yr || 0);

  console.log(`  Valid cases: ${valid.length}\n`);

  // Step 2A: Pairwise interactions
  console.log('  Pairwise multiplicative interactions:');
  console.log('  ' + 'Interaction'.padEnd(35) + '|   r    |  p-value | vs best indiv');
  console.log('  ' + '─'.repeat(75));

  const interactionResults = [];
  for (let i = 0; i < companySignals.length; i++) {
    for (let j = i + 1; j < companySignals.length; j++) {
      const a = companySignals[i], b = companySignals[j];
      const scores = valid.map(c => normalize(c.scores[a], a) * normalize(c.scores[b], b));
      const result = analyze(scores, outcomes, returns);
      interactionResults.push({ pair: `${a} × ${b}`, ...result });

      const r = (result.spearman_r || 0).toFixed(3).padStart(7);
      const p = (result.spearman_p || 1).toFixed(4).padStart(9);
      const star = result.spearman_p < 0.01 ? '**' : result.spearman_p < 0.05 ? '* ' : '  ';
      console.log(`  ${(`${a.replace('si_','').replace('volume_','')} × ${b.replace('si_','').replace('volume_','')}`).padEnd(35)}| ${r}${star} | ${p} |`);
    }
  }

  const bestInteraction = interactionResults.sort((a, b) => Math.abs(b.spearman_r || 0) - Math.abs(a.spearman_r || 0))[0];
  console.log(`\n  Best interaction: ${bestInteraction.pair}`);
  console.log(`    r = ${bestInteraction.spearman_r?.toFixed(3)}, CV = ${bestInteraction.cross_validation?.mean_r?.toFixed(3)}`);
  console.log(`    Beats SI Zipf (r=0.219)? ${Math.abs(bestInteraction.spearman_r || 0) > 0.219 ? 'YES' : 'NO'}\n`);

  // Step 2B: Geometric mean composite
  const arithScores = valid.map(c => mean(companySignals.map(k => normalize(c.scores[k], k))));
  const geomScores = valid.map(c => {
    const vals = companySignals.map(k => normalize(c.scores[k], k) + 0.01);
    return Math.pow(vals.reduce((p, v) => p * v, 1), 1 / vals.length);
  });

  const arithResult = analyze(arithScores, outcomes, returns);
  const geomResult = analyze(geomScores, outcomes, returns);

  console.log('  Composite comparison:');
  console.log(`    Arithmetic mean: r = ${arithResult.spearman_r?.toFixed(3)}, CV = ${arithResult.cross_validation?.mean_r?.toFixed(3)}`);
  console.log(`    Geometric mean:  r = ${geomResult.spearman_r?.toFixed(3)}, CV = ${geomResult.cross_validation?.mean_r?.toFixed(3)}\n`);

  // Step 2C: Power-law sweep
  console.log('  Power-law sweep:');
  const alphas = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
  for (const alpha of alphas) {
    const scores = valid.map(c => mean(companySignals.map(k => Math.pow(normalize(c.scores[k], k) + 0.01, alpha))));
    const result = analyze(scores, outcomes, returns);
    const marker = alpha === 1.0 ? ' (baseline)' : '';
    console.log(`    α=${alpha.toFixed(1)}: r = ${result.spearman_r?.toFixed(3)}, CV = ${result.cross_validation?.mean_r?.toFixed(3)}${marker}`);
  }

  return { bestInteraction, arithResult, geomResult };
}

// ============================================================
// SESSION 3: FISHER INFORMATION
// ============================================================

function runSession3(universeCases) {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SESSION 3: FISHER INFORMATION AS META-SIGNAL              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const c of universeCases) {
    const outcome = c.outcome?.classification;
    if (!outcome || outcome === 'mixed' || outcome === 'underperform') continue;

    const revenue = getQuarterlyRevenue(c.cik, c.entry_date);
    if (revenue.length < 8) continue;

    const fisher = fisherInformation(revenue.map(r => r.value));
    if (!fisher) continue;

    results.push({
      ticker: c.ticker,
      entry_date: c.entry_date,
      outcome,
      alpha_3yr: c.outcome.alpha_3yr || 0,
      cik: c.cik,
      fisherMedian: fisher.fisherMedian,
      fisherMean: fisher.fisherMean,
      nWindows: fisher.nWindows,
    });
  }

  console.log(`  Cases with sufficient revenue data: ${results.length}`);
  const winners = results.filter(r => r.outcome === 'winner');
  const traps = results.filter(r => r.outcome === 'trap');
  console.log(`  Winners: ${winners.length}, Traps: ${traps.length}\n`);

  if (results.length < 30) {
    console.log('  ⚠ Insufficient data for Fisher analysis\n');
    return null;
  }

  // Fisher as discriminator
  console.log('  Fisher information distribution:');
  console.log(`    Winners median: ${mean(winners.map(r => r.fisherMedian)).toFixed(6)}`);
  console.log(`    Traps median:   ${mean(traps.map(r => r.fisherMedian)).toFixed(6)}`);

  const fisherScores = results.map(r => r.fisherMedian);
  const fisherOutcomes = results.map(r => r.outcome);
  const fisherReturns = results.map(r => r.alpha_3yr);
  const fisherAnalysis = analyze(fisherScores, fisherOutcomes, fisherReturns);

  console.log(`    r = ${fisherAnalysis.spearman_r?.toFixed(3)}, p = ${fisherAnalysis.spearman_p?.toFixed(6)}`);
  console.log(`    CV mean = ${fisherAnalysis.cross_validation?.mean_r?.toFixed(3)}\n`);

  // Step 3B: Fisher as accuracy predictor (quartile analysis)
  const sortedFisher = [...results].sort((a, b) => a.fisherMedian - b.fisherMedian);
  const qSize = Math.floor(sortedFisher.length / 4);

  console.log('  Fisher quartile analysis:');
  console.log('    Quartile | n    | Win rate');
  for (let q = 0; q < 4; q++) {
    const group = sortedFisher.slice(q * qSize, q === 3 ? sortedFisher.length : (q + 1) * qSize);
    const winRate = group.filter(r => r.outcome === 'winner').length / group.length;
    console.log(`    Q${q + 1}       | ${String(group.length).padStart(4)} | ${(winRate * 100).toFixed(1)}%`);
  }

  // Save Fisher scores
  writeJSON(join(CACHE_DIR, 'fisher/fisher-scores.json'), {
    cases: results.map(r => ({
      ticker: r.ticker, entry_date: r.entry_date,
      fisherMedian: r.fisherMedian, fisherMean: r.fisherMean,
    })),
  });

  return { fisherAnalysis, n: results.length };
}

// ============================================================
// SESSION 5: MULTI-BASE BENFORD
// ============================================================

function runSession5(universeCases) {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SESSION 5: MULTI-BASE BENFORD ANALYSIS                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const c of universeCases) {
    const outcome = c.outcome?.classification;
    if (!outcome || outcome === 'mixed' || outcome === 'underperform') continue;

    const values = getAllFinancialValues(c.cik, c.entry_date);
    if (values.length < 50) continue;

    const benford = multiBaseBenford(values);
    const eps = getEPSValues(c.cik, c.entry_date);
    const roundNum = eps.length >= 8 ? roundNumberExcess(eps) : null;

    results.push({
      ticker: c.ticker,
      entry_date: c.entry_date,
      outcome,
      alpha_3yr: c.outcome.alpha_3yr || 0,
      base10_kld: benford.base_10?.kld,
      base6_kld: benford.base_6?.kld,
      base12_kld: benford.base_12?.kld,
      base60_kld: benford.base_60?.kld,
      base10_excess: benford.base10_excess,
      classification: benford.classification,
      roundExcess: roundNum?.excess,
      nValues: values.length,
    });
  }

  console.log(`  Cases with sufficient financial data: ${results.length}`);
  const winners = results.filter(r => r.outcome === 'winner');
  const traps = results.filter(r => r.outcome === 'trap');
  console.log(`  Winners: ${winners.length}, Traps: ${traps.length}\n`);

  if (results.length < 30) {
    console.log('  ⚠ Insufficient data for Benford analysis\n');
    return null;
  }

  // Classification distribution
  const classCount = { NATURAL_PROCESS: { w: 0, t: 0 }, HUMAN_MANIPULATION: { w: 0, t: 0 }, STRUCTURAL_STRESS: { w: 0, t: 0 } };
  for (const r of results) {
    const key = r.classification;
    if (classCount[key]) {
      if (r.outcome === 'winner') classCount[key].w++;
      else classCount[key].t++;
    }
  }

  console.log('  Classification distribution:');
  console.log('    Class                | Winners | Traps | Win rate');
  for (const [cls, counts] of Object.entries(classCount)) {
    const total = counts.w + counts.t;
    if (total === 0) continue;
    console.log(`    ${cls.padEnd(22)} | ${String(counts.w).padStart(7)} | ${String(counts.t).padStart(5)} | ${(counts.w / total * 100).toFixed(1)}%`);
  }

  // Base-10 excess as discriminator
  const excessScores = results.filter(r => r.base10_excess != null);
  if (excessScores.length >= 20) {
    const excessAnalysis = analyze(
      excessScores.map(r => r.base10_excess),
      excessScores.map(r => r.outcome),
      excessScores.map(r => r.alpha_3yr)
    );
    console.log(`\n  Base-10 excess as discriminator:`);
    console.log(`    Winners mean: ${mean(excessScores.filter(r => r.outcome === 'winner').map(r => r.base10_excess)).toFixed(6)}`);
    console.log(`    Traps mean:   ${mean(excessScores.filter(r => r.outcome === 'trap').map(r => r.base10_excess)).toFixed(6)}`);
    console.log(`    r = ${excessAnalysis.spearman_r?.toFixed(3)}, p = ${excessAnalysis.spearman_p?.toFixed(6)}`);
    console.log(`    CV mean = ${excessAnalysis.cross_validation?.mean_r?.toFixed(3)}`);
  }

  // Round-number excess
  const roundResults = results.filter(r => r.roundExcess != null);
  if (roundResults.length >= 20) {
    const roundAnalysis = analyze(
      roundResults.map(r => r.roundExcess),
      roundResults.map(r => r.outcome),
      roundResults.map(r => r.alpha_3yr)
    );
    console.log(`\n  Round-number EPS excess:`);
    console.log(`    Winners mean: ${mean(roundResults.filter(r => r.outcome === 'winner').map(r => r.roundExcess)).toFixed(4)}`);
    console.log(`    Traps mean:   ${mean(roundResults.filter(r => r.outcome === 'trap').map(r => r.roundExcess)).toFixed(4)}`);
    console.log(`    r = ${roundAnalysis.spearman_r?.toFixed(3)}, p = ${roundAnalysis.spearman_p?.toFixed(6)}`);
    console.log(`    n = ${roundResults.length}`);
  }

  // Save
  writeJSON(join(CACHE_DIR, 'multibase/benford-results.json'), { cases: results });

  return { n: results.length, classCount };
}

// ============================================================
// SESSION 6: SPECTRAL DECOMPOSITION
// ============================================================

function runSession6(universeCases) {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SESSION 6: SPECTRAL DECOMPOSITION OF REVENUE              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const c of universeCases) {
    const outcome = c.outcome?.classification;
    if (!outcome || outcome === 'mixed' || outcome === 'underperform') continue;

    const revenue = getQuarterlyRevenue(c.cik, c.entry_date);
    if (revenue.length < 8) continue;

    const spectrum = spectralEnergy(revenue.map(r => r.value));
    if (!spectrum) continue;

    results.push({
      ticker: c.ticker,
      entry_date: c.entry_date,
      outcome,
      alpha_3yr: c.outcome.alpha_3yr || 0,
      ...spectrum,
      revenueQuarters: revenue.length,
    });
  }

  console.log(`  Cases with 8+ revenue quarters: ${results.length}`);
  const winners = results.filter(r => r.outcome === 'winner');
  const traps = results.filter(r => r.outcome === 'trap');
  console.log(`  Winners: ${winners.length}, Traps: ${traps.length}\n`);

  if (results.length < 30) {
    console.log('  ⚠ Insufficient data for spectral analysis\n');
    return null;
  }

  // Energy distribution by outcome
  const bands = ['noise', 'semiannual', 'annual', 'businessCycle', 'secular'];
  console.log('  Energy distribution by outcome:');
  console.log('    Band           | Winners | Traps');
  for (const band of bands) {
    const wMean = mean(winners.map(r => r[band]));
    const tMean = mean(traps.map(r => r[band]));
    console.log(`    ${band.padEnd(16)} | ${wMean.toFixed(3).padStart(7)} | ${tMean.toFixed(3).padStart(7)}`);
  }

  // Secular dominance
  const secDomAnalysis = analyze(
    results.map(r => r.secularDominance),
    results.map(r => r.outcome),
    results.map(r => r.alpha_3yr)
  );
  console.log(`\n  Secular dominance:`);
  console.log(`    Winners: ${mean(winners.map(r => r.secularDominance)).toFixed(3)},  Traps: ${mean(traps.map(r => r.secularDominance)).toFixed(3)}`);
  console.log(`    r = ${secDomAnalysis.spearman_r?.toFixed(3)}, p = ${secDomAnalysis.spearman_p?.toFixed(6)}`);
  console.log(`    CV mean = ${secDomAnalysis.cross_validation?.mean_r?.toFixed(3)}`);

  // Signal-to-noise
  const stnAnalysis = analyze(
    results.map(r => Math.min(r.signalToNoise, 100)), // cap extreme values
    results.map(r => r.outcome),
    results.map(r => r.alpha_3yr)
  );
  console.log(`\n  Signal-to-noise:`);
  console.log(`    Winners: ${mean(winners.map(r => r.signalToNoise)).toFixed(3)},  Traps: ${mean(traps.map(r => r.signalToNoise)).toFixed(3)}`);
  console.log(`    r = ${stnAnalysis.spearman_r?.toFixed(3)}, p = ${stnAnalysis.spearman_p?.toFixed(6)}`);
  console.log(`    CV mean = ${stnAnalysis.cross_validation?.mean_r?.toFixed(3)}`);

  // Spectral dimensionality
  console.log(`\n  Spectral dimensionality:`);
  console.log(`    Winners mean: ${mean(winners.map(r => r.spectralDimensionality)).toFixed(2)}`);
  console.log(`    Traps mean:   ${mean(traps.map(r => r.spectralDimensionality)).toFixed(2)}`);

  // Save
  writeJSON(join(CACHE_DIR, 'spectral/spectral-results.json'), {
    cases: results.map(r => ({
      ticker: r.ticker, entry_date: r.entry_date,
      secularDominance: r.secularDominance, signalToNoise: r.signalToNoise,
      spectralDimensionality: r.spectralDimensionality,
    })),
  });

  return { secDomAnalysis, stnAnalysis, n: results.length };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ADVANCED MATHEMATICAL SIGNAL TESTING — Sessions 1-3, 5-6');
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('═══════════════════════════════════════════════════════════════');

  const startTime = Date.now();
  const mdCases = loadMarketDynamicsCases();
  const univCases = loadUniverseCases();

  console.log(`  Market dynamics cases (457-set): ${mdCases.length}`);
  console.log(`  Universe cases (1592-set): ${univCases.length}`);

  // Sessions 1 & 2 use the 457-case market dynamics data
  const session1 = runSession1(mdCases);
  const session2 = runSession2(mdCases);

  // Sessions 3, 5, 6 use the full 1,592-case universe with EDGAR data
  const session3 = runSession3(univCases);
  const session5 = runSession5(univCases);
  const session6 = runSession6(univCases);

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  SESSIONS 1-3, 5-6 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('  Session | Signal                  | r     | CV    | Status');
  console.log('  ' + '─'.repeat(70));
  console.log(`  S1      | RMT composite           | ${session1.rmtAnalysis.spearman_r?.toFixed(3).padStart(6)} | ${session1.rmtAnalysis.cross_validation?.mean_r?.toFixed(3).padStart(5)} | ${session1.rmt.n_significant} factors`);
  console.log(`  S2      | Best interaction         | ${session2.bestInteraction.spearman_r?.toFixed(3).padStart(6)} | ${session2.bestInteraction.cross_validation?.mean_r?.toFixed(3).padStart(5)} | ${session2.bestInteraction.pair.split(' × ').map(s => s.replace('si_','').replace('volume_','')).join('×')}`);
  console.log(`  S2      | Geometric composite      | ${session2.geomResult.spearman_r?.toFixed(3).padStart(6)} | ${session2.geomResult.cross_validation?.mean_r?.toFixed(3).padStart(5)} |`);
  if (session3) console.log(`  S3      | Fisher information       | ${session3.fisherAnalysis.spearman_r?.toFixed(3).padStart(6)} | ${session3.fisherAnalysis.cross_validation?.mean_r?.toFixed(3).padStart(5)} | n=${session3.n}`);
  if (session5) console.log(`  S5      | Multi-base Benford       | —     | —     | n=${session5.n}`);
  if (session6) {
    console.log(`  S6      | Secular dominance        | ${session6.secDomAnalysis.spearman_r?.toFixed(3).padStart(6)} | ${session6.secDomAnalysis.cross_validation?.mean_r?.toFixed(3).padStart(5)} | n=${session6.n}`);
    console.log(`  S6      | Signal-to-noise          | ${session6.stnAnalysis.spearman_r?.toFixed(3).padStart(6)} | ${session6.stnAnalysis.cross_validation?.mean_r?.toFixed(3).padStart(5)} |`);
  }

  // Save full report
  const report = {
    test_id: `advanced-math-s1-6-${new Date().toISOString().split('T')[0]}`,
    test_date: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    session_1_rmt: {
      n_significant_factors: session1.rmt.n_significant,
      rmt_composite_r: session1.rmtAnalysis.spearman_r,
      rmt_composite_cv: session1.rmtAnalysis.cross_validation?.mean_r,
      factors: session1.rmt.significantFactors,
    },
    session_2_multiplicative: {
      best_interaction: session2.bestInteraction.pair,
      best_interaction_r: session2.bestInteraction.spearman_r,
      arithmetic_r: session2.arithResult.spearman_r,
      geometric_r: session2.geomResult.spearman_r,
    },
    session_3_fisher: session3 ? {
      r: session3.fisherAnalysis.spearman_r,
      cv: session3.fisherAnalysis.cross_validation?.mean_r,
      n: session3.n,
    } : null,
    session_5_benford: session5 ? {
      n: session5.n,
      classCount: session5.classCount,
    } : null,
    session_6_spectral: session6 ? {
      secular_dominance_r: session6.secDomAnalysis.spearman_r,
      signal_to_noise_r: session6.stnAnalysis.spearman_r,
      n: session6.n,
    } : null,
  };

  const reportPath = join(RESULTS_DIR, `advanced-math-s1-6-${new Date().toISOString().split('T')[0]}.json`);
  writeJSON(reportPath, report);

  registerTest({
    test_id: report.test_id,
    date: report.test_date,
    type: 'advanced-math',
    description: 'RMT cleaning, multiplicative interactions, Fisher, Benford, spectral',
  });

  console.log(`\n  Results saved: ${reportPath}`);
  console.log(`  Elapsed: ${elapsed}s`);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
