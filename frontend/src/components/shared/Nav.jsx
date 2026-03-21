import { NavLink, Link } from 'react-router-dom'
import { useState } from 'react'
import { API_BASE } from '../../config.js'
import QuickQuote from './QuickQuote.jsx'

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/candidates', label: 'Candidates' },
  { to: '/holdings', label: 'Holdings' },
  { to: '/admin', label: 'Settings' },
  { to: '/how-it-works', label: 'How It Works' },
]

export default function Nav() {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState(null)
  const [showQuote, setShowQuote] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/refresh?limit=10&wait=true`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRefreshResult(`${data.pricesUpdated} prices, ${data.screened} screened`)
      setTimeout(() => setRefreshResult(null), 5000)
    } catch (err) {
      setRefreshResult(`Error: ${err.message}`)
      setTimeout(() => setRefreshResult(null), 5000)
    }
    setRefreshing(false)
  }

  return (
    <nav className="flex items-center gap-1 bg-surface-secondary border-b border-border px-4 md:px-6 py-3 overflow-x-auto">
      <h1 className="text-accent font-bold text-lg mr-4 md:mr-8 tracking-tight shrink-0">AV Framework</h1>
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `px-3 md:px-4 py-2 rounded text-sm transition-colors shrink-0 ${
              isActive
                ? 'bg-accent/15 text-accent'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-tertiary'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
      <div className="ml-auto flex items-center gap-2 shrink-0 relative">
        {refreshResult && (
          <span className="text-xs text-text-secondary hidden md:inline">{refreshResult}</span>
        )}
        <Link
          to="/how-it-works"
          className="w-6 h-6 rounded-full bg-surface-tertiary text-text-secondary text-xs flex items-center justify-center hover:bg-accent/15 hover:text-accent transition-colors"
          title="How It Works"
        >
          ?
        </Link>
        <button
          onClick={() => setShowQuote(prev => !prev)}
          className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors"
          title="Quick quote lookup"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
          title="Refresh data now"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
        {showQuote && <QuickQuote onClose={() => setShowQuote(false)} />}
      </div>
    </nav>
  )
}
