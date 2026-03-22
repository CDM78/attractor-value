// Sector Signal Engine — Growth Pipeline Default Mode
//
// Evidence: Tests 3 + sector ETF test showed sector ETFs beat VOO 83% of the time
// vs 59% for individual stock picks. The sector signal ("growth is happening in
// cybersecurity/cloud/SaaS") is more reliable than the stock signal.
//
// Sector threshold sweep: ≥2 candidates optimal (83% beat rate, 2.6 sectors, +21.8pp alpha).

const SECTOR_ETF_MAP = {
  'Technology': { etf: 'VGT', name: 'Vanguard Information Technology', expense: 0.0010 },
  'Healthcare': { etf: 'VHT', name: 'Vanguard Health Care', expense: 0.0010 },
  'Industrials': { etf: 'VIS', name: 'Vanguard Industrials', expense: 0.0010 },
  'Consumer Discretionary': { etf: 'VCR', name: 'Vanguard Consumer Discretionary', expense: 0.0010 },
  'Financials': { etf: 'VFH', name: 'Vanguard Financials', expense: 0.0010 },
  'Financial Services': { etf: 'VFH', name: 'Vanguard Financials', expense: 0.0010 },
  'Communication Services': { etf: 'VOX', name: 'Vanguard Communication Services', expense: 0.0010 },
  'Energy': { etf: 'VDE', name: 'Vanguard Energy', expense: 0.0010 },
  'Materials': { etf: 'VAW', name: 'Vanguard Materials', expense: 0.0010 },
};

const FALLBACK_ETF = { etf: 'VUG', name: 'Vanguard Growth', expense: 0.0004 };
const MIN_CANDIDATES_FOR_SIGNAL = 2; // Calibration-validated threshold

/**
 * Map a sector/industry to its Vanguard ETF.
 */
export function getSectorETF(sector, industry) {
  if (SECTOR_ETF_MAP[sector]) return SECTOR_ETF_MAP[sector];
  // Try industry keywords
  const ind = (industry || '').toLowerCase();
  if (ind.includes('software') || ind.includes('semi') || ind.includes('cyber') || ind.includes('cloud'))
    return SECTOR_ETF_MAP['Technology'];
  if (ind.includes('medical') || ind.includes('pharma') || ind.includes('biotech'))
    return SECTOR_ETF_MAP['Healthcare'];
  if (ind.includes('defense') || ind.includes('aerospace'))
    return SECTOR_ETF_MAP['Industrials'];
  return FALLBACK_ETF;
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
