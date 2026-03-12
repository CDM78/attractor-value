import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useScreenStore } from '../../stores/screenStore'
import { useWatchlistStore } from '../../stores/watchlistStore'
import { API_BASE } from '../../config.js'

export default function ScreenerTable() {
  const { results, meta, loading, error, fetchResults } = useScreenStore()
  const { addToWatchlist } = useWatchlistStore()
  const [showPassOnly, setShowPassOnly] = useState(false)

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

  const handleExportCSV = () => {
    const headers = ['Ticker','Company','Sector','Price','P/E','P/B','Pass','Intrinsic Value','Buy Below','Discount %']
    const rows = filtered.map(r => [
      r.ticker, r.company_name, r.sector, r.price?.toFixed(2),
      r.pe_ratio?.toFixed(1), r.pb_ratio?.toFixed(1),
      r.passes_all_hard ? 'PASS' : 'FAIL',
      r.adjusted_intrinsic_value?.toFixed(2) || '',
      r.buy_below_price?.toFixed(2) || '',
      r.discount_to_iv_pct?.toFixed(1) || '',
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    downloadCSV(csv, 'screener.csv')
  }

  const filtered = showPassOnly ? results.filter(r => r.passes_all_hard) : results
  const passCount = results.filter(r => r.passes_all_hard).length

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-bold">Stock Screener</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPassOnly(!showPassOnly)}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              showPassOnly ? 'bg-pass/20 text-pass' : 'bg-surface-tertiary text-text-secondary'
            }`}
          >
            {showPassOnly ? `Passing (${passCount})` : `All (${results.length})`}
          </button>
          <button
            onClick={handleExportCSV}
            className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:text-accent transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {meta && (
        <div className="bg-surface-secondary rounded px-4 py-2 mb-4 text-sm flex flex-wrap items-center gap-2 md:gap-4">
          <span className="text-text-secondary">
            Max P/E: <span className="text-accent font-bold">{meta.dynamic_pe_ceiling}</span>
          </span>
          {meta.aaa_bond_yield && (
            <span className="text-text-secondary hidden md:inline">
              (AAA: {meta.aaa_bond_yield.toFixed(2)}% + 1.5% premium)
            </span>
          )}
          {meta.preliminary && (
            <span className="text-warn text-xs ml-auto">
              Preliminary — full fundamentals loading (6/day)
            </span>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
          {showPassOnly ? 'No stocks pass all hard filters yet.' : 'No screening data yet. Click Refresh to populate.'}
        </div>
      ) : (
        <>
          {/* Mobile: Card View */}
          <div className="md:hidden space-y-3">
            {filtered.map(row => (
              <MobileCard key={row.ticker} row={row} onWatch={handleAddToWatchlist} preliminary={meta?.preliminary} />
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
                  <th className="px-3 py-2">Pass</th>
                  <th className="px-3 py-2">IV</th>
                  <th className="px-3 py-2">Buy Below</th>
                  <th className="px-3 py-2">Disc.</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.ticker} className="border-b border-border/50 hover:bg-surface-secondary">
                    <td className="px-3 py-2 font-bold">
                      <Link to={`/analyze/${row.ticker}`} className="text-accent hover:underline">{row.ticker}</Link>
                    </td>
                    <td className="px-3 py-2">{row.company_name}</td>
                    <td className="px-3 py-2 text-text-secondary">{row.sector}</td>
                    <td className="px-3 py-2">${row.price?.toFixed(2)}</td>
                    <td className="px-3 py-2"><FilterCell pass={row.passes_pe} value={row.pe_ratio?.toFixed(1)} /></td>
                    <td className="px-3 py-2"><FilterCell pass={row.passes_pb} value={row.pb_ratio?.toFixed(1)} /></td>
                    <td className="px-3 py-2"><FilterCell pass={row.passes_pe_x_pb} /></td>
                    <td className="px-3 py-2"><FilterCell pass={row.passes_debt_equity} pending={!row.has_fundamentals && meta?.preliminary} /></td>
                    <td className="px-3 py-2"><FilterCell pass={row.passes_current_ratio} pending={!row.has_fundamentals && meta?.preliminary} /></td>
                    <td className="px-3 py-2"><FilterCell pass={row.passes_earnings_stability} pending={!row.has_fundamentals && meta?.preliminary} /></td>
                    <td className="px-3 py-2"><FilterCell pass={row.passes_dividend_record} pending={!row.has_fundamentals && meta?.preliminary} /></td>
                    <td className="px-3 py-2"><FilterCell pass={row.passes_earnings_growth} pending={!row.has_fundamentals && meta?.preliminary} /></td>
                    <td className="px-3 py-2">
                      {!row.has_fundamentals && meta?.preliminary ? (
                        <span className="text-text-secondary text-xs">PENDING</span>
                      ) : (
                        <span className={row.passes_all_hard ? 'text-pass font-bold' : 'text-fail'}>
                          {row.passes_all_hard ? 'PASS' : 'FAIL'}
                        </span>
                      )}
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
                      {row.passes_all_hard && row.buy_below_price != null ? (
                        <button
                          onClick={() => handleAddToWatchlist(row.ticker, row.buy_below_price)}
                          className="text-xs px-2 py-1 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                        >
                          +Watch
                        </button>
                      ) : null}
                    </td>
                  </tr>
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
    { label: 'P/E', pass: row.passes_pe, val: row.pe_ratio?.toFixed(1) },
    { label: 'P/B', pass: row.passes_pb, val: row.pb_ratio?.toFixed(1) },
    { label: 'D/E', pass: row.passes_debt_equity, pending },
    { label: 'CR', pass: row.passes_current_ratio, pending },
    { label: 'Earn', pass: row.passes_earnings_stability, pending },
    { label: 'Div', pass: row.passes_dividend_record, pending },
    { label: 'EPS', pass: row.passes_earnings_growth, pending },
  ]

  return (
    <div className="bg-surface-secondary rounded p-4">
      <div className="flex items-center justify-between mb-2">
        <Link to={`/analyze/${row.ticker}`} className="text-accent font-bold text-lg hover:underline">
          {row.ticker}
        </Link>
        {pending ? (
          <span className="text-text-secondary text-xs">PENDING</span>
        ) : (
          <span className={row.passes_all_hard ? 'text-pass font-bold text-sm' : 'text-fail text-sm'}>
            {row.passes_all_hard ? 'PASS' : 'FAIL'}
          </span>
        )}
      </div>
      <div className="text-sm text-text-secondary mb-2">{row.company_name}</div>
      <div className="text-xs text-text-secondary mb-3">{row.sector}</div>

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
        {row.discount_to_iv_pct != null && (
          <div>
            <span className="text-xs text-text-secondary block">Discount</span>
            <span className={`text-sm ${row.discount_to_iv_pct > 0 ? 'text-pass' : 'text-fail'}`}>
              {row.discount_to_iv_pct > 0 ? '+' : ''}{row.discount_to_iv_pct.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {filters.map(f => (
          <span key={f.label} className={`text-xs px-2 py-0.5 rounded ${
            f.pending ? 'bg-surface-tertiary text-text-secondary' : f.pass ? 'bg-pass/15 text-pass' : 'bg-fail/15 text-fail'
          }`}>
            {f.label}{f.pending ? '' : f.val ? ` ${f.val}` : ''}
          </span>
        ))}
      </div>

      {row.passes_all_hard && row.buy_below_price != null && (
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

function FilterCell({ pass, value, pending }) {
  if (pending) {
    return <span className="text-text-secondary">—</span>
  }
  return (
    <span className={pass ? 'text-pass' : 'text-fail'}>
      {value || (pass ? 'OK' : 'X')}
    </span>
  )
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
