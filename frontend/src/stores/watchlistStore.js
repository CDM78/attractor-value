import { create } from 'zustand'

export const useWatchlistStore = create((set) => ({
  items: [],
  loading: false,
  error: null,

  fetchWatchlist: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/watchlist')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ items: data, loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  addToWatchlist: async (ticker, notes, targetBuyPrice) => {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, notes, target_buy_price: targetBuyPrice }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },

  removeFromWatchlist: async (ticker) => {
    const res = await fetch(`/api/watchlist?ticker=${ticker}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },
}))
