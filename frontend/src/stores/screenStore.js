import { create } from 'zustand'
import { API_BASE } from '../config.js'

export const useScreenStore = create((set, get) => ({
  results: [],
  meta: null,
  loading: false,
  error: null,

  // Selection state for batch analysis
  selectedTickers: new Set(),
  batchJob: null, // { jobId, status, total, completed, currentTicker, errorMessage }

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

  startBatchAnalysis: async () => {
    const { selectedTickers } = get()
    const tickers = [...selectedTickers]
    if (tickers.length === 0) return

    try {
      const res = await fetch(`${API_BASE}/api/analyze/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({
        batchJob: { jobId: data.jobId, status: 'running', total: data.total, completed: 0, currentTicker: null, errorMessage: null },
        selectedTickers: new Set(),
      })
    } catch (err) {
      set({ batchJob: { status: 'error', errorMessage: err.message } })
    }
  },

  pollBatchProgress: async () => {
    const { batchJob } = get()
    if (!batchJob?.jobId) return

    try {
      const res = await fetch(`${API_BASE}/api/analyze/batch?jobId=${batchJob.jobId}`)
      if (!res.ok) return
      const data = await res.json()
      set({ batchJob: {
        jobId: data.jobId,
        status: data.status,
        total: data.total,
        completed: data.completed,
        currentTicker: data.currentTicker,
        errorMessage: data.errorMessage,
      }})
    } catch { /* ignore poll errors */ }
  },
}))
