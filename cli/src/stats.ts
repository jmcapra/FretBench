import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type Database from 'better-sqlite3';
import { getLeaderboard, getModelStats, getRunTuningBreakdown, getAllCompletedResults, getLatestEvalVersion } from './db.js';
import { getModel, loadModels } from './models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Leaderboard ---

export function showLeaderboard(db: Database.Database, datasetName?: string): void {
  const rows = getLeaderboard(db, datasetName);

  if (rows.length === 0) {
    console.log(chalk.yellow('No completed runs yet.'));
    return;
  }

  console.log(chalk.bold('\n  FretBench Leaderboard\n'));

  const header = `  ${pad('Rank', 6)}${pad('Model', 28)}${pad('Provider', 12)}${pad('Score', 10)}${pad('Cost', 10)}Last Run`;
  console.log(chalk.dim(header));
  console.log(chalk.dim('  ' + '\u2500'.repeat(86)));

  rows.forEach((row, i) => {
    const rank = String(i + 1);
    const model = getModel(row.model_id);
    const name = model?.name ?? row.model_id;
    const provider = model?.provider ?? '\u2014';
    const score = row.score_pct + '%';
    const cost = row.total_cost != null ? '$' + row.total_cost.toFixed(4) : '\u2014';
    const date = row.completed_at ? row.completed_at.slice(0, 10) : '\u2014';

    const scoreColor = row.score_pct >= 80 ? chalk.green : row.score_pct >= 50 ? chalk.yellow : chalk.red;

    console.log(
      `  ${pad(rank, 6)}${pad(name, 28)}${pad(provider, 12)}${pad(scoreColor(score), 10 + (scoreColor(score).length - score.length))}${pad(cost, 10)}${date}`
    );
  });

  console.log('');
}

// --- Model Stats ---

export function showModelStats(db: Database.Database, modelId: string, datasetName?: string): void {
  const model = getModel(modelId);
  const displayName = model?.name ?? modelId;
  const runs = getModelStats(db, modelId, datasetName);

  if (runs.length === 0) {
    console.log(chalk.yellow(`No completed runs for ${displayName}.`));
    return;
  }

  console.log(chalk.bold(`\n  ${displayName} \u2014 ${runs.length} run(s)\n`));

  // Summary of all runs
  const scores = runs.map((r) => r.score_pct);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const best = Math.max(...scores);
  const worst = Math.min(...scores);

  console.log(`  Latest:  ${chalk.green(runs[0].score_pct + '%')} (${runs[0].correct}/${runs[0].total_cases})`);
  if (runs.length > 1) {
    console.log(`  Mean:    ${mean.toFixed(2)}%`);
    console.log(`  Best:    ${best}%  |  Worst: ${worst}%`);
  }
  if (runs[0].avg_latency_ms != null) {
    console.log(`  Avg latency: ${runs[0].avg_latency_ms}ms`);
  }

  // Latest run tuning breakdown
  const breakdown = getRunTuningBreakdown(db, runs[0].run_id);
  if (breakdown.length > 0) {
    console.log(chalk.dim('\n  Tuning breakdown (latest run):'));
    for (const row of breakdown) {
      console.log(`    ${row.tuning.padEnd(16)} ${row.score_pct}% (${row.correct}/${row.total})`);
    }
  }

  // Natural vs accidental analysis (latest run)
  const resultRows = db.prepare(`
    SELECT extracted, correct FROM run_results WHERE run_id = ?
  `).all(runs[0].run_id) as { extracted: string | null; correct: number }[];

  let naturalCorrect = 0, naturalTotal = 0;
  let accidentalCorrect = 0, accidentalTotal = 0;

  for (const r of resultRows) {
    if (!r.extracted) continue;
    const isAccidental = r.extracted.length > 1 && (r.extracted.endsWith('#') || r.extracted.endsWith('b'));
    if (isAccidental) {
      accidentalTotal++;
      if (r.correct) accidentalCorrect++;
    } else {
      naturalTotal++;
      if (r.correct) naturalCorrect++;
    }
  }

  if (naturalTotal > 0 || accidentalTotal > 0) {
    console.log(chalk.dim('\n  Note type breakdown (latest run):'));
    if (naturalTotal > 0) {
      const pct = ((naturalCorrect / naturalTotal) * 100).toFixed(1);
      console.log(`    Natural      ${pct}% (${naturalCorrect}/${naturalTotal})`);
    }
    if (accidentalTotal > 0) {
      const pct = ((accidentalCorrect / accidentalTotal) * 100).toFixed(1);
      console.log(`    Accidental   ${pct}% (${accidentalCorrect}/${accidentalTotal})`);
    }
  }

  // Run history
  if (runs.length > 1) {
    console.log(chalk.dim('\n  Run history:'));
    for (const r of runs) {
      const cost = r.total_cost != null ? '$' + r.total_cost.toFixed(4) : '\u2014';
      const date = r.completed_at ? r.completed_at.slice(0, 10) : '\u2014';
      console.log(`    #${String(r.run_id).padEnd(4)} ${date}  ${r.score_pct}%  ${cost}`);
    }
  }

  console.log('');
}

// --- Export ---

export interface ResultsExport {
  generated_at: string;
  eval_version: string | null;
  dataset_version: string | null;
  leaderboard: LeaderboardEntry[];
  hardest_questions: HardestQuestion[];
  tuning_difficulty: TuningDifficulty[];
  dataset_stats: DatasetStats;
}

interface LeaderboardEntry {
  rank: number;
  model_id: string;
  model_name: string;
  provider: string;
  tier: string;
  open_weight: boolean;
  score_pct: number;
  total_cost: number | null;
  completed_at: string;
  tuning_scores: Record<string, number>;
}

interface HardestQuestion {
  test_case_id: string;
  tuning: string;
  success_rate: number;
  total_attempts: number;
}

interface TuningDifficulty {
  tuning: string;
  avg_score_pct: number;
  total_runs: number;
}

interface DatasetStats {
  total_cases: number;
  tuning_counts: Record<string, number>;
}

export function exportResults(db: Database.Database, datasetName?: string): void {
  const leaderboardRows = getLeaderboard(db, datasetName);
  const allResults = getAllCompletedResults(db, datasetName);
  const evalVersion = getLatestEvalVersion(db);

  // Build leaderboard entries with tuning scores
  const leaderboard: LeaderboardEntry[] = leaderboardRows.map((row, i) => {
    const model = getModel(row.model_id);
    const breakdown = getRunTuningBreakdown(db, row.run_id);
    const tuningScores: Record<string, number> = {};
    for (const b of breakdown) {
      tuningScores[b.tuning] = b.score_pct;
    }

    return {
      rank: i + 1,
      model_id: row.model_id,
      model_name: model?.name ?? row.model_id,
      provider: model?.provider ?? 'Unknown',
      tier: model?.tier ?? 'unknown',
      open_weight: model?.open_weight ?? false,
      score_pct: row.score_pct,
      total_cost: row.total_cost,
      completed_at: row.completed_at,
      tuning_scores: tuningScores,
    };
  });

  // Hardest questions: lowest success rate across latest runs
  const questionStats = new Map<string, { correct: number; total: number; tuning: string }>();
  const latestRunIds = new Set(leaderboardRows.map((r) => r.run_id));

  for (const r of allResults) {
    if (!latestRunIds.has(r.run_id)) continue;
    const existing = questionStats.get(r.test_case_id) ?? { correct: 0, total: 0, tuning: r.tuning };
    existing.total++;
    if (r.correct) existing.correct++;
    questionStats.set(r.test_case_id, existing);
  }

  const hardest_questions: HardestQuestion[] = [...questionStats.entries()]
    .map(([id, s]) => ({
      test_case_id: id,
      tuning: s.tuning,
      success_rate: s.total > 0 ? Math.round((s.correct / s.total) * 10000) / 100 : 0,
      total_attempts: s.total,
    }))
    .sort((a, b) => a.success_rate - b.success_rate)
    .slice(0, 10);

  // Tuning difficulty: avg score per tuning across latest runs
  const tuningAgg = new Map<string, { totalScore: number; count: number }>();
  for (const row of leaderboardRows) {
    const breakdown = getRunTuningBreakdown(db, row.run_id);
    for (const b of breakdown) {
      const existing = tuningAgg.get(b.tuning) ?? { totalScore: 0, count: 0 };
      existing.totalScore += b.score_pct;
      existing.count++;
      tuningAgg.set(b.tuning, existing);
    }
  }

  const tuning_difficulty: TuningDifficulty[] = [...tuningAgg.entries()]
    .map(([tuning, agg]) => ({
      tuning,
      avg_score_pct: Math.round((agg.totalScore / agg.count) * 100) / 100,
      total_runs: agg.count,
    }))
    .sort((a, b) => a.avg_score_pct - b.avg_score_pct);

  // Dataset stats from test case results
  const tuningCounts: Record<string, number> = {};
  for (const [, s] of questionStats) {
    tuningCounts[s.tuning] = (tuningCounts[s.tuning] ?? 0) + 1;
  }

  // If no results, load model registry to get total cases count
  const totalCases = questionStats.size || 182;

  // Get dataset version from latest run
  let datasetVersion: string | null = null;
  if (leaderboardRows.length > 0) {
    const latestRun = db.prepare('SELECT dataset_version FROM runs WHERE id = ?')
      .get(leaderboardRows[0].run_id) as { dataset_version: string } | undefined;
    datasetVersion = latestRun?.dataset_version ?? null;
  }

  const exportData: ResultsExport = {
    generated_at: new Date().toISOString(),
    eval_version: evalVersion?.version ?? null,
    dataset_version: datasetVersion,
    leaderboard,
    hardest_questions,
    tuning_difficulty,
    dataset_stats: {
      total_cases: totalCases,
      tuning_counts: tuningCounts,
    },
  };

  const outputPath = resolve(__dirname, '../../website/src/data/results.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(exportData, null, 2) + '\n');

  console.log(chalk.green(`\nExported results to ${outputPath}`));
  console.log(`  ${leaderboard.length} models on leaderboard`);
  console.log(`  ${hardest_questions.length} hardest questions`);
  console.log(`  ${tuning_difficulty.length} tuning breakdowns`);
  console.log('');
}

// --- Show Models ---

export function showModels(): void {
  const models = loadModels();

  console.log(chalk.bold('\n  Registered Models\n'));

  const tiers = ['flagship', 'mid', 'small'] as const;

  for (const tier of tiers) {
    const tierModels = models.filter((m) => m.tier === tier);
    if (tierModels.length === 0) continue;

    console.log(chalk.dim(`  \u2500\u2500 ${tier.toUpperCase()} \u2500\u2500`));
    for (const m of tierModels) {
      const status = m.enabled ? chalk.green('\u25cf') : chalk.dim('\u25cb');
      const owBadge = m.open_weight ? chalk.cyan(' OW') : '';
      console.log(`  ${status} ${pad(m.name, 24)}${pad(m.provider, 12)}${chalk.dim(m.id)}${owBadge}`);
    }
    console.log('');
  }
}

// --- Helpers ---

function pad(s: string, width: number): string {
  return s.length >= width ? s + ' ' : s + ' '.repeat(width - s.length);
}
