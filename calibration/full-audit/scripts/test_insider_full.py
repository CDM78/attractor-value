#!/usr/bin/env python3
"""Sub-Agent E: Insider signals."""
import sys, math; sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from stats_lib import load_dataset, test_signal, pearsonr
rows = load_dataset(str(__import__('pathlib').Path(__file__).parent.parent / 'master-dataset.csv'))
print(f"Loaded {len(rows)} cases\n")
ins = [r for r in rows if r.get('form4_net_value','') != '']
print(f"Cases with insider data: {len(ins)}")
tickers = [r['ticker'] for r in ins]
print(f"Unique companies: {len(set(tickers))} ({(len(tickers)-len(set(tickers)))/len(tickers)*100:.0f}% duplicates)\n")
test_signal(rows, 'form4_log_net_value', 'forward_return_3yr', 'log(insider net value)', 0.260)
test_signal(rows, 'form4_net_value', 'forward_return_3yr', 'Insider net value (raw)', 0.128)
# De-duplicated test
seen = {}
for r in rows:
    if r.get('form4_log_net_value','') == '': continue
    t = r['ticker']
    if t not in seen or r['entry_date'] > seen[t]['entry_date']:
        seen[t] = r
deduped = list(seen.values())
print(f"De-duplicated: {len(deduped)} cases")
test_signal(deduped, 'form4_log_net_value', 'forward_return_3yr', 'log(insider net value) [DE-DUPED]', 0.260)
# Direction categorical
for direction in ['NET_BUYING', 'MIXED', 'NET_SELLING']:
    group = [r for r in ins if r.get('form4_net_direction') == direction]
    if not group: continue
    rets = [float(r['forward_return_3yr']) for r in group]
    wins = sum(1 for r in rets if r > 0.20)
    print(f"{direction}: n={len(group)}, win_rate(>20%)={wins/len(group)*100:.0f}%, mean_return={sum(rets)/len(rets):+.3f}")
