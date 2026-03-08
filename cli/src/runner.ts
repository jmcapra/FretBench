import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { TestCase } from './grader.js';
import { grade } from './grader.js';
import { getDb, insertRun, updateRunStatus, insertRunResult, getRunSummary, getRunTuningBreakdown } from './db.js';
import { CURRENT_SYSTEM_PROMPT, CURRENT_EVAL_CONFIG, resolveEvalVersion } from './eval-version.js';
import { sendPrompt } from './openrouter.js';
import { estimateRunCost, formatCostEstimate } from './cost.js';
import { getModel, getEnabledModels, getModelsByTier, type ModelEntry } from './models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_CASES_PATH = resolve(__dirname, '../../test-cases/test-cases.json');

export function loadTestCases(): TestCase[] {
  const raw = readFileSync(TEST_CASES_PATH, 'utf-8');
  return JSON.parse(raw) as TestCase[];
}

export function getDatasetVersion(): { sha: string; tag: string | null } {
  const testCasesDir = resolve(__dirname, '../../test-cases');
  const sha = execSync('git rev-parse HEAD', { cwd: testCasesDir, encoding: 'utf-8' }).trim();

  let tag: string | null = null;
  try {
    tag = execSync('git describe --tags --exact-match', { cwd: testCasesDir, encoding: 'utf-8' }).trim();
  } catch {
    // No tag on this commit
  }

  return { sha, tag };
}

function assembleUserPrompt(testCase: TestCase): string {
  return `${testCase.tab}\n\n${testCase.question}`;
}

export async function runModel(
  modelId: string,
  options: { dryRun?: boolean } = {}
): Promise<void> {
  const model = getModel(modelId);
  if (!model) {
    console.error(chalk.red(`Model not found: ${modelId}`));
    process.exit(1);
  }

  const testCases = loadTestCases();

  if (options.dryRun) {
    const estimate = await estimateRunCost(modelId, testCases, CURRENT_SYSTEM_PROMPT);
    console.log(formatCostEstimate(estimate));
    return;
  }

  const db = getDb();
  const evalVersionId = resolveEvalVersion(db);
  const { sha: datasetVersion, tag: datasetTag } = getDatasetVersion();

  const runId = insertRun(db, {
    model_id: modelId,
    eval_version_id: evalVersionId,
    dataset_version: datasetVersion,
    dataset_tag: datasetTag,
    started_at: new Date().toISOString(),
  });

  console.log(chalk.bold(`\nRunning ${model.name}`) + chalk.dim(` (${modelId})`));
  console.log(chalk.dim(`Run #${runId} | ${testCases.length} test cases | eval v${CURRENT_EVAL_CONFIG.version}\n`));

  let correctCount = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const userPrompt = assembleUserPrompt(tc);
    const index = `[${(i + 1).toString().padStart(String(testCases.length).length, ' ')}/${testCases.length}]`;

    try {
      const result = await sendPrompt(modelId, CURRENT_SYSTEM_PROMPT, userPrompt, {
        temperature: CURRENT_EVAL_CONFIG.temperature,
        maxTokens: CURRENT_EVAL_CONFIG.max_tokens,
      });

      const gradeResult = grade(result.content, tc);
      if (gradeResult.correct) correctCount++;

      insertRunResult(db, {
        run_id: runId,
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
      });

      const mark = gradeResult.correct ? chalk.green('✓') : chalk.red('✗');
      const note = gradeResult.extracted ?? '∅';
      console.log(`${index} ${tc.id} ${mark} ${note} (${result.latencyMs}ms)`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      insertRunResult(db, {
        run_id: runId,
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
      });

      console.log(`${index} ${tc.id} ${chalk.red('✗ ERROR:')} ${errorMsg}`);
    }
  }

  const completedAt = new Date().toISOString();
  updateRunStatus(db, runId, 'completed', completedAt);

  // Print summary
  const summary = getRunSummary(db, runId);
  const breakdown = getRunTuningBreakdown(db, runId);

  console.log(chalk.dim('\n' + '─'.repeat(50)));
  if (summary) {
    console.log(chalk.bold(`\n${model.name} — Run #${runId} Summary`));
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

export async function runMultiple(
  models: ModelEntry[],
  concurrency: number,
  dryRun: boolean
): Promise<void> {
  if (models.length === 0) {
    console.log(chalk.yellow('No models to run.'));
    return;
  }

  console.log(chalk.bold(`\nRunning ${models.length} model(s) with concurrency ${concurrency}\n`));

  const queue = [...models];
  const running = new Set<Promise<void>>();

  while (queue.length > 0 || running.size > 0) {
    while (running.size < concurrency && queue.length > 0) {
      const model = queue.shift()!;
      const promise = runModel(model.id, { dryRun })
        .catch((err) => {
          console.error(chalk.red(`\nFailed: ${model.name} — ${err instanceof Error ? err.message : String(err)}`));
        })
        .then(() => {
          running.delete(promise);
        });
      running.add(promise);
    }
    if (running.size > 0) {
      await Promise.race(running);
    }
  }

  console.log(chalk.bold('\nAll runs complete.\n'));
}

export function resolveModels(
  modelArg: string | undefined,
  options: { all?: boolean; tier?: string }
): ModelEntry[] {
  if (options.all) {
    return getEnabledModels();
  }
  if (options.tier) {
    const tier = options.tier as ModelEntry['tier'];
    const models = getModelsByTier(tier).filter((m) => m.enabled);
    if (models.length === 0) {
      console.error(chalk.red(`No enabled models found for tier: ${options.tier}`));
      process.exit(1);
    }
    return models;
  }
  if (modelArg) {
    const model = getModel(modelArg);
    if (!model) {
      console.error(chalk.red(`Model not found: ${modelArg}`));
      process.exit(1);
    }
    return [model];
  }
  console.error(chalk.red('Specify a model ID, --all, or --tier <tier>'));
  process.exit(1);
}
