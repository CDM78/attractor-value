// Aggregator — combines EDGAR fundamentals with live market price to compute
// all framework ratios. Implements EDGAR → Finnhub fallback chain.
//
// This is the single source of truth for P/B, P/E, D/E, Current Ratio,
// and Earnings Yield. No pre-computed values are ever taken from third parties.

import { fetchCompanyFacts, parseEdgarToFinancials, computeDerivedRatios, getCik, delay } from './edgarXbrl.js';
import { getFinancialsReported, parseFinancialsReported, getBasicMetrics } from './finnhub.js';
import { upsertFinancials, upsertDataConfidence, updateMarketDataRatios } from '../db/queries.js';

/**
 * Fetch fundamentals for a ticker using EDGAR as primary, Finnhub as fallback.
 * Stores results in the financials and data_confidence tables.
 *
 * @returns {{ source: 'edgar'|'finnhub'|null, yearsStored: number }}
 */
export async function fetchAndStoreFundamentals(db, ticker, finnhubApiKey) {
  // Try EDGAR first
  const edgarResult = await tryEdgar(db, ticker);
  if (edgarResult.yearsStored > 0) {
    return { source: 'edgar', yearsStored: edgarResult.yearsStored };
  }

  // Fallback to Finnhub
  if (finnhubApiKey) {
    const finnhubResult = await tryFinnhub(db, ticker, finnhubApiKey);
    if (finnhubResult.yearsStored > 0) {
      return { source: 'finnhub', yearsStored: finnhubResult.yearsStored };
    }
  }

  return { source: null, yearsStored: 0 };
}

/**
 * Try fetching fundamentals from EDGAR.
 */
async function tryEdgar(db, ticker) {
  try {
    const cik = await getCik(db, ticker);
    if (!cik) return { yearsStored: 0, error: 'no_cik' };

    await delay(200); // SEC rate limit
    const facts = await fetchCompanyFacts(cik);
    if (!facts) return { yearsStored: 0, error: 'not_found' };

    const { financials, confidence } = parseEdgarToFinancials(ticker, facts);
    if (financials.length === 0) return { yearsStored: 0, error: 'no_data' };

    for (const fin of financials) await upsertFinancials(db, fin);
    for (const dc of confidence) await upsertDataConfidence(db, dc);

    return { yearsStored: financials.length };
  } catch (err) {
    console.warn(`EDGAR fallback for ${ticker}: ${err.message}`);
    return { yearsStored: 0, error: err.message };
  }
}

/**
 * Try fetching fundamentals from Finnhub (fallback).
 */
async function tryFinnhub(db, ticker, apiKey) {
  try {
    const reports = await getFinancialsReported(ticker, apiKey);
    const financials = parseFinancialsReported(ticker, reports);
    if (financials.length === 0) return { yearsStored: 0 };

    for (const fin of financials) await upsertFinancials(db, fin);

    // Record fallback in data_confidence
    const now = new Date().toISOString();
    await upsertDataConfidence(db, {
      ticker,
      fiscal_year: financials[0].fiscal_year,
      data_source: 'finnhub_fallback',
      filing_date: null,
      fetch_date: now,
      is_stale: 0,
      notes: 'EDGAR unavailable, fell back to Finnhub',
    });

    return { yearsStored: financials.length };
  } catch (err) {
    console.warn(`Finnhub fallback for ${ticker}: ${err.message}`);
    return { yearsStored: 0, error: err.message };
  }
}

/**
 * Compute and store derived ratios (P/E, P/B, earnings yield) from
 * the latest stored fundamentals + current market price.
 *
 * @returns {object|null} The computed ratios, or null if data missing.
 */
export async function computeAndStoreRatios(db, ticker) {
  const md = await db.prepare(
    'SELECT price FROM market_data WHERE ticker = ?'
  ).bind(ticker).first();
  if (!md?.price) return null;

  const latest = await db.prepare(
    'SELECT * FROM financials WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT 1'
  ).bind(ticker).first();
  if (!latest) return null;

  const ratios = computeDerivedRatios(md.price, latest);
  if (!ratios) return null;

  // Check data source to tag appropriately
  const dc = await db.prepare(
    'SELECT data_source FROM data_confidence WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT 1'
  ).bind(ticker).first();
  const source = dc?.data_source === 'finnhub_fallback' ? 'finnhub_computed' : 'edgar_computed';

  await updateMarketDataRatios(db, ticker, ratios, source);
  return ratios;
}

/**
 * Detect likely stock splits by comparing consecutive years' shares outstanding.
 * Returns an array of { year, priorShares, currentShares, likelyRatio } for any
 * year where shares jumped >50% without a corresponding equity increase.
 */
export function detectSplits(financials) {
  if (!financials || financials.length < 2) return [];

  // Sort ascending by fiscal year
  const sorted = [...financials]
    .filter(f => f.shares_outstanding > 0)
    .sort((a, b) => a.fiscal_year - b.fiscal_year);

  const detected = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const sharesRatio = curr.shares_outstanding / prev.shares_outstanding;

    // Shares jumped >50%
    if (sharesRatio > 1.5) {
      // Check if equity also jumped proportionally (secondary offering, not a split)
      const equityRatio = (curr.shareholder_equity && prev.shareholder_equity)
        ? curr.shareholder_equity / prev.shareholder_equity
        : 1;

      // If shares jumped but equity didn't (within 30%), it's likely a split
      if (equityRatio < sharesRatio * 0.7) {
        // Round to nearest clean ratio (2, 3, 4, 5, 10, 20)
        const cleanRatios = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 50];
        const bestRatio = cleanRatios.reduce((best, r) =>
          Math.abs(sharesRatio - r) < Math.abs(sharesRatio - best) ? r : best
        );

        // Only flag if reasonably close to a clean ratio (within 15%)
        if (Math.abs(sharesRatio - bestRatio) / bestRatio < 0.15) {
          detected.push({
            fiscal_year: curr.fiscal_year,
            prior_shares: prev.shares_outstanding,
            current_shares: curr.shares_outstanding,
            raw_ratio: Math.round(sharesRatio * 100) / 100,
            likely_ratio: bestRatio,
          });
        }
      }
    }
  }

  return detected;
}

/**
 * Full aggregation pipeline for a single ticker:
 * 1. Fetch fundamentals (EDGAR → Finnhub fallback)
 * 2. Detect any unrecorded splits
 * 3. Compute derived ratios from fundamentals + live price
 *
 * @returns {{ source, yearsStored, splits, ratios }}
 */
export async function aggregateTickerData(db, ticker, finnhubApiKey) {
  // Step 1: Fetch and store fundamentals
  const fundResult = await fetchAndStoreFundamentals(db, ticker, finnhubApiKey);

  // Step 2: Check for unrecorded splits
  const allFin = await db.prepare(
    'SELECT * FROM financials WHERE ticker = ? ORDER BY fiscal_year ASC'
  ).bind(ticker).all();
  const splits = detectSplits(allFin.results || []);
  if (splits.length > 0) {
    console.warn(`Split detection for ${ticker}:`, JSON.stringify(splits));
  }

  // Step 3: Compute ratios
  const ratios = await computeAndStoreRatios(db, ticker);

  return {
    source: fundResult.source,
    yearsStored: fundResult.yearsStored,
    detectedSplits: splits,
    ratios,
  };
}
