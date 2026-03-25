#!/usr/bin/env node
// Statistical analysis for refined risk factor recalibration
import { readFileSync, writeFileSync } from 'fs';

const results = JSON.parse(readFileSync('results/refined-risk-factor-results-2026-03-25.json', 'utf8'));
const pipeline = JSON.parse(readFileSync('data/ai-analyst-pipeline/pipeline-data.json', 'utf8'));
const n = results.length;

// ===== HELPER FUNCTIONS =====
function pearsonR(x, y) {
  const n = x.length;
  if (n < 3) return { r: 0, p: 1 };
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return { r: 0, p: 1 };
  const r = num / Math.sqrt(dx2 * dy2);
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const p = tToP(Math.abs(t), n - 2);
  return { r, p };
}

function tToP(t, df) {
  const x = df / (df + t * t);
  return betaInc(df / 2, 0.5, x);
}

function betaInc(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - betaInc(b, a, 1 - x);
  const lnB = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnB) / a;
  let f = 1, c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d; f = d;
  for (let m = 1; m <= 200; m++) {
    let num = m * (b - m) * x / ((a + 2*m - 1) * (a + 2*m));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1/d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30; f *= d * c;
    num = -(a + m) * (a + b + m) * x / ((a + 2*m) * (a + 2*m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1/d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30; f *= d * c;
    if (Math.abs(d * c - 1) < 1e-8) break;
  }
  return front * f;
}

function lnGamma(z) {
  const coef = [0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1; let x = coef[0];
  for (let i = 1; i < 9; i++) x += coef[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

const outcomes = results.map(r => r.outcome);

// ===== SECTION A =====
console.log("=== A: SEVERITY SCORE DISTRIBUTION ===");
const bins = [
  { label: "<=0 (improving)", min: -Infinity, max: 0 },
  { label: "1-5 (normal)", min: 1, max: 5 },
  { label: "6-12 (moderate)", min: 6, max: 12 },
  { label: "13-20 (significant)", min: 13, max: 20 },
  { label: ">20 (critical)", min: 21, max: Infinity },
];
const sectionA = [];
for (const bin of bins) {
  const inBin = results.filter(r => r.severity_score >= bin.min && r.severity_score <= bin.max);
  const w = inBin.filter(r => r.outcome === 1).length;
  const t = inBin.filter(r => r.outcome === 0).length;
  const wr = inBin.length > 0 ? (w/inBin.length*100).toFixed(1) : "N/A";
  const tr = inBin.length > 0 ? (t/inBin.length*100).toFixed(1) : "N/A";
  sectionA.push({ range: bin.label, cases: inBin.length, w, t, wr, tr });
  console.log(`${bin.label.padEnd(22)} n=${String(inBin.length).padEnd(3)} W=${String(w).padEnd(3)} T=${String(t).padEnd(3)} WR=${wr}% TR=${tr}%`);
}

// ===== SECTION B =====
console.log("\n=== B: CATEGORY BREAKDOWN ===");
const cats = ["boilerplate_count","sector_wide_count","company_specific_count","escalation_count","confession_count","resolved_count"];
const catNames = ["Boilerplate","Sector-wide","Company-specific","Escalation","Confession","Resolved"];
const sectionB = [];
for (let i = 0; i < cats.length; i++) {
  const vals = results.map(r => r[cats[i]] || 0);
  const mean = (vals.reduce((a,b) => a+b, 0) / n).toFixed(2);
  const {r, p} = pearsonR(vals, outcomes);
  sectionB.push({ cat: catNames[i], mean, r: r.toFixed(3), p: p.toFixed(3) });
  console.log(`${catNames[i].padEnd(20)} mean=${mean.padEnd(6)} r=${r.toFixed(3).padEnd(8)} p=${p.toFixed(3)}`);
}

// ===== SECTION C =====
console.log("\n=== C: CONFESSION PATTERN ANALYSIS ===");
const withConf = results.filter(r => (r.confession_count || 0) >= 1);
const noConf = results.filter(r => (r.confession_count || 0) === 0);
const cW = withConf.filter(r => r.outcome === 1).length;
const cT = withConf.filter(r => r.outcome === 0).length;
const ncW = noConf.filter(r => r.outcome === 1).length;
const ncT = noConf.filter(r => r.outcome === 0).length;
console.log(`With confession: ${withConf.length}/${n} W=${cW} T=${cT} WR=${(cW/withConf.length*100).toFixed(1)}%`);
console.log(`Without confession: ${noConf.length}/${n} W=${ncW} T=${ncT} WR=${(ncW/noConf.length*100).toFixed(1)}%`);

// ===== SECTION D =====
console.log("\n=== D: COMPARE TO ORIGINAL JOB 2 ===");
const sevs = results.map(r => r.severity_score);
const {r: rSev, p: pSev} = pearsonR(sevs, outcomes);
const rComp = -rSev;

const okay = results.filter(r => ["improving","normal"].includes(r.trajectory));
const problem = results.filter(r => ["moderate_concern","significant_concern","critical"].includes(r.trajectory));
const okW = okay.filter(r => r.outcome === 1).length;
const probT = problem.filter(r => r.outcome === 0).length;
console.log(`r with outcome (negated): ${rComp.toFixed(3)} p: ${pSev.toFixed(3)}`);
console.log(`Okay (improving+normal): ${okay.length} (${(okay.length/n*100).toFixed(0)}%) WR: ${okay.length > 0 ? (okW/okay.length*100).toFixed(1)+"%" : "N/A"}`);
console.log(`Problem (mod+sig+crit): ${problem.length} (${(problem.length/n*100).toFixed(0)}%) TR: ${problem.length > 0 ? (probT/problem.length*100).toFixed(1)+"%" : "N/A"}`);

// ===== SECTION E =====
console.log("\n=== E: OPTIMAL THRESHOLD SWEEP ===");
const thresholds = [3, 5, 8, 10, 15];
const sectionE = [];
for (const th of thresholds) {
  const ok = results.filter(r => r.severity_score <= th);
  const con = results.filter(r => r.severity_score > th);
  const okWin = ok.filter(r => r.outcome === 1).length;
  const conTrap = con.filter(r => r.outcome === 0).length;
  const wr = ok.length > 0 ? (okWin/ok.length*100).toFixed(1) : "N/A";
  const tr = con.length > 0 ? (conTrap/con.length*100).toFixed(1) : "N/A";
  const sv = ok.length > 0 && con.length > 0 ? Math.sqrt(okWin/ok.length * conTrap/con.length * 10000).toFixed(1) : "N/A";
  sectionE.push({ th, okN: ok.length, wr, conN: con.length, tr, sv });
  console.log(`<=${th}  okay=${ok.length} WR=${wr}%  concern=${con.length} TR=${tr}%  signal=${sv}%`);
}

// ===== SECTION F =====
console.log("\n=== F: SIMPLE HEURISTIC COMPARISON ===");
const heuristics = results.map(r => {
  const pd = pipeline[r.caseId];
  if (!pd || !pd.tenK || !pd.priorTenK) return null;
  const cur = pd.tenK.riskFactors || "";
  const pri = pd.priorTenK.riskFactors || "";
  if (cur.length < 100 || pri.length < 100) return null;
  const curParas = cur.split(/\n\s*\n/).length;
  const priParas = pri.split(/\n\s*\n/).length;
  const curDollars = (cur.match(/\$[\d,.]+\s*(million|billion|thousand)?/gi) || []).length;
  const priDollars = (pri.match(/\$[\d,.]+\s*(million|billion|thousand)?/gi) || []).length;
  const keywords = ["restat", "material weakness", "amendment", "covenant waiv", "consent order", "enforcement action"];
  const curHits = keywords.filter(kw => cur.toLowerCase().includes(kw)).length;
  const priHits = keywords.filter(kw => pri.toLowerCase().includes(kw)).length;
  return { outcome: r.outcome, paraDiff: curParas - priParas, dollarDiff: curDollars - priDollars, keywordNew: curHits - priHits, curHits, lengthDiff: cur.length - pri.length };
}).filter(Boolean);

const hO = heuristics.map(h => h.outcome);
const hMetrics = [
  { name: "Paragraph diff", vals: heuristics.map(h => h.paraDiff) },
  { name: "Dollar amount diff", vals: heuristics.map(h => h.dollarDiff) },
  { name: "New restatement kw", vals: heuristics.map(h => h.keywordNew) },
  { name: "Total restatement kw", vals: heuristics.map(h => h.curHits) },
  { name: "Text length diff", vals: heuristics.map(h => h.lengthDiff) },
];
const sectionF = [];
for (const m of hMetrics) {
  const {r, p} = pearsonR(m.vals, hO);
  sectionF.push({ name: m.name, r: (-r).toFixed(3), p: p.toFixed(3) });
  console.log(`${m.name.padEnd(22)} r=${(-r).toFixed(3).padEnd(8)} p=${p.toFixed(3)}`);
}

// ===== SUMMARY =====
console.log("\n=== SUMMARY ===");
console.log(`Refined r: ${rComp.toFixed(3)} (orig: 0.378)`);
console.log(`Refined p: ${pSev.toFixed(3)} (orig: 0.030)`);
console.log(`FP rate: ${(problem.length/n*100).toFixed(0)}% (orig: 79%)`);
console.log(`Okay WR: ${okay.length > 0 ? (okW/okay.length*100).toFixed(1) : "N/A"}% (orig: 71%)`);
console.log(`Problem TR: ${problem.length > 0 ? (probT/problem.length*100).toFixed(1) : "N/A"}% (orig: 73%)`);

// Determine verdicts
let promptVerdict, fpVerdict, hVerdict;
if (rComp > 0.40) promptVerdict = "USE REFINED";
else if (rComp >= 0.30) promptVerdict = "USE EITHER";
else promptVerdict = "USE ORIGINAL";

const fpPct = problem.length/n*100;
if (fpPct < 50) fpVerdict = "Major improvement";
else if (fpPct <= 65) fpVerdict = "Modest improvement";
else fpVerdict = "Still too pessimistic";

const bestHR = Math.max(...sectionF.map(s => Math.abs(parseFloat(s.r))));
if (bestHR > 0.30) hVerdict = "AI may be replaceable";
else hVerdict = "AI adds value beyond heuristics";

// Best threshold
let bestT = { th: 5, score: 0, wr: 0, tr: 0 };
for (const th of thresholds) {
  const ok = results.filter(r => r.severity_score <= th);
  const con = results.filter(r => r.severity_score > th);
  if (ok.length === 0 || con.length === 0) continue;
  const wr = ok.filter(r => r.outcome === 1).length / ok.length;
  const tr = con.filter(r => r.outcome === 0).length / con.length;
  const sc = Math.sqrt(wr * tr);
  if (sc > bestT.score) bestT = { th, score: sc, wr, tr };
}

const finalVerdict = rComp > 0.40 ? "USE REFINED" : (rComp >= 0.30 ? (fpPct < 60 ? "USE REFINED" : "USE ORIGINAL") : "USE HEURISTIC");
const ready = rComp >= 0.30 && pSev < 0.10 ? "YES" : "NO";

console.log(`\nPrompt verdict: ${promptVerdict}`);
console.log(`FP verdict: ${fpVerdict}`);
console.log(`Heuristic verdict: ${hVerdict}`);
console.log(`Best threshold: <=${bestT.th} (WR=${(bestT.wr*100).toFixed(1)}% TR=${(bestT.tr*100).toFixed(1)}%)`);
console.log(`Final: ${finalVerdict}. Ready for 200-case: ${ready}`);

// Save analysis data for report generation
writeFileSync("results/refined-analysis-data.json", JSON.stringify({
  sectionA, sectionB, sectionC: { withConf: withConf.length, cW, cT, noConf: noConf.length, ncW, ncT },
  sectionD: { rComp: rComp.toFixed(3), pSev: pSev.toFixed(3), okayN: okay.length, problemN: problem.length, okW, probT, okayPct: (okay.length/n*100).toFixed(0), problemPct: (problem.length/n*100).toFixed(0), okayWR: okay.length > 0 ? (okW/okay.length*100).toFixed(1) : "N/A", problemTR: problem.length > 0 ? (probT/problem.length*100).toFixed(1) : "N/A" },
  sectionE, sectionF,
  summary: { rComp: rComp.toFixed(3), pSev: pSev.toFixed(3), fpRate: (fpPct).toFixed(0), promptVerdict, fpVerdict, hVerdict, bestThreshold: bestT.th, bestWR: (bestT.wr*100).toFixed(1), bestTR: (bestT.tr*100).toFixed(1), finalVerdict, ready, bestHR: bestHR.toFixed(3) }
}, null, 2));
