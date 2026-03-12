// Yahoo Finance API adapter
// Uses v8 chart endpoint (still publicly accessible) for price data
// Fundamentals come from Alpha Vantage (see alphaVantage.js)

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Fetch current price and basic metadata for a single ticker
export async function fetchQuote(ticker) {
  const url = `${CHART_URL}/${encodeURIComponent(ticker)}?interval=1d&range=5d`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error(`Rate limited on ${ticker}`);
    throw new Error(`Yahoo Finance error for ${ticker}: ${res.status}`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data returned for ${ticker}`);

  const meta = result.meta;
  return {
    ticker: meta.symbol || ticker,
    price: meta.regularMarketPrice || null,
    previousClose: meta.chartPreviousClose || null,
    longName: meta.longName || meta.shortName || ticker,
    currency: meta.currency || 'USD',
    exchangeName: meta.fullExchangeName || meta.exchangeName || null,
  };
}

// Fetch quotes for multiple tickers, processing in batches
export async function fetchBulkQuotes(tickers, batchSize = 5, delayMs = 1500) {
  const results = [];

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(t => fetchQuote(t))
    );

    for (let j = 0; j < batchResults.length; j++) {
      if (batchResults[j].status === 'fulfilled') {
        results.push(batchResults[j].value);
      } else {
        console.error(`Failed to fetch ${batch[j]}:`, batchResults[j].reason?.message);
      }
    }

    // Rate limit pause
    if (i + batchSize < tickers.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return results;
}

// S&P 500 ticker list — hardcoded starting universe
export function getSP500Tickers() {
  return [
    'AAPL','ABBV','ABT','ACN','ADBE','ADI','ADM','ADP','ADSK','AEE',
    'AEP','AES','AFL','AIG','AIZ','AJG','AKAM','ALB','ALGN','ALK',
    'ALL','ALLE','AMAT','AMCR','AMD','AME','AMGN','AMP','AMT','AMZN',
    'ANET','ANSS','AON','AOS','APA','APD','APH','APTV','ARE','ATO',
    'AVB','AVGO','AVY','AWK','AXP','AZO','BA','BAC','BAX',
    'BBWI','BBY','BDX','BEN','BIO','BIIB','BK','BKNG','BKR',
    'BLK','BMY','BR','BRK.B','BRO','BSX','BWA','BXP','C','CAG',
    'CAH','CARR','CAT','CB','CBOE','CBRE','CCI','CCL','CDAY','CDNS',
    'CDW','CE','CEG','CF','CFG','CHD','CHRW','CHTR','CI','CINF',
    'CL','CLX','CMA','CMCSA','CME','CMG','CMI','CMS','CNC','CNP',
    'COF','COO','COP','COST','CPB','CPRT','CPT','CRL','CRM','CSCO',
    'CSGP','CSX','CTAS','CTRA','CTSH','CTVA','CVS','CVX','CZR',
    'D','DAL','DD','DE','DFS','DG','DGX','DHI','DHR','DIS',
    'DLR','DLTR','DOV','DOW','DPZ','DRI','DTE','DUK','DVA',
    'DVN','DXCM','EA','EBAY','ECL','ED','EFX','EIX','EL',
    'EMN','EMR','ENPH','EOG','EPAM','EQIX','EQR','EQT','ES','ESS',
    'ETN','ETR','ETSY','EVRG','EW','EXC','EXPD','EXPE','EXR','F',
    'FANG','FAST','FBHS','FCX','FDS','FDX','FE','FFIV','FIS','FISV',
    'FITB','FMC','FOX','FOXA','FRT','FTNT','FTV','GD',
    'GE','GILD','GIS','GL','GLW','GM','GNRC','GOOG','GOOGL','GPC',
    'GPN','GRMN','GS','GWW','HAL','HAS','HBAN','HCA','HD',
    'HES','HIG','HII','HLT','HOLX','HON','HPE','HPQ','HRL','HSIC',
    'HST','HSY','HUM','HWM','IBM','ICE','IDXX','IEX','IFF','ILMN',
    'INCY','INTC','INTU','INVH','IP','IPG','IQV','IR','IRM','ISRG',
    'IT','ITW','IVZ','J','JBHT','JCI','JKHY','JNJ','JNPR','JPM',
    'K','KDP','KEY','KEYS','KHC','KIM','KLAC','KMB','KMI','KMX',
    'KO','KR','L','LDOS','LEN','LH','LHX','LIN','LKQ','LLY',
    'LMT','LNC','LNT','LOW','LRCX','LUV','LVS','LW','LYB',
    'LYV','MA','MAA','MAR','MAS','MCD','MCHP','MCK','MCO','MDLZ',
    'MDT','MET','META','MGM','MHK','MKC','MKTX','MLM','MMC','MMM',
    'MNST','MO','MOH','MOS','MPC','MPWR','MRK','MRNA','MRO','MS',
    'MSCI','MSFT','MSI','MTB','MTCH','MTD','MU','NCLH','NDAQ','NDSN',
    'NEE','NEM','NFLX','NI','NKE','NOC','NOW','NRG','NSC','NTAP',
    'NTRS','NUE','NVDA','NVR','NWL','NWS','NWSA','NXPI','O','ODFL',
    'OGN','OKE','OMC','ON','ORCL','ORLY','OTIS','OXY','PARA','PAYC',
    'PAYX','PCAR','PCG','PEG','PEP','PFE','PFG','PG','PGR',
    'PH','PHM','PKG','PKI','PLD','PM','PNC','PNR','PNW','POOL',
    'PPG','PPL','PRU','PSA','PSX','PTC','PVH','PWR','PXD','PYPL',
    'QCOM','QRVO','RCL','RE','REG','REGN','RF','RHI','RJF','RL',
    'RMD','ROK','ROL','ROP','ROST','RSG','RTX','SBAC','SBUX',
    'SCHW','SEE','SHW','SJM','SLB','SNA','SNPS','SO','SPG',
    'SPGI','SRE','STE','STT','STX','STZ','SWK','SWKS','SYF','SYK',
    'SYY','T','TAP','TDG','TDY','TECH','TEL','TER','TFC','TFX',
    'TGT','TJX','TMO','TMUS','TPR','TRGP','TRMB','TROW','TRV','TSCO',
    'TSLA','TSN','TT','TTWO','TXN','TXT','TYL','UAL','UDR','UHS',
    'ULTA','UNH','UNP','UPS','URI','USB','V','VFC','VICI','VLO',
    'VMC','VNO','VRSK','VRSN','VRTX','VTR','VTRS','VZ','WAB','WAT',
    'WBA','WBD','WDC','WEC','WELL','WFC','WHR','WM','WMB','WMT',
    'WRB','WRK','WST','WTW','WY','WYNN','XEL','XOM','XRAY','XYL',
    'YUM','ZBH','ZBRA','ZION','ZTS',
  ];
}
