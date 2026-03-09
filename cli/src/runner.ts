import { readFileSync, statSync } from 'node:fs';
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
import { getModel, getApiModelId, getEnabledModels, getModelsByTier, type ModelEntry } from './models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEST_CASES_PATH = resolve(__dirname, '../../test-cases.json');

export function loadTestCases(path?: string): TestCase[] {
  const filePath = path ? resolve(path) : DEFAULT_TEST_CASES_PATH;
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as TestCase[];
}

export function getDatasetVersion(path?: string): string {
  const filePath = path ? resolve(path) : DEFAULT_TEST_CASES_PATH;

  // Try to get the git SHA for the file
  try {
    const dir = dirname(filePath);
    const sha = execSync(`git log -1 --format=%H -- "${filePath}"`, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (sha) return sha;
  } catch {
    // Not in a git repo or git not available
  }

  // Fallback: use file mtime as ISO date
  const stats = statSync(filePath);
  return stats.mtime.toISOString();
}

function assembleUserPrompt(testCase: TestCase): string {
  return `${testCase.tab}\n\n${testCase.question}`;
}

export interface RunOptions {
  dryRun?: boolean;
  datasetPath?: string;
  datasetName?: string;
}

export async function runModel(
  modelId: string,
  options: RunOptions = {}
): Promise<void> {
  const model = getModel(modelId);
  if (!model) {
    console.error(chalk.red(`Model not found: ${modelId}`));
    process.exit(1);
  }

  const datasetName = options.datasetName ?? 'fretbench-official';
  const testCases = loadTestCases(options.datasetPath);

  if (options.dryRun) {
    const estimate = await estimateRunCost(modelId, testCases, CURRENT_SYSTEM_PROMPT);
    console.log(formatCostEstimate(estimate));
    return;
  }

  const db = getDb();
  const evalVersionId = resolveEvalVersion(db);
  const datasetVersion = getDatasetVersion(options.datasetPath);

  const apiModelId = getApiModelId(model);

  const runId = insertRun(db, {
    model_id: modelId,
    eval_version_id: evalVersionId,
    dataset_name: datasetName,
    dataset_version: datasetVersion,
    started_at: new Date().toISOString(),
    reasoning_effort: model.reasoning_effort ?? null,
  });

  console.log(chalk.bold(`\nRunning ${model.name}`) + chalk.dim(` (${modelId})`));
  console.log(chalk.dim(`Run #${runId} | ${testCases.length} test cases | eval v${CURRENT_EVAL_CONFIG.version} | dataset: ${datasetName}\n`));

  let correctCount = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const userPrompt = assembleUserPrompt(tc);
    const index = `[${(i + 1).toString().padStart(String(testCases.length).length, ' ')}/${testCases.length}]`;

    try {
      const result = await sendPrompt(apiModelId, CURRENT_SYSTEM_PROMPT, userPrompt, {
        temperature: CURRENT_EVAL_CONFIG.temperature,
        ...(model.reasoning_effort ? { reasoning: { effort: model.reasoning_effort } } : {}),
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
        reasoning_content: result.reasoningContent,
      });

      const mark = gradeResult.correct ? chalk.green('\u2713') : chalk.red('\u2717');
      const note = gradeResult.extracted ?? '\u2205';
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
        reasoning_content: null,
      });

      console.log(`${index} ${tc.id} ${chalk.red('\u2717 ERROR:')} ${errorMsg}`);
    }
  }

  const completedAt = new Date().toISOString();
  updateRunStatus(db, runId, 'completed', completedAt);

  // Print summary
  const summary = getRunSummary(db, runId);
  const breakdown = getRunTuningBreakdown(db, runId);

  console.log(chalk.dim('\n' + '\u2500'.repeat(50)));
  if (summary) {
    console.log(chalk.bold(`\n${model.name} \u2014 Run #${runId} Summary`));
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
  dryRun: boolean,
  datasetPath?: string,
  datasetName?: string
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
      const promise = runModel(model.id, { dryRun, datasetPath, datasetName })
        .catch((err) => {
          console.error(chalk.red(`\nFailed: ${model.name} \u2014 ${err instanceof Error ? err.message : String(err)}`));
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
