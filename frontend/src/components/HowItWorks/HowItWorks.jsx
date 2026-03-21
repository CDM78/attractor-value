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
  { id: 'discovery', label: '2. How Opportunities Are Found' },
  { id: 'evaluation', label: '3. How Companies Are Evaluated' },
  { id: 'valuation', label: '4. How Stocks Are Valued' },
  { id: 'signals', label: '5. What the Signals Mean' },
  { id: 'position-sizing', label: '6. Position Sizes' },
  { id: 'market-monitoring', label: '7. Market Monitoring' },
  { id: 'sell-discipline', label: '8. Sell Discipline' },
  { id: 'glossary', label: '9. Glossary' },
  { id: 'research', label: '10. The Research' },
]

export default function HowItWorks() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-text-primary mb-2">How It Works</h1>
      <p className="text-text-secondary mb-6">The Attractor Value Framework — how the system finds, evaluates, values, and sizes investment opportunities.</p>

      {/* Table of Contents */}
      <nav className="bg-surface-secondary rounded-lg p-4 mb-8 border border-border">
        <div className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Contents</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {TOC.map(({ id, label }) => (
            <a key={id} href={`#${id}`} className="text-sm text-accent hover:underline">{label}</a>
          ))}
        </div>
      </nav>

      {/* Section 1: What This App Does */}
      <Section id="what-it-does" title="1. What This App Does">
        <p>This system finds investment opportunities, decides whether they are worth buying, and tells you exactly what to do. You execute. The system makes the decisions.</p>

        <p>It works through three steps:</p>
        <ol className="list-decimal pl-5 space-y-2">
          <li><strong className="text-text-primary">Find candidates</strong> — through three discovery methods (crisis buys, emerging growth companies, and companies positioned to benefit from structural economic shifts).</li>
          <li><strong className="text-text-primary">Evaluate durability</strong> — every candidate gets adversarial analysis of its competitive position. Is this business getting stronger over time, or is it eroding?</li>
          <li><strong className="text-text-primary">Value and size</strong> — calculate what each company is worth using the appropriate model, determine a buy-below price with a margin of safety, and produce a clear signal with an exact position size.</li>
        </ol>

        <p>The output is one of three signals: <strong className="text-pass">BUY</strong> (with exact share count and dollar amount), <strong className="text-warn">NOT YET</strong> (good company, price too high), or <strong className="text-text-secondary">PASS</strong> (failed quality checks or overvalued). No ambiguity. No judgment calls.</p>
      </Section>

      {/* Section 2: How Opportunities Are Found */}
      <Section id="discovery" title="2. How Opportunities Are Found">
        <p>The system uses three separate funnels to find candidates. Each targets a different type of opportunity with its own logic and timing.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Crisis Dislocation (Tier 2)</h3>
        <p>When markets crash 20% or more, quality companies get dragged down with everything else. Their businesses are fine — the market is just panicking. This funnel only activates during actual crises.</p>
        <TechnicalDetails title="How Crisis Screening Works">
          <p>The system monitors market-level drawdowns. When a broad index drops 20%+, it:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Screens for companies whose stock price dropped with the market (beta-correlated decline, not company-specific bad news)</li>
            <li>Verifies the underlying business model is intact — revenue, margins, and cash flow haven't fundamentally changed</li>
            <li>Flags survivors as buying opportunities at crisis-discounted prices</li>
          </ul>
          <p className="mt-2">This funnel stays dormant during normal markets. It only produces candidates when there is genuine dislocation.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Emerging Growth (Tier 3)</h3>
        <p>Monthly scan for companies building self-reinforcing competitive positions — businesses where success breeds more success (sometimes called "flywheels"). Two tracks:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong className="text-text-primary">High-growth track:</strong> Revenue growing at 20%+ per year. These are companies in the steep part of their growth curve.</li>
          <li><strong className="text-text-primary">Steady compounder track:</strong> Revenue growing at 8%+ per year with strong margins and durable competitive advantages. Slower but more predictable.</li>
        </ul>
        <TechnicalDetails title="Growth Evaluation Details">
          <p>For both tracks, AI evaluation assesses whether the flywheel (self-reinforcing competitive loop) is real or just a story the company tells. Key questions:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Does each unit of growth actually make the next unit easier? (True flywheel)</li>
            <li>Or is growth driven by spending that stops working when spending stops? (Not a flywheel)</li>
            <li>Are switching costs real, or could customers leave easily?</li>
          </ul>
          <p className="mt-2">Revenue CAGR thresholds: high-growth track requires 20%+ over trailing 3 years. Compounder track requires 8%+ CAGR with operating margins above sector median and identifiable moat.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Regime Transition (Tier 4)</h3>
        <p>Detects structural economic shifts — new legislation, geopolitical events, technology breakthroughs — and identifies companies positioned to benefit. The critical filter: if everyone already knows about it, the opportunity is already priced in.</p>
        <TechnicalDetails title="Consensus Saturation Index">
          <p>The Consensus Saturation Index (CSI) measures how widely a regime shift is already recognized by the market. High CSI means the opportunity is consensus — and consensus plays rarely produce outsized returns.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Scans financial news and analyst reports for coverage density</li>
            <li>Measures how many institutional investors have already positioned for the shift</li>
            <li>Filters out plays where the market has already moved to price in the transition</li>
          </ul>
          <p className="mt-2">Only non-consensus opportunities (low CSI) proceed to evaluation. The best regime plays are the ones most investors haven't noticed yet.</p>
        </TechnicalDetails>
      </Section>

      {/* Section 3: How Companies Are Evaluated */}
      <Section id="evaluation" title="3. How Companies Are Evaluated">
        <p>Every candidate from every funnel goes through the same evaluation process. The goal: determine whether this company's competitive advantages will persist, strengthen, or erode.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Adversarial Scoring</h3>
        <p>Two AI analysts evaluate each company independently:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong className="text-text-primary">Bull case analyst</strong> — scores 6 factors, looking for reasons the company will succeed</li>
          <li><strong className="text-text-primary">Bear case analyst</strong> — challenges every assumption, looking for reasons it will fail</li>
        </ul>
        <p>The final score weights the bear case more heavily (60% bear, 40% bull). This is intentionally pessimistic. Better to miss a good opportunity than to buy a bad one.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">The Six Factors</h3>
        <ol className="list-decimal pl-5 space-y-2">
          <li><strong className="text-text-primary">Revenue Durability</strong> — Is the revenue recurring? Is it diversified across customers? Are there switching costs that lock customers in?</li>
          <li><strong className="text-text-primary">Competitive Reinforcement</strong> — Do the company's advantages get stronger as it grows? (A true flywheel.) Or do they stay flat or erode?</li>
          <li><strong className="text-text-primary">Industry Structure</strong> — Is this an industry with rational competitors and high barriers to entry? Or a price-war bloodbath?</li>
          <li><strong className="text-text-primary">Demand Feedback</strong> — Does customer behavior create positive feedback loops? (More users make the product better, which attracts more users.)</li>
          <li><strong className="text-text-primary">Adaptation Capacity</strong> — Has the company shown it can evolve without destroying what makes it work? (Amazon going from books to everything. Not Kodak ignoring digital.)</li>
          <li><strong className="text-text-primary">Capital Allocation</strong> — Does management invest money wisely? Do they buy back shares at good prices, make smart acquisitions, and avoid empire-building?</li>
        </ol>

        <TechnicalDetails title="Scoring and Thresholds">
          <p>Each factor scored 1-5. Weighted composite = (bull average x 0.4) + (bear average x 0.6).</p>
          <div className="overflow-x-auto mt-2">
            <table className="text-sm w-full">
              <thead><tr className="border-b border-border text-left">
                <th className="py-2 pr-4">Score</th><th className="py-2 pr-4">Classification</th><th className="py-2">Action</th>
              </tr></thead>
              <tbody>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-semibold text-pass">{'≥'} 2.5</td><td className="py-1 pr-4">Passes</td><td className="py-1">Proceeds to valuation</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-semibold text-warn">2.0 – 2.4</td><td className="py-1 pr-4">Borderline</td><td className="py-1">Proceeds with elevated margin of safety</td></tr>
                <tr><td className="py-1 pr-4 font-semibold text-fail">{'<'} 2.0</td><td className="py-1 pr-4">Hard reject</td><td className="py-1">Do not buy under any circumstances</td></tr>
              </tbody>
            </table>
          </div>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Concentration Risk Penalties</h3>
        <p>Even strong companies can be fragile if they depend too heavily on a single customer, supplier, market, or regulation. The system checks for these dependencies and penalizes the score accordingly.</p>
        <TechnicalDetails title="Penalty Schedule">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Risk Type</th><th className="py-2 pr-4">Threshold</th><th className="py-2">Penalty</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">Single customer {'≥'} 40% of revenue</td><td className="py-1 pr-4">Severe</td><td className="py-1">-1.0</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">Single customer {'≥'} 25% of revenue</td><td className="py-1 pr-4">Moderate</td><td className="py-1">-0.5</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">Critical single-source supplier</td><td className="py-1 pr-4">Binary dependency</td><td className="py-1">-0.5</td></tr>
              <tr className="border-b border-border/50"><td className="py-1 pr-4">{'≥'} 70% revenue from one foreign market</td><td className="py-1 pr-4">Geographic</td><td className="py-1">-0.3</td></tr>
              <tr><td className="py-1 pr-4">{'≥'} 50% revenue dependent on one regulation</td><td className="py-1 pr-4">Regulatory</td><td className="py-1">-0.5</td></tr>
            </tbody>
          </table>
          <p className="mt-2">Penalties stack. Score has a floor of 1.0.</p>
        </TechnicalDetails>
      </Section>

      {/* Section 4: How Stocks Are Valued */}
      <Section id="valuation" title="4. How Stocks Are Valued">
        <p>Different types of companies need different valuation methods. The system uses three approaches, matched to how each tier of company generates value.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Established Companies (Tier 2 — Crisis Buys)</h3>
        <p>These are proven businesses with long earnings histories. Valued using Benjamin Graham's formula, which estimates what a company is worth based on its earnings, growth rate, and current interest rates. A modifier adjusts for companies with exceptionally high returns on equity (they deserve a premium).</p>
        <TechnicalDetails title="Graham Formula with ROE Modifier">
          <p className="font-mono">IV = Normalized EPS x (8.5 + 2g) x (4.4 / Y)</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Normalized EPS = average EPS of 3 most recent years (smooths short-term noise)</li>
            <li>g = estimated annual growth rate (capped to prevent over-optimism)</li>
            <li>8.5 = base P/E for a zero-growth company</li>
            <li>Y = current AAA corporate bond yield (from FRED)</li>
          </ul>
          <p className="mt-2">ROE modifier: companies with ROE 20-30% get 1.25x multiplier on the P/E x P/B ceiling. ROE 30%+ gets 1.50x. This recognizes that high returns on equity from buybacks and capital efficiency are a feature, not a valuation trap.</p>
          <p className="mt-1">Crisis premium: during market dislocations, an additional discount is applied because even "cheap" can get cheaper during a panic.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Growth Companies (Tier 3 — Emerging Growth)</h3>
        <p>Growth companies don't have stable earnings to plug into Graham's formula. Instead, the system projects revenue forward at a decelerating growth rate (because all growth slows eventually), estimates what the company will earn at maturity, applies a terminal P/E ratio, and discounts back to today.</p>
        <TechnicalDetails title="Growth Valuation Method">
          <ul className="list-disc pl-5 space-y-1">
            <li>Project revenue forward 5-7 years, with growth rate decelerating annually (regression to sector mean)</li>
            <li>Estimate terminal margins based on industry comparables at maturity</li>
            <li>Apply terminal P/E (industry-appropriate, typically 15-25x)</li>
            <li>Discount back to present value at required rate of return</li>
          </ul>
          <p className="mt-2">The key discipline: the deceleration assumption. The system never assumes current growth rates will persist. A company growing at 40% today might be modeled at 15% in year 5.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Regime Plays (Tier 4 — Structural Shifts)</h3>
        <p>Regime transitions are inherently uncertain. The system models bull and bear scenarios separately and weights them by how likely the structural shift is to actually materialize.</p>
        <TechnicalDetails title="Scenario-Weighted Valuation">
          <ul className="list-disc pl-5 space-y-1">
            <li>Bull case: the regime shift fully plays out, company captures expected share</li>
            <li>Bear case: the shift stalls or competitors capture the opportunity</li>
            <li>Weighted value = (bull value x shift probability) + (bear value x (1 - shift probability))</li>
          </ul>
          <p className="mt-2">Shift probability is assessed based on legislative progress, technology readiness, institutional adoption signals, and precedents from analogous transitions.</p>
        </TechnicalDetails>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Margin of Safety</h3>
        <p>For all three tiers, the system never pays full estimated value. It applies a margin of safety — a discount that protects you if the estimate is wrong. The size of the margin depends on two things: how strong the company's competitive position is (attractor score) and how stressed the broader economy is.</p>
      </Section>

      {/* Section 5: What the Signals Mean */}
      <Section id="signals" title="5. What the Signals Mean">
        <p>Three signals. No ambiguity. No "maybe" or "it depends."</p>

        <div className="overflow-x-auto mt-4">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Signal</th><th className="py-2 pr-4">When It Triggers</th><th className="py-2">What You Do</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-3 pr-4 font-bold text-pass">BUY</td>
                <td className="py-3 pr-4">Price is below the buy-below threshold</td>
                <td className="py-3">Execute. The system tells you exactly how many shares and how many dollars.</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-3 pr-4 font-bold text-warn">NOT YET</td>
                <td className="py-3 pr-4">Company passes all checks but price hasn't dropped enough</td>
                <td className="py-3">Wait. The system shows the target price. Set an alert and move on.</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-bold text-text-secondary">PASS</td>
                <td className="py-3 pr-4">Failed quality checks or overvalued</td>
                <td className="py-3">Ignore. Don't look back.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Sell Triggers (6 Total)</h3>
        <p>The system also monitors existing positions and generates sell signals:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li><strong className="text-text-primary">Overvalued</strong> — price has risen above intrinsic value. Take the gain.</li>
          <li><strong className="text-text-primary">Attractor dissolving</strong> — competitive position is actively eroding. Sell immediately regardless of price.</li>
          <li><strong className="text-text-primary">Thesis broken</strong> — the original reason you bought has been invalidated. Don't wait for price recovery.</li>
          <li><strong className="text-text-primary">Overweight</strong> — position has grown too large relative to portfolio. Trim to target size.</li>
          <li><strong className="text-text-primary">Growth stalled</strong> — (Tier 3 only) growth has decelerated below the minimum threshold.</li>
          <li><strong className="text-text-primary">Regime maturing</strong> — (Tier 4 only) the structural shift has played out and the opportunity is now fully priced in.</li>
        </ol>
      </Section>

      {/* Section 6: How Position Sizes Are Determined */}
      <Section id="position-sizing" title="6. How Position Sizes Are Determined">
        <p>The system divides capital across tiers and sizes each position based on conviction level.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Capital Allocation by Tier</h3>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Tier</th><th className="py-2 pr-4">Purpose</th><th className="py-2">Allocation</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Crisis (Tier 2)</td><td className="py-2 pr-4">Buying quality companies during market panics</td><td className="py-2">15%</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Emerging Growth (Tier 3)</td><td className="py-2 pr-4">Companies building self-reinforcing positions</td><td className="py-2">30%</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Regime (Tier 4)</td><td className="py-2 pr-4">Beneficiaries of structural economic shifts</td><td className="py-2">20%</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-semibold">Flexible</td><td className="py-2 pr-4">Goes to whichever tier has the best opportunities</td><td className="py-2">30%</td></tr>
              <tr><td className="py-2 pr-4 font-semibold">Cash Reserve</td><td className="py-2 pr-4">Always held in reserve for sudden opportunities</td><td className="py-2">5%</td></tr>
            </tbody>
          </table>
        </div>

        <TechnicalDetails title="Position Sizing Rules">
          <ul className="list-disc pl-5 space-y-1">
            <li>Maximum single position: 5% of total portfolio</li>
            <li>Confidence multiplier: <strong>STRONG</strong> conviction = full position size (100%). <strong>STANDARD</strong> conviction = 75% of full size.</li>
            <li>STRONG is assigned when the stock trades at 90% or less of buy-below price. STANDARD when it trades at or below buy-below.</li>
            <li>The flexible pool (30%) is dynamically allocated to whichever tier is producing the most compelling opportunities at any given time</li>
          </ul>
        </TechnicalDetails>
      </Section>

      {/* Section 7: Market Environment Monitoring */}
      <Section id="market-monitoring" title="7. Market Environment Monitoring">
        <p>The system tracks macroeconomic conditions daily using data from the Federal Reserve (FRED API). These conditions affect how aggressively it buys and what margin of safety it requires.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">What It Tracks</h3>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Indicator</th><th className="py-2">What It Tells You</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">AAA/BAA corporate bond yields</td><td className="py-2">Cost of borrowing for strong vs. weaker companies</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">Yield curve (10Y - 2Y Treasury spread)</td><td className="py-2">Inversion historically precedes recessions</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">VIX (volatility index)</td><td className="py-2">Market fear gauge. Above 30 = elevated stress</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">High-yield OAS (option-adjusted spread)</td><td className="py-2">How much extra investors demand for risky debt</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">Unemployment rate</td><td className="py-2">Labor market health. Above 5% = concern</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4">GDP growth</td><td className="py-2">Negative = recession</td></tr>
              <tr><td className="py-2 pr-4">Oil prices</td><td className="py-2">Input cost pressure and geopolitical signal</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Environment Classification</h3>
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4">Classification</th><th className="py-2 pr-4">Stress Indicators</th><th className="py-2">Effect</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-pass">NORMAL</td><td className="py-2 pr-4">0 triggered</td><td className="py-2">Standard margins of safety</td></tr>
              <tr className="border-b border-border/50"><td className="py-2 pr-4 font-bold text-warn">CAUTIOUS</td><td className="py-2 pr-4">1-2 triggered</td><td className="py-2">Increased vigilance, slightly wider margins</td></tr>
              <tr><td className="py-2 pr-4 font-bold text-fail">STRESSED</td><td className="py-2 pr-4">3+ triggered</td><td className="py-2">+5% margin of safety added to all positions</td></tr>
            </tbody>
          </table>
        </div>

        <TechnicalDetails title="Crisis and Regime Detection">
          <p><strong>Crisis detection:</strong> When the environment is STRESSED and major indices have drawn down 20%+, the system activates the Tier 2 crisis funnel and begins screening for dislocation opportunities.</p>
          <p className="mt-2"><strong>Regime detection:</strong> Continuous scan of financial news and policy developments for structural shifts (new legislation, trade realignments, technology breakthroughs). Identified shifts are evaluated for investment implications and filtered through the Consensus Saturation Index.</p>
        </TechnicalDetails>
      </Section>

      {/* Section 8: Sell Discipline */}
      <Section id="sell-discipline" title="8. Sell Discipline">
        <p>Six triggers, each unambiguous. When a trigger fires, you sell. No second-guessing.</p>

        <ol className="list-decimal pl-5 space-y-3">
          <li><strong className="text-text-primary">Overvalued.</strong> Price has risen above intrinsic value. The margin of safety is consumed. Take the gain.</li>
          <li><strong className="text-text-primary">Attractor dissolving.</strong> The company's competitive position is actively eroding (score dropped below 2.0). Sell immediately — regardless of price, regardless of loss. This is the one trigger with no exceptions.</li>
          <li><strong className="text-text-primary">Thesis broken.</strong> The original reason you bought is invalidated by new evidence. A key product fails, a regulatory moat disappears, management changes strategy. Don't wait for price recovery.</li>
          <li><strong className="text-text-primary">Overweight.</strong> A position has appreciated to the point where it's too large relative to the portfolio. Trim to target size to manage risk.</li>
          <li><strong className="text-text-primary">Growth stalled.</strong> (Tier 3 only.) Growth has decelerated below the minimum threshold. The flywheel may be breaking down.</li>
          <li><strong className="text-text-primary">Regime maturing.</strong> (Tier 4 only.) The structural shift has largely played out. The market has caught up and the opportunity is priced in.</li>
        </ol>

        <TechnicalDetails title="Tax-Aware Timing">
          <p>When a sell trigger fires and the position has been held between 300-365 days, the system calculates whether waiting until the long-term capital gains threshold (1 year) would save enough in taxes to justify the holding risk.</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Estimates tax savings from long-term vs. short-term capital gains rate</li>
            <li>Weighs against the risk of further price decline during the waiting period</li>
            <li>If the tax savings are material and the sell trigger isn't urgent, it recommends holding to the anniversary</li>
          </ul>
          <p className="mt-2"><strong>Exception:</strong> Attractor dissolution (trigger #2) always sells immediately. A dissolving competitive position can collapse faster than any tax savings are worth.</p>
        </TechnicalDetails>
      </Section>

      {/* Section 9: Glossary */}
      <Section id="glossary" title="9. Glossary">
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr className="border-b border-border text-left">
              <th className="py-2 pr-4 w-56">Term</th><th className="py-2">Definition</th>
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

      {/* Section 10: The Research Behind This Approach */}
      <Section id="research" title="10. The Research Behind This Approach">
        <p>This framework draws on complex systems science — the study of how interconnected systems behave, grow, and sometimes collapse. The core insight: companies are not static entities with fixed "moats." They are dynamic systems that either reinforce themselves or erode over time.</p>

        <h3 className="text-lg font-semibold text-text-primary mt-6">Key Ideas</h3>
        <ul className="list-disc pl-5 space-y-3">
          <li><strong className="text-text-primary">Scaling laws (Geoffrey West)</strong> — Companies that grow faster than their costs scale exhibit "superlinear" growth. Revenue doubles but costs less than double. This is the mathematical signature of a flywheel. West showed these scaling relationships predict which cities (and by extension, companies) will thrive and which will stagnate.</li>
          <li><strong className="text-text-primary">Dynamic Kinetic Stability / DKS (Addy Pross)</strong> — Some systems persist not because they are static, but because they are constantly renewing themselves. A river is stable even though the water is always moving. Companies with DKS maintain their competitive position through continuous adaptation, not rigid defense. This is what the attractor analysis measures.</li>
          <li><strong className="text-text-primary">Self-organized criticality (Per Bak)</strong> — Systems naturally evolve to a critical state where small perturbations can trigger large cascading changes — like a sandpile that collapses when one more grain is added. This explains why market crashes and competitive collapses happen suddenly, and why the sell discipline requires immediate action on attractor dissolution.</li>
          <li><strong className="text-text-primary">The adjacent possible (Stuart Kauffman)</strong> — Innovation doesn't come from nowhere. It emerges from recombining things that already exist in new ways. The Tier 4 regime analysis uses this concept to evaluate whether a structural shift is genuinely imminent or still too far from current reality.</li>
          <li><strong className="text-text-primary">Bass diffusion model</strong> — Describes how new products and ideas spread through a population in an S-curve: slow start, rapid adoption, eventual saturation. Used to assess where a growth company or regime play sits on its adoption curve.</li>
        </ul>

        <TechnicalDetails title="Validation and Practitioners">
          <p><strong>Calibration:</strong> The framework was validated against 200 historical cases across bull, bear, and sideways markets, plus 5 targeted stress tests (crisis periods, value traps, growth collapses). The attractor trap test suite correctly identified 6/6 known traps as "Dissolving" (INTC, M, WBA, WFC, T, KHC).</p>
          <p className="mt-2"><strong>Similar approaches in practice:</strong></p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li><strong>Michael Mauboussin</strong> (Counterpoint Global) — applies complex adaptive systems thinking to competitive advantage analysis</li>
            <li><strong>Nick Sleep and Qais Zakaria</strong> (Nomad Investment Partnership) — pioneered "scale economies shared" as an investment framework, identifying self-reinforcing business models (early investments in Amazon, Costco)</li>
            <li><strong>James Anderson / Baillie Gifford</strong> — uses power-law thinking and long-duration growth analysis, emphasizing that a small number of extreme winners drive portfolio returns</li>
          </ul>
        </TechnicalDetails>
      </Section>

      <div className="h-20" />
    </div>
  )
}

const GLOSSARY = [
  { term: 'Attractor', def: 'A stable state that a system naturally tends toward. In investing: a competitive position that reinforces itself over time. A company with a strong attractor gets harder to compete with as it grows.' },
  { term: 'Consensus Saturation Index', def: 'Measures how widely a regime shift is already recognized by the market. High CSI means the opportunity is consensus and likely already priced in. Only low-CSI opportunities proceed to evaluation.' },
  { term: 'DKS (Dynamic Kinetic Stability)', def: 'A concept from chemistry: some systems are stable not because they are static, but because they are constantly renewing themselves. Applied to companies: a business that maintains its position through continuous adaptation rather than rigid defense of a fixed advantage.' },
  { term: 'Fat-Tail Discount', def: 'A downward adjustment to intrinsic value that accounts for extreme events (crashes, black swans) happening more often than standard models predict. Based on the company\'s track record through past stress periods.' },
  { term: 'Flywheel', def: 'A self-reinforcing cycle where each part of the business strengthens the next. Example: more customers generate more data, which improves the product, which attracts more customers. The attractor analysis checks whether a company\'s flywheel is real.' },
  { term: 'Intrinsic Value', def: 'An estimate of what a business is actually worth based on its earnings, growth, and competitive position — independent of what the stock market currently prices it at. The system calculates this differently for each tier.' },
  { term: 'Margin of Safety', def: 'The gap between what a company is worth (intrinsic value) and the maximum price the system will pay (buy-below price). Protects against errors in the valuation estimate. Ranges from 25% to 45% depending on conviction and market conditions.' },
  { term: 'Network Regime', def: 'The type of competitive dynamics in an industry. Classical (brand, scale, cost advantages), Soft Network (mild network effects), Hard Network (winner-take-all dynamics), or Platform (multi-sided marketplaces). Affects margin of safety requirements.' },
  { term: 'Regime Transition', def: 'A structural shift in the economy driven by new legislation, geopolitical events, or technology breakthroughs. Creates investment opportunities for companies positioned to benefit — but only if the shift isn\'t already priced in.' },
  { term: 'S-Curve', def: 'The characteristic shape of adoption for new products and ideas: slow start, rapid growth, then saturation. Used to assess where a growth company or regime play sits in its lifecycle. Early S-curve = most upside remaining.' },
  { term: 'Scaling Exponent', def: 'From Geoffrey West\'s research: measures whether a company\'s outputs grow faster (superlinear, exponent > 1) or slower (sublinear, exponent < 1) than its inputs. Superlinear scaling is the mathematical signature of a working flywheel.' },
]
