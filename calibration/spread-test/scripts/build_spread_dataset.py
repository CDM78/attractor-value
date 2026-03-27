#!/usr/bin/env python3
"""Phase 1: Build monthly credit spread timing dataset from FRED + Yahoo."""

import csv
import math
import json
import subprocess
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

CAL = Path('/home/cm/attractor-value/calibration/spread-test')

def fetch_csv(url):
    """Fetch CSV from URL via curl."""
    result = subprocess.run(
        ['curl', '-s', '-H', 'User-Agent: Bolin & Troy LLC charles@bolinandtroy.com', url],
        capture_output=True, text=True, timeout=30
    )
    return result.stdout

def parse_fred_csv(text):
    """Parse FRED CSV format: DATE,VALUE with header."""
    data = {}
    for line in text.strip().split('\n')[1:]:
        parts = line.strip().split(',')
        if len(parts) < 2 or parts[1] == '.':
            continue
        try:
            data[parts[0]] = float(parts[1])
        except ValueError:
            continue
    return data

def parse_yahoo_csv(text):
    """Parse Yahoo Finance CSV: Date,Open,High,Low,Close,Adj Close,Volume."""
    data = {}
    lines = text.strip().split('\n')
    if len(lines) < 2:
        return data
    for line in lines[1:]:
        parts = line.strip().split(',')
        if len(parts) < 6 or parts[5] in ('null', ''):
            continue
        try:
            data[parts[0]] = float(parts[5])  # Adj Close
        except ValueError:
            continue
    return data

print("Phase 1: Building credit spread timing dataset\n")

# Step 1: Fetch FRED data
print("Fetching BAA yield from FRED...")
baa_text = fetch_csv('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DBAA&cosd=1996-01-01&coed=2026-01-01')
baa = parse_fred_csv(baa_text)
print(f"  BAA: {len(baa)} daily observations")

print("Fetching AAA yield from FRED...")
aaa_text = fetch_csv('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DAAA&cosd=1996-01-01&coed=2026-01-01')
aaa = parse_fred_csv(aaa_text)
print(f"  AAA: {len(aaa)} daily observations")

# Compute daily spread
spread_daily = {}
for date in sorted(set(baa.keys()) & set(aaa.keys())):
    spread_daily[date] = baa[date] - aaa[date]
print(f"  Daily spread: {len(spread_daily)} observations")

# Sanity checks
spread_2008_10 = [v for d, v in spread_daily.items() if d.startswith('2008-10')]
spread_2020_03 = [v for d, v in spread_daily.items() if d.startswith('2020-03')]
spread_2006_01 = [v for d, v in spread_daily.items() if d.startswith('2006-01')]
print(f"  2008-10 spread: {max(spread_2008_10) if spread_2008_10 else 'MISSING'}% (should be > 3.0)")
print(f"  2020-03 spread: {max(spread_2020_03) if spread_2020_03 else 'MISSING'}% (should be > 2.5)")
print(f"  2006-01 spread: {min(spread_2006_01) if spread_2006_01 else 'MISSING'}% (should be < 1.0)")

# Step 2: Fetch S&P 500 total return data
print("\nFetching S&P 500 from Yahoo (^GSPC)...")
sp500_text = fetch_csv(
    'https://query1.finance.yahoo.com/v7/finance/download/%5EGSPC?period1=946684800&period2=1735689600&interval=1mo&events=history'
)
sp500_monthly = parse_yahoo_csv(sp500_text)
if len(sp500_monthly) < 100:
    # Try alternative
    print("  Yahoo download API failed, trying chart API via curl...")
    result = subprocess.run(
        ['curl', '-s', '-H', 'User-Agent: Mozilla/5.0',
         'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=946684800&period2=1735689600&interval=1mo'],
        capture_output=True, text=True, timeout=30
    )
    try:
        chart = json.loads(result.stdout)
        r = chart['chart']['result'][0]
        timestamps = r['timestamp']
        closes = r['indicators']['adjclose'][0]['adjclose'] if 'adjclose' in r['indicators'] else r['indicators']['quote'][0]['close']
        sp500_monthly = {}
        for t, c in zip(timestamps, closes):
            if c is not None:
                d = datetime.utcfromtimestamp(t).strftime('%Y-%m-%d')
                sp500_monthly[d] = c
    except:
        pass

print(f"  S&P 500 monthly: {len(sp500_monthly)} observations")

# Also try VBR (small-cap value)
print("Fetching VBR from Yahoo...")
result = subprocess.run(
    ['curl', '-s', '-H', 'User-Agent: Mozilla/5.0',
     'https://query1.finance.yahoo.com/v8/finance/chart/VBR?period1=1072915200&period2=1735689600&interval=1mo'],
    capture_output=True, text=True, timeout=30
)
vbr_monthly = {}
try:
    chart = json.loads(result.stdout)
    r = chart['chart']['result'][0]
    timestamps = r['timestamp']
    closes = r['indicators']['adjclose'][0]['adjclose'] if 'adjclose' in r['indicators'] else r['indicators']['quote'][0]['close']
    for t, c in zip(timestamps, closes):
        if c is not None:
            d = datetime.utcfromtimestamp(t).strftime('%Y-%m-%d')
            vbr_monthly[d] = c
except:
    pass
print(f"  VBR monthly: {len(vbr_monthly)} observations")

# Step 3: Build month-end series
# Get last trading day of each month for spread data
months = defaultdict(list)
for date in sorted(spread_daily.keys()):
    ym = date[:7]
    months[ym].append(date)

month_end_spread = {}
for ym, dates in sorted(months.items()):
    month_end_spread[ym] = (dates[-1], spread_daily[dates[-1]])

# Match S&P 500 to months
sp500_by_month = {}
for date, price in sp500_monthly.items():
    ym = date[:7]
    sp500_by_month[ym] = price

vbr_by_month = {}
for date, price in vbr_monthly.items():
    ym = date[:7]
    vbr_by_month[ym] = price

# Step 4: Compute signal variables for each month
sorted_months = sorted(month_end_spread.keys())

# Build monthly spread series for rolling computations
monthly_spread_values = [(ym, month_end_spread[ym][1]) for ym in sorted_months]

def get_trailing(values_list, idx, n_months):
    start = max(0, idx - n_months)
    return [v[1] for v in values_list[start:idx+1]]

def add_months(ym, n):
    y, m = int(ym[:4]), int(ym[5:7])
    m += n
    while m > 12: y += 1; m -= 12
    while m < 1: y -= 1; m += 12
    return f"{y:04d}-{m:02d}"

rows = []
for idx, (ym, (date, spread_val)) in enumerate(sorted(month_end_spread.items())):
    if ym < '2000-01' or ym > '2022-12':
        continue

    # Signal 1: spread_level
    spread_level = spread_val

    # Signal 2: spread_zscore (12-month rolling)
    trailing_12 = get_trailing(monthly_spread_values, idx, 12)
    if len(trailing_12) >= 6:
        mean_12 = sum(trailing_12) / len(trailing_12)
        std_12 = math.sqrt(sum((x - mean_12)**2 for x in trailing_12) / len(trailing_12))
        spread_zscore = (spread_level - mean_12) / std_12 if std_12 > 0.001 else 0
    else:
        spread_zscore = None

    # Signal 3: spread_percentile (60-month)
    trailing_60 = get_trailing(monthly_spread_values, idx, 60)
    if len(trailing_60) >= 12:
        below = sum(1 for x in trailing_60 if x < spread_level)
        spread_percentile = below / len(trailing_60)
    else:
        spread_percentile = None

    # Signal 4: spread_slope (3-month change)
    if idx >= 3:
        spread_slope = spread_level - monthly_spread_values[idx - 3][1]
    else:
        spread_slope = None

    # Signal 5: spread_variance (6-month variance of daily changes)
    # Get daily spread changes in last ~126 trading days
    date_6mo_ago = add_months(ym, -6)
    daily_in_window = [(d, v) for d, v in sorted(spread_daily.items())
                       if d >= date_6mo_ago + '-01' and d <= date]
    if len(daily_in_window) >= 60:
        daily_changes = [daily_in_window[i][1] - daily_in_window[i-1][1]
                        for i in range(1, len(daily_in_window))]
        mean_chg = sum(daily_changes) / len(daily_changes)
        spread_variance = sum((c - mean_chg)**2 for c in daily_changes) / len(daily_changes)
    else:
        spread_variance = None

    # Forward returns
    fwd_1yr_ym = add_months(ym, 12)
    fwd_2yr_ym = add_months(ym, 24)
    fwd_3yr_ym = add_months(ym, 36)

    sp500_now = sp500_by_month.get(ym)
    sp500_1yr = sp500_by_month.get(fwd_1yr_ym)
    sp500_2yr = sp500_by_month.get(fwd_2yr_ym)
    sp500_3yr = sp500_by_month.get(fwd_3yr_ym)

    fwd_return_1yr = (sp500_1yr / sp500_now - 1) if sp500_now and sp500_1yr else None
    fwd_return_2yr = (sp500_2yr / sp500_now - 1) if sp500_now and sp500_2yr else None
    fwd_return_3yr = (sp500_3yr / sp500_now - 1) if sp500_now and sp500_3yr else None

    # VBR returns for strategy test
    vbr_now = vbr_by_month.get(ym)
    vbr_1yr = vbr_by_month.get(fwd_1yr_ym)
    vbr_return_1yr = (vbr_1yr / vbr_now - 1) if vbr_now and vbr_1yr else None

    # Period classification
    period = 'in_sample' if ym <= '2014-12' else 'out_of_sample'

    rows.append({
        'month_end': date,
        'year_month': ym,
        'spread_level': f"{spread_level:.4f}" if spread_level is not None else '',
        'spread_zscore': f"{spread_zscore:.4f}" if spread_zscore is not None else '',
        'spread_percentile': f"{spread_percentile:.4f}" if spread_percentile is not None else '',
        'spread_slope': f"{spread_slope:.4f}" if spread_slope is not None else '',
        'spread_variance': f"{spread_variance:.6f}" if spread_variance is not None else '',
        'forward_return_1yr': f"{fwd_return_1yr:.4f}" if fwd_return_1yr is not None else '',
        'forward_return_2yr': f"{fwd_return_2yr:.4f}" if fwd_return_2yr is not None else '',
        'forward_return_3yr': f"{fwd_return_3yr:.4f}" if fwd_return_3yr is not None else '',
        'sp500_price': f"{sp500_now:.2f}" if sp500_now else '',
        'vbr_return_1yr': f"{vbr_return_1yr:.4f}" if vbr_return_1yr is not None else '',
        'period': period,
    })

# Write CSV
out_path = CAL / 'spread-monthly-dataset.csv'
fieldnames = list(rows[0].keys())
with open(out_path, 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

# Report
in_sample = [r for r in rows if r['period'] == 'in_sample']
oos = [r for r in rows if r['period'] == 'out_of_sample']
spreads = [float(r['spread_level']) for r in rows if r['spread_level']]
fwd3 = [float(r['forward_return_3yr']) for r in rows if r['forward_return_3yr']]

print(f"\n{'='*60}")
print(f"  SPREAD MONTHLY DATASET")
print(f"{'='*60}")
print(f"  Total months: {len(rows)}")
print(f"  In-sample (2000-2014): {len(in_sample)}")
print(f"  Out-of-sample (2015-2022): {len(oos)}")
print(f"  With 3yr forward return: {len(fwd3)}")
print(f"  Mean spread level: {sum(spreads)/len(spreads):.3f}%")
print(f"  Min spread: {min(spreads):.3f}% ({[r['month_end'] for r in rows if float(r['spread_level']) == min(spreads)][0]})")
print(f"  Max spread: {max(spreads):.3f}% ({[r['month_end'] for r in rows if float(r['spread_level']) == max(spreads)][0]})")
if fwd3:
    print(f"  Mean forward 3yr return: {sum(fwd3)/len(fwd3):.1%}")
print(f"\n  Saved: {out_path}")
