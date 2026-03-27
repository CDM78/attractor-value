#!/usr/bin/env python3
"""Sub-Agent C: Financial statement signals (the collapsed ones)."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, test_signal
rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'master-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")
signals = [
    ('beta_level', 'beta level (equity)', 0.299),
    ('beta_trajectory', 'beta trajectory', 0.267),
    ('beta_velocity', 'beta velocity', 0.200),
    ('fin_csd', 'Financial CSD', -0.037),
    ('fin_benford_kld', 'Financial Benford KLD', -0.027),
    ('fin_d1_growth', 'Financial D1 growth', -0.069),
]
for col, name, prior in signals:
    test_signal(rows, col, 'forward_return_3yr', name, prior)
