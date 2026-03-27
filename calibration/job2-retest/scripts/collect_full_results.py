#!/usr/bin/env python3
"""
Collect full-run results from sub-agent output files.
Reads full-run-outputs/case_XXX.txt files, parses them,
and writes full-results.csv.

Usage:
    python collect_full_results.py          # Check status
    python collect_full_results.py --write  # Write CSV
"""

import csv, os, sys, argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_results import parse_agent_output

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB2_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(JOB2_DIR, 'full-run-outputs')

# Load case metadata from selected-cases.csv
cases_meta = []
with open(os.path.join(JOB2_DIR, 'selected-cases.csv')) as f:
    reader = csv.DictReader(f)
    for r in reader:
        cases_meta.append(r)

N_CASES = len(cases_meta)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true', help='Write CSV output')
    args = parser.parse_args()

    results = []
    missing = []
    parse_errors = []

    for i in range(N_CASES):
        filename = f'case_{i:03d}.txt'
        filepath = os.path.join(OUTPUT_DIR, filename)

        if not os.path.exists(filepath):
            missing.append(filename)
            continue

        with open(filepath, 'r', encoding='utf-8') as f:
            text = f.read()

        if not text.strip():
            missing.append(f'{filename} (empty)')
            continue

        parsed = parse_agent_output(text)
        meta = cases_meta[i]

        if not parsed['uncertainty_rating']:
            parse_errors.append(f'{filename}: no uncertainty rating parsed')

        results.append({
            'case_id': meta['case_id'],
            'ticker': meta['ticker'],
            'cik': meta['cik'],
            'entry_date': meta['entry_date'],
            'sector': meta.get('sector', ''),
            'market_cap_at_entry': meta.get('market_cap_at_entry', ''),
            'outcome_class': meta['outcome_class'],
            'forward_return_3yr': meta['forward_return_3yr'],
            'sp500_return_3yr': meta.get('sp500_return_3yr', ''),
            'current_item1a_word_count': meta.get('current_item1a_word_count', ''),
            'prior_item1a_word_count': meta.get('prior_item1a_word_count', ''),
            # Single run results (no median needed)
            'uncertainty_majority': parsed['uncertainty_rating'],
            'score_median': parsed['score'],
            'obs_a_count_run1': parsed['obs_a_count'],
            'obs_b_count_run1': parsed['obs_b_count'],
            'obs_c_count_run1': parsed['obs_c_count'],
            'observations_d_count_run1': parsed['observations_d_count'],
            'prior_word_count_agent': parsed['prior_word_count'],
            'current_word_count_agent': parsed['current_word_count'],
        })

    # Status report
    print(f"Results collected: {len(results)}/{N_CASES}")
    if missing:
        print(f"Missing files ({len(missing)}):")
        for m in missing[:20]:
            print(f"  {m}")
        if len(missing) > 20:
            print(f"  ... and {len(missing) - 20} more")
    if parse_errors:
        print(f"Parse errors ({len(parse_errors)}):")
        for e in parse_errors[:10]:
            print(f"  {e}")

    # Quick summary stats
    if results:
        unc_counts = {}
        score_vals = []
        for r in results:
            u = r['uncertainty_majority']
            unc_counts[u] = unc_counts.get(u, 0) + 1
            s = r['score_median']
            if s and s.lower() not in ('n/a', 'na', ''):
                try:
                    score_vals.append(float(s))
                except ValueError:
                    pass

        print(f"\nUncertainty distribution: {unc_counts}")
        if score_vals:
            print(f"Scored cases: {len(score_vals)}/{len(results)}")
            print(f"Score range: {min(score_vals):.1f} - {max(score_vals):.1f}")
            print(f"Score mean: {sum(score_vals)/len(score_vals):.2f}")

    if args.write and results:
        csv_path = os.path.join(JOB2_DIR, 'full-results.csv')
        fieldnames = list(results[0].keys())
        with open(csv_path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)
        print(f"\nWrote {len(results)} rows to {csv_path}")
    elif args.write and not results:
        print("\nNo results to write!")

    return len(results), len(missing)

if __name__ == '__main__':
    main()
