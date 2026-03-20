# Attractor Value Framework — Project Context

## What This Is
Investment screening and portfolio management app combining Graham-Dodd value investing with complex systems analysis (attractor stability, network regimes, fat-tail awareness).

## Stack
- **Frontend**: React 18 + Vite + Tailwind CSS → Cloudflare Pages
- **Backend**: Cloudflare Workers + D1/SQLite
- **Domain**: odieseyeball.com (Cloudflare Access protected)
- **Analysis**: Claude Sonnet API for attractor stability scoring

## Status (as of 2026-03-20)
- **Phases 1-4**: Complete (data pipeline, screening, valuation, portfolio, alerts)
- **Data Integration**: SEC EDGAR as primary fundamental source with computed ratios (Session A), FRED expanded to 10 economic series with environment scoring (Session B)
- **Session C1**: Small cap infrastructure complete — universe builder (EDGAR Frames API), batch screener, earnings quality metrics (accruals/goodwill/revenue quality), liquidity filter, +5% MoS for small caps, volume data extraction
- **Session C2**: Attractor prompt enhanced with small-cap concentration risk probes, insider ownership attractor score modifier (+0.2/-0.1), sector P/B from Frames API (population-level 33rd percentile), SIC-to-sector mapping
- **Calibration Backlog**: All 5 items complete — ROE modifier, re-screen mode, attractor test suite, confidence bands, mixed outcome classification
- **Attractor Trap Validation**: 6/6 known traps correctly classified as Dissolving (INTC, M, WBA, WFC, T, KHC)

## Architecture
- **EDGAR → Finnhub fallback**: Aggregator module (`services/aggregator.js`) tries EDGAR first, falls back to Finnhub, records source in data_confidence table
- **Economic Environment**: FRED snapshot (AAA, BAA, yield curve, VIX, HY OAS, unemployment, GDP, oil) classified as NORMAL/CAUTIOUS/STRESSED. +5% MoS in STRESSED environments
- **Confidence Bands**: STRONG (≤90% of buy-below), STANDARD (≤buy-below), MARGINAL (≤105%)
- **ROE Modifier**: P/E×P/B ceiling raised for high-ROE franchises (20-30%: ×1.25, 30%+: ×1.50)
- **Split data**: External file (`data/splits.js`) + automated detection via shares outstanding comparison
- **Small Cap Universe**: EDGAR Frames API → asset-size filter → CIK map cross-ref → Yahoo market cap → exclusions → `stocks` table with `cap_tier = 'small'`
- **Earnings Quality**: Accruals ratio, goodwill ratio, revenue quality — computed from EDGAR XBRL (goodwill, operating_cash_flow, total_assets), stored in screen_results as informational metrics

## Data Pipeline
- **Daily (market days 4:45 PM ET)**: Yahoo prices → EDGAR fundamentals → screening → valuations → insider data → alerts
- **Intraday**: Watchlist price check every 15 min during market hours
- **Weekly (Saturday)**: Finnhub fallback refresh + EDGAR catch-up
- **EDGAR refresh**: 20 tickers/run, prioritizes watchlist → passing screen → any

## Key Commands
```bash
# Frontend dev
cd frontend && npm run dev

# Deploy frontend
cd frontend && npm run build && npx wrangler pages deploy dist --project-name attractor-value

# Deploy worker (IMPORTANT: must use --config flag from workers/ dir)
cd workers && npx wrangler deploy --config wrangler.toml

# EDGAR backfill (primary — no API key needed)
curl -X POST "https://odieseyeball.com/api/backfill?limit=50&mode=edgar"

# Finnhub backfill (fallback)
curl -X POST "https://odieseyeball.com/api/backfill?limit=50&mode=fundamentals"

# Fill metrics (P/E, P/B from Finnhub)
curl -X POST "https://odieseyeball.com/api/fill-metrics?limit=50"

# Economic snapshot
curl "https://odieseyeball.com/api/economic-snapshot"

# Price check / re-screen / full refresh
curl "https://odieseyeball.com/api/price-check?ticker=CB"
curl "https://odieseyeball.com/api/price-check?ticker=CB&mode=rescreen"
curl "https://odieseyeball.com/api/price-check?ticker=CB&mode=full"

# Trigger full refresh (prices + screening + valuations)
curl -X POST "https://odieseyeball.com/api/refresh?limit=2&wait=true"

# Run attractor trap test suite
node scripts/attractor-trap-harness.js --dry-run

# Debug raw XBRL data for a ticker
curl "https://odieseyeball.com/api/fill-fundamentals?debug=AAPL"
```

## Deploy Warning
There is a `wrangler.jsonc` in the project root (gitignored) that can cause deploys to go to the wrong worker (`attractor-value` instead of `attractor-value-api`). Always deploy from `workers/` with `--config wrangler.toml`.

## API Keys (Cloudflare Worker secrets — not in code)
ALPHA_VANTAGE_API_KEY, FINNHUB_API_KEY, FRED_API_KEY, ANTHROPIC_API_KEY
- Finnhub key regenerated 2026-03-20
- Anthropic key regenerated 2026-03-15

## Key Commands (Session C additions)
```bash
# Build small cap universe (multi-step, resumable)
curl -X POST "https://odieseyeball.com/api/universe/build?step=frames"
curl -X POST "https://odieseyeball.com/api/universe/build"  # auto-continues

# Check universe status
curl "https://odieseyeball.com/api/universe/status"

# Batch screen small caps
curl -X POST "https://odieseyeball.com/api/screen/batch?tier=small&limit=50"

# Reset universe build (debugging)
curl -X POST "https://odieseyeball.com/api/universe/reset"

# Compute sector P/B from Frames API (population-level)
curl -X POST "https://odieseyeball.com/api/universe/sector-pb"

# View cached sector P/B thresholds
curl "https://odieseyeball.com/api/universe/sector-pb"
```

## Remaining Work
- **Session C3**: Frontend — small cap display, liquidity badges, quality metrics in reports
- Adjacent Possible analysis UI (Layer 4)
- Portfolio performance charts over time
- Deploy Workers + frontend with latest changes
