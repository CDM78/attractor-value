// VOO Parking Position Manager
//
// All uninvested capital sits in VOO (Vanguard S&P 500 ETF, 0.03% expense ratio).
// Evidence: Test 2 showed hybrid VOO raises beat rate from 83% to 97%.
// VOO vs VGSH crisis test: VOO wins by $72,506 — keep everything in VOO.
//
// The VOO parking position:
//   - Auto-adjusts when framework positions open/close
//   - Shows in Holdings as a special auto-managed row
//   - Cannot be manually sold or trimmed
//   - When capital is added, it goes to VOO; when withdrawn, it comes from VOO

const VOO_TICKER = '__VOO_PARKING';

/**
 * Get or create the VOO parking position.
 * Returns the current VOO holding record.
 */
export async function getVooParking(db) {
  const existing = await db.prepare(
    "SELECT * FROM holdings WHERE ticker = ? AND position_type = 'parking'"
  ).bind(VOO_TICKER).first();
  return existing;
}

/**
 * Recalculate the VOO parking position based on total capital minus framework positions.
 * Call this after any capital change, position open, or position close.
 */
export async function recalculateVooParking(db) {
  // Get total capital
  const configRow = await db.prepare(
    "SELECT value FROM portfolio_config WHERE key = 'total_capital'"
  ).first();
  const totalCapital = parseFloat(configRow?.value || '0');
  if (totalCapital <= 0) return { voo_shares: 0, voo_value: 0, framework_invested: 0 };

  // Get current VOO price
  const vooPrice = await db.prepare(
    "SELECT price FROM market_data WHERE ticker = 'VOO'"
  ).first();
  const price = vooPrice?.price || 500; // Fallback ~$500 for VOO

  // Sum all framework position values
  const holdings = await db.prepare(
    "SELECT h.shares, h.cost_basis_per_share, h.ticker FROM holdings h WHERE h.position_type = 'framework' OR h.position_type IS NULL"
  ).all();
  const frameworkRows = holdings.results || [];

  let frameworkInvested = 0;
  for (const h of frameworkRows) {
    if (h.ticker === VOO_TICKER) continue;
    const md = await db.prepare(
      'SELECT price FROM market_data WHERE ticker = ?'
    ).bind(h.ticker).first();
    frameworkInvested += (md?.price || h.cost_basis_per_share) * h.shares;
  }

  // VOO gets the remainder
  const vooValue = Math.max(0, totalCapital - frameworkInvested);
  const vooShares = price > 0 ? Math.round(vooValue / price * 100) / 100 : 0;

  // Upsert the VOO parking position
  const existing = await getVooParking(db);
  if (existing) {
    await db.prepare(
      `UPDATE holdings SET shares = ?, cost_basis_per_share = ? WHERE id = ?`
    ).bind(vooShares, price, existing.id).run();
  } else if (vooShares > 0) {
    try {
      await db.prepare(
        `INSERT INTO holdings (ticker, tier, shares, cost_basis_per_share, purchase_date, purchase_thesis, position_type)
         VALUES (?, 'core', ?, ?, datetime('now'), 'VOO parking — uninvested capital in S&P 500 index', 'parking')`
      ).bind(VOO_TICKER, vooShares, price).run();
    } catch { /* table may not have position_type column yet */ }
  }

  return {
    voo_shares: vooShares,
    voo_value: Math.round(vooValue),
    voo_price: price,
    framework_invested: Math.round(frameworkInvested),
    total_capital: totalCapital,
    deployed_pct: Math.round(frameworkInvested / totalCapital * 100),
  };
}

/**
 * When executing a BUY: reduce VOO, open framework position.
 * Returns the VOO shares to sell.
 */
export function computeVooReduction(positionDollars, vooPrice) {
  if (!vooPrice || vooPrice <= 0) return 0;
  return Math.ceil(positionDollars / vooPrice * 100) / 100;
}

/**
 * Get portfolio summary including VOO parking.
 */
export async function getPortfolioSummary(db) {
  const parking = await recalculateVooParking(db);

  // Get framework holdings with current values
  const holdings = await db.prepare(
    `SELECT h.*, md.price as current_price, s.company_name, s.sector,
            c.discovery_tier, c.signal, c.attractor_score
     FROM holdings h
     LEFT JOIN market_data md ON h.ticker = md.ticker
     LEFT JOIN stocks s ON h.ticker = s.ticker
     LEFT JOIN candidates c ON h.ticker = c.ticker AND c.status IN ('active', 'purchased')
     WHERE h.position_type = 'framework' OR h.position_type IS NULL
     ORDER BY (md.price * h.shares) DESC`
  ).all();

  const frameworkPositions = (holdings.results || []).filter(h => h.ticker !== VOO_TICKER);

  return {
    total_capital: parking.total_capital,
    framework_invested: parking.framework_invested,
    voo_parking: parking.voo_value,
    deployed_pct: parking.deployed_pct,
    framework_positions: frameworkPositions.map(h => ({
      ticker: h.ticker,
      company: h.company_name,
      sector: h.sector,
      shares: h.shares,
      cost_basis: h.cost_basis_per_share,
      current_price: h.current_price,
      current_value: Math.round((h.current_price || h.cost_basis_per_share) * h.shares),
      gain_pct: h.current_price && h.cost_basis_per_share > 0
        ? Math.round((h.current_price - h.cost_basis_per_share) / h.cost_basis_per_share * 1000) / 10 : null,
      pipeline: h.discovery_tier,
      attractor: h.attractor_score,
      position_type: 'framework',
    })),
    voo_position: {
      ticker: 'VOO',
      company: 'Vanguard S&P 500 ETF',
      shares: parking.voo_shares,
      current_price: parking.voo_price,
      current_value: parking.voo_value,
      position_type: 'parking',
      note: 'Auto-managed — uninvested capital',
    },
  };
}

export { VOO_TICKER };
