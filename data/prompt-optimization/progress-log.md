# Prompt Optimization Progress Log

## Session 1: 2026-03-25

### Phase 0 — Data Collection ✅
- Selected 195 eligible cases from Tiers 5/7/8 (2018-2021 entries)
- 80 winners, 115 traps (binary: alpha > 0 = winner)
- EDGAR extraction: 134/195 got current 10-K, 119/195 got prior 10-K
- 117 cases with complete entry data (both current + prior risk factors)
- T7 (ADR) largely failed — most international companies file 20-F without extractable Item 1A
- Partitioned: 47 train (17W/30T), 35 validation (13W/22T), 35 holdout (13W/22T)
- Git pushed.
