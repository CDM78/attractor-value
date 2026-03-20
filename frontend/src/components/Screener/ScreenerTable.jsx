import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useScreenStore } from '../../stores/screenStore'
import { useWatchlistStore } from '../../stores/watchlistStore'
import { API_BASE } from '../../config.js'
import InfoTooltip from '../shared/InfoTooltip'

export default function ScreenerTable() {
  const { results, meta, loading, error, fetchResults,
          selectedTickers, toggleSelection, selectAllUnscored, clearSelection,
          batchJob, startBatchAnalysis, pollBatchProgress } = useScreenStore()
  const { addToWatchlist } = useWatchlistStore()
  const [filterMode, setFilterMode] = useState('passing')
  const [showSectorPB, setShowSectorPB] = useState(false)
  const [freshPrices, setFreshPrices] = useState({})
  const [refreshingTickers, setRefreshingTickers] = useState(new Set())

  useEffect(() => {
    fetchResults()
  }, [fetchResults])

  // Poll batch progress
  useEffect(() => {
    if (!batchJob?.jobId || batchJob.status === 'complete' || batchJob.status === 'error') return
    const interval = setInterval(() => pollBatchProgress(), 5000)
    return () => clearInterval(interval)
  }, [batchJob?.jobId, batchJob?.status, pollBatchProgress])

  // Refresh screener data when batch completes
  useEffect(() => {
    if (batchJob?.status === 'complete') fetchResults()
  }, [batchJob?.status, fetchResults])

  const handleRefreshPrice = useCallback(async (ticker) => {
    setRefreshingTickers(prev => new Set([...prev, ticker]))
    try {
      const res = await fetch(`${API_BASE}/api/quote?ticker=${ticker}&update=true`)
      if (res.ok) {
        const data = await res.json()
        setFreshPrices(prev => ({ ...prev, [ticker]: { price: data.price, changePct: data.changePct, at: Date.now() } }))
      }
    } catch { /* ignore */ }
    setRefreshingTickers(prev => { const s = new Set(prev); s.delete(ticker); return s })
  }, [])

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

  const filtered = filterMode === 'full_pass'
    ? fullPass
    : filterMode === 'near_miss'
    ? nearMiss
    : filterMode === 'passing'
    ? [...fullPass, ...nearMiss]
    : results

  const getPrice = (row) => freshPrices[row.ticker]?.price ?? row.price
  const isFresh = (ticker) => freshPrices[ticker] && (Date.now() - freshPrices[ticker].at) < 60000

  const handleExportCSV = () => {
    const headers = ['Ticker','Company','Sector','Price','P/E','P/B','Tier','Pass Count','Failed Filter','Attractor','Signal','Intrinsic Value','Buy Below','Discount %']
    const rows = filtered.map(r => {
      let signal = ''
      if (r.passes_all_hard && r.buy_below_price != null) {
        if (getPrice(r) <= r.buy_below_price) signal = 'BUY'
        else if (r.discount_to_iv_pct != null && r.discount_to_iv_pct > 0) signal = 'WAIT'
        else signal = 'OVER'
      }
      const aScore = r.adjusted_attractor_score ?? r.attractor_stability_score
      return [
        r.ticker, r.company_name, r.sector, getPrice(r)?.toFixed(2),
        r.pe_ratio?.toFixed(1), r.pb_ratio?.toFixed(1),
        r.tier || 'fail', r.pass_count || 0, r.failed_filter || '',
        aScore != null ? aScore.toFixed(1) : '',
        signal,
        r.adjusted_intrinsic_value?.toFixed(2) || '',
        r.buy_below_price?.toFixed(2) || '',
        r.discount_to_iv_pct?.toFixed(1) || '',
      ]
    })
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    downloadCSV(csv, 'screener.csv')
  }

  const selectable = filtered.filter(r => r.tier === 'full_pass' || r.tier === 'near_miss')
  const selectedCount = selectedTickers.size

  const handleStartBatch = () => {
    if (selectedCount === 0) return
    const cost = (selectedCount * 0.03).toFixed(2)
    if (!confirm(`Run attractor analysis on ${selectedCount} stocks?\nEstimated cost: ~$${cost}`)) return
    startBatchAnalysis()
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-bold">Stock Screener</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterMode('passing')}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              filterMode === 'passing' ? 'bg-pass/20 text-pass ring-1 ring-pass/40' : 'bg-surface-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            {filterMode === 'passing' ? `Passing + Near Miss (${fullPass.length + nearMiss.length})`
             : filterMode === 'full_pass' ? `Full Pass (${fullPass.length})`
             : filterMode === 'near_miss' ? `Near Miss (${nearMiss.length})`
             : `All (${results.length})`}
          </button>
          <button
            onClick={handleExportCSV}
            className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:text-accent transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Tier filter bar — click to filter */}
      <div className="flex flex-wrap gap-3 mb-4">
        <button
          onClick={() => setFilterMode(filterMode === 'full_pass' ? 'passing' : 'full_pass')}
          className={`text-xs px-3 py-1.5 rounded font-medium transition-colors cursor-pointer ${
            filterMode === 'full_pass' ? 'bg-pass/25 text-pass ring-1 ring-pass/40' :
            filterMode === 'passing' ? 'bg-pass/20 text-pass' : 'bg-pass/10 text-pass/70 hover:bg-pass/20'
          }`}
        >
          Full Pass: {meta?.full_pass_count ?? fullPass.length}
        </button>
        <button
          onClick={() => setFilterMode(filterMode === 'near_miss' ? 'passing' : 'near_miss')}
          className={`text-xs px-3 py-1.5 rounded font-medium transition-colors cursor-pointer ${
            filterMode === 'near_miss' ? 'bg-warn/25 text-warn ring-1 ring-warn/40' :
            filterMode === 'passing' ? 'bg-warn/20 text-warn' : 'bg-warn/10 text-warn/70 hover:bg-warn/20'
          }`}
        >
          Near Miss: {meta?.near_miss_count ?? nearMiss.length}
        </button>
        <button
          onClick={() => setFilterMode(filterMode === 'all' ? 'passing' : 'all')}
          className={`text-xs px-3 py-1.5 rounded font-medium transition-colors cursor-pointer ${
            filterMode === 'all' ? 'bg-surface-tertiary text-text-primary ring-1 ring-border' : 'bg-surface-tertiary/50 text-text-secondary hover:bg-surface-tertiary'
          }`}
        >
          Filtered Out: {meta?.fail_count ?? fails.length}
        </button>
      </div>

      {/* Batch analysis bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 mb-4 bg-accent/10 rounded px-4 py-2">
          <span className="text-sm text-accent font-medium">{selectedCount} selected</span>
          <button
            onClick={handleStartBatch}
            disabled={batchJob?.status === 'running'}
            className="text-xs px-3 py-1.5 rounded bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            Analyze Selected (~${(selectedCount * 0.03).toFixed(2)})
          </button>
          <button
            onClick={clearSelection}
            className="text-xs px-3 py-1.5 rounded text-text-secondary hover:text-text-primary transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Batch progress */}
      {batchJob?.status === 'running' && (
        <div className="mb-4 bg-surface-secondary rounded px-4 py-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-text-primary">
              Analyzing {batchJob.completed}/{batchJob.total}: <span className="text-accent font-medium">{batchJob.currentTicker || '...'}</span>
            </span>
            <span className="text-xs text-text-secondary">{Math.round((batchJob.completed / batchJob.total) * 100)}%</span>
          </div>
          <div className="w-full bg-surface-tertiary rounded-full h-1.5">
            <div className="bg-accent h-1.5 rounded-full transition-all" style={{ width: `${(batchJob.completed / batchJob.total) * 100}%` }} />
          </div>
        </div>
      )}
      {batchJob?.status === 'complete' && (
        <div className="mb-4 bg-pass/10 rounded px-4 py-2 text-sm text-pass">
          Batch analysis complete ({batchJob.total} stocks)
          {batchJob.errorMessage && <span className="text-warn ml-2">Some errors: {batchJob.errorMessage}</span>}
        </div>
      )}

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
                    {sector}: <span className="text-accent">&le; {threshold.toFixed(1)}</span>
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
            {/* Mobile batch button */}
            {filterMode === 'passing' && (
              <button
                onClick={() => { selectAllUnscored(selectable.filter(r => !r.attractor_stability_score).map(r => r.ticker)); }}
                disabled={batchJob?.status === 'running'}
                className="text-xs px-3 py-1.5 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors w-full disabled:opacity-50"
              >
                Analyze All Unscored
              </button>
            )}
            {filtered.map((row, i) => (
              <div key={row.ticker}>
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
                <MobileCard row={row} onWatch={handleAddToWatchlist} preliminary={meta?.preliminary} getPrice={getPrice} isFresh={isFresh} onRefresh={handleRefreshPrice} refreshing={refreshingTickers.has(row.ticker)} />
              </div>
            ))}
          </div>

          {/* Desktop: Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-text-secondary text-left whitespace-nowrap">
                  <th className="px-1 py-1.5 w-6">
                    <input
                      type="checkbox"
                      checked={selectable.length > 0 && selectable.every(r => selectedTickers.has(r.ticker))}
                      onChange={(e) => {
                        if (e.target.checked) selectable.forEach(r => { if (!selectedTickers.has(r.ticker)) toggleSelection(r.ticker) })
                        else clearSelection()
                      }}
                      className="accent-accent"
                      title="Select all"
                    />
                  </th>
                  <th className="px-1.5 py-1.5">Ticker</th>
                  <th className="px-1.5 py-1.5 hidden xl:table-cell">Company</th>
                  <th className="px-1.5 py-1.5 hidden 2xl:table-cell">Sector</th>
                  <th className="px-1.5 py-1.5">Price</th>
                  <th className="px-1.5 py-1.5">P/E<InfoTooltip termKey="pe_ratio" /></th>
                  <th className="px-1.5 py-1.5">P/B<InfoTooltip termKey="pb_ratio" /></th>
                  <th className="px-1.5 py-1.5 hidden xl:table-cell">PxB<InfoTooltip termKey="pe_x_pb" /></th>
                  <th className="px-1.5 py-1.5 hidden xl:table-cell">D/E<InfoTooltip termKey="debt_equity" /></th>
                  <th className="px-1.5 py-1.5 hidden xl:table-cell">CR<InfoTooltip termKey="current_ratio" /></th>
                  <th className="px-1.5 py-1.5 hidden 2xl:table-cell">Earn<InfoTooltip termKey="earnings_stability" /></th>
                  <th className="px-1.5 py-1.5 hidden 2xl:table-cell">Div<InfoTooltip termKey="dividend_record" /></th>
                  <th className="px-1.5 py-1.5 hidden 2xl:table-cell">EPS<InfoTooltip termKey="earnings_growth" /></th>
                  <th className="px-1.5 py-1.5">Tier<InfoTooltip termKey="full_pass" /></th>
                  <th className="px-1.5 py-1.5">Attr<InfoTooltip termKey="attractor_score" /></th>
                  <th className="px-1.5 py-1.5 min-w-[50px]">Signal<InfoTooltip termKey="signal_buy" /></th>
                  <th className="px-1.5 py-1.5">IV<InfoTooltip termKey="adjusted_iv" /></th>
                  <th className="px-1.5 py-1.5">Buy&lt;<InfoTooltip termKey="buy_below_price" /></th>
                  <th className="px-1.5 py-1.5">Disc<InfoTooltip termKey="discount_to_iv" /></th>
                  <th className="px-1.5 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const canSelect = row.tier === 'full_pass' || row.tier === 'near_miss'
                  const price = getPrice(row)
                  return (
                  <>
                    {i > 0 && row.tier === 'near_miss' && filtered[i - 1]?.tier === 'full_pass' && (
                      <tr key={`divider-nm-${i}`}>
                        <td colSpan={20} className="px-3 py-2 border-t-2 border-warn/30">
                          <span className="text-xs text-warn font-medium">Near Misses (7/8 filters)</span>
                        </td>
                      </tr>
                    )}
                    {i > 0 && row.tier !== 'full_pass' && row.tier !== 'near_miss' && (filtered[i - 1]?.tier === 'full_pass' || filtered[i - 1]?.tier === 'near_miss') && (
                      <tr key={`divider-fail-${i}`}>
                        <td colSpan={20} className="px-3 py-2 border-t-2 border-border">
                          <span className="text-xs text-text-secondary">Below Threshold ({fails.length} stocks)</span>
                        </td>
                      </tr>
                    )}
                    <tr key={row.ticker} className={`border-b border-border/50 hover:bg-surface-secondary whitespace-nowrap ${
                      row.tier === 'full_pass' ? '' : row.tier === 'near_miss' ? 'bg-warn/5' : ''
                    }`}>
                      <td className="px-1 py-1.5">
                        {canSelect && (
                          <input
                            type="checkbox"
                            checked={selectedTickers.has(row.ticker)}
                            onChange={() => toggleSelection(row.ticker)}
                            className="accent-accent"
                          />
                        )}
                      </td>
                      <td className="px-1.5 py-1.5 font-bold">
                        <Link to={`/analyze/${row.ticker}`} className="text-accent hover:underline">{row.ticker}</Link>
                      </td>
                      <td className="px-1.5 py-1.5 hidden xl:table-cell max-w-[120px] truncate">{row.company_name}</td>
                      <td className="px-1.5 py-1.5 text-text-secondary hidden 2xl:table-cell">{row.sector}</td>
                      <td className="px-1.5 py-1.5">
                        <span className={isFresh(row.ticker) ? 'text-pass' : ''}>
                          ${price?.toFixed(2)}
                        </span>
                        <button
                          onClick={() => handleRefreshPrice(row.ticker)}
                          disabled={refreshingTickers.has(row.ticker)}
                          className="ml-0.5 text-text-secondary hover:text-accent transition-colors disabled:opacity-30 inline-flex align-middle"
                          title="Refresh price"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 ${refreshingTickers.has(row.ticker) ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      </td>
                      <td className="px-1.5 py-1.5"><FilterCell pass={row.passes_pe} value={row.pe_ratio?.toFixed(1)} failed={row.failed_filter === 'pe'} missInfo={row} /></td>
                      <td className="px-1.5 py-1.5"><FilterCell pass={row.passes_pb} value={row.pb_ratio?.toFixed(1)} failed={row.failed_filter === 'pb'} missInfo={row} /></td>
                      <td className="px-1.5 py-1.5 hidden xl:table-cell"><FilterCell pass={row.passes_pe_x_pb} failed={row.failed_filter === 'pe_x_pb'} missInfo={row} /></td>
                      <td className="px-1.5 py-1.5 hidden xl:table-cell"><FilterCell pass={row.passes_debt_equity} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'debt_equity'} missInfo={row} autoPass={row.de_auto_pass} /></td>
                      <td className="px-1.5 py-1.5 hidden xl:table-cell"><FilterCell pass={row.passes_current_ratio} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'current_ratio'} missInfo={row} autoPass={row.cr_auto_pass} /></td>
                      <td className="px-1.5 py-1.5 hidden 2xl:table-cell"><FilterCell pass={row.passes_earnings_stability} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'earnings_stability'} missInfo={row} /></td>
                      <td className="px-1.5 py-1.5 hidden 2xl:table-cell"><FilterCell pass={row.passes_dividend_record} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'dividend_record'} missInfo={row} /></td>
                      <td className="px-1.5 py-1.5 hidden 2xl:table-cell"><FilterCell pass={row.passes_earnings_growth} pending={!row.has_fundamentals && meta?.preliminary} failed={row.failed_filter === 'earnings_growth'} missInfo={row} /></td>
                      <td className="px-1.5 py-1.5">
                        <TierBadge tier={row.tier} passCount={row.pass_count} />
                      </td>
                      <td className="px-1.5 py-1.5">
                        <AttractorBadge score={row.adjusted_attractor_score ?? row.attractor_stability_score} regime={row.attractor_regime} />
                      </td>
                      <td className="px-1.5 py-1.5">
                        <SignalBadge row={row} price={price} />
                      </td>
                      <td className="px-1.5 py-1.5">
                        {isDissolvingAttractor(row)
                          ? <span className="text-text-secondary" title="Dissolving attractor">&mdash;</span>
                          : row.adjusted_intrinsic_value != null
                            ? <span>${row.adjusted_intrinsic_value.toFixed(0)}</span>
                            : <span className="text-text-secondary">&mdash;</span>}
                      </td>
                      <td className="px-1.5 py-1.5">
                        {isDissolvingAttractor(row)
                          ? <span className="text-text-secondary" title="Dissolving attractor">&mdash;</span>
                          : row.buy_below_price != null
                            ? <span className={price <= row.buy_below_price ? 'text-pass font-bold' : 'text-text-secondary'}>
                                ${row.buy_below_price.toFixed(0)}
                              </span>
                            : <span className="text-text-secondary">&mdash;</span>}
                      </td>
                      <td className="px-1.5 py-1.5">
                        {row.discount_to_iv_pct != null
                          ? <span className={row.discount_to_iv_pct > 0 ? 'text-pass' : 'text-fail'}>
                              {row.discount_to_iv_pct > 0 ? '+' : ''}{row.discount_to_iv_pct.toFixed(1)}%
                            </span>
                          : <span className="text-text-secondary">&mdash;</span>}
                      </td>
                      <td className="px-1.5 py-1.5">
                        {canSelect && row.buy_below_price != null ? (
                          <button
                            onClick={() => handleAddToWatchlist(row.ticker, row.buy_below_price)}
                            className="px-1.5 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                          >
                            +Watch
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  </>
                )})}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function AttractorBadge({ score, regime }) {
  if (score == null) return <span className="text-text-secondary">&mdash;</span>
  const regimeLabel = { classical: 'C', soft_network: 'SN', hard_network: 'HN', platform: 'P' }[regime] || ''
  const color = score >= 3.5 ? 'text-pass bg-pass/15' : score >= 2.0 ? 'text-warn bg-warn/15' : 'text-fail bg-fail/15'
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded ${color}`} title={`Attractor score: ${score.toFixed(1)}/5 (${regime || 'unknown'})`}>
      {score.toFixed(1)}{regimeLabel ? ` ${regimeLabel}` : ''}
    </span>
  )
}

function MobileCard({ row, onWatch, preliminary, getPrice, isFresh, onRefresh, refreshing }) {
  const pending = !row.has_fundamentals && preliminary
  const price = getPrice(row)
  const aScore = row.adjusted_attractor_score ?? row.attractor_stability_score
  const filters = [
    { label: 'P/E', pass: row.passes_pe, val: row.pe_ratio?.toFixed(1), failed: row.failed_filter === 'pe' },
    { label: 'P/B', pass: row.passes_pb, val: row.pb_ratio?.toFixed(1), failed: row.failed_filter === 'pb' },
    { label: 'D/E', pass: row.passes_debt_equity, pending, failed: row.failed_filter === 'debt_equity', autoPass: row.de_auto_pass },
    { label: 'CR', pass: row.passes_current_ratio, pending, failed: row.failed_filter === 'current_ratio', autoPass: row.cr_auto_pass },
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
        <div className="flex items-center gap-2">
          {aScore != null && <AttractorBadge score={aScore} regime={row.attractor_regime} />}
          <TierBadge tier={row.tier} passCount={row.pass_count} />
        </div>
      </div>
      <div className="text-sm text-text-secondary mb-2">{row.company_name}</div>
      <div className="text-xs text-text-secondary mb-3">{row.sector}</div>

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
          <span className={`text-sm font-bold ${isFresh(row.ticker) ? 'text-pass' : ''}`}>
            ${price?.toFixed(2)}
          </span>
          <button onClick={() => onRefresh(row.ticker)} disabled={refreshing} className="ml-1 text-text-secondary hover:text-accent text-xs">
            {refreshing ? '...' : '\u21BB'}
          </button>
        </div>
        {row.adjusted_intrinsic_value != null && !isDissolvingAttractor(row) && (
          <div>
            <span className="text-xs text-text-secondary block">IV</span>
            <span className="text-sm">${row.adjusted_intrinsic_value.toFixed(0)}</span>
          </div>
        )}
        {row.buy_below_price != null && !isDissolvingAttractor(row) && (
          <div>
            <span className="text-xs text-text-secondary block">Buy Below</span>
            <span className={`text-sm ${price <= row.buy_below_price ? 'text-pass font-bold' : ''}`}>
              ${row.buy_below_price.toFixed(0)}
            </span>
          </div>
        )}
        <div>
          <span className="text-xs text-text-secondary block">Signal</span>
          <SignalBadge row={row} price={price} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {filters.map(f => (
          <span key={f.label} className={`text-xs px-2 py-0.5 rounded ${
            f.pending ? 'bg-surface-tertiary text-text-secondary' :
            f.autoPass ? 'bg-accent/15 text-accent font-medium' :
            f.failed ? 'bg-warn/15 text-warn font-medium' :
            f.pass ? 'bg-pass/15 text-pass' : 'bg-fail/15 text-fail'
          }`} title={f.autoPass ? 'Exempt — financial sector' : undefined}>
            {f.label}{f.autoPass ? ' E' : f.pending ? '' : f.val ? ` ${f.val}` : ''}
          </span>
        ))}
      </div>

      {(row.tier === 'full_pass' || row.tier === 'near_miss') && row.buy_below_price != null && !isDissolvingAttractor(row) && (
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

// Dissolving attractor: adjusted score < 2.0 means "do not buy"
function isDissolvingAttractor(row) {
  const score = row.adjusted_attractor_score ?? row.attractor_stability_score
  return score != null && score < 2.0
}

function SignalBadge({ row, price }) {
  const currentPrice = price ?? row.price
  const isFullPass = row.tier === 'full_pass' || row.passes_all_hard
  const isNearMiss = row.tier === 'near_miss'
  const hasBuyBelow = row.buy_below_price != null && row.buy_below_price > 0

  if (!isFullPass && !isNearMiss) return <span className="text-text-secondary">&mdash;</span>

  // Dissolving attractor overrides all other signals
  if (isDissolvingAttractor(row)) {
    return <span className="text-fail font-bold text-xs px-1.5 py-0.5 rounded bg-fail/15 whitespace-nowrap" title="Dissolving attractor — do not buy">DNB</span>
  }

  if (!hasBuyBelow) return <span className="text-text-secondary">&mdash;</span>

  if (currentPrice <= row.buy_below_price) {
    if (isNearMiss) {
      return <span className="text-warn font-bold text-xs px-1.5 py-0.5 rounded bg-warn/15 whitespace-nowrap">BUY*</span>
    }
    return <span className="text-pass font-bold text-xs px-1.5 py-0.5 rounded bg-pass/15 whitespace-nowrap">BUY</span>
  }
  if (row.discount_to_iv_pct != null && row.discount_to_iv_pct > 0) {
    return <span className="text-warn font-bold text-xs px-1.5 py-0.5 rounded bg-warn/15 whitespace-nowrap">WAIT</span>
  }
  return <span className="text-fail text-xs px-1.5 py-0.5 rounded bg-fail/15 whitespace-nowrap">OVER</span>
}

function FilterCell({ pass, value, pending, failed, missInfo, autoPass }) {
  if (pending) {
    return <span className="text-text-secondary">&mdash;</span>
  }
  if (autoPass) {
    return (
      <span className="text-accent font-medium" title="Exempt — financial sector">
        E
      </span>
    )
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
    pe_x_pb: 'P/E\u00D7P/B',
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
