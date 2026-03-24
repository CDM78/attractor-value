#!/usr/bin/env node
// Build unconventional data pools — Batch 2
// Pool 5: FDA Clinical Trials
// Pool 8: Executive Compensation (EDGAR DEF 14A)
// Pool 9: Customer Concentration (10-K text mining)
// Pool 12: Related Party Transactions (10-K text mining)
// Pool 13: GitHub Activity
// Pool 14: Wikipedia Page Views
//
// Usage: node scripts/build-pools-batch2.js --pool POOL [--limit N]
// Pools: fda, exec-comp, customer-conc, rpt, github, wikipedia, all

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadSystematicCases } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker } from './lib/edgar-fetcher.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const UNCONV_DIR = resolve(DATA_DIR, 'unconventional');
mkdirSync(UNCONV_DIR, { recursive: true });

const args = process.argv.slice(2);
const POOL = (() => { const i = args.indexOf('--pool'); return i >= 0 ? args[i + 1] : 'all'; })();
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : null; })();

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function mean(a) { return a.length ? a.reduce((s,v) => s+v, 0) / a.length : 0; }
function linSlope(a) {
  const n = a.length; if (n < 2) return 0;
  let sx=0,sy=0,sxy=0,sx2=0;
  for (let i=0;i<n;i++){sx+=i;sy+=a[i];sxy+=i*a[i];sx2+=i*i;}
  return (n*sx2-sx*sx) === 0 ? 0 : (n*sxy-sx*sy)/(n*sx2-sx*sx);
}

function getAllCases() {
  const cases = loadSystematicCases();
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) cases.push(...d.cases);
  }
  return cases;
}

function getUniqueTickers(cases) {
  const map = {};
  for (const c of cases) {
    if (!map[c.ticker]) map[c.ticker] = { company: c.company || c.ticker, sector: c.sector, entries: [] };
    if (c.entry_date) map[c.ticker].entries.push(c.entry_date);
  }
  return map;
}

const UA_EDGAR = 'AV-Framework charles@bolinandtroy.com';
const UA_BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';

async function rateLimitFetch(url, opts = {}, delayMs = 110) {
  await new Promise(r => setTimeout(r, delayMs));
  return fetch(url, opts);
}

// ============================================
// POOL 14: Wikipedia Page Views
// ============================================
async function buildWikipedia() {
  console.log(`\n${B}${C}Pool 14: Wikipedia Page Views${X}`);
  const cases = getAllCases();
  const tickers = getUniqueTickers(cases);
  const secMeta = loadJSON(resolve(UNCONV_DIR, 'sec-filing-metadata.json')) || {};

  const outPath = resolve(UNCONV_DIR, 'wikipedia-pageviews.json');
  let results = loadJSON(outPath) || {};
  const tickerList = Object.keys(tickers);
  const limit = LIMIT ? Math.min(LIMIT, tickerList.length) : tickerList.length;
  let ok = 0, failed = 0, skipped = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = tickerList[i];
    if (results[ticker]) { skipped++; continue; }

    const info = tickers[ticker];
    const entryDate = info.entries.sort()[0] || '2019-01-02';
    const end = new Date(entryDate);
    const start = new Date(end); start.setMonth(start.getMonth() - 24);

    // Try to find Wikipedia article name
    const companyName = secMeta[ticker]?.company_name || info.company;
    // Clean name for Wikipedia article format
    const wikiNames = [
      companyName.replace(/\s+(Inc\.?|Corp\.?|Co\.?|Ltd\.?|PLC|plc|LLC|LP)$/i, '').trim().replace(/\s+/g, '_'),
      companyName.replace(/\s/g, '_'),
      ticker,
    ];

    let monthlyViews = null;
    let matchedArticle = null;

    for (const name of wikiNames) {
      const startStr = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}01`;
      const endStr = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}01`;
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(name)}/monthly/${startStr}/${endStr}`;

      try {
        await new Promise(r => setTimeout(r, 100));
        const res = await fetch(url, { headers: { 'User-Agent': UA_BROWSER } });
        if (res.ok) {
          const data = await res.json();
          if (data.items && data.items.length > 0) {
            monthlyViews = data.items.map(item => ({ month: item.timestamp.slice(0, 6), views: item.views }));
            matchedArticle = name;
            break;
          }
        }
      } catch {}
    }

    if (!monthlyViews || monthlyViews.length < 3) {
      results[ticker] = { ticker, status: 'not_found', searched: wikiNames.slice(0, 2) };
      failed++;
    } else {
      const views = monthlyViews.map(m => m.views);
      const spikes = views.filter(v => v > mean(views) * 2).length;

      results[ticker] = {
        ticker, entry_date: entryDate,
        wikipedia_article: matchedArticle,
        match_quality: matchedArticle === wikiNames[0] ? 'exact' : 'variant',
        monthly_views_24mo: views,
        mean_monthly_views: Math.round(mean(views)),
        view_trend_slope: Math.round(linSlope(views)),
        max_monthly_views: Math.max(...views),
        attention_spike_count: spikes,
        status: 'ok',
      };
      ok++;
    }

    if ((i + 1) % 50 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${ok} ok, ${failed} no article, ${skipped} cached)...\r`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  const withData = Object.values(results).filter(r => r.status === 'ok').length;
  console.log(`\n  ${G}Wikipedia: ${withData}/${Object.keys(results).length} tickers with data${X}`);
}

// ============================================
// POOL 5: FDA Clinical Trials
// ============================================
async function buildFdaTrials() {
  console.log(`\n${B}${C}Pool 5: FDA Clinical Trials${X}`);
  const cases = getAllCases();
  const tickers = getUniqueTickers(cases);

  // Filter to healthcare/biotech only
  const healthTickers = Object.entries(tickers).filter(([t, info]) => {
    const sector = info.sector?.toLowerCase() || '';
    return sector.includes('health') || sector.includes('biotech') || sector.includes('pharma');
  });
  console.log(`  Healthcare/biotech tickers: ${healthTickers.length}`);

  const secMeta = loadJSON(resolve(UNCONV_DIR, 'sec-filing-metadata.json')) || {};
  const outPath = resolve(UNCONV_DIR, 'clinical-trials.json');
  let results = loadJSON(outPath) || {};
  const limit = LIMIT ? Math.min(LIMIT, healthTickers.length) : healthTickers.length;
  let ok = 0, failed = 0, skipped = 0;

  for (let i = 0; i < limit; i++) {
    const [ticker, info] = healthTickers[i];
    if (results[ticker]) { skipped++; continue; }

    const companyName = secMeta[ticker]?.company_name || info.company;
    const cleanName = companyName.replace(/\s+(Inc\.?|Corp\.?|Co\.?|Ltd\.?|PLC|plc|LLC|LP)$/i, '').trim();
    const entryDate = info.entries.sort()[0] || '2019-01-02';
    const startYear = parseInt(entryDate.slice(0, 4)) - 4;
    const startDate = `${startYear}${entryDate.slice(4)}`;

    try {
      await new Promise(r => setTimeout(r, 500));
      const url = `https://clinicaltrials.gov/api/v2/studies?query.spons=${encodeURIComponent(cleanName)}&filter.advanced=AREA[StartDate]RANGE[${startDate},${entryDate}]&pageSize=100`;
      const res = await fetch(url, { headers: { 'User-Agent': UA_BROWSER } });

      if (!res.ok) { failed++; results[ticker] = { ticker, status: 'api_error', code: res.status }; continue; }

      const data = await res.json();
      const studies = data.studies || [];

      if (studies.length === 0) {
        results[ticker] = { ticker, status: 'no_trials', searched: cleanName };
        failed++;
        continue;
      }

      const byPhase = {};
      const byStatus = {};
      const byYear = {};
      const conditions = new Set();

      for (const s of studies) {
        const phase = s.protocolSection?.designModule?.phases?.[0] || 'Not Applicable';
        byPhase[phase] = (byPhase[phase] || 0) + 1;

        const status = s.protocolSection?.statusModule?.overallStatus || 'Unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;

        const startD = s.protocolSection?.statusModule?.startDateStruct?.date;
        if (startD) { const y = startD.slice(0, 4); byYear[y] = (byYear[y] || 0) + 1; }

        const conds = s.protocolSection?.conditionsModule?.conditions || [];
        for (const c of conds) conditions.add(c);
      }

      const terminated = (byStatus['Terminated'] || 0) + (byStatus['Withdrawn'] || 0);
      const completed = byStatus['Completed'] || 0;

      results[ticker] = {
        ticker, entry_date: entryDate, status: 'ok',
        match_quality: 'exact', matched_name: cleanName,
        total_trials_4yr: studies.length,
        trials_by_phase: byPhase,
        trials_by_year: byYear,
        trials_by_status: byStatus,
        unique_conditions: conditions.size,
        phase3_count: byPhase['PHASE3'] || byPhase['Phase 3'] || 0,
        termination_rate: studies.length > 0 ? Math.round(terminated / studies.length * 1000) / 1000 : 0,
        completion_rate: studies.length > 0 ? Math.round(completed / studies.length * 1000) / 1000 : 0,
      };
      ok++;
    } catch (e) {
      results[ticker] = { ticker, status: 'error', error: e.message };
      failed++;
    }

    if ((i + 1) % 20 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${ok} ok, ${failed} failed, ${skipped} cached)...\r`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  const withData = Object.values(results).filter(r => r.status === 'ok').length;
  console.log(`\n  ${G}Clinical trials: ${withData}/${Object.keys(results).length} tickers with data${X}`);
}

// ============================================
// POOL 13: GitHub Activity
// ============================================
async function buildGithub() {
  console.log(`\n${B}${C}Pool 13: GitHub Activity${X}`);
  const cases = getAllCases();
  const tickers = getUniqueTickers(cases);

  // Filter to tech companies
  const techTickers = Object.entries(tickers).filter(([t, info]) => {
    const sector = info.sector?.toLowerCase() || '';
    return sector.includes('tech') || sector.includes('information') || sector.includes('software') || sector.includes('communication');
  });
  console.log(`  Tech tickers: ${techTickers.length}`);

  const secMeta = loadJSON(resolve(UNCONV_DIR, 'sec-filing-metadata.json')) || {};

  // Common GitHub org name mappings
  const ORG_MAP = {
    'MSFT': 'microsoft', 'GOOGL': 'google', 'GOOG': 'google', 'META': 'facebook',
    'AMZN': 'amzn', 'AAPL': 'apple', 'NFLX': 'netflix', 'CRM': 'salesforce',
    'ORCL': 'oracle', 'IBM': 'IBM', 'INTC': 'intel', 'AMD': 'amd',
    'NVDA': 'NVIDIA', 'ADBE': 'adobe', 'CSCO': 'cisco', 'UBER': 'uber',
    'LYFT': 'lyft', 'SQ': 'square', 'SHOP': 'Shopify', 'TWLO': 'twilio',
    'SNAP': 'Snapchat', 'PINS': 'pinterest', 'SPOT': 'spotify',
    'CRWD': 'CrowdStrike', 'PANW': 'PaloAltoNetworks', 'ZS': 'zscaler',
    'NET': 'cloudflare', 'DDOG': 'DataDog', 'MDB': 'mongodb',
    'SNOW': 'snowflakedb', 'PLTR': 'palantir', 'COIN': 'coinbase',
    'RBLX': 'Roblox', 'U': 'Unity-Technologies', 'TTD': 'nicholasblaskey',
  };

  const outPath = resolve(UNCONV_DIR, 'github-activity.json');
  let results = loadJSON(outPath) || {};
  const limit = LIMIT ? Math.min(LIMIT, techTickers.length) : techTickers.length;
  let ok = 0, failed = 0, skipped = 0;

  for (let i = 0; i < limit; i++) {
    const [ticker, info] = techTickers[i];
    if (results[ticker]) { skipped++; continue; }

    const orgName = ORG_MAP[ticker] || info.company.replace(/\s+(Inc\.?|Corp\.?|Co\.?|Ltd\.?)$/i, '').trim().replace(/\s+/g, '-').toLowerCase();

    try {
      await new Promise(r => setTimeout(r, 1200)); // GitHub unauthenticated: 60/hr
      const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(orgName)}`, {
        headers: { 'User-Agent': UA_BROWSER, Accept: 'application/vnd.github.v3+json' },
      });

      if (res.status === 404) {
        results[ticker] = { ticker, status: 'not_found', searched: orgName };
        failed++;
        continue;
      }
      if (res.status === 403) {
        console.log(`\n  ${Y}Rate limited at ${i}/${limit} — saving progress${X}`);
        writeFileSync(outPath, JSON.stringify(results, null, 2));
        break;
      }
      if (!res.ok) { failed++; continue; }

      const org = await res.json();

      results[ticker] = {
        ticker, status: 'ok',
        github_org: orgName,
        match_quality: ORG_MAP[ticker] ? 'mapped' : 'inferred',
        public_repos: org.public_repos || 0,
        followers: org.followers || 0,
        company_name: org.name || orgName,
        blog: org.blog || null,
        created_at: org.created_at,
      };
      ok++;
    } catch { failed++; }

    if ((i + 1) % 20 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${ok} ok, ${failed} failed, ${skipped} cached)...\r`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  const withData = Object.values(results).filter(r => r.status === 'ok').length;
  console.log(`\n  ${G}GitHub: ${withData}/${Object.keys(results).length} orgs with data${X}`);
}

// ============================================
// POOL 9: Customer Concentration (10-K text mining)
// ============================================
async function buildCustomerConcentration() {
  console.log(`\n${B}${C}Pool 9: Customer Concentration (10-K text mining)${X}`);
  const cases = getAllCases();
  const tickers = getUniqueTickers(cases);
  await ensureCikCache();

  const outPath = resolve(UNCONV_DIR, 'customer-concentration.json');
  let results = loadJSON(outPath) || {};
  const tickerList = Object.keys(tickers);
  const limit = LIMIT ? Math.min(LIMIT, tickerList.length) : tickerList.length;
  let ok = 0, failed = 0, skipped = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = tickerList[i];
    if (results[ticker]) { skipped++; continue; }

    const cik = getCikForTicker(ticker);
    if (!cik) { results[ticker] = { ticker, status: 'no_cik' }; failed++; continue; }

    const info = tickers[ticker];
    const entryDate = info.entries.sort()[0] || '2019-01-02';

    try {
      // Search EDGAR EFTS for latest 10-K before entry date
      await new Promise(r => setTimeout(r, 120));
      const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22concentration%22&dateRange=custom&startdt=${parseInt(entryDate.slice(0,4))-2}-01-01&enddt=${entryDate}&forms=10-K&entities=CIK${cik}`;
      const res = await fetch(searchUrl, { headers: { 'User-Agent': UA_EDGAR, Accept: 'application/json' } });

      if (!res.ok) { failed++; results[ticker] = { ticker, status: 'search_failed' }; continue; }

      const data = await res.json();
      const hits = data.hits?.hits || [];

      if (hits.length === 0) {
        // Try without "concentration" keyword — just check if 10-K exists
        results[ticker] = {
          ticker, entry_date: entryDate, status: 'no_concentration_mention',
          concentration_disclosed: false,
          parsing_confidence: 'low',
        };
        ok++;
        continue;
      }

      // Found 10-K mentioning "concentration"
      const latestHit = hits[0];
      const filingDate = latestHit._source?.file_date;

      // Try to get a snippet with concentration info
      const highlight = latestHit.highlight?.file_description?.[0] || '';
      const fullText = latestHit._source?.file_description || '';

      // Parse for percentage patterns
      const pctMatches = (highlight + ' ' + fullText).match(/(\d{1,3})%?\s*(?:of\s+(?:our\s+)?(?:total\s+)?(?:revenue|net\s+sales|net\s+revenue))/gi) || [];
      const percentages = pctMatches.map(m => {
        const n = m.match(/(\d{1,3})/);
        return n ? parseInt(n[1]) : null;
      }).filter(n => n != null && n >= 10 && n <= 100);

      const noConc = /no\s+(?:single\s+)?customer\s+(?:represented|accounted|exceeded)\s+(?:more\s+than\s+)?10%/i.test(highlight + fullText);

      results[ticker] = {
        ticker, entry_date: entryDate, status: 'ok',
        concentration_disclosed: percentages.length > 0 || noConc,
        largest_customer_pct: percentages.length > 0 ? Math.max(...percentages) : null,
        customers_above_10pct: percentages.length,
        no_concentration_statement: noConc,
        concentration_mentions: hits.length,
        filing_date: filingDate,
        parsing_confidence: percentages.length > 0 ? 'high' : noConc ? 'medium' : 'low',
      };
      ok++;
    } catch (e) {
      results[ticker] = { ticker, status: 'error', error: e.message };
      failed++;
    }

    if ((i + 1) % 50 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${ok} ok, ${failed} failed, ${skipped} cached)...\r`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  const withData = Object.values(results).filter(r => r.status === 'ok').length;
  console.log(`\n  ${G}Customer concentration: ${withData}/${Object.keys(results).length} tickers${X}`);
}

// ============================================
// POOL 2: Federal Contracts (USAspending.gov)
// ============================================
async function buildFederalContracts() {
  console.log(`\n${B}${C}Pool 2: Federal Contracts (USAspending.gov)${X}`);
  const cases = getAllCases();
  const tickers = getUniqueTickers(cases);
  const secMeta = loadJSON(resolve(UNCONV_DIR, 'sec-filing-metadata.json')) || {};

  const outPath = resolve(UNCONV_DIR, 'federal-contracts.json');
  let results = loadJSON(outPath) || {};
  const tickerList = Object.keys(tickers);
  const limit = LIMIT ? Math.min(LIMIT, tickerList.length) : tickerList.length;
  let ok = 0, failed = 0, skipped = 0, noData = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = tickerList[i];
    if (results[ticker]) { skipped++; continue; }

    const info = tickers[ticker];
    const companyName = secMeta[ticker]?.company_name || info.company;
    const cleanName = companyName.replace(/\s+(Inc\.?|Corp\.?|Co\.?|Ltd\.?|PLC|plc|LLC|LP)$/i, '').trim();
    const entryDate = info.entries.sort()[0] || '2019-01-02';
    const startYear = parseInt(entryDate.slice(0, 4)) - 4;
    const startDate = `${startYear}${entryDate.slice(4)}`;

    try {
      await new Promise(r => setTimeout(r, 500));
      const body = {
        filters: {
          recipient_search_text: [cleanName],
          time_period: [{ start_date: startDate, end_date: entryDate }],
          award_type_codes: ['A', 'B', 'C', 'D'],
        },
        limit: 1,
        page: 1,
      };

      const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA_BROWSER },
        body: JSON.stringify(body),
      });

      if (!res.ok) { failed++; results[ticker] = { ticker, status: 'api_error', code: res.status }; continue; }

      const data = await res.json();
      const totalCount = data.page_metadata?.total || 0;

      if (totalCount === 0) {
        results[ticker] = { ticker, status: 'no_contracts', searched: cleanName };
        noData++;
        continue;
      }

      // Get summary stats — fetch with aggregation
      await new Promise(r => setTimeout(r, 500));
      const summaryBody = {
        filters: {
          recipient_search_text: [cleanName],
          time_period: [{ start_date: startDate, end_date: entryDate }],
          award_type_codes: ['A', 'B', 'C', 'D'],
        },
        category: 'awarding_agency',
        limit: 10,
      };

      const summaryRes = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA_BROWSER },
        body: JSON.stringify(summaryBody),
      });

      let agencies = [];
      let totalValue = 0;
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        agencies = (summaryData.results || []).map(r => ({
          name: r.name, amount: r.amount,
        }));
        totalValue = agencies.reduce((s, a) => s + (a.amount || 0), 0);
      }

      results[ticker] = {
        ticker, entry_date: entryDate, status: 'ok',
        match_quality: 'partial', searched: cleanName,
        contract_count_4yr: totalCount,
        total_contract_value_4yr: Math.round(totalValue),
        unique_agencies: agencies.length,
        top_agencies: agencies.slice(0, 5),
      };
      ok++;
    } catch (e) {
      results[ticker] = { ticker, status: 'error', error: e.message };
      failed++;
    }

    if ((i + 1) % 30 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${ok} with contracts, ${noData} none, ${failed} failed, ${skipped} cached)...\r`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  const withData = Object.values(results).filter(r => r.status === 'ok').length;
  console.log(`\n  ${G}Federal contracts: ${withData}/${Object.keys(results).length} tickers with data${X}`);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${B}Build Data Pools — Batch 2${X}`);
  console.log('='.repeat(60));

  await ensureCikCache();

  if (POOL === 'wikipedia' || POOL === 'all') await buildWikipedia();
  if (POOL === 'fda' || POOL === 'all') await buildFdaTrials();
  if (POOL === 'github' || POOL === 'all') await buildGithub();
  if (POOL === 'customer-conc' || POOL === 'all') await buildCustomerConcentration();
  if (POOL === 'federal' || POOL === 'all') await buildFederalContracts();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
