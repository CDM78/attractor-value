import { create } from 'zustand'
import { API_BASE } from '../config.js'

export const usePortfolioStore = create((set) => ({
  holdings: [],
  summary: null,
  alerts: [],
  loading: false,
  error: null,

  fetchHoldings: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`${API_BASE}/api/portfolio`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({
        holdings: data.holdings || data,
        summary: data.summary || null,
        loading: false,
      })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  addPosition: async (position) => {
    const res = await fetch(`${API_BASE}/api/portfolio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(position),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },

  sellPosition: async (id, action, sharesToSell, pricePerShare, reason) => {
    const res = await fetch(`${API_BASE}/api/portfolio`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, action,
        shares_to_sell: sharesToSell,
        price_per_share: pricePerShare,
        reason,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },

  fetchAlerts: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/alerts`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ alerts: data })
    } catch (err) {
      console.error('Failed to fetch alerts:', err)
    }
  },

  dismissAlert: async (id) => {
    await fetch(`${API_BASE}/api/alerts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  },
}))
