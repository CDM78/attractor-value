// Known stock splits for per-share EDGAR data adjustment.
// EDGAR reports as-filed values; pre-split data must be divided by ratio.
//
// Maintain this file when major splits occur. For stocks not listed here,
// the aggregator's detectSplits() function can identify likely splits
// automatically by comparing shares outstanding between consecutive years.

export default {
  AAPL: [
    { date: '2014-06-09', ratio: 7 },
    { date: '2020-08-28', ratio: 4 },
  ],
  GOOGL: [{ date: '2022-07-15', ratio: 20 }],
  GOOG: [{ date: '2022-07-15', ratio: 20 }],
  TSLA: [
    { date: '2020-08-31', ratio: 5 },
    { date: '2022-08-25', ratio: 3 },
  ],
  AMZN: [{ date: '2022-06-06', ratio: 20 }],
  NVDA: [
    { date: '2021-07-20', ratio: 4 },
    { date: '2024-06-10', ratio: 10 },
  ],
  SHOP: [{ date: '2022-06-29', ratio: 10 }],
  PANW: [{ date: '2022-09-14', ratio: 3 }],
};
