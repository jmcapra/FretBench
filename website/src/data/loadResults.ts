import resultsData from './results.json';

// --- Types ---

export interface LeaderboardEntry {
  rank: number;
  model_id: string;
  model_name: string;
  provider: string;
  tier: string;
  score_pct: number;
  total_cost: number | null;
  completed_at: string;
  tuning_scores: Record<string, number>;
}

export interface HardestQuestion {
  test_case_id: string;
  tuning: string;
  success_rate: number;
  total_attempts: number;
}

export interface TuningDifficulty {
  tuning: string;
  avg_score_pct: number;
  total_runs: number;
}

export interface DatasetStats {
  total_cases: number;
  tuning_counts: Record<string, number>;
}

export interface ResultsExport {
  generated_at: string | null;
  eval_version: string | null;
  dataset_version: string | null;
  leaderboard: LeaderboardEntry[];
  hardest_questions: HardestQuestion[];
  tuning_difficulty: TuningDifficulty[];
  dataset_stats: DatasetStats;
}

// --- Typed data ---

const results = resultsData as ResultsExport;

// --- Accessors ---

export function getLeaderboard(): LeaderboardEntry[] {
  return results.leaderboard;
}

export function getTopModels(n: number): LeaderboardEntry[] {
  return results.leaderboard.slice(0, n);
}

export function getHardestQuestions(): HardestQuestion[] {
  return results.hardest_questions;
}

export function getTuningDifficulty(): TuningDifficulty[] {
  return results.tuning_difficulty;
}

export function hasResults(): boolean {
  return results.leaderboard.length > 0;
}

export function getGeneratedAt(): string | null {
  return results.generated_at;
}
