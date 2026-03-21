import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../../config.js'
import TierBadge from '../Dashboard/TierBadge'

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState({ tier2: [], tier3: [], tier4: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tierFilter, setTierFilter] = useState('all')

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

      {/* Candidates table */}
      {filtered.length === 0 ? (
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
                <th className="px-3 py-2">Attractor</th>
                <th className="px-3 py-2">IV</th>
                <th className="px-3 py-2">Buy Below</th>
                <th className="px-3 py-2">DKS / CSI</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Discovered</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id || i} className="border-b border-border/50 hover:bg-surface-secondary">
                  <td className="px-3 py-2 font-bold">
                    <Link to={`/analyze/${c.ticker}`} className="text-accent hover:underline">
                      {c.ticker}
                    </Link>
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
                  <td className="px-3 py-2">
                    {c.intrinsic_value ? `$${c.intrinsic_value.toFixed(2)}` : '--'}
                  </td>
                  <td className="px-3 py-2">
                    {c.buy_below_price ? (
                      <span className="text-pass">${c.buy_below_price.toFixed(2)}</span>
                    ) : '--'}
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs">
                    {c.discovery_tier === 'tier3' && c.dks_score != null && `DKS ${c.dks_score.toFixed(1)}`}
                    {c.discovery_tier === 'tier4' && c.csi_score != null && `CSI ${c.csi_score}`}
                    {c.discovery_tier === 'tier2' && c.crisis_assessment && c.crisis_assessment}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary">
                      {c.analysis_model?.includes('opus') ? 'Opus' : 'Sonnet'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-secondary text-xs">
                    {c.discovered_date?.split('T')[0] || '--'}
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

function SignalBadge({ signal, confidence }) {
  if (!signal) return <span className="text-xs px-2 py-0.5 rounded bg-surface-tertiary text-text-secondary">Pending</span>
  const styles = {
    BUY: 'bg-pass/15 text-pass',
    NOT_YET: 'bg-warn/15 text-warn',
    PASS: 'bg-surface-tertiary text-text-secondary',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[signal] || styles.PASS}`}>
      {signal}{confidence === 'STRONG' ? ' (Strong)' : ''}
    </span>
  )
}
