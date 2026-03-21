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
        t2_pct: data.t2_pct ?? '',
        t3_pct: data.t3_pct ?? '',
        t4_pct: data.t4_pct ?? '',
        flexible_pct: data.flexible_pct ?? '',
        cash_reserve_pct: data.cash_reserve_pct ?? '',
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
        total_capital: Number(config.total_capital) || 0,
        t2_pct: Number(config.t2_pct) || 0,
        t3_pct: Number(config.t3_pct) || 0,
        t4_pct: Number(config.t4_pct) || 0,
        flexible_pct: Number(config.flexible_pct) || 0,
        cash_reserve_pct: Number(config.cash_reserve_pct) || 0,
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

      {/* Bulk Analysis */}
      <BulkAnalysis />
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
