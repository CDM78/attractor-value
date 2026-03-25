#!/usr/bin/env node
// Pull historical short interest from FINRA API for all 1,656 cases.
// Data available from March 2018 onwards (bi-monthly: 15th and end-of-month).
//
// Usage: node scripts/pull-finra-short-interest.js [--limit N]

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { spearmanCorrelation, mean, median, stddev } from './lib/statistics.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const AGENT_DIR = resolve(DATA_DIR, 'agent');
const OUTPUT_FILE = resolve(DATA_DIR, 'unconventional/historical-short-interest.json');

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : 99999; })();

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C_ = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';
function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function fN(v, d = 4) { return v == null ? 'N/A' : v.toFixed(d); }
function fP(v, d = 1) { return v == null ? 'N/A' : (v * 100).toFixed(d) + '%'; }

// FINRA settlement dates: ~15th and ~last business day of each month
function getSettlementDatesBeforeEntry(entryDate) {
  const entry = new Date(entryDate);
  const dates = [];
  // Generate settlement dates going back 3 months
  for (let m = 0; m < 4; m++) {
    const d = new Date(entry);
    d.setMonth(d.getMonth() - m);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    // 15th of month
    dates.push(`${year}-${month}-15`);
    // Last business day (approximate as 28-31)
    const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();
    dates.push(`${year}-${month}-${lastDay}`);
  }
  // Filter to before or on entry date, sort descending
  return dates.filter(d => d <= entryDate).sort().reverse();
}

async function fetchShortInterest(ticker, settlementDate) {
  const body = JSON.stringify({
    compareFilters: [
      { fieldName: 'symbolCode', fieldValue: ticker, compareType: 'EQUAL' },
      { fieldName: 'settlementDate', fieldValue: settlementDate, compareType: 'EQUAL' }
    ],
    limit: 1
  });

  const r = await fetch('https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest', {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body
  });

  if (!r.ok) return null;
  const data = await r.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function main() {
  console.log(`${B}${C_}FINRA Historical Short Interest Pull${X}\n`);

  // Load cases
  const deanonKey = loadJSON(resolve(AGENT_DIR, 'deanonymization-key.json'));
  const cases = [];
  for (const [id, info] of Object.entries(deanonKey.case_id_to_ticker)) {
    cases.push({ case_id: id, ticker: info.ticker, entry_date: info.entry_date });
  }

  // Filter to cases where FINRA data may exist (entry >= 2018-03)
  const eligible = cases.filter(c => c.entry_date >= '2018-03-01');
  console.log(`  Total cases: ${cases.length}`);
  console.log(`  Eligible (entry >= 2018-03): ${eligible.length}`);
  console.log(`  Pre-2018 (no FINRA data): ${cases.length - eligible.length}`);

  // Load existing results for resume
  let results = loadJSON(OUTPUT_FILE) || {};
  const toFetch = eligible.filter(c => !results[c.case_id]).slice(0, LIMIT);
  console.log(`  Already fetched: ${Object.keys(results).length}`);
  console.log(`  To fetch: ${toFetch.length}\n`);

  // Deduplicate: group by ticker+entry_date to avoid redundant API calls
  const tickerDateMap = {}; // ticker|entry_date → [case_ids]
  for (const c of toFetch) {
    const key = `${c.ticker}|${c.entry_date}`;
    if (!tickerDateMap[key]) tickerDateMap[key] = { ticker: c.ticker, entry_date: c.entry_date, case_ids: [] };
    tickerDateMap[key].case_ids.push(c.case_id);
  }
  const uniqueQueries = Object.values(tickerDateMap);
  console.log(`  Unique ticker|date combinations: ${uniqueQueries.length}`);

  let found = 0, notFound = 0, errors = 0;
  for (let i = 0; i < uniqueQueries.length; i++) {
    const { ticker, entry_date, case_ids } = uniqueQueries[i];

    // Try settlement dates in order (most recent first)
    const candidates = getSettlementDatesBeforeEntry(entry_date);
    let siData = null;
    let siDate = null;

    for (const date of candidates) {
      if (date < '2018-03-01') break; // No FINRA data before this
      try {
        const data = await fetchShortInterest(ticker, date);
        if (data) {
          siData = data;
          siDate = date;
          break;
        }
      } catch {
        // Try next date
      }
      await new Promise(r => setTimeout(r, 150)); // Rate limit
    }

    if (siData) {
      const record = {
        ticker,
        entry_date,
        si_date: siDate,
        si_date_gap_days: Math.floor((new Date(entry_date) - new Date(siDate)) / 86400000),
        short_position: siData.currentShortPositionQuantity,
        prev_short_position: siData.previousShortPositionQuantity,
        avg_daily_volume: siData.averageDailyVolumeQuantity,
        days_to_cover: siData.daysToCoverQuantity,
        change_pct: siData.changePercent,
        market_class: siData.marketClassCode,
      };

      // Verify date integrity
      if (siDate > entry_date) {
        console.log(`  ${R}DATE VIOLATION: ${ticker} SI date ${siDate} > entry ${entry_date}${X}`);
        errors++;
        continue;
      }

      for (const caseId of case_ids) {
        results[caseId] = record;
      }
      found++;
    } else {
      notFound++;
    }

    // Save every 50 queries
    if ((i + 1) % 50 === 0 || i === uniqueQueries.length - 1) {
      writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      process.stdout.write(`\r  Progress: ${i + 1}/${uniqueQueries.length} (${G}${found}${X} found, ${Y}${notFound}${X} not found, ${R}${errors}${X} errors)`);
    }
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n\n  ${G}Pull complete.${X}`);
  console.log(`  Total records: ${Object.keys(results).length}`);

  // ===== COVERAGE REPORT =====
  console.log(`\n${B}COVERAGE REPORT${X}`);
  const allResults = Object.values(results);
  const within15 = allResults.filter(r => r.si_date_gap_days <= 15).length;
  const within30 = allResults.filter(r => r.si_date_gap_days <= 30).length;
  const over30 = allResults.filter(r => r.si_date_gap_days > 30).length;
  const maxGap = Math.max(...allResults.map(r => r.si_date_gap_days), 0);
  const meanGap = mean(allResults.map(r => r.si_date_gap_days));
  console.log(`  Cases with historical SI: ${allResults.length} / ${cases.length} (${fP(allResults.length / cases.length)})`);
  console.log(`  Within 15 days of entry: ${within15}`);
  console.log(`  Within 30 days: ${within30}`);
  console.log(`  Gap > 30 days: ${over30} (flagged)`);
  console.log(`  Max gap: ${maxGap} days, Mean gap: ${fN(meanGap, 1)} days`);
  console.log(`  Date integrity: All SI dates on or before entry: ${allResults.every(r => r.si_date <= r.entry_date) ? G + 'YES' : R + 'NO'}${X}`);

  // ===== QUICK VALIDATION =====
  console.log(`\n${B}QUICK VALIDATION${X}`);

  // Load outcomes
  const sysFiles = [
    'systematic-sp500-crosssection-2013.json', 'systematic-sp500-crosssection-2016.json',
    'systematic-sp500-crosssection.json', 'systematic-sp500-crosssection-2022.json',
    'systematic-sp500-changes.json', 'systematic-multi-entry.json',
  ];
  const returnMap = {};
  for (const file of sysFiles) {
    const data = loadJSON(resolve(DATA_DIR, file));
    if (!data?.cases) continue;
    for (const c of data.cases) {
      if (c.outcome === 'winner' || c.outcome === 'trap') {
        returnMap[`${c.ticker}|${c.entry_date}`] = { outcome: c.outcome === 'winner' ? 1 : 0, ret: c.forward_return_3yr };
      }
    }
  }

  // Match SI data with outcomes
  const matched = [];
  for (const [caseId, siRecord] of Object.entries(results)) {
    const outcomeKey = `${siRecord.ticker}|${siRecord.entry_date}`;
    const outcome = returnMap[outcomeKey];
    if (outcome && siRecord.days_to_cover != null) {
      matched.push({ ...siRecord, outcome: outcome.outcome, ret: outcome.ret });
    }
  }

  if (matched.length >= 20) {
    const vals = matched.map(m => m.days_to_cover);
    const outcomes = matched.map(m => m.outcome);
    const sp = spearmanCorrelation(vals, outcomes);
    const wDTC = matched.filter(m => m.outcome === 1).map(m => m.days_to_cover);
    const tDTC = matched.filter(m => m.outcome === 0).map(m => m.days_to_cover);

    console.log(`  Matched cases: ${matched.length}`);
    console.log(`  Days-to-cover vs outcome: r=${fN(sp?.rho, 3)}, p=${fN(sp?.p)}`);
    console.log(`  Winner mean DTC: ${fN(mean(wDTC), 2)}`);
    console.log(`  Trap mean DTC: ${fN(mean(tDTC), 2)}`);
    console.log(`  Direction: ${sp?.rho < 0 ? 'CORRECT (lower DTC = winners)' : sp?.rho > 0 ? 'REVERSED' : 'neutral'}`);

    // Also try short position normalized by volume
    const wRatio = matched.filter(m => m.outcome === 1 && m.avg_daily_volume > 0).map(m => m.short_position / m.avg_daily_volume);
    const tRatio = matched.filter(m => m.outcome === 0 && m.avg_daily_volume > 0).map(m => m.short_position / m.avg_daily_volume);
    if (wRatio.length > 10 && tRatio.length > 10) {
      const ratioVals = matched.filter(m => m.avg_daily_volume > 0).map(m => m.short_position / m.avg_daily_volume);
      const ratioOutcomes = matched.filter(m => m.avg_daily_volume > 0).map(m => m.outcome);
      const spRatio = spearmanCorrelation(ratioVals, ratioOutcomes);
      console.log(`\n  Short/Volume ratio vs outcome: r=${fN(spRatio?.rho, 3)}, p=${fN(spRatio?.p)}`);
      console.log(`  Winner mean SI/Vol: ${fN(mean(wRatio), 2)}`);
      console.log(`  Trap mean SI/Vol: ${fN(mean(tRatio), 2)}`);
    }

    console.log(`\n  Compare to current-snapshot SI (contaminated): r = 0.27-0.38`);
    console.log(`  Ratio (historical/current): ${sp?.rho ? fN(Math.abs(sp.rho) / 0.33, 2) : 'N/A'} — indicates how much signal was real vs look-ahead`);
  } else {
    console.log(`  Insufficient matched cases (${matched.length}) for validation.`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
