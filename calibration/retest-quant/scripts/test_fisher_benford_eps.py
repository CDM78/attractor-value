#!/usr/bin/env python3
"""Sub-Agent C: Test Fisher, Benford, EPS signals."""
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, test_signal, ttest_ind

rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'analysis-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")

# Continuous signals
signals = [
    ("fisher_information",  "fisher_information",     0.169),
    ("eps_round_number",    "eps_round_number_excess", 0.132),
    ("base10_excess",       "base10_excess",           0.075),
]

for name, col, ref in signals:
    test_signal(rows, col, 'forward_return_3yr', name, ref)

# Benford categorical
print("=== BENFORD STRUCTURAL_STRESS (categorical) ===\n")
stress_rets = [float(r['forward_return_3yr']) for r in rows
               if r.get('benford_structural_stress') == 'STRUCTURAL_STRESS' and r.get('forward_return_3yr', '') != '']
natural_rets = [float(r['forward_return_3yr']) for r in rows
                if r.get('benford_structural_stress') == 'NATURAL_PROCESS' and r.get('forward_return_3yr', '') != '']

print(f"STRUCTURAL_STRESS cases: n={len(stress_rets)}")
print(f"NATURAL_PROCESS cases: n={len(natural_rets)}")

if len(stress_rets) >= 5 and len(natural_rets) >= 5:
    stress_mean = sum(stress_rets)/len(stress_rets)
    natural_mean = sum(natural_rets)/len(natural_rets)
    t, p = ttest_ind(stress_rets, natural_rets)
    print(f"STRUCTURAL_STRESS mean return: {stress_mean:.3f}")
    print(f"NATURAL_PROCESS mean return: {natural_mean:.3f}")
    print(f"Difference: {stress_mean - natural_mean:.3f}")
    print(f"t-test: t={t:.3f}, p={p:.4f}")

    stress_wr = sum(1 for r in stress_rets if r > 0.20) / len(stress_rets)
    natural_wr = sum(1 for r in natural_rets if r > 0.20) / len(natural_rets)
    print(f"STRUCTURAL_STRESS win rate (>20%): {stress_wr:.1%}")
    print(f"NATURAL_PROCESS win rate (>20%): {natural_wr:.1%}")
else:
    print("Insufficient data for Benford comparison")
print()

# Fisher against alpha (secondary)
print("=== SECONDARY: Fisher vs alpha ===\n")
test_signal(rows, 'fisher_information', 'alpha_3yr', 'fisher (vs alpha)', 0)
