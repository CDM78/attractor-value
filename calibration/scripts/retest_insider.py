#!/usr/bin/env python3
"""Phase 5: Insider standalone signal on 24 retest cases (using Phase 2 Form 4 data if available)."""

import json
import csv
import math
from pathlib import Path

CAL = Path(__file__).parent.parent

def pearsonr(x, y):
    n = len(x)
    if n < 5: return 0, 1, n
    mx = sum(x) / n
    my = sum(y) / n
    sx = math.sqrt(sum((xi - mx)**2 for xi in x) / (n - 1))
    sy = math.sqrt(sum((yi - my)**2 for yi in y) / (n - 1))
    if sx == 0 or sy == 0: return 0, 1, n
    cov = sum((x[i] - mx) * (y[i] - my) for i in range(n)) / (n - 1)
    r = cov / (sx * sy)
    t = r * math.sqrt((n - 2) / max(1 - r*r, 1e-12))
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(t) / math.sqrt(2))))
    return r, p, n

# Load the 24 retest cases
with open(CAL / "retest/baseline-scores.csv") as f:
    cases = list(csv.DictReader(f))

print("=" * 60)
print("  INSIDER STANDALONE SIGNAL (Phase 5)")
print("=" * 60)
print()

# Check if we have Form 4 data from the v2 crawler retest
v2_phase2_path = CAL / "crawler-midcap-oos-v2/phase2-results.json"
v2_phase2 = json.loads(v2_phase2_path.read_text()) if v2_phase2_path.exists() else []

# Build insider data map by ticker (not case_id — Form 4 is per-company)
insider_by_ticker = {}
for p2 in v2_phase2:
    for d in (p2.get("phase2_data") or []):
        if d.get("type") == "INSIDER_TRADING" and d.get("insider_data"):
            insider_by_ticker[p2["ticker"]] = d["insider_data"]

print(f"  Form 4 data available for {len(insider_by_ticker)} tickers")

# Match to our 24 cases
matched = []
for c in cases:
    # Extract ticker from case_id (MC-TICKER-DATE)
    parts = c["case_id"].split("-")
    ticker = parts[1]
    ins = insider_by_ticker.get(ticker)

    if not ins:
        continue

    # Exclude if total value > 20% of market cap (PE sponsor selldowns)
    # We don't have market cap in the baseline CSV, skip this filter for now

    fwd = float(c["forward_return_3yr"])
    net_value = ins.get("net_value", 0)
    purchases = ins.get("purchases", {}).get("value", 0)
    sales = ins.get("sales", {}).get("value", 0)
    bsr = ins.get("buy_sell_ratio", 0)
    direction = ins.get("net_direction", "")

    matched.append({
        "case_id": c["case_id"],
        "ticker": ticker,
        "outcome": c["outcome_class"],
        "forward_return_3yr": fwd,
        "net_value": net_value,
        "purchases_value": purchases,
        "sales_value": sales,
        "buy_sell_ratio": bsr,
        "net_direction": direction,
    })

print(f"  Matched to retest cases: {len(matched)}")
print()

if len(matched) < 5:
    print("  Insufficient insider data for retest cases.")
    print("  The 24 retest cases may not overlap with the 80 crawler test cases.")
    print("  Need to run Form 4 parser on the retest tickers specifically.")
    print()

    # Check which retest tickers have v2 data
    retest_tickers = set()
    for c in cases:
        parts = c["case_id"].split("-")
        retest_tickers.add(parts[1])

    v2_tickers = set(insider_by_ticker.keys())
    overlap = retest_tickers & v2_tickers
    print(f"  Retest tickers: {len(retest_tickers)}")
    print(f"  V2 insider tickers: {len(v2_tickers)}")
    print(f"  Overlap: {len(overlap)}")
    if overlap:
        print(f"  Overlapping: {sorted(overlap)}")
else:
    # Compute correlations
    # 1. r(net_value, forward_return_3yr)
    net_vals = [m["net_value"] for m in matched]
    fwd_rets = [m["forward_return_3yr"] for m in matched]
    r1, p1, n1 = pearsonr(net_vals, fwd_rets)
    print(f"  r(net_value, forward_return_3yr) = {r1:.4f}, p={p1:.4f}, n={n1}")

    # 2. r(buy_sell_ratio, forward_return_3yr)
    bsr_cases = [m for m in matched if m["purchases_value"] > 0 and m["sales_value"] > 0]
    if len(bsr_cases) >= 5:
        r2, p2, n2 = pearsonr([m["buy_sell_ratio"] for m in bsr_cases], [m["forward_return_3yr"] for m in bsr_cases])
        print(f"  r(buy_sell_ratio, forward_return_3yr) = {r2:.4f}, p={p2:.4f}, n={n2}")
    else:
        print(f"  buy_sell_ratio: insufficient cases with both buys AND sells (n={len(bsr_cases)})")

    # 3. Win rate by direction
    print()
    for dir in ["NET_BUYING", "MIXED", "NET_SELLING"]:
        group = [m for m in matched if m["net_direction"] == dir]
        if not group: continue
        wins = sum(1 for m in group if m["outcome"] == "winner")
        mean_ret = sum(m["forward_return_3yr"] for m in group) / len(group)
        print(f"  {dir}: n={len(group)}, win_rate={wins/len(group)*100:.0f}%, mean_return={mean_ret:+.1%}")

print()
print("  NOTE: The insider data was fetched during the v2 crawler test on a")
print("  DIFFERENT set of 80 mid-cap cases. Overlap with the 24 retest cases")
print("  depends on which tickers appear in both selections.")
