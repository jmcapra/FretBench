import chalk from 'chalk';
import { fetchModelPricing } from './openrouter.js';
import { getModel } from './models.js';

interface TestCase {
  id: string;
  tab: string;
  question: string;
}

interface CostEstimate {
  modelId: string;
  modelName: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  promptCostPer1M: number | null;
  completionCostPer1M: number | null;
  estimatedCost: number | null;
  costPerQuestion: number | null;
  numQuestions: number;
}

export async function estimateRunCost(
  modelId: string,
  testCases: TestCase[],
  systemPrompt: string
): Promise<CostEstimate> {
  const model = getModel(modelId);
  const modelName = model?.name ?? modelId;

  const systemPromptTokens = Math.ceil(systemPrompt.length / 4);

  let totalInputTokens = 0;
  for (const tc of testCases) {
    const userPrompt = `${tc.tab}\n\n${tc.question}`;
    const userTokens = Math.ceil(userPrompt.length / 4);
    totalInputTokens += systemPromptTokens + userTokens;
  }

  const totalOutputTokens = testCases.length * 10;

  const pricing = await fetchModelPricing(modelId);

  let estimatedCost: number | null = null;
  let costPerQuestion: number | null = null;

  if (pricing) {
    const inputCost = (totalInputTokens / 1_000_000) * pricing.promptCostPer1M;
    const outputCost =
      (totalOutputTokens / 1_000_000) * pricing.completionCostPer1M;
    estimatedCost = inputCost + outputCost;
    costPerQuestion = estimatedCost / testCases.length;
  }

  return {
    modelId,
    modelName,
    estimatedInputTokens: totalInputTokens,
    estimatedOutputTokens: totalOutputTokens,
    estimatedTotalTokens: totalInputTokens + totalOutputTokens,
    promptCostPer1M: pricing?.promptCostPer1M ?? null,
    completionCostPer1M: pricing?.completionCostPer1M ?? null,
    estimatedCost,
    costPerQuestion,
    numQuestions: testCases.length,
  };
}

export function formatCostEstimate(estimate: CostEstimate): string {
  const lines: string[] = [];

  lines.push(
    chalk.bold(`\nCost Estimate: ${estimate.modelName}`) +
      chalk.dim(` (${estimate.modelId})`)
  );
  lines.push(chalk.dim('─'.repeat(50)));

  lines.push(
    `  Questions:          ${chalk.cyan(estimate.numQuestions.toString())}`
  );
  lines.push(
    `  Est. input tokens:  ${chalk.cyan(estimate.estimatedInputTokens.toLocaleString())}`
  );
  lines.push(
    `  Est. output tokens: ${chalk.cyan(estimate.estimatedOutputTokens.toLocaleString())}`
  );
  lines.push(
    `  Est. total tokens:  ${chalk.cyan(estimate.estimatedTotalTokens.toLocaleString())}`
  );

  if (estimate.promptCostPer1M != null) {
    lines.push(
      `  Input price:        ${chalk.dim('$' + estimate.promptCostPer1M.toFixed(2) + ' / 1M tokens')}`
    );
  }
  if (estimate.completionCostPer1M != null) {
    lines.push(
      `  Output price:       ${chalk.dim('$' + estimate.completionCostPer1M.toFixed(2) + ' / 1M tokens')}`
    );
  }

  lines.push(chalk.dim('─'.repeat(50)));

  if (estimate.estimatedCost != null) {
    lines.push(
      `  ${chalk.bold('Estimated total cost:')}  ${chalk.green('$' + estimate.estimatedCost.toFixed(4))}`
    );
    lines.push(
      `  ${chalk.bold('Cost per question:')}     ${chalk.green('$' + estimate.costPerQuestion!.toFixed(6))}`
    );
  } else {
    lines.push(
      chalk.yellow('  Pricing unavailable — could not fetch model pricing from OpenRouter.')
    );
  }

  lines.push('');
  return lines.join('\n');
}
