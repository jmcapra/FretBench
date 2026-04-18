/**
 * Backfill missing test cases into existing completed runs.
 * When new test cases are added to the dataset, this runs only the
 * missing cases and inserts them into the model's latest completed run.
 */

import chalk from 'chalk';
import type Database from 'better-sqlite3';
import type { TestCase } from './grader.js';
import { grade } from './grader.js';
import { loadTestCases } from './runner.js';
import { getDb, insertRunResult, getRunSummary, getRunTuningBreakdown } from './db.js';
import { CURRENT_SYSTEM_PROMPT, CURRENT_EVAL_CONFIG } from './eval-version.js';
import { sendPrompt } from './openrouter.js';
import { getModel, getApiModelId, getEnabledModels, type ModelEntry } from './models.js';

interface LatestRun {
  id: number;
  model_id: string;
  status: string;
}

function getLatestCompletedRun(db: Database.Database, modelId: string, datasetName: string): LatestRun | undefined {
  return db.prepare(`
    SELECT id, model_id, status FROM runs
    WHERE model_id = ? AND dataset_name = ? AND status = 'completed'
    ORDER BY id DESC LIMIT 1
  `).get(modelId, datasetName) as LatestRun | undefined;
}

function getExistingTestCaseIds(db: Database.Database, runId: number): Set<string> {
  const rows = db.prepare(
    'SELECT test_case_id FROM run_results WHERE run_id = ?'
  ).all(runId) as { test_case_id: string }[];
  return new Set(rows.map(r => r.test_case_id));
}

function assembleUserPrompt(testCase: TestCase): string {
  return `${testCase.tab}\n\n${testCase.question}`;
}

export async function backfillModel(
  modelId: string,
  datasetName: string = 'fretbench-official',
  datasetPath?: string,
  dryRun: boolean = false,
): Promise<void> {
  const model = getModel(modelId);
  if (!model) {
    console.error(chalk.red(`Model not found: ${modelId}`));
    return;
  }

  const db = getDb();
  const run = getLatestCompletedRun(db, modelId, datasetName);
  if (!run) {
    console.log(chalk.yellow(`No completed run found for ${model.name} — use 'run' instead.`));
    return;
  }

  const allCases = loadTestCases(datasetPath);
  const existing = getExistingTestCaseIds(db, run.id);
  const missing = allCases.filter(tc => !existing.has(tc.id));

  if (missing.length === 0) {
    console.log(chalk.green(`${model.name}: run #${run.id} already has all ${allCases.length} cases.`));
    return;
  }

  console.log(chalk.bold(`\nBackfilling ${model.name}`) + chalk.dim(` (${modelId})`));
  console.log(chalk.dim(`Run #${run.id} | ${existing.size} existing + ${missing.length} missing = ${allCases.length} total\n`));

  if (dryRun) {
    console.log(chalk.yellow(`Dry run: would send ${missing.length} cases to ${modelId}`));
    for (const tc of missing) console.log(chalk.dim(`  ${tc.id} — ${tc.question}`));
    return;
  }

  const apiModelId = getApiModelId(model);

  for (let i = 0; i < missing.length; i++) {
    const tc = missing[i];
    const userPrompt = assembleUserPrompt(tc);
    const index = `[${(i + 1).toString().padStart(String(missing.length).length, ' ')}/${missing.length}]`;

    try {
      const result = await sendPrompt(apiModelId, CURRENT_SYSTEM_PROMPT, userPrompt, {
        temperature: CURRENT_EVAL_CONFIG.temperature,
        ...(model.reasoning_effort ? { reasoning: { effort: model.reasoning_effort } } : {}),
      });

      const gradeResult = grade(result.content, tc);

      insertRunResult(db, {
        run_id: run.id,
        test_case_id: tc.id,
        tuning: tc.tuning,
        question: tc.question,
        expected: JSON.stringify(tc.answers),
        strict_spelling: tc.strict_spelling ?? false,
        raw_response: result.content,
        extracted: gradeResult.extracted,
        correct: gradeResult.correct,
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        cost: result.cost,
        latency_ms: result.latencyMs,
        error: null,
        reasoning_content: result.reasoningContent,
      });

      const mark = gradeResult.correct ? chalk.green('✓') : chalk.red('✗');
      const note = gradeResult.extracted ?? '∅';
      console.log(`${index} ${tc.id} ${mark} ${note} (${result.latencyMs}ms)`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      insertRunResult(db, {
        run_id: run.id,
        test_case_id: tc.id,
        tuning: tc.tuning,
        question: tc.question,
        expected: JSON.stringify(tc.answers),
        strict_spelling: tc.strict_spelling ?? false,
        raw_response: null,
        extracted: null,
        correct: false,
        prompt_tokens: null,
        completion_tokens: null,
        cost: null,
        latency_ms: null,
        error: errorMsg,
        reasoning_content: null,
      });

      console.log(`${index} ${tc.id} ${chalk.red('✗ ERROR:')} ${errorMsg}`);
    }
  }

  // Print updated summary
  const summary = getRunSummary(db, run.id);
  const breakdown = getRunTuningBreakdown(db, run.id);

  console.log(chalk.dim('\n' + '─'.repeat(50)));
  if (summary) {
    console.log(chalk.bold(`\n${model.name} — Run #${run.id} (backfilled)`));
    console.log(`  Score: ${chalk.green(summary.score_pct + '%')} (${summary.correct}/${summary.total_cases})`);
    if (summary.total_cost != null) {
      console.log(`  Cost:  ${chalk.cyan('$' + summary.total_cost.toFixed(4))}`);
    }
    console.log(`  Avg latency: ${summary.avg_latency_ms}ms`);
  }

  if (breakdown.length > 0) {
    console.log(chalk.dim('\n  Tuning breakdown:'));
    for (const row of breakdown) {
      console.log(`    ${row.tuning.padEnd(16)} ${row.score_pct}% (${row.correct}/${row.total})`);
    }
  }
  console.log('');
}

export async function backfillAll(
  concurrency: number,
  datasetName: string = 'fretbench-official',
  datasetPath?: string,
  dryRun: boolean = false,
): Promise<void> {
  const models = getEnabledModels();
  const db = getDb();
  const allCases = loadTestCases(datasetPath);

  // Find models that have completed runs with missing cases
  const toBackfill: ModelEntry[] = [];
  for (const model of models) {
    const run = getLatestCompletedRun(db, model.id, datasetName);
    if (!run) continue;
    const existing = getExistingTestCaseIds(db, run.id);
    const missingCount = allCases.filter(tc => !existing.has(tc.id)).length;
    if (missingCount > 0) {
      toBackfill.push(model);
      console.log(chalk.dim(`  ${model.name}: ${missingCount} missing cases in run #${run.id}`));
    }
  }

  if (toBackfill.length === 0) {
    console.log(chalk.green('All runs are up to date.'));
    return;
  }

  console.log(chalk.bold(`\nBackfilling ${toBackfill.length} model(s)\n`));

  // Run sequentially for now (backfill is typically small)
  for (const model of toBackfill) {
    await backfillModel(model.id, datasetName, datasetPath, dryRun);
  }

  console.log(chalk.bold('\nAll backfills complete.\n'));
}
