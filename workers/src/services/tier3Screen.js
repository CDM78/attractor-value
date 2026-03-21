// Tier 3: Emerging DKS — Quantitative Pre-Screen
// Monthly scan of full universe for companies building self-reinforcing competitive positions.
// Two-track: high-growth (≥20% CAGR) or steady compounder (≥8% CAGR + high margins + moat).

/**
 * Run Tier 3 quantitative pre-screen against all stocks in universe.
 * Returns candidates that pass for DKS evaluation.
 * @param {object} db - D1 database
 * @param {object} options - { limit, offset }
 */
export async function tier3PreScreen(db, options = {}) {
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  // Query: join stocks + market_data + financials to get screening data
  // Need: market_cap, revenue (3 most recent years for CAGR), gross margin, years public
  const query = `
    SELECT
      s.ticker, s.company_name, s.sector, s.industry,
      md.price, s.market_cap,
      -- Most recent 3 years of revenue for CAGR
      f1.revenue as rev_y1, f1.fiscal_year as fy1,
      f2.revenue as rev_y2, f2.fiscal_year as fy2,
      f3.revenue as rev_y3, f3.fiscal_year as fy3,
      -- Gross margin proxy: (revenue - COGS) / revenue
      -- We don't have COGS directly, use operating margin proxy from net_income/revenue
      f1.net_income as ni_y1, f1.revenue as rev_latest,
      f1.operating_cash_flow as ocf_y1,
      f1.total_assets as assets_y1,
      -- Count years with financials (proxy for years public)
      (SELECT COUNT(*) FROM financials fi WHERE fi.ticker = s.ticker) as years_data,
      f1.shares_outstanding as shares_y1,
      f1.shareholder_equity as equity_y1,
      f1.book_value_per_share as bvps_y1
    FROM stocks s
    JOIN market_data md ON s.ticker = md.ticker
    LEFT JOIN financials f1 ON s.ticker = f1.ticker
      AND f1.fiscal_year = (SELECT MAX(fiscal_year) FROM financials WHERE ticker = s.ticker)
    LEFT JOIN financials f2 ON s.ticker = f2.ticker
      AND f2.fiscal_year = f1.fiscal_year - 1
    LEFT JOIN financials f3 ON s.ticker = f3.ticker
      AND f3.fiscal_year = f1.fiscal_year - 2
    WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
      AND md.price IS NOT NULL AND md.price > 0
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
        market_cap: mcap,
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

  // Market cap: $500M - $30B
  // Compute from price × shares if stocks.market_cap is null
  // shares = shareholder_equity / book_value_per_share
  let mcap = stock.market_cap;
  if (!mcap && stock.price > 0) {
    // Try shares from financials
    if (stock.shares_y1 > 0) {
      mcap = Math.round(stock.price * stock.shares_y1 / 1e6);
    }
    // Fallback: estimate shares from equity / BVPS
    if (!mcap && stock.equity_y1 > 0 && stock.bvps_y1 > 0) {
      const estimatedShares = stock.equity_y1 / stock.bvps_y1;
      mcap = Math.round(stock.price * estimatedShares / 1e6);
    }
  }
  if (!mcap || mcap < 500 || mcap > 30000) {
    return { passes: false, fail_reason: `market_cap_out_of_range: ${mcap || 'null'}` };
  }

  // Revenue CAGR (3-year)
  let revCAGR = null;
  if (stock.rev_y1 > 0 && stock.rev_y3 > 0 && stock.fy1 && stock.fy3) {
    const years = stock.fy1 - stock.fy3;
    if (years > 0) {
      revCAGR = Math.pow(stock.rev_y1 / stock.rev_y3, 1 / years) - 1;
    }
  }

  // Gross margin approximation
  // We don't have COGS directly. Use operating income / revenue as proxy.
  // If net_income and revenue available: net_margin is lower bound for gross margin.
  // For a better proxy, use (revenue - cost_of_revenue) but we may not have cost_of_revenue.
  // Fallback: if net_margin > 10%, gross_margin is likely > 35%
  let grossMarginEstimate = null;
  if (stock.rev_latest > 0 && stock.ni_y1 != null) {
    const netMargin = stock.ni_y1 / stock.rev_latest;
    // Rough heuristic: gross margin ≈ net margin + 20-30% for SaaS/tech, + 10-15% for industrial
    const sectorAdjust = isTechSector(stock.sector) ? 0.30 : 0.15;
    grossMarginEstimate = Math.min(netMargin + sectorAdjust, 0.85);
  }

  // Years public (proxy from financials count)
  const yearsPublic = stock.years_data || 0;

  // Operating cash flow positive
  const ocfPositive = stock.ocf_y1 != null ? stock.ocf_y1 > 0 : null;

  // Two-track growth check
  let growthTrack = null;
  const highGrowth = revCAGR != null && revCAGR >= 0.20;
  const steadyCompounder = revCAGR != null && revCAGR >= 0.08 &&
    grossMarginEstimate != null && grossMarginEstimate >= 0.35;

  if (highGrowth) growthTrack = 'high_growth';
  else if (steadyCompounder) growthTrack = 'steady_compounder';

  // Apply screening criteria
  if (!growthTrack) {
    reasons.push(`revenue_cagr_too_low: ${revCAGR != null ? (revCAGR * 100).toFixed(1) + '%' : 'N/A'}`);
  }

  if (grossMarginEstimate != null && grossMarginEstimate < 0.35) {
    reasons.push(`gross_margin_too_low: ${(grossMarginEstimate * 100).toFixed(1)}%`);
  }

  if (yearsPublic < 2) {
    reasons.push(`too_few_years_data: ${yearsPublic}`);
  }

  if (yearsPublic > 15) {
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
    gross_margin_estimate: grossMarginEstimate != null ? Math.round(grossMarginEstimate * 1000) / 1000 : null,
    years_public: yearsPublic,
    ocf_positive: ocfPositive,
    market_cap_m: mcap,
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
      },
    });
    stored++;
  }

  return stored;
}
