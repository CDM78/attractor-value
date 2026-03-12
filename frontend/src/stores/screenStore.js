import { create } from 'zustand'

const API_BASE = import.meta.env.DEV ? '' : ''

export const useScreenStore = create((set) => ({
  results: [],
  meta: null,
  loading: false,
  error: null,

  fetchResults: async () => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`${API_BASE}/api/screen`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // Update 2: API now returns { stocks, meta } instead of flat array
      if (data.stocks) {
        set({ results: data.stocks, meta: data.meta, loading: false })
      } else {
        set({ results: data, meta: null, loading: false })
      }
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },
}))
