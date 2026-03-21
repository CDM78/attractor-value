import { create } from 'zustand'
import { API_BASE } from '../config.js'

export const useSignalStore = create((set) => ({
  buySignals: [],
  notYetSignals: [],
  positions: [],
  loading: false,
  error: null,

  fetchSignals: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`${API_BASE}/api/signals`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({
        buySignals: data.buySignals || [],
        notYetSignals: data.notYetSignals || [],
        positions: data.positions || [],
        loading: false,
      })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },
}))
