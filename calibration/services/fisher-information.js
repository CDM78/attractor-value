// Fisher Information — meta-signal measuring financial report informativeness.
// High Fisher = changes in real business show up promptly in the numbers.
// Low Fisher = financials are opaque.

/**
 * Compute Fisher information from a quarterly time series.
 * @param {number[]} series - quarterly revenue (or other metric) values
 * @returns {Object|null} { fisherMedian, fisherMean, fisherStd, nWindows }
 */
export function fisherInformation(series) {
  if (series.length < 8) return null;

  const windowSize = 4;
  const fisherValues = [];

  for (let i = 1; i <= series.length - windowSize; i++) {
    const window = series.slice(i, i + windowSize);
    const prevWindow = series.slice(i - 1, i - 1 + windowSize);
    const n = window.length;

    const mu = window.reduce((s, v) => s + v, 0) / n;
    const sigma2 = window.reduce((s, v) => s + (v - mu) ** 2, 0) / (n - 1);
    if (sigma2 < 1e-10) continue;

    // Slope within window (dμ/dt)
    const xMean = (n - 1) / 2;
    let num = 0, den = 0;
    for (let j = 0; j < n; j++) {
      num += (j - xMean) * (window[j] - mu);
      den += (j - xMean) ** 2;
    }
    const dmu_dt = den > 0 ? num / den : 0;

    // Change in variance (dσ²/dt)
    const prevMu = prevWindow.reduce((s, v) => s + v, 0) / n;
    const prevSigma2 = prevWindow.reduce((s, v) => s + (v - prevMu) ** 2, 0) / (n - 1);
    const dsigma2_dt = sigma2 - prevSigma2;

    const I_t = (dmu_dt ** 2) / sigma2 + (dsigma2_dt ** 2) / (2 * sigma2 ** 2);
    fisherValues.push(I_t);
  }

  if (fisherValues.length === 0) return null;

  fisherValues.sort((a, b) => a - b);
  const mid = Math.floor(fisherValues.length / 2);
  const median = fisherValues.length % 2 === 0
    ? (fisherValues[mid - 1] + fisherValues[mid]) / 2
    : fisherValues[mid];
  const mean = fisherValues.reduce((s, v) => s + v, 0) / fisherValues.length;
  const std = Math.sqrt(fisherValues.reduce((s, v) => s + (v - mean) ** 2, 0) / fisherValues.length);

  return { fisherMedian: median, fisherMean: mean, fisherStd: std, nWindows: fisherValues.length };
}

export default { fisherInformation };
