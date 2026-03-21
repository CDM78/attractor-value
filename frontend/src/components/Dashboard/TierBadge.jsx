const tierStyles = {
  T2: 'bg-blue-500/15 text-blue-400',
  'T2 Crisis': 'bg-blue-500/15 text-blue-400',
  T3: 'bg-emerald-500/15 text-emerald-400',
  'T3 DKS': 'bg-emerald-500/15 text-emerald-400',
  T4: 'bg-purple-500/15 text-purple-400',
  'T4 Regime': 'bg-purple-500/15 text-purple-400',
}

export default function TierBadge({ tier }) {
  if (!tier) return null

  // Normalize: accept "T2", "T2 Crisis", "t2_crisis", etc.
  const normalized = tier
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())

  // Find matching style key
  const styleKey = Object.keys(tierStyles).find(k =>
    normalized.toUpperCase().startsWith(k.toUpperCase())
  )

  const classes = styleKey ? tierStyles[styleKey] : 'bg-surface-tertiary text-text-secondary'
  const label = styleKey || normalized

  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${classes}`}>
      {label}
    </span>
  )
}
