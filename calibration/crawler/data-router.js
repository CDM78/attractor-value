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

/**
 * Parse Form 4 XML to extract transaction details.
 * Transaction codes: P=purchase(BUY), S=sale(SELL), A=grant, D=disposition,
 * F=tax withholding, M=exercise, C=conversion, G=gift, J=other
 */
function parseForm4Xml(xml) {
  const transactions = [];

  // Extract reporting owner
  const ownerMatch = xml.match(/<rptOwnerName>([^<]*)<\/rptOwnerName>/);
  const titleMatch = xml.match(/<officerTitle>([^<]*)<\/officerTitle>/);
  const ownerName = ownerMatch?.[1] || 'Unknown';
  const ownerTitle = titleMatch?.[1] || '';

  // Extract all nonDerivativeTransactions
  const txPattern = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g;
  let match;
  while ((match = txPattern.exec(xml)) !== null) {
    const block = match[1];
    const code = block.match(/<transactionCode>([^<]*)<\/transactionCode>/)?.[1] || '';
    const shares = parseFloat(block.match(/<transactionShares>[\s\S]*?<value>([^<]*)<\/value>/)?.[1] || '0');
    const price = parseFloat(block.match(/<transactionPricePerShare>[\s\S]*?<value>([^<]*)<\/value>/)?.[1] || '0');
    const acqDisp = block.match(/<transactionAcquiredDisposedCode>[\s\S]*?<value>([^<]*)<\/value>/)?.[1] || '';
    const date = block.match(/<transactionDate>[\s\S]*?<value>([^<]*)<\/value>/)?.[1] || '';

    if (code) {
      transactions.push({ code, shares, price, acqDisp, date, ownerName, ownerTitle });
    }
  }

  return transactions;
}

async function fetchInsiderTrading(query, ticker, cik, entryDate) {
  const paddedCik = cik ? String(cik).padStart(10, '0') : getCikPadded(ticker);
  if (!paddedCik) {
    return { request_type: 'INSIDER_TRADING', data_found: false, summary: `Could not find CIK for ${ticker}`, raw_data_size: '0' };
  }

  const cikNumeric = String(parseInt(paddedCik, 10));
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  try {
    const res = await edgarFetch(url);
    if (!res.ok) {
      return { request_type: 'INSIDER_TRADING', data_found: false, summary: `EDGAR returned ${res.status}`, raw_data_size: '0' };
    }

    const data = await res.json();
    const recent = data.filings?.recent;
    if (!recent) {
      return { request_type: 'INSIDER_TRADING', data_found: false, summary: 'No recent filings data', raw_data_size: '0' };
    }

    // Find Form 4 filings in trailing 12 months
    const cutoff = new Date(entryDate);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const form4Filings = [];
    for (let i = 0; i < (recent.form || []).length; i++) {
      if (recent.form[i] !== '4') continue;
      const filingDate = recent.filingDate?.[i];
      if (!filingDate || filingDate > entryDate || filingDate < cutoffStr) continue;

      form4Filings.push({
        accession: recent.accessionNumber[i],
        date: filingDate,
        primaryDoc: recent.primaryDocument[i],
      });

      if (form4Filings.length >= 20) break; // Limit to 20 most recent
    }

    if (form4Filings.length === 0) {
      return { request_type: 'INSIDER_TRADING', data_found: false, summary: 'No Form 4 filings in trailing 12 months.', raw_data_size: '0' };
    }

    // Fetch and parse each Form 4 XML
    let purchases = { count: 0, shares: 0, value: 0, insiders: new Set() };
    let sales = { count: 0, shares: 0, value: 0, insiders: new Set() };
    let grants = 0, exercises = 0, other = 0;
    let parsed = 0;

    for (const filing of form4Filings) {
      const accClean = filing.accession.replace(/-/g, '');
      // Get the raw XML — strip xsl prefix if present
      let xmlDoc = filing.primaryDoc;
      if (xmlDoc.includes('/')) xmlDoc = xmlDoc.split('/').pop();

      const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accClean}/${xmlDoc}`;

      try {
        const xmlRes = await edgarFetch(xmlUrl);
        if (!xmlRes.ok) continue;
        const xmlText = await xmlRes.text();

        // Skip if it's HTML (XSLT-transformed) not XML
        if (xmlText.trim().startsWith('<!DOCTYPE') || xmlText.trim().startsWith('<html')) continue;

        const txns = parseForm4Xml(xmlText);
        for (const tx of txns) {
          const txValue = tx.shares * tx.price;
          const insider = tx.ownerTitle ? `${tx.ownerTitle} - ${tx.ownerName}` : tx.ownerName;

          switch (tx.code) {
            case 'P': // Open market purchase = BUY
              purchases.count++;
              purchases.shares += tx.shares;
              purchases.value += txValue;
              purchases.insiders.add(insider);
              break;
            case 'S': // Open market sale = SELL
            case 'D': // Disposition to issuer = SELL
              sales.count++;
              sales.shares += tx.shares;
              sales.value += txValue;
              sales.insiders.add(insider);
              break;
            case 'F': // Tax withholding = involuntary sell (note but don't weight heavily)
              sales.count++;
              sales.shares += tx.shares;
              sales.value += txValue;
              break;
            case 'A': grants++; break;
            case 'M': case 'C': exercises++; break;
            default: other++; break;
          }
        }
        parsed++;
      } catch { /* skip failed XML fetches */ }
    }

    // Determine net direction
    const netValue = purchases.value - sales.value;
    const buySellRatio = sales.value > 0 ? purchases.value / sales.value : (purchases.value > 0 ? Infinity : 0);

    let netDirection;
    if (purchases.count > 0 && sales.count === 0) netDirection = 'NET_BUYING';
    else if (sales.count > 0 && purchases.count === 0) netDirection = 'NET_SELLING';
    else if (buySellRatio > 1.5) netDirection = 'NET_BUYING';
    else if (buySellRatio < 0.3) netDirection = 'NET_SELLING';
    else netDirection = 'MIXED';

    const fmtVal = v => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`;

    const summaryParts = [`${form4Filings.length} Form 4 filings (${parsed} parsed).`];
    if (purchases.count > 0) summaryParts.push(`${purchases.count} open-market purchases (${fmtVal(purchases.value)}) by ${[...purchases.insiders].slice(0, 3).join(', ')}.`);
    if (sales.count > 0) summaryParts.push(`${sales.count} sales/dispositions (${fmtVal(sales.value)}) by ${[...sales.insiders].slice(0, 3).join(', ')}.`);
    if (grants > 0) summaryParts.push(`${grants} grants/awards.`);
    if (exercises > 0) summaryParts.push(`${exercises} option exercises.`);
    summaryParts.push(`Net direction: ${netDirection}. Net value: ${fmtVal(Math.abs(netValue))} ${netValue >= 0 ? 'buying' : 'selling'}. Buy/sell ratio: ${buySellRatio === Infinity ? '∞' : buySellRatio.toFixed(2)}.`);

    return {
      request_type: 'INSIDER_TRADING',
      data_found: true,
      summary: summaryParts.join(' '),
      raw_data_size: String(parsed),
      insider_data: {
        filings: form4Filings.length,
        parsed,
        purchases: { count: purchases.count, shares: purchases.shares, value: Math.round(purchases.value) },
        sales: { count: sales.count, shares: sales.shares, value: Math.round(sales.value) },
        grants, exercises, other,
        net_direction: netDirection,
        net_value: Math.round(netValue),
        buy_sell_ratio: buySellRatio === Infinity ? 999 : +buySellRatio.toFixed(3),
      },
    };
  } catch (err) {
    return { request_type: 'INSIDER_TRADING', data_found: false, summary: `Insider trading fetch error: ${err.message}`, raw_data_size: '0' };
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
  // If we already have 10-K text, search it locally
  if (tenKText && tenKText.length > 500) {
    return searchTextForConcentration(tenKText);
  }

  // Otherwise, fetch 10-K from EDGAR directly
  const paddedCik = cik ? String(cik).padStart(10, '0') : getCikPadded(ticker);
  if (!paddedCik) {
    return { request_type: 'CUSTOMER_CONCENTRATION', data_found: false, summary: 'No CIK available.', raw_data_size: '0' };
  }

  const cikNumeric = String(parseInt(paddedCik, 10));

  try {
    // Get filing list to find most recent 10-K
    const subUrl = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
    const subRes = await edgarFetch(subUrl);
    if (!subRes.ok) return { request_type: 'CUSTOMER_CONCENTRATION', data_found: false, summary: `EDGAR returned ${subRes.status}`, raw_data_size: '0' };

    const subData = await subRes.json();
    const recent = subData.filings?.recent;
    if (!recent) return { request_type: 'CUSTOMER_CONCENTRATION', data_found: false, summary: 'No filings data.', raw_data_size: '0' };

    // Find most recent 10-K or 10-K/A before entry date
    let tenKAccession = null, tenKDoc = null;
    for (let i = 0; i < (recent.form || []).length; i++) {
      if (recent.form[i] !== '10-K' && recent.form[i] !== '10-K/A') continue;
      const date = recent.filingDate?.[i];
      if (!date || date > entryDate) continue;
      tenKAccession = recent.accessionNumber[i];
      tenKDoc = recent.primaryDocument[i];
      break; // Most recent first
    }

    if (!tenKAccession) {
      return { request_type: 'CUSTOMER_CONCENTRATION', data_found: false, summary: 'No 10-K found before entry date.', raw_data_size: '0' };
    }

    // Fetch the 10-K HTML
    const accClean = tenKAccession.replace(/-/g, '');
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accClean}/${tenKDoc}`;

    const docRes = await edgarFetch(docUrl);
    if (!docRes.ok) return { request_type: 'CUSTOMER_CONCENTRATION', data_found: false, summary: `10-K fetch failed: ${docRes.status}`, raw_data_size: '0' };

    const html = await docRes.text();
    const text = stripHtml(html);

    if (text.length < 1000) {
      return { request_type: 'CUSTOMER_CONCENTRATION', data_found: false, summary: 'Fetched 10-K too short for analysis.', raw_data_size: String(text.length) };
    }

    return searchTextForConcentration(text);
  } catch (err) {
    return { request_type: 'CUSTOMER_CONCENTRATION', data_found: false, summary: `Fetch error: ${err.message}`, raw_data_size: '0' };
  }
}

function searchTextForConcentration(text) {
  const patterns = [
    /significant\s+customer/gi, /major\s+customer/gi, /largest\s+customer/gi,
    /principal\s+customer/gi, /single\s+customer/gi, /customer\s+accounted?\s+for/gi,
    /revenue\s+concentration/gi, /10%\s+of\s+(?:net\s+)?revenue/gi,
    /concentration\s+of\s+credit\s+risk/gi,
  ];

  const excerpts = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const start = Math.max(0, match.index - 200);
      const end = Math.min(text.length, match.index + 500);
      const excerpt = text.substring(start, end).trim();
      const isDuplicate = excerpts.some(e => e.includes(excerpt.substring(0, 100)) || excerpt.includes(e.substring(0, 100)));
      if (!isDuplicate) excerpts.push(excerpt);
      if (excerpts.length >= 5) break;
    }
    if (excerpts.length >= 5) break;
  }

  if (excerpts.length === 0) {
    return { request_type: 'CUSTOMER_CONCENTRATION', data_found: false, summary: 'No customer concentration language found in 10-K.', raw_data_size: String(text.length) };
  }

  return {
    request_type: 'CUSTOMER_CONCENTRATION',
    data_found: true,
    summary: `Found ${excerpts.length} customer concentration references. Key excerpts: ${excerpts.map((e, i) => `[${i + 1}] "${e.substring(0, 300)}..."`).join(' ')}`,
    raw_data_size: String(text.length),
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
