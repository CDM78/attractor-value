#!/usr/bin/env python3
"""Phase 3: Composite testing."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, pearsonr, rankdata, stratified_kfold
import math

rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'analysis-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")

def rank_composite(rows, signal_cols, return_col='forward_return_3yr'):
    valid = []
    for r in rows:
        try:
            vals = [float(r[col]) for col in signal_cols if r.get(col, '') != '']
            ret = float(r[return_col]) if r.get(return_col, '') != '' else None
            entry = r.get('entry_cross_section', '')
            sp500 = float(r.get('sp500_return_3yr', '0') or '0')
            if len(vals) == len(signal_cols) and ret is not None:
                valid.append((vals, ret, entry, sp500))
        except: continue

    if len(valid) < 20:
        print(f"  INSUFFICIENT DATA (n={len(valid)})")
        return

    n = len(valid)
    rets = [v[1] for v in valid]
    entries = [v[2] for v in valid]
    sp500s = [v[3] for v in valid]

    # Rank each signal, average ranks
    ranks_sum = [0.0] * n
    for i in range(len(signal_cols)):
        col_vals = [v[0][i] for v in valid]
        col_ranks = rankdata(col_vals)
        for j in range(n): ranks_sum[j] += col_ranks[j]
    avg_ranks = [r / len(signal_cols) for r in ranks_sum]

    r, p, _ = pearsonr(avg_ranks, rets)
    print(f"  Pearson r(rank_composite, forward_return_3yr): r={r:.3f}, p={p:.4f}, n={n}")

    # Alpha: r vs alpha
    alphas = [rets[i] - sp500s[i] for i in range(n)]
    r_alpha, p_alpha, _ = pearsonr(avg_ranks, alphas)
    print(f"  Pearson r(rank_composite, alpha_3yr): r={r_alpha:.3f}, p={p_alpha:.4f}")

    # Top-half vs bottom-half
    median_rank = sorted(avg_ranks)[n // 2]
    top_rets = [rets[i] for i in range(n) if avg_ranks[i] >= median_rank]
    bot_rets = [rets[i] for i in range(n) if avg_ranks[i] < median_rank]
    top_mean = sum(top_rets) / len(top_rets)
    bot_mean = sum(bot_rets) / len(bot_rets)

    top_ann = (1 + top_mean) ** (1/3) - 1
    bot_ann = (1 + bot_mean) ** (1/3) - 1
    sp500_ann = (1 + sum(sp500s) / n) ** (1/3) - 1
    alpha_ann = top_ann - sp500_ann

    print(f"  Top-half mean 3yr return: {top_mean:.3f} (annualized: {top_ann:.1%})")
    print(f"  Bottom-half mean 3yr return: {bot_mean:.3f} (annualized: {bot_ann:.1%})")
    print(f"  SP500 annualized: {sp500_ann:.1%}")
    print(f"  Top-half annualized alpha: {alpha_ann:.1%}")

    # 5-fold CV
    fold_rs = []
    for fold_idx, (_, test_idx) in enumerate(stratified_kfold(entries, 5, 42)):
        ts = [avg_ranks[i] for i in test_idx]
        tr = [rets[i] for i in test_idx]
        if len(ts) < 10: continue
        fr, fp, _ = pearsonr(ts, tr)
        fold_rs.append(fr)
        print(f"    Fold {fold_idx+1}: r={fr:.3f}")
    if fold_rs:
        print(f"    Mean CV r: {sum(fold_rs)/len(fold_rs):.3f}, positive: {sum(1 for f in fold_rs if f > 0)}/{len(fold_rs)}")
    print()

# Test composites
print("=== Composite 1: spread_variance_slope + si_csd (validated signals) ===")
rank_composite(rows, ['spread_variance_slope', 'si_csd'])

print("=== Composite 2: spread_variance_slope + si_theta (validated+marginal) ===")
rank_composite(rows, ['spread_variance_slope', 'si_theta'])

print("=== Composite 3: spread_variance_slope + si_csd + fisher_information ===")
rank_composite(rows, ['spread_variance_slope', 'si_csd', 'fisher_information'])

print("=== Composite 4: spread_variance_slope + fisher_information ===")
rank_composite(rows, ['spread_variance_slope', 'fisher_information'])

print("=== Composite 5: si_csd + fisher_information (no macro) ===")
rank_composite(rows, ['si_csd', 'fisher_information'])

print("=== Composite 6: spread_variance_slope alone (macro timing) ===")
rank_composite(rows, ['spread_variance_slope'])
