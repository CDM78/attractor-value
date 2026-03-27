#!/usr/bin/env python3
"""
Phase 6, Script 2: Analyze factual observations independent of AI score.
These are document comparison facts — they don't depend on AI judgment.
"""

import csv, json, os, sys, statistics, math

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB2_DIR = os.path.dirname(SCRIPT_DIR)

# Import pearsonr from analyze_scores
sys.path.insert(0, SCRIPT_DIR)
from analyze_scores import pearsonr, winsorize

LOG = open(os.path.join(SCRIPT_DIR, 'analyze_observations.log'), 'w')
def log(msg):
    print(msg)
    LOG.write(msg + '\n')

# Load data
csv_path = os.path.join(JOB2_DIR, 'full-results.csv')
rows = []
with open(csv_path) as f:
    reader = csv.DictReader(f)
    for r in reader:
        rows.append(r)

log(f"Loaded {len(rows)} cases")

# Parse returns
for r in rows:
    r['fwd_return'] = float(r['forward_return_3yr']) if r.get('forward_return_3yr') else None

def safe_float(v):
    try:
        return float(v) if v and v.strip() not in ('', 'N/A', 'na') else None
    except ValueError:
        return None

# === 1. Number of new risk factors vs returns ===
log(f"\n=== OBSERVATION-ONLY SIGNALS ===")
log(f"(No AI judgment — purely factual document comparisons)")

signals = []

# Risks added
pairs = [(safe_float(r.get('obs_a_count_run1')), r['fwd_return'])
         for r in rows if safe_float(r.get('obs_a_count_run1')) is not None and r['fwd_return'] is not None]
if len(pairs) >= 10:
    x, y = zip(*pairs)
    r_val, p_val, n = pearsonr(list(x), list(y))
    log(f"\n1. Risks ADDED vs returns: r={r_val:.3f}, p={p_val:.4f}, n={n}")
    signals.append(('Risks added', r_val, p_val, n))
    if abs(r_val) > 0.15 and n > 100:
        y_w = winsorize(list(y))
        rw, pw, nw = pearsonr(list(x), y_w)
        log(f"   Winsorized: r={rw:.3f}, p={pw:.4f}, n={nw}")

# Risks removed
pairs = [(safe_float(r.get('obs_b_count_run1')), r['fwd_return'])
         for r in rows if safe_float(r.get('obs_b_count_run1')) is not None and r['fwd_return'] is not None]
if len(pairs) >= 10:
    x, y = zip(*pairs)
    r_val, p_val, n = pearsonr(list(x), list(y))
    log(f"\n2. Risks REMOVED vs returns: r={r_val:.3f}, p={p_val:.4f}, n={n}")
    signals.append(('Risks removed', r_val, p_val, n))

# Word count pct change
pairs = []
for r in rows:
    if r['fwd_return'] is None:
        continue
    try:
        cur_wc = float(r.get('current_item1a_word_count', 0) or 0)
        pri_wc = float(r.get('prior_item1a_word_count', 0) or 0)
        if pri_wc > 0:
            pct = (cur_wc - pri_wc) / pri_wc
            pairs.append((pct, r['fwd_return']))
    except (ValueError, ZeroDivisionError):
        pass

if len(pairs) >= 10:
    x, y = zip(*pairs)
    r_val, p_val, n = pearsonr(list(x), list(y))
    log(f"\n3. Word count % change vs returns: r={r_val:.3f}, p={p_val:.4f}, n={n}")
    signals.append(('Word count change', r_val, p_val, n))

# Total risk factor count (current)
pairs = []
for r in rows:
    if r['fwd_return'] is None:
        continue
    # Use statistics field if available
    v = safe_float(r.get('obs_a_count_run1'))
    b = safe_float(r.get('obs_b_count_run1'))
    d = safe_float(r.get('observations_d_count_run1', r.get('obs_d_count_run1')))
    if v is not None and d is not None:
        # Approximate current risk count = added + unchanged + severity changed
        c_count = safe_float(r.get('obs_c_count_run1'))
        total_current = (v or 0) + (d or 0) + (c_count or 0)
        pairs.append((total_current, r['fwd_return']))

if len(pairs) >= 10:
    x, y = zip(*pairs)
    r_val, p_val, n = pearsonr(list(x), list(y))
    log(f"\n4. Approx current risk count vs returns: r={r_val:.3f}, p={p_val:.4f}, n={n}")
    signals.append(('Current risk count', r_val, p_val, n))

# Severity changes
pairs = [(safe_float(r.get('obs_c_count_run1')), r['fwd_return'])
         for r in rows if safe_float(r.get('obs_c_count_run1')) is not None and r['fwd_return'] is not None]
if len(pairs) >= 10:
    x, y = zip(*pairs)
    r_val, p_val, n = pearsonr(list(x), list(y))
    log(f"\n5. Severity CHANGES vs returns: r={r_val:.3f}, p={p_val:.4f}, n={n}")
    signals.append(('Severity changes', r_val, p_val, n))

# === Best signal ===
log(f"\n=== BEST OBSERVATIONAL SIGNAL ===")
if signals:
    best = max(signals, key=lambda s: abs(s[1]))
    log(f"Best: {best[0]} with r={best[1]:.3f}, p={best[2]:.4f}, n={best[3]}")

    # Summary table
    log(f"\nSignal Summary:")
    log(f"{'Signal':<25} {'r':>8} {'p':>8} {'n':>5}")
    log(f"{'-'*25} {'-'*8} {'-'*8} {'-'*5}")
    for name, r_val, p_val, n in sorted(signals, key=lambda s: -abs(s[1])):
        log(f"{name:<25} {r_val:>8.3f} {p_val:>8.4f} {n:>5}")

LOG.close()
print(f"\nResults saved to {os.path.join(SCRIPT_DIR, 'analyze_observations.log')}")
