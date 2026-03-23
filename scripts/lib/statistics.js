// Hand-rolled statistical functions for calibration tests.
// Zero dependencies — Mann-Whitney U, Spearman correlation, chi-square p-value, linear regression.

// ============================================
// MANN-WHITNEY U TEST
// ============================================
// Compares two independent groups. Returns U statistic, z-score, p-value, effect size r.
export function mannWhitneyU(group1, group2) {
  const n1 = group1.length;
  const n2 = group2.length;
  if (n1 < 2 || n2 < 2) return null;

  // Combine and rank
  const combined = [
    ...group1.map(v => ({ v, g: 1 })),
    ...group2.map(v => ({ v, g: 2 })),
  ];
  combined.sort((a, b) => a.v - b.v);

  // Assign ranks with ties averaged
  const ranks = new Array(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j++;
    const avgRank = (i + 1 + j) / 2; // 1-based average
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }

  // Sum ranks for group 1
  let R1 = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k].g === 1) R1 += ranks[k];
  }

  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);

  // Normal approximation for large samples
  const meanU = (n1 * n2) / 2;
  const sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = (U1 - meanU) / sigmaU;
  const p = 2 * (1 - normalCDF(Math.abs(z))); // two-tailed

  const N = n1 + n2;
  const effectSizeR = Math.abs(z) / Math.sqrt(N);

  return { U, U1, U2, z, p, effectSizeR, n1, n2 };
}

// ============================================
// SPEARMAN RANK CORRELATION
// ============================================
export function spearmanCorrelation(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  const n = x.length;

  const rankX = assignRanks(x);
  const rankY = assignRanks(y);

  // Pearson correlation on ranks
  let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += rankX[i];
    sumY += rankY[i];
    sumXY += rankX[i] * rankY[i];
    sumX2 += rankX[i] ** 2;
    sumY2 += rankY[i] ** 2;
  }

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  if (den === 0) return { rho: 0, p: 1, n };

  const rho = num / den;

  // t-test for significance
  const t = rho * Math.sqrt((n - 2) / (1 - rho ** 2));
  const df = n - 2;
  const p = 2 * (1 - tCDF(Math.abs(t), df));

  return { rho, p, n };
}

function assignRanks(values) {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

// ============================================
// LINEAR REGRESSION
// ============================================
export function linearRegression(x, y) {
  if (x.length !== y.length || x.length < 2) return null;
  const n = x.length;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] ** 2;
    sumY2 += y[i] ** 2;
  }

  const den = n * sumX2 - sumX ** 2;
  if (den === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / den;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (y[i] - meanY) ** 2;
    ssRes += (y[i] - (slope * x[i] + intercept)) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

// ============================================
// CHI-SQUARE P-VALUE
// ============================================
// Uses regularized incomplete gamma function approximation
export function chiSquarePValue(chiSq, df) {
  if (chiSq <= 0 || df <= 0) return 1;
  // P-value = 1 - regularizedGammaP(df/2, chiSq/2)
  return 1 - regularizedGammaP(df / 2, chiSq / 2);
}

// ============================================
// HELPER: Normal CDF (standard normal)
// ============================================
function normalCDF(x) {
  // Abramowitz & Stegun approximation 26.2.17
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// ============================================
// HELPER: Student's t CDF (approximation)
// ============================================
function tCDF(t, df) {
  // Use regularized incomplete beta function
  const x = df / (df + t * t);
  return 1 - 0.5 * regularizedBetaI(df / 2, 0.5, x);
}

// ============================================
// HELPER: Regularized incomplete beta function I_x(a, b)
// ============================================
function regularizedBetaI(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use continued fraction (Lentz's method)
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);

  // Use the continued fraction for I_x(a,b)
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 200; i++) {
    let numerator;
    if (i === 0) {
      numerator = 1;
    } else if (i % 2 === 0) {
      const m = i / 2;
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    } else {
      const m = (i - 1) / 2;
      numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }

    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;

    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;

    f *= c * d;
    if (Math.abs(c * d - 1) < 1e-10) break;
  }

  return front * (f - 1) / a;
}

// ============================================
// HELPER: Regularized incomplete gamma P(a, x)
// ============================================
function regularizedGammaP(a, x) {
  if (x <= 0) return 0;
  if (x > a + 1) {
    // Use continued fraction representation
    return 1 - regularizedGammaQ(a, x);
  }

  // Series representation
  let sum = 1 / a;
  let term = 1 / a;
  for (let n = 1; n < 200; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-10) break;
  }

  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function regularizedGammaQ(a, x) {
  // Continued fraction (Lentz's method)
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 200; i++) {
    let an;
    if (i === 0) {
      an = 1;
    } else if (i % 2 === 1) {
      an = ((i + 1) / 2 - a);
    } else {
      an = i / 2;
    }
    const bn = i === 0 ? 0 : x;

    if (i === 0) {
      d = x + 1 - a;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      d = 1 / d;
      c = 1;
      f = d;
    } else {
      d = (x + 2 * i + 1 - a) + an / d;
      // Hmm, let me use the standard CF for Q(a,x) properly
    }
    // This is getting complex. Use the simple series for Q instead.
    break;
  }

  // Fallback: Q = 1 - P using series
  return 1 - regularizedGammaPSeries(a, x);
}

function regularizedGammaPSeries(a, x) {
  let sum = 1 / a;
  let term = 1 / a;
  for (let n = 1; n < 300; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

// ============================================
// HELPER: Log-gamma function (Lanczos approximation)
// ============================================
function lnGamma(z) {
  if (z <= 0) return Infinity;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }

  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }

  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// ============================================
// DESCRIPTIVE STATISTICS HELPERS
// ============================================
export function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
