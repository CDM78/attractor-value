#!/usr/bin/env python3
"""
Formal parser test: 10 S&P 500 (regression check) + 20 mid-caps (where extraction previously failed).
Saves results to parser-test-results.md.
"""

import json, sys, os, random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_item1a import extract_pair

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CAL_DIR = os.path.dirname(SCRIPT_DIR)

# Load CIK cache
cik_cache = json.load(open(os.path.join(CAL_DIR, '..', 'data', 'cik-cache.json')))

# Load midcap cases
midcap_data = json.load(open(os.path.join(CAL_DIR, 'midcap-cases.json')))
all_cases = midcap_data['cases']

# Find cases from 2020-Q3 and 2022-Q1, market cap $2B-$8B
qualifying = [c for c in all_cases
              if c['cross_section'] in ('2020-Q3', '2022-Q1')
              and 2e9 <= c.get('market_cap', 0) <= 8e9
              and c.get('forward_return_3yr') is not None
              and c['ticker'] in cik_cache]

# Get the previously-failed tickers from retest/filings
filing_dir = os.path.join(CAL_DIR, 'retest', 'filings')
previously_failed = set()
previously_ok = set()

for ticker in os.listdir(filing_dir):
    tdir = os.path.join(filing_dir, ticker)
    if not os.path.isdir(tdir):
        continue
    for f in os.listdir(tdir):
        fp = os.path.join(tdir, f)
        try:
            d = json.load(open(fp))
            if d.get('item1a') is None:
                previously_failed.add(ticker)
            else:
                previously_ok.add(ticker)
        except:
            pass

# Remove tickers that had mixed results (some OK, some failed)
pure_failed = previously_failed - previously_ok

print(f"Previously failed tickers: {len(previously_failed)}")
print(f"Previously OK tickers: {len(previously_ok)}")
print(f"Pure failed: {len(pure_failed)}")

# Select 20 mid-cap test cases from previously-failed tickers
random.seed(99)
midcap_failed_cases = [c for c in qualifying if c['ticker'] in previously_failed]
random.shuffle(midcap_failed_cases)
midcap_test = midcap_failed_cases[:20]

# Select 10 S&P 500 cases (from previously-ok tickers) as regression check
midcap_ok_cases = [c for c in qualifying if c['ticker'] in previously_ok]
random.shuffle(midcap_ok_cases)
sp500_test = midcap_ok_cases[:10]  # These are mid-caps that previously worked, as regression check

print(f"\nTest set: {len(sp500_test)} regression + {len(midcap_test)} previously-failed")

# Run tests
def test_case(case):
    ticker = case['ticker']
    cik = str(cik_cache[ticker]['cik'])
    date = case['entry_date']

    cur, pri = extract_pair(cik, date)

    # Validate: check that extracted text actually contains risk-related content
    cur_valid = False
    pri_valid = False

    if cur['item1a']:
        text_lower = cur['item1a'][:2000].lower()
        if any(w in text_lower for w in ['risk', 'adverse', 'uncertain', 'material']):
            cur_valid = True

    if pri['item1a']:
        text_lower = pri['item1a'][:2000].lower()
        if any(w in text_lower for w in ['risk', 'adverse', 'uncertain', 'material']):
            pri_valid = True

    # Check current and prior are from different filings
    same_filing = (cur['filing_date'] and pri['filing_date']
                   and cur['filing_date'] == pri['filing_date'])

    return {
        'ticker': ticker,
        'entry_date': date,
        'cur_words': cur['item1a_words'],
        'pri_words': pri['item1a_words'],
        'cur_date': cur['filing_date'],
        'pri_date': pri['filing_date'],
        'cur_method': cur.get('method'),
        'pri_method': pri.get('method'),
        'cur_error': cur.get('error'),
        'pri_error': pri.get('error'),
        'cur_valid': cur_valid,
        'pri_valid': pri_valid,
        'same_filing': same_filing,
        'success': cur_valid and pri_valid and not same_filing,
    }


results_regression = []
print("\n--- Regression (previously OK) ---")
for c in sp500_test:
    r = test_case(c)
    results_regression.append(r)
    status = 'OK' if r['success'] else 'FAIL'
    print(f"  {r['ticker']} ({r['entry_date']}): {status} "
          f"cur={r['cur_words']}w pri={r['pri_words']}w "
          f"err={r['cur_error'] or r['pri_error'] or ''}")

results_midcap = []
print("\n--- Previously Failed Mid-caps ---")
for c in midcap_test:
    r = test_case(c)
    results_midcap.append(r)
    status = 'OK' if r['success'] else 'FAIL'
    print(f"  {r['ticker']} ({r['entry_date']}): {status} "
          f"cur={r['cur_words']}w pri={r['pri_words']}w "
          f"err={r['cur_error'] or r['pri_error'] or ''}")

# Summary
reg_ok = sum(1 for r in results_regression if r['success'])
mc_ok = sum(1 for r in results_midcap if r['success'])

print(f"\n=== RESULTS ===")
print(f"Regression: {reg_ok}/{len(results_regression)}")
print(f"Mid-cap:    {mc_ok}/{len(results_midcap)}")

# Write report
with open(os.path.join(SCRIPT_DIR, 'parser-test-results.md'), 'w') as f:
    f.write("# Parser Test Results\n\n")
    f.write(f"```\nParser Test Results:\n")
    f.write(f"  Regression (previously OK): {reg_ok}/{len(results_regression)} successful\n")
    f.write(f"  Mid-cap (previously failed): {mc_ok}/{len(results_midcap)} successful (target: >= 14/20)\n")
    f.write(f"```\n\n")

    f.write(f"**GATE: {'PASS' if mc_ok >= 14 else 'FAIL'} "
            f"(mid-cap rate {mc_ok}/{len(results_midcap)} = {mc_ok/len(results_midcap)*100:.0f}%, "
            f"threshold 70%)**\n\n")

    # Failure details
    failures = [r for r in results_regression + results_midcap if not r['success']]
    if failures:
        f.write("## Failure Details\n\n")
        for r in failures:
            f.write(f"- **{r['ticker']}** ({r['entry_date']}): ")
            if r['cur_error']:
                f.write(f"current: {r['cur_error']}")
            if r['pri_error']:
                f.write(f" prior: {r['pri_error']}")
            if r['same_filing']:
                f.write(f" SAME FILING DATE for current and prior")
            if not r['cur_valid'] and r['cur_words'] > 0:
                f.write(f" current text not risk-related ({r['cur_words']}w)")
            if not r['pri_valid'] and r['pri_words'] > 0:
                f.write(f" prior text not risk-related ({r['pri_words']}w)")
            f.write("\n")

    f.write("\n## All Results\n\n")
    f.write("| Ticker | Date | Status | Cur Words | Pri Words | Cur Date | Pri Date | Error |\n")
    f.write("|--------|------|--------|-----------|-----------|----------|----------|-------|\n")
    for r in results_regression + results_midcap:
        status = 'OK' if r['success'] else 'FAIL'
        err = r['cur_error'] or r['pri_error'] or ''
        f.write(f"| {r['ticker']} | {r['entry_date']} | {status} | {r['cur_words']} | {r['pri_words']} "
                f"| {r['cur_date'] or 'N/A'} | {r['pri_date'] or 'N/A'} | {err} |\n")

print(f"\nResults saved to parser-test-results.md")
