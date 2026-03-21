// Unified Signal Engine — BUY / NOT_YET / PASS
// Computes signals for all candidates regardless of discovery tier.
// The system makes the decision; the user executes.

import { calculateGrahamValuation, calculateTier3Valuation, calculateTier4Valuation } from './valuationEngine.js';
import { getFinancialsForTicker, getPortfolioConfig, logSignalChange } from '../db/queries.js';

/**
 * Compute signal for a single candidate.
 * Runs the tier-appropriate valuation model and produces BUY/NOT_YET/PASS.
 */
export async function computeSignal(db, candidate, env) {
  const ticker = candidate.ticker;
  const attractorScore = candidate.attractor_score;

  // Hard reject: attractor too weak
  if (attractorScore != null && attractorScore < 2.0) {
    return {
      signal: 'PASS',
      confidence: null,
      reason: `Attractor dissolving (${attractorScore})`,
      color: 'red',
    };
  }

  if (attractorScore != null && attractorScore < 2.5) {
    return {
      signal: 'PASS',
      confidence: null,
      reason: `Attractor too weak (${attractorScore})`,
      color: 'red',
    };
  }

  // Get current price and financials
  const marketData = await db.prepare(
    'SELECT * FROM market_data WHERE ticker = ?'
  ).bind(ticker).first();

  if (!marketData?.price) {
    return { signal: 'PASS', confidence: null, reason: 'No price data', color: 'grey' };
  }

  const financials = await getFinancialsForTicker(db, ticker);

  // Get shares from stocks table: Finnhub direct, or compute from market_cap / price
  const stockRow = await db.prepare(
    'SELECT shares_outstanding_m, market_cap FROM stocks WHERE ticker = ?'
  ).bind(ticker).first();
  let finnhubSharesM = stockRow?.shares_outstanding_m || null;
  // Fallback: market_cap (millions) / price gives shares in millions
  if (!finnhubSharesM && stockRow?.market_cap > 0 && marketData?.price > 0) {
    finnhubSharesM = stockRow.market_cap / marketData.price;
  }

  // Get economic environment
  let economicEnvironment = 'NORMAL';
  try {
    const cached = await db.prepare(
      "SELECT price FROM market_data WHERE ticker = '__FRED_VIXCLS'"
    ).first();
    // Simplified: check VIX as quick proxy
    if (cached?.price > 30) economicEnvironment = 'STRESSED';
    else if (cached?.price > 25) economicEnvironment = 'CAUTIOUS';
  } catch { /* default NORMAL */ }

  // Run tier-appropriate valuation
  let valuation = null;

  if (candidate.discovery_tier === 'tier2') {
    // Tier 2: Graham formula (established companies in crisis)
    const bondRow = await db.prepare(
      "SELECT price FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
    ).first();
    const aaaBondYield = bondRow?.price || 4.5;

    valuation = calculateGrahamValuation(
      financials, marketData, aaaBondYield,
      { attractor_stability_score: attractorScore },
      null, economicEnvironment
    );

    if (valuation) valuation.valuation_method = 'graham';
  }

  if (candidate.discovery_tier === 'tier3') {
    // Tier 3: Growth-adjusted revenue model
    valuation = calculateTier3Valuation(
      candidate, financials, marketData, attractorScore, economicEnvironment, finnhubSharesM
    );
  }

  if (candidate.discovery_tier === 'tier4') {
    // Tier 4: Scenario-weighted model
    let regime = null;
    if (candidate.regime_id) {
      regime = await db.prepare(
        'SELECT * FROM regime_registry WHERE id = ?'
      ).bind(candidate.regime_id).first();
    }
    valuation = calculateTier4Valuation(
      candidate, financials, marketData, regime, attractorScore, economicEnvironment, finnhubSharesM
    );
  }

  if (!valuation) {
    return { signal: 'PASS', confidence: null, reason: 'Cannot compute valuation', color: 'grey' };
  }

  // Determine signal from price vs buy-below vs IV
  const price = marketData.price;
  const buyBelow = valuation.buy_below_price;
  const iv = valuation.intrinsic_value;

  if (price <= buyBelow) {
    const discountPct = ((1 - price / iv) * 100).toFixed(0);
    const confidence = price <= buyBelow * 0.90 ? 'STRONG' : 'STANDARD';
    return {
      signal: 'BUY',
      confidence,
      reason: `${discountPct}% below intrinsic value`,
      color: 'green',
      valuation,
      price,
    };
  }

  if (price <= iv) {
    const neededDecline = (((price - buyBelow) / price) * 100).toFixed(1);
    return {
      signal: 'NOT_YET',
      confidence: null,
      reason: `Undervalued but needs ${neededDecline}% more decline`,
      color: 'amber',
      target_price: buyBelow,
      valuation,
      price,
    };
  }

  return {
    signal: 'PASS',
    confidence: null,
    reason: 'Overvalued',
    color: 'grey',
    valuation,
    price,
  };
}

/**
 * Update signals for all active candidates.
 * Called daily after price refresh.
 */
export async function refreshAllSignals(db, env) {
  const result = await db.prepare(
    "SELECT * FROM candidates WHERE status = 'active' AND attractor_score IS NOT NULL AND attractor_score >= 2.5"
  ).all();

  const candidates = result.results || [];
  let updated = 0;
  const signals = { BUY: 0, NOT_YET: 0, PASS: 0 };

  for (const candidate of candidates) {
    try {
      const signalResult = await computeSignal(db, candidate, env);

      // Log signal change if it changed
      if (candidate.signal !== signalResult.signal || candidate.attractor_score !== signalResult.attractor_score) {
        try {
          await logSignalChange(db, candidate.id, candidate.ticker,
            { signal: candidate.signal, attractor_score: candidate.attractor_score, analysis_model: candidate.analysis_model },
            { signal: signalResult.signal, attractor_score: candidate.attractor_score, analysis_model: candidate.analysis_model },
            'daily price update'
          );
        } catch { /* ignore logging failures */ }
      }

      await db.prepare(`
        UPDATE candidates SET
          signal = ?,
          signal_confidence = ?,
          signal_reason = ?,
          intrinsic_value = ?,
          buy_below_price = ?,
          margin_of_safety = ?,
          valuation_method = ?,
          valuation_date = datetime('now')
        WHERE id = ?
      `).bind(
        signalResult.signal,
        signalResult.confidence,
        signalResult.reason,
        signalResult.valuation?.intrinsic_value ?? null,
        signalResult.valuation?.buy_below_price ?? null,
        signalResult.valuation?.margin_of_safety ?? null,
        signalResult.valuation?.valuation_method ?? null,
        candidate.id
      ).run();

      signals[signalResult.signal] = (signals[signalResult.signal] || 0) + 1;
      updated++;
    } catch (err) {
      console.error(`Signal refresh failed for ${candidate.ticker}:`, err.message);
    }
  }

  return { updated, signals, total_candidates: candidates.length };
}

/**
 * Get all current signals for display.
 */
export async function getCurrentSignals(db) {
  const buyResult = await db.prepare(`
    SELECT c.*, s.company_name, s.sector, md.price as current_price
    FROM candidates c
    JOIN stocks s ON c.ticker = s.ticker
    LEFT JOIN market_data md ON c.ticker = md.ticker
    WHERE c.signal = 'BUY' AND c.status = 'active'
    ORDER BY c.signal_confidence DESC, c.discovered_date DESC
  `).all();

  const notYetResult = await db.prepare(`
    SELECT c.*, s.company_name, s.sector, md.price as current_price
    FROM candidates c
    JOIN stocks s ON c.ticker = s.ticker
    LEFT JOIN market_data md ON c.ticker = md.ticker
    WHERE c.signal = 'NOT_YET' AND c.status = 'active'
    ORDER BY c.buy_below_price / md.price DESC
  `).all();

  return {
    buy_signals: buyResult.results || [],
    not_yet: notYetResult.results || [],
    buy_count: (buyResult.results || []).length,
    not_yet_count: (notYetResult.results || []).length,
  };
}
