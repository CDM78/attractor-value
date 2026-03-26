// Spectral-Narrative Coherence Engine
// Tests the Selberg-Gutzwiller trace formula prediction:
// The spectral decomposition (eigenvalues) and path decomposition (narratives)
// are dual descriptions. Inconsistency = mispricing = alpha signal.

/**
 * Compute spectral-narrative coherence for a single case.
 * @param {Object} quantData - { secularDominance, signalToNoise, rmtFactorScores }
 * @param {Object} narrativeData - { transitionAsymmetry, pathCoherence, expectedValue }
 * @param {Object} fisherData - { fisherMedian, fisherQuartile }
 */
export function spectralNarrativeCoherence(quantData, narrativeData, fisherData = null) {
  // Step 1: Quantitative assessment (what the numbers say)
  // Normalize to [-1, 1] range approximately
  const quantScore = (quantData.secularDominance || 0.5) * 2 - 1
    + Math.min(Math.max((quantData.signalToNoise || 1) / 50, -1), 1) * 0.3
    + (quantData.rmtFactorScore || 0) * 0.2;

  // Step 2: Narrative assessment (what the market believes)
  const narrativeScore = narrativeData.transitionAsymmetry || 0;

  // Step 3: Coherence = agreement
  const coherence = quantScore * narrativeScore;

  // Step 4: Perception gap (the alpha signal)
  const perceptionGap = quantScore - narrativeScore;

  // Step 5: Fisher weighting
  const fisherWeight = fisherData?.fisherQuartile >= 3 ? 1.0
    : fisherData?.fisherQuartile === 2 ? 0.7 : 0.4;

  return {
    quantScore: +quantScore.toFixed(4),
    narrativeScore: +narrativeScore.toFixed(4),
    coherence: +coherence.toFixed(4),
    perceptionGap: +perceptionGap.toFixed(4),
    weightedPerceptionGap: +(perceptionGap * fisherWeight).toFixed(4),
    fisherWeight,
  };
}

/**
 * Classify case position relative to the "critical line."
 * Cases near the line (small |perceptionGap|) = fairly valued.
 * Cases far from the line = mispriced.
 */
export function criticalLineDistance(perceptionGap) {
  const distance = Math.abs(perceptionGap);
  const direction = perceptionGap > 0 ? 'UNDERVALUED' : perceptionGap < 0 ? 'OVERVALUED' : 'FAIR';

  let bucket;
  if (distance < 0.3) bucket = 'NEAR';
  else if (distance < 0.7) bucket = 'MODERATE';
  else bucket = 'FAR';

  return { distance: +distance.toFixed(4), direction, bucket };
}

/**
 * Compute coherence trajectory along a narrative sequence.
 * @param {Object} quantData - spectral data (fixed at entry)
 * @param {Object[]} narrativeSequence - [entry, 12mo, 24mo] narrative classifications
 */
export function coherenceTrajectory(quantData, narrativeSequence) {
  return narrativeSequence.map((narr, i) => {
    const coherence = spectralNarrativeCoherence(quantData, narr);
    return {
      timepoint: ['entry', '12mo', '24mo'][i],
      ...coherence,
    };
  });
}

export default { spectralNarrativeCoherence, criticalLineDistance, coherenceTrajectory };
