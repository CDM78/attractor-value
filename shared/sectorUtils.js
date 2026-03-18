// Financial sector detection utilities

const FINANCIAL_SECTORS = ['Financial Services', 'Financials'];
const INSURANCE_INDUSTRIES = [
  'Insurance - Property & Casualty',
  'Insurance - Diversified',
  'Insurance - Life',
  'Insurance - Reinsurance',
  'Insurance - Specialty',
  'Insurance Brokers',
];
const BANK_INDUSTRIES = [
  'Banks - Regional',
  'Banks - Diversified',
  'Banks - Global',
];

export function isFinancialSector(stock) {
  const sector = (stock?.sector || '').toLowerCase();
  return FINANCIAL_SECTORS.some(s => sector.includes(s.toLowerCase())) ||
    sector.includes('financial') || sector.includes('insurance');
}

export function isInsurance(stock) {
  return INSURANCE_INDUSTRIES.includes(stock?.industry);
}

export function isBank(stock) {
  return BANK_INDUSTRIES.includes(stock?.industry);
}

// Get the appropriate leverage display for a stock
export function getDisplayLeverage(stock, financials) {
  if (isFinancialSector(stock)) {
    const totalDebt = financials?.total_debt || 0;
    const totalEquity = financials?.shareholder_equity || 0;
    const totalCapital = totalDebt + totalEquity;

    if (totalCapital > 0) {
      return {
        label: 'Debt / Total Capital',
        value: (totalDebt / totalCapital * 100).toFixed(1) + '%',
        note: 'Standard D/E not meaningful for financial companies',
      };
    }
    return {
      label: 'Debt / Total Capital',
      value: 'N/A',
      note: 'Financial data may use non-standard debt classification',
    };
  }

  const de = financials?.shareholder_equity > 0
    ? (financials.total_debt / financials.shareholder_equity).toFixed(2)
    : 'N/A';
  return { label: 'Debt / Equity', value: de, note: null };
}

// Get the appropriate profitability metric
export function getProfitabilityMetric(stock, financials) {
  if (isFinancialSector(stock)) {
    if (financials?.net_income && financials?.shareholder_equity > 0) {
      const roe = (financials.net_income / financials.shareholder_equity) * 100;
      return {
        label: 'Return on Equity (ROE)',
        value: roe.toFixed(1) + '%',
        note: 'ROE used instead of ROIC for financial companies',
      };
    }
    return { label: 'ROE', value: 'N/A', note: 'ROE used for financial companies' };
  }

  return {
    label: 'ROIC',
    value: financials?.roic != null ? financials.roic.toFixed(1) + '%' : 'N/A',
    note: null,
  };
}

// Validate suspicious dividend yield
export function validateDividendYield(ticker, sector, industry, dividendYield) {
  const highYieldNormal = ['REIT', 'Utilities', 'Real Estate'];
  if (dividendYield > 5.0 && !highYieldNormal.some(s =>
    sector?.includes(s) || industry?.includes(s)
  )) {
    console.warn(
      `SUSPICIOUS: ${ticker} dividend yield ${dividendYield.toFixed(2)}% ` +
      `in sector ${sector}. Possible preferred/common confusion.`
    );
    return { value: dividendYield, flagged: true };
  }
  return { value: dividendYield, flagged: false };
}

// Validate ROIC — > 100% is almost certainly wrong
export function validateROIC(ticker, sector, roic) {
  if (roic != null && roic > 100) {
    console.warn(
      `SUSPICIOUS: ${ticker} ROIC ${roic.toFixed(0)}% — likely meaningless for ${sector} sector`
    );
    return { value: roic, flagged: true, useROE: isFinancialSector({ sector }) };
  }
  return { value: roic, flagged: false, useROE: false };
}
