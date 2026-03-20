import { create } from 'zustand'
import { API_BASE } from '../config.js'

export const useScreenStore = create((set, get) => ({
  results: [],
  meta: null,
  loading: false,
  error: null,

  // Selection state for batch analysis
  selectedTickers: new Set(),
  batchJob: null, // { status, total, completed, currentTicker, errorMessage }

  fetchResults: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`${API_BASE}/api/screen`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.stocks) {
        set({ results: data.stocks, meta: data.meta, loading: false })
      } else {
        set({ results: data, meta: null, loading: false })
      }
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  toggleSelection: (ticker) => set(state => {
    const next = new Set(state.selectedTickers)
    if (next.has(ticker)) next.delete(ticker)
    else next.add(ticker)
    return { selectedTickers: next }
  }),

  selectAllUnscored: (tickers) => set({ selectedTickers: new Set(tickers) }),

  clearSelection: () => set({ selectedTickers: new Set() }),

  // Frontend-driven batch: POST one ticker at a time sequentially.
  // This avoids Worker timeout issues with ctx.waitUntil background processing.
  // Each analysis takes ~30-60s (EDGAR fetch + 2 Claude API calls).
  startBatchAnalysis: async () => {
    const { selectedTickers } = get()
    const tickers = [...selectedTickers]
    if (tickers.length === 0) return

    set({
      batchJob: { status: 'running', total: tickers.length, completed: 0, currentTicker: tickers[0], errorMessage: null },
      selectedTickers: new Set(),
    })

    let errors = []
    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i]
      set(state => ({
        batchJob: { ...state.batchJob, currentTicker: ticker, completed: i }
      }))

      try {
        const res = await fetch(`${API_BASE}/api/analyze?ticker=${ticker}`, { method: 'POST' })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData.error || `HTTP ${res.status}`)
        }
      } catch (err) {
        console.error(`Analysis failed for ${ticker}:`, err.message)
        errors.push(`${ticker}: ${err.message}`)
      }

      set(state => ({
        batchJob: { ...state.batchJob, completed: i + 1 }
      }))
    }

    set({
      batchJob: {
        status: 'complete',
        total: tickers.length,
        completed: tickers.length,
        currentTicker: null,
        errorMessage: errors.length > 0 ? errors.join('; ') : null,
      }
    })
  },

  // No longer needed — batch is driven by frontend, not server polling
  pollBatchProgress: async () => {},
}))
