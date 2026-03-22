// Sector Signal Engine — Growth Pipeline Default Mode
//
// Evidence: Tests 3 + sector ETF test showed sector ETFs beat VOO 83% of the time
// vs 59% for individual stock picks. The sector signal ("growth is happening in
// cybersecurity/cloud/SaaS") is more reliable than the stock signal.
//
// Sector threshold sweep: ≥2 candidates optimal (83% beat rate, 2.6 sectors, +21.8pp alpha).

// Vanguard sector ETF definitions
const ETF_INFO = {
  VGT: { etf: 'VGT', name: 'Vanguard Information Technology', expense: 0.0010 },
  VHT: { etf: 'VHT', name: 'Vanguard Health Care', expense: 0.0010 },
  VIS: { etf: 'VIS', name: 'Vanguard Industrials', expense: 0.0010 },
  VCR: { etf: 'VCR', name: 'Vanguard Consumer Discretionary', expense: 0.0010 },
  VDC: { etf: 'VDC', name: 'Vanguard Consumer Staples', expense: 0.0010 },
  VFH: { etf: 'VFH', name: 'Vanguard Financials', expense: 0.0010 },
  VOX: { etf: 'VOX', name: 'Vanguard Communication Services', expense: 0.0010 },
  VDE: { etf: 'VDE', name: 'Vanguard Energy', expense: 0.0010 },
  VAW: { etf: 'VAW', name: 'Vanguard Materials', expense: 0.0010 },
  VNQ: { etf: 'VNQ', name: 'Vanguard Real Estate', expense: 0.0012 },
  VPU: { etf: 'VPU', name: 'Vanguard Utilities', expense: 0.0010 },
  VUG: { etf: 'VUG', name: 'Vanguard Growth', expense: 0.0004 },
};

// Maps every known Finnhub sector/industry label to a Vanguard sector ETF.
// Built from actual stocks table data — covers all labels the system encounters.
const SECTOR_ETF_MAP = {
  // Technology → VGT
  'Technology':                       'VGT',
  'Semiconductors':                   'VGT',
  'Software':                         'VGT',
  'Software—Application':             'VGT',
  'Software—Infrastructure':          'VGT',
  'Information Technology Services':  'VGT',
  'IT Services':                      'VGT',
  'Electronic Components':            'VGT',
  'Computer Hardware':                'VGT',
  'Scientific & Technical Instruments': 'VGT',
  'Communication Equipment':          'VGT',
  'Semiconductor Equipment & Materials': 'VGT',

  // Healthcare → VHT
  'Healthcare':                       'VHT',
  'Health Care':                      'VHT',
  'Biotechnology':                    'VHT',
  'Medical Devices':                  'VHT',
  'Medical Instruments & Supplies':   'VHT',
  'Drug Manufacturers':               'VHT',
  'Drug Manufacturers—General':       'VHT',
  'Drug Manufacturers—Specialty & Generic': 'VHT',
  'Diagnostics & Research':           'VHT',
  'Health Information Services':      'VHT',
  'Healthcare Plans':                 'VHT',
  'Medical Care Facilities':          'VHT',
  'Pharmaceutical Retailers':         'VHT',

  // Industrials → VIS
  'Industrials':                      'VIS',
  'Electrical Equipment':             'VIS',
  'Aerospace & Defense':              'VIS',
  'Industrial Distribution':          'VIS',
  'Specialty Industrial Machinery':   'VIS',
  'Farm & Heavy Construction Machinery': 'VIS',
  'Building Products & Equipment':    'VIS',
  'Waste Management':                 'VIS',
  'Railroads':                        'VIS',
  'Trucking':                         'VIS',
  'Airlines':                         'VIS',
  'Construction':                     'VIS',
  'Engineering & Construction':       'VIS',
  'Trading Companies & Distributors': 'VIS',
  'Commercial Services & Supplies':   'VIS',
  'Professional Services':            'VIS',
  'Staffing & Employment Services':   'VIS',
  'Consulting Services':              'VIS',
  'Security & Protection Services':   'VIS',

  // Consumer Discretionary → VCR
  'Consumer Discretionary':           'VCR',
  'Consumer Cyclical':                'VCR',
  'Hotels, Restaurants & Leisure':    'VCR',
  'Restaurants':                      'VCR',
  'Lodging':                          'VCR',
  'Leisure':                          'VCR',
  'Auto Manufacturers':               'VCR',
  'Auto Parts':                       'VCR',
  'Apparel Manufacturing':            'VCR',
  'Apparel Retail':                   'VCR',
  'Footwear & Accessories':           'VCR',
  'Home Improvement Retail':          'VCR',
  'Specialty Retail':                 'VCR',
  'Internet Retail':                  'VCR',
  'Department Stores':                'VCR',
  'Gambling':                         'VCR',
  'Resorts & Casinos':                'VCR',
  'Residential Construction':         'VCR',
  'Furnishings, Fixtures & Appliances': 'VCR',
  'Packaging & Containers':           'VCR',

  // Consumer Staples → VDC
  'Consumer Staples':                 'VDC',
  'Consumer Defensive':               'VDC',
  'Consumer products':                'VDC',
  'Food Products':                    'VDC',
  'Packaged Foods':                   'VDC',
  'Beverages—Non-Alcoholic':          'VDC',
  'Beverages—Brewers':                'VDC',
  'Household & Personal Products':    'VDC',
  'Tobacco':                          'VDC',
  'Discount Stores':                  'VDC',
  'Grocery Stores':                   'VDC',

  // Financials → VFH
  'Financials':                       'VFH',
  'Financial Services':               'VFH',
  'Banking':                          'VFH',
  'Banks—Regional':                   'VFH',
  'Banks—Diversified':                'VFH',
  'Insurance':                        'VFH',
  'Insurance—Diversified':            'VFH',
  'Insurance—Property & Casualty':    'VFH',
  'Insurance—Life':                   'VFH',
  'Capital Markets':                  'VFH',
  'Asset Management':                 'VFH',
  'Financial Data & Stock Exchanges': 'VFH',
  'Credit Services':                  'VFH',
  'Mortgage Finance':                 'VFH',

  // Communication Services → VOX
  'Communication Services':           'VOX',
  'Communications':                   'VOX',
  'Media':                            'VOX',
  'Entertainment':                    'VOX',
  'Internet Content & Information':   'VOX',
  'Electronic Gaming & Multimedia':   'VOX',
  'Advertising Agencies':             'VOX',
  'Broadcasting':                     'VOX',
  'Publishing':                       'VOX',
  'Telecom Services':                 'VOX',

  // Energy → VDE
  'Energy':                           'VDE',
  'Oil & Gas':                        'VDE',
  'Oil & Gas E&P':                    'VDE',
  'Oil & Gas Integrated':             'VDE',
  'Oil & Gas Midstream':              'VDE',
  'Oil & Gas Refining & Marketing':   'VDE',
  'Oil & Gas Equipment & Services':   'VDE',
  'Uranium':                          'VDE',
  'Solar':                            'VDE',

  // Materials → VAW
  'Materials':                        'VAW',
  'Basic Materials':                  'VAW',
  'Specialty Chemicals':              'VAW',
  'Steel':                            'VAW',
  'Copper':                           'VAW',
  'Gold':                             'VAW',
  'Aluminum':                         'VAW',
  'Lumber & Wood Production':         'VAW',
  'Paper & Paper Products':           'VAW',

  // Real Estate → VNQ
  'Real Estate':                      'VNQ',
  'REIT—Diversified':                 'VNQ',
  'REIT—Residential':                 'VNQ',
  'REIT—Retail':                      'VNQ',
  'REIT—Office':                      'VNQ',
  'REIT—Industrial':                  'VNQ',
  'Real Estate Services':             'VNQ',
  'Real Estate—Development':          'VNQ',

  // Utilities → VPU
  'Utilities':                        'VPU',
  'Utilities—Regulated Electric':     'VPU',
  'Utilities—Diversified':            'VPU',
  'Utilities—Renewable':              'VPU',
};

const FALLBACK_ETF_KEY = 'VUG';
const MIN_CANDIDATES_FOR_SIGNAL = 2; // Calibration-validated threshold

/**
 * Map a sector/industry to its Vanguard ETF.
 * Checks sector first, then industry, then keyword matching, then fallback.
 */
export function getSectorETF(sector, industry) {
  // Direct sector match
  if (sector && SECTOR_ETF_MAP[sector]) {
    const key = SECTOR_ETF_MAP[sector];
    return ETF_INFO[key];
  }

  // Direct industry match
  if (industry && SECTOR_ETF_MAP[industry]) {
    const key = SECTOR_ETF_MAP[industry];
    return ETF_INFO[key];
  }

  // Keyword matching on sector
  if (sector) {
    const s = sector.toLowerCase();
    if (s.includes('tech') || s.includes('software') || s.includes('semi') || s.includes('electronic')) return ETF_INFO.VGT;
    if (s.includes('health') || s.includes('biotech') || s.includes('pharma') || s.includes('medical')) return ETF_INFO.VHT;
    if (s.includes('industrial') || s.includes('defense') || s.includes('aerospace') || s.includes('professional') || s.includes('commercial')) return ETF_INFO.VIS;
    if (s.includes('consumer') && (s.includes('discret') || s.includes('cycl'))) return ETF_INFO.VCR;
    if (s.includes('consumer') && (s.includes('stapl') || s.includes('defen') || s.includes('product'))) return ETF_INFO.VDC;
    if (s.includes('financ') || s.includes('bank') || s.includes('insurance') || s.includes('capital')) return ETF_INFO.VFH;
    if (s.includes('commun') || s.includes('media') || s.includes('entertain')) return ETF_INFO.VOX;
    if (s.includes('energy') || s.includes('oil') || s.includes('solar') || s.includes('uranium')) return ETF_INFO.VDE;
    if (s.includes('material') || s.includes('chemical') || s.includes('steel') || s.includes('mining')) return ETF_INFO.VAW;
    if (s.includes('real estate') || s.includes('reit')) return ETF_INFO.VNQ;
    if (s.includes('utilit')) return ETF_INFO.VPU;
    if (s.includes('hotel') || s.includes('restaurant') || s.includes('leisure') || s.includes('travel')) return ETF_INFO.VCR;
    if (s.includes('food') || s.includes('beverage') || s.includes('grocery') || s.includes('household')) return ETF_INFO.VDC;
    if (s.includes('construct') || s.includes('engineer') || s.includes('trading')) return ETF_INFO.VIS;
  }

  // Keyword matching on industry (same logic)
  if (industry) {
    const i = industry.toLowerCase();
    if (i.includes('tech') || i.includes('software') || i.includes('semi') || i.includes('cloud') || i.includes('cyber')) return ETF_INFO.VGT;
    if (i.includes('health') || i.includes('biotech') || i.includes('pharma') || i.includes('medical')) return ETF_INFO.VHT;
    if (i.includes('industrial') || i.includes('defense') || i.includes('aerospace')) return ETF_INFO.VIS;
    if (i.includes('bank') || i.includes('financ') || i.includes('insurance') || i.includes('credit')) return ETF_INFO.VFH;
    if (i.includes('media') || i.includes('entertain') || i.includes('gaming')) return ETF_INFO.VOX;
    if (i.includes('energy') || i.includes('oil') || i.includes('solar')) return ETF_INFO.VDE;
  }

  return ETF_INFO[FALLBACK_ETF_KEY];
}

/**
 * Generate sector-level signals from Growth pre-screen candidates.
 * @param {Array} passingCandidates - candidates that passed the Growth pre-screen
 * @returns {Array} sector signals sorted by candidate count
 */
export function generateSectorSignals(passingCandidates) {
  const sectorCounts = {};
  const sectorCandidates = {};

  for (const c of passingCandidates) {
    const sector = c.sector || 'Unknown';
    const etfInfo = getSectorETF(sector, c.industry);
    const etfTicker = etfInfo.etf;

    if (!sectorCounts[etfTicker]) {
      sectorCounts[etfTicker] = 0;
      sectorCandidates[etfTicker] = { etf: etfTicker, name: etfInfo.name, sector, candidates: [] };
    }
    sectorCounts[etfTicker]++;
    sectorCandidates[etfTicker].candidates.push({
      ticker: c.ticker,
      company_name: c.company_name,
      sector: c.sector,
      industry: c.industry,
    });
  }

  return Object.values(sectorCandidates)
    .filter(s => s.candidates.length >= MIN_CANDIDATES_FOR_SIGNAL)
    .map(s => ({
      etf: s.etf,
      etf_name: s.name,
      sector: s.sector,
      candidate_count: s.candidates.length,
      candidates: s.candidates,
    }))
    .sort((a, b) => b.candidate_count - a.candidate_count);
}

/**
 * Allocate the Growth budget across sector ETFs weighted by candidate count.
 * @param {Array} sectorSignals - from generateSectorSignals
 * @param {number} growthBudget - total dollars allocated to Growth pipeline
 * @returns {Array} allocation recommendations
 */
export function allocateSectorBudget(sectorSignals, growthBudget) {
  if (sectorSignals.length === 0) return [];

  const totalCandidates = sectorSignals.reduce((s, sig) => s + sig.candidate_count, 0);

  return sectorSignals.map(sig => {
    const weight = sig.candidate_count / totalCandidates;
    const allocation = Math.round(growthBudget * weight);
    return {
      ...sig,
      weight: Math.round(weight * 100),
      allocation,
    };
  });
}

/**
 * Store sector signals in the database.
 */
export async function storeSectorSignals(db, signals) {
  // Ensure table exists
  await db.prepare(`CREATE TABLE IF NOT EXISTS sector_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector TEXT NOT NULL,
    etf_ticker TEXT NOT NULL,
    etf_name TEXT,
    candidate_count INTEGER NOT NULL,
    allocation REAL,
    weight REAL,
    signal_date TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    candidates_json TEXT
  )`).run();

  // Expire old signals
  await db.prepare("UPDATE sector_signals SET status = 'expired' WHERE status = 'active'").run();

  // Insert new signals
  const now = new Date().toISOString();
  for (const sig of signals) {
    await db.prepare(
      `INSERT INTO sector_signals (sector, etf_ticker, etf_name, candidate_count, allocation, weight, signal_date, status, candidates_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).bind(
      sig.sector, sig.etf, sig.etf_name, sig.candidate_count,
      sig.allocation || null, sig.weight || null, now,
      JSON.stringify(sig.candidates || [])
    ).run();
  }

  return signals.length;
}

/**
 * Get active sector signals.
 */
export async function getActiveSectorSignals(db) {
  try {
    const result = await db.prepare(
      "SELECT * FROM sector_signals WHERE status = 'active' ORDER BY candidate_count DESC"
    ).all();
    return result.results || [];
  } catch {
    return []; // Table may not exist yet
  }
}

export { SECTOR_ETF_MAP, MIN_CANDIDATES_FOR_SIGNAL };
