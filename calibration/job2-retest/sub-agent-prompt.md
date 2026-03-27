You are analyzing two annual report risk factor sections (Item 1A) from
the same company, filed one year apart. You are given the company's SEC
CIK identifier but NOT its name or ticker. Do not attempt to identify
the company.

YOUR TASK IS TO DESCRIBE WHAT YOU OBSERVE, NOT TO PREDICT OUTCOMES.

You are not being asked whether this is a "good" or "bad" company.
You are not being asked to predict stock performance.
You are being asked to describe specific, observable changes between
the two documents.

PRIOR YEAR RISK FACTORS (filed {prior_date}):
{prior_item1a_text}

CURRENT YEAR RISK FACTORS (filed {current_date}):
{current_item1a_text}

STEP 1 — FACTUAL OBSERVATIONS (Complete ALL of these before Step 2)

Count and list:
A. Risk factors ADDED in the current year (present now, absent before):
   List each new risk factor in one sentence. If none, write "NONE ADDED."

B. Risk factors REMOVED (present before, absent now):
   List each removed risk factor in one sentence. If none, write "NONE REMOVED."

C. Risk factors with CHANGED SEVERITY (present in both, but language
   shifted from mild to urgent OR from urgent to mild):
   For each, quote the specific language change. If none, write "NO SEVERITY CHANGES."

D. Risk factors that are SUBSTANTIALLY IDENTICAL between the two years:
   Count only. Do not list them.

E. Overall document statistics:
   - Prior year approximate word count: ___
   - Current year approximate word count: ___
   - Percentage change: ___%
   - Number of distinct risk factors (prior): ___
   - Number of distinct risk factors (current): ___

STEP 2 — UNCERTAINTY ASSESSMENT

Based ONLY on your Step 1 observations, rate your ability to assess
this company's risk trajectory:

- CAN_ASSESS: The changes between years are clear and substantive.
  I have enough information to characterize the direction.
- MARGINAL: There are some changes but they're ambiguous — the risk
  profile could be interpreted as improving or deteriorating depending
  on assumptions.
- CANNOT_ASSESS: The two documents are nearly identical, or the changes
  are cosmetic/regulatory boilerplate, or I don't have enough context
  to determine whether changes are positive or negative.

It is completely acceptable and expected that many companies will be
CANNOT_ASSESS. Risk factor sections are often copied forward with
minimal changes. Reporting CANNOT_ASSESS is an honest, useful finding —
it means this data source does not contain a signal for this company.

DO NOT force an assessment when the evidence is ambiguous.
Saying "I can't tell" is better than guessing.

STEP 3 — SCORE (Only if Step 2 = CAN_ASSESS or MARGINAL)

If and only if you rated CAN_ASSESS or MARGINAL in Step 2, provide:

SCORE: A number from 1.0 to 5.0 (one decimal place)
  1.0 = Risk profile clearly deteriorating (new material risks, severity escalating)
  3.0 = Risk profile neutral (changes are cosmetic or offsetting)
  5.0 = Risk profile clearly improving (risks resolving, severity declining)

Your score must be justified by specific observations from Step 1.
Reference the specific added/removed/changed risk factors that drive
your score.

If Step 2 = CANNOT_ASSESS, write: SCORE: N/A — insufficient signal
Do NOT assign a numeric score when you cannot assess.

RESPOND IN EXACTLY THIS FORMAT:

OBSERVATIONS_A: [list or NONE ADDED]
OBSERVATIONS_B: [list or NONE REMOVED]
OBSERVATIONS_C: [list with quotes or NO SEVERITY CHANGES]
OBSERVATIONS_D_COUNT: [number]
STATISTICS: [prior_words] / [current_words] / [pct_change] / [prior_risks] / [current_risks]
UNCERTAINTY: [CAN_ASSESS / MARGINAL / CANNOT_ASSESS]
SCORE: [1.0-5.0 or N/A]
JUSTIFICATION: [2-3 sentences referencing Step 1 observations]
