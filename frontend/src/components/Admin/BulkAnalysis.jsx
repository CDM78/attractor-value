import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../../config.js'

export default function BulkAnalysis() {
  const [phase, setPhase] = useState('config') // config | running | complete
  const [model, setModel] = useState('sonnet')
  const [concurrency, setConcurrency] = useState(5)
  const [tierFilter, setTierFilter] = useState('all')
  const [candidateCount, setCandidateCount] = useState(null)
  const [loadingCount, setLoadingCount] = useState(true)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const pollRef = useRef(null)

  const costPerCandidate = model === 'opus' ? 0.25 : 0.03

  const fetchCandidateCount = useCallback(async () => {
    setLoadingCount(true)
    try {
      const res = await fetch(`${API_BASE}/api/admin/bulk-analyze/progress`)
      if (res.ok) {
        const data = await res.json()
        if (data && data.total > 0 && !data.complete) {
          setProgress(data)
          setPhase('running')
          startPolling()
          setCandidateCount(data.total)
          setLoadingCount(false)
          return
        }
        if (data && data.total > 0 && data.complete) {
          setProgress(data)
          setPhase('complete')
          setCandidateCount(data.total)
          setLoadingCount(false)
          return
        }
        if (data && data.pending != null) {
          setCandidateCount(data.pending)
          setLoadingCount(false)
          return
        }
        // data is null — no previous bulk analysis run, fall through
      }
      // Fallback: count from signals
      const sigRes = await fetch(`${API_BASE}/api/signals`)
      if (!sigRes.ok) throw new Error(`HTTP ${sigRes.status}`)
      const sigData = await sigRes.json()
      const pending = (sigData.candidates || sigData.pending || []).length
      setCandidateCount(pending)
    } catch (err) {
      setError(err.message)
    }
    setLoadingCount(false)
  }, [])

  useEffect(() => {
    fetchCandidateCount()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchCandidateCount])

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/bulk-analyze/progress`)
        if (!res.ok) return
        const data = await res.json()
        if (!data) return
        setProgress(data)
        if (data.complete || data.status === 'cancelled') {
          clearInterval(pollRef.current)
          pollRef.current = null
          setPhase('complete')
        }
      } catch {
        // ignore polling errors
      }
    }, 3000)
  }

  const handleRun = async () => {
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/bulk-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, concurrency, tier_filter: tierFilter }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setProgress(data)
      setPhase('running')
      startPolling()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleCancel = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setPhase('complete')
  }

  const handleReset = () => {
    setProgress(null)
    setPhase('config')
    fetchCandidateCount()
  }

  const effectiveCount = candidateCount || 0
  const costEstimate = (effectiveCount * costPerCandidate).toFixed(2)
  const timeEstimate = Math.ceil((effectiveCount / concurrency) * 5)

  const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  }

  // ---- Config Phase ----
  if (phase === 'config') {
    return (
      <div className="bg-surface-secondary rounded p-4 md:p-6 space-y-4">
        <h3 className="text-text-primary font-bold text-lg">Bulk Analysis</h3>

        {error && <div className="text-fail text-sm">Error: {error}</div>}

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div>
            <span className="text-text-secondary">Pending candidates: </span>
            {loadingCount
              ? <span className="text-text-secondary">loading...</span>
              : <span className="text-text-primary font-bold">{effectiveCount}</span>
            }
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Model */}
          <div>
            <label className="block text-text-secondary text-xs mb-1">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-surface-tertiary text-text-primary border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent"
            >
              <option value="sonnet">Sonnet (~$0.03/candidate)</option>
              <option value="opus">Opus (~$0.25/candidate)</option>
            </select>
          </div>

          {/* Concurrency */}
          <div>
            <label className="block text-text-secondary text-xs mb-1">Concurrency</label>
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="w-full bg-surface-tertiary text-text-primary border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent"
            >
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </div>

          {/* Tier Filter */}
          <div>
            <label className="block text-text-secondary text-xs mb-1">Tier Filter</label>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="w-full bg-surface-tertiary text-text-primary border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent"
            >
              <option value="all">All Tiers</option>
              <option value="T2">Tier 2</option>
              <option value="T3">Tier 3</option>
              <option value="T4">Tier 4</option>
            </select>
          </div>

          {/* Estimates */}
          <div className="space-y-1">
            <label className="block text-text-secondary text-xs mb-1">Estimates</label>
            <div className="text-sm">
              <span className="text-text-secondary">Cost: </span>
              <span className="text-warn font-medium">${costEstimate}</span>
            </div>
            <div className="text-sm">
              <span className="text-text-secondary">Time: </span>
              <span className="text-text-primary font-medium">~{formatTime(timeEstimate)}</span>
            </div>
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={effectiveCount === 0 || loadingCount}
          className="px-4 py-2 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Run Bulk Analysis
        </button>
      </div>
    )
  }

  // ---- Running Phase ----
  if (phase === 'running') {
    const analyzed = progress?.analyzed || 0
    const total = progress?.total || effectiveCount || 1
    const pct = Math.min(100, Math.round((analyzed / total) * 100))
    const remaining = total - analyzed
    const estRemaining = Math.ceil((remaining / concurrency) * 5)

    return (
      <div className="bg-surface-secondary rounded p-4 md:p-6 space-y-4">
        <h3 className="text-text-primary font-bold text-lg">Bulk Analysis — Running</h3>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-secondary">{analyzed} / {total} analyzed</span>
            <span className="text-text-primary font-medium">{pct}%</span>
          </div>
          <div className="h-4 bg-surface-tertiary rounded overflow-hidden">
            <div
              className="h-full bg-accent rounded transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Live stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatBox label="Passed Attractor" value={progress?.passed_attractor ?? 0} color="text-pass" />
          <StatBox label="BUY Signals" value={progress?.buy_signals ?? 0} color="text-pass" />
          <StatBox label="NOT YET" value={progress?.not_yet ?? 0} color="text-warn" />
          <StatBox label="PASS" value={progress?.pass ?? 0} color="text-text-secondary" />
          <StatBox label="Errors" value={progress?.errors ?? 0} color="text-fail" />
        </div>

        {progress?.latest_ticker && (
          <div className="text-sm">
            <span className="text-text-secondary">Latest: </span>
            <span className="text-accent font-medium">{progress.latest_ticker}</span>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="text-sm">
            <span className="text-text-secondary">Est. remaining: </span>
            <span className="text-text-primary">{formatTime(estRemaining)}</span>
          </div>
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 rounded bg-fail/20 text-fail hover:bg-fail/30 transition-colors text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ---- Complete Phase ----
  return (
    <div className="bg-surface-secondary rounded p-4 md:p-6 space-y-4">
      <h3 className="text-text-primary font-bold text-lg">Bulk Analysis — Complete</h3>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatBox label="Total Analyzed" value={progress?.analyzed ?? progress?.total ?? 0} color="text-text-primary" />
        <StatBox label="Passed Attractor" value={progress?.passed_attractor ?? 0} color="text-pass" />
        <StatBox label="BUY Signals" value={progress?.buy_signals ?? 0} color="text-pass" />
        <StatBox label="NOT YET" value={progress?.not_yet ?? 0} color="text-warn" />
        <StatBox label="Errors" value={progress?.errors ?? 0} color="text-fail" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/dashboard"
          className="px-4 py-2 rounded bg-pass/20 text-pass hover:bg-pass/30 transition-colors text-sm font-medium"
        >
          View BUY Signals on Dashboard
        </Link>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded bg-surface-tertiary text-text-secondary hover:text-text-primary hover:bg-accent/10 transition-colors text-sm font-medium"
        >
          Run Again
        </button>
      </div>
    </div>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div className="bg-surface-tertiary rounded p-3">
      <div className="text-text-secondary text-xs mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}
