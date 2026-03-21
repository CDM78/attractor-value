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

// Growth-focused tickers: software, cybersecurity, cloud, medtech, e-commerce, automation
// These are the companies the Tier 3 DKS pre-screen needs to find
export function getGrowthTickers() {
  return [
    // Software / Cloud / SaaS
    'CRWD','DDOG','NET','SNOW','PLTR','ZS','S','BILL','HUBS','MDB',
    'CFLT','GTLB','DOCN','BRZE','SMAR','ASAN','MNDY','ESTC','FIVN','PCOR',
    'VEEV','PAYC','WDAY','TEAM','SHOP','TTD','TWLO','OKTA','ZI','APPF',
    'PCTY','SPSC','WK','MANH','GWRE','NCNO','ALTR','SUMO','CLDR','NEWR',
    'DOMO','TENB','QLYS','VRNS','RPD','CYBR','SAIL','FRSH','CWAN','DT',
    // Cybersecurity
    'PANW','FTNT','CRWD','ZS','S','CYBR','TENB','QLYS','RPD','VRNS',
    'OKTA','SAIL',
    // Cloud infrastructure / Data
    'ANET','SMCI','VRT','DELL','PSTG','NTAP','PURE','NETR','CLSK','IREN',
    // AI / Semiconductors (growth)
    'NVDA','ARM','AVGO','AMD','MRVL','SNPS','CDNS','LRCX','KLAC','AMAT',
    'ONTO','ACLS','FORM','CEVA','MTSI','SITM','WOLF','MPWR','MCHP','SWKS',
    // Healthcare / Medtech / Diagnostics
    'ISRG','DXCM','PODD','ALGN','AXON','RGEN','BIO','TECH','NVCR','GMED',
    'INSP','TMDX','AZTA','RVMD','INSM','PCVX','SMMT','MASI','IART','PEN',
    'NTRA','EXAS','GH','SDGR','TXG','OLINK','CRNX','BMRN','VRTX','REGN',
    // E-commerce / Digital consumer
    'ETSY','CHWY','DUOL','COUR','UDMY','BROS','HIMS','RBLX','U','PINS',
    'SPOT','ROKU','SE','MELI','GLOB',
    // Industrials / Automation / Test & measurement
    'AXON','CGNX','TER','KEYS','ZBRA','ROK','AZEK','TREX','GNRC','ASPN',
    'TT','IR','NDSN','ITT','RBC','MIDD','FTV','IEX','NOVT','OSK',
    // Specialty retail with digital moats
    'FIVE','OLLI','FND','DKS','CASY','SFM','TXRH','WING','SHAK','CAVA',
    // Fintech
    'SQ','PYPL','AFRM','FOUR','GPN','FIS','FISV','TOST','LMND','SOFI',
    // Clean energy / Electrification
    'ENPH','SEDG','FSLR','RUN','NOVA','STEM','CHPT','RIVN','LCID','PLUG',
    // Additional Russell 2000/3000 growth — broad coverage
    // Software/Tech continued
    'RIOT','MARA','BTBT','CIFR','HUT','CORZ','IREN','SOUN','BBAI','IONQ',
    'RGTI','QBTS','AI','BIGC','CXAI','PRCT','INTA','TASK','KNBE','EVBG',
    'DCBO','CERT','PYCR','SEMR','ENFN','VNET','ZUO','BLZE','BTDR','CWAN',
    'AGYS','CCCS','BNFT','NABL','PEGA','OTEX','PRFT','CALX','VIAV','LITE',
    'COHR','CIEN','INFN','EXTR','CSGS','EGHT','BAND','LPSN','SQSP','GDYN',
    'TWKS','EPAM','GLOB','EXLS','WNS','TTEC',
    // Healthcare/Biotech growth
    'HALO','RARE','IONS','SRPT','VKTX','ALNY','MRNA','BNTX','RVMD','CYTK',
    'MDGL','PCVX','SMMT','KROS','KRYS','ACAD','PTCT','FOLD','MNKD','TGTX',
    'IRTC','GKOS','NVRO','ATRC','SILK','KIDS','PRCT','PROF','ALHC','AMPH',
    'ELAN','XRAY','XENE','ARWR','NTLA','CRSP','BEAM','EDIT','VERV','EXAI',
    'RXRX','RCKT','RPRX','RVMD','NUVB','TARS',
    // Consumer growth / Digital
    'LULU','DECK','ON','RVLV','XPEL','FOXF','YETI','COOK','ELF','CAVA',
    'SHAK','WING','JACK','PLAY','DENN','KRUS','FWRG','SG','ARHS','LOVE',
    'SNBR','LL','LESL','WRBY','HNST','FIGS','BIRD',
    // Industrial tech / Specialty
    'NOVT','AZEK','TREX','BLDR','UFPI','SITE','GMS','ROAD','PRIM','ATKR',
    'SPXC','RXO','GXO','XPO','SAIA','ODFL','WERN','JBHT','KNX','SNDR',
    'MATX','HUBG','ARCB','TFI',
    // Regional banks / Fintech (growth-oriented)
    'WAL','IBKR','LPLA','HOOD','UPST','LC','OPEN','RDFN',
    // REITs with growth characteristics
    'REXR','STAG','IIPR','IRM','DLR','EQIX','AMT','CCI','SBAC',
    // Additional mid-cap growth
    'CELH','MNST','FIZZ','SAM','BJ','OLPX','GOOS','CROX','SKX','ONON',
    'BIRK','HBI','VFC','PVH','TPR','CPRI','RL',
    // Aerospace / Defense tech
    'KTOS','AVAV','RKLB','LHX','BWXT','HWM','TDG','HEI','AXON','TXT',
    // More software / data analytics
    'DSGX','CXM','SSYS','DDD','XMTR','MTTR','VIEW','LAZR','LIDR','INVZ',
    'OUST','IRDM','GSAT',
    // Russell 2000 Growth broad additions — small/mid growth companies
    // Healthcare services / Life sciences tools
    'CRL','WST','BIO','A','WAT','TMO','DHR','IQV','MEDP','DOCS',
    'ACCD','ONEM','AMWL','TALK','GDRX','OSCR','CLOV','ALHC','AGIO','BHVN',
    'DAWN','DVAX','IOVA','MGNX','NKTR','SGEN','TECH','VCYT','FATE','LEGN',
    // Consumer platforms / marketplace
    'ABNB','DASH','UBER','LYFT','GRAB','CPNG','GDDY','YELP','ANGI','CARG',
    'TRUE','ACVA','RSKD','YOU','RELY','DLO','PAYO','FLYW','BILL',
    // Industrial automation / robotics
    'ISRG','IRBT','BRKS','ENTG','MKSI','TER','CGNX','NOVT','LECO','GGG',
    'RBC','NDSN','FTV','AME','ROPER','IEX','ITT','WTS','CW','ESE',
    'MYRG','POWL','AAON','WELBF',
    // Semiconductor equipment / materials extended
    'AMKR','CRUS','DIOD','LFUS','POWI','SLAB','SMTC','SYNA','TXN','MPWR',
    // Data center / Cloud infrastructure extended
    'EQIX','DLR','AMT','CCI','SBAC','QTS','CONE','COR','IRM','UNIT',
    // Payments / Financial infrastructure
    'V','MA','AXP','SQ','PYPL','AFRM','MQ','FOUR','RPAY','EVOP',
    'NUVEI','FLYW','PAYO','TOST','GLBE','ADYEN',
    // Additional growth — various sectors
    'ASTS','LUNR','RDW','MNTS','SPIR','BKSY','SATL','VORB',
    'JOBY','ACHR','LILM','BLDE','EVTL',
    'ARRY','STEM','BE','BLDP','FCEL','MAXN',
    'DV','IAS','TTD','MGNI','PUBM','DSP','ZETA','BRZE','APGE',
    'TRUP','PZZA','DPZ','CMG','CAVA','BROS','DUTCH','LKNCY',
    'PTON','NCLH','RCL','CCL','ABNB','BKNG','EXPE','TRIP',
    'DKNG','PENN','RSI','GENI','SKLZ',
    'COIN','HOOD','SOFI','UPST','LC','OPEN','RDFN','COMP',
    'CFLT','ESTC','MDB','NEWR','SUMO','DOMO','CLDR',
    'PATH','AMBA','CEVA','LSCC','INDI','QUIK','NPTN',
    'SWAV','SHAK','CAVA','BROS','WING','LOCO','JACK','DIN',
    'XPOF','FWRG','EAT','TXRH','KURA','KRUS',
  ];
}

// Full screening universe: S&P 500 + S&P 400 MidCap + Growth (deduplicated)
export function getFullUniverse() {
  const sp500 = getSP500Tickers();
  const midcap = getMidCapTickers();
  const growth = getGrowthTickers();
  const seen = new Set(sp500);
  const combined = [...sp500];
  for (const list of [midcap, growth]) {
    for (const t of list) {
      if (!seen.has(t)) {
        combined.push(t);
        seen.add(t);
      }
    }
  }
  return combined;
}
