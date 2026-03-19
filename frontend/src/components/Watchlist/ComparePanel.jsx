import { FACTORS } from './FactorBars.jsx'

export default function ComparePanel({ items, onClose }) {
  if (!items || items.length < 2) return null

  const rows = [
    ...FACTORS.map(f => ({
      label: f.label,
      key: f.key,
      format: (v) => v != null ? `${v}/5` : '\u2014',
      higher: true, // higher is better
    })),
    { label: 'Attractor Score', key: null, getValue: (i) => i.adjusted_attractor_score ?? i.attractor_stability_score, format: (v) => v != null ? `${v.toFixed(1)}/5` : '\u2014', higher: true },
    { label: 'Network Regime', key: 'network_regime', format: (v) => ({ classical: 'Classical', soft_network: 'Soft Network', hard_network: 'Hard Network', platform: 'Platform' }[v] || v || '\u2014') },
    { label: 'Price', key: 'price', format: (v) => v != null ? `$${v.toFixed(2)}` : '\u2014' },
    { label: 'Buy Below', key: 'buy_below_price', format: (v) => v != null ? `$${v.toFixed(2)}` : '\u2014' },
    { label: 'Discount to IV', key: 'discount_to_iv_pct', format: (v) => v != null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '\u2014', higher: true },
    { label: 'Insider Signal', key: 'insider_signal', format: (v) => ({ strong_buy: 'Strong Buy', caution: 'Caution', neutral: 'Neutral' }[v] || v || '\u2014') },
  ]

  const getBest = (row) => {
    if (!row.higher) return null
    const vals = items.map(i => {
      const v = row.getValue ? row.getValue(i) : i[row.key]
      return typeof v === 'number' ? v : null
    })
    const max = Math.max(...vals.filter(v => v != null))
    return vals.map(v => v === max && v != null)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-primary border border-border rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-bold text-text-primary">Compare ({items.length} stocks)</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-lg">&times;</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-text-secondary font-normal"></th>
                {items.map(i => (
                  <th key={i.ticker} className="px-4 py-2 text-center text-accent font-bold">{i.ticker}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const best = getBest(row)
                return (
                  <tr key={row.label} className="border-b border-border/30">
                    <td className="px-4 py-2 text-text-secondary text-xs">{row.label}</td>
                    {items.map((item, idx) => {
                      const val = row.getValue ? row.getValue(item) : item[row.key]
                      const isBest = best && best[idx]
                      return (
                        <td key={item.ticker} className={`px-4 py-2 text-center ${isBest ? 'text-pass font-bold' : 'text-text-primary'}`}>
                          {row.format(val)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
