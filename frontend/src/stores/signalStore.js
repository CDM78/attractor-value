import { create } from 'zustand'
import { API_BASE } from '../config.js'

export const useSignalStore = create((set, get) => ({
  buySignals: [],
  notYetSignals: [],
  positions: [],
  loading: false,
  error: null,
  analyzingId: null,
  deepAnalysisResult: null,

  fetchSignals: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`${API_BASE}/api/signals`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({
        buySignals: data.buy_signals || data.buySignals || [],
        notYetSignals: data.not_yet || data.notYetSignals || [],
        positions: data.positions || [],
        loading: false,
      })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  triggerDeepAnalysis: async (candidateId) => {
    set({ analyzingId: candidateId, deepAnalysisResult: null })
    try {
      const res = await fetch(`${API_BASE}/api/candidates/${candidateId}/deep-analyze`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ analyzingId: null, deepAnalysisResult: data })
      // Refresh signals to show updated data
      await get().fetchSignals()
      return data
    } catch (err) {
      set({ analyzingId: null, error: err.message })
      return null
    }
  },

  clearDeepAnalysisResult: () => set({ deepAnalysisResult: null }),
}))
