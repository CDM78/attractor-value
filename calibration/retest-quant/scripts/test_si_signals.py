#!/usr/bin/env python3
"""Sub-Agent B: Test SI signals."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, test_signal

rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'analysis-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")

total = len(rows)
si_coverage = sum(1 for r in rows if r.get('si_zipf_velocity', '') != '')
print(f"SI data coverage: {si_coverage}/{total} ({si_coverage/total*100:.1f}%)")
if si_coverage / total < 0.50:
    print("WARNING: SI coverage < 50% — results may not be representative\n")

signals = [
    ("si_zipf_velocity", "si_zipf_velocity", 0.219),
    ("si_zipf_velocity_fixed", "si_zipf_velocity_fixed", 0.219),
    ("si_csd",   "si_csd",   0.163),
    ("si_d1",    "si_d1",    0.161),
    ("si_theta", "si_theta", 0.138),
    ("si_d2",    "si_d2",    0.111),
    ("composite", "composite", 0.142),
]

for name, col, ref in signals:
    test_signal(rows, col, 'forward_return_3yr', name, ref)

# Secondary: against alpha
print("\n=== SECONDARY: Best SI signals against alpha_3yr ===\n")
for name, col, ref in [("si_csd (vs alpha)", "si_csd", 0), ("si_d1 (vs alpha)", "si_d1", 0)]:
    test_signal(rows, col, 'alpha_3yr', name, ref)
