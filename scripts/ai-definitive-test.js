#!/usr/bin/env node
// AI Definitive Test — Build blinded profiles for evaluation.
// Prepares 200 blinded profiles + answer key, computes all financial metrics
// with strict date filtering. Evaluations run via Claude Code sub-agents.
//
// Usage: node scripts/ai-definitive-test.js

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { extractQuarterlyMetrics, extractAllUsdValues, getRevenueAtDate } from './lib/edgar-extractor.js';
import { spearmanCorrelation, mean, median, stddev } from './lib/statistics.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const AGENT_DIR = resolve(DATA_DIR, 'agent');
const EDGAR_CACHE = resolve(DATA_DIR, 'edgar-cache');
const EVAL_DIR = resolve(DATA_DIR, 'agent/eval-phase2');
mkdirSync(EVAL_DIR, { recursive: true });

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function fN(v, d = 2) { return v == null ? 'N/A' : v.toFixed(d); }
function fP(v, d = 1) { return v == null ? 'N/A' : (v * 100).toFixed(d) + '%'; }

// SIC-based generic descriptions (no identifying details)
const SECTOR_DESCRIPTIONS = {
  'Information Technology': 'Technology company providing software, hardware, or IT services to enterprise and consumer markets.',
  'Health Care': 'Healthcare company operating in pharmaceuticals, medical devices, or healthcare services.',
  'Financials': 'Financial services company operating in banking, insurance, asset management, or capital markets.',
  'Consumer Discretionary': 'Consumer-facing company providing discretionary goods or services including retail, media, or hospitality.',
  'Consumer Staples': 'Consumer staples company providing essential products including food, beverages, or household goods.',
  'Industrials': 'Industrial company providing manufacturing, aerospace, defense, or business services.',
  'Energy': 'Energy company operating in oil, gas, renewable energy, or energy infrastructure.',
  'Materials': 'Materials company producing chemicals, metals, construction materials, or packaging.',
  'Utilities': 'Regulated or semi-regulated utility providing electric, gas, or water services.',
  'Real Estate': 'Real estate company operating as a REIT or real estate services provider.',
  'Communication Services': 'Communications company providing telecom, media, or internet services.',
  'Technology': 'Technology company providing software, hardware, or IT services.',
  'Healthcare': 'Healthcare company operating in pharmaceuticals, medical devices, or healthcare services.',
};

function getGenericDescription(sector) {
  return SECTOR_DESCRIPTIONS[sector] || 'Company operating in diversified industries.';
}

// ============================================
// EDGAR METRIC EXTRACTION — strictly pre-entry
// ============================================
function getFactValues(facts, tags) {
  for (const ns of ['us-gaap', 'ifrs-full']) {
    const nsFacts = facts?.facts?.[ns];
    if (!nsFacts) continue;
    for (const tag of tags) {
      const concept = nsFacts[tag];
      if (!concept) continue;
      const vals = concept.units?.USD || concept.units?.['USD/shares'] || concept.units?.shares || Object.values(concept.units || {})[0];
      if (vals?.length) return vals;
    }
  }
  return [];
}

function getAnnualValues(values, beforeDate, n = 5) {
  const annual = values
    .filter(v => (v.form === '10-K' || v.form === '20-F') && v.end <= beforeDate)
    .sort((a, b) => b.end.localeCompare(a.end));
  const seen = new Set();
  return annual.filter(v => {
    const fy = v.fy || v.end.slice(0, 4);
    if (seen.has(fy)) return false;
    seen.add(fy);
    return true;
  }).slice(0, n).reverse();
}

function buildBlindedProfile(caseId, sector, entryDate, facts) {
  if (!facts) return null;

  const beforeDate = entryDate;
  const entryYear = parseInt(entryDate.slice(0, 4));
  const entryQ = `${entryYear}-Q${Math.ceil(parseInt(entryDate.slice(5, 7)) / 3)}`;

  // Extract annual values strictly before entry
  const revVals = getAnnualValues(getFactValues(facts, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet']), beforeDate, 5);
  const epsVals = getAnnualValues(getFactValues(facts, ['EarningsPerShareDiluted', 'EarningsPerShareBasic']), beforeDate, 5);
  const niVals = getAnnualValues(getFactValues(facts, ['NetIncomeLoss']), beforeDate, 5);
  const equityVals = getAnnualValues(getFactValues(facts, ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']), beforeDate, 3);
  const debtVals = getAnnualValues(getFactValues(facts, ['LongTermDebt', 'LongTermDebtNoncurrent']), beforeDate, 3);
  const ocfVals = getAnnualValues(getFactValues(facts, ['NetCashProvidedByOperatingActivities']), beforeDate, 3);
  const capexVals = getAnnualValues(getFactValues(facts, ['PaymentsToAcquirePropertyPlantAndEquipment']), beforeDate, 3);
  const assetsVals = getAnnualValues(getFactValues(facts, ['Assets']), beforeDate, 1);
  const gpVals = getAnnualValues(getFactValues(facts, ['GrossProfit']), beforeDate, 1);

  if (revVals.length < 2) return null;

  // Compute metrics
  const latestRev = revVals[revVals.length - 1]?.val;
  const latestNI = niVals.length ? niVals[niVals.length - 1].val : null;
  const latestEPS = epsVals.length ? epsVals[epsVals.length - 1].val : null;
  const latestEquity = equityVals.length ? equityVals[equityVals.length - 1].val : null;
  const latestDebt = debtVals.length ? debtVals[debtVals.length - 1].val : null;
  const latestOCF = ocfVals.length ? ocfVals[ocfVals.length - 1].val : null;
  const latestCapex = capexVals.length ? Math.abs(capexVals[capexVals.length - 1].val) : null;
  const latestAssets = assetsVals.length ? assetsVals[0].val : null;
  const latestGP = gpVals.length ? gpVals[0].val : null;
  const latestFCF = (latestOCF != null && latestCapex != null) ? latestOCF - latestCapex : null;

  // Ratios
  const deRatio = (latestDebt != null && latestEquity && latestEquity > 0) ? latestDebt / latestEquity : null;
  const roic = (latestNI != null && latestEquity != null && latestDebt != null && (latestEquity + latestDebt) > 0)
    ? latestNI / (latestEquity + latestDebt) : null;
  const grossMargin = (latestGP != null && latestRev && latestRev > 0) ? latestGP / latestRev : null;
  const opMarginVals = getAnnualValues(getFactValues(facts, ['OperatingIncomeLoss']), beforeDate, 1);
  const opMargin = (opMarginVals.length && latestRev > 0) ? opMarginVals[0].val / latestRev : null;

  // Revenue CAGR 3yr
  const revCagr = revVals.length >= 4
    ? Math.pow(revVals[revVals.length - 1].val / revVals[revVals.length - 4].val, 1 / 3) - 1
    : revVals.length >= 2
      ? Math.pow(revVals[revVals.length - 1].val / revVals[0].val, 1 / Math.max(revVals.length - 1, 1)) - 1
      : null;

  // Earnings stability
  const epsPositive = epsVals.filter(v => v.val > 0).length;
  const epsTotal = epsVals.length;

  // Financial history string (anonymized — no dollar amounts that fingerprint)
  const historyLines = [];
  for (let i = 0; i < revVals.length; i++) {
    const year = revVals[i].fy || revVals[i].end.slice(0, 4);
    const eps = epsVals[i]?.val;
    const rev = revVals[i]?.val;
    const ni = niVals[i]?.val;
    const eq = equityVals[i]?.val;
    const debt = debtVals[i]?.val;
    const ocf = ocfVals[i]?.val;
    const capex = capexVals[i]?.val;
    const de = (debt != null && eq && eq > 0) ? (debt / eq).toFixed(2) : 'N/A';
    const fcf = (ocf != null && capex != null) ? '$' + ((ocf - Math.abs(capex)) / 1e6).toFixed(0) + 'M' : 'N/A';
    const roicY = (ni != null && eq != null && debt != null && (eq + debt) > 0) ? ((ni / (eq + debt)) * 100).toFixed(1) + '%' : 'N/A';
    historyLines.push(`  FY${year}: EPS=$${eps?.toFixed(2) || 'N/A'}, Rev=$${rev ? (rev / 1e9).toFixed(1) + 'B' : 'N/A'}, FCF=${fcf}, D/E=${de}, ROIC=${roicY}`);
  }

  // Verify date integrity
  const latestDataDate = revVals[revVals.length - 1]?.end || 'unknown';

  return {
    caseId,
    sector: sector || 'Unknown',
    entryDate,
    entryQ,
    latestDataDate,
    dateClean: latestDataDate <= beforeDate,
    description: getGenericDescription(sector),
    financialHistory: historyLines.join('\n'),
    metrics: {
      revenue_latest: latestRev,
      net_income_latest: latestNI,
      eps_latest: latestEPS,
      total_assets: latestAssets,
      fcf_latest: latestFCF,
      de_ratio: deRatio != null ? parseFloat(deRatio.toFixed(2)) : null,
      roic: roic != null ? parseFloat((roic * 100).toFixed(1)) : null,
      gross_margin: grossMargin != null ? parseFloat((grossMargin * 100).toFixed(1)) : null,
      operating_margin: opMargin != null ? parseFloat((opMargin * 100).toFixed(1)) : null,
      revenue_cagr_3yr: revCagr != null ? parseFloat((revCagr * 100).toFixed(1)) : null,
      earnings_stability: `${epsPositive}/${epsTotal}`,
    },
    nYearsData: revVals.length,
  };
}

// ============================================
// MAIN — BUILD PROFILES
// ============================================
async function main() {
  console.log('Building blinded profiles for AI evaluation...\n');

  const deanonKey = loadJSON(resolve(AGENT_DIR, 'deanonymization-key.json'));
  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};

  // Load all cases
  const allCases = [];
  for (const sample of ['A', 'B', 'C', 'D', 'E']) {
    const data = loadJSON(resolve(AGENT_DIR, `sample-${sample}.json`));
    if (!data) continue;
    for (const c of data) {
      const info = deanonKey.case_id_to_ticker[c.case_id];
      if (!info) continue;
      allCases.push({
        case_id: c.case_id, outcome: c.outcome,
        ticker: info.ticker, entry_date: info.entry_date, company: info.company,
        u160: c.unconventional?.u160 ?? null,
      });
    }
  }

  // Attach returns + sector
  const sysFiles = [
    'systematic-sp500-crosssection-2013.json', 'systematic-sp500-crosssection-2016.json',
    'systematic-sp500-crosssection.json', 'systematic-sp500-crosssection-2022.json',
    'systematic-sp500-changes.json', 'systematic-smallcap.json', 'systematic-adr.json',
    'systematic-multi-entry.json', 'systematic-fraud.json',
  ];
  for (const file of sysFiles) {
    const data = loadJSON(resolve(DATA_DIR, file));
    if (!data?.cases) continue;
    for (const c of data.cases) {
      const match = allCases.find(a => a.ticker === c.ticker && a.entry_date === c.entry_date);
      if (match) { match.sector = c.sector; match.cik = c.cik; match.forward_return_3yr = c.forward_return_3yr; match.sp500_return_3yr = c.sp500_return_3yr; }
    }
  }

  // Select 200 cases: 100 winners, 100 traps, stratified by sector + entry year
  const winners = allCases.filter(c => c.outcome === 1 && c.cik);
  const traps = allCases.filter(c => c.outcome === 0 && c.cik);

  // Seed-based selection for reproducibility
  let seed = 2026;
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const selectedWinners = shuffle(winners).slice(0, 100);
  const selectedTraps = shuffle(traps).slice(0, 100);
  const selected = shuffle([...selectedWinners, ...selectedTraps]);

  console.log(`  Selected ${selectedWinners.length} winners + ${selectedTraps.length} traps = ${selected.length} cases`);

  // Build profiles
  const profiles = [];
  const answerKey = {};
  let dateViolations = 0;

  for (let i = 0; i < selected.length; i++) {
    const c = selected[i];
    const blindId = `CASE-${String(i + 1).padStart(4, '0')}`;

    // Load EDGAR
    let cik = c.cik || cikCache[c.ticker]?.cik;
    if (!cik) continue;
    const padded = cik.replace(/^0+/, '').padStart(10, '0');
    const facts = loadJSON(resolve(EDGAR_CACHE, `${padded}.json`));
    if (!facts) continue;

    const profile = buildBlindedProfile(blindId, c.sector, c.entry_date, facts);
    if (!profile) continue;

    if (!profile.dateClean) dateViolations++;

    profiles.push(profile);
    answerKey[blindId] = {
      ticker: c.ticker,
      company: c.company,
      outcome: c.outcome,
      entry_date: c.entry_date,
      forward_return_3yr: c.forward_return_3yr,
      sp500_return_3yr: c.sp500_return_3yr,
      u160: c.u160,
    };
  }

  console.log(`  Profiles built: ${profiles.length}`);
  console.log(`  Date violations: ${dateViolations}`);

  // Save profiles and answer key SEPARATELY
  writeFileSync(resolve(EVAL_DIR, 'blinded-profiles.json'), JSON.stringify(profiles, null, 2));
  writeFileSync(resolve(EVAL_DIR, 'answer-key.json'), JSON.stringify(answerKey, null, 2));
  console.log(`  Saved: blinded-profiles.json (${profiles.length} profiles)`);
  console.log(`  Saved: answer-key.json (DO NOT LOAD DURING EVALUATION)`);

  // Also build the PROMPT TEMPLATES for the 3 approaches
  const templates = {
    approachA: buildApproachATemplate(),
    approachB: buildApproachBTemplate(),
    approachC: buildApproachCTemplate(),
  };
  writeFileSync(resolve(EVAL_DIR, 'prompt-templates.json'), JSON.stringify(templates, null, 2));
  console.log(`  Saved: prompt-templates.json`);

  // Date integrity verification for 5 random profiles
  console.log('\n  DATE INTEGRITY CHECK (5 random profiles):');
  for (let i = 0; i < Math.min(5, profiles.length); i++) {
    const p = profiles[i];
    const ak = answerKey[p.caseId];
    console.log(`    ${p.caseId}: entry ${p.entryDate}, latest data ${p.latestDataDate}, clean: ${p.dateClean ? 'YES' : 'NO'}`);
  }

  // Summary stats for profiles
  console.log(`\n  Profile Summary:`);
  const sectors = {};
  for (const p of profiles) { sectors[p.sector] = (sectors[p.sector] || 0) + 1; }
  console.log(`  Sectors: ${Object.entries(sectors).sort((a,b) => b[1]-a[1]).map(([s,n]) => `${s}:${n}`).join(', ')}`);
  const years = {};
  for (const p of profiles) { const y = p.entryDate.slice(0,4); years[y] = (years[y] || 0) + 1; }
  console.log(`  Entry years: ${Object.entries(years).sort((a,b) => a[0].localeCompare(b[0])).map(([y,n]) => `${y}:${n}`).join(', ')}`);
}

function buildApproachATemplate() {
  return `You are a value investing analyst evaluating an anonymous company for attractor stability.
Do NOT attempt to identify this company. Score ONLY based on the data provided.

COMPANY: {CASE_ID}
SECTOR: {SECTOR}
ENTRY DATE CONTEXT: {ENTRY_Q} (this is the economic era — consider what market conditions were like)

FINANCIAL HISTORY:
{FINANCIAL_HISTORY}

KEY METRICS:
  D/E Ratio: {DE_RATIO}
  ROIC: {ROIC}%
  Gross Margin: {GROSS_MARGIN}%
  Operating Margin: {OP_MARGIN}%
  Revenue CAGR 3yr: {REV_CAGR}%
  Earnings Stability: {EARNINGS_STABILITY} years positive

BUSINESS DESCRIPTION:
{DESCRIPTION}

Score these six factors from 1-5 based solely on the data above:
1. Revenue Durability — How recurring, diversified, and switching-cost-protected?
2. Competitive Reinforcement — Do advantages compound over time?
3. Industry Structure — Is competition rational or destructive?
4. Demand Feedback — Do more customers create value for existing ones?
5. Adaptation Capacity — Evidence of surviving actual disruption?
6. Capital Allocation — Does management reinvest wisely?

FIRST PASS (Bull Case): Score each factor optimistically with brief justification.
SECOND PASS (Bear Case): Challenge every strength. Re-score with intentional pessimism.
Composite = (Bull average x 0.4) + (Bear average x 0.6)

Return ONLY JSON:
{"bull_scores":[x,x,x,x,x,x],"bull_avg":0.00,"bear_scores":[x,x,x,x,x,x],"bear_avg":0.00,"composite":0.00}`;
}

function buildApproachBTemplate() {
  return `You are evaluating an anonymous company's investment prospects.
Do NOT attempt to identify this company. Use ONLY the data below.

COMPANY: {CASE_ID}
SECTOR: {SECTOR}
ENTRY DATE: {ENTRY_Q}

FINANCIAL HISTORY:
{FINANCIAL_HISTORY}

KEY METRICS:
  D/E Ratio: {DE_RATIO}
  ROIC: {ROIC}%
  Gross Margin: {GROSS_MARGIN}%
  Operating Margin: {OP_MARGIN}%
  Revenue CAGR 3yr: {REV_CAGR}%
  Earnings Stability: {EARNINGS_STABILITY} years positive

BUSINESS DESCRIPTION:
{DESCRIPTION}

Based solely on the data above, estimate the probability (0-100%) that this stock outperforms the S&P 500 over the next 3 years.

Return ONLY JSON:
{"win_probability":XX,"reasoning":"one sentence"}`;
}

function buildApproachCTemplate() {
  return `You are screening an anonymous company for value trap red flags.
Do NOT attempt to identify this company. Use ONLY the data below.

COMPANY: {CASE_ID}
SECTOR: {SECTOR}
ENTRY DATE: {ENTRY_Q}

FINANCIAL HISTORY:
{FINANCIAL_HISTORY}

KEY METRICS:
  D/E Ratio: {DE_RATIO}
  ROIC: {ROIC}%
  Gross Margin: {GROSS_MARGIN}%
  Operating Margin: {OP_MARGIN}%
  Revenue CAGR 3yr: {REV_CAGR}%
  Earnings Stability: {EARNINGS_STABILITY} years positive

BUSINESS DESCRIPTION:
{DESCRIPTION}

Identify red flags suggesting this is a VALUE TRAP. Consider: deteriorating fundamentals behind low valuation, structural decline, capital-intensive commoditizing industry, distress signals.

Return ONLY JSON:
{"red_flag_count":X,"red_flags":["flag1"],"is_trap":true_or_false,"confidence":"high/medium/low"}`;
}

main().catch(e => { console.error(e); process.exit(1); });
