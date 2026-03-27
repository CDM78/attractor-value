You are comparing two years of SEC 10-K Item 1A (Risk Factors) for an anonymous company. Do NOT attempt to identify the company.

SECTOR: {sector}

CURRENT 10-K RISK FACTORS (filed {current_date}):
{current_text}

PRIOR YEAR 10-K RISK FACTORS (filed {prior_date}):
{prior_text}

Compare these risk factors. Are there new high-severity risks? Has language escalated? What is the overall trajectory?

Respond with JSON only:
{"trajectory": "stable" or "deteriorating", "confidence": "high" or "medium" or "low", "information_requests": [{"type": "<SEC_FILING|INSIDER_TRADING|MANAGEMENT|CUSTOMER_CONCENTRATION>", "query": "specific query", "reason": "why this would change assessment", "expected_impact": "HIGH|MEDIUM|LOW"}]}

List up to 5 information requests that would most improve your confidence.
