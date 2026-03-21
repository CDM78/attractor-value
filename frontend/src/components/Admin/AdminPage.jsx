import { useState, useEffect } from 'react'
import { API_BASE } from '../../config.js'
import BulkAnalysis from './BulkAnalysis'

export default function AdminPage() {
  const [config, setConfig] = useState({
    total_capital: '',
    t2_pct: '',
    t3_pct: '',
    t4_pct: '',
    flexible_pct: '',
    cash_reserve_pct: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/portfolio/config`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setConfig({
        total_capital: data.total_capital ?? '',
        t2_pct: data.tier2_allocation ? String(Math.round(parseFloat(data.tier2_allocation) * 100)) : '',
        t3_pct: data.tier3_allocation ? String(Math.round(parseFloat(data.tier3_allocation) * 100)) : '',
        t4_pct: data.tier4_allocation ? String(Math.round(parseFloat(data.tier4_allocation) * 100)) : '',
        flexible_pct: data.flexible_allocation ? String(Math.round(parseFloat(data.flexible_allocation) * 100)) : '',
        cash_reserve_pct: data.cash_reserve ? String(Math.round(parseFloat(data.cash_reserve) * 100)) : '',
      })
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        total_capital: String(Number(config.total_capital) || 10000),
        tier2_allocation: String((Number(config.t2_pct) || 0) / 100),
        tier3_allocation: String((Number(config.t3_pct) || 0) / 100),
        tier4_allocation: String((Number(config.t4_pct) || 0) / 100),
        flexible_allocation: String((Number(config.flexible_pct) || 0) / 100),
        cash_reserve: String((Number(config.cash_reserve_pct) || 0) / 100),
      }
      const res = await fetch(`${API_BASE}/api/portfolio/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showToast('Configuration saved')
    } catch (err) {
      setError(err.message)
      showToast('Failed to save', 'fail')
    }
    setSaving(false)
  }

  const showToast = (msg, type = 'pass') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const handleChange = (field) => (e) => {
    setConfig((prev) => ({ ...prev, [field]: e.target.value }))
  }

  const allocationTotal =
    (Number(config.t2_pct) || 0) +
    (Number(config.t3_pct) || 0) +
    (Number(config.t4_pct) || 0) +
    (Number(config.flexible_pct) || 0) +
    (Number(config.cash_reserve_pct) || 0)

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

      <h2 className="text-xl font-bold text-text-primary">Admin</h2>

      {/* Portfolio Configuration */}
      <div className="bg-surface-secondary rounded p-4 md:p-6 space-y-4">
        <h3 className="text-text-primary font-bold text-lg">Portfolio Configuration</h3>

        {error && <div className="text-fail text-sm">Error: {error}</div>}

        {loading ? (
          <div className="text-text-secondary text-sm">Loading configuration...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <InputField
                label="Total Capital ($)"
                value={config.total_capital}
                onChange={handleChange('total_capital')}
                placeholder="e.g. 100000"
              />
              <InputField
                label="T2 Crisis Allocation (%)"
                value={config.t2_pct}
                onChange={handleChange('t2_pct')}
                placeholder="e.g. 30"
              />
              <InputField
                label="T3 DKS Allocation (%)"
                value={config.t3_pct}
                onChange={handleChange('t3_pct')}
                placeholder="e.g. 30"
              />
              <InputField
                label="T4 Regime Allocation (%)"
                value={config.t4_pct}
                onChange={handleChange('t4_pct')}
                placeholder="e.g. 20"
              />
              <InputField
                label="Flexible (%)"
                value={config.flexible_pct}
                onChange={handleChange('flexible_pct')}
                placeholder="e.g. 0"
              />
              <InputField
                label="Cash Reserve (%)"
                value={config.cash_reserve_pct}
                onChange={handleChange('cash_reserve_pct')}
                placeholder="e.g. 20"
              />
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors font-medium text-sm disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <span className={`text-sm ${allocationTotal === 100 ? 'text-pass' : 'text-warn'}`}>
                Allocation total: {allocationTotal}%{allocationTotal !== 100 && ' (should be 100%)'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Discovery Pipelines — Independent Tier Triggers */}
      <TierScreenPanel />

      {/* Bulk Analysis */}
      <BulkAnalysis />
    </div>
  )
}

function TierScreenPanel() {
  const [envData, setEnvData] = useState(null)
  const [runningTier, setRunningTier] = useState(null) // 'tier2' | 'tier3' | 'tier4' | null
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState({ scanned: 0, passes: 0 })

  useEffect(() => {
    fetch(`${API_BASE}/api/environment`).then(r => r.json()).then(setEnvData).catch(() => {})
  }, [])

  const crisisActive = envData?.crisis?.crisis_active || false
  const activeRegimes = envData?.regimes?.active?.length || envData?.regimes?.active_count || 0

  async function runScreen(tier) {
    setRunningTier(tier)
    setError(null)
    setResult(null)
    setProgress({ scanned: 0, passes: 0 })

    try {
      let offset = 0
      let totalScanned = 0
      let totalPasses = 0
      let hasMore = true

      while (hasMore) {
        const res = await fetch(`${API_BASE}/api/screen/${tier}?limit=200&offset=${offset}`, {
          method: 'POST',
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          if (body.crisis_active === false || body.active_regimes === 0) {
            setResult({ scanned: 0, passes: 0, message: body.message })
            setRunningTier(null)
            return
          }
          throw new Error(`HTTP ${res.status}`)
        }
        const data = await res.json()

        totalScanned += data.scanned || 0
        totalPasses += data.passes || 0
        hasMore = data.has_more || false
        offset += 200

        setProgress({ scanned: totalScanned, passes: totalPasses })
      }

      setResult({ scanned: totalScanned, passes: totalPasses, tier })
    } catch (err) {
      setError(err.message)
    }
    setRunningTier(null)
  }

  const tiers = [
    {
      id: 'tier3',
      label: 'Tier 3: Emerging DKS',
      desc: 'Monthly scan for growth companies with self-reinforcing flywheels. Criteria: revenue CAGR \u2265 8%, gross margin \u2265 35%, market cap \u2265 $500M.',
      color: 'emerald',
      enabled: true,
      enabledText: 'Always active',
    },
    {
      id: 'tier2',
      label: 'Tier 2: Crisis Dislocation',
      desc: 'Screens for quality companies temporarily cheap during market-wide fear. Activates when S&P 500 declines \u2265 20% or multiple severe stress signals.',
      color: 'blue',
      enabled: crisisActive,
      enabledText: crisisActive ? 'Crisis detected' : 'No active crisis',
    },
    {
      id: 'tier4',
      label: 'Tier 4: Regime Transition',
      desc: 'Identifies beneficiaries of structural economic shifts (policy, geopolitical, technology). Requires an active regime in the registry.',
      color: 'purple',
      enabled: activeRegimes > 0,
      enabledText: activeRegimes > 0 ? `${activeRegimes} active regime${activeRegimes > 1 ? 's' : ''}` : 'No active regimes',
    },
  ]

  return (
    <div className="bg-surface-secondary rounded p-4 md:p-6 space-y-4">
      <h3 className="text-text-primary font-bold text-lg">Discovery Pipelines</h3>
      <p className="text-text-secondary text-sm">
        Three independent funnels for finding investment candidates. Each writes to the same candidates table.
        Run Bulk Analysis after screening to evaluate candidates with attractor analysis.
      </p>

      {error && <div className="text-fail text-sm">Error: {error}</div>}

      {result && !runningTier && (
        <div className="bg-pass/10 border border-pass/20 rounded p-3 text-sm">
          {result.message ? (
            <span className="text-warn">{result.message}</span>
          ) : (
            <>
              <span className="text-pass font-bold">Screen complete.</span>{' '}
              Scanned {result.scanned} stocks, found {result.passes} candidates.
              {result.passes > 0 && (
                <span className="text-text-secondary"> Run Bulk Analysis below to evaluate them.</span>
              )}
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {tiers.map(t => (
          <div key={t.id} className="bg-surface-tertiary rounded p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold text-${t.color}-400`}>{t.label}</span>
            </div>
            <p className="text-xs text-text-secondary">{t.desc}</p>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded ${
                t.enabled ? `bg-${t.color}-500/15 text-${t.color}-400` : 'bg-surface-secondary text-text-secondary'
              }`}>
                {t.enabledText}
              </span>
            </div>
            {runningTier === t.id ? (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-text-secondary">
                  {progress.scanned} scanned, {progress.passes} found
                </span>
              </div>
            ) : (
              <button
                onClick={() => runScreen(t.id)}
                disabled={!t.enabled || runningTier != null}
                className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                  t.enabled
                    ? `bg-${t.color}-500/15 text-${t.color}-400 hover:bg-${t.color}-500/25`
                    : 'bg-surface-secondary text-text-secondary/50 cursor-not-allowed'
                } disabled:opacity-50`}
              >
                Run {t.id === 'tier3' ? 'Pre-Screen' : t.id === 'tier2' ? 'Crisis Screen' : 'Regime Screen'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function InputField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-text-secondary text-xs mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-surface-tertiary text-text-primary border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent placeholder-text-secondary/50"
      />
    </div>
  )
}
