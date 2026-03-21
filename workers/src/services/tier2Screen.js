// Tier 2: Crisis Dislocation — Pre-Screen & Impact Assessment
// Activates only during crisis periods. Scans for quality companies whose
// stock price decline is sector-driven (not company-specific), then uses
// Claude to assess whether the damage is temporary.

import { upsertCandidate } from '../db/queries.js';

/**
 * Run Tier 2 crisis dislocation pre-screen.
 * Only meaningful when crisis_active is true.
 * @param {object} db - D1 database
 * @param {object} crisisContext - from detectCrisis() { crisis_active, severity, stock_decline_threshold, ... }
 * @param {object} options - { limit, offset }
 */
export async function tier2PreScreen(db, crisisContext, options = {}) {
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  if (!crisisContext?.crisis_active) {
    return {
      scanned: 0,
      passes: 0,
      failures: 0,
      candidates: [],
      crisis_active: false,
      message: 'No crisis detected — Tier 2 screening inactive.',
    };
  }

  const declineThreshold = crisisContext.stock_decline_threshold || -0.20;

  // Query: join stocks + market_data + financials for screening data.
  // We need: price decline from pre-crisis (approximated by 52w high),
  //          earnings stability (positive EPS years), debt/equity, FCF, P/E, sector.
  const query = `
    SELECT
      s.ticker, s.company_name, s.sector, s.industry,
      md.price, s.market_cap, md.pe_ratio,
      s.pre_crisis_price, s.pre_crisis_date,
      -- Count of years with positive EPS (out of up to 10)
      (SELECT COUNT(*) FROM financials f
       WHERE f.ticker = s.ticker AND f.eps > 0
       ORDER BY f.fiscal_year DESC LIMIT 10) as positive_eps_years,
      (SELECT COUNT(*) FROM financials f
       WHERE f.ticker = s.ticker
       ORDER BY f.fiscal_year DESC LIMIT 10) as total_eps_years,
      -- Most recent fiscal year financials
      f1.total_debt, f1.shareholder_equity,
      f1.free_cash_flow, f1.fiscal_year as latest_fy,
      f1.current_assets, f1.current_liabilities
    FROM stocks s
    JOIN market_data md ON s.ticker = md.ticker
    LEFT JOIN financials f1 ON s.ticker = f1.ticker
      AND f1.fiscal_year = (SELECT MAX(fiscal_year) FROM financials WHERE ticker = s.ticker)
    WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
      AND md.price IS NOT NULL
      AND md.price > 0
      AND s.market_cap IS NOT NULL
    ORDER BY s.ticker
    LIMIT ? OFFSET ?
  `;

  const result = await db.prepare(query).bind(limit, offset).all();
  const stocks = result.results || [];

  const passes = [];
  const failures = [];

  for (const stock of stocks) {
    const screenResult = evaluateCrisisCandidate(stock, declineThreshold);
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
    crisis_context: {
      severity: crisisContext.severity,
      decline_threshold: declineThreshold,
    },
    offset,
    has_more: stocks.length === limit,
  };
}

/**
 * Evaluate a single stock against Tier 2 crisis dislocation criteria.
 */
function evaluateCrisisCandidate(stock, declineThreshold) {
  const reasons = [];

  // --- Price decline >= threshold (compared to pre-crisis snapshot) ---
  let priceDecline = null;
  if (stock.pre_crisis_price && stock.pre_crisis_price > 0 && stock.price) {
    priceDecline = (stock.price - stock.pre_crisis_price) / stock.pre_crisis_price;
    if (priceDecline > declineThreshold) {
      // Decline not large enough (declineThreshold is negative, e.g., -0.18)
      reasons.push(`price_decline_insufficient: ${(priceDecline * 100).toFixed(1)}% vs threshold ${(declineThreshold * 100).toFixed(1)}%`);
    }
  }
  // If no pre-crisis price snapshot exists, skip this check (crisis just started, snapshot pending)

  // --- Earnings stability: >= 7 of 10 years positive EPS ---
  const positiveYears = stock.positive_eps_years || 0;
  const totalYears = stock.total_eps_years || 0;
  // If fewer than 10 years of data, prorate: need 70% positive
  const stabilityRatio = totalYears > 0 ? positiveYears / Math.min(totalYears, 10) : 0;
  if (stabilityRatio < 0.7) {
    reasons.push(`earnings_stability_low: ${positiveYears}/${Math.min(totalYears, 10)} positive EPS years`);
  }

  // --- Debt/equity < 2.0 (auto-pass for financials) ---
  const isFinancial = stock.sector && stock.sector.toLowerCase().includes('financial');
  let debtEquity = null;
  if (!isFinancial) {
    if (stock.shareholder_equity != null && stock.shareholder_equity > 0 && stock.total_debt != null) {
      debtEquity = stock.total_debt / stock.shareholder_equity;
      if (debtEquity >= 2.0) {
        reasons.push(`debt_equity_high: ${debtEquity.toFixed(2)}`);
      }
    }
    // If we lack data, let it pass (data gap, not a disqualifier)
  }

  // --- Free cash flow positive ---
  const fcfPositive = stock.free_cash_flow != null ? stock.free_cash_flow > 0 : null;
  if (fcfPositive === false) {
    reasons.push('free_cash_flow_negative');
  }

  // --- P/E ratio < 40 ---
  if (stock.pe_ratio != null && stock.pe_ratio > 0 && stock.pe_ratio >= 40) {
    reasons.push(`pe_ratio_high: ${stock.pe_ratio.toFixed(1)}`);
  }

  const passes = reasons.length === 0;

  return {
    passes,
    fail_reason: reasons.length > 0 ? reasons.join('; ') : null,
    price_decline_pct: priceDecline != null ? Math.round(priceDecline * 1000) / 1000 : null,
    pre_crisis_price: stock.pre_crisis_price,
    earnings_stability: `${positiveYears}/${Math.min(totalYears, 10)}`,
    debt_equity: debtEquity != null ? Math.round(debtEquity * 100) / 100 : null,
    financial_sector_autopass: isFinancial,
    fcf_positive: fcfPositive,
    pe_ratio: stock.pe_ratio,
  };
}

/**
 * Assess crisis impact for a single ticker using Claude Sonnet.
 * Determines if revenue impact is temporary (dislocation) or structural.
 * @param {string} ticker
 * @param {object} crisisContext - { severity, sp500_decline, ... }
 * @param {object} env - Worker env (needs ANTHROPIC_API_KEY)
 * @param {object} db - D1 database
 * @returns {{ classification, confidence, reasoning, revenue_directly_affected, pre_existing_pressures, recovery_likely }}
 */
export async function assessCrisisImpact(ticker, crisisContext, env, db) {
  // Gather context
  const stockRow = await db.prepare(
    'SELECT company_name, sector, industry FROM stocks WHERE ticker = ?'
  ).bind(ticker).first();
  const companyName = stockRow?.company_name || ticker;
  const sector = stockRow?.sector || 'Unknown';
  const industry = stockRow?.industry || 'Unknown';

  // Recent financials summary
  const financials = await db.prepare(
    `SELECT fiscal_year, revenue, net_income, eps, free_cash_flow
     FROM financials WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT 3`
  ).bind(ticker).all();
  const finSummary = (financials.results || [])
    .map(f => `FY${f.fiscal_year}: Rev $${(f.revenue / 1e6).toFixed(0)}M, NI $${(f.net_income / 1e6).toFixed(0)}M, EPS $${f.eps?.toFixed(2)}, FCF $${(f.free_cash_flow / 1e6).toFixed(0)}M`)
    .join('\n');

  const prompt = `You are analyzing whether a stock's decline during a market crisis represents a temporary dislocation (buying opportunity) or reflects structural/fundamental damage.

Company: ${companyName} (${ticker})
Sector: ${sector} | Industry: ${industry}

Crisis context:
- Crisis severity: ${crisisContext.severity}
- S&P 500 decline from peak: ${((crisisContext.sp500_decline || 0) * 100).toFixed(1)}%
- VIX: ${crisisContext.vix || 'N/A'}
- Credit spread: ${crisisContext.credit_spread || 'N/A'}

Recent financials:
${finSummary || 'No financial data available'}

Assess these three questions:
1. Is the company's core revenue directly affected by the crisis catalyst? (e.g., a bank in a financial crisis = yes; a consumer staples company in a financial crisis = no)
2. Did the company have pre-existing competitive or structural pressures BEFORE the crisis? (declining market share, disrupted business model, regulatory headwinds)
3. Would revenue and margins likely recover within 12 months if the crisis resolved tomorrow?

Respond with ONLY a JSON object:
{
  "classification": "temporary_dislocation" | "structural_damage" | "uncertain",
  "confidence": 0.0-1.0,
  "revenue_directly_affected": true/false,
  "pre_existing_pressures": true/false,
  "recovery_likely_12mo": true/false,
  "reasoning": "1-2 sentence explanation"
}`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    throw new Error(`Claude crisis assessment failed: ${claudeRes.status} ${errText}`);
  }

  const claudeData = await claudeRes.json();
  const responseText = claudeData.content?.[0]?.text || '';

  let result;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (e) {
    console.error(`Crisis impact parse error for ${ticker}:`, e.message);
    return {
      ticker,
      error: 'Failed to parse crisis assessment',
      raw_response: responseText.slice(0, 500),
    };
  }

  if (!result) {
    return { ticker, error: 'No JSON in crisis assessment response' };
  }

  return {
    ticker,
    company_name: companyName,
    ...result,
  };
}

/**
 * Store Tier 2 pre-screen passes as candidates.
 */
export async function storeTier2Candidates(db, candidates) {
  let stored = 0;

  for (const c of candidates) {
    await upsertCandidate(db, {
      ticker: c.ticker,
      discovery_tier: 'tier2',
      discovered_date: new Date().toISOString(),
      prescreen_pass: true,
      prescreen_data: {
        earnings_stability: c.earnings_stability,
        debt_equity: c.debt_equity,
        financial_sector_autopass: c.financial_sector_autopass,
        fcf_positive: c.fcf_positive,
        pe_ratio: c.pe_ratio,
      },
      crisis_assessment: c.crisis_assessment || null,
      price_decline_pct: c.price_decline_pct || null,
    });
    stored++;
  }

  return stored;
}
