#!/usr/bin/env node
// Tests 42-59: Practical Business Signals + Moonshot Mathematical Frameworks
// Run on 719-case expanded dataset with 5-fold CV on all p<0.05 signals

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadCalibrationCases, getUniqueTickers } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, extractUsdNumbers } from './lib/edgar-extractor.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median, stddev, kFoldSplit } from './lib/statistics.js';
import { deflateSync } from 'zlib';

const DRY_RUN = process.argv.includes('--dry-run');
const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const fmtNum = (v, d = 4) => v == null ? 'N/A' : v.toFixed(d);
const fmtPct = (v, d = 1) => v == null ? 'N/A' : (v * 100).toFixed(d) + '%';
const pad = (s, w, a = 'right') => { s = String(s ?? 'N/A'); return a === 'left' ? s.padEnd(w) : s.padStart(w); };
function printH(t) { console.log(`\n${BOLD}${CYAN}${'='.repeat(60)}\n${t}\n${'='.repeat(60)}${RESET}`); }
function printS(t) { console.log(`\n${BOLD}${t}${RESET}\n${DIM}${'-'.repeat(50)}${RESET}`); }

function mw(cases, fn, label) {
  const w = cases.filter(c => c.outcome === 'winner' && fn(c) != null).map(c => fn(c));
  const t = cases.filter(c => c.outcome === 'trap' && fn(c) != null).map(c => fn(c));
  const r = (w.length >= 2 && t.length >= 2) ? mannWhitneyU(w, t) : null;
  const dir = mean(w) > mean(t) ? 'W>T' : 'W<T';
  if (label) console.log(`  ${pad(label, 34, 'left')}: p=${fmtNum(r?.p)}, r=${fmtNum(r?.effectSizeR, 3)}, N=${w.length + t.length} (${dir})`);
  return { p: r?.p, r: r?.effectSizeR, n: w.length + t.length, wM: mean(w), tM: mean(t) };
}

function cv5(cases, fn) {
  const items = cases.filter(c => fn(c) != null).map(c => ({ o: c.outcome, v: fn(c) }));
  if (items.length < 20) return { sigFolds: 0 };
  const folds = kFoldSplit(items, 5, 42);
  const ps = folds.map(({ train, test }) => {
    const tw = test.filter(i => items[i].o === 'winner').map(i => items[i].v);
    const tt = test.filter(i => items[i].o === 'trap').map(i => items[i].v);
    return (tw.length >= 2 && tt.length >= 2) ? (mannWhitneyU(tw, tt)?.p ?? 1) : 1;
  });
  return { sigFolds: ps.filter(p => p < 0.05).length, ps };
}

// ============================================
// DATA LOADING
// ============================================
async function load() {
  const cases = loadCalibrationCases();
  await ensureCikCache();
  const tickers = getUniqueTickers(cases);
  const cd = {};
  let ok = 0;
  for (const t of tickers) {
    const cik = getCikForTicker(t);
    if (DRY_RUN && cik && !hasCachedFacts(cik)) continue;
    const r = await fetchFactsForTicker(t);
    if (!r.facts) continue;
    const qm = extractQuarterlyMetrics(r.facts);
    if (qm.length < 4) continue;
    cd[t] = qm;
    ok++;
    if (ok % 50 === 0) process.stdout.write(`  ${ok}...\r`);
  }
  console.log(`  Loaded: ${ok}`);
  // Build case data
  const out = [];
  for (const c of cases) {
    if (!cd[c.ticker]) continue;
    out.push({ ...c, qm: cd[c.ticker] });
  }
  return out.filter(c => c.outcome === 'winner' || c.outcome === 'trap');
}

// ============================================
// CATEGORY A: PRACTICAL (42-50)
// ============================================

function test42(cs) {
  printH('Test 42: AR Quality');
  const r = cs.map(c => {
    const q = c.qm; if (q.length < 8) return null;
    const rc = q.slice(-4), ea = q.slice(-8, -4);
    const avg = (a, f) => { const v = a.map(x => x[f]).filter(x => x != null && x > 0); return v.length > 0 ? mean(v) : null; };
    const arR = avg(rc, 'accountsReceivable'), arE = avg(ea, 'accountsReceivable');
    const rvR = avg(rc, 'revenue'), rvE = avg(ea, 'revenue');
    if (!arR || !arE || !rvR || !rvE || arE === 0 || rvE === 0) return null;
    const arG = (arR - arE) / Math.abs(arE), rvG = (rvR - rvE) / Math.abs(rvE);
    return { ...c, arGap: rvG - arG };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.arGap, '42A: AR gap');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test43(cs) {
  printH('Test 43: CapEx Intensity Trajectory');
  const r = cs.map(c => {
    const ci = c.qm.filter(q => q.revenue > 0 && q.capex != null).map(q => q.capex / q.revenue);
    if (ci.length < 6) return null;
    const reg = linearRegression(ci.map((_, i) => i), ci);
    return reg ? { ...c, capexSlope: reg.slope } : null;
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.capexSlope, '43A: CapEx intensity slope');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test44(cs) {
  printH('Test 44: SGA Leverage');
  const r = cs.map(c => {
    const sp = c.qm.filter(q => q.revenue > 0 && q.sga > 0).map(q => q.sga / q.revenue);
    if (sp.length < 6) return null;
    const reg = linearRegression(sp.map((_, i) => i), sp);
    return reg ? { ...c, sgaSlope: reg.slope } : null;
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.sgaSlope, '44A: SGA% slope (neg=leveraging)');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test45(cs) {
  printH('Test 45: Cash Conversion Cycle');
  const r = cs.map(c => {
    const ccc = c.qm.map(q => {
      if (!q.revenue || q.revenue <= 0 || !q.costOfRevenue || q.costOfRevenue <= 0) return null;
      const dr = q.revenue / 90, dc = q.costOfRevenue / 90;
      const dso = q.accountsReceivable != null ? q.accountsReceivable / dr : null;
      const dio = q.inventory != null && dc > 0 ? q.inventory / dc : null;
      const dpo = q.accountsPayable != null && dc > 0 ? q.accountsPayable / dc : null;
      if (dso == null && dio == null) return null;
      return (dso || 0) + (dio || 0) - (dpo || 0);
    }).filter(v => v != null && isFinite(v) && Math.abs(v) < 1000);
    if (ccc.length < 6) return null;
    const reg = linearRegression(ccc.map((_, i) => i), ccc);
    return reg ? { ...c, cccSlope: reg.slope } : null;
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.cccSlope, '45A: CCC slope (neg=improving)');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test46(cs) {
  printH('Test 46: Debt Paydown During Growth');
  const r = cs.map(c => {
    const q = c.qm; if (q.length < 8) return null;
    const rc = q.slice(-4), ea = q.slice(-8, -4);
    const avg = (a, f) => { const v = a.map(x => x[f]).filter(x => x != null); return v.length > 0 ? mean(v) : null; };
    const rvR = avg(rc, 'revenue'), rvE = avg(ea, 'revenue');
    if (!rvR || !rvE || rvE === 0) return null;
    const revG = (rvR - rvE) / Math.abs(rvE);
    const dR = (avg(rc, 'longTermDebt') || 0), dE = (avg(ea, 'longTermDebt') || 0);
    const eqR = avg(rc, 'equity'), eqE = avg(ea, 'equity');
    const deR = eqR && eqR !== 0 ? dR / eqR : null;
    const deE = eqE && eqE !== 0 ? dE / eqE : null;
    const deChg = (deR != null && deE != null) ? deR - deE : null;
    return { ...c, revG, deChg, confScore: revG - (deChg || 0), growDelever: revG > 0.05 && deChg != null && deChg < -0.05 };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.confScore, '46B: Confidence score');
  // Category breakdown
  for (const [lb, fn] of [['Grow+Delever', c => c.revG > 0.05 && c.deChg != null && c.deChg < -0.05],
    ['Grow+LeverUp', c => c.revG > 0.05 && c.deChg != null && c.deChg > 0.05],
    ['Shrink+Delever', c => c.revG < -0.05 && c.deChg != null && c.deChg < -0.05],
    ['Shrink+LeverUp', c => c.revG < -0.05 && c.deChg != null && c.deChg > 0.05]]) {
    const g = r.filter(fn); const w = g.filter(x => x.outcome === 'winner').length, t = g.filter(x => x.outcome === 'trap').length;
    console.log(`    ${lb.padEnd(18)}: ${w}W/${t}T → WR ${fmtPct(w + t > 0 ? w / (w + t) : null)}`);
  }
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test47(cs) {
  printH('Test 47: Marginal ROIC');
  const r = cs.map(c => {
    const q = c.qm; if (q.length < 8) return null;
    const rc = q.slice(-4), ea = q.slice(-8, -4);
    const sumF = (a, f) => a.reduce((s, x) => s + (x[f] || 0), 0);
    const avgF = (a, f) => { const v = a.map(x => x[f]).filter(x => x != null); return v.length > 0 ? mean(v) : null; };
    const oiR = sumF(rc, 'operatingIncome'), oiE = sumF(ea, 'operatingIncome');
    const eqR = avgF(rc, 'equity'), eqE = avgF(ea, 'equity');
    const ldR = avgF(rc, 'longTermDebt') || 0, ldE = avgF(ea, 'longTermDebt') || 0;
    const icR = (eqR || 0) + ldR, icE = (eqE || 0) + ldE;
    if (icR === 0 || icE === 0) return null;
    const dOI = oiR - oiE, dIC = icR - icE;
    if (Math.abs(dIC) < 1000) return null;
    const marginal = (dOI * 0.79) / dIC;
    const overall = icR > 0 ? (oiR * 0.79) / icR : null;
    return { ...c, marginalROIC: marginal, overallROIC: overall, gap: overall ? marginal - overall : null };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m1 = mw(r, c => c.marginalROIC, '47A: Marginal ROIC');
  const m2 = mw(r, c => c.gap, '47A: Marginal vs overall gap');
  const bp = Math.min(m1.p ?? 1, m2.p ?? 1);
  return { m1, m2, pass: bp < 0.05, bestP: bp, data: r, n: r.length };
}

function test48(cs) {
  printH('Test 48: FCF vs Earnings Yield');
  // Needs market cap — skip if no price×shares
  console.log(`  ${YELLOW}Requires price × shares outstanding — limited coverage expected${RESET}`);
  const r = cs.map(c => {
    const q = c.qm; if (q.length < 4) return null;
    const rc = q.slice(-4);
    const ocf = rc.reduce((s, x) => s + (x.ocf || 0), 0);
    const capex = rc.reduce((s, x) => s + (x.capex || 0), 0);
    const ni = rc.reduce((s, x) => s + (x.netIncome || 0), 0);
    const fcf = ocf - capex;
    // No market cap available from EDGAR alone — use equity as proxy
    const eq = q[q.length - 1]?.equity;
    if (!eq || eq <= 0) return null;
    const fcfYield = fcf / eq;
    const earningsYield = ni / eq;
    return { ...c, yieldGap: fcfYield - earningsYield };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.yieldGap, '48A: Yield gap (FCF-Earnings)/Equity');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test50(cs) {
  printH('Test 50: Revenue Concentration Proxy');
  const r = cs.map(c => {
    const gs = [];
    for (let i = 4; i < c.qm.length; i++) {
      if (c.qm[i].revenue > 0 && c.qm[i - 4].revenue > 0)
        gs.push((c.qm[i].revenue - c.qm[i - 4].revenue) / c.qm[i - 4].revenue);
    }
    if (gs.length < 4) return null;
    return { ...c, revVol: stddev(gs) };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.revVol, '50A: Revenue growth volatility');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

// ============================================
// CATEGORY B: MOONSHOT (51-59)
// ============================================

function test51(cs) {
  printH('Test 51: Kolmogorov Complexity');
  const r = cs.map(c => {
    const sv = [];
    const roicArr = c.qm.map(q => (q.operatingIncome != null && q.equity > 0) ? q.operatingIncome * 0.79 / ((q.equity || 0) + (q.longTermDebt || 0) || 1) : null);
    const atArr = c.qm.map(q => (q.revenue > 0 && q.assets > 0) ? q.revenue / q.assets : null);
    for (let i = 0; i < c.qm.length; i++) {
      const m = c.qm[i].operatingMargin, g = c.qm[i].revenueGrowthYoY, ro = roicArr[i], a = atArr[i];
      if (m != null && g != null && isFinite(g) && ro != null && a != null) sv.push([m, g, ro, a]);
    }
    if (sv.length < 6) return null;
    // Quantize to terciles
    const quantized = [];
    for (let d = 0; d < 4; d++) {
      const vals = sv.map(s => s[d]).sort((a, b) => a - b);
      const t1 = vals[Math.floor(vals.length / 3)], t2 = vals[Math.floor(2 * vals.length / 3)];
      for (let t = 0; t < sv.length; t++) {
        if (!quantized[t]) quantized[t] = [];
        quantized[t].push(sv[t][d] <= t1 ? 0 : sv[t][d] <= t2 ? 1 : 2);
      }
    }
    const ser = quantized.map(q => q.join('')).join('');
    // zlib compression ratio
    const orig = Buffer.from(ser, 'utf-8');
    const comp = deflateSync(orig);
    return { ...c, compRatio: comp.length / orig.length, rawLen: orig.length };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.compRatio, '51A: Compression ratio');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test52(cs) {
  printH('Test 52: Lévy Tail Index');
  const r = cs.map(c => {
    const gs = [];
    for (let i = 4; i < c.qm.length; i++) {
      if (c.qm[i].revenue > 0 && c.qm[i - 4].revenue > 0)
        gs.push((c.qm[i].revenue - c.qm[i - 4].revenue) / c.qm[i - 4].revenue);
    }
    if (gs.length < 12) return null;
    const abs = gs.map(Math.abs).sort((a, b) => b - a);
    const k = Math.max(3, Math.floor(abs.length * 0.2));
    const thr = abs[k];
    if (thr <= 0) return null;
    let logSum = 0;
    for (let i = 0; i < k; i++) { if (abs[i] > 0 && thr > 0) logSum += Math.log(abs[i] / thr); }
    const alpha = logSum > 0 ? Math.min(k / logSum, 2.0) : null;
    return alpha != null ? { ...c, tailAlpha: alpha } : null;
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.tailAlpha, '52A: Tail index α');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test53(cs) {
  printH('Test 53: Symbolic Dynamics');
  const r = cs.map(c => {
    const syms = [];
    for (let i = 4; i < c.qm.length; i++) {
      const q = c.qm[i], p = c.qm[i - 4];
      if (!q.revenue || !p.revenue || p.revenue <= 0) continue;
      const rC = (q.revenue - p.revenue) / p.revenue;
      const mC = (q.operatingMargin || 0) - (p.operatingMargin || 0);
      syms.push((rC > 0.02 ? 'U' : rC < -0.02 ? 'D' : 'F') + (mC > 0.005 ? '+' : mC < -0.005 ? '-' : '0'));
    }
    if (syms.length < 6) return null;
    const n = syms.length;
    const strong = syms.filter(s => s === 'U+').length / n;
    const weak = syms.filter(s => s === 'D-').length / n;
    // Recovery rate after bad quarters
    let recov = 0, badQ = 0;
    for (let i = 1; i < syms.length; i++) {
      if (syms[i - 1].startsWith('D')) { badQ++; if (syms[i].startsWith('U')) recov++; }
    }
    const recovRate = badQ > 0 ? recov / badQ : null;
    // Longest strong run
    let lsr = 0, cur = 0;
    for (const s of syms) { if (s === 'U+' || s === 'U0') { cur++; lsr = Math.max(lsr, cur); } else cur = 0; }
    return { ...c, strongFrac: strong, weakFrac: weak, recovRate, longestStrong: lsr };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m1 = mw(r, c => c.strongFrac, '53A: Strong quarter fraction');
  const m2 = mw(r, c => c.weakFrac, '53A: Weak quarter fraction');
  const m3 = mw(r, c => c.recovRate, '53B: Recovery rate after D');
  const m4 = mw(r, c => c.longestStrong, '53A: Longest strong run');
  const bp = Math.min(m1.p ?? 1, m2.p ?? 1, m3.p ?? 1, m4.p ?? 1);
  return { m1, m2, m3, m4, pass: bp < 0.05, bestP: bp, n: r.length, data: r };
}

function test54(cs) {
  printH('Test 54: Multi-Base Benford');
  const r = cs.map(c => {
    const vals = [];
    for (const q of c.qm) {
      for (const f of ['revenue', 'assets', 'equity', 'totalLiabilities', 'operatingIncome', 'netIncome', 'ocf', 'grossProfit']) {
        if (q[f] != null && Math.abs(q[f]) > 0) vals.push(Math.abs(q[f]));
      }
    }
    if (vals.length < 50) return null;
    const kldB = (values, base) => {
      const digits = values.map(v => { const l = Math.log(v) / Math.log(base); return Math.floor(Math.pow(base, l - Math.floor(l))); }).filter(d => d >= 1 && d < base);
      if (digits.length < 30) return null;
      const counts = {};
      for (const d of digits) counts[d] = (counts[d] || 0) + 1;
      let kl = 0;
      for (let d = 1; d < base; d++) {
        const obs = (counts[d] || 0) / digits.length;
        const exp = Math.log(1 + 1 / d) / Math.log(base);
        if (obs > 0 && exp > 0) kl += obs * Math.log(obs / exp);
      }
      return kl;
    };
    const k10 = kldB(vals, 10), k8 = kldB(vals, 8), k12 = kldB(vals, 12);
    if (k10 == null || k8 == null || k12 == null) return null;
    const otherMean = (k8 + k12) / 2;
    return { ...c, base10Excess: k10 - otherMean, kld10: k10 };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.base10Excess, '54A: Base-10 excess');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test55(cs) {
  printH('Test 55: Transition Probabilities');
  const r = cs.map(c => {
    const states = [];
    for (let i = 4; i < c.qm.length; i++) {
      const q = c.qm[i], p = c.qm[i - 4];
      if (!q.revenue || !p.revenue || p.revenue <= 0) continue;
      const rUp = q.revenue > p.revenue * 1.01;
      const mUp = (q.operatingMargin || 0) > (p.operatingMargin || 0) + 0.003;
      states.push(rUp ? (mUp ? 'S' : 'G') : (mUp ? 'R' : 'W'));
    }
    if (states.length < 8) return null;
    const trans = { S: { S: 0, G: 0, R: 0, W: 0 }, G: { S: 0, G: 0, R: 0, W: 0 }, R: { S: 0, G: 0, R: 0, W: 0 }, W: { S: 0, G: 0, R: 0, W: 0 } };
    for (let i = 1; i < states.length; i++) trans[states[i - 1]][states[i]]++;
    const norm = (from) => { const t = Object.values(trans[from]).reduce((a, b) => a + b, 0); return t > 0 ? Object.fromEntries(Object.entries(trans[from]).map(([k, v]) => [k, v / t])) : trans[from]; };
    const tN = { S: norm('S'), G: norm('G'), R: norm('R'), W: norm('W') };
    const pSS = tN.S.S, pWW = tN.W.W, rWS = tN.W.S, cSW = tN.S.W;
    const fw = pSS + rWS - pWW - cSW;
    let changes = 0;
    for (let i = 1; i < states.length; i++) if (states[i] !== states[i - 1]) changes++;
    return { ...c, flywheelStrength: fw, persistS: pSS, persistW: pWW, oscRate: changes / (states.length - 1) };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m1 = mw(r, c => c.flywheelStrength, '55A: Flywheel strength');
  const m2 = mw(r, c => c.persistS, '55A: P(Strong→Strong)');
  const m3 = mw(r, c => c.persistW, '55A: P(Weak→Weak)');
  const bp = Math.min(m1.p ?? 1, m2.p ?? 1, m3.p ?? 1);
  return { m1, m2, m3, pass: bp < 0.05, bestP: bp, n: r.length, data: r };
}

function test56(cs) {
  printH('Test 56: Minimum Description Length');
  const r = cs.map(c => {
    const revs = c.qm.map(q => q.revenue).filter(v => v != null && v > 0);
    if (revs.length < 8) return null;
    const n = revs.length, xs = Array.from({ length: n }, (_, i) => i);
    // Constant
    const m = mean(revs);
    const sse1 = revs.reduce((s, v) => s + (v - m) ** 2, 0);
    // Linear
    const lr = linearRegression(xs, revs);
    const sse2 = revs.reduce((s, v, i) => s + (v - (lr.intercept + lr.slope * i)) ** 2, 0);
    // MDL
    const mdl = (sse, k) => (n / 2) * Math.log((sse / n) || 1e-10) + (k / 2) * Math.log(n);
    const mdl1 = mdl(sse1, 1), mdl2 = mdl(sse2, 2);
    const bestParams = mdl2 < mdl1 ? 2 : 1;
    return { ...c, bestParams, mdlDiff: mdl1 - mdl2 };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.mdlDiff, '56A: MDL diff (constant-linear)');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test57(cs) {
  printH('Test 57: Information Geometry');
  // First pass: compute winner/trap centroids
  const pts = cs.map(c => {
    const p = [];
    for (let i = 4; i < c.qm.length; i++) {
      const q = c.qm[i], prev = c.qm[i - 4];
      if (!q.revenue || !prev.revenue || prev.revenue <= 0) continue;
      p.push({ rg: (q.revenue - prev.revenue) / prev.revenue, mc: (q.operatingMargin || 0) - (prev.operatingMargin || 0) });
    }
    if (p.length < 4) return null;
    return { ...c, muR: mean(p.map(x => x.rg)), muM: mean(p.map(x => x.mc)), vR: stddev(p.map(x => x.rg)) ** 2 || 1e-8, vM: stddev(p.map(x => x.mc)) ** 2 || 1e-8 };
  }).filter(Boolean);
  const wPts = pts.filter(p => p.outcome === 'winner'), tPts = pts.filter(p => p.outcome === 'trap');
  const wCentroid = { mu: [mean(wPts.map(p => p.muR)), mean(wPts.map(p => p.muM))], sig: [mean(wPts.map(p => p.vR)), mean(wPts.map(p => p.vM))] };
  const tCentroid = { mu: [mean(tPts.map(p => p.muR)), mean(tPts.map(p => p.muM))], sig: [mean(tPts.map(p => p.vR)), mean(tPts.map(p => p.vM))] };
  const bhatt = (mu1, s1, mu2, s2) => {
    const sa = [(s1[0] + s2[0]) / 2, (s1[1] + s2[1]) / 2];
    return ((mu1[0] - mu2[0]) ** 2 / sa[0] + (mu1[1] - mu2[1]) ** 2 / sa[1]) / 8 +
      0.5 * Math.log(sa[0] * sa[1] / Math.sqrt(s1[0] * s1[1] * s2[0] * s2[1]));
  };
  for (const p of pts) {
    p.dW = bhatt([p.muR, p.muM], [p.vR, p.vM], wCentroid.mu, wCentroid.sig);
    p.dT = bhatt([p.muR, p.muM], [p.vR, p.vM], tCentroid.mu, tCentroid.sig);
    p.relDist = p.dW - p.dT;
  }
  console.log(`  N=${pts.length}`);
  const m = mw(pts, c => c.relDist, '57A: Relative distance (neg=closer to W)');
  const correct = pts.filter(p => (p.relDist < 0 && p.outcome === 'winner') || (p.relDist >= 0 && p.outcome === 'trap')).length;
  console.log(`  Classification accuracy: ${fmtPct(correct / pts.length)}`);
  return { ...m, pass: (m.p ?? 1) < 0.05, accuracy: correct / pts.length, data: pts };
}

function test58(cs) {
  printH('Test 58: EPS Rounding Detection');
  const r = cs.map(c => {
    const eps = c.qm.map(q => q.eps).filter(v => v != null && v !== 0);
    if (eps.length < 8) return null;
    const lastDigits = eps.map(e => Math.round(Math.abs(e) * 100) % 10);
    const dc = Array(10).fill(0);
    for (const d of lastDigits) dc[d]++;
    const roundFrac = (dc[0] + dc[5]) / lastDigits.length;
    return { ...c, excessRounding: roundFrac - 0.20, roundFrac };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.excessRounding, '58A: EPS excess rounding');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

function test59(cs) {
  printH('Test 59: Entropy Rate');
  const r = cs.map(c => {
    const gs = [];
    for (let i = 4; i < c.qm.length; i++) {
      if (c.qm[i].revenue > 0 && c.qm[i - 4].revenue > 0)
        gs.push((c.qm[i].revenue - c.qm[i - 4].revenue) / c.qm[i - 4].revenue);
    }
    if (gs.length < 12) return null;
    const sorted = [...gs].sort((a, b) => a - b);
    const t1 = sorted[Math.floor(sorted.length / 3)], t2 = sorted[Math.floor(2 * sorted.length / 3)];
    const syms = gs.map(v => v <= t1 ? 0 : v <= t2 ? 1 : 2);
    // Block entropy for length 3
    const blocks = {};
    let total = 0;
    for (let i = 0; i <= syms.length - 3; i++) {
      const b = syms.slice(i, i + 3).join(',');
      blocks[b] = (blocks[b] || 0) + 1; total++;
    }
    let ent = 0;
    for (const c of Object.values(blocks)) { const p = c / total; if (p > 0) ent -= p * Math.log2(p); }
    return { ...c, entropyRate: ent / 3, normEntropy: (ent / 3) / Math.log2(3) };
  }).filter(Boolean);
  console.log(`  N=${r.length}`);
  const m = mw(r, c => c.entropyRate, '59A: Entropy rate');
  return { ...m, pass: (m.p ?? 1) < 0.05, data: r };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${BOLD}Tests 42-59: Practical + Moonshot${RESET}\n${'='.repeat(50)}`);
  const cs = await load();
  console.log(`  W/T cases: ${cs.length}\n`);

  const results = {};
  const tests = [
    [42, 'AR Quality', test42], [43, 'CapEx Trajectory', test43], [44, 'SGA Leverage', test44],
    [45, 'Cash Conv Cycle', test45], [46, 'Debt Paydown', test46], [47, 'Marginal ROIC', test47],
    [48, 'FCF vs Earnings', test48], [50, 'Rev Concentration', test50],
    [51, 'Kolmogorov Complexity', test51], [52, 'Lévy Tail Index', test52],
    [53, 'Symbolic Dynamics', test53], [54, 'Multi-Base Benford', test54],
    [55, 'Transition Probs', test55], [56, 'MDL', test56],
    [57, 'Info Geometry', test57], [58, 'EPS Rounding', test58], [59, 'Entropy Rate', test59],
  ];

  for (const [num, name, fn] of tests) {
    const r = fn(cs);
    results[`test${num}`] = { name, ...r, data: undefined };
    const pass = r.pass ?? (r.bestP ?? r.p ?? 1) < 0.05;
    console.log(`  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}\n`);
  }

  // CV on all passing signals
  printH('5-FOLD CROSS-VALIDATION ON PASSING SIGNALS');
  const cvResults = [];
  const signalDefs = [];

  // Collect signal functions from passing tests
  if (results.test42?.pass) signalDefs.push({ name: 'AR gap (T42)', fn: c => results.test42.data?.find(x => x.ticker === c.ticker)?.arGap });
  if (results.test43?.pass) signalDefs.push({ name: 'CapEx slope (T43)', fn: c => results.test43.data?.find(x => x.ticker === c.ticker)?.capexSlope });
  if (results.test44?.pass) signalDefs.push({ name: 'SGA slope (T44)', fn: c => results.test44.data?.find(x => x.ticker === c.ticker)?.sgaSlope });
  if (results.test45?.pass) signalDefs.push({ name: 'CCC slope (T45)', fn: c => results.test45.data?.find(x => x.ticker === c.ticker)?.cccSlope });
  if (results.test46?.pass) signalDefs.push({ name: 'Conf score (T46)', fn: c => results.test46.data?.find(x => x.ticker === c.ticker)?.confScore });
  if ((results.test47?.bestP ?? 1) < 0.05) signalDefs.push({ name: 'Marginal ROIC (T47)', fn: c => results.test47.data?.find(x => x.ticker === c.ticker)?.marginalROIC });
  if (results.test48?.pass) signalDefs.push({ name: 'Yield gap (T48)', fn: c => results.test48.data?.find(x => x.ticker === c.ticker)?.yieldGap });
  if (results.test50?.pass) signalDefs.push({ name: 'Rev vol (T50)', fn: c => results.test50.data?.find(x => x.ticker === c.ticker)?.revVol });
  if (results.test51?.pass) signalDefs.push({ name: 'Compression (T51)', fn: c => results.test51.data?.find(x => x.ticker === c.ticker)?.compRatio });
  if (results.test52?.pass) signalDefs.push({ name: 'Tail α (T52)', fn: c => results.test52.data?.find(x => x.ticker === c.ticker)?.tailAlpha });
  if ((results.test53?.bestP ?? 1) < 0.05) signalDefs.push({ name: 'Strong frac (T53)', fn: c => results.test53.data?.find(x => x.ticker === c.ticker)?.strongFrac });
  if ((results.test53?.bestP ?? 1) < 0.05) signalDefs.push({ name: 'Weak frac (T53)', fn: c => results.test53.data?.find(x => x.ticker === c.ticker)?.weakFrac });
  if (results.test54?.pass) signalDefs.push({ name: 'B10 excess (T54)', fn: c => results.test54.data?.find(x => x.ticker === c.ticker)?.base10Excess });
  if ((results.test55?.bestP ?? 1) < 0.05) signalDefs.push({ name: 'Flywheel str (T55)', fn: c => results.test55.data?.find(x => x.ticker === c.ticker)?.flywheelStrength });
  if (results.test56?.pass) signalDefs.push({ name: 'MDL diff (T56)', fn: c => results.test56.data?.find(x => x.ticker === c.ticker)?.mdlDiff });
  if (results.test57?.pass) signalDefs.push({ name: 'Rel dist (T57)', fn: c => results.test57.data?.find(x => x.ticker === c.ticker)?.relDist });
  if (results.test58?.pass) signalDefs.push({ name: 'EPS rounding (T58)', fn: c => results.test58.data?.find(x => x.ticker === c.ticker)?.excessRounding });
  if (results.test59?.pass) signalDefs.push({ name: 'Entropy rate (T59)', fn: c => results.test59.data?.find(x => x.ticker === c.ticker)?.entropyRate });

  if (signalDefs.length === 0) {
    console.log(`  No signals passed p < 0.05. No CV needed.`);
  } else {
    console.log(`  ${'Signal'.padEnd(28)} | CV folds | Verdict`);
    console.log(`  ${'-'.repeat(28)}-+-${'-'.repeat(8)}-+--------`);
    for (const sig of signalDefs) {
      const cv = cv5(cs, sig.fn);
      const verdict = cv.sigFolds >= 4 ? GREEN + 'ROBUST' + RESET : cv.sigFolds >= 3 ? YELLOW + 'MODERATE' + RESET : RED + cv.sigFolds + '/5' + RESET;
      console.log(`  ${sig.name.padEnd(28)} | ${String(cv.sigFolds + '/5').padStart(8)} | ${verdict}`);
      cvResults.push({ name: sig.name, sigFolds: cv.sigFolds, robust: cv.sigFolds >= 4 });
    }
    const robust = cvResults.filter(r => r.robust);
    console.log(`\n  ${BOLD}Robust signals (4/5): ${robust.length}${RESET}`);
    for (const r of robust) console.log(`    ${GREEN}${r.name}${RESET}`);
  }

  // Summary
  printH('TESTS 42-59 SUMMARY');
  for (const [num, name] of tests.map(t => [t[0], t[1]])) {
    const r = results[`test${num}`];
    const pass = r?.pass ?? ((r?.bestP ?? r?.p ?? 1) < 0.05);
    console.log(`  T${num} ${name.padEnd(24)}: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} (p=${fmtNum(r?.bestP ?? r?.p)}, N=${r?.n ?? '?'})`);
  }

  // Save
  const saveable = {};
  for (const [k, v] of Object.entries(results)) {
    const { data, ...rest } = v;
    saveable[k] = rest;
  }
  saveable.crossValidation = cvResults;
  const outPath = resolve(import.meta.dirname, '../data', `test-battery-42-59-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outPath, JSON.stringify(saveable, null, 2));
  console.log(`\n${DIM}Saved to ${outPath}${RESET}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
