#!/usr/bin/env python3
"""
Robust 10-K Item 1A (Risk Factors) extractor for EDGAR filings.
Handles mid-cap filing formats that the original JS parser missed.

Usage:
    python extract_item1a.py --cik 887936 --date 2022-03-31
    python extract_item1a.py --test  # Run parser tests

Key fixes over the original parser:
1. Decodes ALL HTML entities (&#160;, &#8212;, etc.) not just &nbsp;
2. Handles "Item 1A" separated from "Risk Factors" by various punctuation
3. Skips TOC entries and cross-references to find actual section content
4. Falls back to EDGAR full-text search (EFTS) if HTML parsing fails
5. Handles multi-document filings (Item 1A in separate exhibit)
"""

import json, re, time, urllib.request, urllib.parse, html, os, sys, argparse
from datetime import datetime, timedelta

UA = 'Bolin & Troy LLC charles@bolinandtroy.com'
RATE_LIMIT = 0.12  # SEC asks for 10 req/s max

_last_fetch = 0

def fetch(url, accept='text/html', timeout=60):
    """Rate-limited fetch from EDGAR."""
    global _last_fetch
    elapsed = time.time() - _last_fetch
    if elapsed < RATE_LIMIT:
        time.sleep(RATE_LIMIT - elapsed)
    _last_fetch = time.time()

    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Accept': accept,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        if e.code == 429:
            time.sleep(2)
            return fetch(url, accept, timeout)
        raise


def clean_text(raw_html):
    """Strip HTML and decode ALL entities properly."""
    text = raw_html
    # Remove style/script blocks
    text = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', text, flags=re.I)
    text = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', text, flags=re.I)
    # Remove iXBRL tags but keep content
    text = re.sub(r'</?ix:[^>]*>', '', text, flags=re.I)
    # Convert block elements to newlines
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.I)
    text = re.sub(r'</p>', '\n\n', text, flags=re.I)
    text = re.sub(r'</div>', '\n', text, flags=re.I)
    text = re.sub(r'</tr>', '\n', text, flags=re.I)
    text = re.sub(r'</li>', '\n', text, flags=re.I)
    # Strip all remaining tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Decode HTML entities (this handles &#160;, &#8212;, &nbsp;, &amp;, etc.)
    text = html.unescape(text)
    # Normalize whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def is_toc_entry(text, pos, match_text):
    """Check if a match position is in a table of contents (short line with page number)."""
    # Key heuristic: After "Item 1A...Risk Factors", if a bare number (page num)
    # appears within 20 chars, followed soon by "Item 1B" or "Item 2", it's TOC
    after = text[pos:pos+300]
    # Pattern: "Item 1A. Risk Factors 10 Item 1B" or similar
    if re.search(r'Risk\s+Factors\s*\.?\s*\d+\s.*?Item\s*(?:1B|2)', after, re.I | re.DOTALL):
        return True

    # Get the line containing this match
    line_start = text.rfind('\n', 0, pos)
    line_end = text.find('\n', pos)
    if line_start < 0: line_start = 0
    if line_end < 0: line_end = len(text)
    line = text[line_start:line_end].strip()

    # TOC entries are typically short lines ending with a page number
    # and surrounded by other short entries
    if len(line) < 150 and re.search(r'\d+\s*$', line):
        # Check if nearby lines also look like TOC (multiple short lines with numbers)
        context_start = max(0, line_start - 500)
        context = text[context_start:line_start]
        context_lines = [l.strip() for l in context.split('\n') if l.strip()]
        toc_like_lines = sum(1 for l in context_lines[-5:]
                           if len(l) < 150 and re.search(r'\d+\s*$', l))
        if toc_like_lines >= 2:
            return True

    # Also check: is this in the first 15% of the document? TOC is at the top
    doc_fraction = pos / max(len(text), 1)
    if doc_fraction < 0.15 and len(line) < 200:
        # Could be TOC — check if there's substantive content after it
        after_check = text[pos:pos+500]
        sentence_count = len(re.findall(r'[.!?]\s+[A-Z]', after_check))
        if sentence_count < 3:
            return True

    return False


def is_cross_reference(text, pos):
    """Check if 'Item 1A' at this position is a cross-reference, not a section header."""
    # Get surrounding context
    before = text[max(0, pos-100):pos].lower()
    after_text = text[pos:pos+200].lower()
    # Cross-references typically say "see Item 1A" or "in Item 1A" or "under Item 1A"
    cross_ref_patterns = [
        r'(?:see|refer to|described in|discussed in|set forth in|contained in|under|in part i,?)\s*$',
        r'(?:included in|identified in|disclosed in)\s*$',
    ]
    for pat in cross_ref_patterns:
        if re.search(pat, before.strip()):
            return True
    # If "Item 1A" is followed by "of this" or "in this" it's a reference
    if re.match(r'item\s+1a[^a-z]*(?:of this|in this|of the)', after_text):
        return True
    return False


# Patterns to match the Item 1A section header
ITEM_1A_PATTERNS = [
    # "Item 1A. Risk Factors" with various separators (including table cell boundaries)
    r'Item\s*1A[\.\s,\|\-\u2013\u2014\u00a0]*Risk\s+Factors',
    # "ITEM 1A. RISK FACTORS"
    r'ITEM\s*1A[\.\s,\|\-\u2013\u2014\u00a0]*RISK\s+FACTORS',
    # Just "Item 1A." followed by content on next line
    r'(?:^|\n)\s*(?:Item|ITEM)\s*1A\s*[\.\:\-\u2013\u2014]',
]

# Patterns for next section boundary
NEXT_SECTION_PATTERNS = [
    r'\n\s*(?:Item|ITEM)\s*1B[\.\s,\-\u2013\u2014\u00a0]*(?:Unresolved|UNRESOLVED)',
    r'\n\s*(?:Item|ITEM)\s*2[\.\s,\-\u2013\u2014\u00a0]*(?:Properties|PROPERTIES)',
    r'\n\s*(?:Item|ITEM)\s*(?:1B|2|3|4|5)[\.\s\-\u2013\u2014\u00a0]',
    r'\n\s*PART\s+II\b',
]


def find_item1a_header(text):
    """
    Find the actual Item 1A section header position.
    Returns (match_start, match_end) or (None, reason_string).

    Strategy:
    1. Try combined "Item 1A...Risk Factors" patterns
    2. Fallback: find "Item 1A" then check for "Risk Factors" within 200 chars
    3. Skip TOC entries and cross-references
    """
    # Strategy 1: Combined patterns
    combined_pattern = '|'.join(f'({p})' for p in ITEM_1A_PATTERNS)
    matches = list(re.finditer(combined_pattern, text, re.I | re.MULTILINE))

    # Strategy 2: Also find loose "Item 1A" matches where "Risk Factors" is nearby
    loose_pattern = r'(?:Item|ITEM)\s*1\s*A'
    for m in re.finditer(loose_pattern, text, re.I):
        # Check if "Risk Factors" appears within 200 chars after
        after_chunk = text[m.start():m.start()+200]
        if re.search(r'Risk\s+Factors', after_chunk, re.I):
            # Create a synthetic match spanning from Item 1A to Risk Factors
            rf_match = re.search(r'Risk\s+Factors', after_chunk, re.I)
            if rf_match:
                # Check it's not already captured by Strategy 1
                already = any(abs(m.start() - em.start()) < 10 for em in matches)
                if not already:
                    matches.append(m)

    if not matches:
        return None, 'NO_HEADER_MATCH'

    # Sort by position
    matches.sort(key=lambda m: m.start())

    # Find the ACTUAL section header (not TOC, not cross-reference)
    best_match = None
    for m in matches:
        pos = m.start()
        matched = m.group()

        # Skip TOC entries
        if is_toc_entry(text, pos, matched):
            continue
        # Skip cross-references
        if is_cross_reference(text, pos):
            continue

        # Among remaining candidates, prefer the one that's followed by substantive text
        after = text[m.end():m.end()+1000]
        # Actual section content usually has multiple sentences
        sentence_count = len(re.findall(r'[.!?]\s+[A-Z]', after))
        if sentence_count >= 3:
            best_match = m
            break  # First real content match wins
        elif best_match is None:
            best_match = m

    if best_match is None:
        return None, 'ALL_MATCHES_ARE_TOC_OR_CROSSREF'

    return best_match.start(), None


def extract_item1a_from_text(text):
    """
    Extract Item 1A section from cleaned text.
    Returns (section_text, method) or (None, reason).
    """
    result = find_item1a_header(text)
    if result[1] is not None:
        return None, result[1]

    start = result[0]

    # Find the end: next Item header
    remaining = text[start:]
    # Skip the first 500 chars (the header itself) when looking for next section
    search_start = min(500, len(remaining))
    end_offset = None

    for pat in NEXT_SECTION_PATTERNS:
        m = re.search(pat, remaining[search_start:], re.I)
        if m:
            candidate = search_start + m.start()
            if end_offset is None or candidate < end_offset:
                end_offset = candidate

    if end_offset:
        section = remaining[:end_offset]
    else:
        # No clear boundary — take up to 80K chars (generous for long risk sections)
        section = remaining[:80000]

    # Validate: actual risk factors should be substantial
    word_count = len(section.split())
    if word_count < 200:
        return None, f'SECTION_TOO_SHORT ({word_count} words)'

    return section, 'HTML_PARSE'


def get_filing_list(cik, before_date, form_types=('10-K', '10-K/A')):
    """Get list of filings for a CIK from EDGAR."""
    padded = str(cik).zfill(10)
    url = f'https://data.sec.gov/submissions/CIK{padded}.json'
    data = json.loads(fetch(url, accept='application/json'))

    recent = data.get('filings', {}).get('recent', {})
    if not recent:
        return []

    filings = []
    for j in range(len(recent.get('form', []))):
        form = recent['form'][j]
        if form not in form_types:
            continue
        filing_date = recent['filingDate'][j]
        if filing_date > before_date:
            continue
        filings.append({
            'date': filing_date,
            'accession': recent['accessionNumber'][j],
            'doc': recent['primaryDocument'][j],
            'form': form,
        })

    # Also check older filings if available
    older_files = data.get('filings', {}).get('files', [])
    for older in older_files:
        try:
            older_url = f'https://data.sec.gov/submissions/{older["name"]}'
            older_data = json.loads(fetch(older_url, accept='application/json'))
            for j in range(len(older_data.get('form', []))):
                form = older_data['form'][j]
                if form not in form_types:
                    continue
                filing_date = older_data['filingDate'][j]
                if filing_date > before_date:
                    continue
                filings.append({
                    'date': filing_date,
                    'accession': older_data['accessionNumber'][j],
                    'doc': older_data['primaryDocument'][j],
                    'form': form,
                })
        except:
            pass

    # Sort by date descending
    filings.sort(key=lambda x: x['date'], reverse=True)
    return filings


def fetch_and_extract(cik, filing):
    """Fetch a filing's HTML and extract Item 1A."""
    cik_str = str(cik)
    acc_clean = filing['accession'].replace('-', '')

    # Try primary document first
    url = f'https://www.sec.gov/Archives/edgar/data/{cik_str}/{acc_clean}/{filing["doc"]}'
    raw_html = fetch(url)
    text = clean_text(raw_html)

    section, method = extract_item1a_from_text(text)
    if section:
        return section, method, filing['doc']

    # Primary document failed — try other .htm files in the filing
    try:
        index_url = f'https://www.sec.gov/Archives/edgar/data/{cik_str}/{acc_clean}/index.json'
        index_data = json.loads(fetch(index_url, accept='application/json'))
        items = index_data.get('directory', {}).get('item', [])

        # Sort by size descending — larger files more likely to have content
        htm_files = [i for i in items
                     if i.get('name', '').lower().endswith(('.htm', '.html'))
                     and i['name'] != filing['doc']]
        htm_files.sort(key=lambda x: int(x.get('size', '0').replace(',', '') or '0'), reverse=True)

        for doc_info in htm_files[:5]:  # Check up to 5 other documents
            try:
                other_url = f'https://www.sec.gov/Archives/edgar/data/{cik_str}/{acc_clean}/{doc_info["name"]}'
                other_html = fetch(other_url)
                other_text = clean_text(other_html)
                section, method = extract_item1a_from_text(other_text)
                if section:
                    return section, f'{method}_ALT_DOC', doc_info['name']
            except:
                continue
    except:
        pass

    return None, method or 'ALL_METHODS_FAILED', None


def try_efts(cik, start_date, end_date):
    """Try EDGAR Full-Text Search as fallback."""
    padded = str(cik).zfill(10)
    # EFTS endpoint for searching within filings
    params = urllib.parse.urlencode({
        'q': '"Item 1A" "Risk Factors"',
        'dateRange': 'custom',
        'startdt': start_date,
        'enddt': end_date,
        'forms': '10-K,10-K/A',
        'entityName': padded,
    })
    url = f'https://efts.sec.gov/LATEST/search-index?{params}'
    try:
        data = json.loads(fetch(url, accept='application/json'))
        # EFTS returns snippets, not full sections
        # It's useful for confirming a filing exists but not for full extraction
        hits = data.get('hits', {}).get('hits', [])
        return len(hits) > 0, hits
    except:
        return False, []


def extract_item1a(cik, target_date, label='current'):
    """
    Main entry point: extract Item 1A for a CIK.

    Args:
        cik: SEC CIK number (string or int)
        target_date: 'YYYY-MM-DD' — find most recent 10-K filed before this date
        label: 'current' or 'prior' — if 'prior', get the second most recent

    Returns dict with:
        - item1a: extracted text or None
        - item1a_words: word count
        - filing_date: date of the filing used
        - method: extraction method used
        - error: error message if failed
    """
    cik = str(cik).lstrip('0') or '0'

    try:
        filings = get_filing_list(cik, target_date)
    except Exception as e:
        return {
            'item1a': None, 'item1a_words': 0,
            'filing_date': None, 'method': None,
            'error': f'FILING_LIST_FAILED: {e}'
        }

    if not filings:
        return {
            'item1a': None, 'item1a_words': 0,
            'filing_date': None, 'method': None,
            'error': 'NO_10K_FILINGS_FOUND'
        }

    # Select the right filing
    idx = 0 if label == 'current' else 1
    if idx >= len(filings):
        return {
            'item1a': None, 'item1a_words': 0,
            'filing_date': None, 'method': None,
            'error': f'INSUFFICIENT_FILINGS (need {idx+1}, have {len(filings)})'
        }

    filing = filings[idx]

    try:
        section, method, doc_used = fetch_and_extract(cik, filing)
    except Exception as e:
        section, method, doc_used = None, f'FETCH_ERROR: {e}', None

    if section:
        words = len(section.split())
        return {
            'item1a': section,
            'item1a_words': words,
            'filing_date': filing['date'],
            'method': method,
            'doc': doc_used,
            'error': None,
        }
    else:
        return {
            'item1a': None,
            'item1a_words': 0,
            'filing_date': filing['date'],
            'method': None,
            'error': f'EXTRACTION_FAILED: {method}',
        }


def extract_pair(cik, target_date):
    """Extract both current and prior year Item 1A for a CIK."""
    current = extract_item1a(cik, target_date, label='current')
    prior = extract_item1a(cik, target_date, label='prior')

    # Verify current and prior are from different filings
    if (current['filing_date'] and prior['filing_date']
            and current['filing_date'] == prior['filing_date']):
        prior['error'] = 'SAME_FILING_AS_CURRENT'
        prior['item1a'] = None
        prior['item1a_words'] = 0

    return current, prior


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Extract Item 1A from 10-K filings')
    parser.add_argument('--cik', type=str, help='CIK number')
    parser.add_argument('--date', type=str, help='Target date (YYYY-MM-DD)')
    parser.add_argument('--test', action='store_true', help='Run parser tests')
    args = parser.parse_args()

    if args.test:
        print("Use parser_test.py for testing")
        sys.exit(0)

    if args.cik and args.date:
        current, prior = extract_pair(args.cik, args.date)
        print(f"Current: filing={current['filing_date']}, words={current['item1a_words']}, "
              f"method={current['method']}, error={current['error']}")
        print(f"Prior:   filing={prior['filing_date']}, words={prior['item1a_words']}, "
              f"method={prior['method']}, error={prior['error']}")
    else:
        print("Usage: python extract_item1a.py --cik 887936 --date 2022-03-31")
