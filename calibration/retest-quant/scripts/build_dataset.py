#!/usr/bin/env python3
"""Phase 1: Build analysis dataset for quantitative retest."""

import json
import csv
from pathlib import Path
from collections import Counter

CAL = Path(__file__).parent.parent.parent

# Load mid-cap cases
mc = json.loads((CAL / "midcap-cases.json").read_text())
cases = mc["cases"]

# Load signals
signals = json.loads((CAL / "midcap-signals-merged.json").read_text())
sig_map = {r["case_id"]: r for r in signals["results"]}

# Load universe for sectors
universe = json.loads((CAL / "midcap-universe-sectors-fixed.json").read_text())
sector_map = {c["ticker"]: c["sector"] for c in universe["companies"]}
cik_map = {c["ticker"]: c.get("cik", "") for c in universe["companies"]}

# Load insider data
v2_phase2_path = CAL / "crawler-midcap-oos-v2/phase2-results.json"
insider_map = {}
if v2_phase2_path.exists():
    v2_phase2 = json.loads(v2_phase2_path.read_text())
    for p2 in v2_phase2:
        for d in (p2.get("phase2_data") or []):
            if d.get("type") == "INSIDER_TRADING" and d.get("insider_data"):
                insider_map[p2["ticker"]] = d["insider_data"]

# Filter to 2020-Q3 and 2022-Q1 only, with forward_return_3yr
rows = []
for c in cases:
    if c["cross_section"] not in ("2020-Q3", "2022-Q1"):
        continue
    if c.get("forward_return_3yr") is None:
        continue

    sig = sig_map.get(c["case_id"], {})
    sigs = sig.get("signals", {}) if sig else {}
    ins = insider_map.get(c["ticker"], {})

    row = {
        "case_id": c["case_id"],
        "ticker": c["ticker"],
        "cik": cik_map.get(c["ticker"], ""),
        "sector": sector_map.get(c["ticker"], "Unknown"),
        "market_cap_at_entry": c.get("market_cap", ""),
        "entry_date": c["entry_date"],
        "entry_cross_section": c["cross_section"],
        "outcome_class": c["classification"],
        "forward_return_3yr": c["forward_return_3yr"],
        "sp500_return_3yr": c.get("sp500_return_3yr", ""),
        "alpha_3yr": c.get("alpha_3yr", ""),
        # Spread signals
        "spread_variance_slope": sigs.get("spread_variance_slope", ""),
        "spread_theta": sigs.get("spread_theta", ""),
        # SI signals
        "si_zipf_velocity": sigs.get("si_zipf_velocity", ""),
        "si_zipf_velocity_fixed": sigs.get("si_zipf_velocity_fixed", ""),
        "si_csd": sigs.get("si_csd", ""),
        "si_d1": sigs.get("si_d1", ""),
        "si_d2": sigs.get("si_d2", ""),
        "si_theta": sigs.get("si_theta", ""),
        "si_beta": sigs.get("si_beta", ""),
        "si_change": sigs.get("si_change", ""),
        "composite": sigs.get("composite", ""),
        # Fisher/Benford/EPS
        "fisher_information": sigs.get("fisher", ""),
        "benford_structural_stress": "STRUCTURAL_STRESS" if sigs.get("structural_stress") == 1 else ("NATURAL_PROCESS" if sigs.get("structural_stress") == 0 else ""),
        "eps_round_number_excess": sigs.get("round_number_excess", ""),
        "base10_excess": sigs.get("base10_excess", ""),
        # Insider
        "form4_net_direction": ins.get("net_direction", ""),
        "form4_net_value": ins.get("net_value", ""),
        "form4_buy_sell_ratio": ins.get("buy_sell_ratio", ""),
        "form4_purchases_count": ins.get("purchases", {}).get("count", ""),
        "form4_purchases_value": ins.get("purchases", {}).get("value", ""),
        "form4_sales_count": ins.get("sales", {}).get("count", ""),
        "form4_sales_value": ins.get("sales", {}).get("value", ""),
    }

    # Convert None to empty string
    for k in row:
        if row[k] is None:
            row[k] = ""

    rows.append(row)

# Write CSV
out_path = CAL / "retest-quant/analysis-dataset.csv"
fieldnames = list(rows[0].keys())
with open(out_path, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

# Report
print(f"Total cases: {len(rows)}")

def count_non_empty(col):
    return sum(1 for r in rows if r.get(col, "") != "")

print(f"Cases with spread signals: {count_non_empty('spread_variance_slope')} / {len(rows)}")
print(f"Cases with SI Zipf: {count_non_empty('si_zipf_velocity')} / {len(rows)}")
print(f"Cases with SI Zipf (fixed): {count_non_empty('si_zipf_velocity_fixed')} / {len(rows)}")
print(f"Cases with Fisher: {count_non_empty('fisher_information')} / {len(rows)}")
print(f"Cases with EPS data: {count_non_empty('eps_round_number_excess')} / {len(rows)}")
print(f"Cases with insider data: {count_non_empty('form4_net_value')} / {len(rows)}")
print(f"Cases with Benford class: {count_non_empty('benford_structural_stress')} / {len(rows)}")

outcomes = Counter(r["outcome_class"] for r in rows)
print(f"\nOutcome distribution:")
for k, v in sorted(outcomes.items()):
    print(f"  {k}: {v} ({v/len(rows)*100:.1f}%)")

cs = Counter(r["entry_cross_section"] for r in rows)
print(f"\nEntry date distribution:")
for k, v in sorted(cs.items()):
    print(f"  {k}: {v}")

print(f"\nSaved: {out_path} ({len(rows)} rows, {len(fieldnames)} columns)")
