#!/usr/bin/env python3
"""Sub-Agent A: Test spread signals."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, test_signal

rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'analysis-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")

# Check uniqueness of spread values
spread_vals = set()
for r in rows:
    v = r.get('spread_variance_slope', '')
    if v: spread_vals.add(v)
print(f"Unique spread_variance_slope values: {len(spread_vals)} across {sum(1 for r in rows if r.get('spread_variance_slope',''))} cases")
print(f"(If few unique values, spread is testing macro timing, not company selection)\n")

signals = [
    ("spread_variance_slope", "spread_variance_slope", 0.333),
    ("spread_theta",          "spread_theta",           0.329),
]

results = []
for name, col, ref in signals:
    r = test_signal(rows, col, 'forward_return_3yr', name, ref)
    if r: results.append(r)

# Also test against alpha (secondary)
print("\n=== SECONDARY: Against alpha_3yr ===\n")
for name, col, ref in signals:
    test_signal(rows, col, 'alpha_3yr', f"{name} (vs alpha)", 0)
