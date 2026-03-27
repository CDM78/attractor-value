#!/usr/bin/env python3
"""
Shared statistical functions for Job 2 analysis scripts.
Pure functions — no side effects, no file I/O at import time.
"""

import math, statistics


def pearsonr(x, y):
    """Compute Pearson r and two-tailed p-value."""
    n = len(x)
    if n < 3:
        return float('nan'), float('nan'), n
    mx, my = statistics.mean(x), statistics.mean(y)
    sx = math.sqrt(sum((xi - mx)**2 for xi in x) / (n - 1))
    sy = math.sqrt(sum((yi - my)**2 for yi in y) / (n - 1))
    if sx == 0 or sy == 0:
        return float('nan'), float('nan'), n
    r = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y)) / ((n - 1) * sx * sy)
    # t-test for significance
    if abs(r) >= 1.0:
        return r, 0.0, n
    t = r * math.sqrt((n - 2) / (1 - r**2))
    df = n - 2
    if df > 30:
        p = math.erfc(abs(t) / math.sqrt(2))
    else:
        x_val = df / (df + t**2)
        p = _betai(df/2, 0.5, x_val)
    return r, p, n


def _betai(a, b, x):
    """Regularized incomplete beta function (approximation)."""
    if x < 0 or x > 1:
        return 0.0
    if x == 0 or x == 1:
        return x
    if x > (a + 1) / (a + b + 2):
        return 1.0 - _betai(b, a, 1.0 - x)
    lbeta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    front = math.exp(math.log(x) * a + math.log(1 - x) * b - lbeta) / a
    f = 1.0
    c = 1.0
    d = 1.0 - (a + b) * x / (a + 1)
    if abs(d) < 1e-30:
        d = 1e-30
    d = 1.0 / d
    f = d
    for i in range(1, 200):
        m = i
        num = m * (b - m) * x / ((a + 2*m - 1) * (a + 2*m))
        d = 1.0 + num * d
        if abs(d) < 1e-30: d = 1e-30
        c = 1.0 + num / c
        if abs(c) < 1e-30: c = 1e-30
        d = 1.0 / d
        f *= d * c
        num = -(a + m) * (a + b + m) * x / ((a + 2*m) * (a + 2*m + 1))
        d = 1.0 + num * d
        if abs(d) < 1e-30: d = 1e-30
        c = 1.0 + num / c
        if abs(c) < 1e-30: c = 1e-30
        d = 1.0 / d
        delta = d * c
        f *= delta
        if abs(delta - 1.0) < 1e-8:
            break
    return front * f


def winsorize(vals, pct=5):
    """Winsorize at pct/100-pct percentiles."""
    s = sorted(vals)
    n = len(s)
    lo = s[int(n * pct / 100)]
    hi = s[int(n * (100 - pct) / 100)]
    return [max(lo, min(hi, v)) for v in vals]


def ttest_ind(x, y):
    """Two-sample t-test (Welch's unequal variance)."""
    n1, n2 = len(x), len(y)
    if n1 < 2 or n2 < 2:
        return float('nan'), float('nan')
    m1, m2 = statistics.mean(x), statistics.mean(y)
    v1 = statistics.variance(x)
    v2 = statistics.variance(y)
    se = math.sqrt(v1/n1 + v2/n2)
    if se == 0:
        return float('nan'), float('nan')
    t = (m1 - m2) / se
    num = (v1/n1 + v2/n2)**2
    den = (v1/n1)**2/(n1-1) + (v2/n2)**2/(n2-1)
    df = num / den if den > 0 else 1
    if df > 30:
        p = math.erfc(abs(t) / math.sqrt(2))
    else:
        x_val = df / (df + t**2)
        p = _betai(df/2, 0.5, x_val)
    return t, p


def safe_float(v):
    """Parse string to float, returning None on failure."""
    try:
        return float(v) if v and str(v).strip() not in ('', 'N/A', 'na') else None
    except (ValueError, TypeError):
        return None
