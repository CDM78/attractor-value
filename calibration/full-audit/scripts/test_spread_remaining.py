#!/usr/bin/env python3
"""Sub-Agent A: Spread signals not yet retested."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, test_signal
rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'master-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")
# Check unique spread values
vals = set(r.get('spread_variance_slope','') for r in rows if r.get('spread_variance_slope',''))
print(f"Unique spread_variance_slope values: {len(vals)}\n")
test_signal(rows, 'spread_variance_slope', 'forward_return_3yr', 'spread_variance_slope (confirm)', 0.065)
test_signal(rows, 'spread_theta', 'forward_return_3yr', 'spread_theta (confirm)', 0.065)
