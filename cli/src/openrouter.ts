import OpenAI from 'openai';

export interface PromptConfig {
  temperature?: number;
  maxTokens?: number;
}

export interface PromptResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
  latencyMs: number;
}

interface ModelPricing {
  promptCostPer1M: number;
  completionCostPer1M: number;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY is not set. Add it to cli/.env or set it as an environment variable.'
      );
    }
    client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
    });
  }
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(baseMs: number): number {
  return baseMs + Math.random() * baseMs * 0.5;
}

export async function sendPrompt(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  config: PromptConfig = {}
): Promise<PromptResult> {
  const { temperature = 0, maxTokens = 64 } = config;
  const api = getClient();

  const maxRetries = 5;
  let attempt = 0;
  let backoffMs = 2000;

  while (true) {
    attempt++;
    const start = Date.now();

    try {
      const response = await api.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
      });

      const latencyMs = Date.now() - start;
      const choice = response.choices?.[0];
      const content = choice?.message?.content?.trim() ?? '';
      const usage = response.usage;

      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;

      // Try to get cost from OpenRouter's extended fields
      let cost: number | null = null;
      const extended = response as unknown as Record<string, unknown>;
      if (extended['x-openrouter-cost'] != null) {
        cost = Number(extended['x-openrouter-cost']);
      } else if (usage) {
        const usageExt = usage as unknown as Record<string, unknown>;
        if (typeof usageExt['cost'] === 'number') {
          cost = usageExt['cost'] as number;
        }
      }

      return { content, promptTokens, completionTokens, cost, latencyMs };
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof OpenAI.APIError && err.status === 429;

      if (isRateLimit && attempt <= maxRetries) {
        const waitMs = jitter(Math.min(backoffMs, 60000));
        await sleep(waitMs);
        backoffMs *= 2;
        continue;
      }
      throw err;
    }
  }
}

const pricingCache = new Map<string, ModelPricing>();

export async function fetchModelPricing(
  modelId: string
): Promise<ModelPricing | null> {
  const cached = pricingCache.get(modelId);
  if (cached) return cached;

  const api = getClient();

  try {
    // OpenRouter's model list endpoint
    const response = await api.models.list();
    const models = response.data as unknown as Array<
      Record<string, unknown> & { id: string }
    >;

    for (const model of models) {
      const pricing = model['pricing'] as
        | Record<string, string>
        | undefined;
      if (pricing) {
        const entry: ModelPricing = {
          promptCostPer1M: parseFloat(pricing['prompt'] ?? '0') * 1_000_000,
          completionCostPer1M:
            parseFloat(pricing['completion'] ?? '0') * 1_000_000,
        };
        pricingCache.set(model.id, entry);
      }
    }

    return pricingCache.get(modelId) ?? null;
  } catch {
    return null;
  }
}
