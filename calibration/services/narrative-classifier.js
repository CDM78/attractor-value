// Narrative Transition Mapping — Claude Sonnet API calls for narrative classification.
// Classifies current narrative, plausible transitions, asymmetry, and sequence position.

const NARRATIVE_ARCHETYPES = {
  DEEP_VALUE: 'Trading far below intrinsic value, market has given up',
  TURNAROUND: 'Was broken, showing signs of recovery',
  STABLE_COMPOUNDER: 'Boring, reliable, growing steadily',
  CASH_COW: 'Mature, declining growth, returning capital',
  HYPERGROWTH: 'Growing rapidly, market paying premium for TAM',
  VALIDATED_GROWTH: 'Growth proven sustainable, transitioning to profitability',
  GROWTH_DECELERATION: 'Still growing but rate is slowing, market nervous',
  VALUE_TRAP: 'Looks cheap but fundamentals deteriorating',
  BROKEN_GROWTH: 'Growth story ended, market has not fully repriced',
  SECULAR_DECLINE: 'Industry headwinds, no clear path forward',
  FRAUD_RISK: 'Accounting or governance questions',
  CYCLICAL_BOTTOM: 'Cyclical low, waiting for macro recovery',
  REGIME_BENEFICIARY: 'Positioned to benefit from structural shift',
  ACQUISITION_TARGET: 'Undervalued enough to attract acquirers',
  RECAPITALIZATION: 'Restructuring capital structure',
  FAIRLY_VALUED: 'Market has this about right',
  UNKNOWN: 'Insufficient coverage to classify',
};

const SYSTEM_PROMPT = `You are classifying the dominant market narrative about a company at a specific point in time. You will receive the company's financial data and recent news headlines as of that date.

Respond ONLY with a JSON object. No preamble, no markdown backticks.

{
  "current_narrative": "<one of: ${Object.keys(NARRATIVE_ARCHETYPES).join(', ')}>",
  "narrative_confidence": <0.0 to 1.0>,
  "plausible_transitions": [
    {
      "target_narrative": "<archetype key>",
      "probability": <0.0 to 1.0>,
      "catalyst": "<one sentence>",
      "price_impact_pct": <estimated % change>,
      "timeframe_months": <months>,
      "sequence_position": "<EARLY / MID / LATE>"
    }
  ],
  "transition_asymmetry": <-1.0 to 1.0, positive = upside-biased>,
  "dominant_transition_mode": "<single axis of narrative uncertainty>"
}

Rules:
- List 4-8 plausible transitions including both upside and downside.
- Probabilities should sum to ~1.0 (remainder = stays in current narrative).
- transition_asymmetry = probability-weighted average of price_impact_pct / 100.
- dominant_transition_mode = the single most important axis (e.g. "growth sustainability", "turnaround execution").
- sequence_position: EARLY = within 12mo, MID = 12-24mo, LATE = 24-36mo.
- Use ONLY information available at the entry date. No hindsight.`;

/**
 * Build the user prompt for narrative classification.
 */
export function buildNarrativePrompt(caseData) {
  const { ticker, company_name, entry_date, entry_price, gics_sector } = caseData;

  // Build context from available data
  let prompt = `Company: ${ticker} (${company_name || ticker})
Entry Date: ${entry_date}
Stock Price: $${entry_price || 'N/A'}
Sector: ${gics_sector || 'N/A'}`;

  if (caseData.pe) prompt += `\nP/E: ${caseData.pe}`;
  if (caseData.pb) prompt += `\nP/B: ${caseData.pb}`;
  if (caseData.revenue_trend) prompt += `\n3yr Revenue Trend: ${caseData.revenue_trend}`;
  if (caseData.headlines?.length > 0) {
    prompt += `\n\nRecent Headlines (30 days before entry):`;
    for (const h of caseData.headlines.slice(0, 10)) {
      prompt += `\n- ${h}`;
    }
  }

  return prompt;
}

/**
 * Call Claude Sonnet for narrative classification.
 * @param {string} apiKey - Anthropic API key
 * @param {Object} caseData - case data with ticker, entry_date, etc.
 * @returns {Object} parsed narrative classification
 */
export async function classifyNarrative(apiKey, caseData) {
  const userPrompt = buildNarrativePrompt(caseData);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Sonnet API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  // Parse JSON response
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Failed to parse narrative response: ${text.slice(0, 200)}`);
  }
}

/**
 * Compute path integral metrics from narrative classification.
 */
export function computePathMetrics(narrative) {
  const transitions = narrative.plausible_transitions || [];

  const expectedValue = transitions.reduce((s, t) =>
    s + (t.probability || 0) * (t.price_impact_pct || 0), 0) / 100;

  const upsideTransitions = transitions.filter(t => (t.price_impact_pct || 0) > 0);
  const downsideTransitions = transitions.filter(t => (t.price_impact_pct || 0) < 0);

  const maxUpside = Math.max(0, ...transitions.map(t => t.price_impact_pct || 0));
  const maxDownside = Math.min(0, ...transitions.map(t => t.price_impact_pct || 0));

  // Path coherence: fraction of probability in same direction as EV
  const directionBias = expectedValue >= 0 ? 'up' : 'down';
  const coherentProb = transitions
    .filter(t => directionBias === 'up' ? (t.price_impact_pct || 0) > 0 : (t.price_impact_pct || 0) < 0)
    .reduce((s, t) => s + (t.probability || 0), 0);
  const pathCoherence = coherentProb;

  // Sequence metrics (noncommutativity)
  const earlyTransitions = transitions.filter(t => t.sequence_position === 'EARLY');
  const lateTransitions = transitions.filter(t => t.sequence_position === 'LATE');

  const earlyBias = earlyTransitions.length > 0
    ? earlyTransitions.reduce((s, t) => s + (t.probability || 0) * (t.price_impact_pct || 0), 0) /
      earlyTransitions.reduce((s, t) => s + (t.probability || 0), 0) / 100
    : 0;

  const lateBias = lateTransitions.length > 0
    ? lateTransitions.reduce((s, t) => s + (t.probability || 0) * (t.price_impact_pct || 0), 0) /
      lateTransitions.reduce((s, t) => s + (t.probability || 0), 0) / 100
    : 0;

  const narrativeDimensionality = new Set(
    transitions.filter(t => (t.probability || 0) > 0.1).map(t => t.target_narrative)
  ).size;

  return {
    expectedValue,
    upsideCount: upsideTransitions.length,
    downsideCount: downsideTransitions.length,
    maxUpside,
    maxDownside,
    pathCoherence,
    earlyBias,
    lateBias,
    sequenceMomentum: lateBias - earlyBias,
    narrativeDimensionality,
    transitionAsymmetry: narrative.transition_asymmetry || 0,
    dominantMode: narrative.dominant_transition_mode || 'unknown',
  };
}

export { NARRATIVE_ARCHETYPES };
export default { buildNarrativePrompt, classifyNarrative, computePathMetrics, NARRATIVE_ARCHETYPES };
