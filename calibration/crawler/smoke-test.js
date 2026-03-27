// Discovery Crawler — Smoke Test
// Runs Phase 1 (risk factor analysis) → Phase 2 (data routing) → Phase 3 (enriched assessment)
// for first 5 selected cases.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { fetchAllRequests } from './data-router.js';
import { ensureCikCache, getCikForTicker } from '../warehouse/connectors/shared.js';

const CALIBRATION_ROOT = resolve(import.meta.dirname, '..');
const CASES_PATH = join(CALIBRATION_ROOT, 'tests', 'job2-cases', 'selected-cases.json');
const COMPANIES_DIR = join(CALIBRATION_ROOT, 'warehouse', 'companies');
const RESULTS_PATH = join(import.meta.dirname, 'smoke-test-results.json');

// ============================================================
// HELPERS
// ============================================================

function loadMeta(ticker) {
  const path = join(COMPANIES_DIR, ticker, 'meta.json');
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function findRiskFactorsFile(ticker, filingDate) {
  const dir = join(COMPANIES_DIR, ticker, 'filings', '10-K');
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir);

  // Try exact match with FY suffix first
  const fyMatches = files.filter(f => f.startsWith(filingDate) && f.includes('FY'));
  for (const f of fyMatches) {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    if (data.data_type === '10k_risk_factors') return data;
  }

  // Try exact match without suffix
  const exactMatch = files.find(f => f === `${filingDate}.json`);
  if (exactMatch) {
    const data = JSON.parse(readFileSync(join(dir, exactMatch), 'utf-8'));
    if (data.data_type === '10k_risk_factors') return data;
  }

  // Fallback: any file with this date
  for (const f of files) {
    if (!f.startsWith(filingDate)) continue;
    const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    if (data.data_type === '10k_risk_factors') return data;
  }

  return null;
}

// ============================================================
// PHASE 1: Risk Factor Analysis (inline, no sub-agent)
// ============================================================

function analyzeRiskFactors(currentText, priorText, sector) {
  // Heuristic analysis of risk factor changes
  const currentLen = currentText.length;
  const priorLen = priorText.length;
  const lengthChange = (currentLen - priorLen) / priorLen;

  // Count risk-related keywords
  const escalationWords = [
    'significant', 'material', 'substantial', 'adverse', 'critical',
    'severe', 'unprecedented', 'uncertain', 'volatile', 'impair',
    'decline', 'deteriorat', 'litigation', 'regulatory', 'default',
    'bankruptcy', 'restructur', 'goodwill impairment', 'going concern',
  ];

  const countKeywords = (text) => {
    let count = 0;
    const lower = text.toLowerCase();
    for (const word of escalationWords) {
      const regex = new RegExp(word, 'gi');
      const matches = lower.match(regex);
      count += matches ? matches.length : 0;
    }
    return count;
  };

  const currentKeywords = countKeywords(currentText);
  const priorKeywords = countKeywords(priorText);
  const keywordChange = priorKeywords > 0 ? (currentKeywords - priorKeywords) / priorKeywords : 0;

  // Check for new paragraphs (proxy for new risks)
  const currentParas = currentText.split(/\n\n+/).length;
  const priorParas = priorText.split(/\n\n+/).length;
  const newParas = currentParas - priorParas;

  // Determine trajectory
  let trajectory = 'stable';
  let confidence = 'medium';

  if (lengthChange > 0.20 || keywordChange > 0.25 || newParas > 5) {
    trajectory = 'deteriorating';
    if (lengthChange > 0.35 && keywordChange > 0.30) confidence = 'high';
  } else if (lengthChange < -0.15 && keywordChange < -0.10) {
    trajectory = 'stable'; // improving but we only have stable/deteriorating in phase 1
    confidence = 'medium';
  } else {
    confidence = Math.abs(lengthChange) < 0.05 ? 'high' : 'medium';
  }

  // Generate information requests based on what would help
  const requests = [];

  requests.push({
    type: 'SEC_FILING',
    query: 'material event',
    reason: 'Recent 8-K filings would reveal material events not yet in the 10-K',
    expected_impact: 'HIGH',
  });

  requests.push({
    type: 'INSIDER_TRADING',
    query: 'insider transactions',
    reason: 'Net insider buying/selling signals management confidence in the business',
    expected_impact: 'HIGH',
  });

  requests.push({
    type: 'MANAGEMENT',
    query: 'executive compensation and changes',
    reason: 'Executive turnover or compensation changes may indicate instability',
    expected_impact: 'MEDIUM',
  });

  requests.push({
    type: 'CUSTOMER_CONCENTRATION',
    query: 'customer concentration risk',
    reason: 'High customer concentration amplifies revenue risk',
    expected_impact: 'MEDIUM',
  });

  if (trajectory === 'deteriorating') {
    requests.push({
      type: 'SEC_FILING',
      query: 'restructuring impairment',
      reason: 'Deteriorating trajectory may have triggered restructuring events',
      expected_impact: 'HIGH',
    });
  }

  return {
    trajectory,
    confidence,
    information_requests: requests.slice(0, 5),
    _analysis_metadata: {
      current_length: currentLen,
      prior_length: priorLen,
      length_change_pct: (lengthChange * 100).toFixed(1),
      current_keywords: currentKeywords,
      prior_keywords: priorKeywords,
      keyword_change_pct: (keywordChange * 100).toFixed(1),
      new_paragraphs: newParas,
    },
  };
}

// ============================================================
// PHASE 3: Enriched Assessment (inline)
// ============================================================

function enrichedAssessment(phase1Result, phase2Results, ticker) {
  const { trajectory: initialTrajectory, confidence: initialConfidence } = phase1Result;

  // Analyze phase 2 data for trajectory adjustments
  let trajectoryAdjust = 0; // negative = deteriorating, positive = improving
  let confidenceBoost = false;
  let mostImpactful = 'SEC_FILING';
  let maxImpact = 0;

  for (const r of phase2Results) {
    if (!r.data_found) continue;

    if (r.request_type === 'INSIDER_TRADING') {
      if (r.summary.includes('net selling')) {
        trajectoryAdjust -= 1;
        if (Math.abs(trajectoryAdjust) > maxImpact) {
          maxImpact = Math.abs(trajectoryAdjust);
          mostImpactful = 'INSIDER_TRADING';
        }
      } else if (r.summary.includes('net buying')) {
        trajectoryAdjust += 1;
        if (Math.abs(trajectoryAdjust) > maxImpact) {
          maxImpact = Math.abs(trajectoryAdjust);
          mostImpactful = 'INSIDER_TRADING';
        }
      }
      confidenceBoost = true;
    }

    if (r.request_type === 'SEC_FILING') {
      // More 8-Ks generally means more events to monitor
      const match = r.summary.match(/Found (\d+) 8-K/);
      if (match) {
        const count = parseInt(match[1]);
        if (count > 20) {
          trajectoryAdjust -= 0.5;
        }
      }
    }

    if (r.request_type === 'MANAGEMENT') {
      if (r.summary.includes('Executive changes detected')) {
        trajectoryAdjust -= 0.5;
        if (Math.abs(trajectoryAdjust) > maxImpact) {
          maxImpact = Math.abs(trajectoryAdjust);
          mostImpactful = 'MANAGEMENT';
        }
      }
    }

    if (r.request_type === 'CUSTOMER_CONCENTRATION') {
      if (r.data_found) {
        // Concentration found - slight negative
        trajectoryAdjust -= 0.25;
      }
    }
  }

  // Determine final trajectory
  let finalTrajectory = initialTrajectory;
  if (trajectoryAdjust <= -1.5) {
    finalTrajectory = 'deteriorating';
  } else if (trajectoryAdjust >= 1.5) {
    finalTrajectory = 'improving';
  } else if (initialTrajectory === 'deteriorating' && trajectoryAdjust >= 1) {
    finalTrajectory = 'stable';
  }

  // Determine confidence
  let finalConfidence = initialConfidence;
  const dataSourcesFound = phase2Results.filter(r => r.data_found).length;
  if (dataSourcesFound >= 3 && initialConfidence === 'low') finalConfidence = 'medium';
  if (dataSourcesFound >= 4 && initialConfidence === 'medium') finalConfidence = 'high';
  if (dataSourcesFound === 0) finalConfidence = 'low';

  const changed = finalTrajectory !== initialTrajectory;

  // Generate key insight
  let keyInsight;
  if (changed) {
    keyInsight = `Supplementary data shifted trajectory from ${initialTrajectory} to ${finalTrajectory}, primarily driven by ${mostImpactful.toLowerCase().replace('_', ' ')} signals.`;
  } else if (confidenceBoost) {
    keyInsight = `Additional data confirms ${finalTrajectory} trajectory with increased confidence from ${mostImpactful.toLowerCase().replace('_', ' ')} analysis.`;
  } else {
    keyInsight = `Limited supplementary data available; maintaining ${finalTrajectory} assessment at ${finalConfidence} confidence.`;
  }

  return {
    trajectory: finalTrajectory,
    confidence: finalConfidence,
    most_impactful_source: mostImpactful,
    classification_changed: changed,
    key_insight: keyInsight,
  };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('=== Discovery Crawler Smoke Test ===\n');

  // Load cases
  const allCases = JSON.parse(readFileSync(CASES_PATH, 'utf-8'));
  const cases = allCases.slice(0, 5);
  console.log(`Loaded ${cases.length} cases for testing.\n`);

  // Initialize CIK cache
  await ensureCikCache();

  const results = [];

  for (const testCase of cases) {
    const { ticker, entry_date, outcome, current_filing_date, prior_filing_date, case_id } = testCase;
    console.log(`\n--- ${ticker} (${outcome}) entry=${entry_date} ---`);

    const meta = loadMeta(ticker);
    const sector = meta.gics_sector || 'Unknown';
    const cik = meta.cik || getCikForTicker(ticker);

    // Load filing data
    const currentFiling = findRiskFactorsFile(ticker, current_filing_date);
    const priorFiling = findRiskFactorsFile(ticker, prior_filing_date);

    if (!currentFiling || !priorFiling) {
      console.log(`  SKIP: Missing filings (current=${!!currentFiling}, prior=${!!priorFiling})`);
      results.push({
        case_id,
        ticker,
        outcome,
        status: 'SKIPPED',
        reason: `Missing filings: current=${!!currentFiling}, prior=${!!priorFiling}`,
      });
      continue;
    }

    console.log(`  Current filing: ${currentFiling.publication_date} (${currentFiling.content.length} chars)`);
    console.log(`  Prior filing: ${priorFiling.publication_date} (${priorFiling.content.length} chars)`);

    // PHASE 1: Risk factor analysis
    console.log('  Phase 1: Analyzing risk factors...');
    const phase1 = analyzeRiskFactors(currentFiling.content, priorFiling.content, sector);
    console.log(`  Phase 1 result: trajectory=${phase1.trajectory}, confidence=${phase1.confidence}`);
    console.log(`  Phase 1 requests: ${phase1.information_requests.length} information requests`);

    // PHASE 2: Data routing
    console.log('  Phase 2: Fetching supplementary data...');
    let phase2;
    try {
      phase2 = await fetchAllRequests(
        phase1.information_requests,
        ticker,
        cik,
        entry_date,
        currentFiling.content
      );
      const found = phase2.filter(r => r.data_found).length;
      console.log(`  Phase 2 result: ${found}/${phase2.length} data sources returned data`);
    } catch (err) {
      console.error(`  Phase 2 ERROR: ${err.message}`);
      phase2 = phase1.information_requests.map(r => ({
        request_type: r.type,
        data_found: false,
        summary: `Fetch failed: ${err.message}`,
        raw_data_size: '0',
      }));
    }

    // PHASE 3: Enriched assessment
    console.log('  Phase 3: Producing enriched assessment...');
    const phase3 = enrichedAssessment(phase1, phase2, ticker);
    console.log(`  Phase 3 result: trajectory=${phase3.trajectory}, confidence=${phase3.confidence}, changed=${phase3.classification_changed}`);
    console.log(`  Key insight: ${phase3.key_insight}`);

    results.push({
      case_id,
      ticker,
      sector,
      outcome,
      entry_date,
      status: 'COMPLETE',
      phase1: {
        trajectory: phase1.trajectory,
        confidence: phase1.confidence,
        information_requests: phase1.information_requests,
        analysis_metadata: phase1._analysis_metadata,
      },
      phase2: phase2.map(r => ({
        request_type: r.request_type,
        data_found: r.data_found,
        summary: r.summary.substring(0, 500),
      })),
      phase3: phase3,
    });
  }

  // Save results
  const output = {
    run_date: new Date().toISOString(),
    cases_tested: results.length,
    cases_complete: results.filter(r => r.status === 'COMPLETE').length,
    cases_skipped: results.filter(r => r.status === 'SKIPPED').length,
    results,
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));
  console.log(`\n=== Results saved to ${RESULTS_PATH} ===`);

  // Summary
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    if (r.status === 'SKIPPED') {
      console.log(`  ${r.ticker}: SKIPPED - ${r.reason}`);
    } else {
      console.log(`  ${r.ticker} (${r.outcome}): phase1=${r.phase1.trajectory}/${r.phase1.confidence} → phase3=${r.phase3.trajectory}/${r.phase3.confidence} changed=${r.phase3.classification_changed}`);
    }
  }

  return output;
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
