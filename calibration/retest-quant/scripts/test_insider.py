#!/usr/bin/env python3
"""Sub-Agent D: Test insider signal."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, pearsonr
from collections import Counter

rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'analysis-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")

# Filter to cases with insider data
insider_rows = [r for r in rows if r.get('form4_net_value', '') != '']
print(f"Cases with insider data: {len(insider_rows)}")

# Exclude PE sponsor selldowns (>20% of mcap)
excluded = []
valid = []
for r in insider_rows:
    try:
        net_val = abs(float(r['form4_net_value']))
        mcap = float(r['market_cap_at_entry']) if r.get('market_cap_at_entry', '') else 1e18
        if mcap > 0 and net_val / mcap > 0.20:
            excluded.append(r['ticker'])
        else:
            valid.append(r)
    except:
        continue

print(f"Excluded (>20% mcap): {len(excluded)} — {excluded[:10]}")
print(f"Valid for testing: {len(valid)}")

tickers = [r['ticker'] for r in valid]
unique = len(set(tickers))
print(f"Unique companies: {unique} across {len(valid)} case-entries")
if unique < len(valid):
    print(f"WARNING: {len(valid) - unique} duplicate entries — not fully independent")
print()

if len(valid) < 20:
    print("UNDERPOWERED: n < 20, results unreliable")
    print()

# Test 1: r(net_value, forward_return_3yr)
net_vals = [float(r['form4_net_value']) for r in valid]
fwd_rets = [float(r['forward_return_3yr']) for r in valid]
r1, p1, n1 = pearsonr(net_vals, fwd_rets)
print(f"r(net_value, forward_return_3yr) = {r1:.3f}, p={p1:.4f}, n={n1}")

# Test 2: r(buy_sell_ratio, forward_return_3yr)
bsr_cases = [r for r in valid if r.get('form4_purchases_value', '') not in ('', '0') and r.get('form4_sales_value', '') not in ('', '0')]
if len(bsr_cases) >= 5:
    bsr_vals = [float(r['form4_buy_sell_ratio']) for r in bsr_cases]
    bsr_rets = [float(r['forward_return_3yr']) for r in bsr_cases]
    r2, p2, n2 = pearsonr(bsr_vals, bsr_rets)
    print(f"r(buy_sell_ratio, forward_return_3yr) = {r2:.3f}, p={p2:.4f}, n={n2}")
else:
    print(f"buy_sell_ratio: insufficient cases with both buys AND sells (n={len(bsr_cases)})")

# Test 3: log net value
import math
log_vals = []
log_rets = []
for r in valid:
    nv = float(r['form4_net_value'])
    if nv != 0:
        log_vals.append(math.copysign(math.log10(abs(nv) + 1), nv))
        log_rets.append(float(r['forward_return_3yr']))
if len(log_vals) >= 10:
    r3, p3, n3 = pearsonr(log_vals, log_rets)
    print(f"r(log_net_value, forward_return_3yr) = {r3:.3f}, p={p3:.4f}, n={n3}")

# Test 4: Win rate by direction
print()
for direction in ["NET_BUYING", "MIXED", "NET_SELLING"]:
    group = [r for r in valid if r.get('form4_net_direction') == direction]
    if not group: continue
    rets = [float(r['forward_return_3yr']) for r in group]
    wins = sum(1 for r in rets if r > 0.20)
    mean_ret = sum(rets) / len(rets)
    print(f"{direction}: n={len(group)}, win_rate(>20%)={wins/len(group)*100:.0f}%, mean_return={mean_ret:+.3f}")

# Test 5: Directional encoding
print()
dir_scores = []
dir_rets = []
for r in valid:
    d = r.get('form4_net_direction', '')
    if d == 'NET_BUYING': dir_scores.append(1)
    elif d == 'NET_SELLING': dir_scores.append(-1)
    elif d == 'MIXED': dir_scores.append(0)
    else: continue
    dir_rets.append(float(r['forward_return_3yr']))

if len(dir_scores) >= 10:
    r4, p4, n4 = pearsonr(dir_scores, dir_rets)
    print(f"r(direction_encoding, forward_return_3yr) = {r4:.3f}, p={p4:.4f}, n={n4}")
    print(f"  (NET_BUYING=1, MIXED=0, NET_SELLING=-1)")
