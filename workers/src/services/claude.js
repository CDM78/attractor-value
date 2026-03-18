// Anthropic Claude API — Attractor Stability Analysis (Layer 3)
// Uses Claude Sonnet for cost efficiency (~$0.02-0.03 per analysis)

import { CONCENTRATION_RISK } from '../../../shared/constants.js';
import { isFinancialSector } from '../../../shared/sectorUtils.js';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

export async function analyzeAttractorStability(ticker, companyName, financialContext, mdaText, newsContext, apiKey) {
  const prompt = buildAnalysisPrompt(ticker, companyName, financialContext, mdaText, newsContext);

  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const responseText = data.content?.[0]?.text;
  if (!responseText) throw new Error('Empty Claude response');

  // Log token usage for cost tracking
  const usage = data.usage || {};
  console.log(`Claude analysis for ${ticker}: input=${usage.input_tokens}, output=${usage.output_tokens}, cost≈$${estimateCost(usage)}`);

  return parseAnalysisResponse(responseText, ticker);
}

function estimateCost(usage) {
  // Sonnet pricing: $3/M input, $15/M output
  const inputCost = (usage.input_tokens || 0) * 3 / 1_000_000;
  const outputCost = (usage.output_tokens || 0) * 15 / 1_000_000;
  return (inputCost + outputCost).toFixed(4);
}

function buildAnalysisPrompt(ticker, companyName, financialContext, mdaText, newsContext) {
  return `You are a value investing analyst using the Attractor Value Framework. Analyze ${companyName} (${ticker}) for attractor stability.

FRAMEWORK: A "stable attractor" is a business whose competitive position and earnings power are self-reinforcing — pulled back toward equilibrium after perturbation. Score each factor 1-5:

1. **Revenue Durability** (1-5): How recurring, diversified, and switching-cost-protected is revenue?
2. **Competitive Reinforcement** (1-5): Do competitive advantages compound over time (brand, scale, patents, network effects)?
3. **Industry Structure** (1-5): Is the industry consolidated with rational competition, or fragmented with price wars?
4. **Demand Feedback** (1-5): Does customer behavior create positive feedback loops (habit, ecosystem lock-in)?
5. **Adaptation Capacity** (1-5): Can the company adapt to disruption without destroying its core attractor?
6. **Capital Allocation** (1-5): Track record of disciplined capital deployment (returns > cost of capital, sensible M&A, buybacks at discount)?

NETWORK REGIME: Classify as one of:
- **classical**: Traditional competitive advantages (brand, scale, cost)
- **soft_network**: Mild network effects, switching costs
- **hard_network**: Strong network effects, winner-take-most
- **platform**: Multi-sided platform dynamics

CONCENTRATION RISK: Identify any of these from the filing data:
- Customer concentration: any single customer ≥25% of revenue
- Supplier concentration: critical single-source suppliers
- Geographic concentration: ≥70% revenue from single foreign market
- Regulatory concentration: ≥50% revenue tied to single regulation/license/contract

RED FLAGS: List any concerns that could indicate attractor dissolution (phase transition risk).

FINANCIAL DATA:
${financialContext}

${mdaText ? `10-K MD&A EXCERPT:\n${mdaText}\n` : 'No 10-K filing data available. Base analysis on financial data and public knowledge.'}

${newsContext || ''}

Respond in EXACTLY this JSON format (no markdown, no code fences):
{
  "revenue_durability_score": <1-5>,
  "competitive_reinforcement_score": <1-5>,
  "industry_structure_score": <1-5>,
  "demand_feedback_score": <1-5>,
  "adaptation_capacity_score": <1-5>,
  "capital_allocation_score": <1-5>,
  "network_regime": "<classical|soft_network|hard_network|platform>",
  "red_flags": ["flag1", "flag2"],
  "concentration_risk": {
    "largest_customer_pct": <number or null>,
    "largest_customer_name": "<name or null>",
    "customers_above_10pct": <count>,
    "single_source_supplier": <true/false>,
    "supplier_details": "<description or null>",
    "largest_geo_market_pct": <number or null>,
    "largest_geo_market_name": "<name or null>",
    "regulatory_dependency_pct": <number or null>,
    "regulatory_details": "<description or null>"
  },
  "analysis_text": "<2-3 paragraph analysis explaining your reasoning, what makes this attractor stable or unstable, and key risks>",
  "sources_used": ["financial_data", "10k_mda", "news"]
}`;
}

function parseAnalysisResponse(responseText, ticker) {
  // Try to extract JSON from the response
  let json;
  try {
    json = JSON.parse(responseText);
  } catch {
    // Try to find JSON within the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse Claude response as JSON');
    json = JSON.parse(jsonMatch[0]);
  }

  // Compute composite attractor score (average of 6 factors)
  const factors = [
    json.revenue_durability_score,
    json.competitive_reinforcement_score,
    json.industry_structure_score,
    json.demand_feedback_score,
    json.adaptation_capacity_score,
    json.capital_allocation_score,
  ].filter(f => f != null && f >= 1 && f <= 5);

  const rawScore = factors.length > 0
    ? factors.reduce((s, f) => s + f, 0) / factors.length
    : null;

  // Apply concentration risk penalty
  const cr = json.concentration_risk || {};
  let concentrationPenalty = 0;
  if (cr.largest_customer_pct >= 40) concentrationPenalty += CONCENTRATION_RISK.customer_40pct;
  else if (cr.largest_customer_pct >= 25) concentrationPenalty += CONCENTRATION_RISK.customer_25pct;
  if (cr.single_source_supplier) concentrationPenalty += CONCENTRATION_RISK.supplier_single_source;
  if (cr.largest_geo_market_pct >= 70) concentrationPenalty += CONCENTRATION_RISK.geographic_70pct;
  if (cr.regulatory_dependency_pct >= 50) concentrationPenalty += CONCENTRATION_RISK.regulatory_50pct;

  const adjustedScore = rawScore != null
    ? Math.max(CONCENTRATION_RISK.adjusted_score_floor, rawScore - concentrationPenalty)
    : null;

  return {
    ticker,
    analysis_date: new Date().toISOString().split('T')[0],
    revenue_durability_score: json.revenue_durability_score,
    competitive_reinforcement_score: json.competitive_reinforcement_score,
    industry_structure_score: json.industry_structure_score,
    demand_feedback_score: json.demand_feedback_score,
    adaptation_capacity_score: json.adaptation_capacity_score,
    capital_allocation_score: json.capital_allocation_score,
    attractor_stability_score: adjustedScore != null ? Math.round(adjustedScore * 10) / 10 : null,
    network_regime: json.network_regime,
    red_flags: JSON.stringify(json.red_flags || []),
    analysis_text: json.analysis_text || '',
    sources_used: JSON.stringify(json.sources_used || []),
    concentration_risk: {
      ...cr,
      concentration_penalty: concentrationPenalty,
    },
  };
}

// Build financial context string from DB data (sector-aware for financials)
export function buildFinancialContext(stock, financials, marketData, valuation, insiderSignal) {
  const lines = [];
  const isFinancial = isFinancialSector(stock);

  lines.push(`Company: ${stock.company_name} (${stock.ticker})`);
  lines.push(`Sector: ${stock.sector || 'Unknown'} | Industry: ${stock.industry || 'Unknown'}`);

  if (marketData) {
    lines.push(`Current Price: $${marketData.price?.toFixed(2)} | P/E: ${marketData.pe_ratio?.toFixed(1)} | P/B: ${marketData.pb_ratio?.toFixed(1)}`);
    lines.push(`Market Cap: $${stock.market_cap ? (stock.market_cap / 1e9).toFixed(1) + 'B' : 'Unknown'}`);
  }

  if (valuation) {
    lines.push(`Graham IV: $${valuation.adjusted_intrinsic_value?.toFixed(2)} | Discount: ${valuation.discount_to_iv_pct?.toFixed(1)}%`);
  }

  if (financials.length > 0) {
    lines.push(`\nFinancial History (${financials.length} years):`);
    if (isFinancial) {
      // Financial sector: show ROE instead of ROIC, Debt/Capital instead of D/E
      for (const f of financials.slice(0, 5)) {
        const roe = f.net_income && f.shareholder_equity > 0
          ? ((f.net_income / f.shareholder_equity) * 100).toFixed(1) + '%'
          : 'N/A';
        const totalCapital = (f.total_debt || 0) + (f.shareholder_equity || 0);
        const debtToCapital = totalCapital > 0
          ? ((f.total_debt || 0) / totalCapital * 100).toFixed(1) + '%'
          : 'N/A';
        lines.push(`  ${f.fiscal_year}: EPS=$${f.eps?.toFixed(2)}, Rev=$${f.revenue ? (f.revenue / 1e9).toFixed(1) + 'B' : 'N/A'}, BVPS=$${f.book_value_per_share?.toFixed(2) || 'N/A'}, ROE=${roe}, Debt/Capital=${debtToCapital}`);
      }
      lines.push(`\nNOTE: This company is classified as ${stock.industry || stock.sector || 'Financial'}.`);
      lines.push(`Financial metrics have been adjusted for sector norms:`);
      lines.push(`- ROE is provided instead of ROIC (ROIC is not meaningful for financial companies)`);
      lines.push(`- Leverage shown as Debt/Total Capital, not Debt/Equity`);
      lines.push(`- Standard D/E and current ratio filters were auto-passed (financial sector exemption)`);
      lines.push(`\nEvaluate capital allocation discipline using ROE trends and book value per share growth rather than ROIC vs. cost of capital.`);
    } else {
      for (const f of financials.slice(0, 5)) {
        lines.push(`  ${f.fiscal_year}: EPS=$${f.eps?.toFixed(2)}, Rev=$${f.revenue ? (f.revenue / 1e9).toFixed(1) + 'B' : 'N/A'}, FCF=$${f.free_cash_flow ? (f.free_cash_flow / 1e6).toFixed(0) + 'M' : 'N/A'}, D/E=${f.shareholder_equity > 0 ? (f.total_debt / f.shareholder_equity).toFixed(2) : 'N/A'}, ROIC=${f.roic ? f.roic.toFixed(1) + '%' : 'N/A'}`);
      }
    }
  }

  // Include insider signal if available
  if (insiderSignal) {
    lines.push(`\nINSIDER ACTIVITY (90-day window):`);
    lines.push(`Signal: ${insiderSignal.signal} — ${insiderSignal.signal_details}`);
    lines.push(`Buys: ${insiderSignal.trailing_90d_buys} transactions ($${((insiderSignal.trailing_90d_buy_value || 0) / 1000).toFixed(0)}K)`);
    lines.push(`Sells: ${insiderSignal.trailing_90d_sells} transactions ($${((insiderSignal.trailing_90d_sell_value || 0) / 1000).toFixed(0)}K)`);
    lines.push(`Unique buyers: ${insiderSignal.unique_buyers_90d}`);
  }

  return lines.join('\n');
}
