#!/usr/bin/env node

// Unit 1B: Build mid-cap cases with price returns and SI data.
// Pulls Yahoo price history for 4 cross-section dates and computes 3yr forward returns.
// Pulls FINRA SI data for SI signal computation.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const CAL = resolve(import.meta.dirname, '..');
const PRICES_DIR = join(CAL, 'midcap-prices');
const SI_DIR = join(CAL, 'midcap-si');
mkdirSync(PRICES_DIR, { recursive: true });
mkdirSync(SI_DIR, { recursive: true });

const CROSS_SECTIONS = [
  { date: '2016-03-31', label: '2016-Q1' },
  { date: '2018-12-31', label: '2018-Q4' },
  { date: '2020-09-30', label: '2020-Q3' },
  { date: '2022-03-31', label: '2022-Q1' },
];

// S&P 500 benchmark returns (approximate from known data)
const SP500_3YR = {
  '2016-03-31': 0.44,  // Mar 2016 → Mar 2019
  '2018-12-31': 0.58,  // Dec 2018 → Dec 2021
  '2020-09-30': 0.30,  // Sep 2020 → Sep 2023
  '2022-03-31': 0.28,  // Mar 2022 → Mar 2025
};

async function fetchPriceHistory(ticker) {
  const cachePath = join(PRICES_DIR, `${ticker}.json`);
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf-8'));

  const period1 = Math.floor(new Date('2015-01-01').getTime() / 1000);
  const period2 = Math.floor(new Date('2025-12-31').getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1d`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AV-Research)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    const prices = {};
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
        prices[date] = +closes[i].toFixed(2);
      }
    }

    writeFileSync(cachePath, JSON.stringify(prices));
    return prices;
  } catch { return null; }
}

function getClosestPrice(prices, targetDate, maxDaysDiff = 10) {
  if (!prices) return null;
  // Try exact date, then nearby dates
  for (let d = 0; d <= maxDaysDiff; d++) {
    for (const sign of [0, -1, 1]) {
      const dt = new Date(targetDate);
      dt.setDate(dt.getDate() + d * (sign || 1));
      const key = dt.toISOString().split('T')[0];
      if (prices[key]) return { price: prices[key], date: key };
    }
  }
  return null;
}

function addYears(dateStr, years) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split('T')[0];
}

async function fetchSISeries(ticker, entryDate) {
  const cachePath = join(SI_DIR, `${ticker}.json`);
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf-8'));

  // Use FINRA bulk API
  const endD = new Date(entryDate);
  const startD = new Date(endD);
  startD.setFullYear(startD.getFullYear() - 2);
  const startDate = startD < new Date('2018-03-15') ? '2018-03-15' : startD.toISOString().split('T')[0];

  const body = JSON.stringify({
    compareFilters: [{ fieldName: 'symbolCode', fieldValue: ticker, compareType: 'EQUAL' }],
    dateRangeFilters: [{ fieldName: 'settlementDate', startDate, endDate: entryDate }],
    limit: 200,
  });

  try {
    const res = await fetch('https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'AV-Research' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text.trim()) return [];
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];

    const series = data.map(d => ({
      date: d.settlementDate,
      short_position: d.currentShortPositionQuantity,
      avg_daily_volume: d.averageDailyVolumeQuantity,
      days_to_cover: d.daysToCoverQuantity,
    })).filter(s => s.short_position > 0).sort((a, b) => a.date.localeCompare(b.date));

    writeFileSync(cachePath, JSON.stringify(series));
    return series;
  } catch { return []; }
}

async function main() {
  console.log('Building mid-cap cases...\n');

  const universeData = JSON.parse(readFileSync(join(CAL, 'midcap-universe.json'), 'utf-8'));
  const companies = universeData.companies;
  console.log(`Mid-cap companies: ${companies.length}`);

  // Check EDGAR data availability per company
  const edgarDir = join(CAL, 'midcap-edgar-raw');
  const withEdgar = companies.filter(c => existsSync(join(edgarDir, `${c.ticker}.json`)));
  console.log(`With EDGAR data: ${withEdgar.length}`);

  // Pull prices and build cases
  const allCases = [];
  let priceOk = 0, priceFail = 0, siOk = 0;

  for (let i = 0; i < companies.length; i++) {
    const co = companies[i];
    const prices = await fetchPriceHistory(co.ticker);

    if (!prices) { priceFail++; continue; }
    priceOk++;

    for (const cs of CROSS_SECTIONS) {
      const entry = getClosestPrice(prices, cs.date);
      if (!entry) continue;

      const exit3yr = getClosestPrice(prices, addYears(cs.date, 3));
      if (!exit3yr) continue;

      const return3yr = (exit3yr.price - entry.price) / entry.price;
      const sp500Return = SP500_3YR[cs.date] || 0.35;
      const alpha = return3yr - sp500Return;

      let classification;
      if (return3yr > sp500Return + 0.20) classification = 'winner';
      else if (return3yr < 0) classification = 'trap';
      else if (return3yr < sp500Return - 0.10) classification = 'underperform';
      else classification = 'mixed';

      allCases.push({
        case_id: `MC-${co.ticker}-${cs.date}`,
        ticker: co.ticker,
        company_name: co.name,
        entry_date: cs.date,
        entry_price: entry.price,
        exit_price: exit3yr.price,
        forward_return_3yr: +return3yr.toFixed(4),
        sp500_return_3yr: sp500Return,
        alpha_3yr: +alpha.toFixed(4),
        classification,
        market_cap: co.market_cap,
        cross_section: cs.label,
      });
    }

    // Fetch SI for the latest cross-section date that qualifies
    if (cs => cs.date >= '2018-03-15') {
      const si = await fetchSISeries(co.ticker, '2022-03-31');
      if (si.length >= 6) siOk++;
    }

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`\r  [${i + 1}/${companies.length}] prices=${priceOk} cases=${allCases.length} si=${siOk}    `);
    }

    await new Promise(r => setTimeout(r, 30));
  }

  console.log(`\n\nPrices: ${priceOk} ok, ${priceFail} fail`);
  console.log(`Total cases: ${allCases.length}`);

  // Outcome distribution
  const outcomes = {};
  allCases.forEach(c => { outcomes[c.classification] = (outcomes[c.classification] || 0) + 1; });
  console.log('Outcomes:', outcomes);

  // Per cross-section
  for (const cs of CROSS_SECTIONS) {
    const csCases = allCases.filter(c => c.cross_section === cs.label);
    console.log(`  ${cs.label}: ${csCases.length} cases`);
  }

  // Save
  writeFileSync(join(CAL, 'midcap-cases.json'), JSON.stringify({
    generated: new Date().toISOString().split('T')[0],
    total: allCases.length,
    outcomes,
    cases: allCases,
  }, null, 2));

  writeFileSync(join(CAL, 'midcap-cases-ready.flag'), `ready ${new Date().toISOString()}`);
  console.log('\nSaved midcap-cases.json + flag');
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
