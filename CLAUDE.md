# Attractor Value Framework — Project Context

## What This Is
Investment screening and portfolio management app combining Graham-Dodd value investing with complex systems analysis (attractor stability, network regimes, fat-tail awareness).

## Stack
- **Frontend**: React 18 + Vite + Tailwind CSS → Cloudflare Pages
- **Backend**: Cloudflare Workers + D1/SQLite
- **Domain**: odieseyeball.com (Cloudflare Access protected)
- **Analysis**: Claude Sonnet API for attractor stability scoring

## Status: All 4 Phases Complete + Bug Fixes (as of 2026-03-15)
- Phase 1: Data pipeline + screening engine (Yahoo, Finnhub, FRED)
- Phase 2: Graham valuation calculator + watchlist + insider pipeline
- Phase 3: Claude-powered attractor analysis + EDGAR 10-K + concentration risk
- Phase 4: Portfolio tracker + 9-rule alerts engine
- Polish: Transaction history, refresh button, mobile layout, CSV export
- **2026-03-15**: Switched fundamentals from Alpha Vantage to Finnhub (AV blocked from Workers), fixed 8 bugs in valuation/screening/alerts

## Data Pipeline (daily cron at 6am UTC)
Prices → Finnhub metrics (50/run) → Finnhub fundamentals (40/run, no daily cap) → Screening (500/run) → Valuations → Insider data → Alerts

## Key Commands
```bash
# Frontend dev
cd frontend && npm run dev

# Deploy frontend
cd frontend && npm run build && npx wrangler pages deploy dist --project-name attractor-value

# Deploy worker (IMPORTANT: must use --config flag from workers/ dir)
cd workers && npx wrangler deploy --config wrangler.toml

# Fill fundamentals manually (uses Finnhub, no daily cap)
curl -X POST "https://odieseyeball.com/api/fill-fundamentals?limit=10"

# Fill metrics manually (P/E, P/B from Finnhub)
curl -X POST "https://odieseyeball.com/api/fill-metrics?limit=50"

# Bulk backfill (fundamentals, metrics, or both — processes all missing stocks)
curl -X POST "https://odieseyeball.com/api/backfill?limit=50&mode=fundamentals"
curl -X POST "https://odieseyeball.com/api/backfill?limit=50&mode=both"
curl "https://odieseyeball.com/api/backfill"  # GET to check status

# Trigger full refresh (prices + screening + valuations)
curl -X POST "https://odieseyeball.com/api/refresh?limit=2&wait=true"

# Debug raw XBRL data for a ticker
curl "https://odieseyeball.com/api/fill-fundamentals?debug=AAPL"

# Local AV fundamentals fetch (fallback, 6/day limit)
node scripts/fetch-fundamentals-local.js 6
```

## Deploy Warning
There is a `wrangler.jsonc` in the project root (gitignored) that can cause deploys to go to the wrong worker (`attractor-value` instead of `attractor-value-api`). Always deploy from `workers/` with `--config wrangler.toml`.

## API Keys (Cloudflare Worker secrets — not in code)
ALPHA_VANTAGE_API_KEY, FINNHUB_API_KEY, FRED_API_KEY, ANTHROPIC_API_KEY
- All 4 keys re-set on 2026-03-15 after accidental wipe
- Anthropic key regenerated on 2026-03-15

## Current Data Status (as of 2026-03-17)
- ~700+ stocks in universe: S&P 500 + S&P 400 MidCap (deduplicated via getFullUniverse())
- 435+ have fundamentals (backfilled 2026-03-17)
- 430+ have P/E and P/B ratios (Finnhub)
- Daily cron processes 40 fundamentals + 50 metrics + screens 500 stocks per run
- Backfill endpoint: POST /api/backfill?limit=50&mode=both for bulk catch-up

## Remaining Work
- Adjacent Possible analysis UI (Layer 4)
- Portfolio performance charts over time
- End-to-end testing of full flow
- Fill sector data for stocks still showing NULL (affects screening filter exceptions)
- Run Claude attractor analysis on all screened stocks
