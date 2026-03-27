// Discovery Crawler — Phase 2 Data Source Router
// Fetches supplementary SEC data to enrich risk factor analysis.
// Fully independent of mid-cap data pipeline.

import {
  fetchWithRetry,
  ensureCikCache,
  getCikForTicker,
  getCikPadded,
  stripHtml,
  sleep,
} from '../warehouse/connectors/shared.js';

const USER_AGENT = 'Bolin & Troy LLC charles@bolinandtroy.com';
const RATE_LIMIT_MS = 200;

function edgarHeaders() {
  return {
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'gzip, deflate',
    'Accept': 'application/json,text/html,*/*',
  };
}

async function edgarFetch(url) {
  await sleep(RATE_LIMIT_MS);
  return fetchWithRetry(url, { headers: edgarHeaders() }, { minIntervalMs: RATE_LIMIT_MS });
}

// ============================================================
// 1. SEC_FILING — Search EDGAR EFTS for recent 8-K filings
// ============================================================

async function fetchSecFiling(query, ticker, cik, entryDate) {
  const endDate = entryDate;
  // Look back 12 months from entry date
  const start = new Date(entryDate);
  start.setFullYear(start.getFullYear() - 1);
  const startDate = start.toISOString().split('T')[0];

  const searchQuery = encodeURIComponent(query || ticker);
  const url = `https://efts.sec.gov/LATEST/search-index?q=${searchQuery}&dateRange=custom&startdt=${startDate}&enddt=${endDate}&forms=8-K`;

  try {
    const res = await edgarFetch(url);
    if (!res.ok) {
      // Try the full-text search endpoint instead
      const altUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${searchQuery}%22&forms=8-K&dateRange=custom&startdt=${startDate}&enddt=${endDate}`;
      const altRes = await edgarFetch(altUrl);
      if (!altRes.ok) {
        return {
          request_type: 'SEC_FILING',
          data_found: false,
          summary: `EDGAR EFTS search failed (status ${res.status})`,
          raw_data_size: '0',
        };
      }
      const altData = await altRes.json();
      return summarize8KResults(altData);
    }
    const data = await res.json();
    return summarize8KResults(data);
  } catch (err) {
    return {
      request_type: 'SEC_FILING',
      data_found: false,
      summary: `EDGAR EFTS search error: ${err.message}`,
      raw_data_size: '0',
    };
  }
}

function summarize8KResults(data) {
  const hits = data.hits?.hits || data.hits || [];
  const total = data.hits?.total?.value || data.total || hits.length || 0;

  if (total === 0) {
    return {
      request_type: 'SEC_FILING',
      data_found: false,
      summary: 'No 8-K filings found in the search period.',
      raw_data_size: '0',
    };
  }

  // Summarize the 8-K events
  const events = [];
  const items = Array.isArray(hits) ? hits.slice(0, 10) : [];
  for (const hit of items) {
    const source = hit._source || hit;
    const date = source.file_date || source.filing_date || source.date_filed || 'unknown';
    const desc = source.display_names?.join(', ') || source.form_type || '8-K';
    events.push(`${date}: ${desc}`);
  }

  return {
    request_type: 'SEC_FILING',
    data_found: true,
    summary: `Found ${total} 8-K filings. Recent events: ${events.join('; ') || 'details unavailable'}`,
    raw_data_size: JSON.stringify(data).length.toString(),
  };
}

// ============================================================
// 2. INSIDER_TRADING — Get Form 4 filings from EDGAR
// ============================================================

async function fetchInsiderTrading(query, ticker, cik, entryDate) {
  const paddedCik = cik ? String(cik).padStart(10, '0') : getCikPadded(ticker);
  if (!paddedCik) {
    return {
      request_type: 'INSIDER_TRADING',
      data_found: false,
      summary: `Could not find CIK for ${ticker}`,
      raw_data_size: '0',
    };
  }

  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  try {
    const res = await edgarFetch(url);
    if (!res.ok) {
      return {
        request_type: 'INSIDER_TRADING',
        data_found: false,
        summary: `EDGAR submissions endpoint returned ${res.status}`,
        raw_data_size: '0',
      };
    }

    const data = await res.json();
    const recent = data.filings?.recent;
    if (!recent) {
      return {
        request_type: 'INSIDER_TRADING',
        data_found: false,
        summary: 'No recent filings data available',
        raw_data_size: '0',
      };
    }

    // Filter Form 4 filings in trailing 12 months before entry date
    const cutoff = new Date(entryDate);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    let buyCount = 0;
    let sellCount = 0;
    let form4Count = 0;

    for (let i = 0; i < (recent.form || []).length; i++) {
      if (recent.form[i] !== '4') continue;
      const filingDate = recent.filingDate?.[i];
      if (!filingDate || filingDate > entryDate || filingDate < cutoffStr) continue;

      form4Count++;
      // Use primary doc description to guess direction
      const desc = (recent.primaryDocDescription?.[i] || '').toLowerCase();
      if (desc.includes('purchase') || desc.includes('acquisition')) {
        buyCount++;
      } else if (desc.includes('sale') || desc.includes('disposition')) {
        sellCount++;
      }
    }

    // Determine net direction heuristic
    let netDirection = 'neutral';
    if (buyCount > sellCount * 2) netDirection = 'net buying';
    else if (sellCount > buyCount * 2) netDirection = 'net selling';
    else if (form4Count > 0) netDirection = 'mixed';

    return {
      request_type: 'INSIDER_TRADING',
      data_found: form4Count > 0,
      summary: form4Count > 0
        ? `${form4Count} Form 4 filings in trailing 12 months. Buy signals: ${buyCount}, Sell signals: ${sellCount}. Net direction: ${netDirection}.`
        : 'No Form 4 filings found in trailing 12 months.',
      raw_data_size: JSON.stringify(data).length.toString(),
    };
  } catch (err) {
    return {
      request_type: 'INSIDER_TRADING',
      data_found: false,
      summary: `Insider trading fetch error: ${err.message}`,
      raw_data_size: '0',
    };
  }
}

// ============================================================
// 3. MANAGEMENT — Get DEF 14A proxy statement
// ============================================================

async function fetchManagement(query, ticker, cik, entryDate) {
  const paddedCik = cik ? String(cik).padStart(10, '0') : getCikPadded(ticker);
  if (!paddedCik) {
    return {
      request_type: 'MANAGEMENT',
      data_found: false,
      summary: `Could not find CIK for ${ticker}`,
      raw_data_size: '0',
    };
  }

  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  try {
    const res = await edgarFetch(url);
    if (!res.ok) {
      return {
        request_type: 'MANAGEMENT',
        data_found: false,
        summary: `EDGAR submissions endpoint returned ${res.status}`,
        raw_data_size: '0',
      };
    }

    const data = await res.json();
    const recent = data.filings?.recent;
    if (!recent) {
      return {
        request_type: 'MANAGEMENT',
        data_found: false,
        summary: 'No recent filings data available',
        raw_data_size: '0',
      };
    }

    // Find most recent DEF 14A before entry date
    let proxyDate = null;
    let proxyAccession = null;
    let proxyDoc = null;

    for (let i = 0; i < (recent.form || []).length; i++) {
      if (recent.form[i] !== 'DEF 14A') continue;
      const filingDate = recent.filingDate?.[i];
      if (!filingDate || filingDate > entryDate) continue;

      if (!proxyDate || filingDate > proxyDate) {
        proxyDate = filingDate;
        proxyAccession = recent.accessionNumber?.[i];
        proxyDoc = recent.primaryDocument?.[i];
      }
    }

    if (!proxyDate) {
      return {
        request_type: 'MANAGEMENT',
        data_found: false,
        summary: 'No DEF 14A proxy statement found before entry date.',
        raw_data_size: '0',
      };
    }

    // Try to fetch the proxy document for executive compensation info
    let compensationSummary = `Most recent DEF 14A filed ${proxyDate}.`;
    if (proxyAccession && proxyDoc) {
      const accessionClean = proxyAccession.replace(/-/g, '');
      const cikNumeric = String(parseInt(paddedCik, 10));
      const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accessionClean}/${proxyDoc}`;

      try {
        const docRes = await edgarFetch(docUrl);
        if (docRes.ok) {
          const html = await docRes.text();
          const text = stripHtml(html);
          const rawSize = text.length;

          // Search for executive compensation section
          const compPatterns = [
            /executive\s+compensation/i,
            /compensation\s+discussion/i,
            /named\s+executive\s+officers/i,
            /summary\s+compensation\s+table/i,
          ];

          let foundSection = false;
          for (const pattern of compPatterns) {
            const match = text.match(pattern);
            if (match) {
              foundSection = true;
              const start = Math.max(0, match.index - 100);
              const end = Math.min(text.length, match.index + 2000);
              const excerpt = text.substring(start, end).trim();

              // Check for executive changes
              const changePatterns = /(?:new|appointed|resigned|departed|retired|terminated|succession|transition)/i;
              const hasChanges = changePatterns.test(excerpt);

              compensationSummary = `DEF 14A filed ${proxyDate}. ` +
                (hasChanges ? 'Executive changes detected in compensation section. ' : 'No obvious executive changes in compensation section. ') +
                `Excerpt: "${excerpt.substring(0, 500)}..."`;
              break;
            }
          }

          if (!foundSection) {
            compensationSummary = `DEF 14A filed ${proxyDate}. Could not locate executive compensation section in ${rawSize} chars of text.`;
          }
        }
      } catch (docErr) {
        compensationSummary += ` (Could not fetch document: ${docErr.message})`;
      }
    }

    return {
      request_type: 'MANAGEMENT',
      data_found: true,
      summary: compensationSummary,
      raw_data_size: '0',
    };
  } catch (err) {
    return {
      request_type: 'MANAGEMENT',
      data_found: false,
      summary: `Management data fetch error: ${err.message}`,
      raw_data_size: '0',
    };
  }
}

// ============================================================
// 4. CUSTOMER_CONCENTRATION — Search 10-K full text
// ============================================================

async function fetchCustomerConcentration(query, ticker, cik, entryDate, tenKText) {
  if (!tenKText) {
    return {
      request_type: 'CUSTOMER_CONCENTRATION',
      data_found: false,
      summary: 'No 10-K text available for analysis.',
      raw_data_size: '0',
    };
  }

  const patterns = [
    /significant\s+customer/gi,
    /concentration/gi,
    /major\s+customer/gi,
    /largest\s+customer/gi,
    /principal\s+customer/gi,
    /single\s+customer/gi,
    /customer\s+accounted?\s+for/gi,
    /revenue\s+concentration/gi,
  ];

  const excerpts = [];
  const textLower = tenKText.toLowerCase();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(tenKText)) !== null) {
      const start = Math.max(0, match.index - 200);
      const end = Math.min(tenKText.length, match.index + 500);
      const excerpt = tenKText.substring(start, end).trim();

      // Avoid duplicate excerpts from overlapping matches
      const isDuplicate = excerpts.some(e =>
        e.includes(excerpt.substring(0, 100)) || excerpt.includes(e.substring(0, 100))
      );
      if (!isDuplicate) {
        excerpts.push(excerpt);
      }

      if (excerpts.length >= 5) break;
    }
    if (excerpts.length >= 5) break;
  }

  if (excerpts.length === 0) {
    return {
      request_type: 'CUSTOMER_CONCENTRATION',
      data_found: false,
      summary: 'No customer concentration language found in 10-K text.',
      raw_data_size: tenKText.length.toString(),
    };
  }

  return {
    request_type: 'CUSTOMER_CONCENTRATION',
    data_found: true,
    summary: `Found ${excerpts.length} customer concentration references. Key excerpts: ${excerpts.map((e, i) => `[${i + 1}] "${e.substring(0, 300)}..."`).join(' ')}`,
    raw_data_size: tenKText.length.toString(),
  };
}

// ============================================================
// ROUTER — dispatch requests to appropriate handlers
// ============================================================

const HANDLERS = {
  SEC_FILING: fetchSecFiling,
  INSIDER_TRADING: fetchInsiderTrading,
  MANAGEMENT: fetchManagement,
  CUSTOMER_CONCENTRATION: fetchCustomerConcentration,
};

/**
 * Fetch all information requests from Phase 1.
 *
 * @param {Array} requests - Array of {type, query, reason, expected_impact}
 * @param {string} ticker - Company ticker
 * @param {string} cik - Company CIK (numeric or padded)
 * @param {string} entryDate - Entry date (YYYY-MM-DD)
 * @param {string} [tenKText] - Full 10-K text for CUSTOMER_CONCENTRATION
 * @returns {Array} Results array with {request_type, data_found, summary, raw_data_size}
 */
export async function fetchAllRequests(requests, ticker, cik, entryDate, tenKText = '') {
  await ensureCikCache();

  const results = [];

  for (const req of requests) {
    const handler = HANDLERS[req.type];
    if (!handler) {
      results.push({
        request_type: req.type,
        data_found: false,
        summary: `Unknown request type: ${req.type}`,
        raw_data_size: '0',
      });
      continue;
    }

    console.log(`  [data-router] Fetching ${req.type} for ${ticker}: "${req.query}"`);

    try {
      let result;
      if (req.type === 'CUSTOMER_CONCENTRATION') {
        result = await handler(req.query, ticker, cik, entryDate, tenKText);
      } else {
        result = await handler(req.query, ticker, cik, entryDate);
      }
      results.push(result);
    } catch (err) {
      console.error(`  [data-router] Error fetching ${req.type}: ${err.message}`);
      results.push({
        request_type: req.type,
        data_found: false,
        summary: `Fetch error: ${err.message}`,
        raw_data_size: '0',
      });
    }
  }

  return results;
}
