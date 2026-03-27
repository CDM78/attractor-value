#!/usr/bin/env python3
"""Sub-Agent D: New theories (Hurst, entropy, S-curve)."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, test_signal
rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'master-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")
test_signal(rows, 'hurst_revenue', 'forward_return_3yr', 'Hurst exponent (revenue)', 0)
test_signal(rows, 'hurst_x_growth_direction', 'forward_return_3yr', 'Hurst x growth direction', 0)
test_signal(rows, 'revenue_d1', 'forward_return_3yr', 'Revenue D1 (growth rate)', 0)
test_signal(rows, 'revenue_d2', 'forward_return_3yr', 'Revenue D2 (acceleration)', 0)
