#!/usr/bin/env python3
"""
Phase 4: Run stochasticity test — first 20 cases × 3 runs.
Spawns sub-agents to evaluate Item 1A pairs.
This script prepares the data; the actual sub-agent calls happen via CC.
Outputs stochasticity-raw.csv.
"""

import csv, json, os, sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB2_DIR = os.path.dirname(SCRIPT_DIR)
CAL_DIR = os.path.dirname(JOB2_DIR)
CACHE_DIR = os.path.join(JOB2_DIR, 'item1a-cache')

# Load selected cases
cases = []
with open(os.path.join(JOB2_DIR, 'selected-cases.csv')) as f:
    reader = csv.DictReader(f)
    for r in reader:
        cases.append(r)

# First 20 cases
test_cases = cases[:20]

print(f"Stochasticity test: {len(test_cases)} cases × 3 runs")

# Load Item 1A text for each case
test_data = []
for c in test_cases:
    ticker = c['ticker']
    entry_date = c['entry_date']
    cik = c['cik']

    cur_path = os.path.join(CACHE_DIR, f'{ticker}_{entry_date}_current.json')
    pri_path = os.path.join(CACHE_DIR, f'{ticker}_{entry_date}_prior.json')

    if not os.path.exists(cur_path) or not os.path.exists(pri_path):
        print(f"  SKIP {ticker} — missing cache files")
        continue

    cur = json.load(open(cur_path))
    pri = json.load(open(pri_path))

    if not cur.get('item1a') or not pri.get('item1a'):
        print(f"  SKIP {ticker} — missing Item 1A text")
        continue

    test_data.append({
        'case_id': c['case_id'],
        'ticker': ticker,
        'cik': cik,
        'entry_date': entry_date,
        'current_date': cur['filing_date'],
        'prior_date': pri['filing_date'],
        'current_item1a': cur['item1a'],
        'prior_item1a': pri['item1a'],
        'forward_return_3yr': c['forward_return_3yr'],
    })

print(f"Cases with data: {len(test_data)}")

# Save test data for sub-agent consumption
with open(os.path.join(JOB2_DIR, 'stochasticity-cases.json'), 'w') as f:
    json.dump(test_data, f)

print(f"Saved to stochasticity-cases.json")
print(f"Ready for sub-agent runs. Each case needs 3 independent evaluations.")
