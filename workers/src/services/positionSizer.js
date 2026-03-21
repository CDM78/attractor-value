// Position Sizing Engine
// Computes exact dollar amounts and share counts for BUY signals.
// The system tells the user exactly what to buy — no judgment calls.

import { getPortfolioConfig } from '../db/queries.js';

const DEFAULT_ALLOCATIONS = {
  tier2: 0.15,
  tier3: 0.30,
  tier4: 0.20,
  flexible: 0.30,
  cash_reserve: 0.05,
};

const MAX_POSITION_PCT = 0.05; // 5% of total capital per position

/**
 * Compute position size for a BUY signal.
 * @param {object} db - D1 database
 * @param {object} signal - { ticker, discovery_tier, current_price, signal_confidence }
 * @returns {object} Position sizing recommendation
 */
export async function computePositionSize(db, signal) {
  const config = await getPortfolioConfig(db);

  const totalCapital = parseFloat(config.total_capital || '10000');
  const tierAlloc = parseFloat(config[`${signal.discovery_tier}_allocation`] || DEFAULT_ALLOCATIONS[signal.discovery_tier] || 0.15);
  const flexibleAlloc = parseFloat(config.flexible_allocation || '0.30');
  const cashReserve = parseFloat(config.cash_reserve || '0.05');
  const maxPositionPct = parseFloat(config.max_position_pct || String(MAX_POSITION_PCT));

  // Current portfolio state
  const holdings = await db.prepare(
    'SELECT ticker, shares, cost_basis_per_share FROM holdings'
  ).all();
  const holdingsList = holdings.results || [];

  // Current prices for holdings
  let totalHoldingsValue = 0;
  const tierInvested = { tier2: 0, tier3: 0, tier4: 0 };

  for (const h of holdingsList) {
    const priceRow = await db.prepare(
      'SELECT price FROM market_data WHERE ticker = ?'
    ).bind(h.ticker).first();
    const currentValue = (priceRow?.price || h.cost_basis_per_share) * h.shares;
    totalHoldingsValue += currentValue;

    // Check which tier this holding belongs to
    const candidate = await db.prepare(
      "SELECT discovery_tier FROM candidates WHERE ticker = ? AND status IN ('active', 'purchased') ORDER BY discovered_date DESC LIMIT 1"
    ).bind(h.ticker).first();
    if (candidate?.discovery_tier) {
      tierInvested[candidate.discovery_tier] = (tierInvested[candidate.discovery_tier] || 0) + currentValue;
    }
  }

  // Cash balance estimate
  const cashBalance = totalCapital - totalHoldingsValue;

  // Tier budget
  const tierBudget = totalCapital * tierAlloc;
  const currentTierInvested = tierInvested[signal.discovery_tier] || 0;
  let tierRemaining = tierBudget - currentTierInvested;

  // If tier budget exhausted, use flexible pool
  let usingFlexible = false;
  if (tierRemaining <= 0) {
    const flexibleBudget = totalCapital * flexibleAlloc;
    const totalInvested = Object.values(tierInvested).reduce((s, v) => s + v, 0);
    const flexibleUsed = Math.max(0, totalInvested - totalCapital * (1 - flexibleAlloc - cashReserve));
    tierRemaining = flexibleBudget - flexibleUsed;
    usingFlexible = true;
  }

  if (tierRemaining <= 0) {
    return {
      action: 'CANNOT_BUY',
      reason: 'Tier allocation and flexible pool exhausted',
      ticker: signal.ticker,
      tier: signal.discovery_tier,
    };
  }

  // Max position size
  const maxPositionDollars = totalCapital * maxPositionPct;

  // Confidence adjustment: STRONG = full size, STANDARD = 75%
  const confidenceMultiplier = signal.signal_confidence === 'STRONG' ? 1.0 : 0.75;

  // Minimum cash reserve
  const minCash = totalCapital * cashReserve;
  const availableCash = Math.max(0, cashBalance - minCash);

  // Final position size: minimum of all constraints
  const targetDollars = Math.min(
    maxPositionDollars * confidenceMultiplier,
    tierRemaining,
    availableCash
  );

  if (targetDollars <= 0 || !signal.current_price || signal.current_price <= 0) {
    return {
      action: 'CANNOT_BUY',
      reason: targetDollars <= 0 ? 'Insufficient capital (cash reserve constraint)' : 'No price data',
      ticker: signal.ticker,
      tier: signal.discovery_tier,
    };
  }

  const shares = Math.floor(targetDollars / signal.current_price);
  if (shares <= 0) {
    return {
      action: 'CANNOT_BUY',
      reason: 'Position size too small for even 1 share',
      ticker: signal.ticker,
      tier: signal.discovery_tier,
    };
  }

  const actualDollars = shares * signal.current_price;

  return {
    action: 'BUY',
    ticker: signal.ticker,
    shares,
    price: signal.current_price,
    total_cost: Math.round(actualDollars * 100) / 100,
    pct_of_portfolio: Math.round((actualDollars / totalCapital) * 1000) / 10,
    tier: signal.discovery_tier,
    confidence: signal.signal_confidence,
    using_flexible_pool: usingFlexible,
    portfolio_context: {
      total_capital: totalCapital,
      current_holdings_value: Math.round(totalHoldingsValue),
      cash_balance: Math.round(cashBalance),
      tier_budget: Math.round(tierBudget),
      tier_invested: Math.round(currentTierInvested),
      tier_remaining_after: Math.round(tierRemaining - actualDollars),
      cash_remaining_after: Math.round(cashBalance - actualDollars),
    },
  };
}

/**
 * Compute position sizes for all current BUY signals.
 */
export async function sizeAllBuySignals(db) {
  const { getAllBuySignals } = await import('../db/queries.js');
  const buySignals = await getAllBuySignals(db);

  const sized = [];
  for (const signal of buySignals) {
    const position = await computePositionSize(db, {
      ticker: signal.ticker,
      discovery_tier: signal.discovery_tier,
      current_price: signal.current_price,
      signal_confidence: signal.signal_confidence,
    });

    // Update candidate with sizing recommendation
    if (position.action === 'BUY') {
      await db.prepare(`
        UPDATE candidates SET
          recommended_shares = ?,
          recommended_dollars = ?,
          recommended_pct = ?
        WHERE id = ?
      `).bind(
        position.shares,
        position.total_cost,
        position.pct_of_portfolio,
        signal.id
      ).run();
    }

    sized.push(position);
  }

  return sized;
}
