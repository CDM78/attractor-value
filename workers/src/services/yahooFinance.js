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

  // Extract average volume from chart data (5-day range)
  const volumes = result.indicators?.quote?.[0]?.volume || [];
  const validVolumes = volumes.filter(v => v != null && v > 0);
  const avgVolume = validVolumes.length > 0
    ? validVolumes.reduce((s, v) => s + v, 0) / validVolumes.length
    : null;

  const price = meta.regularMarketPrice || null;

  // Market cap from Yahoo (in raw units — convert to millions)
  const rawMarketCap = meta.marketCap || null;
  const marketCapMillions = rawMarketCap ? Math.round(rawMarketCap / 1e6) : null;

  return {
    ticker: meta.symbol || ticker,
    price,
    previousClose: meta.chartPreviousClose || null,
    longName: meta.longName || meta.shortName || ticker,
    currency: meta.currency || 'USD',
    exchangeName: meta.fullExchangeName || meta.exchangeName || null,
    avgVolume: avgVolume ? Math.round(avgVolume) : null,
    avgDollarVolume: (avgVolume && price) ? Math.round(avgVolume * price) : null,
    marketCapMillions,
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

// S&P 500 ticker list
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

// S&P 400 MidCap ticker list — expanded universe for deeper value screening
export function getMidCapTickers() {
  return [
    'AAL','ACIW','ACM','AEIS','AGCO','AHR','AIT','ALLY','AMED','AMG','AMKR','AN',
    'ANF','APG','APPF','AR','ARMK','AROC','ARWR','ASB','ASH','ATI','ATSG','AVNT',
    'AX','AXON','AWI','AXS','AYI','AZEK','AZPN',
    'BAH','BALL','BC','BCO','BERY','BHF','BHLB','BJ','BKH','BLD','BMI','BPMC',
    'BRBR','BRKR','BROS','BSY','BYD',
    'CACI','CALM','CAR','CARG','CASY','CBSH','CBT','CC','CCK','CEIX','CENTA',
    'CHE','CHH','CHRD','CHX','CIB','CIEN','CLF','CLH','CLVT','CNMD','CNX',
    'COLB','COKE','COLM','COMM','COR','CPE','CPK','CRI','CRS','CRUS','CROX',
    'CSL','CSWI','CVCO','CW','CYTK',
    'DAR','DCI','DINO','DKS','DLB','DOCS','DOX','DT','DTM','DUOL','DY',
    'EAT','EEFT','EGP','EHC','ENS','ENSG','EQH','ERIE','ESAB','ESI','EVR',
    'EWBC','EXEL','EXLS','EXPO',
    'FAF','FBIN','FCFS','FHI','FHN','FIVE','FLO','FLS','FNB','FND','FNF',
    'FROG','FRPT','FSLR',
    'G','GAP','GATX','GBCI','GEF','GERN','GFL','GGG','GHC','GLNG','GMS',
    'GNTX','GO','GPI','GTY','GWRE',
    'H','HAE','HBI','HGV','HL','HLI','HLNE','HQY','HRI','HRB','HUBG',
    'HUN','HWC','HXL','HIMS',
    'IART','IBP','IBKR','ICFI','ICL','IDA','IDCC','INGR','INSM','INST',
    'IPGP','IRT','ITCI','ITT',
    'JAZZ','JBL','JBLU','JEF','JHG','JLL',
    'KBR','KEX','KMPR','KNX','KRC','KSS','KTOS','KVUE',
    'LANC','LAUR','LBRT','LBRDK','LEA','LEVI','LFUS','LITE','LIVN','LNTH',
    'LPX','LSTR',
    'MANH','MASI','MAT','MATX','MBUU','MC','MDGL','MEDP','MIDD','MKSI',
    'MMS','MOD','MORN','MP','MPW','MSA','MSM','MTDR','MTG','MTH','MTSI',
    'MTN','MTZ','MUR','MUSA',
    'NATI','NBIX','NFG','NJR','NMIH','NNN','NOV','NSA','NSP','NSIT',
    'NTNX','NUVB','NVST','NVT',
    'OC','OGE','OGN','OGS','OHI','OLED','OLN','OMF','ORA','ORI','OSK',
    'OTTR','OVV',
    'PATH','PAYO','PBF','PCOR','PCTY','PEN','PFGC','PII','PINC','PINS',
    'PLNT','PLUS','PNM','POST','PPC','POWL','PRIM','PRGO','PRI','PSN',
    'PSTG',
    'QLYS','R','RBC','RCM','REXR','RGA','RGLD','RHP','RIG','RLI','RNR',
    'RPRX','RRC','RS','RVMD',
    'SAIC','SAIL','SAM','SATS','SBCF','SCI','SEIC','SF','SFM','SFNC',
    'SG','SIGI','SITM','SKX','SLGN','SLM','SM','SMCI','SMG','SMTC',
    'SNDR','SNV','SOLV','SON','SPB','SPSC','SSD','SSNC','STAG','STLD',
    'STN','STRA','SWAV','SWN','SWX','SXT',
    'TALO','TASK','TENB','TGTX','THC','THO','TKR','TMHC','TNL','TNET',
    'TOL','TPC','TPX','TREX','TRU','TTC','TTMI','TXRH',
    'UDMY','UFPI','UMBF','UNM','URBN','USLM','USM','USFD','UTHR',
    'VIRT','VLTO','VLY','VMI','VNOM','VNT','VRNS','VRRM','VSAT','VSH',
    'WAL','WBS','WCC','WDFC','WEX','WFG','WH','WHD','WK','WLK','WMS',
    'WOLF','WOW','WPC','WSC','WSM','WSO','WTS','WTFC','WWD',
    'X','XPEL','XPO','YETI','ZI','ZWS',
  ];
}

// Full screening universe: S&P 500 + S&P 400 MidCap (deduplicated)
export function getFullUniverse() {
  const sp500 = getSP500Tickers();
  const midcap = getMidCapTickers();
  const seen = new Set(sp500);
  const combined = [...sp500];
  for (const t of midcap) {
    if (!seen.has(t)) {
      combined.push(t);
      seen.add(t);
    }
  }
  return combined;
}
