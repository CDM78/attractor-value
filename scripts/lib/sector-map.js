// Sector ETF mapping — extracted from workers/src/services/sectorSignalEngine.js
// Maps Finnhub sector/industry labels to Vanguard sector ETFs.

const SECTOR_ETF_MAP = {
  'Technology': 'VGT', 'Semiconductors': 'VGT', 'Software': 'VGT',
  'Software—Application': 'VGT', 'Software—Infrastructure': 'VGT',
  'Information Technology Services': 'VGT', 'IT Services': 'VGT',
  'Electronic Components': 'VGT', 'Computer Hardware': 'VGT',
  'Scientific & Technical Instruments': 'VGT', 'Communication Equipment': 'VGT',
  'Semiconductor Equipment & Materials': 'VGT',

  'Healthcare': 'VHT', 'Health Care': 'VHT', 'Biotechnology': 'VHT',
  'Medical Devices': 'VHT', 'Medical Instruments & Supplies': 'VHT',
  'Drug Manufacturers': 'VHT', 'Drug Manufacturers—General': 'VHT',
  'Drug Manufacturers—Specialty & Generic': 'VHT', 'Diagnostics & Research': 'VHT',
  'Health Information Services': 'VHT', 'Healthcare Plans': 'VHT',
  'Medical Care Facilities': 'VHT', 'Pharmaceutical Retailers': 'VHT',

  'Industrials': 'VIS', 'Electrical Equipment': 'VIS', 'Aerospace & Defense': 'VIS',
  'Industrial Distribution': 'VIS', 'Specialty Industrial Machinery': 'VIS',
  'Farm & Heavy Construction Machinery': 'VIS', 'Building Products & Equipment': 'VIS',
  'Waste Management': 'VIS', 'Railroads': 'VIS', 'Trucking': 'VIS',
  'Airlines': 'VIS', 'Construction': 'VIS', 'Engineering & Construction': 'VIS',
  'Trading Companies & Distributors': 'VIS', 'Commercial Services & Supplies': 'VIS',
  'Professional Services': 'VIS', 'Staffing & Employment Services': 'VIS',
  'Consulting Services': 'VIS', 'Security & Protection Services': 'VIS',
  'Defense': 'VIS',

  'Consumer Discretionary': 'VCR', 'Consumer Cyclical': 'VCR',
  'Hotels, Restaurants & Leisure': 'VCR', 'Restaurants': 'VCR',
  'Lodging': 'VCR', 'Leisure': 'VCR', 'Auto Manufacturers': 'VCR',
  'Auto Parts': 'VCR', 'Apparel Manufacturing': 'VCR', 'Apparel Retail': 'VCR',
  'Footwear & Accessories': 'VCR', 'Home Improvement Retail': 'VCR',
  'Specialty Retail': 'VCR', 'Internet Retail': 'VCR', 'Department Stores': 'VCR',
  'Gambling': 'VCR', 'Resorts & Casinos': 'VCR', 'Residential Construction': 'VCR',
  'Furnishings, Fixtures & Appliances': 'VCR', 'Packaging & Containers': 'VCR',

  'Consumer Staples': 'VDC', 'Consumer Defensive': 'VDC', 'Consumer products': 'VDC',
  'Food Products': 'VDC', 'Packaged Foods': 'VDC', 'Beverages—Non-Alcoholic': 'VDC',
  'Beverages—Brewers': 'VDC', 'Household & Personal Products': 'VDC',
  'Tobacco': 'VDC', 'Discount Stores': 'VDC', 'Grocery Stores': 'VDC',

  'Financials': 'VFH', 'Financial Services': 'VFH', 'Banking': 'VFH',
  'Banks—Regional': 'VFH', 'Banks—Diversified': 'VFH', 'Insurance': 'VFH',
  'Insurance—Diversified': 'VFH', 'Insurance—Property & Casualty': 'VFH',
  'Insurance—Life': 'VFH', 'Capital Markets': 'VFH', 'Asset Management': 'VFH',
  'Financial Data & Stock Exchanges': 'VFH', 'Credit Services': 'VFH',
  'Mortgage Finance': 'VFH',

  'Communication Services': 'VOX', 'Communications': 'VOX', 'Media': 'VOX',
  'Entertainment': 'VOX', 'Internet Content & Information': 'VOX',
  'Electronic Gaming & Multimedia': 'VOX', 'Advertising Agencies': 'VOX',
  'Broadcasting': 'VOX', 'Publishing': 'VOX', 'Telecom Services': 'VOX',

  'Energy': 'VDE', 'Oil & Gas': 'VDE', 'Oil & Gas E&P': 'VDE',
  'Oil & Gas Integrated': 'VDE', 'Oil & Gas Midstream': 'VDE',
  'Oil & Gas Refining & Marketing': 'VDE', 'Oil & Gas Equipment & Services': 'VDE',
  'Uranium': 'VDE', 'Solar': 'VDE',

  'Materials': 'VAW', 'Basic Materials': 'VAW', 'Specialty Chemicals': 'VAW',
  'Steel': 'VAW', 'Copper': 'VAW', 'Gold': 'VAW', 'Aluminum': 'VAW',
  'Lumber & Wood Production': 'VAW', 'Paper & Paper Products': 'VAW',

  'Real Estate': 'VNQ', 'REIT—Diversified': 'VNQ', 'REIT—Residential': 'VNQ',
  'REIT—Retail': 'VNQ', 'REIT—Office': 'VNQ', 'REIT—Industrial': 'VNQ',
  'Real Estate Services': 'VNQ', 'Real Estate—Development': 'VNQ',

  'Utilities': 'VPU', 'Utilities—Regulated Electric': 'VPU',
  'Utilities—Diversified': 'VPU', 'Utilities—Renewable': 'VPU',
};

const ETF_NAMES = {
  VGT: 'Technology', VHT: 'Healthcare', VIS: 'Industrials',
  VCR: 'Consumer Discretionary', VDC: 'Consumer Staples', VFH: 'Financials',
  VOX: 'Communication Services', VDE: 'Energy', VAW: 'Materials',
  VNQ: 'Real Estate', VPU: 'Utilities', VUG: 'Growth (fallback)',
};

export function getSectorETF(sectorOrIndustry) {
  return SECTOR_ETF_MAP[sectorOrIndustry] || 'VUG';
}

export function getSectorName(etf) {
  return ETF_NAMES[etf] || etf;
}

export function getAllSectorETFs() {
  return Object.keys(ETF_NAMES);
}

// Group cases by their sector ETF
export function groupBySectorETF(cases) {
  const groups = {};
  for (const c of cases) {
    const etf = getSectorETF(c.sector) || getSectorETF(c.industry) || 'VUG';
    if (!groups[etf]) groups[etf] = [];
    groups[etf].push(c);
  }
  return groups;
}
