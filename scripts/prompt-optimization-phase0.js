#!/usr/bin/env node
// Phase 0: Data Collection for BUY/SELL Prompt Optimization
// Collects 10-K Item 1A risk factors, checkpoint data, and financial context
// for all eligible cases (2018-2021 entry, Tiers 5/7/8 with forward returns).
//
// Usage: node scripts/prompt-optimization-phase0.js [--start N] [--limit N] [--resume]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const OPT_DIR = resolve(DATA_DIR, 'prompt-optimization');
const CASES_DIR = resolve(OPT_DIR, 'cases');
mkdirSync(CASES_DIR, { recursive: true });

const args = process.argv.slice(2);
const START = (() => { const i = args.indexOf('--start'); return i >= 0 ? parseInt(args[i + 1]) : 0; })();
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : 999; })();
const RESUME = args.includes('--resume');

const UA = 'AV-Framework charles@bolinandtroy.com';
function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

let lastFetchTime = 0;
async function edgarFetch(url) {
  const now = Date.now();
  if (now - lastFetchTime < 150) await new Promise(r => setTimeout(r, 150 - (now - lastFetchTime)));
  lastFetchTime = Date.now();
  try {
    return fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    console.log(`  Fetch error: ${e.message?.slice(0, 80)}`);
    return { ok: false };
  }
}

// ============================================
// EDGAR FILING EXTRACTION (from ai-analyst-pipeline.js)
// ============================================
async function getFilingIndex(cik, formType, beforeDate, count = 5) {
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

async function extractRiskFactors(cik, accession, primaryDoc, maxChars = 30000) {
  const paddedCik = cik.replace(/^0+/, '');
  const accClean = accession.replace(/-/g, '');
  const url = `https://www.sec.gov/Archives/edgar/data/${paddedCik}/${accClean}/${primaryDoc}`;

  try {
    const r = await edgarFetch(url);
    if (!r.ok) return null;
    const html = await r.text();
    if (html.length < 1000) return null;

    const stripped = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');

    const sectionPattern = 'Item\\s*1A\\.?\\s*Risk\\s*Factors';
    const nextSectionPattern = 'Item\\s*1B|Item\\s*2\\.?\\s*Prop';
    const re = new RegExp(sectionPattern, 'gi');
    const matches = [];
    let m;
    while ((m = re.exec(stripped)) !== null) matches.push(m.index);
    if (matches.length === 0) return null;

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

// Get risk factors for a specific checkpoint date
async function getRiskFactorsForDate(cik, formType, beforeDate) {
  const filings = await getFilingIndex(cik, formType, beforeDate, 1);
  if (filings.length === 0) return null;
  const f = filings[0];
  const rf = await extractRiskFactors(cik, f.accession, f.primaryDoc);
  return rf ? { filed: f.filed, accession: f.accession, riskFactors: rf } : null;
}

// Get current + prior year risk factors before a date
async function getEntryRiskFactors(cik, beforeDate) {
  // Try 10-K first, then 20-F for international filers
  let filings = await getFilingIndex(cik, '10-K', beforeDate, 2);
  let formType = '10-K';
  if (filings.length === 0) {
    filings = await getFilingIndex(cik, '20-F', beforeDate, 2);
    formType = '20-F';
  }
  if (filings.length === 0) return { current: null, prior: null, formType };

  const result = { current: null, prior: null, formType };

  // Current (most recent before entry)
  const cur = filings[0];
  const curRF = await extractRiskFactors(cik, cur.accession, cur.primaryDoc);
  if (curRF) {
    result.current = { filed: cur.filed, accession: cur.accession, riskFactors: curRF };
  }

  // Prior year
  if (filings.length >= 2) {
    const prev = filings[1];
    const prevRF = await extractRiskFactors(cik, prev.accession, prev.primaryDoc);
    if (prevRF) {
      result.prior = { filed: prev.filed, accession: prev.accession, riskFactors: prevRF };
    }
  }

  return result;
}

// ============================================
// DATE HELPERS
// ============================================
function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('Phase 0: Data Collection for Prompt Optimization\n');

  // Load data sources
  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};
  const historicalSI = loadJSON(resolve(DATA_DIR, 'unconventional/historical-short-interest.json')) || {};

  // Load FRED credit spread data if available
  const fredData = loadJSON(resolve(DATA_DIR, 'fred-credit-spreads.json'));

  // ============================================
  // STEP 0A: SELECT ELIGIBLE CASES
  // ============================================
  console.log('=== STEP 0A: Selecting Cases ===\n');

  const tiers = [
    { file: resolve(DATA_DIR, 'tier5-sp500-expansion.json'), name: 'T5' },
    { file: resolve(DATA_DIR, 'tier7-adr-international.json'), name: 'T7' },
    { file: resolve(DATA_DIR, 'tier8-smallcap.json'), name: 'T8' },
  ];

  let allCases = [];
  for (const t of tiers) {
    const data = loadJSON(t.file);
    if (!data) continue;
    const cases = data.cases || data;
    for (const c of cases) {
      const entryDate = c.entry?.date || c.entry_date;
      if (!entryDate) continue;
      const year = parseInt(entryDate.substring(0, 4));
      if (year < 2018 || year > 2021) continue;
      const ret3 = c.forward_returns?.return_3yr;
      const sp3 = c.forward_returns?.sp500_return_3yr;
      if (ret3 === undefined || ret3 === null || sp3 === undefined || sp3 === null) continue;

      const ticker = c.ticker;
      const cikEntry = cikCache[ticker];
      if (!cikEntry) continue;

      const alpha = ret3 - sp3;
      allCases.push({
        case_id: c.case_id,
        ticker,
        company: c.company_name || c.company || ticker,
        tier: t.name,
        cik: cikEntry.cik,
        entry_date: entryDate,
        entry_year: year,
        entry_price: c.entry?.price || c.entry_price || null,
        sector: c.entry?.sector || c.sector || null,
        return_3yr: ret3,
        sp500_return_3yr: sp3,
        alpha,
        binary_outcome: alpha > 0 ? 'winner' : 'trap',
        revenue_at_entry: c.source?.revenue_at_entry || null,
      });
    }
  }

  // Deduplicate by ticker+entry_date
  const seen = new Set();
  allCases = allCases.filter(c => {
    const key = `${c.ticker}|${c.entry_date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const winners = allCases.filter(c => c.binary_outcome === 'winner');
  const traps = allCases.filter(c => c.binary_outcome === 'trap');

  console.log(`  Total eligible: ${allCases.length} (${winners.length} winners, ${traps.length} traps)`);
  console.log(`  By tier: T5=${allCases.filter(c=>c.tier==='T5').length}, T7=${allCases.filter(c=>c.tier==='T7').length}, T8=${allCases.filter(c=>c.tier==='T8').length}`);
  console.log(`  By year: ${JSON.stringify(allCases.reduce((a,c) => { a[c.entry_year]=(a[c.entry_year]||0)+1; return a; }, {}))}`);

  // Save case list
  writeFileSync(resolve(OPT_DIR, 'case-list-200.json'), JSON.stringify({
    total: allCases.length,
    winners: winners.length,
    traps: traps.length,
    cases: allCases,
  }, null, 2));
  console.log(`  Saved case list (${allCases.length} cases)\n`);

  // ============================================
  // STEP 0B: PULL REQUIRED DATA PER CASE
  // ============================================
  console.log('=== STEP 0B: Pulling EDGAR Data ===\n');

  const coverage = {
    entry_10k_current: 0,
    entry_10k_prior: 0,
    year1_10k: 0,
    year2_10k: 0,
    short_interest: 0,
    credit_spread: 0,
    complete: 0,
  };

  const casesToProcess = allCases.slice(START, START + LIMIT);
  let processed = 0;

  for (const c of casesToProcess) {
    const caseFile = resolve(CASES_DIR, `${c.case_id}.json`);

    // Skip if already processed and resuming
    if (RESUME && existsSync(caseFile)) {
      const existing = loadJSON(caseFile);
      if (existing?.entry_10k?.current?.riskFactors) coverage.entry_10k_current++;
      if (existing?.entry_10k?.prior?.riskFactors) coverage.entry_10k_prior++;
      if (existing?.year1_10k?.riskFactors) coverage.year1_10k++;
      if (existing?.year2_10k?.riskFactors) coverage.year2_10k++;
      if (existing?.short_interest) coverage.short_interest++;
      if (existing?.entry_10k?.current?.riskFactors && existing?.entry_10k?.prior?.riskFactors) coverage.complete++;
      processed++;
      console.log(`  ${c.case_id} (${c.ticker}): cached [${processed}/${casesToProcess.length}]`);
      continue;
    }

    console.log(`  ${c.case_id} (${c.ticker}, entry ${c.entry_date})...`);

    const caseData = {
      case_id: c.case_id,
      ticker: c.ticker,
      company: c.company,
      tier: c.tier,
      sector: c.sector,
      entry_date: c.entry_date,
      entry_price: c.entry_price,

      // EDGAR filing data
      entry_10k: { current: null, prior: null, formType: null },
      year1_10k: null,
      year2_10k: null,

      // Supplementary data
      short_interest: null,
      credit_spread: null,
      financials: {
        revenue_at_entry: c.revenue_at_entry,
      },

      // Outcome (for evaluation only)
      outcome: {
        return_3yr: c.return_3yr,
        sp500_return_3yr: c.sp500_return_3yr,
        alpha: c.alpha,
        binary: c.binary_outcome,
      },

      // Date integrity checks
      date_integrity: {},

      // Metadata
      collected_at: new Date().toISOString(),
    };

    // --- ENTRY 10-K (current + prior year) ---
    try {
      const entry10k = await getEntryRiskFactors(c.cik, c.entry_date);
      caseData.entry_10k.formType = entry10k.formType;

      if (entry10k.current) {
        caseData.entry_10k.current = {
          filed: entry10k.current.filed,
          riskFactors: entry10k.current.riskFactors,
          chars: entry10k.current.riskFactors?.length || 0,
        };
        caseData.date_integrity.entry_current = entry10k.current.filed < c.entry_date;
        coverage.entry_10k_current++;
      }

      if (entry10k.prior) {
        caseData.entry_10k.prior = {
          filed: entry10k.prior.filed,
          riskFactors: entry10k.prior.riskFactors,
          chars: entry10k.prior.riskFactors?.length || 0,
        };
        caseData.date_integrity.entry_prior = entry10k.prior.filed < c.entry_date;
        coverage.entry_10k_prior++;
      }
    } catch (e) {
      console.log(`    Entry 10-K error: ${e.message?.slice(0, 60)}`);
    }

    // --- YEAR 1 CHECKPOINT 10-K (entry + 12 months) ---
    const year1Date = addMonths(c.entry_date, 12);
    try {
      // Need to find the 10-K filed between entry and entry+12mo
      const formType = caseData.entry_10k.formType || '10-K';
      const y1 = await getRiskFactorsForDate(c.cik, formType, year1Date);
      if (y1 && y1.filed > c.entry_date) {
        // Must be a NEW filing after entry, not the same one used at entry
        caseData.year1_10k = {
          filed: y1.filed,
          riskFactors: y1.riskFactors,
          chars: y1.riskFactors?.length || 0,
        };
        caseData.date_integrity.year1 = y1.filed < year1Date && y1.filed > c.entry_date;
        coverage.year1_10k++;
      }
    } catch (e) {
      console.log(`    Year 1 10-K error: ${e.message?.slice(0, 60)}`);
    }

    // --- YEAR 2 CHECKPOINT 10-K (entry + 24 months) ---
    const year2Date = addMonths(c.entry_date, 24);
    try {
      const formType = caseData.entry_10k.formType || '10-K';
      const filings = await getFilingIndex(c.cik, formType, year2Date, 3);
      // Find a filing after year1Date but before year2Date
      const y2Filing = filings.find(f => f.filed > year1Date);
      if (y2Filing) {
        const rf = await extractRiskFactors(c.cik, y2Filing.accession, y2Filing.primaryDoc);
        if (rf) {
          caseData.year2_10k = {
            filed: y2Filing.filed,
            riskFactors: rf,
            chars: rf.length,
          };
          caseData.date_integrity.year2 = y2Filing.filed < year2Date && y2Filing.filed > year1Date;
          coverage.year2_10k++;
        }
      }
    } catch (e) {
      console.log(`    Year 2 10-K error: ${e.message?.slice(0, 60)}`);
    }

    // --- SHORT INTEREST ---
    const si = historicalSI[c.ticker] || historicalSI[c.case_id];
    if (si) {
      caseData.short_interest = si;
      coverage.short_interest++;
    }

    // --- COMPLETENESS CHECK ---
    const hasCurrentRF = !!caseData.entry_10k.current?.riskFactors;
    const hasPriorRF = !!caseData.entry_10k.prior?.riskFactors;
    if (hasCurrentRF && hasPriorRF) coverage.complete++;

    // Save case data
    writeFileSync(caseFile, JSON.stringify(caseData, null, 2));
    processed++;

    const status = [
      hasCurrentRF ? '10K' : 'no-10K',
      hasPriorRF ? 'prior' : 'no-prior',
      caseData.year1_10k ? 'Y1' : 'no-Y1',
      caseData.year2_10k ? 'Y2' : 'no-Y2',
    ].join(', ');
    console.log(`    ${status} [${processed}/${casesToProcess.length}]`);

    // Save progress every 10 cases
    if (processed % 10 === 0) {
      writeFileSync(resolve(OPT_DIR, 'phase0-progress.json'), JSON.stringify({
        processed,
        total: casesToProcess.length,
        coverage,
        last_case: c.case_id,
        timestamp: new Date().toISOString(),
      }, null, 2));
    }
  }

  // ============================================
  // STEP 0C: COVERAGE REPORT
  // ============================================
  console.log('\n=== STEP 0C: DATA COVERAGE ===\n');
  console.log(`  Entry 10-K (current):     ${coverage.entry_10k_current} / ${casesToProcess.length}`);
  console.log(`  Entry 10-K (prior year):  ${coverage.entry_10k_prior} / ${casesToProcess.length}`);
  console.log(`  Year 1 checkpoint 10-K:   ${coverage.year1_10k} / ${casesToProcess.length}`);
  console.log(`  Year 2 checkpoint 10-K:   ${coverage.year2_10k} / ${casesToProcess.length}`);
  console.log(`  FINRA short interest:     ${coverage.short_interest} / ${casesToProcess.length}`);
  console.log(`  Complete (both entry RFs): ${coverage.complete} / ${casesToProcess.length}`);

  // Save coverage report
  writeFileSync(resolve(OPT_DIR, 'coverage-report.json'), JSON.stringify(coverage, null, 2));

  // ============================================
  // STEP 0D: PARTITION THE DATA
  // ============================================
  if (START === 0) {
    console.log('\n=== STEP 0D: Partitioning Data ===\n');

    // Only partition cases with COMPLETE entry data (both current and prior 10-K)
    const completeCases = [];
    for (const c of allCases) {
      const caseFile = resolve(CASES_DIR, `${c.case_id}.json`);
      if (!existsSync(caseFile)) continue;
      const data = loadJSON(caseFile);
      if (!data?.entry_10k?.current?.riskFactors || !data?.entry_10k?.prior?.riskFactors) continue;
      completeCases.push({
        case_id: c.case_id,
        ticker: c.ticker,
        binary_outcome: c.binary_outcome,
        entry_year: c.entry_year,
        sector: c.sector,
        tier: c.tier,
      });
    }

    console.log(`  Complete cases for partitioning: ${completeCases.length}`);

    // Stratified partition: balance by outcome and entry_year
    const winnerCases = completeCases.filter(c => c.binary_outcome === 'winner');
    const trapCases = completeCases.filter(c => c.binary_outcome === 'trap');

    // Deterministic shuffle (seed = 2026)
    let seed = 2026;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };
    const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    const shuffledWinners = shuffle(winnerCases);
    const shuffledTraps = shuffle(trapCases);

    // 40% train, 30% validation, 30% holdout for each class
    function partition(arr) {
      const n = arr.length;
      const nTrain = Math.round(n * 0.4);
      const nVal = Math.round(n * 0.3);
      return {
        train: arr.slice(0, nTrain),
        validation: arr.slice(nTrain, nTrain + nVal),
        holdout: arr.slice(nTrain + nVal),
      };
    }

    const wParts = partition(shuffledWinners);
    const tParts = partition(shuffledTraps);

    const trainIds = [...wParts.train, ...tParts.train].map(c => c.case_id);
    const valIds = [...wParts.validation, ...tParts.validation].map(c => c.case_id);
    const holdoutIds = [...wParts.holdout, ...tParts.holdout].map(c => c.case_id);

    // Save partition assignments
    writeFileSync(resolve(OPT_DIR, 'partitions.json'), JSON.stringify({
      train: trainIds,
      validation: valIds,
      holdout: holdoutIds,
      stats: {
        train: { total: trainIds.length, winners: wParts.train.length, traps: tParts.train.length },
        validation: { total: valIds.length, winners: wParts.validation.length, traps: tParts.validation.length },
        holdout: { total: holdoutIds.length, winners: wParts.holdout.length, traps: tParts.holdout.length },
      },
    }, null, 2));

    // Save training cases with outcomes
    const trainCases = trainIds.map(id => {
      const c = allCases.find(x => x.case_id === id);
      return { case_id: id, ticker: c.ticker, binary_outcome: c.binary_outcome, entry_date: c.entry_date, sector: c.sector, return_3yr: c.return_3yr, sp500_return_3yr: c.sp500_return_3yr, alpha: c.alpha };
    });
    writeFileSync(resolve(OPT_DIR, 'training-cases.json'), JSON.stringify(trainCases, null, 2));

    // Save validation cases with outcomes
    const valCases = valIds.map(id => {
      const c = allCases.find(x => x.case_id === id);
      return { case_id: id, ticker: c.ticker, binary_outcome: c.binary_outcome, entry_date: c.entry_date, sector: c.sector, return_3yr: c.return_3yr, sp500_return_3yr: c.sp500_return_3yr, alpha: c.alpha };
    });
    writeFileSync(resolve(OPT_DIR, 'validation-cases.json'), JSON.stringify(valCases, null, 2));

    // Save holdout IDs only (NO outcomes)
    writeFileSync(resolve(OPT_DIR, 'holdout-case-ids.json'), JSON.stringify(holdoutIds, null, 2));

    console.log(`  Training set:   ${trainIds.length} cases (${wParts.train.length}W / ${tParts.train.length}T)`);
    console.log(`  Validation set: ${valIds.length} cases (${wParts.validation.length}W / ${tParts.validation.length}T)`);
    console.log(`  Holdout set:    ${holdoutIds.length} cases (${wParts.holdout.length}W / ${tParts.holdout.length}T)`);
  }

  // Final save
  writeFileSync(resolve(OPT_DIR, 'phase0-progress.json'), JSON.stringify({
    processed,
    total: casesToProcess.length,
    coverage,
    completed: true,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log('\nPhase 0 complete!');
}

main().catch(e => { console.error(e); process.exit(1); });
