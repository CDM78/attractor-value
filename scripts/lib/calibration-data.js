// Load and normalize all calibration cases from tier files.
// Handles schema differences between tier 1 (flat fields) and tiers 2-4 (nested entry object),
// and tiers 7-9 (international, small-cap, fraud — flat fields with entry sub-object).

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Try calibration tool first, fall back to local data directory
const CAL_TOOL_EXT = resolve(import.meta.dirname, '../../../av-calibration-tool/data');
const CAL_TOOL_LOCAL = resolve(import.meta.dirname, '../../data');
const CAL_TOOL = existsSync(CAL_TOOL_EXT) ? CAL_TOOL_EXT : CAL_TOOL_LOCAL;

const TIER_FILES = [
  'tier1-stable-value.json',
  'tier2-crisis-dislocation.json',
  'tier3-emerging-dks.json',
  'tier4-regime-transition.json',
  'tier5-sp500-expansion.json',
  'tier6-multi-entry.json',
  'tier7-adr-international.json',
  'tier8-smallcap.json',
  'tier9-fraud.json',
];

const TIER_PIPELINES = {
  1: 'Stable Value',
  2: 'Crisis',
  3: 'Growth',
  4: 'Regime',
  5: 'SP500 Expansion',
  6: 'Multi-Entry',
  7: 'ADR/International',
  8: 'Small-Cap',
  9: 'Fraud/Failure',
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

function inferTierFromFile(file) {
  const m = file.match(/tier(\d+)/);
  return m ? parseInt(m[1]) : null;
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

// Universal normalizer — handles all tier formats
function normalizeCaseUniversal(c, tier) {
  if (tier === 1) return normalizeTier1Case(c);
  if (tier >= 7) {
    // Tiers 7-9: flat fields with optional entry sub-object
    return {
      ticker: c.ticker,
      company: c.company_name || c.company || c.ticker,
      outcome: c.outcome || c.outcome_class,
      entry_date: normalizeDate(c.entry?.date || c.entry_date),
      entry_price: c.entry?.price || c.entry_price || null,
      sector: c.entry?.sector || c.sector || null,
      industry: c.entry?.industry || c.industry || null,
      tier,
      pipeline: TIER_PIPELINES[tier] || `Tier ${tier}`,
    };
  }
  return normalizeTier234Case(c);
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
      const tier = c.tier || inferTierFromFile(file);
      const normalized = normalizeCaseUniversal(c, tier);

      // Deduplicate by ticker+tier+date (same ticker can appear in multiple tiers or with different entry dates)
      const key = `${normalized.ticker}-T${normalized.tier}-${normalized.entry_date || ''}`;
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
