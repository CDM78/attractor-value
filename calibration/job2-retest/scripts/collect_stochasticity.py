#!/usr/bin/env python3
"""
Collect stochasticity test results from sub-agent output files.
Reads stochasticity-outputs/case_XX_runY.txt files, parses them,
and writes stochasticity-raw.csv.

Usage:
    python collect_stochasticity.py          # Check status
    python collect_stochasticity.py --write  # Write CSV
"""

import csv, os, sys, argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_results import parse_agent_output

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB2_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(JOB2_DIR, 'stochasticity-outputs')

# Case mapping from selected-cases.csv
import json
cases_json = json.load(open(os.path.join(JOB2_DIR, 'stochasticity-cases.json')))
CASE_MAP = {}
for i, c in enumerate(cases_json):
    CASE_MAP[i] = {
        'case_id': c['case_id'],
        'cik': c['cik'],
        'ticker': c['ticker'],
        'forward_return_3yr': c['forward_return_3yr'],
    }

N_CASES = 20
N_RUNS = 3

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true', help='Write CSV output')
    args = parser.parse_args()

    results = []
    missing = []
    parse_errors = []

    for case_idx in range(N_CASES):
        for run in range(1, N_RUNS + 1):
            filename = f'case_{case_idx:02d}_run{run}.txt'
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

            if not parsed['uncertainty_rating']:
                parse_errors.append(f'{filename}: no uncertainty rating parsed')

            case_info = CASE_MAP[case_idx]
            results.append({
                'case_id': case_info['case_id'],
                'cik': case_info['cik'],
                'ticker': case_info['ticker'],
                'run_number': run,
                'uncertainty_rating': parsed['uncertainty_rating'],
                'score': parsed['score'],
                'obs_a_count': parsed['obs_a_count'],
                'obs_b_count': parsed['obs_b_count'],
                'obs_c_count': parsed['obs_c_count'],
                'observations_d_count': parsed['observations_d_count'],
                'prior_word_count': parsed['prior_word_count'],
                'current_word_count': parsed['current_word_count'],
                'forward_return_3yr': case_info['forward_return_3yr'],
            })

    # Status report
    total_expected = N_CASES * N_RUNS
    print(f"Results collected: {len(results)}/{total_expected}")
    if missing:
        print(f"Missing files ({len(missing)}):")
        for m in missing:
            print(f"  {m}")
    if parse_errors:
        print(f"Parse errors ({len(parse_errors)}):")
        for e in parse_errors:
            print(f"  {e}")

    if args.write and results:
        csv_path = os.path.join(JOB2_DIR, 'stochasticity-raw.csv')
        fieldnames = [
            'case_id', 'cik', 'ticker', 'run_number',
            'uncertainty_rating', 'score',
            'obs_a_count', 'obs_b_count', 'obs_c_count', 'observations_d_count',
            'prior_word_count', 'current_word_count', 'forward_return_3yr',
        ]
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
