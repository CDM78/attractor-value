import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../../config.js'
import { useWatchlistStore } from '../../stores/watchlistStore.js'

export default function QuickQuote({ onClose }) {
  const [ticker, setTicker] = useState('')
  const [loading, setLoading] = useState(false)
  const [quote, setQuote] = useState(null)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const navigate = useNavigate()
  const addToWatchlist = useWatchlistStore(s => s.addToWatchlist)

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

  const fetchQuote = async () => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    setLoading(true)
    setError(null)
    setQuote(null)
    try {
      const res = await fetch(`${API_BASE}/api/quote?ticker=${encodeURIComponent(t)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `No data for ${t}`)
      }
      setQuote(await res.json())
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    fetchQuote()
  }

  const handleAddWatch = async () => {
    if (!quote) return
    try {
      await addToWatchlist(quote.ticker, '', null)
      setError(null)
      setQuote(prev => ({ ...prev, _added: true }))
    } catch (err) {
      setError(err.message)
    }
  }

  const changeColor = quote?.changePct >= 0 ? 'text-pass' : 'text-fail'

  return (
    <div ref={panelRef} className="absolute top-full right-0 mt-2 w-80 bg-surface-secondary border border-border rounded-lg shadow-lg z-50 p-4">
      <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
        <input
          ref={inputRef}
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Enter ticker..."
          className="flex-1 px-3 py-1.5 text-sm bg-surface-primary border border-border rounded text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
          maxLength={10}
        />
        <button
          type="submit"
          disabled={loading || !ticker.trim()}
          className="px-3 py-1.5 text-sm rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
        >
          {loading ? '...' : 'Quote'}
        </button>
      </form>

      {error && (
        <p className="text-xs text-fail mb-2">{error}</p>
      )}

      {quote && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="font-bold text-text-primary">{quote.ticker}</span>
              {quote.longName && (
                <span className="text-xs text-text-secondary ml-2 truncate">{quote.longName}</span>
              )}
            </div>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-bold text-text-primary">${quote.price?.toFixed(2)}</span>
            {quote.change != null && (
              <span className={`text-sm font-medium ${changeColor}`}>
                {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.changePct >= 0 ? '+' : ''}{quote.changePct.toFixed(2)}%)
              </span>
            )}
          </div>
          {quote.exchangeName && (
            <p className="text-xs text-text-secondary">{quote.exchangeName} &middot; {quote.currency}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAddWatch}
              disabled={quote._added}
              className="text-xs px-3 py-1 rounded bg-surface-tertiary text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
            >
              {quote._added ? 'Added' : '+ Watchlist'}
            </button>
            <button
              onClick={() => { navigate(`/analyze/${quote.ticker}`); onClose() }}
              className="text-xs px-3 py-1 rounded bg-surface-tertiary text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors"
            >
              View Analysis
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
