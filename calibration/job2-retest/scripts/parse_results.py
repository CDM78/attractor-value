#!/usr/bin/env python3
"""
Parse sub-agent output text into structured fields.
Used by stochasticity and full-run collection scripts.
"""

import re

def parse_agent_output(text):
    """Parse the structured output from a sub-agent evaluation."""
    result = {
        'observations_a': '',
        'observations_b': '',
        'observations_c': '',
        'observations_d_count': '',
        'statistics': '',
        'uncertainty_rating': '',
        'score': '',
        'justification': '',
        'obs_a_count': 0,
        'obs_b_count': 0,
        'obs_c_count': 0,
        'prior_word_count': 0,
        'current_word_count': 0,
    }

    if not text:
        return result

    # Extract structured fields
    patterns = {
        'observations_a': r'OBSERVATIONS_A:\s*(.*?)(?=\nOBSERVATIONS_B:|$)',
        'observations_b': r'OBSERVATIONS_B:\s*(.*?)(?=\nOBSERVATIONS_C:|$)',
        'observations_c': r'OBSERVATIONS_C:\s*(.*?)(?=\nOBSERVATIONS_D_COUNT:|$)',
        'observations_d_count': r'OBSERVATIONS_D_COUNT:\s*(\d+)',
        'statistics': r'STATISTICS:\s*(.*?)(?=\nUNCERTAINTY:|$)',
        'uncertainty_rating': r'UNCERTAINTY:\s*(CAN_ASSESS|MARGINAL|CANNOT_ASSESS)',
        'score': r'SCORE:\s*([\d.]+|N/A)',
        'justification': r'JUSTIFICATION:\s*(.*?)$',
    }

    for field, pattern in patterns.items():
        m = re.search(pattern, text, re.DOTALL | re.MULTILINE)
        if m:
            result[field] = m.group(1).strip()

    # Count observations
    obs_a = result['observations_a']
    if obs_a and 'NONE ADDED' not in obs_a.upper():
        # Count bullet points or numbered items
        items = re.findall(r'(?:^|\n)\s*[-•\d]+[.)]\s', obs_a)
        if items:
            result['obs_a_count'] = len(items)
        else:
            # Count sentences as items
            sentences = [s.strip() for s in obs_a.split('.') if len(s.strip()) > 20]
            result['obs_a_count'] = max(1, len(sentences))

    obs_b = result['observations_b']
    if obs_b and 'NONE REMOVED' not in obs_b.upper():
        items = re.findall(r'(?:^|\n)\s*[-•\d]+[.)]\s', obs_b)
        if items:
            result['obs_b_count'] = len(items)
        else:
            sentences = [s.strip() for s in obs_b.split('.') if len(s.strip()) > 20]
            result['obs_b_count'] = max(1, len(sentences))

    obs_c = result['observations_c']
    if obs_c and 'NO SEVERITY' not in obs_c.upper():
        items = re.findall(r'(?:^|\n)\s*[-•\d]+[.)]\s', obs_c)
        if items:
            result['obs_c_count'] = len(items)
        else:
            sentences = [s.strip() for s in obs_c.split('.') if len(s.strip()) > 20]
            result['obs_c_count'] = max(1, len(sentences))

    # Parse statistics
    stats = result['statistics']
    if stats:
        parts = [p.strip() for p in stats.split('/')]
        if len(parts) >= 2:
            try:
                result['prior_word_count'] = int(re.sub(r'[^\d]', '', parts[0]) or 0)
            except ValueError:
                pass
            try:
                result['current_word_count'] = int(re.sub(r'[^\d]', '', parts[1]) or 0)
            except ValueError:
                pass

    return result


if __name__ == '__main__':
    # Test with sample output
    sample = """OBSERVATIONS_A: 1. New risk factor about cybersecurity threats. 2. New risk factor about supply chain disruption.
OBSERVATIONS_B: NONE REMOVED
OBSERVATIONS_C: 1. Climate risk language shifted from "may affect" to "has materially affected" - Prior: "Climate change may affect our operations" Current: "Climate change has materially affected our operations"
OBSERVATIONS_D_COUNT: 15
STATISTICS: 8000 / 8500 / +6.25% / 17 / 19
UNCERTAINTY: CAN_ASSESS
SCORE: 2.5
JUSTIFICATION: Two new material risks were added while none were removed, and one existing risk saw severity escalate. This suggests a modestly deteriorating risk profile."""

    result = parse_agent_output(sample)
    for k, v in result.items():
        print(f"  {k}: {v}")
