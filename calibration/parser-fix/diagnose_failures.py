#!/usr/bin/env python3
"""Diagnose why 80% of mid-cap 10-K Item 1A extractions fail.
Fetches 10 failed cases, inspects HTML patterns around Risk Factors."""

import json, re, time, urllib.request, os, sys

UA = 'Bolin & Troy LLC charles@bolinandtroy.com'
DIAG_DIR = os.path.dirname(os.path.abspath(__file__))
FILING_DIR = os.path.join(os.path.dirname(DIAG_DIR), 'retest', 'filings')

# 10 failed tickers from the retest
FAILED_TICKERS = ['FCN', 'MSA', 'SAIC', 'RYN', 'GTES', 'FBIN', 'WFRD', 'OGS', 'CACC', 'ARW']

def fetch(url, accept='text/html'):
    time.sleep(0.15)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode('utf-8', errors='replace')

def strip_html(html):
    text = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=re.I)
    text = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', text, flags=re.I)
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.I)
    text = re.sub(r'</p>', '\n\n', text, flags=re.I)
    text = re.sub(r'</div>', '\n', text, flags=re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def diagnose_one(ticker, cik_cache):
    cik_info = cik_cache.get(ticker)
    if not cik_info:
        return {'ticker': ticker, 'error': 'No CIK found'}

    cik = str(cik_info['cik'])
    padded = cik.zfill(10)
    result = {'ticker': ticker, 'cik': cik}

    try:
        subs_url = f'https://data.sec.gov/submissions/CIK{padded}.json'
        subs = json.loads(fetch(subs_url, accept='application/json'))
        recent = subs.get('filings', {}).get('recent', {})

        # Find 10-K filings
        tenks = []
        for j in range(len(recent.get('form', []))):
            if recent['form'][j] in ('10-K', '10-K/A'):
                tenks.append({
                    'date': recent['filingDate'][j],
                    'accession': recent['accessionNumber'][j],
                    'doc': recent['primaryDocument'][j],
                    'form': recent['form'][j],
                })

        result['tenk_count'] = len(tenks)
        if not tenks:
            result['error'] = 'No 10-K filings found'
            return result

        filing = tenks[0]  # Most recent
        result['latest_filing'] = filing

        # Fetch the filing index to understand structure
        acc_clean = filing['accession'].replace('-', '')
        index_url = f'https://www.sec.gov/Archives/edgar/data/{cik}/{acc_clean}/index.json'
        try:
            index_data = json.loads(fetch(index_url, accept='application/json'))
            items = index_data.get('directory', {}).get('item', [])
            htm_files = [i for i in items if i.get('name', '').lower().endswith(('.htm', '.html'))]
            result['filing_documents'] = [{'name': i['name'], 'size': i.get('size', '')} for i in htm_files[:10]]
            result['total_docs'] = len(items)
        except Exception as e:
            result['index_error'] = str(e)

        # Fetch the primary document
        doc_url = f'https://www.sec.gov/Archives/edgar/data/{cik}/{acc_clean}/{filing["doc"]}'
        html = fetch(doc_url)
        result['html_length'] = len(html)

        # Check for iXBRL
        result['has_ixbrl'] = bool(re.search(r'<ix:|xmlns:ix=', html, re.I))

        text = strip_html(html)
        result['text_length'] = len(text)
        result['text_words'] = len(text.split())

        # Search for various Item 1A patterns
        patterns = [
            (r'Item\s+1A[\.\s\-–—]*\s*Risk\s+Factors', 'Standard: Item 1A Risk Factors'),
            (r'ITEM\s+1A[\.\s\-–—]*\s*RISK\s+FACTORS', 'Uppercase: ITEM 1A RISK FACTORS'),
            (r'Item\s+1A', 'Bare: Item 1A'),
            (r'ITEM\s+1A', 'Bare: ITEM 1A'),
            (r'Risk\s+Factors', 'Just: Risk Factors'),
            (r'RISK\s+FACTORS', 'Just: RISK FACTORS'),
            (r'Item\xa01A', 'Non-breaking space: Item\xa01A'),
            (r'Item &nbsp;1A', 'HTML nbsp: Item &nbsp;1A'),
        ]

        result['pattern_matches'] = {}
        for pat, desc in patterns:
            matches = list(re.finditer(pat, text, re.I))
            if matches:
                result['pattern_matches'][desc] = {
                    'count': len(matches),
                    'positions': [m.start() for m in matches[:5]],
                    'context': [text[max(0,m.start()-30):m.end()+50] for m in matches[:3]]
                }

        # Try the original regex
        orig_match = re.search(r'Item\s+1A[\.\s\-–—]*\s*Risk\s+Factors', text, re.I)
        result['original_regex_matches'] = bool(orig_match)

        # Check if item 1A is in a separate document
        if not orig_match and 'filing_documents' in result:
            # Try other .htm files in the filing
            for doc_info in result['filing_documents']:
                if doc_info['name'] == filing['doc']:
                    continue
                try:
                    other_url = f'https://www.sec.gov/Archives/edgar/data/{cik}/{acc_clean}/{doc_info["name"]}'
                    other_html = fetch(other_url)
                    other_text = strip_html(other_html)
                    if re.search(r'Item\s+1A[\.\s\-–—]*\s*Risk\s+Factors', other_text, re.I):
                        result['item1a_in_other_doc'] = doc_info['name']
                        result['other_doc_words'] = len(other_text.split())
                        break
                except:
                    pass

        # Check if the primary doc is actually the full 10-K or just an exhibit
        first_500 = text[:500].lower()
        result['doc_starts_with'] = text[:200]

        # Look at what "Item" headers exist
        item_headers = re.findall(r'(?:Item|ITEM)\s+\d+[A-Z]?\.?[^a-z]{0,50}', text)
        result['item_headers_found'] = list(set(item_headers))[:20]

    except Exception as e:
        result['error'] = str(e)

    return result

def main():
    cik_cache = json.load(open('/home/cm/attractor-value/data/cik-cache.json'))

    results = []
    for ticker in FAILED_TICKERS:
        print(f'Diagnosing {ticker}...', flush=True)
        r = diagnose_one(ticker, cik_cache)
        results.append(r)
        print(f'  original_regex: {r.get("original_regex_matches")}, patterns: {list(r.get("pattern_matches", {}).keys())}')
        if r.get('item1a_in_other_doc'):
            print(f'  *** Item 1A found in OTHER document: {r["item1a_in_other_doc"]}')

    # Write diagnosis
    with open(os.path.join(DIAG_DIR, 'diagnosis-raw.json'), 'w') as f:
        json.dump(results, f, indent=2, default=str)

    # Write summary
    with open(os.path.join(DIAG_DIR, 'diagnosis.md'), 'w') as f:
        f.write('# 10-K Parser Failure Diagnosis\n\n')
        f.write(f'Examined {len(results)} failed mid-cap cases.\n\n')

        for r in results:
            f.write(f'## {r["ticker"]} (CIK: {r.get("cik", "N/A")})\n\n')
            if r.get('error'):
                f.write(f'**Error:** {r["error"]}\n\n')
                continue

            f.write(f'- Filing docs: {r.get("total_docs", "?")} total, {len(r.get("filing_documents", []))} htm files\n')
            f.write(f'- Primary doc words: {r.get("text_words", "?")}\n')
            f.write(f'- iXBRL: {r.get("has_ixbrl", False)}\n')
            f.write(f'- Original regex matched: {r.get("original_regex_matches", False)}\n')

            pm = r.get('pattern_matches', {})
            if pm:
                f.write(f'- Pattern matches found:\n')
                for desc, info in pm.items():
                    f.write(f'  - {desc}: {info["count"]} matches\n')
                    for ctx in info.get('context', [])[:1]:
                        f.write(f'    Context: `{ctx[:100]}`\n')
            else:
                f.write(f'- **NO pattern matches at all in primary document**\n')

            if r.get('item1a_in_other_doc'):
                f.write(f'- **FOUND in other document: {r["item1a_in_other_doc"]}** ({r.get("other_doc_words",0)} words)\n')

            headers = r.get('item_headers_found', [])
            if headers:
                f.write(f'- Item headers in primary doc: {", ".join(headers[:10])}\n')

            f.write('\n')

        # Summary of failure modes
        f.write('## Failure Mode Summary\n\n')
        no_match = sum(1 for r in results if not r.get('original_regex_matches') and not r.get('error'))
        in_other = sum(1 for r in results if r.get('item1a_in_other_doc'))
        has_bare = sum(1 for r in results if 'Bare: Item 1A' in r.get('pattern_matches', {}) or 'Bare: ITEM 1A' in r.get('pattern_matches', {}))
        has_rf = sum(1 for r in results if 'Just: Risk Factors' in r.get('pattern_matches', {}) or 'Just: RISK FACTORS' in r.get('pattern_matches', {}))

        f.write(f'- Original regex fails: {no_match}/{len(results)}\n')
        f.write(f'- Item 1A in a separate document: {in_other}/{len(results)}\n')
        f.write(f'- "Item 1A" bare match (without "Risk Factors"): {has_bare}/{len(results)}\n')
        f.write(f'- "Risk Factors" found separately: {has_rf}/{len(results)}\n')

    print('\nDiagnosis written to diagnosis.md and diagnosis-raw.json')

if __name__ == '__main__':
    main()
