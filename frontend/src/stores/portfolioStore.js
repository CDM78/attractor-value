import { create } from 'zustand'

export const usePortfolioStore = create((set) => ({
  holdings: [],
  alerts: [],
  loading: false,
  error: null,

  fetchHoldings: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/portfolio')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ holdings: data, loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  fetchAlerts: async () => {
    try {
      const res = await fetch('/api/alerts')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ alerts: data })
    } catch (err) {
      console.error('Failed to fetch alerts:', err)
    }
  },

  dismissAlert: async (id) => {
    await fetch('/api/alerts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  },
}))
