// Tier 3: Emerging DKS — Quantitative Pre-Screen
// Monthly scan of full universe for companies building self-reinforcing competitive positions.
// Two-track: high-growth (≥20% CAGR) or steady compounder (≥8% CAGR + high margins + moat).

/**
 * Run Tier 3 quantitative pre-screen against all stocks in universe.
 * Uses Finnhub-derived metrics (revenue_growth_3y, gross_margin_pct, market_cap)
 * stored in the stocks table, with EDGAR financials as enrichment.
 * @param {object} db - D1 database
 * @param {object} options - { limit, offset }
 */
export async function tier3PreScreen(db, options = {}) {
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const query = `
    SELECT
      s.ticker, s.company_name, s.sector, s.industry,
      s.market_cap, s.revenue_growth_3y, s.gross_margin_pct,
      md.price,
      -- EDGAR enrichment (if available)
      f1.revenue as rev_y1, f1.fiscal_year as fy1,
      f3.revenue as rev_y3, f3.fiscal_year as fy3,
      f1.net_income as ni_y1,
      f1.operating_cash_flow as ocf_y1,
      (SELECT COUNT(*) FROM financials fi WHERE fi.ticker = s.ticker) as years_data
    FROM stocks s
    JOIN market_data md ON s.ticker = md.ticker
    LEFT JOIN financials f1 ON s.ticker = f1.ticker
      AND f1.fiscal_year = (SELECT MAX(fiscal_year) FROM financials WHERE ticker = s.ticker)
    LEFT JOIN financials f3 ON s.ticker = f3.ticker
      AND f3.fiscal_year = f1.fiscal_year - 2
    WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
      AND md.price IS NOT NULL AND md.price > 0
      AND s.market_cap IS NOT NULL
      AND s.market_cap >= 500
      AND s.market_cap <= 30000
    ORDER BY s.ticker
    LIMIT ? OFFSET ?
  `;

  const result = await db.prepare(query).bind(limit, offset).all();
  const stocks = result.results || [];

  const passes = [];
  const failures = [];

  for (const stock of stocks) {
    const screenResult = evaluateStock(stock);
    if (screenResult.passes) {
      passes.push({
        ticker: stock.ticker,
        company_name: stock.company_name,
        sector: stock.sector,
        industry: stock.industry,
        market_cap: stock.market_cap,
        price: stock.price,
        ...screenResult,
      });
    } else {
      failures.push({
        ticker: stock.ticker,
        reason: screenResult.fail_reason,
      });
    }
  }

  return {
    scanned: stocks.length,
    passes: passes.length,
    failures: failures.length,
    candidates: passes,
    offset,
    has_more: stocks.length === limit,
  };
}

/**
 * Evaluate a single stock against Tier 3 pre-screen criteria.
 */
function evaluateStock(stock) {
  const reasons = [];

  // Market cap already filtered in SQL ($500M-$30B)
  const mcap = stock.market_cap;

  // Revenue CAGR: prefer EDGAR (more accurate), fallback to Finnhub
  let revCAGR = null;
  if (stock.rev_y1 > 0 && stock.rev_y3 > 0 && stock.fy1 && stock.fy3) {
    const years = stock.fy1 - stock.fy3;
    if (years > 0) {
      revCAGR = Math.pow(stock.rev_y1 / stock.rev_y3, 1 / years) - 1;
    }
  }
  // Fallback: Finnhub revenue_growth_3y (stored as percentage, e.g., 25.5 = 25.5%)
  if (revCAGR == null && stock.revenue_growth_3y != null) {
    revCAGR = stock.revenue_growth_3y / 100;
  }

  // Gross margin: prefer Finnhub (direct), fallback to EDGAR approximation
  let grossMargin = null;
  if (stock.gross_margin_pct != null) {
    grossMargin = stock.gross_margin_pct / 100; // Finnhub stores as percentage
  } else if (stock.rev_y1 > 0 && stock.ni_y1 != null) {
    // Approximate: gross margin ≈ net margin + sector adjustment
    const netMargin = stock.ni_y1 / stock.rev_y1;
    const sectorAdjust = isTechSector(stock.sector) ? 0.30 : 0.15;
    grossMargin = Math.min(netMargin + sectorAdjust, 0.85);
  }

  // Years public (proxy from financials count)
  const yearsPublic = stock.years_data || 0;

  // Operating cash flow positive
  const ocfPositive = stock.ocf_y1 != null ? stock.ocf_y1 > 0 : null;

  // Two-track growth check
  let growthTrack = null;
  const highGrowth = revCAGR != null && revCAGR >= 0.20;
  const steadyCompounder = revCAGR != null && revCAGR >= 0.08 &&
    grossMargin != null && grossMargin >= 0.35;

  if (highGrowth) growthTrack = 'high_growth';
  else if (steadyCompounder) growthTrack = 'steady_compounder';

  // Apply screening criteria
  if (!growthTrack) {
    if (revCAGR == null) {
      reasons.push('no_revenue_growth_data');
    } else {
      reasons.push(`revenue_cagr_too_low: ${(revCAGR * 100).toFixed(1)}%`);
    }
  }

  if (grossMargin != null && grossMargin < 0.35 && growthTrack !== 'high_growth') {
    reasons.push(`gross_margin_too_low: ${(grossMargin * 100).toFixed(1)}%`);
  }

  // Years public check — skip if we don't have EDGAR data (Finnhub doesn't provide this)
  if (yearsPublic > 0 && yearsPublic > 15) {
    reasons.push(`too_many_years: ${yearsPublic} (established company, not emerging)`);
  }

  // OCF check: must be positive unless high-growth
  if (growthTrack !== 'high_growth' && ocfPositive === false) {
    reasons.push('operating_cash_flow_negative');
  }

  const passes = reasons.length === 0 && growthTrack != null;

  return {
    passes,
    fail_reason: reasons.length > 0 ? reasons.join('; ') : null,
    growth_track: growthTrack,
    revenue_cagr_3yr: revCAGR != null ? Math.round(revCAGR * 1000) / 1000 : null,
    gross_margin_estimate: grossMargin != null ? Math.round(grossMargin * 1000) / 1000 : null,
    years_public: yearsPublic,
    ocf_positive: ocfPositive,
    market_cap_m: mcap,
    data_source: stock.revenue_growth_3y != null ? 'finnhub' : (stock.rev_y1 ? 'edgar' : 'none'),
  };
}

function isTechSector(sector) {
  if (!sector) return false;
  return ['Technology', 'Information Technology', 'Software', 'Communication Services']
    .some(s => sector.toLowerCase().includes(s.toLowerCase()));
}

/**
 * Store Tier 3 pre-screen passes as candidates.
 */
export async function storeTier3Candidates(db, candidates) {
  const { upsertCandidate } = await import('../db/queries.js');
  let stored = 0;

  for (const c of candidates) {
    // Check if this ticker already exists as an active candidate
    const existing = await db.prepare(
      "SELECT id FROM candidates WHERE ticker = ? AND discovery_tier = 'tier3' AND status = 'active'"
    ).bind(c.ticker).first();
    if (existing) continue; // Don't duplicate

    await upsertCandidate(db, {
      ticker: c.ticker,
      discovery_tier: 'tier3',
      discovered_date: new Date().toISOString(),
      prescreen_pass: true,
      prescreen_data: {
        growth_track: c.growth_track,
        revenue_cagr_3yr: c.revenue_cagr_3yr,
        gross_margin_estimate: c.gross_margin_estimate,
        years_public: c.years_public,
        market_cap_m: c.market_cap_m,
        data_source: c.data_source,
      },
    });
    stored++;
  }

  return stored;
}
