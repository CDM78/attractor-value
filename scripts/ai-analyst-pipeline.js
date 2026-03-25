#!/usr/bin/env node
// AI Analyst Pipeline — Builds data packages for each case.
// Extracts 10-K Risk Factors, MD&A, identifies competitors, pulls insider data.
//
// Usage: node scripts/ai-analyst-pipeline.js [--limit N] [--start N] [--verify-only]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const AGENT_DIR = resolve(DATA_DIR, 'agent');
const PIPELINE_DIR = resolve(DATA_DIR, 'ai-analyst-pipeline');
const EDGAR_CACHE = resolve(DATA_DIR, 'edgar-cache');
mkdirSync(PIPELINE_DIR, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : 50; })();
const START = (() => { const i = args.indexOf('--start'); return i >= 0 ? parseInt(args[i + 1]) : 0; })();
const VERIFY_ONLY = args.includes('--verify-only');

const UA = 'AV-Framework charles@bolinandtroy.com';
function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
let lastFetchTime = 0;
async function edgarFetch(url) {
  const now = Date.now();
  if (now - lastFetchTime < 120) await new Promise(r => setTimeout(r, 120 - (now - lastFetchTime)));
  lastFetchTime = Date.now();
  return fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
}

// ============================================
// 10-K FILING EXTRACTION
// ============================================
async function getFilingIndex(cik, formType, beforeDate, count = 2) {
  const paddedCik = cik.replace(/^0+/, '');
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  try {
    const r = await edgarFetch(url);
    if (!r.ok) return [];
    const data = await r.json();
    const recent = data.filings?.recent;
    if (!recent) return [];

    const filings = [];
    for (let i = 0; i < (recent.form?.length || 0); i++) {
      if (recent.form[i] === formType && recent.filingDate[i] < beforeDate) {
        filings.push({
          accession: recent.accessionNumber[i],
          filed: recent.filingDate[i],
          primaryDoc: recent.primaryDocument[i],
        });
        if (filings.length >= count) break;
      }
    }
    return filings;
  } catch { return []; }
}

async function extractFilingSection(cik, accession, primaryDoc, sectionPattern, nextSectionPattern, maxChars = 30000) {
  const paddedCik = cik.replace(/^0+/, '');
  const accClean = accession.replace(/-/g, '');
  const url = `https://www.sec.gov/Archives/edgar/data/${paddedCik}/${accClean}/${primaryDoc}`;

  try {
    const r = await edgarFetch(url);
    if (!r.ok) return null;
    const html = await r.text();
    if (html.length < 1000) return null;

    const stripped = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');

    // Find all occurrences of sectionPattern, take the one with most text after it
    const re = new RegExp(sectionPattern, 'gi');
    const matches = [];
    let m;
    while ((m = re.exec(stripped)) !== null) matches.push(m.index);

    if (matches.length === 0) return null;

    // The substantive section is usually the one followed by the most text before the next section
    let bestStart = -1, bestLength = 0;
    for (const start of matches) {
      const nextRe = new RegExp(nextSectionPattern, 'gi');
      nextRe.lastIndex = start + 50;
      const nextMatch = nextRe.exec(stripped);
      const end = nextMatch ? nextMatch.index : start + maxChars;
      const length = Math.min(end - start, maxChars);
      if (length > bestLength) { bestStart = start; bestLength = length; }
    }

    if (bestStart < 0 || bestLength < 200) return null;
    return stripped.slice(bestStart, bestStart + bestLength).trim();
  } catch { return null; }
}

async function get10KSections(cik, beforeDate) {
  const filings = await getFilingIndex(cik, '10-K', beforeDate, 2);
  if (filings.length === 0) {
    // Try 20-F for international filers
    const f20 = await getFilingIndex(cik, '20-F', beforeDate, 2);
    if (f20.length > 0) filings.push(...f20);
  }
  if (filings.length === 0) return null;

  const result = { current: null, prior: null };

  // Current 10-K (most recent before entry)
  const cur = filings[0];
  if (cur) {
    const risk = await extractFilingSection(cik, cur.accession, cur.primaryDoc,
      'Item\\s*1A\\.?\\s*Risk\\s*Factors', 'Item\\s*1B|Item\\s*2\\.?\\s*Prop');
    const mda = await extractFilingSection(cik, cur.accession, cur.primaryDoc,
      'Item\\s*7\\.?\\s*Management', 'Item\\s*7A|Item\\s*8');
    result.current = { filed: cur.filed, accession: cur.accession, riskFactors: risk, mda: mda };
  }

  // Prior year 10-K
  if (filings.length >= 2) {
    const prev = filings[1];
    const risk = await extractFilingSection(cik, prev.accession, prev.primaryDoc,
      'Item\\s*1A\\.?\\s*Risk\\s*Factors', 'Item\\s*1B|Item\\s*2\\.?\\s*Prop');
    result.prior = { filed: prev.filed, accession: prev.accession, riskFactors: risk };
  }

  return result;
}

// ============================================
// 10-Q MD&A EXTRACTION (transcript fallback)
// ============================================
async function get10QMDAs(cik, beforeDate, count = 8) {
  const filings = await getFilingIndex(cik, '10-Q', beforeDate, count);
  const mdas = [];

  for (const f of filings) {
    const mda = await extractFilingSection(cik, f.accession, f.primaryDoc,
      'Item\\s*2\\.?\\s*Management', 'Item\\s*3|Item\\s*4');
    if (mda && mda.length > 500) {
      mdas.push({ quarter: f.filed, filed: f.filed, text: mda.slice(0, 15000) }); // Cap at 15K chars
    }
  }

  return mdas;
}

// ============================================
// COMPETITOR IDENTIFICATION
// ============================================
function identifyCompetitors(ticker, sector, entryDate, sp500Data) {
  if (!sector || !sp500Data?.cases) return [];
  // Find companies in same sector from the systematic dataset
  const sameSector = sp500Data.cases.filter(c =>
    c.sector === sector && c.ticker !== ticker && c.entry_date === entryDate
  );
  // Sort by some heuristic — just take first 2-3 different tickers
  return sameSector.slice(0, 3).map(c => ({ ticker: c.ticker, cik: c.cik, company: c.company }));
}

// ============================================
// INSIDER TRANSACTIONS (from EDGAR Form 4)
// ============================================
async function getInsiderTransactions(cik, beforeDate) {
  // Use submissions API to find Form 4 filings
  try {
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const r = await edgarFetch(url);
    if (!r.ok) return [];
    const data = await r.json();
    const recent = data.filings?.recent;
    if (!recent) return [];

    const oneYearBefore = new Date(new Date(beforeDate).getTime() - 365 * 86400000).toISOString().slice(0, 10);
    let form4Count = 0;
    for (let i = 0; i < (recent.form?.length || 0); i++) {
      if (recent.form[i] === '4' && recent.filingDate[i] < beforeDate && recent.filingDate[i] >= oneYearBefore) {
        form4Count++;
      }
    }
    return { form4Count, period: `${oneYearBefore} to ${beforeDate}` };
  } catch { return { form4Count: 0, period: '' }; }
}

// ============================================
// MAIN PIPELINE
// ============================================
async function main() {
  console.log('AI Analyst Pipeline — Building data packages\n');

  // Load cases
  const deanonKey = loadJSON(resolve(AGENT_DIR, 'deanonymization-key.json'));
  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};
  const historicalSI = loadJSON(resolve(DATA_DIR, 'unconventional/historical-short-interest.json')) || {};

  // Load systematic datasets for returns and competitors
  const sysFiles = [
    'systematic-sp500-crosssection.json', 'systematic-sp500-crosssection-2013.json',
    'systematic-sp500-crosssection-2016.json', 'systematic-sp500-crosssection-2022.json',
  ];
  const sysDataByDate = {};
  for (const file of sysFiles) {
    const data = loadJSON(resolve(DATA_DIR, file));
    if (data?.cases) {
      const date = data.cases[0]?.entry_date;
      if (date) sysDataByDate[date] = data;
    }
  }

  // Build case list — 25 winners + 25 traps from 2018-2021 entries
  const allCases = [];
  for (const [id, info] of Object.entries(deanonKey.case_id_to_ticker)) {
    allCases.push({ case_id: id, ...info });
  }

  // Load outcomes
  const returnMap = {};
  for (const file of [...sysFiles, 'systematic-sp500-changes.json', 'systematic-multi-entry.json']) {
    const data = loadJSON(resolve(DATA_DIR, file));
    if (!data?.cases) continue;
    for (const c of data.cases) returnMap[`${c.ticker}|${c.entry_date}`] = c;
  }

  // Select cases: entry 2018-2021, balanced winners/traps
  const eligible = allCases.filter(c => {
    const y = parseInt(c.entry_date.slice(0, 4));
    if (y < 2018 || y > 2021) return false;
    const ret = returnMap[`${c.ticker}|${c.entry_date}`];
    if (!ret || (ret.outcome !== 'winner' && ret.outcome !== 'trap')) return false;
    const cik = ret.cik || cikCache[c.ticker]?.cik;
    if (!cik) return false;
    c.outcome = ret.outcome === 'winner' ? 1 : 0;
    c.cik = cik;
    c.sector = ret.sector;
    c.forward_return_3yr = ret.forward_return_3yr;
    c.sp500_return_3yr = ret.sp500_return_3yr;
    return true;
  });

  // Seed-based selection
  let seed = 2026;
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const winners = shuffle(eligible.filter(c => c.outcome === 1)).slice(0, 25);
  const traps = shuffle(eligible.filter(c => c.outcome === 0)).slice(0, 25);
  const selected = shuffle([...winners, ...traps]).slice(START, START + LIMIT);

  console.log(`  Eligible: ${eligible.length} (winners: ${eligible.filter(c=>c.outcome===1).length}, traps: ${eligible.filter(c=>c.outcome===0).length})`);
  console.log(`  Selected: ${selected.length} (${selected.filter(c=>c.outcome===1).length}W, ${selected.filter(c=>c.outcome===0).length}T)`);

  // Load existing results for resume
  const resultsFile = resolve(PIPELINE_DIR, 'pipeline-data.json');
  let results = loadJSON(resultsFile) || {};
  const answerKey = {};

  // Process each case
  let processed = 0;
  const coverage = { tenK: 0, priorTenK: 0, mda10Q: 0, competitors: 0, insiders: 0, si: 0 };

  for (let i = 0; i < selected.length; i++) {
    const c = selected[i];
    const blindId = `ANALYST-${String(i + 1 + START).padStart(4, '0')}`;

    answerKey[blindId] = {
      ticker: c.ticker, company: c.company, outcome: c.outcome,
      entry_date: c.entry_date, forward_return_3yr: c.forward_return_3yr,
      sp500_return_3yr: c.sp500_return_3yr, sector: c.sector,
    };

    if (results[blindId] && !VERIFY_ONLY) {
      console.log(`  ${blindId} (${c.ticker}): cached`);
      processed++;
      continue;
    }

    console.log(`  ${blindId} (${c.ticker}, entry ${c.entry_date})...`);

    const pkg = {
      blindId, sector: c.sector || 'Unknown', entryDate: c.entry_date,
      tenK: null, priorTenK: null, mdaQuarters: [], competitors: [],
      insiders: null, historicalSI: null, dateIntegrity: {},
    };

    // Historical short interest
    const si = historicalSI[c.case_id];
    if (si) {
      pkg.historicalSI = { days_to_cover: si.days_to_cover, si_date: si.si_date };
      coverage.si++;
    }

    // 10-K sections
    try {
      const sections = await get10KSections(c.cik, c.entry_date);
      if (sections?.current) {
        pkg.tenK = {
          filed: sections.current.filed,
          riskFactors: sections.current.riskFactors?.slice(0, 25000),
          mda: sections.current.mda?.slice(0, 25000),
        };
        pkg.dateIntegrity.tenK = sections.current.filed < c.entry_date;
        if (pkg.tenK.riskFactors) coverage.tenK++;
      }
      if (sections?.prior) {
        pkg.priorTenK = {
          filed: sections.prior.filed,
          riskFactors: sections.prior.riskFactors?.slice(0, 25000),
        };
        pkg.dateIntegrity.priorTenK = sections.prior.filed < c.entry_date;
        if (pkg.priorTenK.riskFactors) coverage.priorTenK++;
      }
    } catch (e) {
      console.log(`    10-K error: ${e.message?.slice(0, 60)}`);
    }

    // 10-Q MD&A (transcript substitute)
    try {
      const mdas = await get10QMDAs(c.cik, c.entry_date, 6);
      pkg.mdaQuarters = mdas.map(m => ({ quarter: m.quarter, filed: m.filed, text: m.text?.slice(0, 12000) }));
      pkg.dateIntegrity.mdaQuarters = mdas.every(m => m.filed < c.entry_date);
      if (mdas.length >= 2) coverage.mda10Q++;
    } catch (e) {
      console.log(`    10-Q error: ${e.message?.slice(0, 60)}`);
    }

    // Competitors
    const sysData = sysDataByDate[c.entry_date];
    if (sysData) {
      const comps = identifyCompetitors(c.ticker, c.sector, c.entry_date, sysData);
      for (const comp of comps.slice(0, 2)) {
        try {
          const compCik = comp.cik || cikCache[comp.ticker]?.cik;
          if (!compCik) continue;
          const sections = await get10KSections(compCik, c.entry_date);
          if (sections?.current?.mda) {
            pkg.competitors.push({
              blindLabel: `Competitor ${pkg.competitors.length + 1}`,
              mda: sections.current.mda?.slice(0, 10000),
              riskFactors: sections.current.riskFactors?.slice(0, 10000),
              filed: sections.current.filed,
            });
          }
        } catch {}
      }
      if (pkg.competitors.length > 0) coverage.competitors++;
    }

    // Insider transactions
    try {
      pkg.insiders = await getInsiderTransactions(c.cik, c.entry_date);
      if (pkg.insiders?.form4Count > 0) coverage.insiders++;
    } catch {}

    results[blindId] = pkg;
    processed++;

    // Save every 5 cases
    if (processed % 5 === 0) {
      writeFileSync(resultsFile, JSON.stringify(results, null, 2));
      writeFileSync(resolve(PIPELINE_DIR, 'answer-key.json'), JSON.stringify(answerKey, null, 2));
      console.log(`    [Saved ${processed}/${selected.length}]`);
    }
  }

  // Final save
  writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  writeFileSync(resolve(PIPELINE_DIR, 'answer-key.json'), JSON.stringify(answerKey, null, 2));

  // Coverage report
  console.log('\n=== PIPELINE COVERAGE REPORT ===');
  console.log(`  Total cases: ${Object.keys(results).length}`);
  console.log(`  10-K Risk Factors: ${coverage.tenK} (${(coverage.tenK/selected.length*100).toFixed(0)}%)`);
  console.log(`  Prior 10-K (for diff): ${coverage.priorTenK} (${(coverage.priorTenK/selected.length*100).toFixed(0)}%)`);
  console.log(`  10-Q MD&A (≥2 quarters): ${coverage.mda10Q} (${(coverage.mda10Q/selected.length*100).toFixed(0)}%)`);
  console.log(`  Competitors (≥1): ${coverage.competitors} (${(coverage.competitors/selected.length*100).toFixed(0)}%)`);
  console.log(`  Insider data: ${coverage.insiders} (${(coverage.insiders/selected.length*100).toFixed(0)}%)`);
  console.log(`  Historical SI: ${coverage.si} (${(coverage.si/selected.length*100).toFixed(0)}%)`);

  // Date integrity verification
  console.log('\n=== DATE INTEGRITY ===');
  let violations = 0;
  for (const [id, pkg] of Object.entries(results)) {
    for (const [key, clean] of Object.entries(pkg.dateIntegrity || {})) {
      if (clean === false) {
        violations++;
        console.log(`  VIOLATION: ${id} ${key}`);
      }
    }
  }
  console.log(`  Total violations: ${violations}`);

  // Verification sample
  console.log('\n=== VERIFICATION SAMPLE (first 10) ===');
  const entries = Object.entries(results).slice(0, 10);
  for (const [id, pkg] of entries) {
    const ak = answerKey[id];
    console.log(`  ${id} (${ak?.ticker}): entry=${pkg.entryDate}`);
    console.log(`    10-K: ${pkg.tenK ? 'filed ' + pkg.tenK.filed + ' (' + (pkg.tenK.riskFactors?.length || 0) + ' chars risk)' : 'NONE'} — before entry: ${pkg.dateIntegrity?.tenK ?? 'N/A'}`);
    console.log(`    Prior 10-K: ${pkg.priorTenK ? 'filed ' + pkg.priorTenK.filed : 'NONE'} — before entry: ${pkg.dateIntegrity?.priorTenK ?? 'N/A'}`);
    console.log(`    MD&A quarters: ${pkg.mdaQuarters?.length || 0} — all before entry: ${pkg.dateIntegrity?.mdaQuarters ?? 'N/A'}`);
    console.log(`    Competitors: ${pkg.competitors?.length || 0}`);
    console.log(`    Insider Form 4s: ${pkg.insiders?.form4Count || 0}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
