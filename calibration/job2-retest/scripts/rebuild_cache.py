#!/usr/bin/env python3
"""
Rebuild Item 1A cache for selected cases.
Usage:
    python rebuild_cache.py             # All 150 cases
    python rebuild_cache.py --first 20  # First N cases only (for stochasticity test)
"""

import csv, json, os, sys, argparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'parser-fix'))
from extract_item1a import extract_pair

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB2_DIR = os.path.dirname(SCRIPT_DIR)
CACHE_DIR = os.path.join(JOB2_DIR, 'item1a-cache')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--first', type=int, default=0, help='Only process first N cases')
    args = parser.parse_args()

    os.makedirs(CACHE_DIR, exist_ok=True)

    # Load selected cases
    cases = []
    with open(os.path.join(JOB2_DIR, 'selected-cases.csv')) as f:
        reader = csv.DictReader(f)
        for r in reader:
            cases.append(r)

    if args.first > 0:
        cases = cases[:args.first]

    print(f"Rebuilding Item 1A cache for {len(cases)} cases...")

    # Load CIK cache for lookups
    cik_cache_path = os.path.join(JOB2_DIR, '..', '..', 'data', 'cik-cache.json')
    cik_cache = json.load(open(cik_cache_path))

    success = 0
    fail = 0

    for i, c in enumerate(cases):
        ticker = c['ticker']
        entry_date = c['entry_date']
        cik = c['cik']

        cur_path = os.path.join(CACHE_DIR, f'{ticker}_{entry_date}_current.json')
        pri_path = os.path.join(CACHE_DIR, f'{ticker}_{entry_date}_prior.json')

        # Skip if already cached
        if os.path.exists(cur_path) and os.path.exists(pri_path):
            cur = json.load(open(cur_path))
            pri = json.load(open(pri_path))
            if cur.get('item1a') and pri.get('item1a'):
                print(f"  [{i+1}/{len(cases)}] {ticker} — cached OK")
                success += 1
                continue

        print(f"  [{i+1}/{len(cases)}] {ticker} — fetching from EDGAR...", flush=True)

        try:
            cur, pri = extract_pair(cik, entry_date)

            with open(cur_path, 'w') as f:
                json.dump(cur, f)
            with open(pri_path, 'w') as f:
                json.dump(pri, f)

            if cur.get('item1a') and pri.get('item1a'):
                print(f"    OK: current={cur['item1a_words']}w, prior={pri['item1a_words']}w")
                success += 1
            else:
                reason = cur.get('error') or pri.get('error') or 'UNKNOWN'
                print(f"    FAIL: {reason}")
                fail += 1
        except Exception as e:
            print(f"    ERROR: {e}")
            fail += 1

    print(f"\nDone: {success} success, {fail} fail out of {len(cases)}")
    return success, fail

if __name__ == '__main__':
    main()
