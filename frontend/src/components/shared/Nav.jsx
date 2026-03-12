import { NavLink } from 'react-router-dom'

const links = [
  { to: '/screener', label: 'Screener' },
  { to: '/watchlist', label: 'Watchlist' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/transactions', label: 'History' },
]

export default function Nav() {
  return (
    <nav className="flex items-center gap-1 bg-surface-secondary border-b border-border px-6 py-3">
      <h1 className="text-accent font-bold text-lg mr-8 tracking-tight">AV Framework</h1>
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `px-4 py-2 rounded text-sm transition-colors ${
              isActive
                ? 'bg-accent/15 text-accent'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-tertiary'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
