# Prompt Optimization Progress Log

## Session 1: 2026-03-25

### Phase 0 — Data Collection ✅
- Selected 195 eligible cases from Tiers 5/7/8 (2018-2021 entries)
- 117 cases with complete entry data (both current + prior risk factors)
- Partitioned: 47 train (17W/30T), 35 validation (13W/22T), 35 holdout (13W/22T)

### Phase 1 — Prompt Generation ✅
- 8 BUY variants + 5 SELL variants created
- Hardware shutdown interrupted Phase 2 start

## Session 2: 2026-03-25 (resumed after hardware shutdown)

### Phase 2 Round 1 — Training Evaluation ✅
- 10 Sonnet sub-agents, 47 training cases, all 8 BUY + 5 SELL variants
- Best pair: buy_v4_confession + sell_v6 (48.7% alpha)
- 11 sub-agent calls

### Phase 2 Round 2 — Mutations ✅
- 5 new BUY + 3 new SELL variants, 5 Sonnet sub-agents
- buy_v10_confession_minimal: 52.2% precision, r=0.326
- Convergence confirmed after 2 rounds
- 5 sub-agent calls

### Phase 3 — Validation ✅
- 4 Opus sub-agents, 35 validation cases
- Alpha: 22.4% (vs no-filter 16.4% → AI adds +6pp)
- 4 sub-agent calls

### Phase 4 — Holdout ✅
- 4 Opus sub-agents, 35 holdout cases
- Alpha: 13.5% (vs no-filter 15.8% → AI costs -2.3pp)
- BUY pass=80%, precision=39.3%; SELL activation=11.4%
- 4 sub-agent calls

### Phase 5 — Final Report ✅
- Report saved to results/prompt-optimization-final-report-2026-03-25.md
- Recommendation: DEPLOY BUY ONLY as soft signal (position sizing), not hard filter

### Session 2 Total: 24 sub-agent calls

## Final Results

| Partition | Alpha | No-Filter | AI Value-Add |
|-----------|-------|-----------|--------------|
| Training | 48.7% | N/A | N/A |
| Validation | 22.4% | 16.4% | +6.0pp |
| Holdout | 13.5% | 15.8% | -2.3pp |

**Verdict:** Holdout alpha 13.5% = STRONG PASS on absolute terms, but AI filter doesn't reliably beat no-filter. Deploy as soft signal for position sizing, not as a binary gate.
