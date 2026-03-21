// Consensus Saturation Index (CSI) — Standalone Calculator
// Measures how "consensus" or "contrarian" a regime-transition thesis is.
// Uses Finnhub news mentions as analyst attention proxy plus valuation premium.

/**
 * Compute the Consensus Saturation Index for a ticker relative to a regime.
 * @param {string} ticker
 * @param {object} regime - { name, regime_keywords, start_date, ... }
 * @param {object} db - D1 database
 * @param {object} env - Worker env (needs FINNHUB_API_KEY)
 * @returns {{ csi_score: number, pass: boolean, interpretation: string, components: object }}
 */
export async function computeCSI(ticker, regime, db, env) {
  const components = {
    news_mention_score: 0,
    valuation_premium_score: 0,
    pe_elevated: false,
  };

  // --- Component 1: News/analyst mention proxy via Finnhub ---
  // Count articles in last 30 days that mention regime keywords
  let newsScore = 0;
  try {
    const regimeKeywords = typeof regime.regime_keywords === 'string'
      ? JSON.parse(regime.regime_keywords)
      : regime.regime_keywords || [];

    if (regimeKeywords.length > 0 && env.FINNHUB_API_KEY) {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
      const toDate = now.toISOString().split('T')[0];

      const newsRes = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${fromDate}&to=${toDate}&token=${env.FINNHUB_API_KEY}`
      );

      if (newsRes.ok) {
        const articles = await newsRes.json();
        if (Array.isArray(articles)) {
          // Count articles whose headline or summary mentions any regime keyword
          const keywordsLower = regimeKeywords.map(k => k.toLowerCase());
          let mentionCount = 0;
          for (const article of articles) {
            const text = ((article.headline || '') + ' ' + (article.summary || '')).toLowerCase();
            if (keywordsLower.some(kw => text.includes(kw))) {
              mentionCount++;
            }
          }

          // Score: >= 10 mentions in 30 days = saturated (1 point)
          //        >= 20 mentions = highly saturated (adds to confidence)
          if (mentionCount >= 10) {
            newsScore = 1;
          }
          components.news_mention_count = mentionCount;
          components.total_articles = articles.length;
        }
      }
    }
  } catch (e) {
    console.error(`CSI news fetch error for ${ticker}:`, e.message);
    components.news_error = e.message;
  }
  components.news_mention_score = newsScore;

  // --- Component 2: Valuation premium from market data ---
  let valuationScore = 0;
  try {
    const md = await db.prepare(
      'SELECT price, pe_ratio, pb_ratio FROM market_data WHERE ticker = ?'
    ).bind(ticker).first();

    const stock = await db.prepare(
      'SELECT market_cap FROM stocks WHERE ticker = ?'
    ).bind(ticker).first();

    if (md?.pe_ratio && md.pe_ratio > 0) {
      // Get pre-regime earnings for comparison
      const regimeStartYear = regime.start_date
        ? parseInt(regime.start_date.split('-')[0])
        : new Date().getFullYear() - 1;

      const preRegimeEPS = await db.prepare(
        `SELECT AVG(eps) as avg_eps FROM financials
         WHERE ticker = ? AND fiscal_year BETWEEN ? AND ? AND eps > 0`
      ).bind(ticker, regimeStartYear - 2, regimeStartYear - 1).first();

      if (preRegimeEPS?.avg_eps > 0 && md.price > 0) {
        const impliedHistPE = md.price / preRegimeEPS.avg_eps;
        const premiumRatio = md.pe_ratio / impliedHistPE;

        components.implied_historical_pe = Math.round(impliedHistPE * 10) / 10;
        components.current_pe = md.pe_ratio;
        components.premium_ratio = Math.round(premiumRatio * 100) / 100;

        // Ratio >= 2.0 means current P/E is 2x+ what historical earnings would imply
        if (premiumRatio >= 2.0) {
          valuationScore = 1;
        }
      }
    }

    // P/S check if market cap and revenue available
    if (stock?.market_cap) {
      const latestRev = await db.prepare(
        'SELECT revenue FROM financials WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT 1'
      ).bind(ticker).first();
      if (latestRev?.revenue > 0) {
        const psRatio = (stock.market_cap * 1e6) / latestRev.revenue;
        components.ps_ratio = Math.round(psRatio * 10) / 10;
      }
    }
  } catch (e) {
    console.error(`CSI valuation error for ${ticker}:`, e.message);
    components.valuation_error = e.message;
  }
  components.valuation_premium_score = valuationScore;

  // --- Component 3: P/E elevated (simple threshold) ---
  try {
    const md = await db.prepare(
      'SELECT pe_ratio FROM market_data WHERE ticker = ?'
    ).bind(ticker).first();
    if (md?.pe_ratio && md.pe_ratio > 30) {
      components.pe_elevated = true;
    }
  } catch { /* ignore */ }
  const peScore = components.pe_elevated ? 1 : 0;

  // --- Aggregate CSI ---
  const csiScore = Math.min(newsScore + valuationScore + peScore, 3);
  const pass = csiScore <= 1;

  let interpretation;
  if (csiScore === 0) interpretation = 'contrarian';
  else if (csiScore === 1) interpretation = 'emerging';
  else interpretation = 'consensus';

  return {
    csi_score: csiScore,
    pass,
    interpretation,
    components,
  };
}
