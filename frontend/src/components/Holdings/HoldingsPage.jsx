import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePortfolioStore } from '../../stores/portfolioStore'
import { API_BASE } from '../../config.js'
import TierBadge from '../Dashboard/TierBadge'

export default function HoldingsPage() {
  const { holdings, summary, loading, error, fetchHoldings } = usePortfolioStore()
  const [sellSignals, setSellSignals] = useState([])
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    fetchHoldings()
    fetchSellSignals()
  }, [fetchHoldings])

  async function fetchSellSignals() {
    try {
      const res = await fetch(`${API_BASE}/api/sell-check`)
      if (res.ok) {
        const data = await res.json()
        setSellSignals(data.signals || [])
      }
    } catch { /* ignore */ }
  }

  if (loading) return <div className="text-text-secondary p-8">Loading holdings...</div>
  if (error) return <div className="text-fail p-8">Error: {error}</div>

  const totalValue = summary?.total_value || 0
  const totalCostBasis = holdings.reduce((s, h) => s + (h.cost_basis_per_share * h.shares), 0)
  const totalGain = totalValue - totalCostBasis
  const totalGainPct = totalCostBasis > 0 ? (totalGain / totalCostBasis * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Holdings</h1>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-3 py-1.5 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
        >
          {showAdd ? 'Cancel' : '+ Add Position'}
        </button>
      </div>

      {showAdd && <AddPositionForm onAdd={() => { setShowAdd(false); fetchHoldings() }} />}

      {/* Sell/Trim Alerts */}
      {sellSignals.length > 0 && (
        <div className="space-y-2">
          {sellSignals.map((s, i) => (
            <div key={i} className={`flex items-center justify-between px-4 py-3 rounded text-sm ${
              s.type === 'SELL' ? 'bg-fail/10 border border-fail/30 text-fail' : 'bg-warn/10 border border-warn/30 text-warn'
            }`}>
              <div>
                <span className="font-bold">{s.ticker}</span> — {s.label}: {s.reason}
                <div className="text-xs mt-1 opacity-80">{s.action}</div>
                {s.tax_note && <div className="text-xs mt-1 opacity-70">{s.tax_note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      {holdings.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Total Value" value={`$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <SummaryCard
            label="Total Gain/Loss"
            value={`${totalGainPct >= 0 ? '+' : ''}${totalGainPct.toFixed(1)}%`}
            color={totalGainPct >= 0 ? 'text-pass' : 'text-fail'}
          />
          <SummaryCard label="Positions" value={holdings.length} />
          <SummaryCard label="Cost Basis" value={`$${totalCostBasis.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        </div>
      )}

      {/* Holdings Table */}
      {holdings.length === 0 ? (
        <div className="bg-surface-secondary rounded p-8 text-center text-text-secondary">
          No positions yet. BUY signals from the{' '}
          <Link to="/dashboard" className="text-accent hover:underline">Dashboard</Link>{' '}
          will appear when the pipeline identifies opportunities.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary text-left">
                <th className="px-3 py-2">Ticker</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Shares</th>
                <th className="px-3 py-2">Avg Cost</th>
                <th className="px-3 py-2">Current</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Gain %</th>
                <th className="px-3 py-2">Weight</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map(h => {
                const currentValue = h.current_value || (h.shares * h.cost_basis_per_share)
                const gainPct = h.cost_basis_per_share > 0
                  ? ((currentValue / h.shares - h.cost_basis_per_share) / h.cost_basis_per_share * 100) : 0
                const weight = totalValue > 0 ? (currentValue / totalValue * 100) : 0
                const overweight = weight > 8
                const sell = sellSignals.find(s => s.ticker === h.ticker)

                return (
                  <tr key={h.id} className="border-b border-border/50 hover:bg-surface-secondary">
                    <td className="px-3 py-2 font-bold">
                      <Link to={`/analyze/${h.ticker}`} className="text-accent hover:underline">{h.ticker}</Link>
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge tier={h.tier || h.discovery_tier} />
                    </td>
                    <td className="px-3 py-2">{h.shares}</td>
                    <td className="px-3 py-2">${h.cost_basis_per_share?.toFixed(2)}</td>
                    <td className="px-3 py-2">${(currentValue / h.shares).toFixed(2)}</td>
                    <td className="px-3 py-2">${currentValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="px-3 py-2">
                      <span className={gainPct >= 0 ? 'text-pass' : 'text-fail'}>
                        {gainPct >= 0 ? '+' : ''}{gainPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={overweight ? 'text-warn font-bold' : 'text-text-secondary'}>
                        {weight.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {sell ? (
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          sell.type === 'SELL' ? 'bg-fail/15 text-fail' : 'bg-warn/15 text-warn'
                        }`}>
                          {sell.label}
                        </span>
                      ) : overweight ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-warn/15 text-warn">Overweight</span>
                      ) : (
                        <span className="text-xs text-pass">HOLD</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Transaction History */}
      <div>
        <h2 className="text-lg font-bold mb-3">Recent Transactions</h2>
        <Link to="/transactions" className="text-sm text-accent hover:underline">View full history</Link>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="bg-surface-secondary rounded p-4">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className={`text-xl font-bold mt-1 ${color || 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

function AddPositionForm({ onAdd }) {
  const [ticker, setTicker] = useState('')
  const [shares, setShares] = useState('')
  const [price, setPrice] = useState('')
  const [tier, setTier] = useState('tier3')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          shares: parseFloat(shares),
          price: parseFloat(price),
          tier,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onAdd()
    } catch (err) {
      alert(`Error: ${err.message}`)
    }
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-secondary rounded p-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="text-xs text-text-secondary block mb-1">Ticker</label>
        <input value={ticker} onChange={e => setTicker(e.target.value)} required
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm w-24 text-text-primary" />
      </div>
      <div>
        <label className="text-xs text-text-secondary block mb-1">Shares</label>
        <input type="number" value={shares} onChange={e => setShares(e.target.value)} required
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm w-20 text-text-primary" />
      </div>
      <div>
        <label className="text-xs text-text-secondary block mb-1">Price</label>
        <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} required
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm w-24 text-text-primary" />
      </div>
      <div>
        <label className="text-xs text-text-secondary block mb-1">Tier</label>
        <select value={tier} onChange={e => setTier(e.target.value)}
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary">
          <option value="tier2">T2 Crisis</option>
          <option value="tier3">T3 DKS</option>
          <option value="tier4">T4 Regime</option>
        </select>
      </div>
      <button type="submit" disabled={submitting}
        className="text-xs px-4 py-1.5 rounded bg-pass/20 text-pass hover:bg-pass/30 transition-colors disabled:opacity-50">
        {submitting ? 'Adding...' : 'Add'}
      </button>
    </form>
  )
}
