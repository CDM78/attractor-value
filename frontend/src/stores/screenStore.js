import { create } from 'zustand'

const API_BASE = import.meta.env.DEV ? '' : ''

export const useScreenStore = create((set) => ({
  results: [],
  loading: false,
  error: null,

  fetchResults: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`${API_BASE}/api/screen`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      set({ results: data, loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },
}))
