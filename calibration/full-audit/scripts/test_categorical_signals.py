#!/usr/bin/env python3
"""Sub-Agent F: Categorical + S-curve."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, test_signal, ttest_ind
rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'master-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")
# Benford STRUCTURAL_STRESS
print("=== BENFORD STRUCTURAL_STRESS ===")
stress = [float(r['forward_return_3yr']) for r in rows if r.get('benford_structural_stress')=='STRUCTURAL_STRESS' and r.get('forward_return_3yr','')]
natural = [float(r['forward_return_3yr']) for r in rows if r.get('benford_structural_stress')=='NATURAL_PROCESS' and r.get('forward_return_3yr','')]
print(f"STRUCTURAL_STRESS: n={len(stress)}, mean={sum(stress)/len(stress):.3f}" if stress else "STRUCTURAL_STRESS: n=0")
print(f"NATURAL_PROCESS: n={len(natural)}, mean={sum(natural)/len(natural):.3f}" if natural else "NATURAL_PROCESS: n=0")
if len(stress) >= 5 and len(natural) >= 5:
    t, p = ttest_ind(stress, natural)
    print(f"t-test: t={t:.3f}, p={p:.4f}")
print()
# S-curve phase
print("=== S-CURVE PHASE ===")
for phase in ['ACCELERATING', 'PEAK', 'DECELERATING', 'TROUGH']:
    group = [float(r['forward_return_3yr']) for r in rows if r.get('scurve_phase')==phase and r.get('forward_return_3yr','')]
    if group:
        wins = sum(1 for r in group if r > 0.20)
        print(f"{phase}: n={len(group)}, mean_return={sum(group)/len(group):.3f}, win_rate(>20%)={wins/len(group)*100:.0f}%")
print()
# Fisher (confirm)
test_signal(rows, 'fisher_information', 'forward_return_3yr', 'Fisher information (confirm)', 0.101)
# EPS (confirm)
test_signal(rows, 'eps_round_number_excess', 'forward_return_3yr', 'EPS round number (confirm)', 0.075)
