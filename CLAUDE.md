# Attractor Value Framework — Project Context

## What This Is
Investment screening and portfolio management app combining Graham-Dodd value investing with complex systems analysis (attractor stability, network regimes, fat-tail awareness).

## Stack
- **Frontend**: React 18 + Vite + Tailwind CSS → Cloudflare Pages
- **Backend**: Cloudflare Workers + D1/SQLite
- **Domain**: odieseyeball.com (Cloudflare Access protected)
- **Analysis**: Claude Sonnet API for attractor stability scoring

## Status: All 4 Phases Complete (as of 2026-03-12)
- Phase 1: Data pipeline + screening engine (Yahoo, Alpha Vantage, FRED, Finnhub)
- Phase 2: Graham valuation calculator + watchlist + insider pipeline
- Phase 3: Claude-powered attractor analysis + EDGAR 10-K + concentration risk
- Phase 4: Portfolio tracker + 9-rule alerts engine
- Polish: Transaction history, refresh button, mobile layout, CSV export

## Data Pipeline (daily cron at 6am UTC)
Prices → Finnhub metrics → Alpha Vantage fundamentals (prioritized) → Screening → Valuations → Insider data → Alerts

## Key Commands
```bash
# Frontend dev
cd frontend && npm run dev

# Deploy frontend
cd frontend && npm run build && npx wrangler pages deploy dist --project-name attractor-value

# Deploy worker
cd workers && npx wrangler deploy

# Fill metrics manually
curl -X POST "https://odieseyeball.com/api/fill-metrics?limit=50"

# Trigger refresh
curl -X POST "https://odieseyeball.com/api/refresh?limit=10&wait=true"
```

## API Keys (Cloudflare Worker secrets — not in code)
ALPHA_VANTAGE_API_KEY, FINNHUB_API_KEY, FRED_API_KEY, ANTHROPIC_API_KEY

## Remaining Work
- Adjacent Possible analysis UI (Layer 4)
- Portfolio performance charts over time
- End-to-end testing of full flow
- Regenerate Anthropic API key (exposed in chat session)
