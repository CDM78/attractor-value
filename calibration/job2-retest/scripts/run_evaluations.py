#!/usr/bin/env python3
"""
Batch runner for Job 2 evaluations.
Processes cases by writing prompts and collecting results.
Designed to be called from CC with sub-agent results fed back in.

Usage:
  python run_evaluations.py --mode stochasticity  # 19 cases × 3 runs
  python run_evaluations.py --mode full            # all 150 cases
  python run_evaluations.py --collect-result CASE_ID RUN_NUM "result text"
"""

import csv, json, os, sys, argparse, re
from parse_results import parse_agent_output

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB2_DIR = os.path.dirname(SCRIPT_DIR)

def load_cases():
    cases = []
    with open(os.path.join(JOB2_DIR, 'selected-cases.csv')) as f:
        reader = csv.DictReader(f)
        for r in reader:
            cases.append(r)
    return cases

def get_progress_file(mode):
    return os.path.join(JOB2_DIR, f'{mode}-progress.json')

def load_progress(mode):
    pf = get_progress_file(mode)
    if os.path.exists(pf):
        return json.load(open(pf))
    return {'results': {}, 'completed': []}

def save_progress(mode, progress):
    with open(get_progress_file(mode), 'w') as f:
        json.dump(progress, f, indent=2)

def collect_result(mode, case_id, run_num, result_text):
    """Save a sub-agent result."""
    progress = load_progress(mode)
    parsed = parse_agent_output(result_text)

    key = f"{case_id}_run{run_num}"
    progress['results'][key] = {
        'case_id': case_id,
        'run': run_num,
        'raw_text': result_text[:5000],  # Truncate for storage
        **parsed,
    }

    save_progress(mode, progress)
    print(f"Saved result for {key}: uncertainty={parsed['uncertainty_rating']}, score={parsed['score']}")

def get_pending(mode, max_runs=3):
    """Get list of cases still needing evaluation."""
    progress = load_progress(mode)
    cases = load_cases()

    if mode == 'stochasticity':
        # First 19 valid cases (skip MDU with 200 words)
        valid = json.load(open(os.path.join(JOB2_DIR, 'stochasticity-valid.json')))
        case_ids = [c['case_id'] for c in valid]
    else:
        case_ids = [c['case_id'] for c in cases]

    pending = []
    for cid in case_ids:
        for run in range(1, max_runs + 1):
            key = f"{cid}_run{run}"
            if key not in progress['results']:
                pending.append((cid, run))

    return pending

def export_stochasticity_csv():
    """Export stochasticity results to CSV."""
    progress = load_progress('stochasticity')
    valid = json.load(open(os.path.join(JOB2_DIR, 'stochasticity-valid.json')))
    cik_map = {c['case_id']: c['cik'] for c in valid}

    csv_path = os.path.join(JOB2_DIR, 'stochasticity-raw.csv')
    with open(csv_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([
            'case_id', 'cik', 'run_number', 'uncertainty_rating', 'score',
            'obs_a_count', 'obs_b_count', 'obs_c_count', 'observations_d_count',
            'current_word_count', 'prior_word_count'
        ])

        for key, r in sorted(progress['results'].items()):
            cid = r['case_id']
            writer.writerow([
                cid, cik_map.get(cid, ''), r['run'],
                r.get('uncertainty_rating', ''),
                r.get('score', ''),
                r.get('obs_a_count', ''),
                r.get('obs_b_count', ''),
                r.get('obs_c_count', ''),
                r.get('observations_d_count', ''),
                r.get('current_word_count', ''),
                r.get('prior_word_count', ''),
            ])

    print(f"Exported {len(progress['results'])} results to {csv_path}")

def export_full_csv():
    """Export full run results to CSV."""
    progress = load_progress('full')
    cases = load_cases()
    case_map = {c['case_id']: c for c in cases}

    csv_path = os.path.join(JOB2_DIR, 'full-results.csv')
    with open(csv_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([
            'case_id', 'ticker', 'cik', 'entry_date', 'outcome_class',
            'forward_return_3yr', 'current_item1a_word_count', 'prior_item1a_word_count',
            'score_run1', 'score_run2', 'score_run3', 'score_median',
            'uncertainty_run1', 'uncertainty_run2', 'uncertainty_run3', 'uncertainty_majority',
            'obs_a_count_run1', 'obs_b_count_run1', 'obs_c_count_run1',
            'obs_a_count_run2', 'obs_b_count_run2', 'obs_c_count_run2',
            'obs_a_count_run3', 'obs_b_count_run3', 'obs_c_count_run3',
            'justification_run1', 'justification_run2', 'justification_run3',
        ])

        for c in cases:
            cid = c['case_id']
            runs = {}
            for run in range(1, 4):
                key = f"{cid}_run{run}"
                runs[run] = progress['results'].get(key, {})

            # Compute median score
            scores = []
            for run in range(1, 4):
                s = runs[run].get('score', '')
                if s and s.lower() not in ('n/a', 'na', ''):
                    try:
                        scores.append(float(s))
                    except ValueError:
                        pass
            score_median = sorted(scores)[len(scores)//2] if scores else ''

            # Majority uncertainty
            uncertainties = [runs[r].get('uncertainty_rating', '') for r in range(1, 4)]
            from collections import Counter
            uc = Counter(u for u in uncertainties if u)
            uncertainty_majority = uc.most_common(1)[0][0] if uc else ''

            writer.writerow([
                cid, c['ticker'], c['cik'], c['entry_date'], c['outcome_class'],
                c['forward_return_3yr'],
                c.get('current_item1a_word_count', ''),
                c.get('prior_item1a_word_count', ''),
                runs[1].get('score', ''), runs[2].get('score', ''), runs[3].get('score', ''),
                score_median,
                runs[1].get('uncertainty_rating', ''),
                runs[2].get('uncertainty_rating', ''),
                runs[3].get('uncertainty_rating', ''),
                uncertainty_majority,
                runs[1].get('obs_a_count', ''), runs[1].get('obs_b_count', ''), runs[1].get('obs_c_count', ''),
                runs[2].get('obs_a_count', ''), runs[2].get('obs_b_count', ''), runs[2].get('obs_c_count', ''),
                runs[3].get('obs_a_count', ''), runs[3].get('obs_b_count', ''), runs[3].get('obs_c_count', ''),
                runs[1].get('justification', '')[:200],
                runs[2].get('justification', '')[:200],
                runs[3].get('justification', '')[:200],
            ])

    print(f"Exported {len(cases)} cases to {csv_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['stochasticity', 'full'])
    parser.add_argument('--collect', nargs=3, metavar=('CASE_ID', 'RUN', 'TEXT'))
    parser.add_argument('--pending', action='store_true')
    parser.add_argument('--export', action='store_true')
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args()

    if args.collect:
        mode = args.mode or 'stochasticity'
        collect_result(mode, args.collect[0], int(args.collect[1]), args.collect[2])
    elif args.pending:
        mode = args.mode or 'stochasticity'
        pending = get_pending(mode)
        print(f"Pending evaluations: {len(pending)}")
        for cid, run in pending[:20]:
            print(f"  {cid} run {run}")
        if len(pending) > 20:
            print(f"  ... and {len(pending)-20} more")
    elif args.export:
        mode = args.mode or 'stochasticity'
        if mode == 'stochasticity':
            export_stochasticity_csv()
        else:
            export_full_csv()
    elif args.status:
        mode = args.mode or 'stochasticity'
        progress = load_progress(mode)
        print(f"Mode: {mode}")
        print(f"Results collected: {len(progress['results'])}")
        pending = get_pending(mode)
        print(f"Pending: {len(pending)}")
    else:
        parser.print_help()
