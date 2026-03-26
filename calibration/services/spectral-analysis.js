// Spectral Decomposition — Haar wavelet transform on revenue time series.
// Winners should have dominant energy in secular trend; traps in cyclical components.

/**
 * Haar discrete wavelet transform.
 * @param {number[]} signal - input signal (will be padded to power of 2)
 * @returns {Array} levels - array of detail coefficient arrays, last entry is approximation
 */
export function haarDWT(signal) {
  let n = 1;
  while (n < signal.length) n *= 2;
  const padded = [...signal];
  while (padded.length < n) padded.push(padded[padded.length - 1]);

  const levels = [];
  let approx = [...padded];

  while (approx.length > 1) {
    const newApprox = [];
    const detail = [];
    for (let i = 0; i < approx.length; i += 2) {
      newApprox.push((approx[i] + (approx[i + 1] ?? approx[i])) / Math.SQRT2);
      detail.push((approx[i] - (approx[i + 1] ?? approx[i])) / Math.SQRT2);
    }
    levels.push(detail);
    approx = newApprox;
  }
  levels.push(approx); // final approximation coefficient
  return levels;
}

/**
 * Compute spectral energy distribution from revenue time series.
 * @param {number[]} series - quarterly revenue values (minimum 8, ideally 16+)
 * @returns {Object|null} energy fractions by frequency band
 */
export function spectralEnergy(series) {
  if (series.length < 8) return null;

  const levels = haarDWT(series);
  const energies = levels.map(level => level.reduce((sum, v) => sum + v * v, 0));
  const totalEnergy = energies.reduce((s, e) => s + e, 0);
  if (totalEnergy < 1e-10) return null;

  const fractions = energies.map(e => e / totalEnergy);

  // Map to named frequency bands
  // Level 0 = highest frequency (quarter-to-quarter noise, ~2Q period)
  // Level 1 = semi-annual (~4Q period)
  // Level 2 = annual (~8Q period)
  // Level 3 = business cycle (~16Q period)
  // Level 4+ = secular trend
  const result = {
    noise: fractions[0] || 0,
    semiannual: fractions[1] || 0,
    annual: fractions[2] || 0,
    businessCycle: fractions[3] || 0,
    secular: fractions.slice(4).reduce((s, f) => s + f, 0),
  };

  result.secularDominance = result.secular / (result.secular + result.businessCycle + 1e-10);
  result.signalToNoise = (result.secular + result.businessCycle) / (result.noise + 1e-10);

  // Number of frequency bands with >10% energy
  result.spectralDimensionality = [result.noise, result.semiannual, result.annual,
    result.businessCycle, result.secular].filter(f => f > 0.10).length;

  return result;
}

export default { haarDWT, spectralEnergy };
