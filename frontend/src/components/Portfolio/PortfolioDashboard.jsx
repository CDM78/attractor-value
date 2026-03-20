import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePortfolioStore } from '../../stores/portfolioStore'
import InfoTooltip from '../shared/InfoTooltip'

export default function PortfolioDashboard() {
  const { holdings, summary, alerts, loading, error, fetchHoldings, fetchAlerts, addPosition, sellPosition, dismissAlert } = usePortfolioStore()
  const [showAdd, setShowAdd] = useState(false)
  const [sellModal, setSellModal] = useState(null)

  useEffect(() => {
    fetchHoldings()
    fetchAlerts()
  }, [fetchHoldings, fetchAlerts])

  if (loading) return <div className="text-text-secondary">Loading portfolio...</div>
  if (error) return <div className="text-fail">Error: {error}</div>

  return (
    <div className="space-y-6">
      {/* Alerts Banner */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(a => (
            <div key={a.id} className={`flex items-center justify-between px-4 py-2 rounded text-sm ${
              a.alert_type?.includes('caution') || a.alert_type?.includes('overweight')
                ? 'bg-fail/10 border border-fail/30 text-fail'
                : 'bg-warn/10 border border-warn/30 text-warn'
            }`}>
              <span>{a.ticker ? `[${a.ticker}] ` : ''}{a.message}</span>
              <button
                onClick={async () => { await dismissAlert(a.id); fetchAlerts() }}
                className="text-xs opacity-60 hover:opacity-100 ml-4"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Total Value" value={`$${fmt(summary.total_value)}`} />
          <SummaryCard
            label="Total Gain/Loss"
            value={`${summary.total_gain_pct >= 0 ? '+' : ''}${summary.total_gain_pct.toFixed(1)}%`}
            color={summary.total_gain_pct >= 0 ? 'text-pass' : 'text-fail'}
          />
          <SummaryCard label="Core / Asym" value={`${summary.core_pct.toFixed(0)}% / ${summary.asymmetric_pct.toFixed(0)}%`} />
          <SummaryCard label="Positions" value={summary.positions_count} />
        </div>
      )}

      {/* Sector Breakdown */}
      {summary?.sectors && Object.keys(summary.sectors).length > 0 && (
        <div className="bg-surface-secondary rounded p-4">
          <h3 className="text-sm font-bold text-text-secondary mb-3">Sector Allocation</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.sectors)
              .sort((a, b) => b[1] - a[1])
              .map(([sector, value]) => (
                <span key={sector} className={`text-xs px-2 py-1 rounded ${
                  summary.total_value > 0 && (value / summary.total_value * 100) > 25
                    ? 'bg-warn/15 text-warn'
                    : 'bg-surface-tertiary text-text-secondary'
                }`}>
                  {sector}: {summary.total_value > 0 ? (value / summary.total_value * 100).toFixed(0) : 0}%
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Holdings Table */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Holdings</h2>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-sm px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
          >
            {showAdd ? 'Cancel' : '+ Add Position'}
          </button>
        </div>

        {showAdd && <AddPositionForm onAdd={async (pos) => {
          await addPosition(pos)
          setShowAdd(false)
          fetchHoldings()
        }} />}

        {holdings.length === 0 ? (
          <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
            No positions yet. Add your first holding above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-secondary text-left">
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Tier<InfoTooltip termKey="core_holding" /></th>
                  <th className="px-3 py-2">Shares</th>
                  <th className="px-3 py-2">Avg Cost</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Gain/Loss</th>
                  <th className="px-3 py-2">IV<InfoTooltip termKey="adjusted_iv" /></th>
                  <th className="px-3 py-2">Attractor<InfoTooltip termKey="attractor_score" /></th>
                  <th className="px-3 py-2">Weight</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const weight = summary?.total_value > 0
                    ? (h.current_value / summary.total_value * 100) : 0;
                  const overweight = (h.tier === 'core' && weight > 12) || (h.tier === 'asymmetric' && weight > 5);
                  return (
                    <tr key={h.id} className="border-b border-border/50 hover:bg-surface-secondary">
                      <td className="px-3 py-2 font-bold">
                        <Link to={`/analyze/${h.ticker}`} className="text-accent hover:underline">{h.ticker}</Link>
                      </td>
                      <td className="px-3 py-2">{h.company_name}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          h.tier === 'core' ? 'bg-accent/15 text-accent' : 'bg-warn/15 text-warn'
                        }`}>{h.tier}</span>
                      </td>
                      <td className="px-3 py-2">{h.shares}</td>
                      <td className="px-3 py-2">${h.cost_basis_per_share.toFixed(2)}</td>
                      <td className="px-3 py-2">${h.price?.toFixed(2)}</td>
                      <td className="px-3 py-2">${h.current_value?.toFixed(0)}</td>
                      <td className="px-3 py-2">
                        <span className={h.gain_loss_pct >= 0 ? 'text-pass' : 'text-fail'}>
                          {h.gain_loss_pct >= 0 ? '+' : ''}{h.gain_loss_pct?.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {h.adjusted_intrinsic_value
                          ? <span className={h.price <= h.adjusted_intrinsic_value ? 'text-pass' : 'text-fail'}>
                              ${h.adjusted_intrinsic_value.toFixed(0)}
                            </span>
                          : <span className="text-text-secondary">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {h.attractor_stability_score != null
                          ? <span className={
                              h.attractor_stability_score >= 3.5 ? 'text-pass'
                              : h.attractor_stability_score >= 2.0 ? 'text-warn'
                              : 'text-fail'
                            }>{h.attractor_stability_score.toFixed(1)}</span>
                          : <span className="text-text-secondary">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={overweight ? 'text-warn font-bold' : 'text-text-secondary'}>
                          {weight.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setSellModal(h)}
                          className="text-xs px-2 py-1 rounded text-text-secondary hover:text-fail hover:bg-fail/10 transition-colors"
                        >
                          Sell
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

      {/* Sell Modal */}
      {sellModal && <SellModal
        holding={sellModal}
        onClose={() => setSellModal(null)}
        onSell={async (action, shares, price, reason) => {
          await sellPosition(sellModal.id, action, shares, price, reason)
          setSellModal(null)
          fetchHoldings()
        }}
      />}
    </div>
  )
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="bg-surface-secondary rounded p-4">
      <span className="text-xs text-text-secondary block mb-1">{label}</span>
      <span className={`text-lg font-bold ${color || 'text-text-primary'}`}>{value}</span>
    </div>
  )
}

function AddPositionForm({ onAdd }) {
  const [form, setForm] = useState({
    ticker: '', tier: 'core', shares: '', cost_basis_per_share: '',
    purchase_date: new Date().toISOString().split('T')[0], purchase_thesis: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onAdd({
        ...form,
        ticker: form.ticker.trim().toUpperCase(),
        shares: parseFloat(form.shares),
        cost_basis_per_share: parseFloat(form.cost_basis_per_share),
      })
    } catch (err) {
      alert(`Failed: ${err.message}`)
    }
    setSubmitting(false)
  }

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  return (
    <form onSubmit={handleSubmit} className="bg-surface-secondary rounded p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
      <div>
        <label className="block text-xs text-text-secondary mb-1">Ticker</label>
        <input type="text" value={form.ticker} onChange={set('ticker')} required
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full" />
      </div>
      <div>
        <label className="block text-xs text-text-secondary mb-1">Tier</label>
        <select value={form.tier} onChange={set('tier')}
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full">
          <option value="core">Core</option>
          <option value="asymmetric">Asymmetric</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-text-secondary mb-1">Shares</label>
        <input type="number" step="0.01" value={form.shares} onChange={set('shares')} required
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full" />
      </div>
      <div>
        <label className="block text-xs text-text-secondary mb-1">Cost/Share</label>
        <input type="number" step="0.01" value={form.cost_basis_per_share} onChange={set('cost_basis_per_share')} required
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full" />
      </div>
      <div>
        <label className="block text-xs text-text-secondary mb-1">Purchase Date</label>
        <input type="date" value={form.purchase_date} onChange={set('purchase_date')} required
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full" />
      </div>
      <div className="col-span-2">
        <label className="block text-xs text-text-secondary mb-1">Purchase Thesis</label>
        <input type="text" value={form.purchase_thesis} onChange={set('purchase_thesis')} placeholder="Why are you buying?"
          className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full" />
      </div>
      <div className="flex items-end">
        <button type="submit" disabled={submitting}
          className="px-4 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent/80 transition-colors disabled:opacity-50 w-full">
          {submitting ? 'Adding...' : 'Add Position'}
        </button>
      </div>
    </form>
  )
}

function SellModal({ holding, onClose, onSell }) {
  const [shares, setShares] = useState(holding.shares.toString())
  const [price, setPrice] = useState(holding.price?.toFixed(2) || '')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const action = parseFloat(shares) >= holding.shares ? 'sell' : 'trim'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onSell(action, parseFloat(shares), parseFloat(price), reason)
    } catch (err) {
      alert(`Failed: ${err.message}`)
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface-secondary rounded-lg p-6 w-96 max-w-full" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">
          {action === 'sell' ? 'Sell' : 'Trim'} {holding.ticker}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Shares to sell (holding: {holding.shares})</label>
            <input type="number" step="0.01" max={holding.shares} value={shares}
              onChange={e => setShares(e.target.value)} required
              className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Price per share</label>
            <input type="number" step="0.01" value={price}
              onChange={e => setPrice(e.target.value)} required
              className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Reason</label>
            <select value={reason} onChange={e => setReason(e.target.value)}
              className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full">
              <option value="">Select reason...</option>
              <option value="price_exceeds_iv">Price exceeds intrinsic value</option>
              <option value="attractor_dissolution">Attractor dissolution</option>
              <option value="thesis_violation">Thesis violation</option>
              <option value="better_opportunity">Better opportunity</option>
              <option value="concentration_creep">Concentration creep (rebalance)</option>
              <option value="adjacent_possible_invalidation">Adjacent possible invalidation</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded bg-surface-tertiary text-text-secondary text-sm hover:bg-border transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 px-4 py-2 rounded bg-fail/80 text-white text-sm hover:bg-fail transition-colors disabled:opacity-50">
              {submitting ? 'Processing...' : `${action === 'sell' ? 'Sell All' : 'Trim'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function fmt(n) {
  if (n == null) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toFixed(0)
}
