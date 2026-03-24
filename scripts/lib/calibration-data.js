// Load and normalize all 292 calibration cases from the calibration tool's tier files.
// Handles schema differences between tier 1 (flat fields) and tiers 2-4 (nested entry object).

import { readFileSync } from 'fs';
import { resolve } from 'path';

const CAL_TOOL = resolve(import.meta.dirname, '../../../av-calibration-tool/data');

const TIER_FILES = [
  'tier1-stable-value.json',
  'tier2-crisis-dislocation.json',
  'tier3-emerging-dks.json',
  'tier4-regime-transition.json',
  'tier5-sp500-expansion.json',
];

const TIER_PIPELINES = {
  1: 'Stable Value',
  2: 'Crisis',
  3: 'Growth',
  4: 'Regime',
  5: 'SP500 Expansion',
};

// Convert "2016-Q1" → "2016-01-15", "2020-03-23" → "2020-03-23"
function normalizeDate(raw) {
  if (!raw) return null;
  const qMatch = raw.match(/^(\d{4})-Q(\d)$/);
  if (qMatch) {
    const month = String((parseInt(qMatch[2]) - 1) * 3 + 1).padStart(2, '0');
    return `${qMatch[1]}-${month}-15`;
  }
  // Already ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return raw;
}

function normalizeTier1Case(c) {
  return {
    ticker: c.ticker,
    company: c.company || c.company_name,
    outcome: c.outcome_class,
    entry_date: normalizeDate(c.entry_date),
    entry_price: c.entry_price,
    sector: c.sector,
    industry: c.industry,
    tier: 1,
    pipeline: TIER_PIPELINES[1],
  };
}

function normalizeTier234Case(c) {
  return {
    ticker: c.ticker,
    company: c.company_name,
    outcome: c.outcome,
    entry_date: normalizeDate(c.entry?.date),
    entry_price: c.entry?.price,
    sector: c.entry?.sector,
    industry: c.entry?.industry,
    tier: c.tier,
    pipeline: TIER_PIPELINES[c.tier],
  };
}

export function loadCalibrationCases() {
  const cases = [];
  const seen = new Set();

  for (const file of TIER_FILES) {
    const path = resolve(CAL_TOOL, file);
    let data;
    try {
      data = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (e) {
      console.warn(`Warning: Could not load ${file}: ${e.message}`);
      continue;
    }

    for (const c of data.cases || []) {
      const tier = c.tier || (file.includes('tier1') ? 1 : null);
      const normalized = tier === 1 ? normalizeTier1Case(c) : normalizeTier234Case(c);

      // Deduplicate by ticker+tier (same ticker can appear in multiple tiers)
      const key = `${normalized.ticker}-T${normalized.tier}`;
      if (seen.has(key)) continue;
      seen.add(key);

      cases.push(normalized);
    }
  }

  return cases;
}

// Get unique tickers across all cases
export function getUniqueTickers(cases) {
  return [...new Set(cases.map(c => c.ticker))];
}

// Group cases by outcome
export function groupByOutcome(cases) {
  const groups = { winner: [], trap: [], underperform: [], mixed: [] };
  for (const c of cases) {
    const key = c.outcome || 'unknown';
    if (groups[key]) groups[key].push(c);
  }
  return groups;
}

// Group cases by sector
export function groupBySector(cases) {
  const groups = {};
  for (const c of cases) {
    const s = c.sector || 'Unknown';
    if (!groups[s]) groups[s] = [];
    groups[s].push(c);
  }
  return groups;
}
