# 10-K Parser Failure Diagnosis

## Root Causes

Examined 10 failed mid-cap cases. The original parser (`retest_fetch_10k.js`) failed because:

### 1. HTML Entities Not Decoded (PRIMARY CAUSE — ~60% of failures)
The `stripHtml()` function only decoded `&nbsp;`, `&amp;`, `&lt;`, `&gt;`. It did NOT decode:
- `&#160;` (non-breaking space) — extremely common between "ITEM 1A." and "RISK FACTORS"
- `&#8212;` (em dash) — used in "Item 1A — Risk Factors"
- `&#8220;`/`&#8221;` (smart quotes) — in cross-references

Example (MSA): `Item 1A&#8212;Risk Factors` → regex `Item\s+1A[\.\s\-–—]*\s*Risk` never matched because `&#8212;` was left as literal text.

### 2. Table Cell Boundaries Separating Header Parts (~25% of failures)
Many mid-cap filings use HTML tables for layout. After stripping tags, "Item 1A." and "Risk Factors" end up on separate lines or with table-remnant whitespace between them.

Example (BILL): `Item 1A. | | | Risk Factors | | | 15` — the regex required "Item 1A" and "Risk Factors" to be adjacent.

### 3. TOC False Positive Consuming the Match (~15% of failures)
The original parser found "Item 1A...Risk Factors" in the Table of Contents first, attempted to extract from there (short line ending in a page number), and got < 500 characters so returned null. The actual section content was later in the document.

## Fix Applied

New parser (`extract_item1a.py`) fixes:
1. Uses Python's `html.unescape()` to decode ALL HTML entities
2. Allows variable separators (including `|` from table boundaries) between "Item 1A" and "Risk Factors"
3. Detects and skips TOC entries based on line length, page numbers, and document position
4. Falls back to loose "Item 1A" + "Risk Factors within 200 chars" matching
5. Validates section has substantive content (≥3 sentences after header)
6. Tries alternate .htm files in the filing if primary document fails

## Test Results

```
Regression (previously OK):   7/10 successful
Mid-cap (previously failed): 17/20 successful (85%, above 70% gate)
```

Remaining failures are edge cases: companies with only 1 filing (can't get prior year), and very old 10-K/A amendments with unusual HTML structure.
