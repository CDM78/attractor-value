import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWatchlistStore } from '../../stores/watchlistStore'
import { API_BASE } from '../../config.js'
import FactorBars from './FactorBars.jsx'
import ComparePanel from './ComparePanel.jsx'
import InfoTooltip from '../shared/InfoTooltip'

export default function WatchlistTable() {
  const { items, loading, error, fetchWatchlist, addToWatchlist, removeFromWatchlist,
          compareSelection, toggleCompare, clearCompare, getStageGroups } = useWatchlistStore()
  const [showAdd, setShowAdd] = useState(false)
  const [newTicker, setNewTicker] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [showCompare, setShowCompare] = useState(false)
  const [freshPrices, setFreshPrices] = useState({})
  const [refreshingTickers, setRefreshingTickers] = useState(new Set())
  const [analyzingTickers, setAnalyzingTickers] = useState(new Set())
  const [collapsedStages, setCollapsedStages] = useState(new Set())

  useEffect(() => {
    fetchWatchlist()
  }, [fetchWatchlist])

  const handleRefreshPrice = useCallback(async (ticker) => {
    setRefreshingTickers(prev => new Set([...prev, ticker]))
    try {
      const res = await fetch(`${API_BASE}/api/quote?ticker=${ticker}&update=true`)
      if (res.ok) {
        const data = await res.json()
        setFreshPrices(prev => ({ ...prev, [ticker]: { price: data.price, at: Date.now() } }))
      }
    } catch { /* ignore */ }
    setRefreshingTickers(prev => { const s = new Set(prev); s.delete(ticker); return s })
  }, [])

  const handleRunAnalysis = useCallback(async (ticker) => {
    setAnalyzingTickers(prev => new Set([...prev, ticker]))
    try {
      const res = await fetch(`${API_BASE}/api/analyze?ticker=${ticker}`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fetchWatchlist() // refresh to get new scores
    } catch (err) {
      alert(`Analysis failed for ${ticker}: ${err.message}`)
    }
    setAnalyzingTickers(prev => { const s = new Set(prev); s.delete(ticker); return s })
  }, [fetchWatchlist])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!newTicker.trim()) return
    try {
      await addToWatchlist(newTicker.trim().toUpperCase(), newNotes, newTarget ? parseFloat(newTarget) : null)
      setNewTicker('')
      setNewNotes('')
      setNewTarget('')
      setShowAdd(false)
      fetchWatchlist()
    } catch (err) {
      alert(`Failed: ${err.message}`)
    }
  }

  const handleRemove = async (ticker) => {
    if (!confirm(`Remove ${ticker} from watchlist?`)) return
    try {
      await removeFromWatchlist(ticker)
      fetchWatchlist()
    } catch (err) {
      alert(`Failed: ${err.message}`)
    }
  }

  const toggleStage = (stage) => {
    setCollapsedStages(prev => {
      const s = new Set(prev)
      if (s.has(stage)) s.delete(stage)
      else s.add(stage)
      return s
    })
  }

  const getPrice = (item) => freshPrices[item.ticker]?.price ?? item.price
  const isFresh = (ticker) => freshPrices[ticker] && (Date.now() - freshPrices[ticker].at) < 60000

  if (loading) return <div className="text-text-secondary">Loading watchlist...</div>
  if (error) return <div className="text-fail">Error: {error}</div>

  const { needsAnalysis, waitingForPrice, buySignal } = getStageGroups()
  const compareItems = items.filter(i => compareSelection.has(i.ticker))

  const handleExportCSV = () => {
    const headers = ['Ticker','Company','Sector','Price','Buy Below','Target','Discount %','Attractor','Signal','Insider','Added','Notes']
    const rows = items.map(i => {
      const aScore = i.adjusted_attractor_score ?? i.attractor_stability_score
      return [
        i.ticker, i.company_name, i.sector, getPrice(i)?.toFixed(2),
        i.buy_below_price?.toFixed(2) || '', i.target_buy_price?.toFixed(2) || '',
        i.discount_to_iv_pct?.toFixed(1) || '', aScore?.toFixed(1) || '',
        i.insider_signal || '', i.added_date, `"${(i.notes || '').replace(/"/g, '""')}"`
      ]
    })
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'watchlist.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-bold">Watchlist</h2>
        <div className="flex items-center gap-2">
          {compareSelection.size >= 2 && (
            <button
              onClick={() => setShowCompare(true)}
              className="text-xs px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
            >
              Compare ({compareSelection.size})
            </button>
          )}
          {items.length > 0 && (
            <button onClick={handleExportCSV} className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:text-accent transition-colors">
              Export CSV
            </button>
          )}
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-sm px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
          >
            {showAdd ? 'Cancel' : '+ Add Ticker'}
          </button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-surface-secondary rounded p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Ticker</label>
            <input type="text" value={newTicker} onChange={(e) => setNewTicker(e.target.value)} placeholder="AAPL" className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-24" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">Target Buy Price</label>
            <input type="number" step="0.01" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="0.00" className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-28" />
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-text-secondary mb-1">Notes</label>
            <input type="text" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Why are you watching this stock?" className="bg-surface-tertiary border border-border rounded px-3 py-1.5 text-sm text-text-primary w-full" />
          </div>
          <button type="submit" className="px-4 py-1.5 rounded bg-accent text-white text-sm hover:bg-accent/80 transition-colors">Add</button>
        </form>
      )}

      {items.length === 0 ? (
        <div className="text-text-secondary bg-surface-secondary rounded p-8 text-center">
          Your watchlist is empty. Add stocks from the screener or manually above.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Buy Signal stage */}
          {buySignal.length > 0 && (
            <StageSection
              title="Buy Signal"
              count={buySignal.length}
              badgeClass="bg-pass/15 text-pass"
              collapsed={collapsedStages.has('buy')}
              onToggle={() => toggleStage('buy')}
            >
              <StageTable
                items={buySignal} highlight onRemove={handleRemove} onRefresh={handleRefreshPrice}
                refreshing={refreshingTickers} getPrice={getPrice} isFresh={isFresh}
                compareSelection={compareSelection} onToggleCompare={toggleCompare}
              />
            </StageSection>
          )}

          {/* Waiting for Price stage */}
          {waitingForPrice.length > 0 && (
            <StageSection
              title="Waiting for Price"
              count={waitingForPrice.length}
              badgeClass="bg-warn/15 text-warn"
              collapsed={collapsedStages.has('waiting')}
              onToggle={() => toggleStage('waiting')}
            >
              <StageTable
                items={waitingForPrice} onRemove={handleRemove} onRefresh={handleRefreshPrice}
                refreshing={refreshingTickers} getPrice={getPrice} isFresh={isFresh}
                compareSelection={compareSelection} onToggleCompare={toggleCompare}
              />
            </StageSection>
          )}

          {/* Needs Analysis stage */}
          {needsAnalysis.length > 0 && (
            <StageSection
              title="Needs Analysis"
              count={needsAnalysis.length}
              badgeClass="bg-accent/15 text-accent"
              collapsed={collapsedStages.has('needs')}
              onToggle={() => toggleStage('needs')}
            >
              <StageTable
                items={needsAnalysis} onRemove={handleRemove} onRefresh={handleRefreshPrice}
                refreshing={refreshingTickers} getPrice={getPrice} isFresh={isFresh}
                showAnalyzeButton onAnalyze={handleRunAnalysis} analyzingTickers={analyzingTickers}
                compareSelection={compareSelection} onToggleCompare={toggleCompare}
              />
            </StageSection>
          )}
        </div>
      )}

      {showCompare && compareItems.length >= 2 && (
        <ComparePanel items={compareItems} onClose={() => { setShowCompare(false); clearCompare() }} />
      )}
    </div>
  )
}

function StageSection({ title, count, badgeClass, collapsed, onToggle, children }) {
  return (
    <div className="bg-surface-secondary rounded overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-tertiary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2.5 py-1 rounded ${badgeClass}`}>{count}</span>
          <span className="text-sm font-medium text-text-primary">{title}</span>
        </div>
        <span className="text-text-secondary text-xs">{collapsed ? '\u25B6' : '\u25BC'}</span>
      </button>
      {!collapsed && <div className="border-t border-border/50">{children}</div>}
    </div>
  )
}

function StageTable({ items, highlight, onRemove, onRefresh, refreshing, getPrice, isFresh,
                      showAnalyzeButton, onAnalyze, analyzingTickers,
                      compareSelection, onToggleCompare }) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-secondary text-left whitespace-nowrap">
              <th className="px-1 py-1.5 w-6"></th>
              <th className="px-1.5 py-1.5">Ticker</th>
              <th className="px-1.5 py-1.5 hidden lg:table-cell">Company</th>
              <th className="px-1.5 py-1.5">Price</th>
              <th className="px-1.5 py-1.5">Buy&lt;<InfoTooltip termKey="buy_below_price" /></th>
              <th className="px-1.5 py-1.5">Disc<InfoTooltip termKey="discount_to_iv" /></th>
              <th className="px-1.5 py-1.5">Attr<InfoTooltip termKey="attractor_score" /></th>
              <th className="px-1.5 py-1.5 hidden lg:table-cell">Factors</th>
              <th className="px-1.5 py-1.5">Insider<InfoTooltip termKey="insider_signal" /></th>
              <th className="px-1.5 py-1.5 hidden xl:table-cell">Notes</th>
              <th className="px-1.5 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const price = getPrice(item)
              const aScore = item.adjusted_attractor_score ?? item.attractor_stability_score
              const atBuyBelow = price && item.buy_below_price && price <= item.buy_below_price
              return (
                <tr key={item.ticker} className={`border-b border-border/30 hover:bg-surface-tertiary/30 whitespace-nowrap ${highlight && atBuyBelow ? 'bg-pass/5' : ''}`}>
                  <td className="px-1 py-1.5">
                    {aScore != null && (
                      <input
                        type="checkbox"
                        checked={compareSelection.has(item.ticker)}
                        onChange={() => onToggleCompare(item.ticker)}
                        className="accent-accent"
                        title="Select for comparison"
                      />
                    )}
                  </td>
                  <td className="px-1.5 py-1.5 font-bold">
                    <Link to={`/analyze/${item.ticker}`} className="text-accent hover:underline">{item.ticker}</Link>
                  </td>
                  <td className="px-1.5 py-1.5 text-text-secondary hidden lg:table-cell max-w-[120px] truncate">{item.company_name}</td>
                  <td className="px-1.5 py-1.5">
                    <span className={isFresh(item.ticker) ? 'text-pass' : ''}>
                      ${price?.toFixed(2)}
                    </span>
                    <button
                      onClick={() => onRefresh(item.ticker)}
                      disabled={refreshing.has(item.ticker)}
                      className="ml-1 text-text-secondary hover:text-accent transition-colors disabled:opacity-30 inline-flex align-middle"
                      title="Refresh price"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 ${refreshing.has(item.ticker) ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </td>
                  <td className="px-1.5 py-1.5">
                    {item.buy_below_price != null
                      ? <span className={atBuyBelow ? 'text-pass font-bold' : 'text-text-secondary'}>${item.buy_below_price.toFixed(0)}</span>
                      : <span className="text-text-secondary">&mdash;</span>}
                  </td>
                  <td className="px-1.5 py-1.5">
                    {item.discount_to_iv_pct != null
                      ? <span className={item.discount_to_iv_pct > 0 ? 'text-pass' : 'text-fail'}>
                          {item.discount_to_iv_pct > 0 ? '+' : ''}{item.discount_to_iv_pct.toFixed(1)}%
                        </span>
                      : <span className="text-text-secondary">&mdash;</span>}
                  </td>
                  <td className="px-1.5 py-1.5">
                    {aScore != null ? (
                      <span className={`font-bold px-1.5 py-0.5 rounded ${
                        aScore >= 3.5 ? 'text-pass bg-pass/15' : aScore >= 2.0 ? 'text-warn bg-warn/15' : 'text-fail bg-fail/15'
                      }`}>
                        {aScore.toFixed(1)}
                      </span>
                    ) : showAnalyzeButton ? (
                      <button
                        onClick={() => onAnalyze(item.ticker)}
                        disabled={analyzingTickers?.has(item.ticker)}
                        className="px-1.5 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
                      >
                        {analyzingTickers?.has(item.ticker) ? '...' : 'Analyze'}
                      </button>
                    ) : <span className="text-text-secondary">&mdash;</span>}
                  </td>
                  <td className="px-1.5 py-1.5 hidden lg:table-cell">
                    {item.revenue_durability_score != null ? (
                      <FactorBars item={item} />
                    ) : <span className="text-text-secondary">&mdash;</span>}
                  </td>
                  <td className="px-1.5 py-1.5">
                    <InsiderBadge signal={item.insider_signal} details={item.insider_details} />
                  </td>
                  <td className="px-1.5 py-1.5 text-text-secondary max-w-[100px] truncate hidden xl:table-cell" title={item.notes}>
                    {item.notes || ''}
                  </td>
                  <td className="px-1.5 py-1.5">
                    <button
                      onClick={() => onRemove(item.ticker)}
                      className="px-1 py-0.5 rounded text-fail/70 hover:text-fail hover:bg-fail/10 transition-colors"
                      title="Remove"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-border/30">
        {items.map(item => {
          const price = getPrice(item)
          const aScore = item.adjusted_attractor_score ?? item.attractor_stability_score
          const atBuyBelow = price && item.buy_below_price && price <= item.buy_below_price
          return (
            <div key={item.ticker} className={`px-4 py-3 ${atBuyBelow ? 'bg-pass/5' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <Link to={`/analyze/${item.ticker}`} className="text-accent font-bold hover:underline">{item.ticker}</Link>
                <div className="flex items-center gap-2">
                  {aScore != null && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      aScore >= 3.5 ? 'text-pass bg-pass/15' : aScore >= 2.0 ? 'text-warn bg-warn/15' : 'text-fail bg-fail/15'
                    }`}>
                      {aScore.toFixed(1)}
                    </span>
                  )}
                  {showAnalyzeButton && aScore == null && (
                    <button
                      onClick={() => onAnalyze(item.ticker)}
                      disabled={analyzingTickers?.has(item.ticker)}
                      className="text-xs px-2 py-1 rounded bg-accent/20 text-accent disabled:opacity-50"
                    >
                      {analyzingTickers?.has(item.ticker) ? '...' : 'Analyze'}
                    </button>
                  )}
                </div>
              </div>
              <div className="text-xs text-text-secondary mb-2">{item.company_name}</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-text-secondary block">Price</span>
                  <span className={`font-medium ${isFresh(item.ticker) ? 'text-pass' : ''}`}>${price?.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-text-secondary block">Buy Below</span>
                  <span className={atBuyBelow ? 'text-pass font-bold' : ''}>{item.buy_below_price ? `$${item.buy_below_price.toFixed(0)}` : '\u2014'}</span>
                </div>
                <div>
                  <span className="text-text-secondary block">Discount</span>
                  {item.discount_to_iv_pct != null
                    ? <span className={item.discount_to_iv_pct > 0 ? 'text-pass' : 'text-fail'}>
                        {item.discount_to_iv_pct > 0 ? '+' : ''}{item.discount_to_iv_pct.toFixed(1)}%
                      </span>
                    : <span>&mdash;</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function InsiderBadge({ signal, details }) {
  if (!signal) return <span className="text-text-secondary text-xs">&mdash;</span>
  const styles = { strong_buy: 'text-pass bg-pass/15', caution: 'text-fail bg-fail/15', neutral: 'text-text-secondary bg-surface-tertiary' }
  const labels = { strong_buy: 'BUY', caution: 'WARN', neutral: 'NEU' }
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded cursor-help ${styles[signal] || styles.neutral}`} title={details || ''}>
      {labels[signal] || signal}
    </span>
  )
}
