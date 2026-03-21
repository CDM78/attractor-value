// DKS (Dynamic Kinetic Stability) Flywheel Evaluator
// Uses Claude to evaluate whether a Tier 3 candidate has a genuine
// self-reinforcing competitive position (flywheel/DKS feedback loop).
// Results cached 90 days in the candidates table.

const DKS_EVALUATION_PROMPT = `DKS EVALUATION for {company_name} ({ticker}):

Financial data: {financials_summary}
10-K MD&A excerpt: {mda_text}
Recent news: {recent_news}

EVALUATE:
1. FLYWHEEL IDENTIFICATION: What specific self-reinforcing mechanism does
   this company have? (e.g., "more merchants → more app developers →
   better platform → more merchants"). If you cannot identify a specific
   flywheel, the company fails this evaluation.

2. FLYWHEEL EVIDENCE: Is the flywheel actually spinning?
   - Revenue retention (if SaaS): >100% net dollar retention?
   - Gross margins: stable or expanding while revenue grows?
   - Customer acquisition cost: declining as % of revenue?
   - Per-customer revenue: increasing over time?
   Score the evidence 1-5.

3. FLYWHEEL VULNERABILITY: What could break it?
   - Can a larger competitor bundle equivalent functionality?
   - Is the data moat replicable?
   - Could an open standard emerge?
   - Is there a technology risk (like LLMs destroying Chegg)?
   Score the vulnerability 1-5 (5 = very defensible).

4. MOAT TYPE: network_effect | switching_cost | data_moat | platform | scale | brand

5. SUPERLINEAR SCALING: Compute from provided data:
   Revenue growth rate vs employee/asset growth rate.
   Exponent > 1.0 = superlinear (self-reinforcing).

Respond in JSON:
{
  "flywheel_identified": true/false,
  "flywheel_description": "...",
  "evidence_score": N,
  "vulnerability_score": N,
  "moat_type": "...",
  "scaling_exponent": N.N,
  "overall_dks_score": N.N,
  "proceed_to_attractor": true/false,
  "reasoning": "..."
}

Proceed only if flywheel_identified AND overall_dks_score >= 3.0.`;

/**
 * Run DKS evaluation for a Tier 3 candidate.
 * @param {string} ticker - Stock ticker
 * @param {object} env - Worker env with API keys
 * @param {object} db - D1 database
 * @returns {object} DKS evaluation results
 */
export async function evaluateDKS(ticker, env, db) {
  // Gather context data
  const [financials, mdaText, recentNews] = await Promise.allSettled([
    getFinancialsSummary(db, ticker),
    getMDAExcerpt(ticker, env),
    getRecentNews(ticker, env),
  ]);

  const financialsSummary = financials.status === 'fulfilled' ? financials.value : 'No financial data available';
  const mda = mdaText.status === 'fulfilled' ? mdaText.value : 'MD&A not available';
  const news = recentNews.status === 'fulfilled' ? recentNews.value : 'No recent news';

  // Get company name
  const stockRow = await db.prepare('SELECT company_name FROM stocks WHERE ticker = ?').bind(ticker).first();
  const companyName = stockRow?.company_name || ticker;

  // Build prompt
  const prompt = DKS_EVALUATION_PROMPT
    .replace('{company_name}', companyName)
    .replace('{ticker}', ticker)
    .replace('{financials_summary}', financialsSummary)
    .replace('{mda_text}', mda)
    .replace('{recent_news}', news);

  // Call Claude
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    throw new Error(`Claude DKS evaluation failed: ${claudeRes.status} ${errText}`);
  }

  const claudeData = await claudeRes.json();
  const responseText = claudeData.content?.[0]?.text || '';

  // Parse JSON response
  let result;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (e) {
    console.error(`DKS parse error for ${ticker}:`, e.message);
    return {
      ticker,
      error: 'Failed to parse DKS evaluation',
      raw_response: responseText.slice(0, 500),
    };
  }

  if (!result) {
    return { ticker, error: 'No valid JSON in DKS response' };
  }

  return {
    ticker,
    company_name: companyName,
    flywheel_identified: result.flywheel_identified || false,
    flywheel_description: result.flywheel_description || null,
    evidence_score: result.evidence_score || 0,
    vulnerability_score: result.vulnerability_score || 0,
    moat_type: result.moat_type || null,
    scaling_exponent: result.scaling_exponent || null,
    overall_dks_score: result.overall_dks_score || 0,
    proceed_to_attractor: result.proceed_to_attractor || false,
    reasoning: result.reasoning || null,
  };
}

/**
 * Update candidate record with DKS evaluation results.
 */
export async function storeDKSResults(db, ticker, dksResult) {
  await db.prepare(`
    UPDATE candidates SET
      dks_score = ?,
      flywheel_description = ?,
      moat_type = ?,
      scaling_exponent = ?,
      signal = CASE WHEN ? = 0 THEN 'PASS' ELSE signal END,
      signal_reason = CASE WHEN ? = 0 THEN 'DKS score below threshold' ELSE signal_reason END
    WHERE ticker = ? AND discovery_tier = 'tier3' AND status = 'active'
  `).bind(
    dksResult.overall_dks_score,
    dksResult.flywheel_description,
    dksResult.moat_type,
    dksResult.scaling_exponent,
    dksResult.proceed_to_attractor ? 1 : 0,
    dksResult.proceed_to_attractor ? 1 : 0,
    ticker
  ).run();
}

// --- Helper functions to gather context data ---

async function getFinancialsSummary(db, ticker) {
  const rows = await db.prepare(
    'SELECT * FROM financials WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT 5'
  ).bind(ticker).all();

  const results = rows.results || [];
  if (results.length === 0) return 'No financial data available';

  const lines = ['5-Year Financial Summary:'];
  lines.push('Year | Revenue | Net Income | FCF | Operating CF | Total Assets');
  for (const r of results) {
    const fmt = (v) => v != null ? `$${(v / 1e6).toFixed(0)}M` : 'N/A';
    lines.push(`${r.fiscal_year} | ${fmt(r.revenue)} | ${fmt(r.net_income)} | ${fmt(r.free_cash_flow)} | ${fmt(r.operating_cash_flow)} | ${fmt(r.total_assets)}`);
  }

  // Compute revenue CAGR if possible
  if (results.length >= 3 && results[0].revenue > 0 && results[results.length - 1].revenue > 0) {
    const years = results[0].fiscal_year - results[results.length - 1].fiscal_year;
    if (years > 0) {
      const cagr = Math.pow(results[0].revenue / results[results.length - 1].revenue, 1 / years) - 1;
      lines.push(`Revenue CAGR (${years}yr): ${(cagr * 100).toFixed(1)}%`);
    }
  }

  return lines.join('\n');
}

async function getMDAExcerpt(ticker, env) {
  try {
    const { fetchMDA } = await import('./edgar.js');
    const mda = await fetchMDA(ticker);
    if (mda && mda.length > 100) {
      // Truncate to ~3000 tokens (~12000 chars)
      return mda.slice(0, 12000);
    }
  } catch (e) {
    console.log(`No MD&A available for ${ticker}: ${e.message}`);
  }
  return 'MD&A not available for this company.';
}

async function getRecentNews(ticker, env) {
  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${thirtyDaysAgo()}&to=${today()}&token=${env.FINNHUB_API_KEY}`;
    const res = await fetch(url);
    if (res.ok) {
      const news = await res.json();
      if (news && news.length > 0) {
        return news.slice(0, 10).map(n => `- ${n.headline}`).join('\n');
      }
    }
  } catch (e) {
    console.log(`No news available for ${ticker}: ${e.message}`);
  }
  return 'No recent news available.';
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}
