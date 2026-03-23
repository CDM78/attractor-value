const TIER_CONFIG = {
  crisis:  { label: 'Crisis',  classes: 'bg-blue-500/15 text-blue-400' },
  growth:  { label: 'Growth',  classes: 'bg-emerald-500/15 text-emerald-400' },
  regime:  { label: 'Regime',  classes: 'bg-purple-500/15 text-purple-400' },
}

// Map all legacy/variant names to canonical keys
const TIER_ALIASES = {
  crisis: 'crisis', tier2: 'crisis', t2: 'crisis', 't2 crisis': 'crisis', t2_crisis: 'crisis',
  growth: 'growth', tier3: 'growth', t3: 'growth', 't3 dks': 'growth', t3_dks: 'growth',
  regime: 'regime', tier4: 'regime', t4: 'regime', 't4 regime': 'regime', t4_regime: 'regime',
}

export default function TierBadge({ tier }) {
  if (!tier) return null

  const canonical = TIER_ALIASES[tier.toLowerCase().replace(/_/g, ' ')] || TIER_ALIASES[tier.toLowerCase()]
  const config = canonical ? TIER_CONFIG[canonical] : null

  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${config?.classes || 'bg-surface-tertiary text-text-secondary'}`}>
      {config?.label || tier}
    </span>
  )
}
