import { useState } from 'react'

function TechnicalDetails({ title = 'Technical Details', children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 border-l-2 border-border pl-4">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-accent hover:underline flex items-center gap-1"
      >
        {open ? '\u25BC' : '\u25B6'} {title}
      </button>
      {open && <div className="mt-2 text-sm text-text-secondary space-y-2">{children}</div>}
    </div>
  )
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-xl font-bold text-text-primary mb-4 pt-8 border-t border-border">{title}</h2>
      <div className="space-y-4 text-text-secondary leading-relaxed">{children}</div>
    </section>
  )
}

const TOC = [
  { id: 'what-it-does', label: '1. What This App Does' },
  { id: 'pipelines', label: '2. Three Discovery Pipelines' },
  { id: 'evaluation', label: '3. AI Evaluation' },
  { id: 'portfolio', label: '4. Portfolio Model' },
  { id: 'sell', label: '5. Sell Discipline' },
  { id: 'screening', label: '6. Graham Screen (6 Filters)' },
  { id: 'evidence', label: '7. Calibration Evidence' },
]

export default function HowItWorks() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-text-primary mb-6">How It Works</h1>
      <p className="text-text-secondary mb-6">
        Every parameter in this system is backed by calibration data from 10 validation tests and 15 parameter
        sweeps run against 292 historical cases spanning 2016-2025. No arbitrary numbers remain.
      </p>

      <nav className="mb-8 p-4 bg-surface rounded-lg">
        <ul className="space-y-1">
          {TOC.map(item => (
            <li key={item.id}>
              <a href={`#${item.id}`} className="text-accent hover:underline text-sm">{item.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="what-it-does" title="1. What This App Does">
        <p>
          Markets occasionally misprice quality businesses. This happens during crises (temporary fear),
          for emerging growth companies (the market underestimates self-reinforcing advantages), and during
          structural regime shifts (the market is slow to recognize new realities).
        </p>
        <p>
          The framework identifies these mispricings through <strong>three discovery pipelines</strong>,
          validates each opportunity through <strong>adversarial AI analysis</strong>, and applies discipline
          on both entry (buy only below fair value) and exit (take profits at +125% or sell if the
          competitive position dissolves).
        </p>
        <p>
          <strong>All uninvested capital sits in VOO</strong> (Vanguard S&P 500 ETF). There is no idle cash.
          When a signal fires, VOO shares are sold to fund the position. When a position is sold,
          proceeds return to VOO.
        </p>
      </Section>

      <Section id="pipelines" title="2. Three Discovery Pipelines">
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold text-text-primary">Crisis Pipeline (25% allocation)</h3>
            <p>
              Activates only during market crises (S&P 500 down 15%+, VIX above 30, credit spreads elevated).
              Finds quality companies whose stock declined because of sector-wide fear, not fundamental
              deterioration. Uses Graham valuation to identify buy-below prices.
            </p>
            <TechnicalDetails>
              <p>5 quantitative filters: price decline ≥15-20%, earnings stability ≥70%, D/E &lt; 2.0,
              positive FCF, P/E &lt; 40. Claude assesses whether damage is temporary or structural —
              only "temporary dislocation" proceeds.</p>
            </TechnicalDetails>
          </div>

          <div>
            <h3 className="font-semibold text-text-primary">Growth Pipeline (20% allocation) → Sector ETFs</h3>
            <p>
              Identifies which sectors have clusters of high-growth companies with durable competitive
              advantages. Instead of picking individual stocks, the system recommends <strong>Vanguard
              sector ETFs</strong> (VGT, VHT, VIS, etc.) weighted by candidate density. This approach
              beats VOO in 83% of historical periods vs 59% for individual stock picks.
            </p>
            <p>
              A sector signal fires when ≥2 growth candidates pass the pre-screen in that sector.
              Budget is distributed across qualifying sectors by candidate count.
            </p>
            <TechnicalDetails>
              <p>Monthly pre-screen: revenue CAGR ≥20% (or ≥8% steady compounder), gross margin ≥35%,
              market cap ≥$500M. Candidates aggregated by sector → Vanguard ETF mapping.
              Individual stock override possible when attractor ≥3.0 confirmed by deep analysis AND
              price below buy-below.</p>
            </TechnicalDetails>
          </div>

          <div>
            <h3 className="font-semibold text-text-primary">Regime Pipeline (15% allocation) → Individual Stocks</h3>
            <p>
              Identifies companies benefiting from structural shifts (technology transitions, geopolitical
              realignment, policy changes) where the market hasn't yet priced the opportunity.
              Stock selection adds real value here — 79th percentile vs random, 92% win rate.
            </p>
            <TechnicalDetails>
              <p>Pre-screen: sector overlap with active regime, gross margin &gt;0%, D/E &lt;3.0,
              current ratio &gt;0.8. Consensus Saturation Index (CSI ≤1) ensures we're early, not
              chasing consensus. Scenario-weighted valuation: bull case (regime materializes) vs bear
              case (regime fizzles), weighted by Adjacent Possible score.</p>
            </TechnicalDetails>
          </div>
        </div>

        <p className="mt-4 text-sm text-text-secondary italic">
          Flexible pool: 35% of capital can overflow into any pipeline when its dedicated budget is
          exhausted. This allows the system to concentrate capital during crisis periods when signals
          are most plentiful.
        </p>
      </Section>

      <Section id="evaluation" title="3. AI Evaluation (Attractor Analysis)">
        <p>
          Every candidate receives a two-pass AI evaluation using Claude. The <strong>bull case</strong> (40%
          weight) evaluates competitive strengths. The <strong>adversarial bear case</strong> (60% weight)
          challenges every strength identified. The intentional pessimistic weighting means a company must
          have genuinely strong competitive dynamics to score well.
        </p>
        <p>
          Six factors are scored 1-5: revenue durability, competitive reinforcement, industry structure,
          demand feedback, adaptation capacity, and capital allocation.
        </p>
        <p>
          <strong>Attractor gate: ≥ 3.0.</strong> Only companies scoring 3.0 or above on the composite
          attractor score receive BUY signals. This threshold was validated by a sweep showing same
          portfolio beat rate with +5pp additional alpha vs the prior 2.5 gate.
        </p>
        <TechnicalDetails>
          <p>Test 4 (Hindsight Contamination): Claude was tested with and without company names.
          Blinded scores discriminated winners from traps MORE accurately (gap: 0.86) than unblinded
          (gap: 0.80). The AI reads genuine business quality from financial data, not hindsight.</p>
        </TechnicalDetails>
      </Section>

      <Section id="portfolio" title="4. Portfolio Model">
        <p>
          <strong>All money is in VOO unless actively deployed in a framework position.</strong> There is
          no idle cash. Pipeline allocations are budget caps, not reservations — they determine how much
          VOO to sell when signals fire.
        </p>
        <div className="bg-surface p-4 rounded-lg my-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Crisis pipeline cap</div><div className="font-mono">25%</div>
            <div>Growth pipeline cap</div><div className="font-mono">20%</div>
            <div>Regime pipeline cap</div><div className="font-mono">15%</div>
            <div>Flexible overflow</div><div className="font-mono">35%</div>
            <div>Cash reserve</div><div className="font-mono">0%</div>
          </div>
        </div>
        <p>
          <strong>Position sizing:</strong> Maximum 7% of total capital per individual position.
          STRONG confidence signals get full 7%, STANDARD gets 5.25% (75%). Sector ETF positions
          can exceed 7% because they're inherently diversified.
        </p>
        <p>
          <strong>Default hold: 3 years.</strong> Sweep confirmed 3yr is optimal — 1yr exits too early,
          5yr collapses from mean reversion.
        </p>
      </Section>

      <Section id="sell" title="5. Sell Discipline — Two Triggers">
        <p>
          The sell engine was simplified from 6 triggers to 2 after calibration testing showed the
          others were either harmful or negligible:
        </p>
        <div className="space-y-3 mt-3">
          <div className="p-3 bg-surface rounded">
            <div className="font-semibold text-text-primary">Take Profit at +125%</div>
            <p className="text-sm mt-1">
              When a position reaches +125% return from entry, sell. This was the peak of a
              sweep from +50% to +300% — it adds $29,187 vs buy-and-hold across 115 historical trades.
              Tax delay analysis applies: if held 300-365 days, the system calculates whether waiting
              for long-term capital gains rate is worth it.
            </p>
          </div>
          <div className="p-3 bg-surface rounded">
            <div className="font-semibold text-text-primary">Attractor Dissolution (&lt; 2.0)</div>
            <p className="text-sm mt-1">
              Emergency stop. If the competitive position collapses (attractor score drops below 2.0),
              sell immediately regardless of tax implications. This overrides all delays.
            </p>
          </div>
        </div>
        <TechnicalDetails title="Removed Triggers">
          <p><strong>Growth failure (-20% trigger):</strong> Actively hurt returns (-$1,512 net). Cut
          underperformers that later recovered, losing more upside than trap damage saved.</p>
          <p><strong>Concentration trim (8%→5%):</strong> Never fired in simulation — positions capped
          at 7% at entry never hit 8%.</p>
          <p><strong>Thesis violation (3+ red flags):</strong> Negligible impact — overlaps with attractor
          dissolution.</p>
          <p><strong>Regime expiry:</strong> Negligible impact — regime positions captured via take-profit
          instead.</p>
        </TechnicalDetails>
      </Section>

      <Section id="screening" title="6. Graham Screen (6 Filters)">
        <p>
          The quantitative value screen applies 6 hard filters. Stocks passing all 6 are "full pass";
          passing 5 of 6 is "near miss" and may still qualify with a higher margin of safety.
        </p>
        <div className="bg-surface p-4 rounded-lg my-4">
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li><strong>P/E ≤ 1/(AAA yield + 1.5%)</strong> — dynamic ceiling from current bond yields</li>
            <li><strong>P/E × P/B ≤ 40</strong> — composite valuation (with ROE modifier: 20-30% = ×1.25, 30%+ = ×1.50)</li>
            <li><strong>Debt/Equity ≤ 1.0</strong> — solvency (2.0 for utilities, auto-pass for financials)</li>
            <li><strong>Current Ratio ≥ 1.0</strong> — liquidity (auto-pass for financials)</li>
            <li><strong>Earnings Stability ≥ 8/10 years</strong> — consistency</li>
            <li><strong>Earnings Growth ≥ 3% CAGR</strong> — not in permanent decline</li>
          </ol>
        </div>
        <TechnicalDetails title="Removed Filters">
          <p><strong>P/B standalone filter:</strong> Removed. Systematically broken by share buybacks —
          AAPL, DVA, HPQ, AXP all have distorted book values. The P/E×P/B composite with ROE modifier
          provides sufficient valuation discipline.</p>
          <p><strong>Dividend record (5 years):</strong> Removed. Excluded the best capital allocators
          (Berkshire, early Apple). What-if testing: 0% cross-validation gap, 64% of bootstrap resamples
          improved, 0% degraded.</p>
        </TechnicalDetails>
      </Section>

      <Section id="evidence" title="7. Calibration Evidence">
        <p>
          The system was validated against 292 historical cases across 29 vintage simulations
          (Q1 2016 through Q1 2023), each running 3 years with $27,000 starting capital.
        </p>
        <div className="bg-surface p-4 rounded-lg my-4 text-sm space-y-2">
          <div className="flex justify-between">
            <span>Vintages beating S&P 500 (with VOO hybrid)</span>
            <span className="font-mono font-bold text-green-400">97%</span>
          </div>
          <div className="flex justify-between">
            <span>Median 3-year alpha over S&P 500</span>
            <span className="font-mono font-bold">+37pp</span>
          </div>
          <div className="flex justify-between">
            <span>AI not contaminated by hindsight</span>
            <span className="font-mono font-bold text-green-400">Confirmed</span>
          </div>
          <div className="flex justify-between">
            <span>Take-profit +125% benefit</span>
            <span className="font-mono font-bold">+$29,187 vs hold</span>
          </div>
          <div className="flex justify-between">
            <span>Sector ETFs vs individual stocks (Growth)</span>
            <span className="font-mono font-bold">83% vs 59% beat rate</span>
          </div>
        </div>
      </Section>
    </div>
  )
}
