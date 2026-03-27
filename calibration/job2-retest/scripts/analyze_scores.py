#!/usr/bin/env python3
"""
Phase 6, Script 1: Analyze Job 2 scores vs forward returns.
Reads full-results.csv, computes correlations, CV, observation signals.
"""

import csv, json, os, sys, statistics, math
from collections import Counter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB2_DIR = os.path.dirname(SCRIPT_DIR)

sys.path.insert(0, SCRIPT_DIR)
from stats_utils import pearsonr, winsorize, ttest_ind, safe_float

LOG = open(os.path.join(SCRIPT_DIR, 'analyze_scores.log'), 'w')
def log(msg):
    print(msg)
    LOG.write(msg + '\n')

# Load data
csv_path = os.path.join(JOB2_DIR, 'full-results.csv')
if not os.path.exists(csv_path):
    log("ERROR: full-results.csv not found")
    sys.exit(1)

rows = []
with open(csv_path) as f:
    reader = csv.DictReader(f)
    for r in reader:
        rows.append(r)

log(f"Loaded {len(rows)} cases from full-results.csv")

# Parse
for r in rows:
    r['fwd_return'] = float(r['forward_return_3yr']) if r.get('forward_return_3yr') else None
    # Parse score_median
    s = r.get('score_median', '').strip()
    r['score'] = float(s) if s and s.lower() not in ('n/a', 'na', '') else None
    # Parse uncertainty_majority
    r['uncertainty'] = r.get('uncertainty_majority', '').strip().upper()

# === FIRST: CANNOT_ASSESS rate ===
total = len(rows)
cannot = sum(1 for r in rows if 'CANNOT' in r['uncertainty'])
marginal = sum(1 for r in rows if r['uncertainty'] == 'MARGINAL')
can = sum(1 for r in rows if r['uncertainty'] == 'CAN_ASSESS')

log(f"\n=== CANNOT_ASSESS RATE ===")
log(f"Total cases: {total}")
log(f"CAN_ASSESS: {can} ({can/total*100:.1f}%)")
log(f"MARGINAL: {marginal} ({marginal/total*100:.1f}%)")
log(f"CANNOT_ASSESS: {cannot} ({cannot/total*100:.1f}%)")

# === SECOND: Score vs forward return (scored cases only) ===
scored = [(r['score'], r['fwd_return']) for r in rows
          if r['score'] is not None and r['fwd_return'] is not None]

log(f"\n=== SCORE vs FORWARD RETURN (scored cases only) ===")
if len(scored) >= 10:
    scores, returns = zip(*scored)
    r, p, n = pearsonr(list(scores), list(returns))
    log(f"r={r:.3f}, p={p:.4f}, n={n}")

    if abs(r) > 0.15 and n > 100:
        returns_w = winsorize(list(returns))
        rw, pw, nw = pearsonr(list(scores), returns_w)
        log(f"Winsorized (5th/95th): r={rw:.3f}, p={pw:.4f}, n={nw}")
        if abs(rw) < 0.05:
            log(f"WARNING: Winsorized r < 0.05 — signal is outlier-driven, FAILED")
else:
    log(f"Only {len(scored)} scored cases — too few for correlation")

# === THIRD: CANNOT_ASSESS as a signal ===
log(f"\n=== CANNOT_ASSESS AS SIGNAL ===")
groups = {'CAN_ASSESS': [], 'MARGINAL': [], 'CANNOT_ASSESS': []}
for r in rows:
    if r['fwd_return'] is None:
        continue
    for key in groups:
        if key in r['uncertainty']:
            groups[key].append(r['fwd_return'])
            break

for key, vals in sorted(groups.items()):
    if vals:
        log(f"{key}: n={len(vals)}, mean_return={statistics.mean(vals):.3f}, "
            f"median={statistics.median(vals):.3f}, std={statistics.stdev(vals) if len(vals) > 1 else 0:.3f}")
    else:
        log(f"{key}: n=0")

# t-test between CAN_ASSESS and CANNOT_ASSESS
if len(groups['CAN_ASSESS']) >= 5 and len(groups['CANNOT_ASSESS']) >= 5:
    t, p = ttest_ind(groups['CAN_ASSESS'], groups['CANNOT_ASSESS'])
    log(f"t-test CAN vs CANNOT: t={t:.3f}, p={p:.4f}")

# === FOURTH: Observation counts as signals ===
log(f"\n=== OBSERVATION COUNTS AS SIGNALS ===")
obs_fields = [
    ('obs_a_count_run1', 'Risks added'),
    ('obs_b_count_run1', 'Risks removed'),
    ('obs_c_count_run1', 'Severity changed'),
]

for field, label in obs_fields:
    pairs = []
    for r in rows:
        v = r.get(field, '').strip()
        if v and r['fwd_return'] is not None:
            try:
                pairs.append((float(v), r['fwd_return']))
            except ValueError:
                pass
    if len(pairs) >= 10:
        obs, rets = zip(*pairs)
        r_val, p_val, n_val = pearsonr(list(obs), list(rets))
        log(f"{label} ({field}): r={r_val:.3f}, p={p_val:.4f}, n={n_val}")
    else:
        log(f"{label}: insufficient data ({len(pairs)} pairs)")

# Word count change
pairs_wc = []
for r in rows:
    if r['fwd_return'] is None:
        continue
    # Try to compute word count change from stored values
    try:
        cur_wc = float(r.get('current_item1a_word_count', 0) or 0)
        pri_wc = float(r.get('prior_item1a_word_count', 0) or 0)
        if pri_wc > 0:
            pct_change = (cur_wc - pri_wc) / pri_wc
            pairs_wc.append((pct_change, r['fwd_return']))
    except (ValueError, ZeroDivisionError):
        pass

if len(pairs_wc) >= 10:
    wc, rets = zip(*pairs_wc)
    r_val, p_val, n_val = pearsonr(list(wc), list(rets))
    log(f"Word count pct change: r={r_val:.3f}, p={p_val:.4f}, n={n_val}")

# === FIFTH: De-duplication check ===
log(f"\n=== DE-DUPLICATION CHECK ===")
tickers = [r['ticker'] for r in rows]
unique = len(set(tickers))
total_entries = len(tickers)
dup_pct = (total_entries - unique) / total_entries * 100 if total_entries > 0 else 0
log(f"Unique companies: {unique}, total entries: {total_entries}")
log(f"Duplicate rate: {dup_pct:.1f}%")

if dup_pct > 20:
    log(f"WARNING: Duplicates > 20% — recomputing on de-duplicated data (most recent entry)")
    # De-duplicate: keep most recent entry per ticker
    by_ticker = {}
    for r in rows:
        t = r['ticker']
        if t not in by_ticker or r['entry_date'] > by_ticker[t]['entry_date']:
            by_ticker[t] = r
    deduped = list(by_ticker.values())
    # Recompute score correlation
    scored_dd = [(r['score'], r['fwd_return']) for r in deduped
                 if r['score'] is not None and r['fwd_return'] is not None]
    if len(scored_dd) >= 10:
        scores_dd, returns_dd = zip(*scored_dd)
        r_dd, p_dd, n_dd = pearsonr(list(scores_dd), list(returns_dd))
        log(f"De-duplicated score correlation: r={r_dd:.3f}, p={p_dd:.4f}, n={n_dd}")

# === SIXTH: 5-fold CV ===
log(f"\n=== 5-FOLD CROSS-VALIDATION ===")
scored_rows = [r for r in rows if r['score'] is not None and r['fwd_return'] is not None]

if len(scored_rows) >= 20:
    import random
    random.seed(42)

    # Stratify by entry_date
    by_date = {}
    for r in scored_rows:
        d = r['entry_date']
        if d not in by_date:
            by_date[d] = []
        by_date[d].append(r)

    # Assign folds
    for d, cases in by_date.items():
        random.shuffle(cases)
        for i, c in enumerate(cases):
            c['_fold'] = i % 5

    fold_results = []
    for fold in range(5):
        test = [r for r in scored_rows if r.get('_fold') == fold]
        if len(test) < 3:
            continue
        scores_f = [r['score'] for r in test]
        returns_f = [r['fwd_return'] for r in test]
        r_f, p_f, n_f = pearsonr(scores_f, returns_f)
        fold_results.append((fold, r_f, p_f, n_f))
        log(f"  Fold {fold}: r={r_f:.3f}, p={p_f:.4f}, n={n_f}")

    positive_folds = sum(1 for _, r, _, _ in fold_results if r > 0)
    log(f"Positive folds: {positive_folds}/{len(fold_results)}")

    if fold_results:
        mean_r = statistics.mean([r for _, r, _, _ in fold_results])
        log(f"Mean fold r: {mean_r:.3f}")
else:
    log(f"Only {len(scored_rows)} scored cases — too few for 5-fold CV")

# Verdict
log(f"\n=== VERDICT ===")
if len(scored) >= 10:
    scores, returns = zip(*scored)
    r_val, p_val, n_val = pearsonr(list(scores), list(returns))

    if r_val > 0 and p_val < 0.05 and len(scored_rows) >= 20:
        positive_folds_check = sum(1 for _, r, _, _ in fold_results if r > 0)
        if positive_folds_check >= 4:
            log(f"VERDICT: VALIDATED (r={r_val:.3f}, p={p_val:.4f}, {positive_folds_check}/5 CV folds positive)")
        elif positive_folds_check >= 3:
            log(f"VERDICT: MARGINAL (r={r_val:.3f}, p={p_val:.4f}, {positive_folds_check}/5 CV folds positive)")
        else:
            log(f"VERDICT: FAILED (r={r_val:.3f}, p={p_val:.4f}, only {positive_folds_check}/5 CV folds positive)")
    elif r_val > 0 and p_val < 0.10:
        log(f"VERDICT: MARGINAL (r={r_val:.3f}, p={p_val:.4f})")
    else:
        log(f"VERDICT: FAILED (r={r_val:.3f}, p={p_val:.4f})")
else:
    log(f"VERDICT: INSUFFICIENT DATA")

LOG.close()
