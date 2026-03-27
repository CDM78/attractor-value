"""Pure Python statistics library — no numpy/scipy dependency."""

import math
import csv
import random
from collections import Counter

def load_dataset(path):
    with open(path) as f:
        return list(csv.DictReader(f))

def pearsonr(x, y):
    """Pearson correlation with p-value."""
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

def ttest_ind(x, y):
    """Independent samples t-test."""
    nx, ny = len(x), len(y)
    if nx < 2 or ny < 2: return 0, 1
    mx = sum(x) / nx
    my = sum(y) / ny
    vx = sum((xi - mx)**2 for xi in x) / (nx - 1)
    vy = sum((yi - my)**2 for yi in y) / (ny - 1)
    se = math.sqrt(vx/nx + vy/ny) if (vx/nx + vy/ny) > 0 else 1e-12
    t = (mx - my) / se
    df = nx + ny - 2
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(t) / math.sqrt(2))))
    return t, p

def percentile(arr, pct):
    s = sorted(arr)
    k = (len(s) - 1) * pct / 100
    f = math.floor(k)
    c = math.ceil(k)
    if f == c: return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)

def rankdata(arr):
    n = len(arr)
    indexed = sorted(enumerate(arr), key=lambda t: t[1])
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j < n - 1 and indexed[j+1][1] == indexed[j][1]:
            j += 1
        avg = (i + 1 + j + 1) / 2
        for k in range(i, j+1):
            ranks[indexed[k][0]] = avg
        i = j + 1
    return ranks

def stratified_kfold(entries, n_splits=5, seed=42):
    """Stratified K-fold split by entry_cross_section."""
    rng = random.Random(seed)
    groups = {}
    for i, e in enumerate(entries):
        groups.setdefault(e, []).append(i)

    folds = [[] for _ in range(n_splits)]
    for group_indices in groups.values():
        rng.shuffle(group_indices)
        for i, idx in enumerate(group_indices):
            folds[i % n_splits].append(idx)

    for fold_idx in range(n_splits):
        test = set(folds[fold_idx])
        train = set(range(len(entries))) - test
        yield sorted(train), sorted(test)

def test_signal(rows, signal_col, return_col, signal_name, sp500_ref_r):
    """Test a single signal. Returns dict with results."""
    valid = []
    for r in rows:
        try:
            s = float(r[signal_col]) if r.get(signal_col, '') != '' else None
            ret = float(r[return_col]) if r.get(return_col, '') != '' else None
            entry = r.get('entry_cross_section', '')
            if s is not None and ret is not None:
                valid.append((s, ret, entry))
        except (ValueError, KeyError):
            continue

    if len(valid) < 20:
        print(f"{signal_name}: INSUFFICIENT DATA (n={len(valid)})")
        return {'signal': signal_name, 'r': 0, 'p': 1, 'n': len(valid), 'verdict': 'INSUFFICIENT DATA'}

    sigs = [v[0] for v in valid]
    rets = [v[1] for v in valid]
    entries = [v[2] for v in valid]

    r, p, n = pearsonr(sigs, rets)
    print(f"{signal_name}: r={r:.3f}, p={p:.4f}, n={n}")
    print(f"  SP500 reference: r={sp500_ref_r:.3f}")
    if sp500_ref_r != 0:
        print(f"  Ratio: {r/sp500_ref_r:.2f}x")

    # Quartile analysis
    q25 = percentile(sigs, 25)
    q75 = percentile(sigs, 75)
    top_q_rets = [rets[i] for i in range(len(sigs)) if sigs[i] >= q75]
    bot_q_rets = [rets[i] for i in range(len(sigs)) if sigs[i] <= q25]

    top_mean = sum(top_q_rets)/len(top_q_rets) if top_q_rets else 0
    bot_mean = sum(bot_q_rets)/len(bot_q_rets) if bot_q_rets else 0
    print(f"  Top quartile mean return: {top_mean:.3f} (n={len(top_q_rets)})")
    print(f"  Bottom quartile mean return: {bot_mean:.3f} (n={len(bot_q_rets)})")
    print(f"  Spread: {top_mean - bot_mean:.3f}")

    top_wr = sum(1 for r in top_q_rets if r > 0.20) / len(top_q_rets) if top_q_rets else 0
    bot_wr = sum(1 for r in bot_q_rets if r > 0.20) / len(bot_q_rets) if bot_q_rets else 0
    print(f"  Top quartile win rate (>20%): {top_wr:.1%}")
    print(f"  Bottom quartile win rate (>20%): {bot_wr:.1%}")

    # 5-fold CV
    fold_rs = []
    for fold_idx, (train_idx, test_idx) in enumerate(stratified_kfold(entries, 5, 42)):
        test_s = [sigs[i] for i in test_idx]
        test_r = [rets[i] for i in test_idx]
        if len(test_s) < 5: continue
        fr, fp, _ = pearsonr(test_s, test_r)
        fold_rs.append(fr)
        print(f"    Fold {fold_idx+1}: r={fr:.3f}, p={fp:.4f}, n={len(test_s)}")

    pos_folds = sum(1 for fr in fold_rs if fr > 0)
    mean_cv = sum(fold_rs)/len(fold_rs) if fold_rs else 0
    print(f"    Mean CV r: {mean_cv:.3f}")
    print(f"    Positive folds: {pos_folds}/{len(fold_rs)}")

    if r > 0 and p < 0.05 and pos_folds >= 4:
        verdict = "VALIDATED"
    elif r > 0 and p < 0.10 and pos_folds >= 3:
        verdict = "MARGINAL"
    else:
        verdict = "FAILED"
    print(f"  VERDICT: {verdict}")
    print()

    return {'signal': signal_name, 'r': round(r, 4), 'p': round(p, 4), 'n': n,
            'cv_mean': round(mean_cv, 4), 'cv_pos': pos_folds, 'cv_total': len(fold_rs),
            'verdict': verdict, 'sp500_ref': sp500_ref_r,
            'top_q_mean': round(top_mean, 4), 'bot_q_mean': round(bot_mean, 4)}
