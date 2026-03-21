import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSignalStore } from '../../stores/signalStore'
import { useEnvironmentStore } from '../../stores/environmentStore'
import { usePortfolioStore } from '../../stores/portfolioStore'
import { API_BASE } from '../../config.js'
import TierBadge from './TierBadge'

export default function Dashboard() {
  const { buySignals, notYetSignals, positions, loading: sigLoading, error: sigError, fetchSignals, analyzingId, triggerDeepAnalysis } = useSignalStore()
  const { environment, crisis, regimes, loading: envLoading, error: envError, fetchEnvironment } = useEnvironmentStore()
  const { holdings, summary, loading: pfLoading, error: pfError, fetchHoldings } = usePortfolioStore()
  const [toast, setToast] = useState(null)
  const [actedSignals, setActedSignals] = useState(new Set())
  const [sellSignals, setSellSignals] = useState([])

  useEffect(() => {
    fetchSignals()
    fetchEnvironment()
    fetchHoldings()
    fetchSellSignals()
  }, [fetchSignals, fetchEnvironment, fetchHoldings])

  async function fetchSellSignals() {
    try {
      const res = await fetch(`${API_BASE}/api/sell-check`)
      if (res.ok) {
        const data = await res.json()
        setSellSignals(data.signals || [])
      }
    } catch { /* ignore */ }
  }

  const loading = sigLoading || envLoading || pfLoading
  const error = sigError || envError || pfError

  if (loading) return <div className="text-text-secondary p-8">Loading dashboard...</div>

  const showToast = (msg, type = 'pass') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 5000)
  }

  const executeBuy = async (signal) => {
    try {
      const res = await fetch(`${API_BASE}/api/portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: signal.ticker,
          tier: signal.discovery_tier || 'tier3',
          shares: signal.recommended_shares || 1,
          cost_basis_per_share: signal.current_price,
          purchase_date: new Date().toISOString().split('T')[0],
          purchase_thesis: `${signal.signal_confidence || 'STANDARD'} BUY via ${signal.discovery_tier}`,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setActedSignals(prev => new Set([...prev, signal.ticker]))
      showToast(`Bought ${signal.recommended_shares || '?'} shares of ${signal.ticker}`)
      fetchHoldings()
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'fail')
    }
  }

  const envColor = environment === 'STRESSED' ? 'bg-fail/15 text-fail'
    : environment === 'CAUTIOUS' ? 'bg-warn/15 text-warn'
    : 'bg-pass/15 text-pass'

  const totalValue = summary?.total_value || 0
  const cashPct = summary?.total_value > 0 ? ((summary.cash_balance || 0) / summary.total_value * 100) : 100

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded text-sm font-medium shadow-lg ${
          toast.type === 'pass' ? 'bg-pass/90 text-white' : 'bg-fail/90 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {error && <div className="text-fail text-sm bg-fail/10 rounded px-4 py-2">Error: {error}</div>}

      {/* A. Portfolio Summary Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-surface-secondary rounded px-4 py-3">
        <div className="text-sm">
          <span className="text-text-secondary">Value: </span>
          <span className="font-bold text-text-primary">${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
        <div className="text-sm">
          <span className="text-text-secondary">Cash: </span>
          <span className="text-text-primary">{cashPct.toFixed(0)}%</span>
        </div>
        <span className={`text-xs px-2 py-1 rounded font-medium ${envColor}`}>
          {environment}
        </span>
        {crisis?.crisis_active && (
          <span className="text-xs px-2 py-1 rounded bg-fail/15 text-fail font-medium">
            CRISIS ({crisis.severity})
          </span>
        )}
        {(regimes?.active_count || regimes?.active?.length || 0) > 0 && (
          <span className="text-xs px-2 py-1 rounded bg-purple-500/15 text-purple-400">
            {regimes.active_count || regimes.active?.length} Active Regime{(regimes.active_count || regimes.active?.length) !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* B. Active Signals Panel */}
      <div className="space-y-4">
        {/* BUY SIGNALS */}
        {buySignals.length > 0 && (
          <div className="bg-surface-secondary rounded overflow-hidden">
            <div className="bg-pass/15 px-4 py-2 border-b border-pass/20">
              <h3 className="text-pass font-bold text-sm">BUY SIGNALS ({buySignals.length})</h3>
            </div>
            <div className="divide-y divide-border/50">
              {buySignals.map((s) => (
                <div key={s.id || s.ticker} className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={`/analyze/${s.ticker}`} className="text-accent font-bold hover:underline">
                      {s.ticker}
                    </Link>
                    <span className="text-text-secondary text-sm truncate">{s.company_name}</span>
                    <TierBadge tier={s.discovery_tier} />
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      s.signal_confidence === 'STRONG' ? 'bg-pass/15 text-pass' : 'bg-accent/15 text-accent'
                    }`}>
                      {s.signal_confidence || 'STANDARD'}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-surface-tertiary text-text-secondary">
                      {s.analysis_model?.includes('opus') ? 'Opus' : 'Sonnet'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-text-secondary flex-wrap">
                    <span>Price: <span className="text-text-primary">${s.current_price?.toFixed(2) || '--'}</span></span>
                    <span>Buy-below: <span className="text-pass">${s.buy_below_price?.toFixed(2) || '--'}</span></span>
                    <span>IV: <span className="text-text-primary">${s.intrinsic_value?.toFixed(2) || '--'}</span></span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {(s.recommended_shares || s.recommended_dollars) && (
                      <span className="text-sm font-medium text-text-primary">
                        Buy {s.recommended_shares || '?'} shares (${s.recommended_dollars?.toFixed(0) || '?'})
                      </span>
                    )}
                    {analyzingId === s.id ? (
                      <span className="text-xs px-3 py-1.5 rounded bg-accent/15 text-accent animate-pulse">Analyzing (Opus)...</span>
                    ) : (
                      <button
                        onClick={async () => {
                          const result = await triggerDeepAnalysis(s.id)
                          if (result?.signal_changed) {
                            setToast({ msg: `Signal changed: ${result.previous_signal} → ${result.new_signal}`, type: 'warn' })
                            setTimeout(() => setToast(null), 8000)
                          } else if (result) {
                            showToast(`Opus confirmed: ${result.new_signal} (score: ${result.attractor_score?.toFixed(1)})`)
                          }
                        }}
                        className="text-xs px-3 py-1.5 rounded bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors font-medium"
                      >
                        DEEP ANALYSIS
                      </button>
                    )}
                    {!actedSignals.has(s.ticker) ? (
                      <button
                        onClick={() => executeBuy(s)}
                        className="text-xs px-3 py-1.5 rounded bg-pass/20 text-pass hover:bg-pass/30 transition-colors font-medium"
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
              <h3 className="text-fail font-bold text-sm">{sellSignals.some(s => s.type === 'TRIM') ? 'SELL / TRIM' : 'SELL'} SIGNALS ({sellSignals.length})</h3>
            </div>
            <div className="divide-y divide-border/50">
              {sellSignals.map((s, i) => (
                <div key={i} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-text-primary">{s.ticker}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      s.type === 'SELL' ? 'bg-fail/15 text-fail' : 'bg-warn/15 text-warn'
                    }`}>
                      {s.type}: {s.label}
                    </span>
                  </div>
                  <span className="text-sm text-text-secondary">{s.reason}</span>
                  <span className="text-sm text-text-primary md:ml-auto">{s.action}</span>
                  {s.tax_note && <span className="text-xs text-text-secondary">{s.tax_note}</span>}
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
                  const targetPrice = s.buy_below_price
                  const currentPrice = s.current_price
                  const pctNeeded = targetPrice && currentPrice
                    ? ((targetPrice - currentPrice) / currentPrice * 100) : null
                  return (
                    <div key={s.id || s.ticker} className="flex items-center gap-2 text-sm py-1">
                      <Link to={`/analyze/${s.ticker}`} className="text-accent font-medium hover:underline">
                        {s.ticker}
                      </Link>
                      <span className="text-text-secondary">${currentPrice?.toFixed(2) || '--'}</span>
                      <span className="text-text-secondary">&rarr;</span>
                      <span className="text-warn">${targetPrice?.toFixed(2) || '--'}</span>
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

        {/* Empty state */}
        {buySignals.length === 0 && sellSignals.length === 0 && notYetSignals.length === 0 && (
          <div className="bg-surface-secondary rounded p-8 text-center text-text-secondary">
            No active signals. Run a{' '}
            <Link to="/admin" className="text-accent hover:underline">Bulk Analysis</Link>{' '}
            to populate the pipeline, or wait for the daily cron to discover candidates.
          </div>
        )}
      </div>

      {/* C. Holdings Table */}
      <div>
        <h2 className="text-xl font-bold mb-4">Holdings</h2>
        {holdings.length === 0 ? (
          <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
            No positions yet. Execute BUY signals above to build your portfolio.
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
                    ? ((h.current_value || 0) / summary.total_value * 100) : 0
                  const overweight = weight > 8
                  const sell = sellSignals.find(s => s.ticker === h.ticker)

                  return (
                    <tr key={h.id} className="border-b border-border/50 hover:bg-surface-secondary">
                      <td className="px-3 py-2 font-bold">
                        <Link to={`/analyze/${h.ticker}`} className="text-accent hover:underline">{h.ticker}</Link>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <TierBadge tier={h.tier || h.discovery_tier} />
                          {h.analysis_model?.includes('opus') && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">Opus</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">{h.shares}</td>
                      <td className="px-3 py-2">${h.cost_basis_per_share?.toFixed(2)}</td>
                      <td className="px-3 py-2">${(h.current_value || 0).toFixed(0)}</td>
                      <td className="px-3 py-2">
                        <span className={(h.gain_loss_pct || 0) >= 0 ? 'text-pass' : 'text-fail'}>
                          {(h.gain_loss_pct || 0) >= 0 ? '+' : ''}{(h.gain_loss_pct || 0).toFixed(1)}%
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
                            sell.type === 'SELL' ? 'bg-fail/10 text-fail' : 'bg-warn/10 text-warn'
                          }`}>
                            {sell.label}
                          </span>
                        ) : overweight ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-warn/10 text-warn">Overweight</span>
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
      </div>

      {/* D. Allocation Overview */}
      <div className="bg-surface-secondary rounded p-4">
        <h3 className="text-sm font-bold text-text-secondary mb-3">Tier Allocation</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'T2 Crisis', target: 15, color: 'bg-blue-500/15 text-blue-400' },
            { label: 'T3 DKS', target: 30, color: 'bg-emerald-500/15 text-emerald-400' },
            { label: 'T4 Regime', target: 20, color: 'bg-purple-500/15 text-purple-400' },
            { label: 'Flexible', target: 30, color: 'bg-accent/15 text-accent' },
            { label: 'Cash', target: 5, color: 'bg-surface-tertiary text-text-secondary' },
          ].map(a => (
            <span key={a.label} className={`text-xs px-2 py-1 rounded ${a.color}`}>
              {a.label}: {a.target}% target
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
