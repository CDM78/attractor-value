import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../../config.js'
import TierBadge from '../Dashboard/TierBadge'

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState({ tier2: [], tier3: [], tier4: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tierFilter, setTierFilter] = useState('all')
  const [sortField, setSortField] = useState(null)
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    fetchAllCandidates()
  }, [])

  async function fetchAllCandidates() {
    setLoading(true)
    setError(null)
    try {
      const [t2, t3, t4] = await Promise.all([
        fetch(`${API_BASE}/api/screen/tier2`).then(r => r.json()),
        fetch(`${API_BASE}/api/screen/tier3`).then(r => r.json()),
        fetch(`${API_BASE}/api/screen/tier4`).then(r => r.json()),
      ])
      setCandidates({
        tier2: t2.candidates || [],
        tier3: t3.candidates || [],
        tier4: t4.candidates || [],
      })
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const allCandidates = [
    ...candidates.tier2.map(c => ({ ...c, discovery_tier: c.discovery_tier || 'tier2' })),
    ...candidates.tier3.map(c => ({ ...c, discovery_tier: c.discovery_tier || 'tier3' })),
    ...candidates.tier4.map(c => ({ ...c, discovery_tier: c.discovery_tier || 'tier4' })),
  ]

  const filtered = tierFilter === 'all'
    ? allCandidates
    : allCandidates.filter(c => c.discovery_tier === tierFilter)

  // Sorting
  const sorted = sortField ? [...filtered].sort((a, b) => {
    const av = a[sortField] ?? -Infinity
    const bv = b[sortField] ?? -Infinity
    return sortDir === 'asc' ? av - bv : bv - av
  }) : filtered

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sortIcon = (field) => sortField === field ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  const signalCounts = {
    BUY: filtered.filter(c => c.signal === 'BUY').length,
    NOT_YET: filtered.filter(c => c.signal === 'NOT_YET').length,
    PASS: filtered.filter(c => c.signal === 'PASS' || !c.signal).length,
  }

  if (loading) return <div className="text-text-secondary p-8">Loading candidates...</div>
  if (error) return <div className="text-fail p-8">Error: {error}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Pipeline Candidates</h1>
        <div className="flex items-center gap-2">
          {['all', 'tier2', 'tier3', 'tier4'].map(t => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                tierFilter === t
                  ? 'bg-accent/15 text-accent'
                  : 'bg-surface-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              {t === 'all' ? 'All' : t === 'tier2' ? 'T2 Crisis' : t === 'tier3' ? 'T3 DKS' : 'T4 Regime'}
            </button>
          ))}
        </div>
      </div>

      {/* Signal summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface-secondary rounded p-4 text-center">
          <div className="text-2xl font-bold text-pass">{signalCounts.BUY}</div>
          <div className="text-xs text-text-secondary mt-1">BUY Signals</div>
        </div>
        <div className="bg-surface-secondary rounded p-4 text-center">
          <div className="text-2xl font-bold text-warn">{signalCounts.NOT_YET}</div>
          <div className="text-xs text-text-secondary mt-1">NOT YET</div>
        </div>
        <div className="bg-surface-secondary rounded p-4 text-center">
          <div className="text-2xl font-bold text-text-secondary">{signalCounts.PASS}</div>
          <div className="text-xs text-text-secondary mt-1">PASS / Pending</div>
        </div>
      </div>

      {/* Confidence band legend */}
      <div className="flex items-center gap-4 text-xs text-text-secondary">
        <span>Confidence Bands:</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pass inline-block" /> STRONG (&le;90% of buy-below)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent inline-block" /> STANDARD (&le;buy-below)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warn inline-block" /> MARGINAL (&le;105%)</span>
      </div>

      {/* Candidates table */}
      {sorted.length === 0 ? (
        <div className="bg-surface-secondary rounded p-8 text-center text-text-secondary">
          No candidates yet. Run a Tier 3 pre-screen from{' '}
          <Link to="/admin" className="text-accent hover:underline">Settings</Link>{' '}
          to populate the pipeline.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-secondary text-left">
                <th className="px-3 py-2">Ticker</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Signal</th>
                <th className="px-3 py-2 cursor-pointer hover:text-text-primary" onClick={() => toggleSort('attractor_score')}>
                  Attractor{sortIcon('attractor_score')}
                </th>
                <th className="px-3 py-2">Bull / Bear</th>
                <th className="px-3 py-2 cursor-pointer hover:text-text-primary" onClick={() => toggleSort('intrinsic_value')}>
                  IV{sortIcon('intrinsic_value')}
                </th>
                <th className="px-3 py-2">Buy Below</th>
                <th className="px-3 py-2 cursor-pointer hover:text-text-primary" onClick={() => toggleSort('current_price')}>
                  Price{sortIcon('current_price')}
                </th>
                <th className="px-3 py-2">Tier Detail</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Discovered</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, i) => {
                const prescreen = parsePrescreen(c.prescreen_data)
                return (
                  <tr key={c.id || i} className="border-b border-border/50 hover:bg-surface-secondary">
                    <td className="px-3 py-2 font-bold">
                      <Link to={`/analyze/${c.ticker}`} className="text-accent hover:underline">
                        {c.ticker}
                      </Link>
                      <span className="text-xs text-text-secondary ml-1">{c.company_name?.split(' ')[0]}</span>
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge tier={c.discovery_tier} />
                    </td>
                    <td className="px-3 py-2">
                      <SignalBadge signal={c.signal} confidence={c.signal_confidence} />
                    </td>
                    <td className="px-3 py-2">
                      {c.attractor_score != null ? (
                        <span className={c.attractor_score >= 3.5 ? 'text-pass' : c.attractor_score >= 2.5 ? 'text-warn' : 'text-fail'}>
                          {c.attractor_score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-text-secondary">--</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {c.bull_score != null && c.bear_score != null ? (
                        <span>
                          <span className="text-pass">{c.bull_score.toFixed(1)}</span>
                          {' / '}
                          <span className="text-fail">{c.bear_score.toFixed(1)}</span>
                        </span>
                      ) : (
                        <span className="text-text-secondary">--</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {c.intrinsic_value ? `$${c.intrinsic_value.toFixed(0)}` : '--'}
                    </td>
                    <td className="px-3 py-2">
                      {c.buy_below_price ? (
                        <span className="text-pass">${c.buy_below_price.toFixed(0)}</span>
                      ) : '--'}
                    </td>
                    <td className="px-3 py-2">
                      {c.current_price ? (
                        <span className={c.buy_below_price && c.current_price <= c.buy_below_price ? 'text-pass font-bold' : 'text-text-primary'}>
                          ${c.current_price.toFixed(2)}
                        </span>
                      ) : '--'}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[200px]">
                      <TierDetail candidate={c} prescreen={prescreen} />
                    </td>
                    <td className="px-3 py-2">
                      {c.attractor_analysis_date ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          c.analysis_model?.includes('opus') ? 'bg-purple-500/15 text-purple-400' : 'bg-surface-tertiary text-text-secondary'
                        }`}>
                          {c.analysis_model?.includes('opus') ? 'Opus' : 'Sonnet'}
                        </span>
                      ) : (
                        <span className="text-xs text-text-secondary/50">&mdash;</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-secondary text-xs">
                      {c.discovered_date?.split('T')[0] || '--'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function parsePrescreen(data) {
  if (!data) return {}
  try {
    return typeof data === 'string' ? JSON.parse(data) : data
  } catch {
    return {}
  }
}

function TierDetail({ candidate: c, prescreen }) {
  if (c.discovery_tier === 'tier3') {
    return (
      <div className="space-y-0.5">
        {c.dks_score != null && <span className="text-accent">DKS {c.dks_score.toFixed(1)}</span>}
        {prescreen.revenue_cagr_3yr != null && (
          <div className="text-text-secondary">Rev CAGR: {(prescreen.revenue_cagr_3yr * 100).toFixed(0)}%</div>
        )}
        {prescreen.gross_margin_estimate != null && (
          <div className="text-text-secondary">GM: {(prescreen.gross_margin_estimate * 100).toFixed(0)}%</div>
        )}
        {prescreen.growth_track && (
          <span className={`px-1.5 py-0.5 rounded ${
            prescreen.growth_track === 'high_growth' ? 'bg-pass/10 text-pass' : 'bg-warn/10 text-warn'
          }`}>{prescreen.growth_track.replace('_', ' ')}</span>
        )}
      </div>
    )
  }

  if (c.discovery_tier === 'tier4') {
    return (
      <div className="space-y-0.5">
        {c.csi_score != null && (
          <span className="text-purple-400">
            CSI {c.csi_score} {c.csi_interpretation && `(${c.csi_interpretation})`}
          </span>
        )}
        {c.valuation_method && (
          <div className="text-text-secondary">{c.valuation_method.replace(/_/g, ' ')}</div>
        )}
        {c.margin_of_safety != null && (
          <div className="text-text-secondary">MoS: {(c.margin_of_safety * 100).toFixed(0)}%</div>
        )}
      </div>
    )
  }

  if (c.discovery_tier === 'tier2') {
    return (
      <div className="space-y-0.5">
        {c.crisis_assessment && (
          <div className="text-text-secondary truncate" title={c.crisis_assessment}>
            {c.crisis_assessment.length > 40 ? c.crisis_assessment.slice(0, 40) + '...' : c.crisis_assessment}
          </div>
        )}
        {c.price_decline_pct != null && (
          <div className="text-fail">Decline: {(c.price_decline_pct * 100).toFixed(0)}%</div>
        )}
      </div>
    )
  }

  return <span className="text-text-secondary">&mdash;</span>
}

function SignalBadge({ signal, confidence }) {
  if (!signal) return <span className="text-xs px-2 py-0.5 rounded bg-surface-tertiary text-text-secondary">Pending</span>
  const styles = {
    BUY: confidence === 'STRONG' ? 'bg-pass/20 text-pass ring-1 ring-pass/30' : 'bg-pass/15 text-pass',
    NOT_YET: 'bg-warn/15 text-warn',
    PASS: 'bg-surface-tertiary text-text-secondary',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[signal] || styles.PASS}`}>
      {signal}{confidence === 'STRONG' ? ' \u2605' : confidence === 'MARGINAL' ? ' \u25CB' : ''}
    </span>
  )
}
