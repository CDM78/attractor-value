import { useEffect, useState } from 'react'
import { API_BASE } from '../../config.js'

export default function TransactionHistory() {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      const url = filter
        ? `${API_BASE}/api/transactions?ticker=${filter.toUpperCase()}`
        : `${API_BASE}/api/transactions`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setTransactions(await res.json())
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchTransactions()
  }, [])

  const handleFilter = (e) => {
    e.preventDefault()
    fetchTransactions()
  }

  if (loading) return <div className="text-text-secondary">Loading transactions...</div>
  if (error) return <div className="text-fail">Error: {error}</div>

  // Summary stats
  const totalBought = transactions
    .filter(t => t.action === 'buy')
    .reduce((s, t) => s + t.shares * t.price_per_share, 0)
  const totalSold = transactions
    .filter(t => t.action !== 'buy')
    .reduce((s, t) => s + t.shares * t.price_per_share, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Transaction History</h2>
        <form onSubmit={handleFilter} className="flex gap-2">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by ticker"
            className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-28"
          />
          <button type="submit"
            className="text-sm px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors">
            Filter
          </button>
          {filter && (
            <button type="button" onClick={() => { setFilter(''); setTimeout(fetchTransactions, 0) }}
              className="text-sm px-3 py-1.5 rounded text-text-secondary hover:text-text-primary">
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-surface-secondary rounded p-3">
          <span className="text-xs text-text-secondary block">Total Bought</span>
          <span className="text-lg font-bold text-text-primary">${totalBought.toFixed(0)}</span>
        </div>
        <div className="bg-surface-secondary rounded p-3">
          <span className="text-xs text-text-secondary block">Total Sold</span>
          <span className="text-lg font-bold text-text-primary">${totalSold.toFixed(0)}</span>
        </div>
        <div className="bg-surface-secondary rounded p-3">
          <span className="text-xs text-text-secondary block">Transactions</span>
          <span className="text-lg font-bold text-text-primary">{transactions.length}</span>
        </div>
      </div>

      {transactions.length === 0 ? (
        <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
          No transactions recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary text-left">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Ticker</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Shares</th>
                <th className="px-3 py-2">Price</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id} className="border-b border-border/50 hover:bg-surface-secondary">
                  <td className="px-3 py-2 text-text-secondary">{t.transaction_date}</td>
                  <td className="px-3 py-2 font-bold text-accent">{t.ticker}</td>
                  <td className="px-3 py-2">{t.company_name}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      t.action === 'buy' ? 'bg-pass/15 text-pass'
                      : t.action === 'trim' ? 'bg-warn/15 text-warn'
                      : 'bg-fail/15 text-fail'
                    }`}>{t.action.toUpperCase()}</span>
                  </td>
                  <td className="px-3 py-2">{t.shares}</td>
                  <td className="px-3 py-2">${t.price_per_share.toFixed(2)}</td>
                  <td className="px-3 py-2">${(t.shares * t.price_per_share).toFixed(0)}</td>
                  <td className="px-3 py-2 text-text-secondary text-xs max-w-48 truncate" title={t.reason}>
                    {t.reason ? t.reason.replace(/_/g, ' ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
