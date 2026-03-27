#!/usr/bin/env python3
"""Phase 2: Compute stochasticity metrics from 3 runs × 20 cases."""

import json
import csv
import math
from pathlib import Path

CAL = Path(__file__).parent.parent

# Load all 3 runs
runs = {}
for i in range(1, 4):
    path = CAL / "retest" / f"stochasticity-run{i}.json"
    data = json.loads(path.read_text())
    for r in data["results"]:
        case_id = r["case_id"]
        if case_id not in runs:
            runs[case_id] = {"scores": [], "trajectories": [], "confidences": []}
        runs[case_id]["scores"].append(r["score"])
        runs[case_id]["trajectories"].append(r["trajectory"])
        runs[case_id]["confidences"].append(r.get("confidence", "MEDIUM"))

# Load forward returns
csv_path = CAL / "retest" / "selected-cases.csv"
returns = {}
with open(csv_path) as f:
    for row in csv.DictReader(f):
        returns[row["case_id"]] = float(row["forward_return_3yr"])

print("=" * 60)
print("  STOCHASTICITY MEASUREMENT (20 cases × 3 runs)")
print("=" * 60)
print()

# Per-case metrics
ranges = []
stds = []
trajectory_unanimous = 0
trajectory_flipped = 0
total = 0

# Raw CSV output
csv_rows = []

for case_id, data in sorted(runs.items()):
    scores = data["scores"]
    trajs = data["trajectories"]

    if len(scores) < 3:
        continue

    total += 1
    score_range = max(scores) - min(scores)
    score_mean = sum(scores) / len(scores)
    score_std = math.sqrt(sum((s - score_mean) ** 2 for s in scores) / len(scores))

    ranges.append(score_range)
    stds.append(score_std)

    # Trajectory agreement
    unique_trajs = set(trajs)
    if len(unique_trajs) == 1:
        trajectory_unanimous += 1
    if "deteriorating" in unique_trajs and "improving" in unique_trajs:
        trajectory_flipped += 1

    for run_num, (s, t, c) in enumerate(zip(scores, trajs, data["confidences"]), 1):
        csv_rows.append({
            "case_id": case_id,
            "run_number": run_num,
            "score": s,
            "confidence": c,
            "trajectory": t,
        })

    print(f"  {case_id}: scores={scores} range={score_range:.1f} std={score_std:.2f} trajs={trajs}")

print()
print("-" * 60)
print(f"  Total cases: {total}")
print(f"  Mean score range: {sum(ranges)/len(ranges):.2f}")
print(f"  Max score range:  {max(ranges):.1f}")
print(f"  Min score range:  {min(ranges):.1f}")
print(f"  Mean score std:   {sum(stds)/len(stds):.3f}")
print()

all_scores = [s for d in runs.values() for s in d["scores"]]
mean_score = sum(all_scores) / len(all_scores)
mean_std = sum(stds) / len(stds)
cv = mean_std / mean_score if mean_score > 0 else 0

print(f"  Grand mean score: {mean_score:.2f}")
print(f"  Coefficient of variation: {cv:.3f}")
print()
print(f"  Trajectory unanimous (3/3 agree): {trajectory_unanimous}/{total} ({trajectory_unanimous/total*100:.0f}%)")
print(f"  Trajectory flipped (det+imp):     {trajectory_flipped}/{total} ({trajectory_flipped/total*100:.0f}%)")
print()

# Gate check
mean_range = sum(ranges) / len(ranges)
traj_agree_pct = trajectory_unanimous / total * 100

print("=" * 60)
print("  GATE CHECK")
print("=" * 60)
print()

if mean_range > 2.0:
    print(f"  FAIL: Mean score range {mean_range:.2f} > 2.0")
    print(f"  Signal too noisy for single-run evaluation.")
    print(f"  → USE 3-RUN MEDIAN for all subsequent phases.")
elif traj_agree_pct < 50:
    print(f"  FAIL: Trajectory agreement {traj_agree_pct:.0f}% < 50%")
    print(f"  → USE 3-RUN MEDIAN for all subsequent phases.")
elif mean_range <= 1.0 and traj_agree_pct >= 70:
    print(f"  PASS: Mean range {mean_range:.2f} ≤ 1.0, agreement {traj_agree_pct:.0f}% ≥ 70%")
    print(f"  → Single run per case is acceptable.")
else:
    print(f"  BORDERLINE: Mean range {mean_range:.2f}, agreement {traj_agree_pct:.0f}%")
    print(f"  → USE 3-RUN MEDIAN for all subsequent phases.")

print()

# Correlation of median scores with forward returns
median_scores = {}
for case_id, data in runs.items():
    scores = sorted(data["scores"])
    median_scores[case_id] = scores[1]  # Median of 3

# Check correlation with returns where available
paired = [(median_scores[cid], returns[cid]) for cid in median_scores if cid in returns]
if len(paired) >= 5:
    x = [p[0] for p in paired]
    y = [p[1] for p in paired]
    n = len(x)
    mx = sum(x) / n
    my = sum(y) / n
    sx = math.sqrt(sum((xi - mx) ** 2 for xi in x) / (n - 1))
    sy = math.sqrt(sum((yi - my) ** 2 for yi in y) / (n - 1))
    if sx > 0 and sy > 0:
        cov = sum((x[i] - mx) * (y[i] - my) for i in range(n)) / (n - 1)
        r = cov / (sx * sy)
        t = r * math.sqrt((n - 2) / max(1 - r * r, 1e-12))
        z = abs(t)
        p = 2 * (1 - 0.5 * (1 + math.erf(z / math.sqrt(2))))
        print(f"  Pearson r(median_score, forward_return_3yr) = {r:.4f}, p={p:.4f}, n={n}")
    else:
        print(f"  Cannot compute correlation (zero variance)")
else:
    print(f"  Insufficient paired data for correlation (n={len(paired)})")

# Save raw CSV
csv_out = CAL / "retest" / "stochasticity-raw.csv"
with open(csv_out, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["case_id", "run_number", "score", "confidence", "trajectory"])
    writer.writeheader()
    writer.writerows(csv_rows)
print(f"\n  Saved: {csv_out} ({len(csv_rows)} rows)")
