import { useEffect } from 'react'
import { useScreenStore } from '../../stores/screenStore'

export default function ScreenerTable() {
  const { results, loading, error, fetchResults } = useScreenStore()

  useEffect(() => {
    fetchResults()
  }, [fetchResults])

  if (loading) return <div className="text-text-secondary">Loading screener results...</div>
  if (error) return <div className="text-fail">Error: {error}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Stock Screener</h2>
        <span className="text-text-secondary text-sm">
          {results.length} stocks in universe
        </span>
      </div>

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
                <th className="px-3 py-2">Earn Stab</th>
                <th className="px-3 py-2">Div</th>
                <th className="px-3 py-2">EPS Gr</th>
                <th className="px-3 py-2">Pass</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.ticker} className="border-b border-border/50 hover:bg-surface-secondary">
                  <td className="px-3 py-2 font-bold text-accent">{row.ticker}</td>
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
