// Sell Discipline Engine — 6 Unambiguous Triggers
// Each trigger produces a SELL or TRIM signal with the same clarity as BUY signals.
// The system makes the decision; the user executes.

/**
 * Evaluate all sell triggers for a held position.
 * @param {object} db - D1 database
 * @param {object} holding - { ticker, shares, cost_basis_per_share, purchase_date, tier }
 * @param {object} env - Worker env
 * @returns {object|null} Sell signal if triggered, null if hold
 */
export async function evaluateSellTriggers(db, holding, env) {
  const ticker = holding.ticker;

  // Get current data
  const [marketData, valuation, attractor, candidate] = await Promise.all([
    db.prepare('SELECT * FROM market_data WHERE ticker = ?').bind(ticker).first(),
    db.prepare('SELECT * FROM valuations WHERE ticker = ?').bind(ticker).first(),
    db.prepare('SELECT * FROM attractor_analysis WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1').bind(ticker).first(),
    db.prepare("SELECT * FROM candidates WHERE ticker = ? AND status IN ('active','purchased') ORDER BY discovered_date DESC LIMIT 1").bind(ticker).first(),
  ]);

  if (!marketData?.price) return null;

  const currentPrice = marketData.price;
  const costBasis = holding.cost_basis_per_share;
  const totalValue = currentPrice * holding.shares;
  const gainPct = costBasis > 0 ? ((currentPrice - costBasis) / costBasis) * 100 : 0;

  // Get portfolio total for concentration check
  const holdingsResult = await db.prepare('SELECT * FROM holdings').all();
  const allHoldings = holdingsResult.results || [];
  let portfolioTotal = 0;
  for (const h of allHoldings) {
    const md = await db.prepare('SELECT price FROM market_data WHERE ticker = ?').bind(h.ticker).first();
    portfolioTotal += (md?.price || h.cost_basis_per_share) * h.shares;
  }
  const positionPct = portfolioTotal > 0 ? (totalValue / portfolioTotal) * 100 : 0;

  const effectiveAttractorScore = attractor?.adjusted_attractor_score ?? attractor?.attractor_stability_score;
  const discoveryTier = candidate?.discovery_tier || holding.tier;

  // --- TRIGGER 1: Price exceeds IV ---
  if (valuation?.adjusted_intrinsic_value && currentPrice > valuation.adjusted_intrinsic_value) {
    const overvaluedPct = ((currentPrice - valuation.adjusted_intrinsic_value) / valuation.adjusted_intrinsic_value * 100).toFixed(0);
    const signal = {
      trigger: 1,
      type: 'SELL',
      label: 'Overvalued',
      reason: `Price ($${currentPrice.toFixed(2)}) exceeds intrinsic value ($${valuation.adjusted_intrinsic_value.toFixed(2)}) by ${overvaluedPct}%`,
      action: `Sell all ${holding.shares} shares (~$${totalValue.toFixed(0)})`,
      shares_to_sell: holding.shares,
      urgency: 'standard',
    };
    return addTaxAnalysis(signal, holding, currentPrice);
  }

  // --- TRIGGER 2: Attractor dissolution (IMMEDIATE — overrides tax delay) ---
  if (effectiveAttractorScore != null && effectiveAttractorScore < 2.0) {
    return {
      trigger: 2,
      type: 'SELL',
      label: 'Dissolving',
      reason: `Attractor score dropped to ${effectiveAttractorScore.toFixed(1)}. Competitive position is eroding.`,
      action: `Sell all ${holding.shares} shares immediately (~$${totalValue.toFixed(0)})`,
      shares_to_sell: holding.shares,
      urgency: 'immediate',
      tax_override: true, // Never delay for tax on dissolving attractor
    };
  }

  // --- TRIGGER 3: Thesis violation ---
  // This is detected by the attractor analysis when the fundamental thesis changes.
  // Score between 2.0-2.5 with specific red flags indicates thesis breaking.
  if (effectiveAttractorScore != null && effectiveAttractorScore < 2.5 && attractor?.red_flags) {
    try {
      const flags = JSON.parse(attractor.red_flags);
      if (flags && flags.length >= 3) {
        const signal = {
          trigger: 3,
          type: 'SELL',
          label: 'Thesis broken',
          reason: `Attractor score ${effectiveAttractorScore.toFixed(1)} with ${flags.length} red flags. Original investment thesis no longer holds.`,
          action: `Sell all ${holding.shares} shares (~$${totalValue.toFixed(0)})`,
          shares_to_sell: holding.shares,
          urgency: 'standard',
        };
        return addTaxAnalysis(signal, holding, currentPrice);
      }
    } catch { /* red_flags not valid JSON */ }
  }

  // --- TRIGGER 4: Concentration creep (position > 8% of portfolio) ---
  if (positionPct > 8) {
    const targetPct = 5;
    const targetValue = portfolioTotal * (targetPct / 100);
    const excessValue = totalValue - targetValue;
    const sharesToSell = Math.ceil(excessValue / currentPrice);
    const signal = {
      trigger: 4,
      type: 'TRIM',
      label: 'Overweight',
      reason: `Position is ${positionPct.toFixed(1)}% of portfolio (limit: 8%). Trim to ${targetPct}%.`,
      action: `Sell ${sharesToSell} shares (~$${(sharesToSell * currentPrice).toFixed(0)}) to reduce to ${targetPct}%`,
      shares_to_sell: sharesToSell,
      urgency: 'standard',
    };
    return addTaxAnalysis(signal, holding, currentPrice);
  }

  // --- TRIGGER 5: Tier 3 growth failure ---
  if (discoveryTier === 'tier3') {
    // Check if revenue growth dropped below 10% for 2 consecutive quarters
    // Approximate: compare most recent 2 years of revenue
    const financials = await db.prepare(
      'SELECT revenue, fiscal_year FROM financials WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT 3'
    ).bind(ticker).all();
    const rows = financials.results || [];

    if (rows.length >= 2 && rows[0].revenue > 0 && rows[1].revenue > 0) {
      const recentGrowth = (rows[0].revenue - rows[1].revenue) / rows[1].revenue;
      if (recentGrowth < 0.10) {
        const signal = {
          trigger: 5,
          type: 'SELL',
          label: 'Growth stalled',
          reason: `Revenue growth ${(recentGrowth * 100).toFixed(1)}% (below 10% threshold). Growth thesis no longer holds.`,
          action: `Sell all ${holding.shares} shares (~$${totalValue.toFixed(0)})`,
          shares_to_sell: holding.shares,
          urgency: 'standard',
        };
        return addTaxAnalysis(signal, holding, currentPrice);
      }
    }

    // Also check gross margin collapse (below 30%)
    if (marketData.pb_ratio != null) {
      // Approximate gross margin from net margin if available
      const latestRev = rows[0]?.revenue;
      const latestNI = await db.prepare(
        'SELECT net_income FROM financials WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT 1'
      ).bind(ticker).first();
      if (latestRev > 0 && latestNI?.net_income != null) {
        const netMargin = latestNI.net_income / latestRev;
        if (netMargin < -0.10) { // Deep losses suggest margin collapse
          const signal = {
            trigger: 5,
            type: 'SELL',
            label: 'Growth stalled',
            reason: `Net margin ${(netMargin * 100).toFixed(1)}% indicates potential margin collapse.`,
            action: `Sell all ${holding.shares} shares (~$${totalValue.toFixed(0)})`,
            shares_to_sell: holding.shares,
            urgency: 'standard',
          };
          return addTaxAnalysis(signal, holding, currentPrice);
        }
      }
    }
  }

  // --- TRIGGER 6: Tier 4 regime expiry ---
  if (discoveryTier === 'tier4' && candidate?.regime_id) {
    const regime = await db.prepare(
      'SELECT status FROM regime_registry WHERE id = ?'
    ).bind(candidate.regime_id).first();

    if (regime && (regime.status === 'matured' || regime.status === 'invalidated') && gainPct > 50) {
      const sharesToSell = Math.ceil(holding.shares / 2);
      const signal = {
        trigger: 6,
        type: 'TRIM',
        label: 'Regime maturing',
        reason: `Regime status: ${regime.status}. Stock has appreciated ${gainPct.toFixed(0)}% from entry. Structural shift is maturing.`,
        action: `Sell ${sharesToSell} shares (half position, ~$${(sharesToSell * currentPrice).toFixed(0)}). Hold remainder.`,
        shares_to_sell: sharesToSell,
        urgency: 'standard',
      };
      return addTaxAnalysis(signal, holding, currentPrice);
    }
  }

  // No triggers fired — hold
  return null;
}

/**
 * Add tax analysis to a sell signal.
 * If position is held 300-365 days with a gain, recommend waiting for long-term rate.
 */
function addTaxAnalysis(signal, holding, currentPrice) {
  if (signal.tax_override) {
    signal.tax_note = 'Tax delay overridden — sell immediately regardless of holding period.';
    return signal;
  }

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
    const shortTermTax = gain * 0.398; // ~40%
    const longTermTax = gain * 0.228;  // ~23%
    const savings = shortTermTax - longTermTax;
    const savingsPerShare = savings; // per share
    const breakEvenDecline = savings / currentPrice;

    signal.tax_note = `Held ${holdingDays} days. Waiting ${daysToLongTerm} more days converts to long-term rate. Tax savings: ~$${(savingsPerShare * signal.shares_to_sell).toFixed(0)}. Stock can decline ${(breakEvenDecline * 100).toFixed(1)}% and waiting is still better.`;
    signal.tax_recommendation = breakEvenDecline > 0.05 ? 'WAIT' : 'SELL_NOW';
    signal.days_to_long_term = daysToLongTerm;
    signal.tax_savings = Math.round(savingsPerShare * signal.shares_to_sell);
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
    trim_signals: signals.filter(s => s.type === 'TRIM'),
    total_triggers: signals.length,
    signals,
  };
}
