// Insider signal computation with enhanced detection
// Computes signals from raw insider_transactions + officer cross-referencing

const C_SUITE_TITLES = ['CEO', 'CFO', 'COO', 'Chief Executive',
  'Chief Financial', 'Chief Operating', 'President'];

export function computeInsiderSignal(transactions, officers = []) {
  const now = new Date();
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

  // Filter to last 90 days
  const recent = transactions.filter(tx =>
    new Date(tx.filing_date) >= ninetyDaysAgo
  );

  // Separate buys and sells (exclude option exercises, gifts, etc.)
  const buys = recent.filter(tx => tx.transaction_type === 'buy');
  const sells = recent.filter(tx => tx.transaction_type === 'sell');

  const totalBuyValue = buys.reduce((sum, tx) => sum + (tx.total_value || 0), 0);
  const totalSellValue = sells.reduce((sum, tx) => sum + (tx.total_value || 0), 0);
  const uniqueBuyers = new Set(buys.map(tx => tx.insider_name)).size;

  // Cross-reference sellers against known C-suite officers
  const officerNames = new Set(
    officers
      .filter(o => C_SUITE_TITLES.some(t =>
        (o.title || o.position || '').toUpperCase().includes(t.toUpperCase())
      ))
      .map(o => o.name)
  );

  const cSuiteSells = sells.filter(tx =>
    officerNames.has(tx.insider_name) ||
    C_SUITE_TITLES.some(t =>
      (tx.insider_title || '').toUpperCase().includes(t.toUpperCase())
    )
  );

  // Determine signal
  let signal = 'neutral';
  let details = '';

  if (uniqueBuyers >= 3 && totalBuyValue >= 100000) {
    signal = 'strong_buy';
    details = `${uniqueBuyers} insiders bought $${(totalBuyValue / 1000).toFixed(0)}K in 90 days`;
  } else if (totalSellValue > 0 && totalBuyValue > 0 &&
             totalSellValue / totalBuyValue >= 5 && cSuiteSells.length > 0) {
    signal = 'caution';
    details = `C-suite selling $${(totalSellValue / 1000000).toFixed(1)}M vs $${(totalBuyValue / 1000).toFixed(0)}K buying`;
  } else if (totalSellValue > 0 && totalBuyValue === 0 &&
             totalSellValue >= 1000000 && cSuiteSells.length > 0) {
    signal = 'caution';
    details = `Zero insider buying; C-suite selling $${(totalSellValue / 1000000).toFixed(1)}M`;
  }

  // Large-seller edge case: any single insider selling > $10M in 90 days
  if (signal === 'neutral') {
    const largeSellers = sells.filter(tx => (tx.total_value || 0) >= 10000000);
    if (largeSellers.length > 0) {
      signal = 'caution';
      const biggest = largeSellers.sort((a, b) => (b.total_value || 0) - (a.total_value || 0))[0];
      details = `Large insider sale: ${biggest.insider_name} sold $${((biggest.total_value || 0) / 1000000).toFixed(1)}M`;
    }
  }

  return {
    trailing_90d_buys: buys.length,
    trailing_90d_buy_value: totalBuyValue,
    trailing_90d_sells: sells.length,
    trailing_90d_sell_value: totalSellValue,
    unique_buyers_90d: uniqueBuyers,
    signal,
    signal_details: details || (recent.length === 0 ? 'No insider transactions in last 90 days' : 'Mixed/neutral insider activity'),
  };
}
