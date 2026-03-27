You previously analyzed {COMPANY} and classified trajectory as {initial_trajectory} with {initial_confidence} confidence.

You requested additional information. Here is what was found:

{for each request: type, summary, or "NOT FOUND: no relevant data"}

Given this additional information:
Respond with JSON only:
{"trajectory": "stable" or "deteriorating" or "improving", "confidence": "high" or "medium" or "low", "most_impactful_source": "which info type mattered most", "classification_changed": true/false, "key_insight": "one sentence"}
