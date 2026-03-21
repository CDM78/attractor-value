import { create } from 'zustand'
import { API_BASE } from '../config.js'

export const useEnvironmentStore = create((set) => ({
  environment: 'NORMAL',
  crisis: {},
  regimes: { active: [], pending: [] },
  snapshot: {},
  loading: false,
  error: null,

  fetchEnvironment: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`${API_BASE}/api/environment`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({
        environment: data.environment || 'NORMAL',
        crisis: data.crisis || {},
        regimes: data.regimes || { active: [], pending: [] },
        snapshot: data.snapshot || {},
        loading: false,
      })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },
}))
