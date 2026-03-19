const FACTORS = [
  { key: 'revenue_durability_score', label: 'Revenue Durability' },
  { key: 'competitive_reinforcement_score', label: 'Competitive Reinforcement' },
  { key: 'industry_structure_score', label: 'Industry Structure' },
  { key: 'demand_feedback_score', label: 'Demand Feedback' },
  { key: 'adaptation_capacity_score', label: 'Adaptation Capacity' },
  { key: 'capital_allocation_score', label: 'Capital Allocation' },
]

function barColor(score) {
  if (score >= 4) return 'bg-pass'
  if (score >= 3) return 'bg-warn'
  return 'bg-fail'
}

export default function FactorBars({ item }) {
  return (
    <div className="flex gap-0.5 items-end" title="Factor scores (hover for details)">
      {FACTORS.map(f => {
        const score = item[f.key]
        if (score == null) return null
        const widthPct = (score / 5) * 100
        return (
          <div
            key={f.key}
            className="relative group"
            title={`${f.label}: ${score}/5`}
          >
            <div className="w-3 bg-surface-tertiary rounded-sm" style={{ height: '16px' }}>
              <div
                className={`w-full rounded-sm absolute bottom-0 ${barColor(score)}`}
                style={{ height: `${widthPct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export { FACTORS }
