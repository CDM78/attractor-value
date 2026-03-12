import { useEffect, useState } from 'react'
import { useWatchlistStore } from '../../stores/watchlistStore'

export default function WatchlistTable() {
  const { items, loading, error, fetchWatchlist, addToWatchlist, removeFromWatchlist } = useWatchlistStore()
  const [showAdd, setShowAdd] = useState(false)
  const [newTicker, setNewTicker] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [newTarget, setNewTarget] = useState('')

  useEffect(() => {
    fetchWatchlist()
  }, [fetchWatchlist])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!newTicker.trim()) return
    try {
      await addToWatchlist(newTicker.trim().toUpperCase(), newNotes, newTarget ? parseFloat(newTarget) : null)
      setNewTicker('')
      setNewNotes('')
      setNewTarget('')
      setShowAdd(false)
      fetchWatchlist()
    } catch (err) {
      alert(`Failed: ${err.message}`)
    }
  }

  const handleRemove = async (ticker) => {
    if (!confirm(`Remove ${ticker} from watchlist?`)) return
    try {
      await removeFromWatchlist(ticker)
      fetchWatchlist()
    } catch (err) {
      alert(`Failed: ${err.message}`)
    }
  }

  if (loading) return <div className="text-text-secondary">Loading watchlist...</div>
  if (error) return <div className="text-fail">Error: {error}</div>

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-bold">Watchlist</h2>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              onClick={() => {
                const headers = ['Ticker','Company','Sector','Price','Buy Below','Target','Discount %','Signal','Added','Notes']
                const rows = items.map(i => [
                  i.ticker, i.company_name, i.sector, i.price?.toFixed(2),
                  i.buy_below_price?.toFixed(2) || '', i.target_buy_price?.toFixed(2) || '',
                  i.discount_to_iv_pct?.toFixed(1) || '',
                  i.insider_signal || '', i.added_date, `"${(i.notes || '').replace(/"/g, '""')}"`
                ])
                const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
                const blob = new Blob([csv], { type: 'text/csv' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a'); a.href = url; a.download = 'watchlist.csv'; a.click()
                URL.revokeObjectURL(url)
              }}
              className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:text-accent transition-colors"
            >
              Export CSV
            </button>
          )}
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-sm px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
          >
            {showAdd ? 'Cancel' : '+ Add Ticker'}
          </button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-surface-secondary rounded p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Ticker</label>
            <input
              type="text"
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value)}
              placeholder="AAPL"
              className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-24"
            />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Target Buy Price</label>
            <input
              type="number"
              step="0.01"
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              placeholder="0.00"
              className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-28"
            />
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-text-secondary mb-1">Notes</label>
            <input
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Why are you watching this stock?"
              className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent/80 transition-colors"
          >
            Add
          </button>
        </form>
      )}

      {items.length === 0 ? (
        <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
          Your watchlist is empty. Add stocks from the screener or manually above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary text-left">
                <th className="px-3 py-2">Ticker</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Sector</th>
                <th className="px-3 py-2">Price</th>
                <th className="px-3 py-2">Buy Below</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Discount</th>
                <th className="px-3 py-2">Signal</th>
                <th className="px-3 py-2">Insider</th>
                <th className="px-3 py-2">Added</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const atTarget = item.price && item.target_buy_price && item.price <= item.target_buy_price;
                const atBuyBelow = item.price && item.buy_below_price && item.price <= item.buy_below_price;
                return (
                  <tr key={item.ticker} className={`border-b border-border/50 hover:bg-surface-secondary ${atTarget || atBuyBelow ? 'bg-pass/5' : ''}`}>
                    <td className="px-3 py-2 font-bold text-accent">{item.ticker}</td>
                    <td className="px-3 py-2">{item.company_name}</td>
                    <td className="px-3 py-2 text-text-secondary">{item.sector}</td>
                    <td className="px-3 py-2">${item.price?.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      {item.buy_below_price != null
                        ? <span className={atBuyBelow ? 'text-pass font-bold' : 'text-text-secondary'}>
                            ${item.buy_below_price.toFixed(2)}
                          </span>
                        : <span className="text-text-secondary">—</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      {item.target_buy_price != null
                        ? <span className={atTarget ? 'text-pass font-bold' : 'text-text-secondary'}>
                            ${item.target_buy_price.toFixed(2)}
                          </span>
                        : <span className="text-text-secondary">—</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      {item.discount_to_iv_pct != null
                        ? <span className={item.discount_to_iv_pct > 0 ? 'text-pass' : 'text-fail'}>
                            {item.discount_to_iv_pct > 0 ? '+' : ''}{item.discount_to_iv_pct.toFixed(1)}%
                          </span>
                        : <span className="text-text-secondary">—</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      {atBuyBelow
                        ? <span className="text-pass font-bold text-xs px-2 py-0.5 rounded bg-pass/15">BUY</span>
                        : atTarget
                          ? <span className="text-warn font-bold text-xs px-2 py-0.5 rounded bg-warn/15">TARGET</span>
                          : <span className="text-text-secondary text-xs">WAIT</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      <InsiderBadge signal={item.insider_signal} details={item.insider_details} />
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{item.added_date}</td>
                    <td className="px-3 py-2 text-text-secondary max-w-48 truncate" title={item.notes}>
                      {item.notes || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleRemove(item.ticker)}
                        className="text-xs px-2 py-1 rounded text-fail/70 hover:text-fail hover:bg-fail/10 transition-colors"
                        title="Remove from watchlist"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function InsiderBadge({ signal, details }) {
  if (!signal) return <span className="text-text-secondary text-xs">—</span>
  const styles = {
    strong_buy: 'text-pass bg-pass/15',
    caution: 'text-fail bg-fail/15',
    neutral: 'text-text-secondary bg-surface-tertiary',
  }
  const labels = { strong_buy: 'BUY', caution: 'WARN', neutral: 'NEU' }
  return (
    <span
      className={`text-xs font-bold px-2 py-0.5 rounded cursor-help ${styles[signal] || styles.neutral}`}
      title={details || ''}
    >
      {labels[signal] || signal}
    </span>
  )
}
