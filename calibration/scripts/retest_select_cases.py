#!/usr/bin/env python3
"""Phase 1: Select 120 mid-cap cases for clean retest."""

import json
import random
import csv
from pathlib import Path

CAL = Path(__file__).parent.parent

# Load mid-cap cases
mc = json.loads((CAL / "midcap-cases.json").read_text())
cases = mc["cases"]
print(f"Total mid-cap cases: {len(cases)}")

# Load universe for sector data
universe = json.loads((CAL / "midcap-universe-sectors-fixed.json").read_text())
sector_map = {c["ticker"]: c["sector"] for c in universe["companies"]}

# Load EDGAR raw dir to check filing availability
edgar_dir = CAL / "midcap-edgar-raw"

# Filter criteria
qualifying = []
for c in cases:
    # Entry dates: 2020-Q3 and 2022-Q1 ONLY
    if c["cross_section"] not in ("2020-Q3", "2022-Q1"):
        continue

    # Market cap $2B-$8B
    if c.get("market_cap") is None:
        continue
    if c["market_cap"] < 2e9 or c["market_cap"] > 8e9:
        continue

    # Must have forward_return_3yr
    if c.get("forward_return_3yr") is None:
        continue

    # Must have EDGAR data (proxy for 10-K availability)
    edgar_file = edgar_dir / f"{c['ticker']}.json"
    if not edgar_file.exists():
        continue

    # Check EDGAR has enough revenue data (proxy for filing history)
    try:
        edgar = json.loads(edgar_file.read_text())
        concepts = edgar.get("concepts", edgar.get("facts", {}))
        rev_key = None
        for k in concepts:
            if "revenue" in k.lower() or "sales" in k.lower():
                rev_key = k
                break
        if rev_key:
            entries = concepts[rev_key]
            pre_entry = [e for e in entries if e.get("end", "") <= c["entry_date"]]
            if len(pre_entry) < 8:
                continue
        else:
            continue
    except:
        continue

    qualifying.append({
        "case_id": c["case_id"],
        "ticker": c["ticker"],
        "cik": c.get("cik", ""),
        "entry_date": c["entry_date"],
        "sector": sector_map.get(c["ticker"], "Unknown"),
        "market_cap_at_entry": c["market_cap"],
        "outcome_class": c["classification"],
        "forward_return_3yr": c["forward_return_3yr"],
        "sp500_return_3yr": c.get("sp500_return_3yr", ""),
        "cross_section": c["cross_section"],
    })

print(f"Qualifying cases: {len(qualifying)}")

# Random selection with fixed seed
random.seed(42)
random.shuffle(qualifying)
selected = qualifying[:120]

print(f"Selected: {len(selected)}")

# Report outcome distribution
outcomes = {}
for c in selected:
    outcomes[c["outcome_class"]] = outcomes.get(c["outcome_class"], 0) + 1
print(f"\nOutcome distribution:")
for k, v in sorted(outcomes.items()):
    print(f"  {k}: {v}")

cs_dist = {}
for c in selected:
    cs_dist[c["cross_section"]] = cs_dist.get(c["cross_section"], 0) + 1
print(f"\nCross-section distribution:")
for k, v in sorted(cs_dist.items()):
    print(f"  {k}: {v}")

# Sector distribution
sectors = {}
for c in selected:
    sectors[c["sector"]] = sectors.get(c["sector"], 0) + 1
print(f"\nSector distribution:")
for k, v in sorted(sectors.items(), key=lambda x: -x[1]):
    print(f"  {k}: {v}")

# Save CSV
csv_path = CAL / "retest" / "selected-cases.csv"
with open(csv_path, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "case_id", "ticker", "cik", "entry_date", "sector",
        "market_cap_at_entry", "outcome_class", "forward_return_3yr", "sp500_return_3yr"
    ])
    writer.writeheader()
    for c in selected:
        writer.writerow({k: c.get(k, "") for k in writer.fieldnames})

print(f"\nSaved: {csv_path} ({len(selected)} rows)")
