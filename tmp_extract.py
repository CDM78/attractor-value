import json
with open('/c/Users/charl/attractor-value/data/ai-analyst-pipeline/eval-prompts.json', 'r') as f:
    data = json.load(f)
entry = data['ANALYST-0037']
print(json.dumps(entry, indent=2))
