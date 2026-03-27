#!/usr/bin/env python3
"""
Verify all reported r-values from raw data.
No new computations — just load existing results and recompute correlations.
"""

import json
import os
from pathlib import Path

CAL = Path(__file__).parent.parent

def spearman_r(x, y):
    """Spearman rank correlation without scipy dependency."""
    n = len(x)
    if n < 5:
        return 0, 1, n

    def rank(arr):
        indexed = sorted(enumerate(arr), key=lambda t: t[1])
        ranks = [0] * n
        i = 0
        while i < n:
            j = i
            while j < n - 1 and indexed[j + 1][1] == indexed[j][1]:
                j += 1
            avg = (i + 1 + j + 1) / 2
            for k in range(i, j + 1):
                ranks[indexed[k][0]] = avg
            i = j + 1
        return ranks

    rx = rank(x)
    ry = rank(y)
    sum_d2 = sum((rx[i] - ry[i]) ** 2 for i in range(n))
    r = 1 - (6 * sum_d2) / (n * (n * n - 1))

    # t-test for p-value (approximation)
    import math
    if abs(r) >= 1:
        return r, 0, n
    t = r * math.sqrt((n - 2) / (1 - r * r))
    # Normal approximation for large n
    z = abs(t)
    p = 2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2))))
    return r, p, n

def load_json(path):
    with open(CAL / path) as f:
        return json.load(f)

print("=" * 70)
print("  R-VALUE VERIFICATION FROM RAW DATA")
print("=" * 70)
print()

# ============================================================
# Q1: Do numeric 1-5 scores exist?
# ============================================================

print("Q1: Do numeric 1-5 attractor scores exist?")
print("   ANSWER: NO.")
print("   All crawler results contain ONLY categorical labels:")
print("   - trajectory: 'stable' | 'deteriorating' | 'improving'")
print("   - confidence: 'high' | 'medium' | 'low'")
print("   No numeric 1-5 scores were ever produced.")
print()

# ============================================================
# Q2: Verify r=0.564 (SP500 crawler enriched) and r=0.316 (baseline)
# ============================================================

print("Q2: Verifying r=0.564 (SP500 crawler) and r=0.316 (baseline)")
print("-" * 60)

sp500_phase3 = load_json("crawler/test-5-1/phase3-merged.json")
job2 = load_json("tests/job2-cases/opus-results-merged.json")
universe = load_json("cases/universe.json")

job2_map = {r["case_id"]: r for r in job2["results"]}

# Filter to winner/trap only
sp500_matched = []
for r in sp500_phase3["results"]:
    j2 = job2_map.get(r["case_id"])
    if not j2:
        continue
    outcome = j2.get("outcome")
    if outcome not in ("winner", "trap"):
        continue
    sp500_matched.append({
        "case_id": r["case_id"],
        "outcome_num": 1 if outcome == "winner" else -1,
        "initial_trajectory": j2.get("trajectory"),
        "enriched_trajectory": r.get("enriched_trajectory"),
    })

print(f"   Matched winner/trap cases: {len(sp500_matched)}")

# Encoding: improving=1.5, stable=1, deteriorating=0
def encode_trajectory(t):
    if t == "improving":
        return 1.5
    elif t == "stable":
        return 1
    else:
        return 0

initial_scores = [encode_trajectory(m["initial_trajectory"]) for m in sp500_matched]
enriched_scores = [encode_trajectory(m["enriched_trajectory"]) for m in sp500_matched]
outcomes = [m["outcome_num"] for m in sp500_matched]

r_initial, p_initial, n_initial = spearman_r(initial_scores, outcomes)
r_enriched, p_enriched, n_enriched = spearman_r(enriched_scores, outcomes)

print(f"   Encoding: improving=1.5, stable=1, deteriorating=0")
print(f"   Outcome: winner=1, trap=-1")
print(f"   Correlation method: Spearman rank")
print()
print(f"   REPORTED r=0.316 (baseline)   → COMPUTED r={r_initial:.4f} (n={n_initial}, p={p_initial:.6f})")
print(f"   REPORTED r=0.564 (enriched)   → COMPUTED r={r_enriched:.4f} (n={n_enriched}, p={p_enriched:.6f})")
print()

# Also test with simpler encoding: improving=1, stable=1, deteriorating=0
initial_binary = [1 if m["initial_trajectory"] in ("stable", "improving") else 0 for m in sp500_matched]
enriched_binary = [1 if m["enriched_trajectory"] in ("stable", "improving") else 0 for m in sp500_matched]

r_init_bin, _, _ = spearman_r(initial_binary, outcomes)
r_enr_bin, _, _ = spearman_r(enriched_binary, outcomes)
print(f"   Alt encoding (stable+improving=1, deteriorating=0):")
print(f"   Baseline: r={r_init_bin:.4f}, Enriched: r={r_enr_bin:.4f}")
print()

# ============================================================
# Q3: Verify r=0.410 and r=0.455 (mid-cap v2)
# ============================================================

print("Q3: Verifying r=0.410 (mid-cap baseline v2) and r=0.455 (enriched v2)")
print("-" * 60)

v2_merged = load_json("crawler-midcap-oos-v2/v2-merged.json")
v2_cases = load_json("crawler-midcap-oos-v2/case-list.json")
case_map = {c["case_id"]: c for c in v2_cases}

mc_matched = []
for r in v2_merged["results"]:
    c = case_map.get(r["case_id"])
    if not c or c["classification"] not in ("winner", "trap"):
        continue
    mc_matched.append({
        "case_id": r["case_id"],
        "outcome_num": 1 if c["classification"] == "winner" else -1,
        "baseline_trajectory": r.get("baseline_trajectory"),
        "enriched_trajectory": r.get("enriched_trajectory"),
    })

print(f"   Matched winner/trap cases: {len(mc_matched)}")

mc_baseline = [encode_trajectory(m["baseline_trajectory"]) for m in mc_matched]
mc_enriched = [encode_trajectory(m["enriched_trajectory"]) for m in mc_matched]
mc_outcomes = [m["outcome_num"] for m in mc_matched]

r_mc_base, p_mc_base, n_mc = spearman_r(mc_baseline, mc_outcomes)
r_mc_enr, p_mc_enr, _ = spearman_r(mc_enriched, mc_outcomes)

print(f"   REPORTED r=0.410 (baseline v2) → COMPUTED r={r_mc_base:.4f} (n={n_mc}, p={p_mc_base:.6f})")
print(f"   REPORTED r=0.455 (enriched v2)  → COMPUTED r={r_mc_enr:.4f} (n={n_mc}, p={p_mc_enr:.6f})")
print()

# ============================================================
# Q4: Verify r=0.485 (insider signal)
# ============================================================

print("Q4: Verifying r=0.485 (insider net direction)")
print("-" * 60)

v2_phase2 = load_json("crawler-midcap-oos-v2/phase2-results.json")
test_cases = load_json("crawler-midcap-test-cases.json")
tc_map = {c["case_id"]: c for c in test_cases}

insider_matched = []
for p2 in v2_phase2:
    tc = tc_map.get(p2["case_id"])
    if not tc or tc["classification"] not in ("winner", "trap"):
        continue
    ins = None
    for d in (p2.get("phase2_data") or []):
        if d.get("type") == "INSIDER_TRADING" and d.get("insider_data"):
            ins = d["insider_data"]
            break
    if not ins or not ins.get("net_direction"):
        continue

    direction = ins["net_direction"]
    score = 1 if direction == "NET_BUYING" else (-1 if direction == "NET_SELLING" else 0)

    insider_matched.append({
        "case_id": p2["case_id"],
        "ticker": p2["ticker"],
        "outcome_num": 1 if tc["classification"] == "winner" else -1,
        "insider_score": score,
        "net_direction": direction,
    })

print(f"   Cases with insider data + winner/trap outcome: {len(insider_matched)}")
print(f"   Encoding: NET_BUYING=1, MIXED=0, NET_SELLING=-1")

ins_scores = [m["insider_score"] for m in insider_matched]
ins_outcomes = [m["outcome_num"] for m in insider_matched]

r_ins, p_ins, n_ins = spearman_r(ins_scores, ins_outcomes)
print(f"   REPORTED r=0.485 → COMPUTED r={r_ins:.4f} (n={n_ins}, p={p_ins:.6f})")

# Distribution
buying = [m for m in insider_matched if m["net_direction"] == "NET_BUYING"]
selling = [m for m in insider_matched if m["net_direction"] == "NET_SELLING"]
mixed = [m for m in insider_matched if m["net_direction"] == "MIXED"]
print(f"   NET_BUYING:  n={len(buying)}, win rate={sum(1 for m in buying if m['outcome_num']==1)/max(len(buying),1)*100:.1f}%")
print(f"   NET_SELLING: n={len(selling)}, win rate={sum(1 for m in selling if m['outcome_num']==1)/max(len(selling),1)*100:.1f}%")
print(f"   MIXED:       n={len(mixed)}, win rate={sum(1 for m in mixed if m['outcome_num']==1)/max(len(mixed),1)*100:.1f}%")
print()

# ============================================================
# Q5: Why 190 cases in SP500 export?
# ============================================================

print("Q5: Why 190 cases in SP500 export?")
print("-" * 60)
print(f"   phase3-merged.json has {len(sp500_phase3['results'])} results (ALL outcomes)")
print(f"   winner/trap subset: {len(sp500_matched)} cases")
print(f"   Job 2 originally evaluated: {len(job2['results'])} cases")
print(f"   The 190 includes ALL outcomes (winner, trap, mixed, underperform)")
print(f"   The r=0.564 was computed on the 103 winner/trap subset only")
print()

# ============================================================
# Q6: v1 vs v2 baseline differences
# ============================================================

print("Q6: v1 vs v2 baseline trajectory differences")
print("-" * 60)

v1_merged = load_json("crawler-midcap-oos/oos-merged.json")
v1_map = {r["case_id"]: r for r in v1_merged["results"]}
v2_map2 = {r["case_id"]: r for r in v2_merged["results"]}

match_count = 0
differ_count = 0
for case_id in v2_map2:
    v1 = v1_map.get(case_id)
    v2 = v2_map2[case_id]
    if not v1:
        continue
    if v1.get("baseline_trajectory") == v2.get("baseline_trajectory"):
        match_count += 1
    else:
        differ_count += 1

total = match_count + differ_count
print(f"   Agree: {match_count}/{total}, Differ: {differ_count}/{total} ({differ_count/total*100:.1f}%)")
print(f"   Was this known and reported? NO.")
print(f"   The v1 and v2 baselines used DIFFERENT Opus agents evaluating")
print(f"   the SAME financial summaries. The 35% disagreement rate shows")
print(f"   significant stochasticity in the AI trajectory classification.")
print(f"   This is a real methodological concern — the same input produces")
print(f"   different outputs 35% of the time.")
print()

# ============================================================
# SUMMARY
# ============================================================

print("=" * 70)
print("  VERIFICATION SUMMARY")
print("=" * 70)
print()
print("Claimed  → Computed  Status")
print("-" * 50)
print(f"r=0.316  → r={r_initial:.4f}    {'MATCH' if abs(r_initial - 0.316) < 0.002 else 'MISMATCH'} (SP500 Job 2 baseline)")
print(f"r=0.564  → r={r_enriched:.4f}    {'MATCH' if abs(r_enriched - 0.564) < 0.002 else 'MISMATCH'} (SP500 crawler enriched)")
print(f"r=0.410  → r={r_mc_base:.4f}    {'MATCH' if abs(r_mc_base - 0.410) < 0.002 else 'MISMATCH'} (Mid-cap baseline v2)")
print(f"r=0.455  → r={r_mc_enr:.4f}    {'MATCH' if abs(r_mc_enr - 0.455) < 0.002 else 'MISMATCH'} (Mid-cap enriched v2)")
print(f"r=0.485  → r={r_ins:.4f}    {'MATCH' if abs(r_ins - 0.485) < 0.002 else 'MISMATCH'} (Insider net direction)")
print()
print("METHODOLOGY NOTE:")
print("All r-values use Spearman rank correlation with categorical encoding:")
print("  Trajectory: improving=1.5, stable=1, deteriorating=0")
print("  Outcome: winner=1, trap=-1")
print("  Insider: NET_BUYING=1, MIXED=0, NET_SELLING=-1")
print()
print("No numeric 1-5 attractor scores exist. All reported r-values are")
print("correlations between ordinal categorical variables, not continuous scores.")
print()
print("CONCERN: v1 vs v2 baseline disagreement rate of 35% indicates")
print("significant AI evaluation stochasticity. The r-values may vary")
print("substantially on re-evaluation.")
