import { PORTFOLIO, ATTRACTOR } from '../../../shared/constants.js';

export async function alertsCheck(env) {
  console.log('Alerts check started:', new Date().toISOString());
  const now = new Date().toISOString();
  let alertsCreated = 0;

  // Get all holdings with current data
  const holdings = await env.DB.prepare(
    `SELECT h.*, s.company_name, s.sector, md.price,
            (md.price * h.shares) as current_value,
            v.adjusted_intrinsic_value, v.discount_to_iv_pct,
            aa.attractor_stability_score
     FROM holdings h
     JOIN stocks s ON h.ticker = s.ticker
     LEFT JOIN market_data md ON h.ticker = md.ticker
     LEFT JOIN valuations v ON h.ticker = v.ticker
     LEFT JOIN attractor_analysis aa ON h.ticker = aa.ticker
       AND aa.analysis_date = (SELECT MAX(analysis_date) FROM attractor_analysis WHERE ticker = h.ticker)`
  ).all();

  const rows = holdings.results || [];
  if (rows.length === 0) {
    console.log('No holdings — skipping alerts check');
    return;
  }

  const totalValue = rows.reduce((s, h) => s + (h.current_value || 0), 0);

  // Helper to create alert (avoids duplicates for same type+ticker in last 24h)
  async function createAlert(type, ticker, message) {
    const existing = await env.DB.prepare(
      `SELECT id FROM alerts WHERE alert_type = ? AND ticker = ? AND dismissed = 0
       AND created_at > datetime('now', '-24 hours')`
    ).bind(type, ticker).first();
    if (existing) return; // Don't duplicate

    await env.DB.prepare(
      'INSERT INTO alerts (alert_type, ticker, message, created_at) VALUES (?, ?, ?, ?)'
    ).bind(type, ticker, message, now).run();
    alertsCreated++;
  }

  for (const h of rows) {
    const weight = totalValue > 0 ? (h.current_value / totalValue * 100) : 0;
    const maxWeight = h.tier === 'core'
      ? PORTFOLIO.max_single_position_core_pct
      : PORTFOLIO.max_single_position_asymmetric_pct;

    // Rule 1: Position overweight
    if (weight > PORTFOLIO.trim_threshold_pct) {
      await createAlert('position_overweight', h.ticker,
        `${h.ticker} is ${weight.toFixed(1)}% of portfolio (trim threshold: ${PORTFOLIO.trim_threshold_pct}%). Consider trimming to ${PORTFOLIO.trim_target_pct}%.`);
    } else if (weight > maxWeight) {
      await createAlert('position_overweight', h.ticker,
        `${h.ticker} is ${weight.toFixed(1)}% of portfolio (max for ${h.tier}: ${maxWeight}%).`);
    }

    // Rule 2: Price exceeds intrinsic value
    if (h.adjusted_intrinsic_value && h.price > h.adjusted_intrinsic_value) {
      await createAlert('price_exceeds_iv', h.ticker,
        `${h.ticker} trading at $${h.price.toFixed(2)}, above IV of $${h.adjusted_intrinsic_value.toFixed(2)}. Review sell discipline.`);
    }

    // Rule 3: Attractor dissolution warning
    if (h.attractor_stability_score != null && h.attractor_stability_score < ATTRACTOR.dissolving_max) {
      await createAlert('attractor_dissolution', h.ticker,
        `${h.ticker} attractor score dropped to ${h.attractor_stability_score.toFixed(1)} (dissolving). Evaluate thesis.`);
    } else if (h.attractor_stability_score != null && h.attractor_stability_score < ATTRACTOR.stable_threshold
      && h.attractor_score_at_purchase && h.attractor_score_at_purchase >= ATTRACTOR.stable_threshold) {
      await createAlert('attractor_transitional', h.ticker,
        `${h.ticker} moved from stable (${h.attractor_score_at_purchase.toFixed(1)}) to transitional (${h.attractor_stability_score.toFixed(1)}). Monitor closely.`);
    }

    // Rule 4: Asymmetric position horizon approaching
    if (h.tier === 'asymmetric' && h.time_horizon_months && h.purchase_date) {
      const purchaseDate = new Date(h.purchase_date);
      const horizonEnd = new Date(purchaseDate);
      horizonEnd.setMonth(horizonEnd.getMonth() + h.time_horizon_months);
      const daysRemaining = (horizonEnd - new Date()) / (1000 * 60 * 60 * 24);

      if (daysRemaining <= PORTFOLIO.ap_horizon_warning_days && daysRemaining > 0) {
        await createAlert('ap_horizon_approaching', h.ticker,
          `${h.ticker} asymmetric position: ${Math.round(daysRemaining)} days remaining in ${h.time_horizon_months}-month horizon. Evaluate thesis.`);
      } else if (daysRemaining <= 0) {
        await createAlert('ap_horizon_expired', h.ticker,
          `${h.ticker} asymmetric position has exceeded its ${h.time_horizon_months}-month time horizon. Action required.`);
      }
    }
  }

  // Rule 5: Sector concentration
  const sectors = {};
  for (const h of rows) {
    const sec = h.sector || 'Unknown';
    sectors[sec] = (sectors[sec] || 0) + (h.current_value || 0);
  }
  for (const [sector, value] of Object.entries(sectors)) {
    const sectorPct = totalValue > 0 ? (value / totalValue * 100) : 0;
    if (sectorPct > PORTFOLIO.max_sector_pct) {
      await createAlert('sector_concentration', null,
        `${sector} sector at ${sectorPct.toFixed(1)}% of portfolio (max: ${PORTFOLIO.max_sector_pct}%). Consider diversifying.`);
    }
  }

  // Rule 6: Too few sectors
  const uniqueSectors = Object.keys(sectors).filter(s => s !== 'Unknown').length;
  if (rows.length >= 5 && uniqueSectors < PORTFOLIO.min_sector_diversity) {
    await createAlert('low_diversity', null,
      `Portfolio spans only ${uniqueSectors} sectors (minimum: ${PORTFOLIO.min_sector_diversity}). Consider adding sector diversity.`);
  }

  // Rule 7: Watchlist price targets hit
  const watchlistHits = await env.DB.prepare(
    `SELECT w.ticker, w.target_buy_price, md.price, s.company_name
     FROM watchlist w
     JOIN market_data md ON w.ticker = md.ticker
     JOIN stocks s ON w.ticker = s.ticker
     WHERE w.alert_enabled = 1
       AND w.target_buy_price IS NOT NULL
       AND md.price <= w.target_buy_price`
  ).all();

  for (const hit of (watchlistHits.results || [])) {
    await createAlert('watchlist_target_hit', hit.ticker,
      `${hit.ticker} (${hit.company_name}) hit buy target: $${hit.price.toFixed(2)} ≤ $${hit.target_buy_price.toFixed(2)}`);
  }

  // Rule 8: Insider caution signals on holdings
  const insiderCautions = await env.DB.prepare(
    `SELECT ins.ticker, ins.signal, ins.signal_details
     FROM insider_signals ins
     INNER JOIN holdings h ON ins.ticker = h.ticker
     WHERE ins.signal = 'caution'`
  ).all();

  for (const ic of (insiderCautions.results || [])) {
    await createAlert('insider_caution', ic.ticker,
      `Insider caution signal for ${ic.ticker}: ${ic.signal_details || 'elevated selling activity'}`);
  }

  // Rule 9: Insider confirms buy on watchlist
  const insiderBuys = await env.DB.prepare(
    `SELECT ins.ticker, ins.signal, ins.signal_details
     FROM insider_signals ins
     INNER JOIN watchlist w ON ins.ticker = w.ticker
     WHERE ins.signal = 'strong_buy'`
  ).all();

  for (const ib of (insiderBuys.results || [])) {
    await createAlert('insider_confirms_buy', ib.ticker,
      `Strong insider buying for watchlist stock ${ib.ticker}: ${ib.signal_details || 'multiple insiders purchasing'}`);
  }

  console.log(`Alerts check completed: ${alertsCreated} new alerts created`);
}
