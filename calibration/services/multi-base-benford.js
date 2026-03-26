// Multi-Base Benford Analysis
// Financial data is manipulated in base 10. Benford's law holds in ANY base
// for genuine scale-invariant data. Deviations in base 10 but NOT others = manipulation.

function benfordExpected(digit, base) {
  return Math.log(1 + 1 / digit) / Math.log(base);
}

function computeKLD(observed, expected) {
  let kld = 0;
  for (let i = 0; i < observed.length; i++) {
    if (observed[i] > 0 && expected[i] > 0) {
      kld += observed[i] * Math.log(observed[i] / expected[i]);
    }
  }
  return kld;
}

function firstDigitInBase(value, base) {
  const absVal = Math.abs(value);
  if (absVal < 1e-10) return null;
  let v = absVal;
  while (v >= base) v /= base;
  while (v < 1) v *= base;
  return Math.floor(v);
}

/**
 * Benford analysis across multiple bases.
 * @param {number[]} values - financial metric values
 * @param {number[]} bases - bases to test (default: [6, 10, 12, 60])
 */
export function multiBaseBenford(values, bases = [6, 10, 12, 60]) {
  const results = {};

  for (const base of bases) {
    const digitCounts = new Array(base - 1).fill(0);
    let total = 0;

    for (const v of values) {
      const d = firstDigitInBase(v, base);
      if (d !== null && d >= 1 && d < base) {
        digitCounts[d - 1]++;
        total++;
      }
    }

    if (total < 30) {
      results[`base_${base}`] = { kld: null, n: total, insufficient: true };
      continue;
    }

    const observed = digitCounts.map(c => c / total);
    const expected = Array.from({ length: base - 1 }, (_, i) => benfordExpected(i + 1, base));
    results[`base_${base}`] = { kld: computeKLD(observed, expected), n: total };
  }

  const nonBase10KLDs = bases
    .filter(b => b !== 10)
    .map(b => results[`base_${b}`]?.kld)
    .filter(k => k != null);

  const base10KLD = results.base_10?.kld;
  const avgNonBase10 = nonBase10KLDs.length > 0
    ? nonBase10KLDs.reduce((s, v) => s + v, 0) / nonBase10KLDs.length : null;

  results.base10_excess = (base10KLD != null && avgNonBase10 != null)
    ? base10KLD - avgNonBase10 : null;

  const allDeviate = nonBase10KLDs.length > 0 && nonBase10KLDs.every(k => k > 0.005) && base10KLD > 0.005;
  const onlyBase10 = base10KLD > 0.005 && nonBase10KLDs.length > 0 && nonBase10KLDs.every(k => k < 0.003);

  results.classification = allDeviate ? 'STRUCTURAL_STRESS'
    : onlyBase10 ? 'HUMAN_MANIPULATION' : 'NATURAL_PROCESS';

  return results;
}

/**
 * Round-number clustering in EPS values.
 * @param {number[]} epsHistory - quarterly EPS values
 */
export function roundNumberExcess(epsHistory) {
  let total = 0, roundCount = 0;
  for (const eps of epsHistory) {
    const cents = Math.round(Math.abs(eps) * 100);
    const lastDigit = cents % 10;
    if (lastDigit === 0 || lastDigit === 5) roundCount++;
    total++;
  }
  if (total < 8) return null;
  return { roundFraction: roundCount / total, excess: (roundCount / total) - 0.20, n: total };
}

export default { multiBaseBenford, roundNumberExcess };
