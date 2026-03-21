// Tier 4: Regime Transition — Beneficiary Screening & CSI
// Activates when regime_registry has active regimes. Screens for companies
// positioned to benefit from structural transitions, then filters by
// Consensus Saturation Index to find under-recognized beneficiaries.

import { upsertCandidate } from '../db/queries.js';

/**
 * Run Tier 4 beneficiary screen for a specific regime.
 * @param {object} db - D1 database
 * @param {object} regime - row from regime_registry { id, name, affected_sectors, regime_keywords, start_date, ... }
 * @param {object} options - { limit, offset }
 */
export async function tier4BeneficiaryScreen(db, regime, options = {}) {
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  // Parse affected sectors from JSON
  let affectedSectors;
  try {
    affectedSectors = typeof regime.affected_sectors === 'string'
      ? JSON.parse(regime.affected_sectors)
      : regime.affected_sectors;
  } catch {
    return {
      scanned: 0,
      passes: 0,
      candidates: [],
      error: 'Could not parse affected_sectors from regime',
    };
  }

  if (!Array.isArray(affectedSectors) || affectedSectors.length === 0) {
    return {
      scanned: 0,
      passes: 0,
      candidates: [],
      error: 'No affected sectors defined for regime',
    };
  }

  // Build sector filter: match stocks whose sector or industry overlaps affected sectors
  const sectorPlaceholders = affectedSectors.map(() => '?').join(', ');
  const sectorLikeConditions = affectedSectors
    .map(() => "(s.sector LIKE '%' || ? || '%' OR s.industry LIKE '%' || ? || '%')")
    .join(' OR ');

  // Flatten affected sectors for LIKE binding (each sector used twice)
  const sectorBindings = affectedSectors.flatMap(s => [s, s]);

  const query = `
    SELECT
      s.ticker, s.company_name, s.sector, s.industry,
      md.price, s.market_cap, md.pe_ratio, md.pb_ratio,
      -- Most recent two years of financials for scaling exponent
      f1.revenue as rev_y1, f1.total_assets as assets_y1, f1.fiscal_year as fy1,
      f2.revenue as rev_y2, f2.total_assets as assets_y2, f2.fiscal_year as fy2,
      -- Balance sheet
      f1.total_debt, f1.shareholder_equity,
      f1.current_assets, f1.current_liabilities
    FROM stocks s
    JOIN market_data md ON s.ticker = md.ticker
    LEFT JOIN financials f1 ON s.ticker = f1.ticker
      AND f1.fiscal_year = (SELECT MAX(fiscal_year) FROM financials WHERE ticker = s.ticker)
    LEFT JOIN financials f2 ON s.ticker = f2.ticker
      AND f2.fiscal_year = f1.fiscal_year - 1
    WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
      AND md.price IS NOT NULL
      AND md.price > 0
      AND s.market_cap IS NOT NULL
      AND (${sectorLikeConditions})
    ORDER BY s.ticker
    LIMIT ? OFFSET ?
  `;

  const bindings = [...sectorBindings, limit, offset];
  const result = await db.prepare(query).bind(...bindings).all();
  const stocks = result.results || [];

  const passes = [];
  const failures = [];

  for (const stock of stocks) {
    const screenResult = evaluateBeneficiary(stock);
    if (screenResult.passes) {
      // Compute CSI for passing stocks
      const csi = await computeCSI(db, stock.ticker, regime);
      if (csi.pass) {
        passes.push({
          ticker: stock.ticker,
          company_name: stock.company_name,
          sector: stock.sector,
          industry: stock.industry,
          market_cap: stock.market_cap,
          price: stock.price,
          ...screenResult,
          csi_score: csi.csi_score,
          csi_interpretation: csi.interpretation,
        });
      } else {
        failures.push({
          ticker: stock.ticker,
          reason: `csi_saturated: score ${csi.csi_score} (${csi.interpretation})`,
        });
      }
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
    regime: {
      id: regime.id,
      name: regime.name,
      affected_sectors: affectedSectors,
    },
    offset,
    has_more: stocks.length === limit,
  };
}

/**
 * Evaluate a stock as a potential regime transition beneficiary.
 */
function evaluateBeneficiary(stock) {
  const reasons = [];

  // --- Scaling exponent: revenue growth rate / asset growth rate > 1.0 (superlinear) ---
  let scalingExponent = null;
  if (stock.rev_y1 > 0 && stock.rev_y2 > 0 && stock.assets_y1 > 0 && stock.assets_y2 > 0) {
    const revenueGrowth = (stock.rev_y1 - stock.rev_y2) / stock.rev_y2;
    const assetGrowth = (stock.assets_y1 - stock.assets_y2) / stock.assets_y2;
    if (assetGrowth > 0.01) {
      // Only compute if assets actually grew (avoid division by near-zero)
      scalingExponent = revenueGrowth / assetGrowth;
    } else if (revenueGrowth > 0) {
      // Revenue growing with flat/declining assets = very superlinear
      scalingExponent = 2.0;
    }
  }

  if (scalingExponent == null) {
    reasons.push('insufficient_data_for_scaling_exponent');
  } else if (scalingExponent <= 1.0) {
    reasons.push(`scaling_exponent_sublinear: ${scalingExponent.toFixed(2)}`);
  }

  // --- Balance sheet: debt/equity < 3.0 ---
  let debtEquity = null;
  if (stock.shareholder_equity != null && stock.shareholder_equity > 0 && stock.total_debt != null) {
    debtEquity = stock.total_debt / stock.shareholder_equity;
    if (debtEquity >= 3.0) {
      reasons.push(`debt_equity_high: ${debtEquity.toFixed(2)}`);
    }
  }

  // --- Balance sheet: current_ratio > 0.8 ---
  let currentRatio = null;
  if (stock.current_assets != null && stock.current_liabilities != null && stock.current_liabilities > 0) {
    currentRatio = stock.current_assets / stock.current_liabilities;
    if (currentRatio <= 0.8) {
      reasons.push(`current_ratio_low: ${currentRatio.toFixed(2)}`);
    }
  }

  const passes = reasons.length === 0;

  return {
    passes,
    fail_reason: reasons.length > 0 ? reasons.join('; ') : null,
    scaling_exponent: scalingExponent != null ? Math.round(scalingExponent * 100) / 100 : null,
    debt_equity: debtEquity != null ? Math.round(debtEquity * 100) / 100 : null,
    current_ratio: currentRatio != null ? Math.round(currentRatio * 100) / 100 : null,
  };
}

/**
 * Compute Consensus Saturation Index for a ticker relative to a regime.
 * CSI 0-3: count of saturated indicators. Pass if CSI <= 1.
 * @param {object} db - D1 database
 * @param {string} ticker
 * @param {object} regime - { start_date, ... }
 * @returns {{ csi_score, pass, interpretation }}
 */
export async function computeCSI(db, ticker, regime) {
  let saturatedCount = 0;

  // Get current market data
  const md = await db.prepare(
    'SELECT pe_ratio, pb_ratio FROM market_data WHERE ticker = ?'
  ).bind(ticker).first();

  // Get market cap history: current vs regime start date
  const stock = await db.prepare(
    'SELECT market_cap FROM stocks WHERE ticker = ?'
  ).bind(ticker).first();

  // --- Indicator 1: Valuation premium vs pre-regime average ---
  // Get pre-regime P/E (average of 2 fiscal years before regime start)
  const regimeStartYear = regime.start_date
    ? parseInt(regime.start_date.split('-')[0])
    : new Date().getFullYear() - 1;

  const preRegimeFin = await db.prepare(
    `SELECT AVG(CASE WHEN f.eps > 0 THEN NULL ELSE NULL END) as avg_eps,
            AVG(f.revenue) as avg_revenue,
            AVG(f.net_income) as avg_ni
     FROM financials f
     WHERE f.ticker = ? AND f.fiscal_year BETWEEN ? AND ?`
  ).bind(ticker, regimeStartYear - 2, regimeStartYear - 1).first();

  // Simplified: if current P/E is 2x or more than a reasonable historical range, flag saturated
  if (md?.pe_ratio && md.pe_ratio > 0) {
    // Get historical P/E proxy from pre-regime earnings
    const historicalFin = await db.prepare(
      `SELECT eps, revenue, net_income FROM financials
       WHERE ticker = ? AND fiscal_year BETWEEN ? AND ?
       ORDER BY fiscal_year DESC`
    ).bind(ticker, regimeStartYear - 2, regimeStartYear - 1).all();

    const historicalEarnings = (historicalFin.results || [])
      .filter(f => f.eps && f.eps > 0)
      .map(f => f.eps);

    if (historicalEarnings.length > 0) {
      const avgHistEPS = historicalEarnings.reduce((a, b) => a + b, 0) / historicalEarnings.length;
      // Approximate historical P/E using current price / historical EPS
      const currentPrice = await db.prepare(
        'SELECT price FROM market_data WHERE ticker = ?'
      ).bind(ticker).first();
      if (currentPrice?.price && avgHistEPS > 0) {
        const impliedHistPE = currentPrice.price / avgHistEPS;
        // If current P/E is >=2x what it "should be" based on historical earnings
        if (md.pe_ratio >= impliedHistPE * 0.5 && impliedHistPE > 0) {
          // Compare actual P/E ratio expansion
          const peRatio = md.pe_ratio / impliedHistPE;
          if (peRatio >= 2.0) {
            saturatedCount++;
          }
        }
      }
    }
  }

  // --- Indicator 2: High P/E AND large market cap growth ---
  // Simplified proxy: P/E > 30 signals potential over-recognition
  if (md?.pe_ratio && md.pe_ratio > 30) {
    saturatedCount++;
  }

  // --- Indicator 3: P/S premium (if available via market_cap / revenue) ---
  if (stock?.market_cap) {
    const latestRev = await db.prepare(
      `SELECT revenue FROM financials WHERE ticker = ?
       ORDER BY fiscal_year DESC LIMIT 1`
    ).bind(ticker).first();
    if (latestRev?.revenue && latestRev.revenue > 0) {
      // market_cap is in millions in stocks table, revenue in raw dollars
      const psRatio = (stock.market_cap * 1e6) / latestRev.revenue;
      if (psRatio > 15) {
        saturatedCount++;
      }
    }
  }

  const csiScore = Math.min(saturatedCount, 3);
  const pass = csiScore <= 1;

  let interpretation;
  if (csiScore === 0) interpretation = 'contrarian';
  else if (csiScore === 1) interpretation = 'emerging';
  else interpretation = 'consensus';

  return {
    csi_score: csiScore,
    pass,
    interpretation,
  };
}

/**
 * Store Tier 4 beneficiary passes as candidates.
 */
export async function storeTier4Candidates(db, candidates) {
  let stored = 0;

  for (const c of candidates) {
    await upsertCandidate(db, {
      ticker: c.ticker,
      discovery_tier: 'tier4',
      regime_id: c.regime_id || null,
      discovered_date: new Date().toISOString(),
      prescreen_pass: true,
      prescreen_data: {
        scaling_exponent: c.scaling_exponent,
        debt_equity: c.debt_equity,
        current_ratio: c.current_ratio,
      },
      scaling_exponent: c.scaling_exponent,
      csi_score: c.csi_score,
      csi_interpretation: c.csi_interpretation,
    });
    stored++;
  }

  return stored;
}
