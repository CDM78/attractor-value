// Sell Discipline Engine — Two Calibration-Validated Triggers
//
// Test 5 (sell trigger validation) showed:
//   - Take-profit at +125%: +$29,187 vs hold (sweep peak)
//   - Attractor dissolution (<2.0): emergency stop, kept for catastrophic risk
//   - Growth failure: HURTS returns (-$1,512) — removed
//   - Concentration trim: never fires — removed
//   - Thesis violation: negligible impact — removed
//   - Regime expiry: negligible impact — removed
//
// Default hold: 3 years (hold period sweep: optimal; 5yr collapses to 33%)

/**
 * Evaluate sell triggers for a held position.
 * @param {object} db - D1 database
 * @param {object} holding - { ticker, shares, cost_basis_per_share, purchase_date, tier }
 * @param {object} env - Worker env
 * @returns {object|null} Sell signal if triggered, null if hold
 */
export async function evaluateSellTriggers(db, holding, env) {
  const ticker = holding.ticker;

  // Get current price
  const marketData = await db.prepare(
    'SELECT price FROM market_data WHERE ticker = ?'
  ).bind(ticker).first();

  if (!marketData?.price) return null;

  const currentPrice = marketData.price;
  const costBasis = holding.cost_basis_per_share;
  const currentReturn = costBasis > 0 ? (currentPrice - costBasis) / costBasis : 0;
  const totalValue = currentPrice * holding.shares;

  // --- TRIGGER 1: Take profit at +125% (sweep-validated optimum) ---
  if (currentReturn >= 1.25) {
    const signal = {
      trigger: 1,
      type: 'SELL',
      label: 'Take profit',
      reason: `+${(currentReturn * 100).toFixed(0)}% return exceeds +125% threshold`,
      action: `Sell all ${holding.shares} shares (~$${totalValue.toFixed(0)})`,
      shares_to_sell: holding.shares,
      urgency: 'standard',
    };
    return addTaxAnalysis(signal, holding, currentPrice);
  }

  // --- TRIGGER 2: Emergency stop — attractor dissolving (< 2.0) ---
  const attractor = await db.prepare(
    'SELECT attractor_stability_score, adjusted_attractor_score FROM attractor_analysis WHERE ticker = ? ORDER BY analysis_date DESC, id DESC LIMIT 1'
  ).bind(ticker).first();

  const effectiveScore = attractor?.adjusted_attractor_score ?? attractor?.attractor_stability_score;

  if (effectiveScore != null && effectiveScore < 2.0) {
    return {
      trigger: 2,
      type: 'SELL',
      label: 'Dissolving',
      reason: `Attractor score ${effectiveScore.toFixed(1)} — competitive position eroding`,
      action: `Sell all ${holding.shares} shares immediately (~$${totalValue.toFixed(0)})`,
      shares_to_sell: holding.shares,
      urgency: 'immediate',
      tax_override: true, // Never delay for tax on dissolving attractor
      tax_note: 'Tax delay overridden — sell immediately regardless of holding period.',
    };
  }

  // Default: hold until 3-year mark
  return null;
}

/**
 * Add tax analysis to a sell signal.
 * If position is held 300-365 days with a gain, recommend waiting for long-term rate.
 */
function addTaxAnalysis(signal, holding, currentPrice) {
  const purchaseDate = new Date(holding.purchase_date);
  const holdingDays = Math.floor((Date.now() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));
  const gain = currentPrice - holding.cost_basis_per_share;

  signal.holding_days = holdingDays;
  signal.is_long_term = holdingDays > 365;

  if (gain <= 0) {
    signal.tax_note = 'Position is at a loss — tax-loss harvesting benefit applies.';
    signal.tax_recommendation = 'SELL_NOW';
    return signal;
  }

  if (holdingDays >= 300 && holdingDays <= 365) {
    const daysToLongTerm = 366 - holdingDays;
    const shortTermTax = gain * 0.398;
    const longTermTax = gain * 0.228;
    const savings = shortTermTax - longTermTax;
    const breakEvenDecline = savings / currentPrice;

    signal.tax_note = `Held ${holdingDays} days. Waiting ${daysToLongTerm} more converts to long-term rate. Tax savings: ~$${(savings * signal.shares_to_sell).toFixed(0)}. Stock can decline ${(breakEvenDecline * 100).toFixed(1)}% and waiting is still better.`;
    signal.tax_recommendation = breakEvenDecline > 0.05 ? 'WAIT' : 'SELL_NOW';
    signal.days_to_long_term = daysToLongTerm;
    signal.tax_savings = Math.round(savings * signal.shares_to_sell);
  } else {
    signal.tax_note = holdingDays > 365
      ? 'Long-term capital gains rate applies (~23%).'
      : 'Short-term capital gains rate applies (~40%).';
    signal.tax_recommendation = 'SELL_NOW';
  }

  return signal;
}

/**
 * Check all holdings for sell triggers.
 * Called daily after price refresh.
 */
export async function checkAllSellTriggers(db, env) {
  const holdingsResult = await db.prepare('SELECT * FROM holdings').all();
  const holdings = holdingsResult.results || [];

  const signals = [];
  for (const holding of holdings) {
    try {
      const signal = await evaluateSellTriggers(db, holding, env);
      if (signal) {
        signals.push({ ticker: holding.ticker, ...signal });
      }
    } catch (err) {
      console.error(`Sell trigger check failed for ${holding.ticker}:`, err.message);
    }
  }

  return {
    checked: holdings.length,
    sell_signals: signals.filter(s => s.type === 'SELL'),
    trim_signals: [], // No trim triggers remain
    total_triggers: signals.length,
    signals,
  };
}
