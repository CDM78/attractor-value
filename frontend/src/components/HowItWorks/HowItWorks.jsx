import { useState } from 'react'

function TechnicalDetails({ children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 border-l-2 border-border pl-4">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-accent hover:underline flex items-center gap-1"
      >
        {open ? '\u25BC' : '\u25B6'} Technical Details
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
  { id: 'overview', label: 'What This App Does' },
  { id: 'layer-1', label: 'Layer 1: Quantitative Screen' },
  { id: 'layer-2', label: 'Layer 2: Valuation' },
  { id: 'layer-3', label: 'Layer 3: Attractor Analysis' },
  { id: 'layer-4', label: 'Layer 4: Adjacent Possible' },
  { id: 'insider-signals', label: 'Insider Signals' },
  { id: 'portfolio-rules', label: 'Portfolio Rules' },
  { id: 'sell-discipline', label: 'Sell Discipline' },
  { id: 'signals-summary', label: 'Signals Summary' },
  { id: 'data-sources', label: 'Data Sources' },
  { id: 'glossary', label: 'Glossary' },
]

export default function HowItWorks() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-text-primary mb-2">How It Works</h1>
      <p className="text-text-secondary mb-6">The Attractor Value Framework — methodology, formulas, and signals explained.</p>

      {/* Table of Contents */}
      <nav className="bg-surface-secondary rounded-lg p-4 mb-8 border border-border">
        <div className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Contents</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {TOC.map(({ id, label }) => (
            <a key={id} href={`#${id}`} className="text-sm text-accent hover:underline">{label}</a>
          ))}
        </div>
      </nav>

      {/* Section 1: Overview */}
      <Section id="overview" title="What This App Does">
        <p>The Attractor Value Framework screens for stocks that are undervalued by traditional measures AND occupy strong competitive positions that are likely to persist. It combines two approaches that are usually kept separate:</p>

        <p><strong className="text-text-primary">Value investing</strong> (the Graham-Dodd method) identifies stocks trading below what the underlying business is worth. This approach has been used successfully for nearly a century — Warren Buffett, Seth Klarman, and many other successful investors are practitioners. The core idea: if you buy a dollar's worth of business for 70 cents, time is on your side.</p>

        <p><strong className="text-text-primary">Complex systems analysis</strong> asks a different question: is this business in a position that reinforces itself over time (a "stable attractor"), or is it in a position that's eroding? A stock can look cheap by the numbers but be cheap for a reason — its competitive advantages are dissolving, its industry is being disrupted, or its business model is being replaced. The attractor analysis catches these cases.</p>

        <p>The app evaluates stocks through four layers, each progressively narrower, and produces a signal: BUY, WAIT, OVER, or REVIEW.</p>

        <TechnicalDetails>
          <p>The four layers are:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Layer 1 — Quantitative Screen:</strong> 8 hard filters based on Graham-Dodd criteria (P/E, P/B, debt, earnings stability, dividends, growth)</li>
            <li><strong>Layer 2 — Graham Valuation:</strong> Intrinsic value calculation using a modified Graham formula, adjusted for interest rates, fat-tail risk, and margin of safety</li>
            <li><strong>Layer 3 — Attractor Analysis:</strong> AI-powered qualitative assessment of competitive durability, scored 1–5 across six factors</li>
            <li><strong>Layer 4 — Adjacent Possible:</strong> (For speculative positions only) Assessment of whether a company is positioned to benefit from an emerging market transition</li>
          </ul>
          <p>A stock must clear all applicable layers to receive a BUY signal.</p>
        </TechnicalDetails>
      </Section>

      {/* Section 2: Layer 1 */}
      <Section id="layer-1" title="Layer 1: Quantitative Screen — Is This Stock Cheap Enough?">
        <p>The first layer eliminates stocks that are overpriced, overleveraged, or have unstable earnings. It applies 8 binary pass/fail tests to every stock in the universe. A stock that passes all 8 is a "Full Pass." A stock that passes 7 of 8 is a "Near Miss" — worth a closer look. Anything below that is filtered out.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">1. Price-to-Earnings (P/E) — Dynamic Ceiling</h3>
        <p>The P/E ratio measures how much you're paying per dollar of earnings. A lower P/E means a cheaper stock. Rather than using a fixed ceiling (Graham used 15), the app adjusts the maximum P/E based on current interest rates. When bond yields are high, stocks need to be cheaper to compete with bonds.</p>
        <TechnicalDetails>
          <p className="font-mono">Max P/E = 1 / (AAA bond yield + 0.015)</p>
          <p>The AAA corporate bond yield is fetched daily from the Federal Reserve (FRED API). The 0.015 (1.5 percentage points) is an equity risk premium — the minimum extra return stocks should offer over bonds.</p>
          <p>Example: At a 5.3% AAA yield, max P/E = 1 / (0.053 + 0.015) = 14.7</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">2. Price-to-Book (P/B) — Sector-Relative</h3>
        <p>The P/B ratio measures how much you're paying relative to the company's net asset value. Graham originally required P/B below 1.5, but that threshold was set when most business value was in physical assets. Today, asset-light companies have high P/B ratios by nature.</p>
        <p>Instead of a fixed threshold, the app compares each stock to its own sector. A stock passes if its P/B is in the bottom third (cheapest 33%) of its sector.</p>
        <TechnicalDetails>
          <p>Stock passes if: <span className="font-mono">P/B ≤ sector's 33rd percentile AND P/B ≤ 5.0</span> (absolute backstop)</p>
          <p>The 5.0 backstop prevents admitting stocks in sectors where even the bottom third is extremely expensive. Minimum sector size: 3 stocks.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">3. Combined P/E × P/B</h3>
        <p>Graham's composite ceiling prevents both multiples from being elevated simultaneously. The base ceiling is 40. For companies with exceptionally high returns on equity (ROE ≥ 20%), the ceiling is adjusted upward — because a high P/B driven by share buybacks in a high-ROE business isn't overvaluation, it's the mathematical consequence of excellent capital allocation.</p>
        <TechnicalDetails>
          <p className="font-mono">Base condition: P/E × P/B ≤ 40</p>
          <p>Raised from Graham's original 22.5 to 40. Calibration (30-case backtest) validated: at 22.5, the framework missed AAPL, KR, and VZ — all confirmed winners with elevated P/B from buyback programs. At 40, these pass without admitting traps.</p>
          <p className="mt-2 font-mono">ROE modifier:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>ROE {'<'} 20%: ceiling = 40 (no adjustment)</li>
            <li>ROE 20–30%: ceiling = 50 (×1.25)</li>
            <li>ROE 30%+: ceiling = 60 (×1.50)</li>
          </ul>
          <p className="mt-1">This rewards exceptional capital allocators. AXP (ROE 30%+, P/E×P/B of 56) passes with the modifier and returned +42%/+115% over 3/5 years.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">4. Debt-to-Equity (D/E)</h3>
        <p>Companies with too much debt are fragile. This filter checks leverage relative to equity. Capital-intensive industries are allowed more debt. Financial companies are exempt because leverage IS their business model.</p>
        <TechnicalDetails>
          <ul className="list-disc pl-5 space-y-1">
            <li>Industrial / Technology / Healthcare / Consumer: D/E ≤ 1.0</li>
            <li>Utilities / Real Estate / Energy: D/E ≤ 2.0</li>
            <li>Financial Services / Insurance: Auto-pass (exempt)</li>
          </ul>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">5. Current Ratio</h3>
        <p>Current assets ÷ current liabilities. Can the company cover its near-term obligations? Financial companies are exempt.</p>
        <TechnicalDetails>
          <p className="font-mono">Pass condition: Current ratio ≥ 1.0</p>
          <p>Lowered from Graham's original 1.5 to 1.0. Calibration (30-case backtest) validated: companies passing the other 7 filters with CR between 1.0–1.5 have deliberately lean working capital (efficient grocers, retailers), not precarious balance sheets. KR (Kroger) captured at 1.0 — returned 67% over 3 years.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">6. Earnings Stability</h3>
        <p>Requires positive earnings in at least 8 of the last 10 years. One or two bad years (recessions happen) is acceptable. Chronic losses are not.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">7. Dividend Record</h3>
        <p>Dividends paid every year for the last 5 years. A sign of financial discipline and real cash generation.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">8. Earnings Growth</h3>
        <p>At least 3% compound annual earnings growth. Value investing doesn't mean buying stagnant businesses.</p>
        <TechnicalDetails>
          <p>Compare the average EPS of the first 3 years to the most recent 3 years. CAGR over the midpoint-to-midpoint span must be ≥ 3%.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Three-Tier Classification</h3>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Tier</th><th className="py-2 pr-4">Meaning</th><th className="py-2">Color</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold text-pass">Full Pass</td><td className="py-2 pr-4">Passes all 8 filters</td><td className="py-2">Green</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold text-warn">Near Miss</td><td className="py-2 pr-4">Passes 7 of 8 — one filter failed</td><td className="py-2">Amber</td></tr>
              <tr><td className="py-2 pr-4 font-semibold text-text-secondary">Fail</td><td className="py-2 pr-4">6 or fewer</td><td className="py-2">Grey</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Soft Filters (Informational)</h3>
        <p>Three additional data points are tracked but don't prevent a stock from passing:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Free Cash Flow:</strong> Positive in 7+ of 10 years</li>
          <li><strong>Insider Ownership:</strong> ≥ 5% of shares held by insiders</li>
          <li><strong>Share Dilution:</strong> Shares outstanding growing ≤ 2%/year</li>
        </ul>
      </Section>

      {/* Section 3: Layer 2 */}
      <Section id="layer-2" title="Layer 2: Valuation — What Is This Stock Actually Worth?">
        <p>For every stock that passes Layer 1, the app calculates an estimate of what the business is worth (intrinsic value) and then determines the maximum price you should pay (the buy-below price). The gap is your margin of safety — a cushion that protects you if the estimate is wrong.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Intrinsic Value</h3>
        <p>Uses Benjamin Graham's formula: higher earnings and faster growth mean higher intrinsic value. Higher interest rates push intrinsic value down (because bonds become more competitive).</p>
        <TechnicalDetails>
          <p className="font-mono">IV = Normalized EPS × (8.5 + 2g) × (4.4 / Y)</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Normalized EPS = average EPS of the 3 most recent fiscal years</li>
            <li>g = estimated annual EPS growth rate (capped at 7%)</li>
            <li>8.5 = Graham's base P/E for a zero-growth company</li>
            <li>4.4 = AAA bond yield in 1962 (baseline)</li>
            <li>Y = current AAA corporate bond yield (%)</li>
          </ul>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Fat-Tail Discount</h3>
        <p>Extreme events happen more often than simple models predict. The app adjusts intrinsic value downward based on how the company handled past stress.</p>
        <TechnicalDetails>
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Condition</th><th className="py-2">Discount</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">10+ years, 0–1 negative EPS years</td><td className="py-2">0% — proven resilient</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">10+ years, 2–3 negative EPS years</td><td className="py-2">10%</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">10+ years, 4+ negative EPS years</td><td className="py-2">15%</td></tr>
              <tr><td className="py-2 pr-4">Fewer than 10 years</td><td className="py-2">10% — untested</td></tr>
            </tbody>
          </table>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Margin of Safety</h3>
        <p>You never want to pay full intrinsic value. The required margin depends on attractor score and network regime (determined in Layer 3).</p>
        <TechnicalDetails>
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-2">Screen Tier</th><th className="py-2 pr-2">Attractor</th><th className="py-2 pr-2">Regime</th><th className="py-2">Margin</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-1 pr-2">Full Pass</td><td className="py-1 pr-2">≥ 3.5</td><td className="py-1 pr-2">Classical/Soft</td><td className="py-1">25%</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-2">Full Pass</td><td className="py-1 pr-2">≥ 3.5</td><td className="py-1 pr-2">Hard Network</td><td className="py-1">40%</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-2">Full Pass</td><td className="py-1 pr-2">2.0–3.4</td><td className="py-1 pr-2">Any</td><td className="py-1">40%</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-2">Near Miss</td><td className="py-1 pr-2">≥ 3.5</td><td className="py-1 pr-2">Classical/Soft</td><td className="py-1">40%</td></tr>
              <tr><td className="py-1 pr-2">Near Miss</td><td className="py-1 pr-2">2.0–3.4</td><td className="py-1 pr-2">Any</td><td className="py-1">45%</td></tr>
            </tbody>
          </table>
          <p className="mt-2 font-mono">Buy-Below Price = Adjusted IV × (1 – Margin of Safety)</p>
          <p className="mt-2"><strong>Additional margin adjustments:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Small cap stocks:</strong> +5% added to margin of safety (less liquid, wider spreads)</li>
            <li><strong>STRESSED economic environment:</strong> +5% added to margin of safety (macro headwinds increase risk)</li>
          </ul>
          <p className="mt-1">These stack with the base margin above. For example, a small cap in a stressed environment with a stable attractor would have 25% + 5% + 5% = 35% margin.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Economic Environment</h3>
        <p>The app monitors macroeconomic conditions and classifies the environment as NORMAL, CAUTIOUS, or STRESSED using indicators from the Federal Reserve (FRED API).</p>
        <TechnicalDetails>
          <p>Stress indicators monitored:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Yield curve inversion (10Y - 2Y Treasury spread)</li>
            <li>Elevated credit spreads (BAA - AAA spread)</li>
            <li>High-yield OAS above 90th percentile</li>
            <li>VIX above 30</li>
            <li>Unemployment above 5%</li>
            <li>Negative GDP growth</li>
          </ul>
          <p className="mt-2">0 indicators = NORMAL | 1–2 = CAUTIOUS | 3+ = STRESSED</p>
          <p>STRESSED adds +5% to margin of safety for all stocks.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Signal</h3>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Condition</th><th className="py-2 pr-4">Signal</th><th className="py-2">Meaning</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">Price ≤ buy-below</td><td className="py-2 pr-4 font-bold text-pass">BUY</td><td className="py-2">Cheap enough with adequate safety margin</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">Price {'>'} buy-below but {'<'} adjusted IV</td><td className="py-2 pr-4 font-bold text-warn">WAIT</td><td className="py-2">Undervalued but not enough cushion</td></tr>
              <tr><td className="py-2 pr-4">Price {'>'} adjusted IV</td><td className="py-2 pr-4 font-bold text-fail">OVER</td><td className="py-2">Overvalued</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 4: Layer 3 */}
      <Section id="layer-3" title="Layer 3: Attractor Analysis — Will This Company's Advantages Last?">
        <p>A stock can be cheap and still be a bad investment if the business is deteriorating. Layer 3 uses AI (Claude) to assess whether the company's competitive position is a "stable attractor" — a self-reinforcing equilibrium — or whether it's transitioning or dissolving.</p>

        <p>Some configurations are self-reinforcing: the more customers a company has, the better its product gets, which attracts more customers. Other configurations are self-undermining: a company milking an aging product line while competitors build the replacement.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">The Six Factors</h3>
        <ol className="list-decimal pl-5 space-y-2">
          <li><strong className="text-text-primary">Revenue Durability</strong> — Is the revenue recurring, diversified, and protected by switching costs?</li>
          <li><strong className="text-text-primary">Competitive Reinforcement</strong> — Do the company's advantages get stronger over time?</li>
          <li><strong className="text-text-primary">Industry Structure</strong> — Is this an industry with rational competitors and high barriers?</li>
          <li><strong className="text-text-primary">Demand Feedback</strong> — Does customer behavior create positive feedback loops?</li>
          <li><strong className="text-text-primary">Adaptation Capacity</strong> — Has the company demonstrated ability to adapt without destroying its core?</li>
          <li><strong className="text-text-primary">Capital Allocation</strong> — Does management deploy capital well?</li>
        </ol>
        <p className="mt-2">Each factor is scored 1 to 5. The average is the raw attractor score.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Concentration Risk Penalties</h3>
        <TechnicalDetails>
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Risk Type</th><th className="py-2 pr-4">Threshold</th><th className="py-2">Penalty</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">Single customer ≥ 40% revenue</td><td className="py-1 pr-4">Severe</td><td className="py-1">−1.0</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">Single customer ≥ 25% revenue</td><td className="py-1 pr-4">Moderate</td><td className="py-1">−0.5</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">Critical single-source supplier</td><td className="py-1 pr-4">Binary</td><td className="py-1">−0.5</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">≥ 70% revenue from one foreign market</td><td className="py-1 pr-4">Geographic</td><td className="py-1">−0.3</td></tr>
              <tr><td className="py-1 pr-4">≥ 50% revenue from one regulation</td><td className="py-1 pr-4">Regulatory</td><td className="py-1">−0.5</td></tr>
            </tbody>
          </table>
          <p className="mt-2">Penalties stack. Adjusted score has a floor of 1.0.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Classification</h3>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Score</th><th className="py-2 pr-4">Classification</th><th className="py-2">Meaning</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">≥ 3.5</td><td className="py-2 pr-4 font-bold text-pass">Stable</td><td className="py-2">Self-reinforcing position. Standard margin of safety.</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">2.0–3.4</td><td className="py-2 pr-4 font-bold text-warn">Transitional</td><td className="py-2">Position is changing. Higher margin required. Still buyable.</td></tr>
              <tr><td className="py-2 pr-4">{'<'} 2.0</td><td className="py-2 pr-4 font-bold text-fail">Dissolving</td><td className="py-2">Competitive position eroding. Do not buy.</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Network Regime</h3>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Regime</th><th className="py-2 pr-4">Meaning</th><th className="py-2">Implication</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Classical</td><td className="py-2 pr-4">Traditional moats: brand, scale, cost</td><td className="py-2">Standard valuation</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Soft Network</td><td className="py-2 pr-4">Mild network effects, switching costs</td><td className="py-2">Standard, monitor for winner-take-all</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Hard Network</td><td className="py-2 pr-4">Strong winner-take-all dynamics</td><td className="py-2">Higher margin for non-leaders</td></tr>
              <tr><td className="py-2 pr-4 font-semibold">Platform</td><td className="py-2 pr-4">Multi-sided marketplace</td><td className="py-2">Evaluate only during genuine crises</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 5: Layer 4 */}
      <Section id="layer-4" title="Layer 4: Adjacent Possible — Is a Breakthrough Nearby?">
        <p>This optional layer applies only to the "Asymmetric Opportunity" tier (15–30% of holdings). It evaluates companies where a near-term transition could produce outsized returns.</p>

        <p>The concept comes from complexity science. The "adjacent possible" is the set of things one combinatorial step away from what already exists. The smartphone was adjacent to existing mobile phones + PDAs + MP3 players. Google Glass was NOT adjacent — it required social norms and use cases that didn't yet exist.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Five Factors (scored 1–5)</h3>
        <ol className="list-decimal pl-5 space-y-1">
          <li><strong className="text-text-primary">Component Maturity</strong> — Do the building blocks already exist at scale?</li>
          <li><strong className="text-text-primary">Behavioral Adjacency</strong> — Is the new behavior an extension of what people already do?</li>
          <li><strong className="text-text-primary">Analogous Precedent</strong> — Have similar transitions succeeded elsewhere?</li>
          <li><strong className="text-text-primary">Combinatorial Clarity</strong> — Is the path a clear combination of known quantities?</li>
          <li><strong className="text-text-primary">Infrastructure Readiness</strong> — Do distribution, regulation, and supply chains support it?</li>
        </ol>

        <TechnicalDetails>
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">AP Score</th><th className="py-2 pr-4">Position Sizing</th><th className="py-2">Time Horizon</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">≥ 3.5</td><td className="py-1 pr-4">Up to 5%</td><td className="py-1">18–24 months</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">2.0–3.4</td><td className="py-1 pr-4">Up to 3%</td><td className="py-1">12–18 months</td></tr>
              <tr><td className="py-1 pr-4">{'<'} 2.0</td><td className="py-1 pr-4">Do not invest</td><td className="py-1">N/A</td></tr>
            </tbody>
          </table>
        </TechnicalDetails>
      </Section>

      {/* Section 6: Insider Signals */}
      <Section id="insider-signals" title="Insider Signals — What Are the People Inside Doing?">
        <p>Corporate insiders are required to report their stock purchases and sales to the SEC. They sell for many reasons, but they buy for one reason: they think the stock is undervalued.</p>

        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Signal</th><th className="py-2 pr-4">Trigger</th><th className="py-2">Meaning</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-pass">Strong Buy</td><td className="py-2 pr-4">3+ insiders bought within 90 days, ≥ $100K total</td><td className="py-2">Multiple insiders putting their own money in</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-warn">Caution</td><td className="py-2 pr-4">Net selling 5×+ buying AND includes C-suite</td><td className="py-2">Investigate before buying</td></tr>
              <tr><td className="py-2 pr-4 font-bold text-text-secondary">Neutral</td><td className="py-2 pr-4">Neither condition met</td><td className="py-2">No meaningful signal</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3">This signal does NOT block a buy or force a sell — it's a confirming or cautionary indicator for your own judgment.</p>
      </Section>

      {/* Section 7: Portfolio Rules */}
      <Section id="portfolio-rules" title="Portfolio Construction — How Positions Fit Together">
        <h3 className="text-lg font-semibold text-text-primary mt-2">Two Tiers</h3>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Tier</th><th className="py-2 pr-4">What Goes Here</th><th className="py-2 pr-4">Allocation</th><th className="py-2">Position Limit</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Core</td><td className="py-2 pr-4">Deep-value stocks passing all layers</td><td className="py-2 pr-4">70–85%</td><td className="py-2">12–20 positions, max 8% each</td></tr>
              <tr><td className="py-2 pr-4 font-semibold">Asymmetric</td><td className="py-2 pr-4">Phase-transition opportunities</td><td className="py-2 pr-4">15–30%</td><td className="py-2">3–6 positions, max 5% each</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Risk Limits</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>No single sector {'>'} 25% of portfolio</li>
          <li>No more than 15% in hard-network-regime stocks</li>
          <li>At least 3 sectors represented</li>
          <li>Any position exceeding 12% triggers a trim alert</li>
        </ul>
      </Section>

      {/* Section 8: Sell Discipline */}
      <Section id="sell-discipline" title="When to Sell — The Six Triggers">
        <ol className="list-decimal pl-5 space-y-3">
          <li><strong className="text-text-primary">Price exceeds intrinsic value.</strong> The margin of safety is consumed. Take the gain.</li>
          <li><strong className="text-text-primary">Attractor dissolution.</strong> The attractor score drops below 2.0. The business model is no longer self-reinforcing. Sell regardless of price.</li>
          <li><strong className="text-text-primary">Thesis violation.</strong> The original reason you bought is invalidated by new evidence. Sell without waiting for price recovery.</li>
          <li><strong className="text-text-primary">Better opportunity.</strong> A new candidate offers a substantially larger discount with equal or better attractor stability.</li>
          <li><strong className="text-text-primary">Concentration creep.</strong> A position has appreciated to {'>'} 12% of portfolio. Trim to 8%.</li>
          <li><strong className="text-text-primary">Adjacent possible invalidation.</strong> (Asymmetric only.) A key component of the transition thesis fails. Exit without waiting.</li>
        </ol>
      </Section>

      {/* Section 9: Signals Summary */}
      <Section id="signals-summary" title="Quick Reference — What the Signals Mean">
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Signal</th><th className="py-2">Meaning</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-pass">BUY</td><td className="py-2">Full Pass, price below buy-below, stable attractor confirmed</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-pass">BUY <span className="text-warn">(TRANSITIONAL)</span></td><td className="py-2">Full Pass, price below buy-below, attractor 2.0–3.4. Higher margin applied.</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-warn">BUY (NEAR MISS)</td><td className="py-2">7/8 filters passed, price below buy-below, attractor confirmed, AI recommends proceeding</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-warn">WAIT</td><td className="py-2">Undervalued but not enough margin of safety yet</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-fail">OVERVALUED</td><td className="py-2">Price exceeds adjusted intrinsic value. Don't buy. If held, consider selling.</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-fail">DO NOT BUY</td><td className="py-2">Attractor score below 2.0. Business model is dissolving.</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-text-secondary">ANALYSIS REQUIRED</td><td className="py-2">Passed screening but no attractor analysis has been run yet.</td></tr>
              <tr><td className="py-2 pr-4 font-bold text-text-secondary">NO SIGNAL</td><td className="py-2">Insufficient data to determine a signal.</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 10: Data Sources */}
      <Section id="data-sources" title="Where the Data Comes From">
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Source</th><th className="py-2 pr-4">Provides</th><th className="py-2">Cost</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">SEC EDGAR</td><td className="py-2 pr-4">Balance sheets, income statements, XBRL fundamentals (primary source)</td><td className="py-2">Free</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Yahoo Finance</td><td className="py-2 pr-4">Real-time prices, volume data</td><td className="py-2">Free</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Finnhub</td><td className="py-2 pr-4">Insider transactions, company profiles, news (fallback fundamentals)</td><td className="py-2">Free tier</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">FRED</td><td className="py-2 pr-4">AAA bond yield, credit spreads, VIX, economic indicators</td><td className="py-2">Free</td></tr>
              <tr><td className="py-2 pr-4 font-semibold">Claude API</td><td className="py-2 pr-4">Attractor stability analysis, adjacent possible scoring</td><td className="py-2">~$0.02–0.03/analysis</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 11: Glossary */}
      <Section id="glossary" title="Glossary">
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4 w-48">Term</th><th className="py-2">Definition</th>
            </tr></thead>
            <tbody>
              {GLOSSARY.map(({ term, def }) => (
                <tr key={term} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-semibold text-text-primary align-top">{term}</td>
                  <td className="py-2">{def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="h-20" />
    </div>
  )
}

const GLOSSARY = [
  { term: 'AAA Bond Yield', def: 'The interest rate on the highest-rated corporate bonds. Used as the benchmark return that stocks must beat. Fetched daily from the Federal Reserve.' },
  { term: 'Adjacent Possible', def: 'The set of innovations one combinatorial step from what currently exists. Used to evaluate asymmetric opportunity positions.' },
  { term: 'Adjusted IV', def: 'Graham intrinsic value after applying the fat-tail discount. Represents estimated true worth accounting for downside risk.' },
  { term: 'Attractor Score', def: 'Average of 6 qualitative factors (1–5 scale) assessing competitive durability, adjusted for concentration risk. ≥ 3.5 = Stable, 2.0–3.4 = Transitional, < 2.0 = Dissolving.' },
  { term: 'Auto-Pass', def: 'A screening filter exempt for the stock\'s sector (e.g., D/E and current ratio for financials). Marked with an "E" badge.' },
  { term: 'Buy-Below Price', def: 'Maximum purchase price. Calculated as Adjusted IV × (1 – margin of safety).' },
  { term: 'CAGR', def: 'Compound Annual Growth Rate. The smoothed annual rate at which a value grew over a multi-year period.' },
  { term: 'Concentration Risk', def: 'The danger of depending too heavily on a single customer, supplier, market, or regulation. Applied as a penalty to the attractor score.' },
  { term: 'Current Ratio', def: 'Current assets ÷ current liabilities. Measures ability to pay short-term obligations. Framework requires ≥ 1.0.' },
  { term: 'D/E', def: 'Debt-to-Equity. Total debt ÷ shareholder equity. Measures leverage. ≤ 1.0 for most sectors, ≤ 2.0 for capital-intensive.' },
  { term: 'Discount to IV', def: 'How far below intrinsic value the current price is. Positive = undervalued. Negative = overvalued.' },
  { term: 'Dissolving Attractor', def: 'A competitive position actively eroding (score < 2.0). Framework prohibits buying and recommends selling.' },
  { term: 'Dynamic P/E Ceiling', def: 'Maximum allowable P/E ratio, which adjusts with interest rates rather than using a fixed value.' },
  { term: 'EPS', def: 'Earnings Per Share. Net income divided by shares outstanding.' },
  { term: 'Fat-Tail Discount', def: 'A 0–15% downward adjustment to intrinsic value accounting for extreme market events occurring more often than models predict.' },
  { term: 'Full Pass', def: 'A stock passing all 8 hard filters in Layer 1. Proceeds to valuation and attractor analysis.' },
  { term: 'Graham IV', def: 'Intrinsic value estimate based on normalized earnings, growth rate, and interest rates. Named for Benjamin Graham.' },
  { term: 'Hard Network', def: 'An industry with strong winner-take-all dynamics. Non-leaders require higher margin of safety.' },
  { term: 'Insider Signal', def: 'Confirming or cautionary indicator based on SEC Form 4 filings showing whether insiders are buying or selling.' },
  { term: 'Margin of Safety', def: 'The required discount below intrinsic value before buying. Ranges from 25% to 45%. Protects against estimation error.' },
  { term: 'Near Miss', def: 'A stock passing 7 of 8 hard filters. Displayed in amber with the specific failed filter and miss severity.' },
  { term: 'Network Regime', def: 'Type of competitive dynamics: Classical, Soft Network, Hard Network, or Platform. Determined by AI analysis.' },
  { term: 'Normalized EPS', def: 'Average EPS over the last 3 years, used to smooth short-term fluctuations.' },
  { term: 'P/B', def: 'Price-to-Book. Stock price ÷ book value per share. Compared sector-relative in the framework.' },
  { term: 'P/E', def: 'Price-to-Earnings. Stock price ÷ earnings per share. Lower = cheaper.' },
  { term: 'Phase Transition', def: 'A rapid, self-reinforcing shift from one state to another. Relevant to both dissolution risk and asymmetric opportunities.' },
  { term: 'ROE', def: 'Return on Equity. Net income ÷ shareholder equity. Primary profitability metric for banks and insurers.' },
  { term: 'ROIC', def: 'Return on Invested Capital. Measures how efficiently a company turns investment into profit. Not used for financials.' },
  { term: 'Stable Attractor', def: 'A competitive position that reinforces itself over time (score ≥ 3.5). Advantages tend to compound rather than erode.' },
  { term: 'Transitional Attractor', def: 'A competitive position changing but not dissolving (score 2.0–3.4). Buyable at a higher margin of safety.' },
]
