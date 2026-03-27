#!/usr/bin/env python3
"""Sub-Agent B: SI remaining signals."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, test_signal
rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'master-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")
test_signal(rows, 'si_zipf_x_d1', 'forward_return_3yr', 'SI Zipf x D1 interaction', 0.223)
test_signal(rows, 'si_csd', 'forward_return_3yr', 'si_csd (confirm)', 0.074)
test_signal(rows, 'si_theta', 'forward_return_3yr', 'si_theta (confirm)', 0.068)
