// USPTO PatentsView Connector
// API: https://api.patentsview.org/patents/query (free, no key needed)

import { fetchRateLimited, getCompanyName, ensureCikCache, sleep } from './shared.js';
import warehouse from '../warehouse.js';

// ============================================================
// PATENT SEARCH
// ============================================================

/**
 * Search for patents by assignee organization name.
 * Uses the PatentsView API v1.
 * @param {string} assigneeName - Company legal name
 * @param {string} beforeDate - Before this date
 * @param {string} afterDate - After this date
 */
export async function searchPatents(assigneeName, beforeDate, afterDate) {
  // PatentsView API query format
  const query = {
    _and: [
      { _contains: { assignee_organization: assigneeName } },
      { _gte: { patent_date: afterDate } },
      { _lte: { patent_date: beforeDate } },
    ],
  };

  const fields = [
    'patent_number',
    'patent_title',
    'patent_abstract',
    'patent_date',
    'patent_type',
    'patent_num_claims',
  ];

  // PatentsView has a 10k result limit per request
  let allPatents = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = 'https://api.patentsview.org/patents/query';
    const body = JSON.stringify({
      q: query,
      f: fields,
      o: { page, per_page: perPage },
      s: [{ patent_date: 'desc' }],
    });

    let res;
    try {
      res = await fetchRateLimited(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AV-Framework-Research cm@example.com',
        },
        body,
      }, 5);
    } catch (err) {
      console.log(`    PatentsView API error: ${err.message}`);
      break;
    }

    if (!res.ok) {
      // Try the older API format if POST fails
      if (page === 1) {
        return searchPatentsGET(assigneeName, beforeDate, afterDate);
      }
      break;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      break;
    }

    const patents = data.patents || [];
    if (patents.length === 0) break;

    allPatents = allPatents.concat(patents);

    // Stop if we got fewer than requested (last page)
    if (patents.length < perPage) break;
    // Safety limit
    if (allPatents.length >= 5000) break;

    page++;
    await sleep(200);
  }

  return allPatents;
}

/**
 * Fallback: GET-based query for older PatentsView API.
 */
async function searchPatentsGET(assigneeName, beforeDate, afterDate) {
  const query = encodeURIComponent(JSON.stringify({
    _and: [
      { _contains: { assignee_organization: assigneeName } },
      { _gte: { patent_date: afterDate } },
      { _lte: { patent_date: beforeDate } },
    ],
  }));

  const fields = encodeURIComponent(JSON.stringify([
    'patent_number', 'patent_title', 'patent_abstract', 'patent_date', 'patent_type',
  ]));

  const url = `https://api.patentsview.org/patents/query?q=${query}&f=${fields}&o=${encodeURIComponent(JSON.stringify({ page: 1, per_page: 1000 }))}`;

  try {
    const res = await fetchRateLimited(url, {
      headers: { 'User-Agent': 'AV-Framework-Research cm@example.com' },
    }, 5);

    if (!res.ok) return [];
    const data = await res.json();
    return data.patents || [];
  } catch {
    return [];
  }
}

// ============================================================
// CPC CLASSIFICATION
// ============================================================

/**
 * Aggregate CPC codes from patent list into distribution.
 */
function computeCPCDistribution(patents) {
  const dist = {};
  for (const p of patents) {
    // PatentsView returns CPC codes in patent_cpc_codes or similar
    // Extract from abstract/title keywords as fallback
    const cpcCodes = p.cpc_codes || p.patent_cpc_codes || [];
    if (Array.isArray(cpcCodes)) {
      for (const code of cpcCodes) {
        const section = typeof code === 'string' ? code.slice(0, 4) : (code.cpc_group_id || '').slice(0, 4);
        if (section) dist[section] = (dist[section] || 0) + 1;
      }
    }
  }
  return dist;
}

// ============================================================
// HIGH-LEVEL API
// ============================================================

/**
 * Fetch and store patent data for a company.
 * @param {string} ticker
 * @param {string} beforeDate - Entry date
 * @param {object} opts - { trailingYears }
 */
export async function fetchPatentData(ticker, beforeDate, { trailingYears = 3 } = {}) {
  await ensureCikCache();

  // Get company name for patent search
  const companyName = getCompanyName(ticker);
  if (!companyName) {
    return { status: 'no_company_name', patent_count: 0 };
  }

  // Clean company name for search (remove common suffixes)
  const cleanName = companyName
    .replace(/,?\s*(?:Inc\.?|Corp\.?|Co\.?|Ltd\.?|LLC|LP|PLC|NV|SA|SE|AG)$/i, '')
    .trim();

  if (cleanName.length < 3) {
    return { status: 'name_too_short', patent_count: 0 };
  }

  const after = new Date(beforeDate);
  after.setFullYear(after.getFullYear() - trailingYears);
  const afterDate = after.toISOString().split('T')[0];

  const patents = await searchPatents(cleanName, beforeDate, afterDate);

  // Also try with full name if clean name didn't find anything
  let allPatents = patents;
  if (patents.length === 0 && cleanName !== companyName) {
    allPatents = await searchPatents(companyName, beforeDate, afterDate);
  }

  // Build patent records
  const patentRecords = allPatents.map(p => ({
    patent_number: p.patent_number,
    title: p.patent_title,
    abstract: p.patent_abstract || '',
    filing_date: p.patent_date, // PatentsView uses patent_date for grant date
    grant_date: p.patent_date,
    patent_type: p.patent_type || 'utility',
  }));

  // Compute CPC distribution
  const cpcDist = computeCPCDistribution(allPatents);

  // Compute year-over-year if we have enough data
  const yearCounts = {};
  for (const p of patentRecords) {
    if (p.grant_date) {
      const year = p.grant_date.slice(0, 4);
      yearCounts[year] = (yearCounts[year] || 0) + 1;
    }
  }

  const years = Object.keys(yearCounts).sort();
  let yoyChange = null;
  if (years.length >= 2) {
    const lastYear = yearCounts[years[years.length - 1]] || 0;
    const prevYear = yearCounts[years[years.length - 2]] || 0;
    if (prevYear > 0) yoyChange = (lastYear - prevYear) / prevYear;
  }

  // Store in warehouse
  const endYear = beforeDate.slice(0, 4);
  const publicationDate = `${endYear}-12-31` < beforeDate ? `${endYear}-12-31` : beforeDate;

  if (patentRecords.length > 0) {
    const record = warehouse.createRecord({
      company: ticker,
      data_type: 'patents',
      source: 'uspto_patentsview',
      source_url: 'https://api.patentsview.org/patents/query',
      publication_date: publicationDate,
      content: {
        patent_count: patentRecords.length,
        patents: patentRecords.slice(0, 500), // Cap at 500 to keep storage manageable
        search_name: cleanName,
      },
      metadata: {
        patent_count: patentRecords.length,
        year_range: `${afterDate.slice(0, 4)}-${beforeDate.slice(0, 4)}`,
        cpc_distribution: cpcDist,
        year_counts: yearCounts,
        yoy_change: yoyChange,
      },
    });

    warehouse.storeRecord(record);
  }

  return {
    status: 'ok',
    patent_count: patentRecords.length,
    search_name: cleanName,
    year_counts: yearCounts,
    yoy_change: yoyChange,
    cpc_sections: Object.keys(cpcDist).length,
  };
}

export default {
  searchPatents,
  fetchPatentData,
};
