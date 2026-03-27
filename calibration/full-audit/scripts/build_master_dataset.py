#!/usr/bin/env python3
"""Phase 1: Build master audit dataset with ALL signals computed from EDGAR data."""

import json
import csv
import math
import random
from pathlib import Path
from collections import Counter

CAL = Path(__file__).parent.parent.parent

def safe_float(val):
    try: return float(val) if val not in (None, '', 'None') else None
    except: return None

# ============================================================
# SIGNAL COMPUTATIONS (Pure Python — no numpy needed)
# ============================================================

def linear_regression(x, y):
    n = len(x)
    if n < 3: return None
    mx = sum(x)/n; my = sum(y)/n
    num = sum((x[i]-mx)*(y[i]-my) for i in range(n))
    den = sum((x[i]-mx)**2 for i in range(n))
    if den == 0: return None
    slope = num / den
    intercept = my - slope * mx
    return slope, intercept

def compute_beta_level(revenue_series, equity_series):
    """β scaling: log(revenue) vs log(equity)."""
    if len(revenue_series) < 8 or len(equity_series) < 8: return None
    pairs = []
    for r, e in zip(revenue_series[-8:], equity_series[-8:]):
        if r > 0 and e > 0:
            pairs.append((math.log10(e), math.log10(r)))
    if len(pairs) < 6: return None
    result = linear_regression([p[0] for p in pairs], [p[1] for p in pairs])
    return result[0] if result else None

def compute_beta_trajectory(revenue_series, equity_series):
    """β trajectory: split into early/late halves, compare β."""
    n = min(len(revenue_series), len(equity_series))
    if n < 12: return None
    mid = n // 2
    early_r, early_e = revenue_series[:mid], equity_series[:mid]
    late_r, late_e = revenue_series[mid:], equity_series[mid:]
    beta_early = compute_beta_level(early_r, early_e)
    beta_late = compute_beta_level(late_r, late_e)
    if beta_early is None or beta_late is None: return None
    return beta_late - beta_early

def compute_hurst(series):
    """Hurst exponent via R/S analysis on growth rates."""
    if len(series) < 16: return None
    # Compute growth rates
    growth = [(series[i] - series[i-1]) / series[i-1] if series[i-1] != 0 else 0
              for i in range(1, len(series)) if series[i-1] != 0]
    if len(growth) < 10: return None

    n = len(growth)
    mean_g = sum(growth) / n

    # R/S at different scales
    log_rs = []
    log_n = []
    for k in [4, 6, 8, 10, min(n, 12)]:
        if k > n: break
        rs_values = []
        for start in range(0, n - k + 1, max(1, k // 2)):
            segment = growth[start:start+k]
            m = sum(segment) / k
            cumdev = []
            s = 0
            for v in segment:
                s += v - m
                cumdev.append(s)
            R = max(cumdev) - min(cumdev)
            S = math.sqrt(sum((v - m)**2 for v in segment) / k) if k > 1 else 1e-10
            if S > 1e-10:
                rs_values.append(R / S)
        if rs_values:
            avg_rs = sum(rs_values) / len(rs_values)
            if avg_rs > 0:
                log_rs.append(math.log(avg_rs))
                log_n.append(math.log(k))

    if len(log_rs) < 3: return None
    result = linear_regression(log_n, log_rs)
    return result[0] if result else None

def compute_revenue_derivatives(series):
    """D1 (growth rate) and D2 (acceleration) of revenue."""
    if len(series) < 6: return None, None
    # YoY growth rates (comparing Q to Q-4 where possible, else sequential)
    d1_values = []
    for i in range(4, len(series)):
        if series[i-4] > 0:
            d1_values.append((series[i] - series[i-4]) / series[i-4])
    if len(d1_values) < 2: return None, None

    d1 = sum(d1_values[-4:]) / min(len(d1_values), 4)  # Recent D1

    # D2 = change in D1
    if len(d1_values) >= 4:
        early_d1 = sum(d1_values[:len(d1_values)//2]) / (len(d1_values)//2)
        late_d1 = sum(d1_values[len(d1_values)//2:]) / (len(d1_values) - len(d1_values)//2)
        d2 = late_d1 - early_d1
    else:
        d2 = None

    return d1, d2

def compute_scurve_phase(d1, d2):
    """Classify S-curve phase from D1 and D2."""
    if d1 is None or d2 is None: return None
    if d1 > 0 and d2 > 0: return 'ACCELERATING'
    if d1 > 0 and d2 <= 0: return 'PEAK'
    if d1 <= 0 and d2 < 0: return 'DECELERATING'
    if d1 <= 0 and d2 >= 0: return 'TROUGH'
    return None

def compute_fin_csd(series):
    """Critical slowing down on financial time series."""
    if len(series) < 12: return None
    growth = [(series[i] - series[i-1]) / series[i-1] if series[i-1] != 0 else 0
              for i in range(1, len(series)) if series[i-1] != 0]
    if len(growth) < 8: return None

    # Rolling autocorrelation
    window = 4
    acs = []
    for i in range(window, len(growth)):
        w = growth[i-window:i]
        m = sum(w) / window
        num = sum((w[j]-m)*(w[j+1]-m) if j+1 < window else 0 for j in range(window-1))
        den = sum((w[j]-m)**2 for j in range(window))
        acs.append(num / den if den > 0 else 0)

    if len(acs) < 3: return None
    # Trend in autocorrelation
    result = linear_regression(list(range(len(acs))), acs)
    return result[0] if result else None

def compute_benford_kld(values):
    """Benford first-digit KL divergence."""
    if len(values) < 30: return None
    expected = [0, math.log10(2), math.log10(3/2), math.log10(4/3), math.log10(5/4),
                math.log10(6/5), math.log10(7/6), math.log10(8/7), math.log10(9/8)]
    counts = [0] * 10
    for v in values:
        if v > 0:
            s = str(v)
            for c in s:
                if c.isdigit() and c != '0':
                    counts[int(c)] += 1
                    break
    total = sum(counts[1:])
    if total < 30: return None
    observed = [counts[d] / total for d in range(1, 10)]
    kld = sum(observed[i] * math.log(observed[i] / expected[i+1]) if observed[i] > 0 and expected[i+1] > 0 else 0 for i in range(9))
    return kld

# ============================================================
# MAIN: Load data and compute all signals
# ============================================================

print("Building master audit dataset...\n")

# Load existing analysis dataset as base
base_rows = {}
base_path = CAL / 'retest-quant/analysis-dataset.csv'
with open(base_path) as f:
    for r in csv.DictReader(f):
        base_rows[r['case_id']] = r

print(f"Base dataset: {len(base_rows)} cases")

# Load EDGAR raw data
edgar_dir = CAL / 'midcap-edgar-raw'

# Load mid-cap cases for matching
mc = json.loads((CAL / 'midcap-cases.json').read_text())
mc_cases = {c['case_id']: c for c in mc['cases']
            if c['cross_section'] in ('2020-Q3', '2022-Q1') and c.get('forward_return_3yr') is not None}

print(f"Mid-cap cases (2020-Q3 + 2022-Q1): {len(mc_cases)}")

# Extract quarterly financial series from EDGAR
def get_quarterly_values(concepts, concept_patterns, before_date, min_entries=8):
    for pattern in concept_patterns:
        for key in concepts:
            if pattern.lower() in key.lower():
                entries = concepts[key]
                if not isinstance(entries, list): continue
                filtered = [e for e in entries if e.get('end', '') <= before_date
                           and e.get('form') in ('10-Q', '10-K') and e.get('val', 0) > 0]
                filtered.sort(key=lambda e: e['end'])
                # Deduplicate by end date
                seen = set()
                deduped = []
                for e in filtered:
                    if e['end'] not in seen:
                        seen.add(e['end'])
                        deduped.append(e['val'])
                if len(deduped) >= min_entries:
                    return deduped
    return []

# Compute new signals for each case
new_signals = {}
computed = Counter()

for case_id, mc_case in mc_cases.items():
    ticker = mc_case['ticker']
    entry_date = mc_case['entry_date']
    edgar_path = edgar_dir / f'{ticker}.json'

    if not edgar_path.exists():
        continue

    edgar = json.loads(edgar_path.read_text())
    concepts = edgar.get('concepts', edgar.get('facts', {}))

    signals = {}

    # Get revenue series
    revenue = get_quarterly_values(concepts,
        ['Revenue', 'SalesRevenue'], entry_date, 8)

    # Get equity series
    equity = get_quarterly_values(concepts,
        ['StockholdersEquity', 'Equity'], entry_date, 8)

    # Get assets series
    assets = get_quarterly_values(concepts, ['Assets'], entry_date, 8)

    # β level and trajectory
    if revenue and equity:
        signals['beta_level'] = compute_beta_level(revenue, equity)
        signals['beta_trajectory'] = compute_beta_trajectory(revenue, equity)
        computed['beta'] += 1

    # Hurst exponent
    if revenue and len(revenue) >= 16:
        h = compute_hurst(revenue)
        signals['hurst_revenue'] = h
        # Hurst × growth direction
        if h is not None and len(revenue) >= 8:
            mean_growth = (revenue[-1] / revenue[0]) ** (4/len(revenue)) - 1 if revenue[0] > 0 else 0
            signals['hurst_x_growth_direction'] = h * (1 if mean_growth > 0 else -1)
        computed['hurst'] += 1

    # Revenue derivatives (D1, D2)
    if revenue and len(revenue) >= 6:
        d1, d2 = compute_revenue_derivatives(revenue)
        signals['fin_d1_growth'] = d1
        signals['revenue_d1'] = d1
        signals['revenue_d2'] = d2
        signals['scurve_phase'] = compute_scurve_phase(d1, d2)
        computed['d1d2'] += 1

    # Financial CSD
    if revenue and len(revenue) >= 12:
        signals['fin_csd'] = compute_fin_csd(revenue)
        computed['fin_csd'] += 1

    # Financial Benford KLD
    all_values = []
    for key in concepts:
        entries = concepts[key]
        if not isinstance(entries, list): continue
        for e in entries:
            if e.get('end', '') <= entry_date and e.get('val', 0) > 0:
                all_values.append(e['val'])
    if len(all_values) >= 50:
        signals['fin_benford_kld'] = compute_benford_kld(all_values)
        computed['fin_benford'] += 1

    # β velocity (change in β over time)
    if signals.get('beta_level') is not None and revenue and equity and len(revenue) >= 16:
        mid = len(revenue) // 2
        beta_early = compute_beta_level(revenue[:mid+4], equity[:mid+4])
        beta_late = compute_beta_level(revenue[mid-4:], equity[mid-4:])
        if beta_early is not None and beta_late is not None:
            signals['beta_velocity'] = beta_late - beta_early

    new_signals[case_id] = signals

print(f"\nSignals computed:")
for k, v in sorted(computed.items()):
    print(f"  {k}: {v}")

# Merge with base dataset
fieldnames = [
    'case_id', 'ticker', 'cik', 'sector', 'market_cap_at_entry',
    'entry_date', 'entry_cross_section',
    'outcome_class', 'forward_return_3yr', 'sp500_return_3yr',
    # Spread
    'spread_variance_slope', 'spread_theta',
    # SI
    'si_zipf_velocity', 'si_csd', 'si_d1', 'si_d2', 'si_theta',
    'si_zipf_x_d1', 'composite',
    # Volume
    'volume_benford_kld',
    # Financial statement
    'beta_level', 'beta_trajectory', 'beta_velocity',
    'fin_csd', 'fin_benford_kld', 'fin_d1_growth',
    # Fisher/Benford/EPS
    'fisher_information', 'benford_structural_stress', 'eps_round_number_excess',
    # Insider
    'form4_net_value', 'form4_buy_sell_ratio', 'form4_net_direction',
    'form4_log_net_value', 'form4_purchases_value', 'form4_sales_value',
    # New theories
    'hurst_revenue', 'hurst_x_growth_direction',
    # S-curve
    'scurve_phase', 'revenue_d1', 'revenue_d2',
]

rows = []
for case_id in mc_cases:
    base = base_rows.get(case_id, {})
    new = new_signals.get(case_id, {})
    mc = mc_cases[case_id]

    row = {}
    for f in fieldnames:
        # Priority: new signals > base dataset > mc_case
        val = new.get(f, base.get(f, ''))
        if val is None: val = ''
        if isinstance(val, float) and (math.isnan(val) or math.isinf(val)): val = ''
        row[f] = val

    # Ensure core fields from mc_case
    row['case_id'] = case_id
    row['ticker'] = mc['ticker']
    row['entry_date'] = mc['entry_date']
    row['entry_cross_section'] = mc['cross_section']
    row['outcome_class'] = mc['classification']
    row['forward_return_3yr'] = mc['forward_return_3yr']
    row['sp500_return_3yr'] = mc.get('sp500_return_3yr', '')
    row['market_cap_at_entry'] = mc.get('market_cap', '')

    # Compute si_zipf_x_d1 interaction
    zipf = safe_float(row.get('si_zipf_velocity'))
    d1 = safe_float(row.get('si_d1'))
    row['si_zipf_x_d1'] = zipf * d1 if zipf is not None and d1 is not None else ''

    # Compute form4_log_net_value
    nv = safe_float(row.get('form4_net_value'))
    if nv is not None and nv != 0:
        row['form4_log_net_value'] = math.copysign(math.log10(abs(nv) + 1), nv)
    elif nv == 0:
        row['form4_log_net_value'] = 0

    rows.append(row)

# Write CSV
out_path = CAL / 'full-audit/master-dataset.csv'
with open(out_path, 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
    writer.writeheader()
    writer.writerows(rows)

# Coverage report
print(f"\n{'='*60}")
print(f"  MASTER DATASET: {len(rows)} cases, {len(fieldnames)} columns")
print(f"{'='*60}\n")

print(f"{'Column':<30} | {'Non-null':>8} | {'%':>5}")
print('-' * 50)
for col in fieldnames:
    non_null = sum(1 for r in rows if r.get(col, '') != '')
    pct = non_null / len(rows) * 100
    print(f"{col:<30} | {non_null:>8} | {pct:>4.0f}%")

print(f"\nOutcome distribution:")
outcomes = Counter(r['outcome_class'] for r in rows)
for k, v in sorted(outcomes.items()):
    print(f"  {k}: {v} ({v/len(rows)*100:.1f}%)")

cs = Counter(r['entry_cross_section'] for r in rows)
print(f"\nEntry dates:")
for k, v in sorted(cs.items()):
    print(f"  {k}: {v}")

print(f"\nSaved: {out_path}")

# Write flag
(CAL / 'full-audit/data-ready.flag').write_text(f'ready {len(rows)} rows')
