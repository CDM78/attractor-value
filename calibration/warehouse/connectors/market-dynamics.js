// Market Dynamics Signal Computer
// Applies the nonlinear dynamics toolkit to market sentiment time series.
// Uses the SAME mathematical tools as nonlinear.js but swaps the input domain:
// financial statements → short interest, FTD, credit spreads, institutional flows.
//
// No new math — all functions are adapted from scripts/lib/nonlinear.js
// and scripts/lib/statistics.js. Inlined here to avoid import path fragility.

import warehouse from '../warehouse.js';

// ============================================================
// CORE MATH (inlined from statistics.js and nonlinear.js)
// ============================================================

function linearRegression(x, y) {
  if (x.length !== y.length || x.length < 2) return null;
  const n = x.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]; sumY += y[i];
    sumXY += x[i] * y[i]; sumX2 += x[i] ** 2;
  }
  const den = n * sumX2 - sumX ** 2;
  if (den === 0) return { slope: 0, intercept: sumY / n, r2: 0 };
  const slope = (n * sumXY - sumX * sumY) / den;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (y[i] - meanY) ** 2;
    ssRes += (y[i] - (slope * x[i] + intercept)) ** 2;
  }
  return { slope, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ============================================================
// SIGNAL FAMILY 1: SHORT INTEREST DYNAMICS
// ============================================================

/**
 * SI β Scaling — log(SI) vs log(market_cap) scaling exponent.
 * Uses rolling window if market cap data available, or cross-sectional.
 *
 * @param {Array} siSeries - [{date, short_position, ...}]
 * @param {Array} priceSeries - [{date, price, shares_outstanding}] for market cap
 * @returns {Object|null} { beta, r2, n }
 */
export function siBetaScaling(siSeries, priceSeries = null) {
  // If we have price data, compute SI vs market cap
  if (priceSeries && priceSeries.length >= 8) {
    // Match SI dates to closest price data
    const points = [];
    for (const si of siSeries) {
      if (!si.short_position || si.short_position <= 0) continue;
      // Find closest price
      const closest = priceSeries.reduce((best, p) => {
        const diff = Math.abs(new Date(p.date) - new Date(si.date));
        return diff < Math.abs(new Date(best.date) - new Date(si.date)) ? p : best;
      });
      const mktCap = closest.price * (closest.shares_outstanding || 1);
      if (mktCap <= 0) continue;
      points.push({ x: Math.log10(mktCap), y: Math.log10(si.short_position) });
    }

    if (points.length < 8) return null;
    const reg = linearRegression(points.map(p => p.x), points.map(p => p.y));
    if (!reg) return null;
    return { beta: reg.slope, r2: reg.r2, n: points.length };
  }

  // Fallback: SI level trajectory (log SI over time)
  const validSI = siSeries.filter(s => s.short_position > 0);
  if (validSI.length < 8) return null;

  const x = validSI.map((_, i) => i);
  const y = validSI.map(s => Math.log10(s.short_position));
  const reg = linearRegression(x, y);
  if (!reg) return null;
  return { beta: reg.slope, r2: reg.r2, n: validSI.length, note: 'time-trend' };
}

/**
 * SI Trajectory — split series into early/late halves, compare trends.
 * Returns trajectory classification.
 */
export function siTrajectory(siSeries) {
  const valid = siSeries.filter(s => s.short_position > 0);
  if (valid.length < 12) return null;

  const mid = Math.floor(valid.length / 2);
  const earlyMean = mean(valid.slice(0, mid).map(s => s.short_position));
  const lateMean = mean(valid.slice(mid).map(s => s.short_position));

  const earlyDTC = mean(valid.slice(0, mid).map(s => s.days_to_cover || 0));
  const lateDTC = mean(valid.slice(mid).map(s => s.days_to_cover || 0));

  const siChange = earlyMean > 0 ? (lateMean - earlyMean) / earlyMean : 0;
  const dtcChange = earlyDTC > 0 ? (lateDTC - earlyDTC) / earlyDTC : 0;

  let trajectory;
  if (siChange < -0.2) trajectory = 'SHORTS_COVERING';
  else if (siChange > 0.2) trajectory = 'SHORTS_BUILDING';
  else if (dtcChange < -0.2) trajectory = 'IMPROVING_LIQUIDITY';
  else if (dtcChange > 0.2) trajectory = 'DETERIORATING_LIQUIDITY';
  else trajectory = 'STABLE';

  return {
    earlyMeanSI: earlyMean,
    lateMeanSI: lateMean,
    siChange,
    earlyMeanDTC: earlyDTC,
    lateMeanDTC: lateDTC,
    dtcChange,
    trajectory,
    n: valid.length,
  };
}

/**
 * Ornstein-Uhlenbeck fit for mean-reversion speed.
 * High θ = SI snaps back quickly (stable consensus).
 * Low θ = SI drifts persistently (fragile consensus / building trend).
 */
export function ornsteinUhlenbeckFit(series) {
  const n = series.length;
  if (n < 8) return null;

  const dt = 1; // Normalized time step

  let sumX = 0, sumXnext = 0, sumX2 = 0, sumXXnext = 0;
  for (let i = 0; i < n - 1; i++) {
    sumX += series[i];
    sumXnext += series[i + 1];
    sumX2 += series[i] * series[i];
    sumXXnext += series[i] * series[i + 1];
  }

  const m = n - 1;
  const denom = m * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;

  const a = (m * sumXXnext - sumX * sumXnext) / denom;

  // Clamp to avoid log of non-positive
  const aClamped = Math.max(a, 0.01);
  const theta = -Math.log(aClamped) / dt;
  const mu = (sumXnext - a * sumX) / (m * (1 - Math.max(a, 0.001)));

  // Residual volatility
  let sumResid2 = 0;
  for (let i = 0; i < m; i++) {
    const predicted = mu + (series[i] - mu) * a;
    sumResid2 += (series[i + 1] - predicted) ** 2;
  }
  const sigma = Math.sqrt(sumResid2 / m);

  return {
    theta,
    mu,
    sigma,
    halfLife: theta > 0 ? Math.log(2) / theta : Infinity,
    meanReverting: theta > 0.5,
    trending: theta < 0.1,
  };
}

/**
 * SI Mean Reversion Speed — OU fit on days-to-cover or SI/float ratio.
 */
export function siMeanReversion(siSeries) {
  const dtcSeries = siSeries.filter(s => s.days_to_cover > 0).map(s => s.days_to_cover);
  if (dtcSeries.length < 8) return null;
  return ornsteinUhlenbeckFit(dtcSeries);
}

// ============================================================
// SIGNAL FAMILY 2: CRITICAL SLOWING DOWN ON SI
// ============================================================

/**
 * Rolling autocorrelation of a time series.
 */
function rollingAutocorrelation(series, windowSize = 8) {
  const results = [];
  for (let i = windowSize; i <= series.length; i++) {
    const window = series.slice(i - windowSize, i);
    const n = window.length;
    if (n < 4) continue;

    const m = mean(window);
    let num = 0, den = 0;
    for (let j = 0; j < n - 1; j++) {
      num += (window[j] - m) * (window[j + 1] - m);
      den += (window[j] - m) ** 2;
    }
    const ac = den > 0 ? num / den : 0;
    results.push({ index: i, autocorrelation: ac });
  }
  return results;
}

/**
 * Rolling variance of a time series.
 */
function rollingVariance(series, windowSize = 8) {
  const results = [];
  for (let i = windowSize; i <= series.length; i++) {
    const window = series.slice(i - windowSize, i);
    const m = mean(window);
    const variance = window.reduce((s, v) => s + (v - m) ** 2, 0) / window.length;
    results.push({ index: i, variance });
  }
  return results;
}

/**
 * CSD (Critical Slowing Down) on short interest series.
 * Increasing autocorrelation = market opinion becoming more persistent.
 * Increasing variance = market disagreement increasing.
 */
export function siCSD(siSeries, windowSize = 8) {
  const series = siSeries.map(s => s.short_position || 0).filter(v => v > 0);
  if (series.length < windowSize + 5) return null;

  // Normalize to log returns for stationarity
  const logReturns = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] > 0) {
      logReturns.push(Math.log(series[i] / series[i - 1]));
    }
  }

  if (logReturns.length < windowSize + 3) return null;

  const ac = rollingAutocorrelation(logReturns, windowSize);
  const vr = rollingVariance(logReturns, windowSize);

  if (ac.length < 3 || vr.length < 3) return null;

  // Compute trend in autocorrelation (slope)
  const acX = ac.map((_, i) => i);
  const acY = ac.map(a => a.autocorrelation);
  const acReg = linearRegression(acX, acY);

  // Compute trend in variance (slope)
  const vrX = vr.map((_, i) => i);
  const vrY = vr.map(v => v.variance);
  const vrReg = linearRegression(vrX, vrY);

  const acSlope = acReg?.slope || 0;
  const vrSlope = vrReg?.slope || 0;

  // CSD index: sigmoid of combined slope signals
  const rawScore = acSlope * 50 + vrSlope * 50;
  const csdIndex = 1 / (1 + Math.exp(-rawScore));

  return {
    autocorrSlope: acSlope,
    autocorrR2: acReg?.r2 || 0,
    varianceSlope: vrSlope,
    varianceR2: vrReg?.r2 || 0,
    finalAutocorr: ac[ac.length - 1]?.autocorrelation || 0,
    finalVariance: vr[vr.length - 1]?.variance || 0,
    csdIndex,
    nWindows: ac.length,
    interpretation: csdIndex > 0.6
      ? 'CONSENSUS_FORMING' : csdIndex < 0.4
      ? 'STABLE_REGIME' : 'NEUTRAL',
  };
}

// ============================================================
// SIGNAL FAMILY 3: CREDIT SPREAD DYNAMICS
// ============================================================

/**
 * CSD on credit spread time series.
 * @param {Array} spreadSeries - array of { date, credit_spread } objects
 * @param {number} windowSize - rolling window size (default 20 for ~monthly windows on biweekly data)
 */
export function creditSpreadCSD(spreadSeries, windowSize = 20) {
  const series = spreadSeries.map(s => s.credit_spread || s.value).filter(v => v > 0);
  if (series.length < windowSize + 5) return null;

  const ac = rollingAutocorrelation(series, windowSize);
  const vr = rollingVariance(series, windowSize);

  if (ac.length < 3) return null;

  const acX = ac.map((_, i) => i);
  const acReg = linearRegression(acX, ac.map(a => a.autocorrelation));
  const vrReg = linearRegression(vr.map((_, i) => i), vr.map(v => v.variance));

  return {
    autocorrSlope: acReg?.slope || 0,
    varianceSlope: vrReg?.slope || 0,
    finalAutocorr: ac[ac.length - 1]?.autocorrelation || 0,
    finalVariance: vr[vr.length - 1]?.variance || 0,
    nWindows: ac.length,
  };
}

/**
 * Ornstein-Uhlenbeck fit on credit spreads.
 * Detects mean-reverting vs trending regime.
 */
export function creditSpreadOU(spreadSeries) {
  const series = spreadSeries.map(s => s.credit_spread || s.value).filter(v => v > 0);
  return ornsteinUhlenbeckFit(series);
}

// ============================================================
// SIGNAL FAMILY 4: BENFORD ON MARKET MICROSTRUCTURE
// ============================================================

/**
 * First-digit distribution analysis.
 * Returns KL divergence from Benford's expected distribution.
 */
export function benfordAnalysis(values) {
  const validValues = values.filter(v => v > 0);
  if (validValues.length < 30) return null;

  // Expected Benford distribution
  const expected = [0, 0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];

  // Count first digits
  const counts = new Array(10).fill(0);
  for (const v of validValues) {
    const digit = parseInt(v.toExponential().charAt(0));
    if (digit >= 1 && digit <= 9) counts[digit]++;
  }

  const total = counts.slice(1).reduce((a, b) => a + b, 0);
  if (total < 30) return null;

  const observed = counts.map(c => c / total);

  // KL divergence
  let kld = 0;
  for (let d = 1; d <= 9; d++) {
    if (observed[d] > 0 && expected[d] > 0) {
      kld += observed[d] * Math.log(observed[d] / expected[d]);
    }
  }

  // Chi-square statistic
  let chiSq = 0;
  for (let d = 1; d <= 9; d++) {
    const exp = expected[d] * total;
    chiSq += (counts[d] - exp) ** 2 / exp;
  }

  return {
    kld,
    chiSquare: chiSq,
    observed: observed.slice(1),
    expected: expected.slice(1),
    n: total,
    anomalous: kld > 0.05, // Threshold for significant deviation
  };
}

/**
 * Benford analysis on daily trading volume.
 */
export function volumeBenford(volumeSeries) {
  return benfordAnalysis(volumeSeries.map(v => v.volume || v));
}

/**
 * Benford analysis on FTD counts.
 */
export function ftdBenford(ftdSeries) {
  return benfordAnalysis(ftdSeries.map(f => f.quantity || f));
}

// ============================================================
// SIGNAL FAMILY 5: SI ZIPF VELOCITY (Sector-Relative)
// ============================================================

/**
 * Build SI rankings within a sector: rank companies by SI-to-float ratio.
 * Returns array of { ticker, si_float_ratio, rank } sorted by ratio descending.
 *
 * @param {Object} sectorSIData - { ticker: [{ date, short_position, ... }] } for all sector companies
 * @param {string} targetDate - Date to compute rankings for (finds closest report)
 */
export function buildSectorSIRanking(sectorSIData, targetDate) {
  const rankings = [];

  for (const [ticker, series] of Object.entries(sectorSIData)) {
    if (!series || series.length === 0) continue;

    // Find the closest report to targetDate (before or equal)
    const eligible = series.filter(s => s.date <= targetDate && s.short_position > 0);
    if (eligible.length === 0) continue;

    const closest = eligible[eligible.length - 1]; // Already sorted chronologically
    const ratio = closest.days_to_cover || (closest.short_position / (closest.avg_daily_volume || 1));

    rankings.push({ ticker, si_float_ratio: ratio, date: closest.date });
  }

  // Sort descending by SI ratio (most shorted first)
  rankings.sort((a, b) => b.si_float_ratio - a.si_float_ratio);
  rankings.forEach((r, i) => { r.rank = i + 1; });

  return rankings;
}

/**
 * Track a company's SI rank across multiple dates within its sector.
 *
 * @param {string} ticker - Target company
 * @param {Object} sectorSIData - { ticker: [{ date, short_position, ... }] }
 * @param {string[]} dates - Array of dates to compute rankings for
 * @returns {{ ranks: number[], dates: string[], n: number }}
 */
export function trackSIRankHistory(ticker, sectorSIData, dates) {
  const ranks = [];
  const validDates = [];

  for (const date of dates) {
    const ranking = buildSectorSIRanking(sectorSIData, date);
    const entry = ranking.find(r => r.ticker === ticker);
    if (entry) {
      ranks.push(entry.rank);
      validDates.push(date);
    }
  }

  return { ranks, dates: validDates, n: ranks.length };
}

/**
 * SI Zipf Velocity — how fast a company's SI rank is changing over time.
 * A company climbing the SI ranks (getting more heavily shorted relative to peers)
 * is under increasing market scrutiny.
 * A company falling in SI ranks (shorts covering relative to peers) is seeing
 * improving consensus.
 *
 * @param {string} ticker - Target company
 * @param {Object} sectorSIData - { ticker: [siSeries] } for all sector peers
 * @param {string[]} dates - Evaluation dates (e.g., quarterly or bi-monthly)
 * @returns {Object|null} { velocity, ranksClimbed, startRank, endRank, n }
 */
export function siZipfVelocity(ticker, sectorSIData, dates) {
  const history = trackSIRankHistory(ticker, sectorSIData, dates);
  if (history.n < 4) return null;

  // Use time indices for regression (evenly spaced)
  const timeIndices = history.ranks.map((_, i) => i);
  const reg = linearRegression(timeIndices, history.ranks);
  if (!reg) return null;

  // Compute Zipf exponent for the sector SI distribution
  // (to effort-adjust — climbing from rank 50 to 40 is easier than 5 to 3)
  const latestRanking = buildSectorSIRanking(sectorSIData, dates[dates.length - 1]);
  const sectorValues = latestRanking.map(r => r.si_float_ratio).filter(v => v > 0);

  let alpha = 1; // default
  if (sectorValues.length >= 5) {
    const sorted = [...sectorValues].sort((a, b) => b - a);
    const logRanks = sorted.map((_, i) => Math.log10(i + 1));
    const logValues = sorted.map(v => Math.log10(v));
    const zipfReg = linearRegression(logRanks, logValues);
    if (zipfReg) alpha = Math.abs(zipfReg.slope);
  }

  const ranksClimbed = history.ranks[0] - history.ranks[history.ranks.length - 1];
  const startRank = history.ranks[0];

  // Effort-adjusted: normalizes for Zipf difficulty at top
  const effortAdjusted = startRank > 0 && alpha > 0
    ? ranksClimbed / Math.pow(startRank, 1 / alpha)
    : ranksClimbed;

  return {
    velocity: reg.slope,           // Positive = rank number increasing = dropping in SI ranks = bullish
    r2: reg.r2,
    startRank,
    endRank: history.ranks[history.ranks.length - 1],
    ranksClimbed,                  // Positive = improved (less shorted relative to peers)
    effortAdjusted,
    sectorAlpha: alpha,
    sectorSize: latestRanking.length,
    n: history.n,
  };
}

// ============================================================
// SIGNAL FAMILY 6: SI DERIVATIVES (D1, D2)
// ============================================================

/**
 * First and second derivatives of short interest.
 * D1 = is SI increasing or decreasing?
 * D2 = is the change accelerating or decelerating?
 */
export function siDerivatives(siSeries) {
  const valid = siSeries.filter(s => s.short_position > 0);
  if (valid.length < 6) return null;

  // D1: period-over-period percentage change
  const d1 = [];
  for (let i = 1; i < valid.length; i++) {
    const change = (valid[i].short_position - valid[i - 1].short_position) / valid[i - 1].short_position;
    d1.push(change);
  }

  // D2: change in D1 (acceleration)
  const d2 = [];
  for (let i = 1; i < d1.length; i++) {
    d2.push(d1[i] - d1[i - 1]);
  }

  const avgD1 = mean(d1);
  const avgD2 = d2.length > 0 ? mean(d2) : 0;

  // Recent trend (last 4 periods)
  const recentD1 = d1.length >= 4 ? mean(d1.slice(-4)) : avgD1;
  const recentD2 = d2.length >= 4 ? mean(d2.slice(-4)) : avgD2;

  // Phase detection
  let phase;
  if (recentD1 > 0.05 && recentD2 > 0) phase = 'SHORTS_ACCELERATING';
  else if (recentD1 > 0.05 && recentD2 <= 0) phase = 'SHORTS_PEAKING';
  else if (recentD1 < -0.05 && recentD2 < 0) phase = 'SHORTS_COLLAPSING';
  else if (recentD1 < -0.05 && recentD2 >= 0) phase = 'SHORTS_BOTTOMING';
  else phase = 'STABLE';

  return {
    avgD1,
    avgD2,
    recentD1,
    recentD2,
    d1_series: d1,
    d2_series: d2,
    phase,
    n: valid.length,
  };
}

// ============================================================
// SIGNAL FAMILY 7: INSTITUTIONAL FLOW DYNAMICS (13F/13D/G)
// ============================================================

/**
 * Institutional flow D1 and D2 — first and second derivatives
 * of institutional ownership filing activity.
 *
 * D1 = are institutions filing more or fewer 13D/G? (accumulating vs distributing)
 * D2 = is the filing momentum accelerating or decelerating?
 *
 * @param {Array} ownershipSeries - [{ quarter, institutional_filings, filing_momentum, shares_change_pct }]
 */
export function institutionalFlowDynamics(ownershipSeries) {
  if (!ownershipSeries || ownershipSeries.length < 4) return null;

  const filingCounts = ownershipSeries.map(q => q.institutional_filings);
  const momenta = ownershipSeries
    .filter(q => q.filing_momentum != null)
    .map(q => q.filing_momentum);

  // D1: trend in filing activity
  const d1 = [];
  for (let i = 1; i < filingCounts.length; i++) {
    d1.push(filingCounts[i] - filingCounts[i - 1]);
  }

  // D2: acceleration of filing momentum
  const d2 = [];
  for (let i = 1; i < d1.length; i++) {
    d2.push(d1[i] - d1[i - 1]);
  }

  const avgD1 = d1.length > 0 ? d1.reduce((a, b) => a + b, 0) / d1.length : 0;
  const avgD2 = d2.length > 0 ? d2.reduce((a, b) => a + b, 0) / d2.length : 0;
  const recentD1 = d1.length >= 2 ? (d1[d1.length - 1] + d1[d1.length - 2]) / 2 : avgD1;

  // Concentration trajectory: cumulative filing trend
  const cumulatives = ownershipSeries.map(q => q.cumulative_filings || 0);
  const timeIndices = cumulatives.map((_, i) => i);
  const trendReg = linearRegression(timeIndices, cumulatives);

  // Shares outstanding trajectory (buybacks vs dilution)
  const sharesChanges = ownershipSeries
    .filter(q => q.shares_change_pct != null)
    .map(q => q.shares_change_pct);
  const avgSharesChange = sharesChanges.length > 0
    ? sharesChanges.reduce((a, b) => a + b, 0) / sharesChanges.length
    : null;

  // Phase detection
  let phase;
  if (recentD1 > 0.5) phase = 'INSTITUTIONS_ACCUMULATING';
  else if (recentD1 < -0.5) phase = 'INSTITUTIONS_DISTRIBUTING';
  else phase = 'STABLE';

  return {
    avgD1,
    avgD2,
    recentD1,
    filingTrendSlope: trendReg?.slope || 0,
    filingTrendR2: trendReg?.r2 || 0,
    avgSharesChange,
    isBuyingBack: avgSharesChange != null ? avgSharesChange < -0.005 : null,
    phase,
    totalFilings: ownershipSeries.reduce((s, q) => s + q.institutional_filings, 0),
    n: ownershipSeries.length,
  };
}

/**
 * Institutional ownership concentration trajectory.
 * Measures whether filing activity is becoming more or less concentrated over time.
 *
 * @param {Array} ownershipSeries - quarterly ownership data
 */
export function institutionalConcentration(ownershipSeries) {
  if (!ownershipSeries || ownershipSeries.length < 4) return null;

  // Use filing count per quarter as a proxy for breadth
  const quarterlyActivity = ownershipSeries.map(q => q.institutional_filings);

  // Compute rolling coefficient of variation
  const windowSize = Math.min(4, Math.floor(quarterlyActivity.length / 2));
  const windows = [];
  for (let i = windowSize; i <= quarterlyActivity.length; i++) {
    const window = quarterlyActivity.slice(i - windowSize, i);
    const m = mean(window);
    if (m > 0) {
      const variance = window.reduce((s, v) => s + (v - m) ** 2, 0) / window.length;
      windows.push({ index: i, cv: Math.sqrt(variance) / m });
    }
  }

  if (windows.length < 2) return null;

  // Trend in CV: increasing CV = activity becoming more sporadic (concentrated)
  const cvReg = linearRegression(
    windows.map((_, i) => i),
    windows.map(w => w.cv)
  );

  return {
    cvSlope: cvReg?.slope || 0,
    concentrating: (cvReg?.slope || 0) > 0.05,
    dispersing: (cvReg?.slope || 0) < -0.05,
    latestCV: windows[windows.length - 1]?.cv || 0,
  };
}

// ============================================================
// COMPOSITE: Compute ALL market dynamics signals for a case
// ============================================================

/**
 * Compute all market dynamics signals for a company given its warehouse data.
 * Returns an object with all signal families.
 *
 * @param {Array} siSeries - Short interest time series
 * @param {Array} ftdSeries - Fail-to-deliver series (optional)
 * @param {Array} creditSpreadSeries - Credit spread time series (optional)
 * @param {Array} volumeSeries - Trading volume series (optional)
 * @param {Object} [options] - Additional data sources
 * @param {Array} [options.ownershipSeries] - Institutional ownership quarterly series
 * @param {Object} [options.sectorSIData] - { ticker: [siSeries] } for SI Zipf velocity
 * @param {string} [options.ticker] - Target ticker (for Zipf velocity)
 * @param {string[]} [options.siRankDates] - Dates for SI rank computation
 */
export function computeAllSignals(siSeries = [], ftdSeries = [], creditSpreadSeries = [], volumeSeries = [], options = {}) {
  const signals = {};

  // Signal Family 1: SI Dynamics
  if (siSeries.length >= 8) {
    signals.si_beta = siBetaScaling(siSeries);
    signals.si_trajectory = siTrajectory(siSeries);
    signals.si_mean_reversion = siMeanReversion(siSeries);
    signals.si_derivatives = siDerivatives(siSeries);
  }

  // Signal Family 2: SI CSD
  if (siSeries.length >= 12) {
    signals.si_csd = siCSD(siSeries);
  }

  // Signal Family 3: Credit Spread Dynamics
  if (creditSpreadSeries.length >= 30) {
    signals.credit_spread_csd = creditSpreadCSD(creditSpreadSeries);
    signals.credit_spread_ou = creditSpreadOU(creditSpreadSeries);
  }

  // Signal Family 4: Benford
  if (volumeSeries.length >= 30) {
    signals.volume_benford = volumeBenford(volumeSeries);
  }
  if (ftdSeries.length >= 30) {
    signals.ftd_benford = ftdBenford(ftdSeries);
  }

  // Signal Family 5: SI Zipf Velocity (sector-relative)
  if (options.sectorSIData && options.ticker && options.siRankDates?.length >= 4) {
    signals.si_zipf_velocity = siZipfVelocity(options.ticker, options.sectorSIData, options.siRankDates);
  }

  // Signal Family 7: Institutional Flow Dynamics
  if (options.ownershipSeries?.length >= 4) {
    signals.institutional_flows = institutionalFlowDynamics(options.ownershipSeries);
    signals.institutional_concentration = institutionalConcentration(options.ownershipSeries);
  }

  // Compute a composite score (0-1) from available signals
  signals.composite = computeComposite(signals);

  return signals;
}

/**
 * Compute a composite "market dynamics health" score (0-1).
 * Higher = market signals suggest the company is in a positive attractor.
 * Lower = market signals suggest negative attractor / value trap.
 */
function computeComposite(signals) {
  const components = [];

  // SI trajectory: shorts covering is bullish
  if (signals.si_trajectory) {
    const t = signals.si_trajectory;
    if (t.trajectory === 'SHORTS_COVERING') components.push(0.8);
    else if (t.trajectory === 'SHORTS_BUILDING') components.push(0.2);
    else if (t.trajectory === 'STABLE') components.push(0.5);
    else components.push(0.5);
  }

  // SI derivatives: decelerating short builds or accelerating covers are bullish
  if (signals.si_derivatives) {
    const d = signals.si_derivatives;
    if (d.phase === 'SHORTS_COLLAPSING') components.push(0.9);
    else if (d.phase === 'SHORTS_BOTTOMING') components.push(0.7);
    else if (d.phase === 'SHORTS_PEAKING') components.push(0.6);
    else if (d.phase === 'SHORTS_ACCELERATING') components.push(0.1);
    else components.push(0.5);
  }

  // Mean reversion: high theta (quick snap-back) is neutral/good
  if (signals.si_mean_reversion) {
    const ou = signals.si_mean_reversion;
    if (ou.meanReverting) components.push(0.6);
    else if (ou.trending) components.push(0.3);
    else components.push(0.5);
  }

  // CSD: consensus forming could be good or bad depending on SI level
  if (signals.si_csd) {
    const csd = signals.si_csd;
    // If SI is declining AND consensus is forming → bullish
    // If SI is rising AND consensus is forming → bearish
    if (signals.si_derivatives?.recentD1 < 0 && csd.csdIndex > 0.6) {
      components.push(0.8); // Positive consensus solidifying
    } else if (signals.si_derivatives?.recentD1 > 0 && csd.csdIndex > 0.6) {
      components.push(0.2); // Negative consensus solidifying
    } else {
      components.push(0.5);
    }
  }

  // SI Zipf velocity: positive velocity = rank number rising = less shorted relative to peers = bullish
  if (signals.si_zipf_velocity) {
    const zv = signals.si_zipf_velocity;
    if (zv.velocity > 1) components.push(0.8);       // Rapidly falling in SI ranks (bullish)
    else if (zv.velocity > 0) components.push(0.6);
    else if (zv.velocity < -1) components.push(0.2);  // Rapidly rising in SI ranks (bearish)
    else if (zv.velocity < 0) components.push(0.4);
    else components.push(0.5);
  }

  // Institutional flows: accumulating = bullish
  if (signals.institutional_flows) {
    const inst = signals.institutional_flows;
    if (inst.phase === 'INSTITUTIONS_ACCUMULATING') components.push(0.75);
    else if (inst.phase === 'INSTITUTIONS_DISTRIBUTING') components.push(0.25);
    else components.push(0.5);

    // Buybacks are a bullish signal
    if (inst.isBuyingBack === true) components.push(0.7);
    else if (inst.avgSharesChange != null && inst.avgSharesChange > 0.02) components.push(0.3); // Diluting
  }

  // Credit spread dynamics: mean-reverting is normal, trending is stressed
  if (signals.credit_spread_ou) {
    const ou = signals.credit_spread_ou;
    if (ou.meanReverting) components.push(0.6);    // Normal regime
    else if (ou.trending) components.push(0.3);    // Stress building
    else components.push(0.5);
  }

  if (components.length === 0) return null;
  return +mean(components).toFixed(3);
}

/**
 * Extract a single numeric score suitable for correlation testing.
 * Maps composite and individual signals to a -1 to 1 range where:
 *   positive = bullish market dynamics (should correlate with winners)
 *   negative = bearish market dynamics (should correlate with traps)
 */
export function extractTestableScores(signals) {
  const scores = {};

  // Composite
  if (signals.composite != null) {
    scores.composite = (signals.composite - 0.5) * 2; // 0-1 → -1 to 1
  }

  // SI trajectory change
  if (signals.si_trajectory) {
    scores.si_change = -signals.si_trajectory.siChange; // Negative SI change is bullish
  }

  // SI D1 (invert: negative D1 = shorts covering = bullish)
  if (signals.si_derivatives) {
    scores.si_d1 = -signals.si_derivatives.recentD1;
    scores.si_d2 = -signals.si_derivatives.recentD2;
  }

  // SI mean reversion theta
  if (signals.si_mean_reversion) {
    scores.si_theta = Math.min(signals.si_mean_reversion.theta, 5); // Cap extreme values
  }

  // SI CSD index
  if (signals.si_csd) {
    scores.si_csd = signals.si_csd.csdIndex;
  }

  // SI beta (level trend)
  if (signals.si_beta) {
    scores.si_beta = -signals.si_beta.beta; // Negative beta = declining SI = bullish
  }

  // SI Zipf velocity (sector-relative rank change)
  if (signals.si_zipf_velocity) {
    scores.si_zipf_velocity = signals.si_zipf_velocity.velocity; // Positive = improving rank = bullish
    scores.si_zipf_effort = signals.si_zipf_velocity.effortAdjusted || 0;
  }

  // Institutional flow dynamics
  if (signals.institutional_flows) {
    scores.inst_d1 = signals.institutional_flows.avgD1;
    scores.inst_filing_trend = signals.institutional_flows.filingTrendSlope;
    if (signals.institutional_flows.avgSharesChange != null) {
      scores.shares_change = -signals.institutional_flows.avgSharesChange; // Negative shares change (buybacks) = bullish
    }
  }

  // Institutional concentration
  if (signals.institutional_concentration) {
    scores.inst_concentration = signals.institutional_concentration.cvSlope;
  }

  // Credit spread CSD
  if (signals.credit_spread_csd) {
    scores.spread_autocorr_slope = signals.credit_spread_csd.autocorrSlope;
    scores.spread_variance_slope = signals.credit_spread_csd.varianceSlope;
  }

  // Credit spread OU
  if (signals.credit_spread_ou) {
    scores.spread_theta = signals.credit_spread_ou.theta;
    scores.spread_half_life = signals.credit_spread_ou.halfLife != null
      ? Math.min(signals.credit_spread_ou.halfLife, 100) : null;
  }

  return scores;
}

// ============================================================
// STORE COMPUTED SIGNALS
// ============================================================

/**
 * Compute and store all market dynamics signals for a company.
 *
 * @param {string} ticker
 * @param {Array} siSeries - Short interest time series
 * @param {Array} ftdSeries - Fail-to-deliver series
 * @param {Array} creditSpreadSeries - Credit spread time series
 * @param {Array} volumeSeries - Trading volume series
 * @param {Object} [options] - Additional data sources
 * @param {Array} [options.ownershipSeries] - Institutional ownership quarterly series
 * @param {Object} [options.sectorSIData] - { ticker: [siSeries] } for SI Zipf velocity
 * @param {string[]} [options.siRankDates] - Dates for SI rank computation
 */
export function computeAndStoreSignals(ticker, siSeries, ftdSeries = [], creditSpreadSeries = [], volumeSeries = [], options = {}) {
  const signals = computeAllSignals(siSeries, ftdSeries, creditSpreadSeries, volumeSeries, { ...options, ticker });
  const scores = extractTestableScores(signals);

  const latestDate = siSeries.length > 0
    ? siSeries[siSeries.length - 1].date
    : new Date().toISOString().split('T')[0];

  try {
    const record = warehouse.createRecord({
      company: ticker,
      data_type: 'discovered', // Store under alternative/discovered
      source: 'computed_market_dynamics',
      source_url: null,
      publication_date: latestDate,
      content: { signals, scores },
      metadata: {
        signal_count: Object.keys(scores).length,
        si_data_points: siSeries.length,
        ftd_data_points: ftdSeries.length,
        ownership_data_points: options.ownershipSeries?.length || 0,
        credit_spread_data_points: creditSpreadSeries.length,
        has_csd: !!signals.si_csd,
        has_ou: !!signals.si_mean_reversion,
        has_zipf: !!signals.si_zipf_velocity,
        has_institutional: !!signals.institutional_flows,
        has_spread_dynamics: !!signals.credit_spread_csd,
      },
    });
    warehouse.storeRecord(record);
  } catch { /* skip storage errors */ }

  return { signals, scores };
}

export default {
  siBetaScaling,
  siTrajectory,
  ornsteinUhlenbeckFit,
  siMeanReversion,
  siCSD,
  buildSectorSIRanking,
  trackSIRankHistory,
  siZipfVelocity,
  creditSpreadCSD,
  creditSpreadOU,
  benfordAnalysis,
  volumeBenford,
  ftdBenford,
  siDerivatives,
  institutionalFlowDynamics,
  institutionalConcentration,
  computeAllSignals,
  extractTestableScores,
  computeAndStoreSignals,
};
