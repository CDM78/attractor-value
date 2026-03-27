#!/usr/bin/env python3
"""
Phase 2: Select 150 cases for Job 2 retest.
- Run parser on qualifying mid-cap cases
- Select random 150 with seed=73
- Save selected-cases.csv
"""

import json, os, sys, random, csv, time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'parser-fix'))
from extract_item1a import extract_pair

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB2_DIR = os.path.dirname(SCRIPT_DIR)
CAL_DIR = os.path.dirname(JOB2_DIR)

# Load data
cik_cache = json.load(open(os.path.join(CAL_DIR, '..', 'data', 'cik-cache.json')))
midcap_data = json.load(open(os.path.join(CAL_DIR, 'midcap-cases.json')))
all_cases = midcap_data['cases']

# Filter qualifying cases
qualifying = [c for c in all_cases
              if c['cross_section'] in ('2020-Q3', '2022-Q1')
              and 2e9 <= c.get('market_cap', 0) <= 8e9
              and c.get('forward_return_3yr') is not None
              and c['ticker'] in cik_cache]

print(f"Qualifying cases: {len(qualifying)}")

# Cache directory for extracted Item 1A
CACHE_DIR = os.path.join(JOB2_DIR, 'item1a-cache')
os.makedirs(CACHE_DIR, exist_ok=True)

def get_cache_path(ticker, entry_date, label):
    return os.path.join(CACHE_DIR, f'{ticker}_{entry_date}_{label}.json')

def extract_with_cache(cik, ticker, entry_date):
    """Extract Item 1A pair, using cache if available."""
    cur_path = get_cache_path(ticker, entry_date, 'current')
    pri_path = get_cache_path(ticker, entry_date, 'prior')

    if os.path.exists(cur_path) and os.path.exists(pri_path):
        cur = json.load(open(cur_path))
        pri = json.load(open(pri_path))
        return cur, pri

    cur, pri = extract_pair(cik, entry_date)

    # Cache results (even failures, to avoid re-fetching)
    with open(cur_path, 'w') as f:
        json.dump(cur, f)
    with open(pri_path, 'w') as f:
        json.dump(pri, f)

    return cur, pri


# Process all qualifying cases — extract Item 1A pairs
# Group by ticker to avoid redundant CIK lookups
by_ticker = {}
for c in qualifying:
    ticker = c['ticker']
    if ticker not in by_ticker:
        by_ticker[ticker] = []
    by_ticker[ticker].append(c)

print(f"Unique tickers: {len(by_ticker)}")

# Track results
extracted_cases = []
failed_cases = []
total = len(qualifying)

for i, (ticker, cases) in enumerate(sorted(by_ticker.items())):
    cik = str(cik_cache[ticker]['cik'])

    for c in cases:
        idx = len(extracted_cases) + len(failed_cases) + 1
        if idx % 20 == 0:
            print(f"  [{idx}/{total}] {ticker} ({len(extracted_cases)} ok, {len(failed_cases)} fail)", flush=True)

        try:
            cur, pri = extract_with_cache(cik, ticker, c['entry_date'])

            if cur['item1a'] and pri['item1a']:
                # Verify different filing dates
                if cur['filing_date'] != pri['filing_date']:
                    extracted_cases.append({
                        **c,
                        'cik': cik,
                        'current_10k_filing_date': cur['filing_date'],
                        'prior_10k_filing_date': pri['filing_date'],
                        'current_item1a_word_count': cur['item1a_words'],
                        'prior_item1a_word_count': pri['item1a_words'],
                    })
                else:
                    failed_cases.append((ticker, c['entry_date'], 'SAME_FILING_DATE'))
            else:
                reason = cur.get('error') or pri.get('error') or 'UNKNOWN'
                failed_cases.append((ticker, c['entry_date'], reason))
        except Exception as e:
            failed_cases.append((ticker, c['entry_date'], str(e)))

print(f"\nExtraction complete: {len(extracted_cases)} with both Item 1A, {len(failed_cases)} failed")
print(f"Extraction rate: {len(extracted_cases)/total*100:.1f}%")

# Random selection with seed=73
random.seed(73)
random.shuffle(extracted_cases)
selected = extracted_cases[:150]

print(f"\nSelected: {len(selected)} cases")

# Report distribution
from collections import Counter
outcomes = Counter(c['classification'] for c in selected)
sections = Counter(c['cross_section'] for c in selected)
tickers = set(c['ticker'] for c in selected)

print(f"Outcome distribution: {dict(outcomes)}")
print(f"Entry dates: {dict(sections)}")
print(f"Unique companies: {len(tickers)}")
print(f"Mean Item 1A word count: "
      f"{sum(c['current_item1a_word_count'] for c in selected)/len(selected):.0f} (current), "
      f"{sum(c['prior_item1a_word_count'] for c in selected)/len(selected):.0f} (prior)")

# Check duplicates
ticker_counts = Counter(c['ticker'] for c in selected)
dupes = sum(1 for t, n in ticker_counts.items() if n > 1)
dupe_entries = sum(n for t, n in ticker_counts.items() if n > 1)
print(f"Duplicate companies: {dupes} ({dupe_entries} entries)")

# Save CSV
csv_path = os.path.join(JOB2_DIR, 'selected-cases.csv')
with open(csv_path, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow([
        'case_id', 'ticker', 'cik', 'entry_date', 'sector', 'market_cap_at_entry',
        'outcome_class', 'forward_return_3yr', 'sp500_return_3yr',
        'current_10k_filing_date', 'prior_10k_filing_date',
        'current_item1a_word_count', 'prior_item1a_word_count'
    ])
    for c in selected:
        writer.writerow([
            c['case_id'], c['ticker'], c['cik'], c['entry_date'],
            c.get('sector', ''), c.get('market_cap', ''),
            c['classification'], c['forward_return_3yr'],
            c.get('sp500_return_3yr', ''),
            c['current_10k_filing_date'], c['prior_10k_filing_date'],
            c['current_item1a_word_count'], c['prior_item1a_word_count'],
        ])

print(f"\nSaved to {csv_path}")

# Summary for report
print(f"""
=== SELECTION SUMMARY ===
Qualifying cases (parser succeeded): {len(extracted_cases)}
Selected: {len(selected)} (seed=73)
Outcome distribution: {', '.join(f'{k}: {v}' for k, v in sorted(outcomes.items()))}
Entry dates: {', '.join(f'{k}: {v}' for k, v in sorted(sections.items()))}
Unique companies: {len(tickers)}
Mean Item 1A word count: {sum(c['current_item1a_word_count'] for c in selected)/len(selected):.0f} (current), {sum(c['prior_item1a_word_count'] for c in selected)/len(selected):.0f} (prior)
Duplicates: {dupes} companies appear >1 time ({dupe_entries} total entries, {dupe_entries/len(selected)*100:.0f}%)
""")
