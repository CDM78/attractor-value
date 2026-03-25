import json, datetime

job1_result = {
  "total_commitments_tracked": 9,
  "commitments_delivered": 6,
  "commitments_missed": 3,
  "credibility_score": 0.67,
  "commitments_detail": [
    {"commitment": "FreeStyle Libre to sustain double-digit Diabetes Care growth (Q1: double-digit growth stated)", "origin_quarter": "Q1", "outcome": "delivered", "evidence": "Q2 and Q3 both confirm double-digit Diabetes Care growth led by FreeStyle Libre"},
    {"commitment": "Electrophysiology growth driven by Confirm Rx launch and cardiac mapping share gains (Q1: double-digit growth claimed)", "origin_quarter": "Q1", "outcome": "delivered", "evidence": "Q2 20.1% ex-FX (6-month), Q3 20.0% ex-FX (9-month); Confirm Rx cited as driver in all three quarters"},
    {"commitment": "MitraClip Japan reimbursement enabling greater patient access and structural heart growth (Q1)", "origin_quarter": "Q1", "outcome": "delivered", "evidence": "Structural Heart grew 10.6% (Q2 6-month) and 12.2% (Q3 9-month) ex-FX, accelerating from Q1 7.5%; MitraClip cited as key driver in Q2 and Q3"},
    {"commitment": "Core Laboratory above-market growth and share gains (Q1)", "origin_quarter": "Q1", "outcome": "delivered", "evidence": "Q2 6-month Core Lab +7.0% ex-FX; Q3 9-month +7.4% ex-FX with above-market language reaffirmed in Q3"},
    {"commitment": "Heart Failure growth led by HeartMate 3 market uptake (Q1: +4.8% ex-FX)", "origin_quarter": "Q1", "outcome": "missed", "evidence": "Q2 Heart Failure slowed to +2.8% (6-month ex-FX); Q3 turned negative at -1.5% ex-FX (9-month). HeartMate 3 not mentioned after Q1."},
    {"commitment": "Rhythm Management market share gains in new patient segment (Q1)", "origin_quarter": "Q1", "outcome": "missed", "evidence": "Q2 Rhythm Management -2.1% ex-FX (6-month); Q3 -1.2% ex-FX (9-month). No further narrative on new-patient share gains in Q2 or Q3."},
    {"commitment": "Neuromodulation double-digit growth from recently launched products (Q1: +18.8% ex-FX)", "origin_quarter": "Q1", "outcome": "partial", "evidence": "Q2 6-month +11.8% ex-FX, Q3 9-month +8.7% ex-FX. Growth continued but decelerated sharply from Q1 double-digit level."},
    {"commitment": "Key Emerging Markets sustained growth above 6% ex-FX (Q1: +6.8%)", "origin_quarter": "Q1", "outcome": "delivered", "evidence": "Q2 6-month +9.5% ex-FX; Q3 9-month +8.5% ex-FX. Both quarters delivered above the Q1 baseline."},
    {"commitment": "Advisor HD Grid Mapping Catheter clearance (May 2018, Q2) to expand electrophysiology portfolio", "origin_quarter": "Q2", "outcome": "delivered", "evidence": "Q3 references the Advisor HD Grid clearance as ongoing portfolio expansion; EP growth remained strong at 20.0% ex-FX (9-month)"}
  ],
  "language_shifts": [
    {"quarter": "Q2", "shift": "Gross profit margin percentage discussion dropped entirely: Q1 explicitly stated 50.6% gross margin vs 43.4% prior year; Q2 and Q3 omit any gross margin or profitability discussion from the MD&A sections"},
    {"quarter": "Q2", "shift": "HeartMate 3 market uptake narrative disappears: Q1 specifically cited HeartMate 3 as leading Heart Failure sales growth; Q2 attributes growth only to higher international sales with no product attribution; Q3 drops Heart Failure narrative entirely from sub-segment commentary as segment goes negative"},
    {"quarter": "Q2", "shift": "Rhythm Management share-gain language dropped: Q1 gave specific narrative on new-patient share gains; Q2 and Q3 provide no narrative commentary on Rhythm Management despite the segment turning negative in the 6-month period"},
    {"quarter": "Q3", "shift": "U.S. Adult Nutritionals narrative turns defensive: Q3 introduces wind-down of a non-core product line to explain near-zero U.S. Adult growth (0.2% ex-FX), a topic absent in Q1 and Q2"},
    {"quarter": "Q3", "shift": "R&D expenditure detail dropped: Q1 included specific dollar amounts and segment-level R&D spend breakdowns; Q2 and Q3 omit this level of financial transparency"}
  ],
  "red_flags": [
    "Heart Failure: HeartMate 3 growth narrative dropped precisely when segment turned negative (-1.5% ex-FX by Q3 9-month), consistent with selective omission of underperforming product commentary",
    "Rhythm Management turned negative by Q2 (-2.1% ex-FX 6-month) with no management commentary or explanation in subsequent quarters despite being an explicit Q1 growth story",
    "Neuromodulation decelerated sharply from 18.8% (Q1) to 8.7% (Q3 9-month) without acknowledgment; initial double-digit framing was not sustained",
    "Gross margin and R&D detail absent from Q2 and Q3 despite being specific, comparable, and trackable metrics introduced in Q1",
    "MitraClip Japan national reimbursement cited as enabling greater patient access in Q1 but never referenced again in subsequent quarters"
  ]
}

job4_result = {
  "guidance_trend": "stable",
  "hedging_trend": "stable",
  "topics_dropped": [
    "HeartMate 3 product-level attribution for Heart Failure growth (present Q1, absent Q2-Q3)",
    "Japan MitraClip national reimbursement as patient access catalyst (Q1 only)",
    "Gross profit margin percentage (Q1 only)",
    "R&D expenditure segment-level detail (Q1 only)",
    "Rhythm Management new-patient share-gain narrative (Q1 only)",
    "U.S. DES lower market share acknowledgment (Q1 only)"
  ],
  "confidence_trend": "decreasing",
  "quarters_analyzed": 3,
  "overall_communication_trajectory": "deteriorating",
  "notable_shifts": [
    {"quarter": "Q1", "observation": "Highest density of confidence markers: above-market growth, double-digit growth (3 instances), market-leading, recently launched, market uptake. Specific gross margin and R&D disclosures signal high transparency. Tone is assertively positive with product-level attribution across all business lines including even challenged segments (Vascular DES market share acknowledged directly)."},
    {"quarter": "Q2", "observation": "Confidence language measurably reduced: above-market disappears, double-digit reduces to 2 instances, driven by drops from 6 to 2 instances. Heart Failure shifts from product-specific (HeartMate 3) to vague (higher international sales). Gross margin discussion dropped entirely. Vascular DES market-share commentary absent despite continued weakness implied by data table (-0.2% ex-FX for 6-month Vascular). Section ends without Rhythm Management sub-segment narrative."},
    {"quarter": "Q3", "observation": "Defensive framing introduced with wind down of a non-core product line to rationalize flat U.S. Adult Nutritionals. Heart Failure turns negative (-1.5% ex-FX 9-month) with no sub-segment narrative or product attribution. Foreign exchange framing reverses: Q1-Q2 emphasized tailwind, Q3 emphasizes headwind. COAPT clinical data is used as a forward confidence signal for MitraClip, but the accumulation of dropped topics (HeartMate 3, Rhythm Management, Japan reimbursement, gross margin) suggests a shift from transparent disclosure to selective positive framing."}
  ]
}

ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

out = {"blindId": "ANALYST-0026", "job1": job1_result, "job2": None, "job3": None, "job4": job4_result, "timestamp": ts}

path = "C:/Users/charl/attractor-value/data/ai-analyst-pipeline/eval-results/ANALYST-0026.json"
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)

print("Saved:", path)
print("Keys:", list(out.keys()))
print("job2 is None:", out["job2"] is None)
print("job3 is None:", out["job3"] is None)
reloaded = json.loads(json.dumps(out))
print("Roundtrip valid:", reloaded["blindId"] == "ANALYST-0026")
print("Timestamp:", ts)
