// Random Matrix Theory — Marchenko-Pastur eigenvalue cleaning
// Separates genuine structure from noise in multi-signal correlation matrices.

/**
 * Compute M×M correlation matrix from N×M data matrix.
 * Input: array of arrays, each inner array = one case's signal values.
 */
export function correlationMatrix(data) {
  const N = data.length;
  const M = data[0].length;

  // Compute means and stds
  const means = new Array(M).fill(0);
  const stds = new Array(M).fill(0);

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) means[j] += data[i][j];
    means[j] /= N;
    for (let i = 0; i < N; i++) stds[j] += (data[i][j] - means[j]) ** 2;
    stds[j] = Math.sqrt(stds[j] / (N - 1));
    if (stds[j] < 1e-12) stds[j] = 1; // prevent division by zero
  }

  // Standardize
  const Z = data.map(row => row.map((v, j) => (v - means[j]) / stds[j]));

  // Correlation = (1/N) Z^T Z
  const C = Array.from({ length: M }, () => new Array(M).fill(0));
  for (let i = 0; i < M; i++) {
    for (let j = i; j < M; j++) {
      let sum = 0;
      for (let k = 0; k < N; k++) sum += Z[k][i] * Z[k][j];
      C[i][j] = sum / (N - 1);
      C[j][i] = C[i][j];
    }
  }

  return { C, means, stds, Z };
}

/**
 * Eigendecomposition via Jacobi iteration (for small symmetric matrices).
 * Returns eigenvalues (descending) and eigenvectors.
 */
export function eigendecompose(matrix) {
  const n = matrix.length;
  let A = matrix.map(row => [...row]);
  let V = Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0);
    row[i] = 1;
    return row;
  });

  const maxIter = 100 * n * n;
  for (let iter = 0; iter < maxIter; iter++) {
    // Find largest off-diagonal element
    let maxVal = 0, p = 0, q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][j]) > maxVal) {
          maxVal = Math.abs(A[i][j]);
          p = i; q = j;
        }
      }
    }

    if (maxVal < 1e-12) break;

    // Compute rotation
    const theta = 0.5 * Math.atan2(2 * A[p][q], A[p][p] - A[q][q]);
    const c = Math.cos(theta), s = Math.sin(theta);

    // Apply rotation to A
    const newA = A.map(row => [...row]);
    for (let i = 0; i < n; i++) {
      newA[i][p] = c * A[i][p] + s * A[i][q];
      newA[i][q] = -s * A[i][p] + c * A[i][q];
    }
    for (let j = 0; j < n; j++) {
      A[p][j] = c * newA[p][j] + s * newA[q][j];
      A[q][j] = -s * newA[p][j] + c * newA[q][j];
    }
    A[p][q] = 0; A[q][p] = 0;

    // Update eigenvectors
    for (let i = 0; i < n; i++) {
      const vp = V[i][p], vq = V[i][q];
      V[i][p] = c * vp + s * vq;
      V[i][q] = -s * vp + c * vq;
    }
  }

  // Extract eigenvalues and sort descending
  const eigenvalues = A.map((row, i) => row[i]);
  const indices = eigenvalues.map((v, i) => i).sort((a, b) => eigenvalues[b] - eigenvalues[a]);

  const sortedVals = indices.map(i => eigenvalues[i]);
  const sortedVecs = indices.map(i => V.map(row => row[i]));

  return { eigenvalues: sortedVals, eigenvectors: sortedVecs };
}

/**
 * Marchenko-Pastur bounds.
 * @param {number} M - number of signals (columns)
 * @param {number} N - number of cases (rows)
 */
export function marchenkoPastur(M, N) {
  const q = M / N;
  const lambda_plus = (1 + Math.sqrt(q)) ** 2;
  const lambda_minus = (1 - Math.sqrt(q)) ** 2;
  return { q, lambda_plus, lambda_minus };
}

/**
 * Full RMT analysis pipeline.
 * @param {Array} data - N×M matrix (each row = case, each col = signal)
 * @param {string[]} signalNames - names for each column
 */
export function rmtAnalysis(data, signalNames) {
  const N = data.length;
  const M = data[0].length;

  const { C, means, stds, Z } = correlationMatrix(data);
  const { eigenvalues, eigenvectors } = eigendecompose(C);
  const { q, lambda_plus, lambda_minus } = marchenkoPastur(M, N);

  const totalVariance = eigenvalues.reduce((s, v) => s + v, 0);

  const factors = eigenvalues.map((val, i) => {
    const significant = val > lambda_plus;
    const loadings = {};
    eigenvectors[i].forEach((v, j) => { loadings[signalNames[j]] = +v.toFixed(4); });

    return {
      index: i + 1,
      eigenvalue: +val.toFixed(4),
      variance_explained: +(val / totalVariance).toFixed(4),
      cumulative_variance: +(eigenvalues.slice(0, i + 1).reduce((s, v) => s + v, 0) / totalVariance).toFixed(4),
      significant,
      loadings,
    };
  });

  const significantFactors = factors.filter(f => f.significant);

  // Project cases onto significant eigenvectors
  const factorScores = Z.map(row => {
    const scores = {};
    for (const f of significantFactors) {
      const vec = eigenvectors[f.index - 1];
      let score = 0;
      for (let j = 0; j < M; j++) score += row[j] * vec[j];
      scores[`factor_${f.index}`] = score;
    }
    return scores;
  });

  // RMT composite: eigenvalue-weighted sum of factor scores
  const rmtComposite = factorScores.map(scores => {
    let composite = 0;
    for (const f of significantFactors) {
      composite += f.eigenvalue * (scores[`factor_${f.index}`] || 0);
    }
    return composite;
  });

  return {
    N, M, q: +q.toFixed(4),
    lambda_plus: +lambda_plus.toFixed(4),
    lambda_minus: +lambda_minus.toFixed(4),
    factors,
    significantFactors,
    n_significant: significantFactors.length,
    factorScores,
    rmtComposite,
    correlationMatrix: C,
  };
}

export default { correlationMatrix, eigendecompose, marchenkoPastur, rmtAnalysis };
