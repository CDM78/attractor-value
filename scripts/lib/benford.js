// Benford's Law multi-digit analysis functions.
// Implements D1, D2, D1D2, D3 tests plus digit convergence profile.

// Consistent significant digit extraction using toExponential()
function getSignificantDigits(n, count) {
  const s = Math.abs(n).toExponential();
  // Format: "1.23456e+7" → mantissa digits are at 0, 2, 3, 4, ...
  const mantissa = s.split('e')[0].replace('.', '');
  return mantissa.substring(0, count);
}

function getFirstDigit(n) {
  return parseInt(getSignificantDigits(n, 1));
}

function getSecondDigit(n) {
  const digits = getSignificantDigits(n, 2);
  return digits.length >= 2 ? parseInt(digits[1]) : null;
}

function getFirstTwoDigits(n) {
  const digits = getSignificantDigits(n, 2);
  return digits.length >= 2 ? parseInt(digits) : null;
}

function getThirdDigit(n) {
  const digits = getSignificantDigits(n, 3);
  return digits.length >= 3 ? parseInt(digits[2]) : null;
}

// ============================================
// SHARED STATISTICS
// ============================================
function computeStats(observed, expected, total, testName) {
  const k = observed.length;

  // KL divergence: D_KL(observed || expected)
  let kld = 0;
  for (let i = 0; i < k; i++) {
    const p = observed[i] / total;
    const q = expected[i];
    if (p > 0 && q > 0) {
      kld += p * Math.log(p / q);
    }
  }

  // Mean Absolute Deviation
  let mad = 0;
  for (let i = 0; i < k; i++) {
    mad += Math.abs((observed[i] / total) - expected[i]);
  }
  mad /= k;

  // Chi-square
  let chiSq = 0;
  for (let i = 0; i < k; i++) {
    const exp = expected[i] * total;
    const obs = observed[i];
    chiSq += ((obs - exp) ** 2) / exp;
  }
  const chiSqDF = k - 1;
  const chiSqCritical = { 8: 15.507, 9: 16.919, 89: 112.022 }[chiSqDF] || null;
  const chiSqSignificant = chiSqCritical ? chiSq > chiSqCritical : null;

  // Nigrini MAD conformity thresholds
  let conformity;
  if (testName === 'first_digit') {
    if (mad < 0.006) conformity = 'close';
    else if (mad < 0.012) conformity = 'acceptable';
    else if (mad < 0.015) conformity = 'marginal';
    else conformity = 'non-conforming';
  } else if (testName === 'second_digit') {
    if (mad < 0.008) conformity = 'close';
    else if (mad < 0.010) conformity = 'acceptable';
    else if (mad < 0.012) conformity = 'marginal';
    else conformity = 'non-conforming';
  } else if (testName === 'first_two_digits') {
    if (mad < 0.0012) conformity = 'close';
    else if (mad < 0.0018) conformity = 'acceptable';
    else if (mad < 0.0022) conformity = 'marginal';
    else conformity = 'non-conforming';
  } else {
    // Third digit and beyond — measure deviation from uniform
    conformity = mad < 0.005 ? 'near-uniform' : 'deviating';
  }

  // Per-bin deviations
  const digitDeviations = observed.map((c, i) => ({
    bin: testName === 'first_digit' ? i + 1 :
         testName === 'first_two_digits' ? i + 10 : i,
    observed: c / total,
    expected: expected[i],
    deviation: (c / total) - expected[i],
    zScore: ((c / total) - expected[i]) /
            Math.sqrt(expected[i] * (1 - expected[i]) / total),
  }));

  return {
    testName, kld, mad, chiSq, chiSqDF, chiSqSignificant, conformity,
    n: total, observed: observed.map(c => c / total), expected, digitDeviations,
  };
}

// ============================================
// FIRST DIGIT TEST (9 bins, d1 = 1 to 9)
// ============================================
export function benfordFirstDigit(numbers) {
  const digits = numbers
    .map(n => Math.abs(n))
    .filter(n => n > 0)
    .map(n => getFirstDigit(n))
    .filter(d => d >= 1 && d <= 9);

  if (digits.length < 50) return null;

  const observed = new Array(9).fill(0);
  digits.forEach(d => observed[d - 1]++);
  const total = digits.length;

  const expected = [];
  for (let d = 1; d <= 9; d++) {
    expected.push(Math.log10(1 + 1 / d));
  }

  return computeStats(observed, expected, total, 'first_digit');
}

// ============================================
// SECOND DIGIT TEST (10 bins, d2 = 0 to 9)
// ============================================
export function benfordSecondDigit(numbers) {
  const digits = numbers
    .map(n => Math.abs(n))
    .filter(n => n >= 10) // Need at least 2 significant digits
    .map(n => getSecondDigit(n))
    .filter(d => d !== null && d >= 0 && d <= 9);

  if (digits.length < 50) return null;

  const observed = new Array(10).fill(0);
  digits.forEach(d => observed[d]++);
  const total = digits.length;

  const expected = [];
  for (let d2 = 0; d2 <= 9; d2++) {
    let p = 0;
    for (let d1 = 1; d1 <= 9; d1++) {
      p += Math.log10(1 + 1 / (10 * d1 + d2));
    }
    expected.push(p);
  }

  return computeStats(observed, expected, total, 'second_digit');
}

// ============================================
// FIRST-TWO DIGITS TEST (90 bins, d1d2 = 10 to 99)
// ============================================
export function benfordFirstTwoDigits(numbers) {
  const twoDigits = numbers
    .map(n => Math.abs(n))
    .filter(n => n >= 10)
    .map(n => getFirstTwoDigits(n))
    .filter(d => d !== null && d >= 10 && d <= 99);

  if (twoDigits.length < 200) return null;

  const observed = new Array(90).fill(0);
  twoDigits.forEach(d => observed[d - 10]++);
  const total = twoDigits.length;

  const expected = [];
  for (let d = 10; d <= 99; d++) {
    expected.push(Math.log10(1 + 1 / d));
  }

  const stats = computeStats(observed, expected, total, 'first_two_digits');

  // Identify top anomalies
  const deviations = [];
  for (let i = 0; i < 90; i++) {
    deviations.push({
      digits: i + 10,
      observed: observed[i] / total,
      expected: expected[i],
      deviation: (observed[i] / total) - expected[i],
      zScore: ((observed[i] / total) - expected[i]) /
              Math.sqrt(expected[i] * (1 - expected[i]) / total),
    });
  }
  deviations.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  stats.topAnomalies = deviations.slice(0, 10);

  // Flag threshold patterns
  stats.thresholdFlags = [];
  const roundNumbers = [20, 25, 30, 40, 50, 75, 99];
  for (const threshold of roundNumbers) {
    if (threshold - 1 >= 10 && threshold - 1 <= 99) {
      const below = deviations.find(d => d.digits === threshold - 1);
      const at = threshold <= 99 ? deviations.find(d => d.digits === threshold) : null;
      if (below && below.zScore > 2.0) {
        stats.thresholdFlags.push({
          threshold,
          belowDigits: threshold - 1,
          belowZScore: below.zScore,
          atZScore: at ? at.zScore : null,
          pattern: `Spike at ${threshold - 1}, possible ${threshold}x threshold gaming`,
        });
      }
    }
  }

  return stats;
}

// ============================================
// THIRD DIGIT TEST (10 bins, d3 = 0 to 9)
// ============================================
export function benfordThirdDigit(numbers) {
  const digits = numbers
    .map(n => Math.abs(n))
    .filter(n => n >= 100) // Need at least 3 significant digits
    .map(n => getThirdDigit(n))
    .filter(d => d !== null && d >= 0 && d <= 9);

  if (digits.length < 50) return null;

  const observed = new Array(10).fill(0);
  digits.forEach(d => observed[d]++);
  const total = digits.length;

  // Third digit expected: compute from joint distribution
  const expected = [];
  for (let d3 = 0; d3 <= 9; d3++) {
    let p = 0;
    for (let d1 = 1; d1 <= 9; d1++) {
      for (let d2 = 0; d2 <= 9; d2++) {
        p += Math.log10(1 + 1 / (100 * d1 + 10 * d2 + d3));
      }
    }
    expected.push(p);
  }

  return computeStats(observed, expected, total, 'third_digit');
}

// ============================================
// DIGIT CONVERGENCE ANALYSIS
// ============================================
export function digitConvergenceProfile(numbers) {
  const d1 = benfordFirstDigit(numbers);
  const d2 = benfordSecondDigit(numbers);
  const d3 = benfordThirdDigit(numbers);

  if (!d1 || !d2) return null;

  // KLD from uniform distribution at each digit position
  const uniformKLD = (observed, k) => {
    const uniform = 1 / k;
    let kld = 0;
    for (let i = 0; i < observed.length; i++) {
      if (observed[i] > 0) {
        kld += observed[i] * Math.log(observed[i] / uniform);
      }
    }
    return kld;
  };

  const d1_uniformKLD = uniformKLD(d1.observed, 9);
  const d2_uniformKLD = uniformKLD(d2.observed, 10);
  const d3_uniformKLD = d3 ? uniformKLD(d3.observed, 10) : null;

  const convergenceRatio = d2_uniformKLD / d1_uniformKLD;

  return {
    d1_benfordKLD: d1.kld,
    d2_benfordKLD: d2.kld,
    d1_uniformKLD,
    d2_uniformKLD,
    d3_uniformKLD,
    convergenceRatio,
    d1_conformity: d1.conformity,
    d2_conformity: d2.conformity,
    d3_conformity: d3 ? d3.conformity : 'insufficient data',
    flags: [
      ...(d1_uniformKLD < 0.05 ? ['D1_TOO_UNIFORM: First digits suspiciously close to uniform distribution — possible fabrication'] : []),
      ...(d1.conformity !== 'non-conforming' && d2.conformity === 'non-conforming' ?
        ['D2_FAILS_D1_PASSES: Second digit non-conforming despite acceptable first digit — possible sophisticated manipulation'] : []),
      ...(d3 && d3_uniformKLD > 0.01 ? ['D3_NOT_CONVERGING: Third digit still far from uniform — possible systematic digit manipulation'] : []),
      ...(convergenceRatio > 0.8 ? ['FLAT_CONVERGENCE: Digits not converging naturally — distribution too uniform across all positions'] : []),
    ],
  };
}

// Run all digit tests on a number set — convenience function
export function runAllTests(numbers) {
  return {
    firstDigit: benfordFirstDigit(numbers),
    secondDigit: benfordSecondDigit(numbers),
    firstTwoDigits: benfordFirstTwoDigits(numbers),
    thirdDigit: benfordThirdDigit(numbers),
    convergence: digitConvergenceProfile(numbers),
  };
}
