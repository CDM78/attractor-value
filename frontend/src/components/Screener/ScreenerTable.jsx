import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useScreenStore } from '../../stores/screenStore'
import { useWatchlistStore } from '../../stores/watchlistStore'

export default function ScreenerTable() {
  const { results, meta, loading, error, fetchResults } = useScreenStore()
  const { addToWatchlist } = useWatchlistStore()

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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Stock Screener</h2>
        <span className="text-text-secondary text-sm">
          {results.length} stocks in universe
        </span>
      </div>

      {/* Dynamic P/E ceiling info bar (Update 2) */}
      {meta && (
        <div className="bg-surface-secondary rounded px-4 py-2 mb-4 text-sm flex items-center gap-4">
          <span className="text-text-secondary">
            Current max P/E:{' '}
            <span className="text-accent font-bold">{meta.dynamic_pe_ceiling}</span>
          </span>
          {meta.aaa_bond_yield && (
            <span className="text-text-secondary">
              (AAA yield: {meta.aaa_bond_yield.toFixed(2)}% + 1.5% equity premium)
            </span>
          )}
        </div>
      )}

      {results.length === 0 ? (
        <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
          No screening data yet. Run a data refresh to populate.
        </div>
      ) : (
        <div className="overflow-x-auto">
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
                <th className="px-3 py-2">Intr. Value</th>
                <th className="px-3 py-2">Buy Below</th>
                <th className="px-3 py-2">Discount</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.ticker} className="border-b border-border/50 hover:bg-surface-secondary">
                  <td className="px-3 py-2 font-bold">
                    <Link to={`/analyze/${row.ticker}`} className="text-accent hover:underline">{row.ticker}</Link>
                  </td>
                  <td className="px-3 py-2">{row.company_name}</td>
                  <td className="px-3 py-2 text-text-secondary">{row.sector}</td>
                  <td className="px-3 py-2">${row.price?.toFixed(2)}</td>
                  <td className="px-3 py-2">
                    <FilterCell pass={row.passes_pe} value={row.pe_ratio?.toFixed(1)} />
                  </td>
                  <td className="px-3 py-2">
                    <FilterCell pass={row.passes_pb} value={row.pb_ratio?.toFixed(1)} />
                  </td>
                  <td className="px-3 py-2">
                    <FilterCell pass={row.passes_pe_x_pb} />
                  </td>
                  <td className="px-3 py-2">
                    <FilterCell pass={row.passes_debt_equity} />
                  </td>
                  <td className="px-3 py-2">
                    <FilterCell pass={row.passes_current_ratio} />
                  </td>
                  <td className="px-3 py-2">
                    <FilterCell pass={row.passes_earnings_stability} />
                  </td>
                  <td className="px-3 py-2">
                    <FilterCell pass={row.passes_dividend_record} />
                  </td>
                  <td className="px-3 py-2">
                    <FilterCell pass={row.passes_earnings_growth} />
                  </td>
                  <td className="px-3 py-2">
                    <span className={row.passes_all_hard ? 'text-pass font-bold' : 'text-fail'}>
                      {row.passes_all_hard ? 'PASS' : 'FAIL'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.adjusted_intrinsic_value != null
                      ? <span className="text-text-primary">${row.adjusted_intrinsic_value.toFixed(2)}</span>
                      : <span className="text-text-secondary">—</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    {row.buy_below_price != null
                      ? <span className={row.price <= row.buy_below_price ? 'text-pass font-bold' : 'text-text-secondary'}>
                          ${row.buy_below_price.toFixed(2)}
                        </span>
                      : <span className="text-text-secondary">—</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    {row.discount_to_iv_pct != null
                      ? <span className={row.discount_to_iv_pct > 0 ? 'text-pass' : 'text-fail'}>
                          {row.discount_to_iv_pct > 0 ? '+' : ''}{row.discount_to_iv_pct.toFixed(1)}%
                        </span>
                      : <span className="text-text-secondary">—</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    {row.passes_all_hard && row.buy_below_price != null ? (
                      <button
                        onClick={() => handleAddToWatchlist(row.ticker, row.buy_below_price)}
                        className="text-xs px-2 py-1 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                        title="Add to watchlist"
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
      )}
    </div>
  )
}

function FilterCell({ pass, value }) {
  return (
    <span className={pass ? 'text-pass' : 'text-fail'}>
      {value || (pass ? 'OK' : 'X')}
    </span>
  )
}
