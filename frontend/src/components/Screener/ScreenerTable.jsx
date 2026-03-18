import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useScreenStore } from '../../stores/screenStore'
import { useWatchlistStore } from '../../stores/watchlistStore'
import { API_BASE } from '../../config.js'

export default function ScreenerTable() {
  const { results, meta, loading, error, fetchResults } = useScreenStore()
  const { addToWatchlist } = useWatchlistStore()
  const [filterMode, setFilterMode] = useState('passing') // 'passing' | 'all'
  const [showSectorPB, setShowSectorPB] = useState(false)

  useEffect(() => {
    fetchResults()
  }, [fetchResults])

  if (loading) return <div className="text-text-secondary">Loading screener results...</div>
  if (error) return <div className="text-fail">Error: {error}</div>

  const handleAddToWatchlist = async (ticker, buyBelow) => {
    try {
      await addToWatchlist(ticker, '', buyBelow)
      alert(`${ticker} added to watchlist`)
    } catch (err) {
      alert(`Failed: ${err.message}`)
    }
  }

  const fullPass = results.filter(r => r.tier === 'full_pass')
  const nearMiss = results.filter(r => r.tier === 'near_miss')
  const fails = results.filter(r => r.tier !== 'full_pass' && r.tier !== 'near_miss')

  const filtered = filterMode === 'passing'
    ? [...fullPass, ...nearMiss]
    : results

  const handleExportCSV = () => {
    const headers = ['Ticker','Company','Sector','Price','P/E','P/B','Tier','Pass Count','Failed Filter','Signal','Intrinsic Value','Buy Below','Discount %']
    const rows = filtered.map(r => {
      let signal = ''
      if (r.passes_all_hard && r.buy_below_price != null) {
        if (r.price <= r.buy_below_price) signal = 'BUY'
        else if (r.discount_to_iv_pct != null && r.discount_to_iv_pct > 0) signal = 'WAIT'
        else signal = 'OVER'
      }
      return [
        r.ticker, r.company_name, r.sector, r.price?.toFixed(2),
        r.pe_ratio?.toFixed(1), r.pb_ratio?.toFixed(1),
        r.tier || 'fail', r.pass_count || 0, r.failed_filter || '',
        signal,
        r.adjusted_intrinsic_value?.toFixed(2) || '',
        r.buy_below_price?.toFixed(2) || '',
        r.discount_to_iv_pct?.toFixed(1) || '',
      ]
    })
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    downloadCSV(csv, 'screener.csv')
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-bold">Stock Screener</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterMode(filterMode === 'passing' ? 'all' : 'passing')}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              filterMode === 'all' ? 'bg-surface-tertiary text-text-secondary' : 'bg-pass/20 text-pass'
            }`}
          >
            {filterMode === 'passing' ? `Passing + Near Miss (${fullPass.length + nearMiss.length})` : `All (${results.length})`}
          </button>
          <button
            onClick={handleExportCSV}
            className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:text-accent transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Tier summary bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <span className="text-xs px-3 py-1.5 rounded bg-pass/15 text-pass font-medium">
          Full Pass: {meta?.full_pass_count ?? fullPass.length}
        </span>
        <span className="text-xs px-3 py-1.5 rounded bg-warn/15 text-warn font-medium">
          Near Miss: {meta?.near_miss_count ?? nearMiss.length}
        </span>
        <span className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary font-medium">
          Filtered Out: {meta?.fail_count ?? fails.length}
        </span>
      </div>

      {meta && (
        <div className="bg-surface-secondary rounded px-4 py-2 mb-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 md:gap-4">
            <span className="text-text-secondary">
              Max P/E: <span className="text-accent font-bold">{meta.dynamic_pe_ceiling}</span>
            </span>
            {meta.aaa_bond_yield && (
              <span className="text-text-secondary hidden md:inline">
                (AAA: {meta.aaa_bond_yield.toFixed(2)}% + 1.5% premium)
              </span>
            )}
            {meta.sector_pb_thresholds && Object.keys(meta.sector_pb_thresholds).length > 0 && (
              <button
                onClick={() => setShowSectorPB(!showSectorPB)}
                className="text-xs text-accent hover:underline ml-auto"
              >
                {showSectorPB ? 'Hide' : 'Show'} Sector P/B Thresholds
              </button>
            )}
            {meta.preliminary && (
              <span className="text-warn text-xs ml-auto">
                Preliminary — full fundamentals loading
              </span>
            )}
          </div>
          {showSectorPB && meta.sector_pb_thresholds && (
            <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
              {Object.entries(meta.sector_pb_thresholds)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([sector, threshold]) => (
                  <span key={sector}>
                    {sector}: <span className="text-accent">≤ {threshold.toFixed(1)}</span>
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
          {filterMode === 'passing' ? 'No stocks pass 7+ hard filters yet.' : 'No screening data yet. Click Refresh to populate.'}
        </div>
      ) : (
        <>
          {/* Mobile: Card View */}
          <div className="md:hidden space-y-3">
            {filtered.map((row, i) => (
              <div key={row.ticker}>
                {/* Divider between full_pass and near_miss sections */}
                {i > 0 && row.tier === 'near_miss' && filtered[i - 1]?.tier === 'full_pass' && (
                  <div className="border-t-2 border-warn/30 pt-3 mb-3">
                    <span className="text-xs text-warn font-medium">Near Misses (7/8 filters)</span>
                  </div>
                )}
                {i > 0 && row.tier !== 'full_pass' && row.tier !== 'near_miss' && (filtered[i - 1]?.tier === 'full_pass' || filtered[i - 1]?.tier === 'near_miss') && (
                  <div className="border-t-2 border-border pt-3 mb-3">
                    <span className="text-xs text-text-secondary">Below Threshold</span>
                  </div>
                )}
                <MobileCard row={row} onWatch={handleAddToWatchlist} preliminary={meta?.preliminary} />
              </div>
            ))}
          </div>

          {/* Desktop: Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-secondary text-left">
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Sector</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">P/E</th>
                  <th className="px-3 py-2">P/B</th>
                  <th className="px-3 py-2">P/ExP/B</th>
                  <th className="px-3 py-2">D/E</th>
                  <th className="px-3 py-2">CR</th>
                  <th className="px-3 py-2">Earn</th>
                  <th className="px-3 py-2">Div</th>
                  <th className="px-3 py-2">EPS</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2">Signal</th>
                  <th className="px-3 py-2">IV</th>
                  <th className="px-3 py-2">Buy Below</th>
                  <th className="px-3 py-2">Disc.</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <>
                    {/* Divider between tiers */}
                    {i > 0 && row.tier === 'near_miss' && filtered[i - 1]?.tier === 'full_pass' && (
                      <tr key={`divider-nm-${i}`}>
                        <td colSpan={18} className="px-3 py-2 border-t-2 border-warn/30">
                          <span className="text-xs text-warn font-medium">Near Misses (7/8 filters)</span>
                        </td>
                      </tr>
                    )}
                    {i > 0 && row.tier !== 'full_pass' && row.tier !== 'near_miss' && (filtered[i - 1]?.tier === 'full_pass' || filtered[i - 1]?.tier === 'near_miss') && (
                      <tr key={`divider-fail-${i}`}>
                        <td colSpan={18} className="px-3 py-2 border-t-2 border-border">
                          <span className="text-xs text-text-secondary">Below Threshold ({fails.length} stocks)</span>
                        </td>
                      </tr>
                    )}
                    <tr key={row.ticker} className={`border-b border-border/50 hover:bg-surface-secondary ${
                      row.tier === 'full_pass' ? '' : row.tier === 'near_miss' ? 'bg-warn/5' : ''
                    }`}>
                      <td className="px-3 py-2 font-bold">
                        <Link to={`/analyze/${row.ticker}`} className="text-accent hover:underline">{row.ticker}</Link>
                      </td>
                      <td className="px-3 py-2">{row.company_name}</td>
                      <td className="px-3 py-2 text-text-secondary">{row.sector}</td>
                      <td className="px-3 py-2">${row.price?.toFixed(2)}</td>
                      <td className="px-3 py-2"><FilterCell pass={row.passes_pe} value={row.pe_ratio?.toFixed(1)} failed={row.failed_filter === 'pe'} missInfo={row} /></td>
                      <td className="px-3 py-2"><FilterCell pass={row.passes_pb} value={row.pb_ratio?.toFixed(1)} failed={row.failed_filter === 'pb'} missInfo={row} /></td>
                      <td className="px-3 py-2"><FilterCell pass={row.passes_pe_x_pb} failed={row.failed_filter === 'pe_x_pb'} missInfo={row} /></td>
                      <td className="px-3 py-2"><FilterCell pass={row.passes_debt_equity} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'debt_equity'} missInfo={row} /></td>
                      <td className="px-3 py-2"><FilterCell pass={row.passes_current_ratio} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'current_ratio'} missInfo={row} /></td>
                      <td className="px-3 py-2"><FilterCell pass={row.passes_earnings_stability} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'earnings_stability'} missInfo={row} /></td>
                      <td className="px-3 py-2"><FilterCell pass={row.passes_dividend_record} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'dividend_record'} missInfo={row} /></td>
                      <td className="px-3 py-2"><FilterCell pass={row.passes_earnings_growth} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'earnings_growth'} missInfo={row} /></td>
                      <td className="px-3 py-2">
                        <TierBadge tier={row.tier} passCount={row.pass_count} />
                      </td>
                      <td className="px-3 py-2">
                        <SignalBadge row={row} />
                      </td>
                      <td className="px-3 py-2">
                        {row.adjusted_intrinsic_value != null
                          ? <span>${row.adjusted_intrinsic_value.toFixed(0)}</span>
                          : <span className="text-text-secondary">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {row.buy_below_price != null
                          ? <span className={row.price <= row.buy_below_price ? 'text-pass font-bold' : 'text-text-secondary'}>
                              ${row.buy_below_price.toFixed(0)}
                            </span>
                          : <span className="text-text-secondary">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {row.discount_to_iv_pct != null
                          ? <span className={row.discount_to_iv_pct > 0 ? 'text-pass' : 'text-fail'}>
                              {row.discount_to_iv_pct > 0 ? '+' : ''}{row.discount_to_iv_pct.toFixed(1)}%
                            </span>
                          : <span className="text-text-secondary">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {(row.tier === 'full_pass' || row.tier === 'near_miss') && row.buy_below_price != null ? (
                          <button
                            onClick={() => handleAddToWatchlist(row.ticker, row.buy_below_price)}
                            className="text-xs px-2 py-1 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                          >
                            +Watch
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function MobileCard({ row, onWatch, preliminary }) {
  const pending = !row.has_fundamentals && preliminary
  const filters = [
    { label: 'P/E', pass: row.passes_pe, val: row.pe_ratio?.toFixed(1), failed: row.failed_filter === 'pe' },
    { label: 'P/B', pass: row.passes_pb, val: row.pb_ratio?.toFixed(1), failed: row.failed_filter === 'pb' },
    { label: 'D/E', pass: row.passes_debt_equity, pending, failed: row.failed_filter === 'debt_equity' },
    { label: 'CR', pass: row.passes_current_ratio, pending, failed: row.failed_filter === 'current_ratio' },
    { label: 'Earn', pass: row.passes_earnings_stability, pending, failed: row.failed_filter === 'earnings_stability' },
    { label: 'Div', pass: row.passes_dividend_record, pending, failed: row.failed_filter === 'dividend_record' },
    { label: 'EPS', pass: row.passes_earnings_growth, pending, failed: row.failed_filter === 'earnings_growth' },
  ]

  return (
    <div className={`rounded p-4 ${
      row.tier === 'full_pass' ? 'bg-surface-secondary' :
      row.tier === 'near_miss' ? 'bg-surface-secondary border border-warn/30' :
      'bg-surface-secondary'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <Link to={`/analyze/${row.ticker}`} className="text-accent font-bold text-lg hover:underline">
          {row.ticker}
        </Link>
        <TierBadge tier={row.tier} passCount={row.pass_count} />
      </div>
      <div className="text-sm text-text-secondary mb-2">{row.company_name}</div>
      <div className="text-xs text-text-secondary mb-3">{row.sector}</div>

      {/* Near-miss info */}
      {row.tier === 'near_miss' && row.failed_filter && (
        <div className="text-xs text-warn bg-warn/10 rounded px-2 py-1 mb-3">
          Missed: {formatFilterName(row.failed_filter)}
          {row.actual_value != null && row.threshold_value != null && (
            <span> ({row.actual_value.toFixed(1)} vs {row.threshold_value.toFixed(1)})</span>
          )}
          {row.miss_severity && (
            <span className={row.miss_severity === 'marginal' ? 'text-warn' : 'text-fail'}> — {row.miss_severity}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 mb-3">
        <div>
          <span className="text-xs text-text-secondary block">Price</span>
          <span className="text-sm font-bold">${row.price?.toFixed(2)}</span>
        </div>
        {row.adjusted_intrinsic_value != null && (
          <div>
            <span className="text-xs text-text-secondary block">IV</span>
            <span className="text-sm">${row.adjusted_intrinsic_value.toFixed(0)}</span>
          </div>
        )}
        {row.buy_below_price != null && (
          <div>
            <span className="text-xs text-text-secondary block">Buy Below</span>
            <span className={`text-sm ${row.price <= row.buy_below_price ? 'text-pass font-bold' : ''}`}>
              ${row.buy_below_price.toFixed(0)}
            </span>
          </div>
        )}
        <div>
          <span className="text-xs text-text-secondary block">Signal</span>
          <SignalBadge row={row} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {filters.map(f => (
          <span key={f.label} className={`text-xs px-2 py-0.5 rounded ${
            f.pending ? 'bg-surface-tertiary text-text-secondary' :
            f.failed ? 'bg-warn/15 text-warn font-medium' :
            f.pass ? 'bg-pass/15 text-pass' : 'bg-fail/15 text-fail'
          }`}>
            {f.label}{f.pending ? '' : f.val ? ` ${f.val}` : ''}
          </span>
        ))}
      </div>

      {(row.tier === 'full_pass' || row.tier === 'near_miss') && row.buy_below_price != null && (
        <button
          onClick={() => onWatch(row.ticker, row.buy_below_price)}
          className="text-xs px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors w-full"
        >
          + Add to Watchlist
        </button>
      )}
    </div>
  )
}

function TierBadge({ tier, passCount }) {
  if (tier === 'full_pass') {
    return <span className="text-pass font-bold text-xs px-2 py-0.5 rounded bg-pass/15">PASS</span>
  }
  if (tier === 'near_miss') {
    return <span className="text-warn font-bold text-xs px-2 py-0.5 rounded bg-warn/15">7/8</span>
  }
  return <span className="text-fail text-xs px-2 py-0.5 rounded bg-fail/15">{passCount ?? 0}/8</span>
}

function SignalBadge({ row }) {
  if (!row.passes_all_hard || row.buy_below_price == null) {
    if (row.tier === 'near_miss' && row.buy_below_price != null) {
      // Show signal for near-miss stocks too
      if (row.price <= row.buy_below_price) {
        return <span className="text-warn font-bold text-xs px-2 py-0.5 rounded bg-warn/15">REVIEW</span>
      }
    }
    return <span className="text-text-secondary">—</span>
  }
  if (row.price <= row.buy_below_price) {
    return <span className="text-pass font-bold text-xs px-2 py-0.5 rounded bg-pass/15">BUY</span>
  }
  if (row.discount_to_iv_pct != null && row.discount_to_iv_pct > 0) {
    return <span className="text-warn font-bold text-xs px-2 py-0.5 rounded bg-warn/15">WAIT</span>
  }
  return <span className="text-fail text-xs px-2 py-0.5 rounded bg-fail/15">OVER</span>
}

function FilterCell({ pass, value, pending, failed, missInfo }) {
  if (pending) {
    return <span className="text-text-secondary">—</span>
  }
  if (failed && missInfo) {
    return (
      <span className="text-warn" title={
        missInfo.actual_value != null && missInfo.threshold_value != null
          ? `${missInfo.actual_value.toFixed(2)} vs ${missInfo.threshold_value.toFixed(2)} (${missInfo.miss_severity || 'clear'})`
          : 'Near miss'
      }>
        {value || 'X'}
      </span>
    )
  }
  return (
    <span className={pass ? 'text-pass' : 'text-fail'}>
      {value || (pass ? 'OK' : 'X')}
    </span>
  )
}

function formatFilterName(name) {
  const names = {
    pe: 'P/E',
    pb: 'P/B',
    pe_x_pb: 'P/E×P/B',
    debt_equity: 'Debt/Equity',
    current_ratio: 'Current Ratio',
    earnings_stability: 'Earnings Stability',
    dividend_record: 'Dividend Record',
    earnings_growth: 'Earnings Growth',
  }
  return names[name] || name
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
