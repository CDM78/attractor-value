import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSignalStore } from '../../stores/signalStore'
import { useEnvironmentStore } from '../../stores/environmentStore'
import { usePortfolioStore } from '../../stores/portfolioStore'
import { API_BASE } from '../../config.js'
import TierBadge from './TierBadge'

export default function Dashboard() {
  const { buySignals, notYetSignals, positions, loading: sigLoading, error: sigError, fetchSignals } = useSignalStore()
  const { environment, regimes, loading: envLoading, error: envError, fetchEnvironment } = useEnvironmentStore()
  const { holdings, summary, loading: pfLoading, error: pfError, fetchHoldings } = usePortfolioStore()
  const [toast, setToast] = useState(null)
  const [actedSignals, setActedSignals] = useState(new Set())

  useEffect(() => {
    fetchSignals()
    fetchEnvironment()
    fetchHoldings()
  }, [fetchSignals, fetchEnvironment, fetchHoldings])

  const loading = sigLoading || envLoading || pfLoading
  const error = sigError || envError || pfError

  if (loading) return <div className="text-text-secondary">Loading dashboard...</div>
  if (error) return <div className="text-fail">Error: {error}</div>

  const showToast = (msg, type = 'pass') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const executeBuy = async (signal) => {
    try {
      const res = await fetch(`${API_BASE}/api/portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: signal.ticker,
          tier: signal.tier || 'core',
          shares: signal.shares,
          cost_basis_per_share: signal.price,
          purchase_date: new Date().toISOString().split('T')[0],
          purchase_thesis: signal.action || `Buy signal: ${signal.confidence}`,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setActedSignals(prev => new Set([...prev, signal.ticker]))
      showToast(`Bought ${signal.shares} shares of ${signal.ticker}`)
      fetchHoldings()
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'fail')
    }
  }

  // Separate sell signals from buy signals (if any come through)
  const sellSignals = buySignals.filter(s => s.type === 'SELL')
  const activeBuySignals = buySignals.filter(s => s.type !== 'SELL')

  const envColor = environment === 'STRESSED' ? 'bg-fail/15 text-fail'
    : environment === 'CAUTIOUS' ? 'bg-warn/15 text-warn'
    : 'bg-pass/15 text-pass'

  const activeRegimeCount = regimes?.active?.length || 0

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded text-sm font-medium shadow-lg ${
          toast.type === 'pass' ? 'bg-pass/90 text-white' : 'bg-fail/90 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* A. Portfolio Summary Bar */}
      <div className="bg-surface-secondary rounded p-4 flex flex-wrap items-center gap-4 text-sm">
        <div>
          <span className="text-text-secondary">Total Value: </span>
          <span className="text-text-primary font-bold">${fmt(summary?.total_value)}</span>
        </div>
        <span className="text-border hidden md:inline">|</span>
        <div>
          <span className="text-text-secondary">Cash: </span>
          <span className="text-text-primary font-bold">
            ${fmt(summary?.cash_value || 0)}
            {summary?.total_value > 0 && ` (${((summary?.cash_value || 0) / summary.total_value * 100).toFixed(0)}%)`}
          </span>
        </div>
        <span className="text-border hidden md:inline">|</span>
        <div>
          <span className="text-text-secondary">Environment: </span>
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${envColor}`}>{environment}</span>
        </div>
        <span className="text-border hidden md:inline">|</span>
        <div>
          <span className="text-text-secondary">Regimes: </span>
          <span className="text-text-primary font-bold">{activeRegimeCount}</span>
        </div>
      </div>

      {/* B. Active Signals Panel */}
      <div className="space-y-4">
        {/* BUY SIGNALS */}
        {activeBuySignals.length > 0 && (
          <div className="bg-surface-secondary rounded overflow-hidden">
            <div className="bg-pass/15 px-4 py-2 border-b border-pass/20">
              <h3 className="text-pass font-bold text-sm">BUY SIGNALS ({activeBuySignals.length})</h3>
            </div>
            <div className="divide-y divide-border/50">
              {activeBuySignals.map((s) => (
                <div key={s.ticker} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link to={`/analyze/${s.ticker}`} className="text-accent font-bold hover:underline shrink-0">
                      {s.ticker}
                    </Link>
                    <span className="text-text-secondary text-sm truncate">{s.company_name}</span>
                    <TierBadge tier={s.tier} />
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      s.confidence === 'STRONG' ? 'bg-pass/15 text-pass' : 'bg-accent/15 text-accent'
                    }`}>
                      {s.confidence || 'STANDARD'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-text-secondary flex-wrap">
                    <span>Price: <span className="text-text-primary">${s.price?.toFixed(2)}</span></span>
                    <span>Buy-below: <span className="text-pass">${s.buy_below?.toFixed(2)}</span></span>
                    {s.iv && <span>IV: <span className="text-text-primary">${s.iv?.toFixed(0)}</span></span>}
                  </div>
                  <div className="md:ml-auto flex items-center gap-3">
                    <span className="text-sm text-text-secondary">{s.action}</span>
                    {!actedSignals.has(s.ticker) ? (
                      <button
                        onClick={() => executeBuy(s)}
                        className="text-xs px-3 py-1.5 rounded bg-pass/20 text-pass hover:bg-pass/30 transition-colors font-medium shrink-0"
                      >
                        EXECUTE BUY
                      </button>
                    ) : (
                      <span className="text-xs px-3 py-1.5 rounded bg-pass/10 text-pass/60">Executed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SELL SIGNALS */}
        {sellSignals.length > 0 && (
          <div className="bg-surface-secondary rounded overflow-hidden">
            <div className="bg-fail/15 px-4 py-2 border-b border-fail/20">
              <h3 className="text-fail font-bold text-sm">SELL SIGNALS ({sellSignals.length})</h3>
            </div>
            <div className="divide-y divide-border/50">
              {sellSignals.map((s) => (
                <div key={s.ticker} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                  <div className="flex items-center gap-2">
                    <Link to={`/analyze/${s.ticker}`} className="text-accent font-bold hover:underline">
                      {s.ticker}
                    </Link>
                    <span className="text-fail text-sm">{s.sell_reason}</span>
                  </div>
                  <span className="text-sm text-text-secondary md:ml-auto">{s.action}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* NOT YET */}
        {notYetSignals.length > 0 && (
          <div className="bg-surface-secondary rounded overflow-hidden">
            <div className="bg-warn/15 px-4 py-2 border-b border-warn/20">
              <h3 className="text-warn font-bold text-sm">NOT YET ({notYetSignals.length})</h3>
            </div>
            <div className="px-4 py-2">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {notYetSignals.map((s) => {
                  const pctNeeded = s.target_price && s.current_price
                    ? ((s.target_price - s.current_price) / s.current_price * 100)
                    : null
                  return (
                    <div key={s.ticker} className="flex items-center gap-2 text-sm py-1">
                      <Link to={`/analyze/${s.ticker}`} className="text-accent font-medium hover:underline">
                        {s.ticker}
                      </Link>
                      <span className="text-text-secondary">${s.current_price?.toFixed(2)}</span>
                      <span className="text-text-secondary">&rarr;</span>
                      <span className="text-warn">${s.target_price?.toFixed(2)}</span>
                      {pctNeeded != null && (
                        <span className="text-xs text-warn/70">({pctNeeded.toFixed(0)}%)</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {activeBuySignals.length === 0 && sellSignals.length === 0 && notYetSignals.length === 0 && (
          <div className="bg-surface-secondary rounded p-8 text-center text-text-secondary">
            No active signals. Run a refresh to check for new opportunities.
          </div>
        )}
      </div>

      {/* C. Holdings Table */}
      <div>
        <h2 className="text-xl font-bold mb-4">Holdings</h2>
        {holdings.length === 0 ? (
          <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
            No positions yet. Visit <Link to="/portfolio" className="text-accent hover:underline">Portfolio</Link> to add holdings.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-secondary text-left">
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2">Shares</th>
                  <th className="px-3 py-2">Cost Basis</th>
                  <th className="px-3 py-2">Current Value</th>
                  <th className="px-3 py-2">Gain %</th>
                  <th className="px-3 py-2">% of Portfolio</th>
                  <th className="px-3 py-2">Signal</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const weight = summary?.total_value > 0
                    ? (h.current_value / summary.total_value * 100) : 0
                  const overweight = (h.tier === 'core' && weight > 12) || (h.tier === 'asymmetric' && weight > 5)
                  // Check if there's a matching signal
                  const hasSignal = buySignals.find(s => s.ticker === h.ticker)

                  return (
                    <tr key={h.id} className="border-b border-border/50 hover:bg-surface-secondary">
                      <td className="px-3 py-2 font-bold">
                        <Link to={`/analyze/${h.ticker}`} className="text-accent hover:underline">{h.ticker}</Link>
                      </td>
                      <td className="px-3 py-2">
                        <TierBadge tier={h.tier} />
                      </td>
                      <td className="px-3 py-2">{h.shares}</td>
                      <td className="px-3 py-2">${h.cost_basis_per_share?.toFixed(2)}</td>
                      <td className="px-3 py-2">${h.current_value?.toFixed(0)}</td>
                      <td className="px-3 py-2">
                        <span className={h.gain_loss_pct >= 0 ? 'text-pass' : 'text-fail'}>
                          {h.gain_loss_pct >= 0 ? '+' : ''}{h.gain_loss_pct?.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={overweight ? 'text-warn font-bold' : 'text-text-secondary'}>
                          {weight.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {hasSignal ? (
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            hasSignal.type === 'SELL' ? 'bg-fail/10 text-fail'
                            : overweight ? 'bg-warn/10 text-warn'
                            : 'bg-pass/10 text-pass'
                          }`}>
                            {hasSignal.type === 'SELL' ? 'SELL' : overweight ? 'TRIM' : 'HOLD'}
                          </span>
                        ) : (
                          <span className="text-text-secondary text-xs">--</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* D. Allocation Overview */}
      {summary && holdings.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4">Allocation Overview</h2>
          <div className="bg-surface-secondary rounded p-4">
            <AllocationBar
              label="Cash"
              current={summary.cash_pct || 0}
              target={20}
            />
            <AllocationBar
              label="T2 Crisis"
              current={getTierPct(holdings, summary, 'T2')}
              target={30}
            />
            <AllocationBar
              label="T3 DKS"
              current={getTierPct(holdings, summary, 'T3')}
              target={30}
            />
            <AllocationBar
              label="T4 Regime"
              current={getTierPct(holdings, summary, 'T4')}
              target={20}
            />
            <AllocationBar
              label="Core"
              current={summary.core_pct || 0}
              target={70}
            />
            <AllocationBar
              label="Asymmetric"
              current={summary.asymmetric_pct || 0}
              target={30}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function AllocationBar({ label, current, target }) {
  const diff = current - target
  const overAllocated = diff > 5
  const underAllocated = diff < -5

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-sm text-text-secondary w-24 shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-surface-tertiary rounded overflow-hidden relative">
        <div
          className={`h-full rounded transition-all ${
            overAllocated ? 'bg-warn' : underAllocated ? 'bg-accent/50' : 'bg-pass/70'
          }`}
          style={{ width: `${Math.min(current, 100)}%` }}
        />
        {/* Target marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-text-secondary/50"
          style={{ left: `${Math.min(target, 100)}%` }}
        />
      </div>
      <span className={`text-sm w-20 text-right shrink-0 ${
        overAllocated ? 'text-warn' : underAllocated ? 'text-accent' : 'text-text-secondary'
      }`}>
        {current.toFixed(0)}% / {target}%
      </span>
    </div>
  )
}

function getTierPct(holdings, summary, tierPrefix) {
  if (!summary?.total_value || summary.total_value === 0) return 0
  const tierValue = holdings
    .filter(h => (h.tier || '').toUpperCase().startsWith(tierPrefix))
    .reduce((sum, h) => sum + (h.current_value || 0), 0)
  return (tierValue / summary.total_value) * 100
}

function fmt(n) {
  if (n == null) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toFixed(0)
}
