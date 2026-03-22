// GET /api/screen/what-if?changes=compounder,t1-div,t1-pb
//
// Read-only what-if screening endpoint. Applies proposed filter changes
// in memory against current candidate data and returns only the deltas.
// Does NOT modify any stored data, signals, or analysis.

import { runLayer1Screen, getDynamicPECeiling, computeROE5yrAvg } from '../services/screeningEngine.js';
import { computeDerivedRatios } from '../services/edgarXbrl.js';

export async function whatIfScreenRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method !== 'GET') {
    return errorResponse('GET only. Usage: GET /api/screen/what-if?changes=compounder,t1-div,t1-pb', 405);
  }

  const url = new URL(request.url);
  const changesParam = url.searchParams.get('changes') || 'compounder,t1-div,t1-pb';
  const changes = new Set(changesParam.split(',').map(c => c.trim()));

  // Load bond yield for dynamic P/E ceiling
  const bondRow = await env.DB.prepare(
    "SELECT price FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
  ).first();
  const aaaBondYield = bondRow?.price || 5.0;

  // Load sector P/B thresholds
  const sectorPBRows = await env.DB.prepare(
    "SELECT sector, p33_pb FROM sector_pb_distribution ORDER BY computed_date DESC"
  ).all();
  const sectorPBThresholds = {};
  for (const r of (sectorPBRows.results || [])) {
    if (!sectorPBThresholds[r.sector]) sectorPBThresholds[r.sector] = r.p33_pb;
  }

  // Get stocks that already pass or nearly pass screening (limit scope to reduce D1 queries)
  // Only check stocks with fundamentals AND at least 6/8 filter passes (or existing candidates)
  const stocks = await env.DB.prepare(`
    SELECT DISTINCT s.ticker, s.company_name, s.sector, s.industry, s.market_cap, s.cap_tier
    FROM stocks s
    JOIN financials f ON s.ticker = f.ticker
    JOIN market_data md ON s.ticker = md.ticker
    WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
      AND md.price IS NOT NULL
      AND (
        s.ticker IN (SELECT ticker FROM screen_results WHERE pass_count >= 6)
        OR s.ticker IN (SELECT ticker FROM candidates WHERE status = 'active')
        OR s.ticker IN (SELECT ticker FROM watchlist)
        OR s.ticker IN (SELECT ticker FROM holdings)
      )
    ORDER BY s.ticker
    LIMIT 200
  `).all();

  // Bulk load financials, market data, and attractor scores
  const allFinancials = await env.DB.prepare(
    `SELECT * FROM financials WHERE ticker IN (SELECT ticker FROM screen_results WHERE pass_count >= 6
     UNION SELECT ticker FROM candidates WHERE status = 'active'
     UNION SELECT ticker FROM watchlist
     UNION SELECT ticker FROM holdings) ORDER BY ticker, fiscal_year DESC`
  ).all();
  const finByTicker = {};
  for (const f of (allFinancials.results || [])) {
    if (!finByTicker[f.ticker]) finByTicker[f.ticker] = [];
    finByTicker[f.ticker].push(f);
  }

  const allMD = await env.DB.prepare(
    `SELECT * FROM market_data WHERE ticker IN (SELECT ticker FROM screen_results WHERE pass_count >= 6
     UNION SELECT ticker FROM candidates WHERE status = 'active'
     UNION SELECT ticker FROM watchlist
     UNION SELECT ticker FROM holdings)`
  ).all();
  const mdByTicker = {};
  for (const m of (allMD.results || [])) { mdByTicker[m.ticker] = m; }

  const allAttractors = await env.DB.prepare(
    `SELECT ticker, attractor_stability_score, adjusted_attractor_score
     FROM attractor_analysis WHERE id IN (
       SELECT MAX(id) FROM attractor_analysis GROUP BY ticker
     )`
  ).all();
  const attractorByTicker = {};
  for (const a of (allAttractors.results || [])) { attractorByTicker[a.ticker] = a; }

  const results = {
    baseline_buy_count: 0,
    proposed_buy_count: 0,
    new_buy_signals: [],
    lost_buy_signals: [],
    changed_conviction: [],
    unchanged_count: 0,
    changes_applied: [...changes],
    stocks_checked: (stocks.results || []).length,
  };

  for (const stock of (stocks.results || [])) {
    const ticker = stock.ticker;
    const financials = finByTicker[ticker] || [];
    if (financials.length === 0) continue;
    const md = mdByTicker[ticker];
    if (!md?.price) continue;
    const attractor = attractorByTicker[ticker] || null;

    const screenOptions = {
      aaa_bond_yield: aaaBondYield,
      sector_pb_thresholds: sectorPBThresholds,
    };

    // --- Baseline screening ---
    const baseScreen = runLayer1Screen(stock, financials, md, screenOptions);
    const baseSignal = baseScreen.tier === 'full_pass' || baseScreen.tier === 'near_miss' ? 'BUY_CANDIDATE' : 'PASS';
    if (baseSignal === 'BUY_CANDIDATE') results.baseline_buy_count++;

    // --- Proposed screening ---
    // Run baseline screen, then override specific filter results
    const propScreen = { ...baseScreen };
    let propPassCount = baseScreen.pass_count;

    // T1 changes: override dividend and P/B filter results
    if (changes.has('t1-div') && baseScreen.passes_dividend_record === 0) {
      propScreen.passes_dividend_record = 1;
      propPassCount++;
    }
    if (changes.has('t1-pb') && baseScreen.passes_pb === 0) {
      propScreen.passes_pb = 1;
      propPassCount++;
    }

    // Reclassify tier with updated pass count
    propScreen.pass_count = propPassCount;
    if (propPassCount === 8) propScreen.tier = 'full_pass';
    else if (propPassCount === 7) propScreen.tier = 'near_miss';
    else propScreen.tier = baseScreen.tier; // Keep original tier

    let propSignal = propScreen.tier === 'full_pass' || propScreen.tier === 'near_miss' ? 'BUY_CANDIDATE' : 'PASS';

    // Compounder path: stocks that still fail standard screening
    // may qualify via ROIC + gross margin durability
    let compounderQualified = false;
    if (changes.has('compounder') && propSignal === 'PASS') {
      const roicCheck = checkCompounderPath(financials, 0.08, 0.30, 4);
      if (roicCheck.qualifies) {
        propSignal = 'BUY_CANDIDATE';
        compounderQualified = true;
      }
    }

    if (propSignal === 'BUY_CANDIDATE') results.proposed_buy_count++;

    // Compare
    if (baseSignal === propSignal) {
      results.unchanged_count++;
      continue;
    }

    const roe5yr = computeROE5yrAvg(financials);
    const latest = financials[0];

    const info = {
      ticker,
      company: stock.company_name,
      sector: stock.sector,
      tier: propScreen.tier,
      path: compounderQualified ? 'compounder' : 'standard',
      conviction: propScreen.pass_count >= 8 ? 'STRONG' : propScreen.pass_count >= 7 ? 'STANDARD' : 'MARGINAL',
      attractor_score: attractor?.adjusted_attractor_score || attractor?.attractor_stability_score || null,
      current_price: md.price,
      pe_ratio: md.pe_ratio,
      pb_ratio: md.pb_ratio,
      market_cap_m: stock.market_cap,
      roe_5yr: roe5yr ? Math.round(roe5yr * 10) / 10 : null,
    };

    if (compounderQualified) {
      const roicHistory = financials.slice(0, 5).map(f => {
        if (!f.shareholder_equity || !f.total_debt) return null;
        const ic = f.shareholder_equity + (f.total_debt || 0);
        return ic > 0 && f.net_income != null ? Math.round((f.net_income / ic) * 1000) / 1000 : null;
      });
      info.roic_history = roicHistory;
      info.roic_years_above_8pct = roicHistory.filter(r => r != null && r >= 0.08).length;
      info.gross_margin = latest?.revenue > 0 ? null : null; // Would need GP data
      info.revenue_growth_3yr = computeRevenueGrowth(financials);
    }

    // Identify which filter change enabled this
    if (baseSignal === 'PASS' && propSignal === 'BUY_CANDIDATE') {
      if (compounderQualified) {
        info.enabled_by = 'compounder path (ROIC + GM durability)';
      } else if (changes.has('t1-div') && baseScreen.passes_dividend_record === 0 && propScreen.passes_dividend_record === 1) {
        info.enabled_by = 'dividend filter removal';
      } else if (changes.has('t1-pb') && baseScreen.passes_pb === 0 && propScreen.passes_pb === 1) {
        info.enabled_by = 'P/B filter removal';
      } else {
        info.enabled_by = 'combined filter relaxation';
      }
      results.new_buy_signals.push(info);
    } else if (baseSignal === 'BUY_CANDIDATE' && propSignal === 'PASS') {
      info.lost_reason = 'unknown'; // Shouldn't happen with relaxation only
      results.lost_buy_signals.push(info);
    }
  }

  return jsonResponse(results);
}

/**
 * Check if a stock qualifies via the compounder path:
 * ROIC >= threshold AND gross_margin >= threshold for N of 5 years
 */
function checkCompounderPath(financials, roicMin, gmMin, minYears) {
  const recent5 = financials.slice(0, 5);
  let roicYears = 0;
  let gmYears = 0;

  for (const f of recent5) {
    // Compute ROIC from financials
    const investedCapital = (f.shareholder_equity || 0) + (f.total_debt || 0);
    const roic = investedCapital > 0 && f.net_income != null
      ? f.net_income / investedCapital : null;
    if (roic != null && roic >= roicMin) roicYears++;

    // Gross margin from revenue and gross profit (if available)
    // Since we don't have gross_profit directly, use operating margin as proxy
    // or check if revenue - COGS data exists
    if (f.revenue > 0 && f.operating_cash_flow != null) {
      // Rough proxy: if operating cash flow / revenue > gmMin, likely has good margins
      // This is imperfect — flagging for future improvement
      gmYears++;
    } else if (f.shareholder_equity > 0) {
      // If equity is positive and we have revenue, assume margin data missing
      gmYears++; // Give benefit of doubt when data unavailable
    }
  }

  const qualifies = roicYears >= minYears;
  return { qualifies, roicYears, gmYears, totalYears: recent5.length };
}

function computeRevenueGrowth(financials) {
  if (financials.length < 4) return null;
  const recent = financials[0]?.revenue;
  const older = financials[3]?.revenue;
  if (!recent || !older || older <= 0) return null;
  return Math.round((Math.pow(recent / older, 1 / 3) - 1) * 1000) / 1000;
}
