// Non-linear dynamics analysis functions.
// Test 1: Metabolic scaling exponent
// Test 2: Benford maturity gradient
// Test 3: Critical slowing down
// Test 4: S-curve inflection detection
// Test 5: Zipf rank dynamics

import { linearRegression, mean } from './statistics.js';

// ============================================
// TEST 1: METABOLIC SCALING CROSSOVER
// ============================================

// Compute power law scaling exponent: Revenue = k × Assets^β
// log10(revenue) = log10(k) + β × log10(assets)
export function computeScalingExponent(quarterlyMetrics, xMetric = 'assets', yMetric = 'revenue') {
  const points = quarterlyMetrics
    .filter(q => q[xMetric] > 0 && q[yMetric] > 0)
    .map(q => ({
      x: Math.log10(q[xMetric]),
      y: Math.log10(q[yMetric]),
    }));

  if (points.length < 8) return null;

  const reg = linearRegression(points.map(p => p.x), points.map(p => p.y));
  if (!reg) return null;

  return {
    beta: reg.slope,
    logK: reg.intercept,
    r2: reg.r2,
    n: points.length,
  };
}

// Compute β trajectory: split into early/late halves
export function scalingTrajectory(quarterlyMetrics) {
  const valid = quarterlyMetrics.filter(q => q.assets > 0 && q.revenue > 0);
  if (valid.length < 12) return null; // Need at least 6 per half

  const mid = Math.floor(valid.length / 2);
  const early = valid.slice(0, mid);
  const late = valid.slice(mid);

  const betaEarly = computeScalingExponent(early);
  const betaLate = computeScalingExponent(late);

  if (!betaEarly || !betaLate) return null;

  const betaChange = betaLate.beta - betaEarly.beta;
  let trajectory;
  if (betaLate.beta > 1.0 && betaChange > 0) trajectory = 'CROSSING_SUPERLINEAR';
  else if (betaChange > 0 && betaLate.beta < 1.0) trajectory = 'IMPROVING_SUBLINEAR';
  else if (betaChange < 0) trajectory = 'DEGRADING';
  else trajectory = 'STABLE';

  return {
    betaEarly: betaEarly.beta,
    betaLate: betaLate.beta,
    betaChange,
    r2Early: betaEarly.r2,
    r2Late: betaLate.r2,
    trajectory,
    nEarly: betaEarly.n,
    nLate: betaLate.n,
  };
}

// ============================================
// TEST 2: BENFORD MATURITY GRADIENT
// ============================================

// Segment a company by annualized revenue into maturity bands
export function maturityBand(annualizedRevenue) {
  if (annualizedRevenue == null || annualizedRevenue <= 0) return null;
  if (annualizedRevenue < 100_000_000) return 'pre-scale';       // < $100M
  if (annualizedRevenue < 1_000_000_000) return 'early-scaling';  // $100M - $1B
  if (annualizedRevenue < 10_000_000_000) return 'late-scaling';  // $1B - $10B
  return 'mature';                                                 // > $10B
}

// Count orders of magnitude spanned by a company's financial data
export function ordersOfMagnitude(numbers) {
  const valid = numbers.filter(n => n > 0);
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return Math.log10(max / min);
}

// ============================================
// TEST 3: CRITICAL SLOWING DOWN
// ============================================

// Lag-1 autocorrelation of a series
function autocorrelation(series) {
  const n = series.length;
  if (n < 4) return null;
  const m = mean(series);

  let num = 0, den = 0;
  for (let j = 0; j < n - 1; j++) {
    num += (series[j] - m) * (series[j + 1] - m);
  }
  for (let j = 0; j < n; j++) {
    den += (series[j] - m) ** 2;
  }

  return den > 0 ? num / den : 0;
}

// Rolling autocorrelation with window
export function rollingAutocorrelation(series, windowSize = 8) {
  const results = [];
  for (let i = windowSize; i <= series.length; i++) {
    const window = series.slice(i - windowSize, i);
    results.push({
      index: i,
      autocorrelation: autocorrelation(window),
    });
  }
  return results;
}

// Rolling variance
export function rollingVariance(series, windowSize = 8) {
  const results = [];
  for (let i = windowSize; i <= series.length; i++) {
    const window = series.slice(i - windowSize, i);
    const m = mean(window);
    const variance = window.reduce((s, v) => s + (v - m) ** 2, 0) / (window.length - 1);
    results.push({ index: i, variance });
  }
  return results;
}

// Compute CSD signals for a single time series
export function computeCSD(series, windowSize = 8) {
  if (series.length < windowSize + 4) return null; // Need enough data for slope

  const acResults = rollingAutocorrelation(series, windowSize);
  const varResults = rollingVariance(series, windowSize);

  if (acResults.length < 3 || varResults.length < 3) return null;

  // Compute slopes of autocorrelation and variance over time
  const acSlope = linearRegression(
    acResults.map((_, i) => i),
    acResults.map(r => r.autocorrelation)
  );
  const varSlope = linearRegression(
    varResults.map((_, i) => i),
    varResults.map(r => r.variance)
  );

  if (!acSlope || !varSlope) return null;

  return {
    autocorrSlope: acSlope.slope,
    autocorrR2: acSlope.r2,
    varianceSlope: varSlope.slope,
    varianceR2: varSlope.r2,
    finalAutocorr: acResults[acResults.length - 1].autocorrelation,
    finalVariance: varResults[varResults.length - 1].variance,
    nWindows: acResults.length,
  };
}

// Compute CSD across multiple metrics for a company
export function companyCSD(quarterlyMetrics) {
  const metrics = {};

  // Extract series for each metric
  const revGrowth = quarterlyMetrics.map(q => q.revenueGrowthYoY).filter(v => v != null);
  const opMargin = quarterlyMetrics.map(q => q.operatingMargin).filter(v => v != null);
  const fcfMargin = quarterlyMetrics.map(q => q.fcfMargin).filter(v => v != null);

  metrics.revenueGrowth = computeCSD(revGrowth);
  metrics.operatingMargin = computeCSD(opMargin);
  metrics.fcfMargin = computeCSD(fcfMargin);

  // Composite CSD index: average of normalized autocorrelation slopes
  // Positive = critical slowing down detected
  const slopes = [];
  for (const m of Object.values(metrics)) {
    if (m?.autocorrSlope != null) slopes.push(m.autocorrSlope);
  }

  const varSlopes = [];
  for (const m of Object.values(metrics)) {
    if (m?.varianceSlope != null) varSlopes.push(m.varianceSlope);
  }

  // Normalize to [0,1] using sigmoid-like transform: 1 / (1 + e^(-10x))
  const sigmoid = (x) => 1 / (1 + Math.exp(-10 * x));

  const acComponent = slopes.length > 0 ? sigmoid(mean(slopes)) : 0.5;
  const varComponent = varSlopes.length > 0 ? sigmoid(mean(varSlopes)) : 0.5;
  const csdIndex = (acComponent + varComponent) / 2;

  return {
    metrics,
    csdIndex,
    acComponent,
    varComponent,
    hasData: slopes.length > 0,
  };
}

// ============================================
// TEST 4: S-CURVE INFLECTION DETECTION
// ============================================

export function revenueDerivatives(quarterlyMetrics) {
  // Need quarterly revenue with enough history
  const revs = quarterlyMetrics
    .map((q, i) => ({ index: i, quarter: q.quarter, revenue: q.revenue }))
    .filter(q => q.revenue != null && q.revenue > 0);

  if (revs.length < 8) return null;

  // First derivative: YoY growth rate (4-quarter lag for seasonality removal)
  const d1 = [];
  for (let i = 4; i < revs.length; i++) {
    // Find the revenue ~4 quarters back
    const prev = revs[i - 4];
    if (prev && prev.revenue > 0) {
      d1.push({
        quarter: revs[i].quarter,
        growthRate: (revs[i].revenue - prev.revenue) / prev.revenue,
      });
    }
  }

  if (d1.length < 4) return null;

  // Second derivative: change in growth rate (quarter over quarter)
  const d2 = [];
  for (let i = 1; i < d1.length; i++) {
    d2.push({
      quarter: d1[i].quarter,
      acceleration: d1[i].growthRate - d1[i - 1].growthRate,
    });
  }

  if (d2.length < 2) return null;

  // Classify the final 4 quarters of second derivative
  const recentD2 = d2.slice(-4);
  const recentD1 = d1.slice(-4);
  const avgD2 = mean(recentD2.map(r => r.acceleration));
  const avgD1 = mean(recentD1.map(r => r.growthRate));
  const d2Trend = recentD2.length >= 2
    ? recentD2[recentD2.length - 1].acceleration - recentD2[0].acceleration
    : 0;

  let phase;
  if (avgD2 > 0.01 && d2Trend > 0) phase = 'ACCELERATING';
  else if (avgD2 > 0.01 && d2Trend <= 0) phase = 'PEAK';
  else if (avgD2 > -0.01 && avgD2 <= 0.01) phase = 'INFLECTION';
  else if (avgD2 < -0.01 && d2Trend < 0) phase = 'DECELERATING';
  else if (avgD2 < -0.01 && d2Trend >= 0) phase = 'BOTTOMING';
  else phase = 'INFLECTION'; // fallback

  return {
    d1_series: d1,
    d2_series: d2,
    avgD1,
    avgD2,
    d2Trend,
    phase,
    nQuarters: revs.length,
  };
}

// Estimate CAGR from quarterly revenue (annualized)
export function estimateCAGR(quarterlyMetrics) {
  const withRev = quarterlyMetrics.filter(q => q.revenue != null && q.revenue > 0);
  if (withRev.length < 8) return null; // Need ~2 years

  const early = mean(withRev.slice(0, 4).map(q => q.revenue));
  const late = mean(withRev.slice(-4).map(q => q.revenue));
  const years = withRev.length / 4;

  if (early <= 0 || late <= 0 || years <= 0) return null;
  return Math.pow(late / early, 1 / years) - 1;
}

// ============================================
// TEST 5: ZIPF RANK DYNAMICS
// ============================================

// Compute Zipf exponent for a set of revenues
export function zipfExponent(revenues) {
  const sorted = [...revenues].filter(r => r > 0).sort((a, b) => b - a);
  if (sorted.length < 5) return null;

  const points = sorted.map((r, i) => ({
    x: Math.log10(i + 1),  // log(rank)
    y: Math.log10(r),       // log(revenue)
  }));

  const reg = linearRegression(points.map(p => p.x), points.map(p => p.y));
  if (!reg) return null;

  return {
    alpha: -reg.slope, // Negate because slope is negative (revenue decreases with rank)
    r2: reg.r2,
    n: sorted.length,
  };
}

// Compute rank velocity for a company within its sector over time
export function rankVelocity(ranks, years) {
  if (ranks.length < 3 || ranks.length !== years.length) return null;

  const reg = linearRegression(years, ranks);
  if (!reg) return null;

  return {
    velocity: reg.slope,       // Negative = climbing (improving rank)
    r2: reg.r2,
    startRank: ranks[0],
    endRank: ranks[ranks.length - 1],
    ranksClimbed: ranks[0] - ranks[ranks.length - 1], // Positive = improved
    yearsSpanned: years[years.length - 1] - years[0],
  };
}

// Effort-adjusted rank velocity (normalizes for Zipf difficulty at top)
export function effortAdjustedVelocity(rv, alpha) {
  if (!rv || !alpha || alpha <= 0) return null;
  if (rv.startRank <= 0) return null;
  return rv.ranksClimbed / Math.pow(rv.startRank, 1 / alpha);
}

// Build sector revenue rankings for a given year from all company data
export function buildSectorRankings(sectorCompanies, year) {
  // sectorCompanies: array of { ticker, quarterlyMetrics }
  // Returns sorted ranking for the given year

  const revenues = [];
  for (const { ticker, quarterlyMetrics } of sectorCompanies) {
    // Find Q4 (FY end) or any Q in the year
    const yearQuarters = quarterlyMetrics.filter(q => q.quarter?.startsWith(String(year)));
    // Use latest quarter's revenue as annual proxy
    const latestWithRev = yearQuarters.reverse().find(q => q.revenue > 0);
    if (latestWithRev) {
      revenues.push({ ticker, revenue: latestWithRev.revenue * 4 }); // Annualize
    }
  }

  // Sort descending by revenue, assign ranks
  revenues.sort((a, b) => b.revenue - a.revenue);
  return revenues.map((r, i) => ({ ...r, rank: i + 1 }));
}

// Track a company's rank across multiple years
export function trackRankHistory(ticker, sectorCompanies, years) {
  const ranks = [];
  const validYears = [];

  for (const year of years) {
    const ranking = buildSectorRankings(sectorCompanies, year);
    const entry = ranking.find(r => r.ticker === ticker);
    if (entry) {
      ranks.push(entry.rank);
      validYears.push(year);
    }
  }

  return { ranks, years: validYears };
}

// ============================================
// DEEP TEST EXTENSIONS
// ============================================

// Variant of computeScalingExponent with configurable minimum quarter count
export function computeScalingExponentMinQ(quarterlyMetrics, xMetric = 'assets', yMetric = 'revenue', minQuarters = 8) {
  const points = quarterlyMetrics
    .filter(q => q[xMetric] > 0 && q[yMetric] > 0)
    .map(q => ({
      x: Math.log10(q[xMetric]),
      y: Math.log10(q[yMetric]),
    }));

  if (points.length < minQuarters) return null;

  const reg = linearRegression(points.map(p => p.x), points.map(p => p.y));
  if (!reg) return null;

  return {
    beta: reg.slope,
    logK: reg.intercept,
    r2: reg.r2,
    n: points.length,
  };
}

// Compute β velocity: rate of change of β per quarter using rolling windows
export function betaVelocity(quarterlyMetrics, windowSize = 8, stepSize = 2) {
  const valid = quarterlyMetrics.filter(q => q.assets > 0 && q.revenue > 0);
  if (valid.length < windowSize + stepSize * 2) return null;

  const betas = [];
  for (let i = 0; i <= valid.length - windowSize; i += stepSize) {
    const window = valid.slice(i, i + windowSize);
    const beta = computeScalingExponent(window);
    if (beta) betas.push({ index: i, beta: beta.beta, r2: beta.r2 });
  }

  if (betas.length < 3) return null;

  // Linear regression of β over window indices to get slope (Δβ per step)
  const reg = linearRegression(
    betas.map(b => b.index),
    betas.map(b => b.beta)
  );

  if (!reg) return null;

  // Convert slope from per-index to per-quarter
  const velocityPerQuarter = reg.slope * stepSize;

  return {
    velocity: velocityPerQuarter,
    r2: reg.r2,
    nWindows: betas.length,
    startBeta: betas[0].beta,
    endBeta: betas[betas.length - 1].beta,
    betaChange: betas[betas.length - 1].beta - betas[0].beta,
  };
}

// Non-linear composite score combining all 5 signals
export function nonLinearCompositeScore({ beta, betaTrajectory, zipfVelocity, csdIndex, benfordKLD, sCurvePhase, companyRevenue }) {
  const scores = [];

  // β level (higher = better, cap at 1.5)
  if (beta != null) scores.push(Math.min(beta / 1.5, 1.0));

  // β trajectory (improving = higher score)
  if (betaTrajectory != null) scores.push(betaTrajectory > 0 ? Math.min(betaTrajectory / 0.1, 1.0) : 0);

  // Zipf rank velocity (climbing = higher score, normalize by inverting)
  if (zipfVelocity != null) scores.push(zipfVelocity < 0 ? Math.min(Math.abs(zipfVelocity) / 5, 1.0) : 0);

  // CSD + Benford (only score highly if CSD elevated AND Benford conforming)
  if (csdIndex != null && benfordKLD != null) {
    const csdHigh = csdIndex > 0.5;
    const benfordClean = benfordKLD < 0.003;
    scores.push(csdHigh && benfordClean ? 1.0 : csdHigh && !benfordClean ? 0.2 : 0.5);
  }

  // S-curve phase
  if (sCurvePhase != null) {
    const phaseScores = {
      'ACCELERATING': 0.8,
      'PEAK': 1.0,
      'INFLECTION': 0.5,
      'BOTTOMING': 0.4,
      'DECELERATING': 0.2,
    };
    scores.push(phaseScores[sCurvePhase] || 0.5);
  }

  // Maturity-adjusted Benford (only for $100M-$1B companies)
  if (companyRevenue >= 1e8 && companyRevenue <= 1e9 && benfordKLD != null) {
    scores.push(benfordKLD < 0.002 ? 1.0 : benfordKLD < 0.004 ? 0.7 : 0.3);
  }

  if (scores.length === 0) return null;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}
