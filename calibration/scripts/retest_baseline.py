#!/usr/bin/env python3
"""Phase 3: Compute baseline Job 2 metrics on all 24 mid-cap cases with Item 1A."""

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

# Load stochasticity results (20 cases × 3 runs)
stoch_runs = {}
for i in range(1, 4):
    data = json.loads((CAL / f"retest/stochasticity-run{i}.json").read_text())
    for r in data["results"]:
        if r["case_id"] not in stoch_runs:
            stoch_runs[r["case_id"]] = []
        stoch_runs[r["case_id"]].append({
            "run": i, "score": r["score"], "trajectory": r["trajectory"],
            "confidence": r.get("confidence", "MEDIUM")
        })

# Load remaining 4 cases
remaining = json.loads((CAL / "retest/remaining-scores.json").read_text())
for r in remaining["results"]:
    cid = r["case_id"]
    stoch_runs[cid] = [
        {"run": 1, "score": r["run1_score"], "trajectory": r["run1_trajectory"], "confidence": r["run1_confidence"]},
        {"run": 2, "score": r["run2_score"], "trajectory": r["run2_trajectory"], "confidence": r["run2_confidence"]},
        {"run": 3, "score": r["run3_score"], "trajectory": r["run3_trajectory"], "confidence": r["run3_confidence"]},
    ]

# Load forward returns
returns = {}
outcomes = {}
with open(CAL / "retest/selected-cases.csv") as f:
    for row in csv.DictReader(f):
        returns[row["case_id"]] = float(row["forward_return_3yr"])
        outcomes[row["case_id"]] = row["outcome_class"]

print("=" * 60)
print("  BASELINE JOB 2 METRICS (24 mid-cap cases, 3-run median)")
print("=" * 60)
print()

# Compute median scores
baseline_rows = []
scores = []
fwd_returns = []

for case_id, runs in sorted(stoch_runs.items()):
    if case_id not in returns:
        continue
    run_scores = sorted([r["score"] for r in runs])
    median_score = run_scores[1] if len(run_scores) >= 3 else run_scores[0]
    mean_score = sum(run_scores) / len(run_scores)
    std_score = math.sqrt(sum((s - mean_score)**2 for s in run_scores) / len(run_scores)) if len(run_scores) > 1 else 0

    # Majority trajectory
    trajs = [r["trajectory"] for r in runs]
    from collections import Counter
    traj_counts = Counter(trajs)
    majority_traj = traj_counts.most_common(1)[0][0]

    fwd = returns[case_id]
    outcome = outcomes.get(case_id, "")

    baseline_rows.append({
        "case_id": case_id,
        "outcome_class": outcome,
        "forward_return_3yr": fwd,
        "score_run1": runs[0]["score"] if len(runs) > 0 else "",
        "score_run2": runs[1]["score"] if len(runs) > 1 else "",
        "score_run3": runs[2]["score"] if len(runs) > 2 else "",
        "score_median": median_score,
        "score_mean": round(mean_score, 2),
        "score_std": round(std_score, 3),
        "trajectory_majority": majority_traj,
    })

    scores.append(median_score)
    fwd_returns.append(fwd)

    print(f"  {case_id}: median={median_score:.1f} runs={[r['score'] for r in runs]} fwd={fwd:+.2%} outcome={outcome}")

print()
print("-" * 60)

# PRIMARY: Pearson r
r, p, n = pearsonr(scores, fwd_returns)
print(f"  PRIMARY: r(score_median, forward_return_3yr) = {r:.4f}, p={p:.4f}, n={n}")
print()

# Score distribution
print(f"  Score distribution:")
print(f"    Mean: {sum(scores)/len(scores):.2f}")
print(f"    Std:  {math.sqrt(sum((s - sum(scores)/len(scores))**2 for s in scores) / len(scores)):.2f}")
print(f"    Min:  {min(scores):.1f}")
print(f"    Max:  {max(scores):.1f}")
print()

# Outcome distribution
outcome_dist = Counter(outcomes.get(r["case_id"], "unknown") for r in baseline_rows)
print(f"  Outcome distribution:")
for k, v in sorted(outcome_dist.items()):
    print(f"    {k}: {v}")
print()

# Trajectory distribution
traj_dist = Counter(r["trajectory_majority"] for r in baseline_rows)
print(f"  Trajectory distribution (majority vote):")
for k, v in sorted(traj_dist.items()):
    print(f"    {k}: {v}")
print()

# Quartile analysis
sorted_by_score = sorted(zip(scores, fwd_returns, [r["outcome_class"] for r in baseline_rows]))
q_size = len(sorted_by_score) // 4 or 1

for qi, label in enumerate(["Q1 (lowest)", "Q2", "Q3", "Q4 (highest)"]):
    start = qi * q_size
    end = start + q_size if qi < 3 else len(sorted_by_score)
    group = sorted_by_score[start:end]
    mean_ret = sum(g[1] for g in group) / len(group) if group else 0
    wins = sum(1 for g in group if g[2] == "winner")
    print(f"  {label}: n={len(group)}, mean_return={mean_ret:.2%}, win_rate={wins/len(group)*100:.0f}%")

print()

# Win rate by trajectory
print(f"  Win rate by trajectory:")
for traj in ["deteriorating", "stable", "improving"]:
    group = [r for r in baseline_rows if r["trajectory_majority"] == traj]
    if not group: continue
    wins = sum(1 for r in group if r["outcome_class"] == "winner")
    mean_ret = sum(returns[r["case_id"]] for r in group) / len(group)
    print(f"    {traj}: n={len(group)}, win_rate={wins/len(group)*100:.0f}%, mean_return={mean_ret:.2%}")

# Save CSV
csv_path = CAL / "retest" / "baseline-scores.csv"
with open(csv_path, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=[
        "case_id", "outcome_class", "forward_return_3yr",
        "score_run1", "score_run2", "score_run3", "score_median", "score_mean", "score_std",
        "trajectory_majority"
    ])
    writer.writeheader()
    writer.writerows(baseline_rows)

print(f"\n  Saved: {csv_path} ({len(baseline_rows)} rows)")
