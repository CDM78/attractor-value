import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { API_BASE } from '../../config.js'

export default function AnalysisDetail() {
  const { ticker } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)

  const fetchAnalysis = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/analyze?ticker=${ticker}`)
      if (res.status === 404) {
        setData(null)
        setLoading(false)
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const triggerAnalysis = async () => {
    setAnalyzing(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/analyze?ticker=${ticker}`, { method: 'POST' })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }
      await fetchAnalysis()
    } catch (err) {
      setError(err.message)
    }
    setAnalyzing(false)
  }

  useEffect(() => {
    fetchAnalysis()
  }, [ticker])

  if (loading) return <div className="text-text-secondary">Loading analysis for {ticker}...</div>

  const analysis = data?.analysis
  const cr = data?.concentration_risk

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link to="/screener" className="text-accent hover:underline text-sm">&larr; Screener</Link>
        <h2 className="text-xl font-bold">{ticker} — Attractor Analysis</h2>
        <button
          onClick={triggerAnalysis}
          disabled={analyzing}
          className="ml-auto text-sm px-4 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
        >
          {analyzing ? 'Analyzing...' : analysis ? 'Re-analyze' : 'Run Analysis'}
        </button>
      </div>

      {error && (
        <div className="bg-fail/10 border border-fail/30 rounded p-3 mb-4 text-fail text-sm">
          {error}
        </div>
      )}

      {!analysis ? (
        <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
          <p className="mb-4">No analysis yet for {ticker}.</p>
          <p className="text-sm">Click "Run Analysis" to trigger a Claude-powered attractor stability assessment.</p>
          <p className="text-xs mt-2 text-text-secondary">Estimated cost: ~$0.02-0.03</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Score Overview */}
          <div className="bg-surface-secondary rounded p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-text-secondary text-sm">Attractor Stability Score</span>
                <div className={`text-3xl font-bold ${scoreColor(analysis.attractor_stability_score)}`}>
                  {analysis.attractor_stability_score?.toFixed(1)}
                  <span className="text-sm text-text-secondary ml-2">/ 5.0</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-text-secondary text-sm">Network Regime</span>
                <div className="text-lg font-bold text-accent">
                  {formatRegime(analysis.network_regime)}
                </div>
              </div>
              <div className="text-right">
                <span className="text-text-secondary text-sm">Analyzed</span>
                <div className="text-sm">{analysis.analysis_date}</div>
              </div>
            </div>

            {/* Stability classification */}
            <div className={`text-sm px-3 py-1.5 rounded inline-block ${
              analysis.attractor_stability_score >= 3.5
                ? 'bg-pass/15 text-pass'
                : analysis.attractor_stability_score >= 2.0
                  ? 'bg-warn/15 text-warn'
                  : 'bg-fail/15 text-fail'
            }`}>
              {analysis.attractor_stability_score >= 3.5 ? 'Stable Attractor'
                : analysis.attractor_stability_score >= 2.0 ? 'Transitional'
                : 'Dissolving Attractor'}
            </div>
          </div>

          {/* Factor Scores — Bar Chart */}
          <div className="bg-surface-secondary rounded p-4">
            <h3 className="text-sm font-bold text-text-secondary mb-3">Factor Scores</h3>
            <div className="space-y-2">
              <FactorBar label="Revenue Durability" score={analysis.revenue_durability_score} />
              <FactorBar label="Competitive Reinforcement" score={analysis.competitive_reinforcement_score} />
              <FactorBar label="Industry Structure" score={analysis.industry_structure_score} />
              <FactorBar label="Demand Feedback" score={analysis.demand_feedback_score} />
              <FactorBar label="Adaptation Capacity" score={analysis.adaptation_capacity_score} />
              <FactorBar label="Capital Allocation" score={analysis.capital_allocation_score} />
            </div>
          </div>

          {/* Analysis Text */}
          <div className="bg-surface-secondary rounded p-4">
            <h3 className="text-sm font-bold text-text-secondary mb-3">Analysis</h3>
            <div className="text-sm leading-relaxed whitespace-pre-wrap">
              {analysis.analysis_text}
            </div>
          </div>

          {/* Red Flags */}
          {analysis.red_flags && (
            <div className="bg-surface-secondary rounded p-4">
              <h3 className="text-sm font-bold text-text-secondary mb-3">Red Flags</h3>
              <RedFlagList flags={analysis.red_flags} />
            </div>
          )}

          {/* Concentration Risk */}
          {cr && (
            <div className="bg-surface-secondary rounded p-4">
              <h3 className="text-sm font-bold text-text-secondary mb-3">
                Concentration Risk
                {cr.concentration_penalty > 0 && (
                  <span className="text-fail ml-2">(-{cr.concentration_penalty.toFixed(1)} penalty)</span>
                )}
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <ConcentrationItem
                  label="Customer"
                  value={cr.largest_customer_pct ? `${cr.largest_customer_pct}% (${cr.largest_customer_name || 'undisclosed'})` : 'Low'}
                  warn={cr.largest_customer_pct >= 25}
                />
                <ConcentrationItem
                  label="Supplier"
                  value={cr.single_source_supplier ? cr.supplier_details || 'Single source identified' : 'Diversified'}
                  warn={cr.single_source_supplier}
                />
                <ConcentrationItem
                  label="Geographic"
                  value={cr.largest_geo_market_pct ? `${cr.largest_geo_market_pct}% (${cr.largest_geo_market_name || 'undisclosed'})` : 'Diversified'}
                  warn={cr.largest_geo_market_pct >= 70}
                />
                <ConcentrationItem
                  label="Regulatory"
                  value={cr.regulatory_dependency_pct ? `${cr.regulatory_dependency_pct}% — ${cr.regulatory_details || ''}` : 'Low'}
                  warn={cr.regulatory_dependency_pct >= 50}
                />
              </div>
            </div>
          )}

          {/* Sources */}
          {analysis.sources_used && (
            <div className="text-xs text-text-secondary">
              Sources: {formatSources(analysis.sources_used)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FactorBar({ label, score }) {
  const pct = score != null ? (score / 5) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-text-secondary w-48 shrink-0">{label}</span>
      <div className="flex-1 bg-surface-tertiary rounded h-4 overflow-hidden">
        <div
          className={`h-full rounded transition-all ${
            score >= 4 ? 'bg-pass' : score >= 3 ? 'bg-accent' : score >= 2 ? 'bg-warn' : 'bg-fail'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-sm font-bold w-8 text-right ${scoreColor(score)}`}>
        {score ?? '—'}
      </span>
    </div>
  )
}

function RedFlagList({ flags }) {
  let parsed = flags
  if (typeof flags === 'string') {
    try { parsed = JSON.parse(flags) } catch { parsed = [flags] }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return <span className="text-pass text-sm">No red flags identified</span>
  }
  return (
    <ul className="space-y-1">
      {parsed.map((flag, i) => (
        <li key={i} className="text-sm text-fail flex items-start gap-2">
          <span className="text-fail/60 mt-0.5">!</span>
          {flag}
        </li>
      ))}
    </ul>
  )
}

function ConcentrationItem({ label, value, warn }) {
  return (
    <div className={`p-2 rounded ${warn ? 'bg-fail/5 border border-fail/20' : 'bg-surface-tertiary'}`}>
      <span className="text-text-secondary text-xs block">{label}</span>
      <span className={`text-sm ${warn ? 'text-fail' : 'text-text-primary'}`}>{value}</span>
    </div>
  )
}

function scoreColor(score) {
  if (score == null) return 'text-text-secondary'
  if (score >= 3.5) return 'text-pass'
  if (score >= 2.0) return 'text-warn'
  return 'text-fail'
}

function formatRegime(regime) {
  const map = {
    classical: 'Classical',
    soft_network: 'Soft Network',
    hard_network: 'Hard Network',
    platform: 'Platform',
  }
  return map[regime] || regime || 'Unknown'
}

function formatSources(sources) {
  let parsed = sources
  if (typeof sources === 'string') {
    try { parsed = JSON.parse(sources) } catch { return sources }
  }
  return Array.isArray(parsed) ? parsed.join(', ') : String(sources)
}
