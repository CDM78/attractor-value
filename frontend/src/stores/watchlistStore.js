import { create } from 'zustand'
import { API_BASE } from '../config.js'

export const useWatchlistStore = create((set, get) => ({
  items: [],
  loading: false,
  error: null,

  // Compare selection
  compareSelection: new Set(),

  fetchWatchlist: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`${API_BASE}/api/watchlist`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ items: data, loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  addToWatchlist: async (ticker, notes, targetBuyPrice) => {
    const res = await fetch(`${API_BASE}/api/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, notes, target_buy_price: targetBuyPrice }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },

  removeFromWatchlist: async (ticker) => {
    const res = await fetch(`${API_BASE}/api/watchlist?ticker=${ticker}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },

  toggleCompare: (ticker) => set(state => {
    const next = new Set(state.compareSelection)
    if (next.has(ticker)) next.delete(ticker)
    else next.add(ticker)
    return { compareSelection: next }
  }),

  clearCompare: () => set({ compareSelection: new Set() }),

  // Derive pipeline stages from item data
  getStageGroups: () => {
    const { items } = get()
    const needsAnalysis = []
    const waitingForPrice = []
    const buySignal = []

    for (const item of items) {
      if (item.attractor_stability_score == null) {
        needsAnalysis.push(item)
      } else if (item.buy_below_price != null && item.price != null && item.price <= item.buy_below_price) {
        buySignal.push(item)
      } else {
        waitingForPrice.push(item)
      }
    }

    return { needsAnalysis, waitingForPrice, buySignal }
  },
}))
