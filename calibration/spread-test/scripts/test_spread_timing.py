#!/usr/bin/env python3
"""Phase 2: Test spread timing signals with Newey-West correction."""

import csv
import math
from pathlib import Path

CAL = Path('/home/cm/attractor-value/calibration/spread-test')

def pearsonr(x, y):
    n = len(x)
    if n < 5: return 0, 1, n
    mx = sum(x)/n; my = sum(y)/n
    sx = math.sqrt(sum((xi-mx)**2 for xi in x)/(n-1))
    sy = math.sqrt(sum((yi-my)**2 for yi in y)/(n-1))
    if sx == 0 or sy == 0: return 0, 1, n
    cov = sum((x[i]-mx)*(y[i]-my) for i in range(n))/(n-1)
    r = cov/(sx*sy)
    t = r * math.sqrt((n-2)/max(1-r*r, 1e-12))
    p = 2*(1-0.5*(1+math.erf(abs(t)/math.sqrt(2))))
    return r, p, n

def newey_west_t(x, y, lags=36):
    """t-statistic with HAC standard errors for overlapping returns."""
    n = len(x)
    mx = sum(x)/n; my = sum(y)/n
    x_dm = [xi-mx for xi in x]
    y_dm = [yi-my for yi in y]

    sum_x2 = sum(xi**2 for xi in x_dm)
    if sum_x2 == 0: return 0, 1, 0

    beta = sum(x_dm[i]*y_dm[i] for i in range(n)) / sum_x2
    resid = [y_dm[i] - beta*x_dm[i] for i in range(n)]

    gamma_0 = sum(r**2 for r in resid) / n
    nw_var = gamma_0
    for lag in range(1, min(lags+1, n)):
        weight = 1 - lag/(lags+1)
        gamma_l = sum(resid[i]*resid[i-lag] for i in range(lag, n)) / n
        nw_var += 2 * weight * gamma_l

    se_beta = math.sqrt(max(nw_var, 1e-12) / max(sum_x2, 1e-12))
    t_stat = beta / se_beta if se_beta > 1e-12 else 0
    p_nw = 2*(1-0.5*(1+math.erf(abs(t_stat)/math.sqrt(2))))
    return t_stat, p_nw, beta

def percentile(arr, pct):
    s = sorted(arr)
    k = (len(s)-1)*pct/100
    f, c = math.floor(k), math.ceil(k)
    if f == c: return s[int(k)]
    return s[f]*(c-k) + s[c]*(k-f)

# Load dataset
with open(CAL / 'spread-monthly-dataset.csv') as f:
    rows = list(csv.DictReader(f))

print(f"Loaded {len(rows)} months\n")

signals = ['spread_level', 'spread_zscore', 'spread_percentile', 'spread_slope', 'spread_variance']
horizons = ['forward_return_1yr', 'forward_return_2yr', 'forward_return_3yr']

print("=" * 80)
print("  SPREAD TIMING SIGNAL TESTS")
print("=" * 80)

for horizon in horizons:
    print(f"\n{'─'*80}")
    print(f"  Horizon: {horizon}")
    print(f"{'─'*80}\n")

    for signal in signals:
        for period_label, period_filter in [('all', None), ('in_sample', 'in_sample'), ('out_of_sample', 'out_of_sample')]:
            subset = rows if period_filter is None else [r for r in rows if r['period'] == period_filter]
            valid = []
            for r in subset:
                try:
                    s = float(r[signal]) if r.get(signal, '') else None
                    ret = float(r[horizon]) if r.get(horizon, '') else None
                    if s is not None and ret is not None:
                        valid.append((s, ret))
                except: pass

            if len(valid) < 10:
                print(f"  {signal} ({period_label}): INSUFFICIENT (n={len(valid)})")
                continue

            sigs = [v[0] for v in valid]
            rets = [v[1] for v in valid]

            r, p, n = pearsonr(sigs, rets)

            # Newey-West
            if horizon == 'forward_return_3yr':
                t_nw, p_nw, beta = newey_west_t(sigs, rets, lags=36)
            elif horizon == 'forward_return_2yr':
                t_nw, p_nw, beta = newey_west_t(sigs, rets, lags=24)
            else:
                t_nw, p_nw, beta = newey_west_t(sigs, rets, lags=12)

            # Quartile
            q25 = percentile(sigs, 25)
            q75 = percentile(sigs, 75)
            top_q = [rets[i] for i in range(len(sigs)) if sigs[i] >= q75]
            bot_q = [rets[i] for i in range(len(sigs)) if sigs[i] <= q25]
            top_mean = sum(top_q)/len(top_q) if top_q else 0
            bot_mean = sum(bot_q)/len(bot_q) if bot_q else 0

            print(f"  {signal} ({period_label}):")
            print(f"    r={r:.3f}, p(naive)={p:.4f}, p(Newey-West)={p_nw:.4f}, n={n}")
            print(f"    Top-Q: {top_mean:.3f} (n={len(top_q)}), Bot-Q: {bot_mean:.3f} (n={len(bot_q)}), Spread: {top_mean-bot_mean:.3f}")

            # Winsorize if r > 0.15
            if abs(r) > 0.15 and n > 50:
                p5, p95 = percentile(rets, 5), percentile(rets, 95)
                winsorized = [max(p5, min(p95, v)) for v in rets]
                rw, pw, _ = pearsonr(sigs, winsorized)
                print(f"    Winsorized: r={rw:.3f}, p={pw:.4f}")

        print()

# In-sample vs out-of-sample comparison table
print("\n" + "=" * 80)
print("  IN-SAMPLE vs OUT-OF-SAMPLE COMPARISON (forward_return_3yr)")
print("=" * 80 + "\n")
print(f"  {'Signal':<25} {'IS r':>8} {'IS p(NW)':>10} {'OOS r':>8} {'OOS p(NW)':>10} {'Verdict':>10}")
print("  " + "─" * 75)

for signal in signals:
    for period, label in [('in_sample', 'IS'), ('out_of_sample', 'OOS')]:
        subset = [r for r in rows if r['period'] == period]
        valid = [(float(r[signal]), float(r['forward_return_3yr']))
                 for r in subset if r.get(signal, '') and r.get('forward_return_3yr', '')]
        if len(valid) < 10:
            if label == 'IS': is_r, is_p = None, None
            else: oos_r, oos_p = None, None
            continue
        sigs = [v[0] for v in valid]
        rets = [v[1] for v in valid]
        r, p, n = pearsonr(sigs, rets)
        _, p_nw, _ = newey_west_t(sigs, rets, 36)
        if label == 'IS': is_r, is_p = r, p_nw
        else: oos_r, oos_p = r, p_nw

    verdict = 'HOLDS' if oos_r is not None and oos_r > 0 and oos_r > is_r * 0.5 else \
              'WEAKENED' if oos_r is not None and oos_r > 0 else \
              'FAILED' if oos_r is not None else '?'

    print(f"  {signal:<25} {is_r:>8.3f} {is_p:>10.4f} {oos_r:>8.3f} {oos_p:>10.4f} {verdict:>10}")

# Non-overlapping subsample
print("\n" + "=" * 80)
print("  NON-OVERLAPPING SUBSAMPLE (every 36 months)")
print("=" * 80 + "\n")

non_overlap = [r for r in rows if r['year_month'] in
               ['2000-01', '2003-01', '2006-01', '2009-01', '2012-01', '2015-01', '2018-01', '2021-01']
               and r.get('forward_return_3yr', '')]

if len(non_overlap) >= 3:
    spreads = [(float(r['spread_level']), float(r['forward_return_3yr']), r['year_month']) for r in non_overlap]
    spreads.sort()
    n = len(spreads)
    t1 = n // 3
    low = spreads[:t1]
    mid = spreads[t1:2*t1]
    high = spreads[2*t1:]

    print(f"  Total non-overlapping points: {n}")
    print(f"  Low spread:  mean 3yr return = {sum(s[1] for s in low)/len(low):.1%} (months: {[s[2] for s in low]})")
    print(f"  Mid spread:  mean 3yr return = {sum(s[1] for s in mid)/len(mid):.1%} (months: {[s[2] for s in mid]})")
    print(f"  High spread: mean 3yr return = {sum(s[1] for s in high)/len(high):.1%} (months: {[s[2] for s in high]})")

    if n >= 5:
        r_no, p_no, n_no = pearsonr([s[0] for s in spreads], [s[1] for s in spreads])
        print(f"  Pearson r: {r_no:.3f}, p={p_no:.4f}, n={n_no}")
