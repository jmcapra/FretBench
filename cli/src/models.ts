import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = resolve(__dirname, '../models.yaml');

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  tier: 'flagship' | 'mid' | 'small';
  enabled: boolean;
}

interface ModelsFile {
  models: ModelEntry[];
}

let _models: ModelEntry[] | null = null;

export function loadModels(): ModelEntry[] {
  if (_models) return _models;
  const raw = readFileSync(MODELS_PATH, 'utf-8');
  const parsed = parse(raw) as ModelsFile;
  _models = parsed.models;
  return _models;
}

export function getModel(id: string): ModelEntry | undefined {
  return loadModels().find((m) => m.id === id);
}

export function getEnabledModels(): ModelEntry[] {
  return loadModels().filter((m) => m.enabled);
}

export function getModelsByTier(tier: ModelEntry['tier']): ModelEntry[] {
  return loadModels().filter((m) => m.tier === tier);
}
