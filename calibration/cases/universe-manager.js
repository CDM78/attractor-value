// Case Universe Manager
// Builds, partitions, and tracks the case universe for calibration testing.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { createHash } from 'crypto';

const CASES_DIR = resolve(import.meta.dirname);
const DATA_DIR = resolve(import.meta.dirname, '../../data');

function readJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJSON(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ============================================================
// CASE ID GENERATION
// ============================================================

// Deterministic case ID from ticker + entry_date + source
function makeCaseId(ticker, entry_date, source) {
  const hash = createHash('md5').update(`${ticker}|${entry_date}|${source}`).digest('hex').slice(0, 6);
  return `CASE-${ticker}-${entry_date}-${hash}`;
}

// ============================================================
// IMPORT FROM SYSTEMATIC DATASETS
// ============================================================

const SYSTEMATIC_FILES = [
  { file: 'systematic-sp500-crosssection-2013.json', source: 'sp500_cs_2013' },
  { file: 'systematic-sp500-crosssection-2016.json', source: 'sp500_cs_2016' },
  { file: 'systematic-sp500-crosssection.json', source: 'sp500_cs_2019' },
  { file: 'systematic-sp500-crosssection-2022.json', source: 'sp500_cs_2022' },
  { file: 'systematic-sp500-changes.json', source: 'sp500_changes' },
  { file: 'systematic-smallcap.json', source: 'smallcap' },
  { file: 'systematic-adr.json', source: 'adr' },
  { file: 'systematic-multi-entry.json', source: 'multi_entry' },
  { file: 'systematic-fraud.json', source: 'fraud' },
];

/**
 * Import all systematic datasets into the universe.
 * Returns the universe object.
 */
export function importSystematicDatasets() {
  const cases = {};
  const stats = { total: 0, bySource: {}, byOutcome: {}, bySector: {}, byYear: {} };

  for (const { file, source } of SYSTEMATIC_FILES) {
    const path = join(DATA_DIR, file);
    if (!existsSync(path)) {
      console.log(`  Skipping ${file} — not found`);
      continue;
    }

    const dataset = readJSON(path);
    const entries = dataset.cases || [];
    let count = 0;

    for (const c of entries) {
      if (!c.ticker || !c.entry_date) continue;

      const caseId = makeCaseId(c.ticker, c.entry_date, source);

      // Skip duplicates (same ticker+date from different sources)
      if (cases[caseId]) continue;

      const entryYear = c.entry_date.slice(0, 4);

      cases[caseId] = {
        case_id: caseId,
        ticker: c.ticker,
        company_name: c.company || c.company_name || c.ticker,
        entry_date: c.entry_date,
        gics_sector: c.sector || null,
        sic_code: null,
        cik: c.cik || null,
        market_cap_at_entry: null,
        universe_source: source,
        outcome: {
          forward_return_3yr: c.forward_return_3yr,
          sp500_return_3yr: c.sp500_return_3yr,
          alpha_3yr: c.forward_return_3yr != null && c.sp500_return_3yr != null
            ? +(c.forward_return_3yr - c.sp500_return_3yr).toFixed(4)
            : null,
          classification: c.outcome,
        },
        entry_price: c.entry_price || null,
        data_coverage: {},
        data_richness_score: 0,
        partition: null,
      };

      count++;
      stats.byOutcome[c.outcome] = (stats.byOutcome[c.outcome] || 0) + 1;
      if (c.sector) stats.bySector[c.sector] = (stats.bySector[c.sector] || 0) + 1;
      stats.byYear[entryYear] = (stats.byYear[entryYear] || 0) + 1;
    }

    stats.bySource[source] = count;
    stats.total += count;
    console.log(`  Imported ${count} cases from ${file}`);
  }

  const universe = {
    metadata: {
      generated: new Date().toISOString(),
      total_cases: stats.total,
      stats,
    },
    cases,
  };

  writeJSON(join(CASES_DIR, 'universe.json'), universe);
  console.log(`\nUniverse built: ${stats.total} cases`);
  console.log('Outcomes:', JSON.stringify(stats.byOutcome));
  console.log('Sources:', JSON.stringify(stats.bySource));

  return universe;
}

// ============================================================
// PARTITIONING
// ============================================================

/**
 * Deterministic seeded PRNG (xorshift32) for reproducible partitioning.
 */
function seededRandom(seed) {
  let s = seed;
  return function () {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Assign cases to train (40%) / validation (30%) / holdout (30%) partitions.
 * Stratified by outcome, entry year, and sector.
 *
 * Partitions are deterministic given the same universe and seed.
 * Once assigned, partitions are NEVER changed.
 */
export function assignPartitions(seed = 42) {
  const partitionsPath = join(CASES_DIR, 'partitions.json');

  // If partitions already exist, do not overwrite
  if (existsSync(partitionsPath)) {
    console.log('Partitions already assigned — loading existing');
    return readJSON(partitionsPath);
  }

  const universe = readJSON(join(CASES_DIR, 'universe.json'));
  if (!universe) throw new Error('Universe not built — run importSystematicDatasets first');

  const cases = universe.cases;
  const caseIds = Object.keys(cases);

  // Group by stratification key: outcome × year_bucket × sector_bucket
  const strata = {};
  for (const id of caseIds) {
    const c = cases[id];
    const outcome = c.outcome?.classification || 'unknown';
    const year = c.entry_date?.slice(0, 4) || 'unknown';
    // Bucket years into ranges to avoid too-small strata
    const yearBucket = year <= '2014' ? '2013-14' : year <= '2017' ? '2015-17' : year <= '2020' ? '2018-20' : '2021+';
    const sector = c.gics_sector || 'unknown';
    const sectorBucket = sector.length > 20 ? sector.slice(0, 20) : sector;
    const key = `${outcome}|${yearBucket}|${sectorBucket}`;
    if (!strata[key]) strata[key] = [];
    strata[key].push(id);
  }

  const rng = seededRandom(seed);
  const partitions = { training: [], validation: [], holdout: [] };
  const assignments = {};

  for (const [, ids] of Object.entries(strata)) {
    // Shuffle within stratum
    const shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Split 40/30/30
    const n = shuffled.length;
    const trainEnd = Math.round(n * 0.4);
    const valEnd = trainEnd + Math.round(n * 0.3);

    for (let i = 0; i < n; i++) {
      let partition;
      if (i < trainEnd) partition = 'training';
      else if (i < valEnd) partition = 'validation';
      else partition = 'holdout';

      partitions[partition].push(shuffled[i]);
      assignments[shuffled[i]] = partition;
    }
  }

  // Also update universe.json with partition assignments
  for (const [id, partition] of Object.entries(assignments)) {
    if (cases[id]) cases[id].partition = partition;
  }
  writeJSON(join(CASES_DIR, 'universe.json'), universe);

  // Save partition file
  const partitionData = {
    metadata: {
      generated: new Date().toISOString(),
      seed,
      total: caseIds.length,
      training: partitions.training.length,
      validation: partitions.validation.length,
      holdout: partitions.holdout.length,
      strata_count: Object.keys(strata).length,
    },
    assignments,
    partitions,
  };

  writeJSON(partitionsPath, partitionData);

  // Separate holdout outcomes file
  const holdoutOutcomes = {};
  for (const id of partitions.holdout) {
    holdoutOutcomes[id] = cases[id]?.outcome;
  }
  writeJSON(join(CASES_DIR, 'holdout-outcomes.json'), holdoutOutcomes);

  console.log(`\nPartitions assigned (seed=${seed}):`);
  console.log(`  Training:   ${partitions.training.length} (${(100 * partitions.training.length / caseIds.length).toFixed(1)}%)`);
  console.log(`  Validation: ${partitions.validation.length} (${(100 * partitions.validation.length / caseIds.length).toFixed(1)}%)`);
  console.log(`  Holdout:    ${partitions.holdout.length} (${(100 * partitions.holdout.length / caseIds.length).toFixed(1)}%)`);

  return partitionData;
}

// ============================================================
// DATA RICHNESS SCORING
// ============================================================

// Weight each data type by information value
const RICHNESS_WEIGHTS = {
  '10k_risk_factors': 1.5,
  '10k_mda': 1.5,
  '10q_mda': 1.0,
  'earnings_transcript': 2.0,
  'patents': 0.5,
  'news': 0.5,
  'short_interest': 0.5,
  'form4': 0.5,
  'sec_comment_letters': 1.0,
  'government_contracts': 0.5,
  'court_cases': 0.5,
  'reddit_mentions': 0.3,
  'proxy': 0.5,
  'discovered': 0.5,
};

const MAX_RICHNESS = 10.0;

/**
 * Compute data richness score for a case based on what's in the warehouse.
 */
export function computeRichnessScore(dataCoverage) {
  let raw = 0;
  for (const [type, info] of Object.entries(dataCoverage)) {
    const weight = RICHNESS_WEIGHTS[type] || 0.3;
    const count = info.count || info.quarters_available || info.years_available || 0;
    // Diminishing returns: first instance worth full weight, each additional worth less
    const contribution = weight * Math.min(count, 10) / 10 * weight;
    raw += Math.min(contribution, weight);
  }

  // Normalize to 0-10
  const maxPossible = Object.values(RICHNESS_WEIGHTS).reduce((a, b) => a + b, 0);
  return Math.min(MAX_RICHNESS, +(raw / maxPossible * MAX_RICHNESS).toFixed(1));
}

/**
 * Update data coverage for a case from warehouse coverage matrix.
 */
export function updateCaseCoverage(caseId, warehouseCoverage) {
  const universe = readJSON(join(CASES_DIR, 'universe.json'));
  if (!universe || !universe.cases[caseId]) return;

  universe.cases[caseId].data_coverage = warehouseCoverage;
  universe.cases[caseId].data_richness_score = computeRichnessScore(warehouseCoverage);

  writeJSON(join(CASES_DIR, 'universe.json'), universe);
}

// ============================================================
// QUERIES
// ============================================================

/**
 * Get cases by partition.
 */
export function getCasesByPartition(partition) {
  const universe = readJSON(join(CASES_DIR, 'universe.json'));
  if (!universe) return [];
  return Object.values(universe.cases).filter(c => c.partition === partition);
}

/**
 * Get cases by outcome.
 */
export function getCasesByOutcome(outcome) {
  const universe = readJSON(join(CASES_DIR, 'universe.json'));
  if (!universe) return [];
  return Object.values(universe.cases).filter(c => c.outcome?.classification === outcome);
}

/**
 * Get all case IDs.
 */
export function getAllCaseIds() {
  const universe = readJSON(join(CASES_DIR, 'universe.json'));
  if (!universe) return [];
  return Object.keys(universe.cases);
}

/**
 * Get universe stats.
 */
export function getUniverseStats() {
  const universe = readJSON(join(CASES_DIR, 'universe.json'));
  if (!universe) return null;
  return universe.metadata;
}

/**
 * Generate coverage report.
 */
export function generateCoverageReport() {
  const universe = readJSON(join(CASES_DIR, 'universe.json'));
  if (!universe) return null;

  const cases = Object.values(universe.cases);
  const report = {
    total_cases: cases.length,
    by_partition: {},
    by_outcome: {},
    by_source: {},
    by_year: {},
    richness_distribution: { '0-2': 0, '2-4': 0, '4-6': 0, '6-8': 0, '8-10': 0 },
    data_type_coverage: {},
  };

  for (const c of cases) {
    // Partition
    const p = c.partition || 'unassigned';
    report.by_partition[p] = (report.by_partition[p] || 0) + 1;

    // Outcome
    const o = c.outcome?.classification || 'unknown';
    report.by_outcome[o] = (report.by_outcome[o] || 0) + 1;

    // Source
    report.by_source[c.universe_source] = (report.by_source[c.universe_source] || 0) + 1;

    // Year
    const year = c.entry_date?.slice(0, 4) || 'unknown';
    report.by_year[year] = (report.by_year[year] || 0) + 1;

    // Richness
    const score = c.data_richness_score || 0;
    if (score < 2) report.richness_distribution['0-2']++;
    else if (score < 4) report.richness_distribution['2-4']++;
    else if (score < 6) report.richness_distribution['4-6']++;
    else if (score < 8) report.richness_distribution['6-8']++;
    else report.richness_distribution['8-10']++;

    // Data type coverage
    for (const type of Object.keys(c.data_coverage || {})) {
      report.data_type_coverage[type] = (report.data_type_coverage[type] || 0) + 1;
    }
  }

  writeJSON(join(CASES_DIR, 'coverage-report.json'), report);
  return report;
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  importSystematicDatasets,
  assignPartitions,
  computeRichnessScore,
  updateCaseCoverage,
  getCasesByPartition,
  getCasesByOutcome,
  getAllCaseIds,
  getUniverseStats,
  generateCoverageReport,
  makeCaseId,
};
