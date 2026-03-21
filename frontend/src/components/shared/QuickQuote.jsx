import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../../config.js'
import TierBadge from '../Dashboard/TierBadge'

export default function QuickQuote({ onClose }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const navigate = useNavigate()
  const debounceRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()

    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  const doSearch = async (q) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResults(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(trimmed)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Search failed`)
      }
      const data = await res.json()
      setResults(data.results || [])
    } catch (err) {
      setError(err.message)
      setResults(null)
    }
    setLoading(false)
  }

  const handleChange = (e) => {
    const val = e.target.value.toUpperCase()
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 300)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    doSearch(query)
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return null
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const signalColor = (signal) => {
    if (!signal) return 'text-text-secondary'
    if (signal === 'BUY') return 'text-pass'
    if (signal === 'NOT_YET') return 'text-warn'
    return 'text-text-secondary'
  }

  return (
    <div ref={panelRef} className="absolute top-full right-0 mt-2 w-96 bg-surface-secondary border border-border rounded-lg shadow-lg z-50 p-4">
      <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Search tickers or companies..."
          className="flex-1 px-3 py-1.5 text-sm bg-surface-primary border border-border rounded text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
          maxLength={40}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-3 py-1.5 text-sm rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
        >
          {loading ? '...' : 'Search'}
        </button>
      </form>

      {error && (
        <p className="text-xs text-fail mb-2">{error}</p>
      )}

      {loading && !results && (
        <p className="text-xs text-text-secondary">Searching...</p>
      )}

      {results && results.length === 0 && (
        <p className="text-xs text-text-secondary">No results found.</p>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {results.map((r) => (
            <div key={r.ticker} className="bg-surface-primary border border-border/50 rounded p-3 space-y-1.5">
              {/* Header row: ticker, name, tier */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-text-primary">{r.ticker}</span>
                {r.company_name && (
                  <span className="text-xs text-text-secondary truncate">&mdash; {r.company_name}</span>
                )}
                <span className="ml-auto">
                  {r.evaluated ? (
                    <TierBadge tier={r.discovery_tier} />
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-surface-tertiary text-text-secondary font-medium">
                      Not yet evaluated
                    </span>
                  )}
                </span>
              </div>

              {r.evaluated ? (
                <>
                  {/* Attractor + Signal row */}
                  <div className="flex items-center gap-3 text-xs text-text-secondary flex-wrap">
                    {r.attractor_score != null && (
                      <span>
                        Attractor: <span className="text-text-primary">{Number(r.attractor_score).toFixed(1)}</span>
                        {r.analysis_model && (
                          <span className="text-text-secondary ml-1">
                            ({r.analysis_model.includes('opus') ? 'Opus' : 'Sonnet'})
                          </span>
                        )}
                      </span>
                    )}
                    {r.signal && (
                      <span>
                        Signal: <span className={`font-medium ${signalColor(r.signal)}`}>{r.signal}</span>
                      </span>
                    )}
                  </div>

                  {/* Price row */}
                  <div className="flex items-center gap-3 text-xs text-text-secondary flex-wrap">
                    {r.intrinsic_value != null && (
                      <span>IV: <span className="text-text-primary">${Number(r.intrinsic_value).toFixed(0)}</span></span>
                    )}
                    {r.buy_below_price != null && (
                      <span>Buy Below: <span className="text-pass">${Number(r.buy_below_price).toFixed(0)}</span></span>
                    )}
                    {r.current_price != null && (
                      <span>Price: <span className="text-text-primary">${Number(r.current_price).toFixed(2)}</span></span>
                    )}
                  </div>

                  {/* Footer row */}
                  <div className="flex items-center justify-between pt-1">
                    {r.last_analyzed && (
                      <span className="text-xs text-text-secondary">
                        Last analyzed: {formatDate(r.last_analyzed)}
                      </span>
                    )}
                    <button
                      onClick={() => { navigate(`/analyze/${r.ticker}`); onClose() }}
                      className="text-xs px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors font-medium"
                    >
                      View Analysis &rarr;
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-text-secondary">No tier has screened this stock.</p>
                  <div className="pt-1">
                    <button
                      onClick={() => { navigate(`/analyze/${r.ticker}`); onClose() }}
                      className="text-xs px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors font-medium"
                    >
                      Run Analysis &rarr;
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
