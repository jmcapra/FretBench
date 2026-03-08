import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../data/fretbench.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;

  if (version < 2) {
    // Drop and recreate all tables for v2 schema (local-only DB, no real data to preserve)
    db.exec(`
      DROP VIEW IF EXISTS run_tuning_breakdown;
      DROP VIEW IF EXISTS run_summary;
      DROP TABLE IF EXISTS run_results;
      DROP TABLE IF EXISTS runs;
      DROP TABLE IF EXISTS eval_versions;

      CREATE TABLE eval_versions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        version         TEXT NOT NULL UNIQUE,
        system_prompt   TEXT NOT NULL,
        system_prompt_hash TEXT NOT NULL,
        grading_logic   TEXT NOT NULL,
        temperature     REAL NOT NULL,
        max_tokens      INTEGER NOT NULL,
        notes           TEXT,
        created_at      TEXT NOT NULL
      );

      CREATE TABLE runs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id        TEXT NOT NULL,
        eval_version_id INTEGER NOT NULL REFERENCES eval_versions(id),
        dataset_name    TEXT NOT NULL DEFAULT 'fretbench-official',
        dataset_version TEXT NOT NULL,
        started_at      TEXT NOT NULL,
        completed_at    TEXT,
        status          TEXT NOT NULL DEFAULT 'running'
      );

      CREATE TABLE run_results (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id          INTEGER NOT NULL REFERENCES runs(id),
        test_case_id    TEXT NOT NULL,
        tuning          TEXT NOT NULL,
        question        TEXT NOT NULL,
        expected        TEXT NOT NULL,
        strict_spelling BOOLEAN NOT NULL DEFAULT 0,
        raw_response    TEXT,
        extracted       TEXT,
        correct         BOOLEAN NOT NULL,
        prompt_tokens   INTEGER,
        completion_tokens INTEGER,
        cost            REAL,
        latency_ms      INTEGER,
        error           TEXT
      );

      CREATE INDEX idx_run_results_run_id ON run_results(run_id);
      CREATE INDEX idx_run_results_test_case ON run_results(test_case_id);
      CREATE INDEX idx_run_results_tuning ON run_results(tuning);
      CREATE INDEX idx_runs_model ON runs(model_id);
      CREATE INDEX idx_runs_eval_version ON runs(eval_version_id);
      CREATE INDEX idx_runs_dataset_name ON runs(dataset_name);

      CREATE VIEW run_summary AS
      SELECT
        r.id AS run_id,
        r.model_id,
        r.eval_version_id,
        r.dataset_name,
        r.dataset_version,
        r.started_at,
        r.completed_at,
        COUNT(rr.id) AS total_cases,
        SUM(rr.correct) AS correct,
        ROUND(100.0 * SUM(rr.correct) / COUNT(rr.id), 2) AS score_pct,
        SUM(rr.prompt_tokens) AS total_prompt_tokens,
        SUM(rr.completion_tokens) AS total_completion_tokens,
        SUM(rr.cost) AS total_cost,
        ROUND(AVG(rr.latency_ms)) AS avg_latency_ms
      FROM runs r
      JOIN run_results rr ON rr.run_id = r.id
      WHERE r.status = 'completed'
      GROUP BY r.id;

      CREATE VIEW run_tuning_breakdown AS
      SELECT
        run_id,
        tuning,
        COUNT(*) AS total,
        SUM(correct) AS correct,
        ROUND(100.0 * SUM(correct) / COUNT(*), 2) AS score_pct
      FROM run_results
      GROUP BY run_id, tuning;

      PRAGMA user_version = 2;
    `);
  }
}

// --- Query helpers ---

export interface EvalVersionRow {
  id: number;
  version: string;
  system_prompt: string;
  system_prompt_hash: string;
  grading_logic: string;
  temperature: number;
  max_tokens: number;
  notes: string | null;
  created_at: string;
}

export function insertEvalVersion(
  db: Database.Database,
  row: Omit<EvalVersionRow, 'id'>
): number {
  const stmt = db.prepare(`
    INSERT INTO eval_versions (version, system_prompt, system_prompt_hash, grading_logic, temperature, max_tokens, notes, created_at)
    VALUES (@version, @system_prompt, @system_prompt_hash, @grading_logic, @temperature, @max_tokens, @notes, @created_at)
  `);
  const result = stmt.run(row);
  return result.lastInsertRowid as number;
}

export function getLatestEvalVersion(db: Database.Database): EvalVersionRow | undefined {
  return db.prepare('SELECT * FROM eval_versions ORDER BY id DESC LIMIT 1').get() as EvalVersionRow | undefined;
}

export interface RunRow {
  id: number;
  model_id: string;
  eval_version_id: number;
  dataset_name: string;
  dataset_version: string;
  started_at: string;
  completed_at: string | null;
  status: string;
}

export function insertRun(
  db: Database.Database,
  row: Omit<RunRow, 'id' | 'completed_at' | 'status'>
): number {
  const stmt = db.prepare(`
    INSERT INTO runs (model_id, eval_version_id, dataset_name, dataset_version, started_at)
    VALUES (@model_id, @eval_version_id, @dataset_name, @dataset_version, @started_at)
  `);
  const result = stmt.run(row);
  return result.lastInsertRowid as number;
}

export function updateRunStatus(
  db: Database.Database,
  runId: number,
  status: 'completed' | 'failed',
  completedAt: string
): void {
  db.prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?')
    .run(status, completedAt, runId);
}

export interface RunResultRow {
  run_id: number;
  test_case_id: string;
  tuning: string;
  question: string;
  expected: string;
  strict_spelling: boolean;
  raw_response: string | null;
  extracted: string | null;
  correct: boolean;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost: number | null;
  latency_ms: number | null;
  error: string | null;
}

export function insertRunResult(
  db: Database.Database,
  row: RunResultRow
): number {
  const stmt = db.prepare(`
    INSERT INTO run_results (run_id, test_case_id, tuning, question, expected, strict_spelling, raw_response, extracted, correct, prompt_tokens, completion_tokens, cost, latency_ms, error)
    VALUES (@run_id, @test_case_id, @tuning, @question, @expected, @strict_spelling, @raw_response, @extracted, @correct, @prompt_tokens, @completion_tokens, @cost, @latency_ms, @error)
  `);
  const result = stmt.run({
    ...row,
    strict_spelling: row.strict_spelling ? 1 : 0,
    correct: row.correct ? 1 : 0,
  });
  return result.lastInsertRowid as number;
}

export interface RunSummaryRow {
  run_id: number;
  model_id: string;
  eval_version_id: number;
  dataset_name: string;
  dataset_version: string;
  started_at: string;
  completed_at: string;
  total_cases: number;
  correct: number;
  score_pct: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost: number;
  avg_latency_ms: number;
}

export function getRunSummary(db: Database.Database, runId: number): RunSummaryRow | undefined {
  return db.prepare('SELECT * FROM run_summary WHERE run_id = ?').get(runId) as RunSummaryRow | undefined;
}

export interface TuningBreakdownRow {
  run_id: number;
  tuning: string;
  total: number;
  correct: number;
  score_pct: number;
}

export function getRunTuningBreakdown(db: Database.Database, runId: number): TuningBreakdownRow[] {
  return db.prepare('SELECT * FROM run_tuning_breakdown WHERE run_id = ?').all(runId) as TuningBreakdownRow[];
}

export interface LeaderboardRow {
  model_id: string;
  run_id: number;
  score_pct: number;
  total_cost: number;
  completed_at: string;
}

export function getLeaderboard(db: Database.Database, datasetName?: string): LeaderboardRow[] {
  const filter = datasetName ?? 'fretbench-official';
  return db.prepare(`
    SELECT rs.model_id, rs.run_id, rs.score_pct, rs.total_cost, rs.completed_at
    FROM run_summary rs
    INNER JOIN (
      SELECT model_id, MAX(run_id) AS latest_run_id
      FROM run_summary
      WHERE dataset_name = ?
      GROUP BY model_id
    ) latest ON rs.run_id = latest.latest_run_id
    ORDER BY rs.score_pct DESC, rs.total_cost ASC
  `).all(filter) as LeaderboardRow[];
}

export interface ModelStatsRow {
  run_id: number;
  score_pct: number;
  total_cost: number;
  started_at: string;
  completed_at: string;
  total_cases: number;
  correct: number;
  avg_latency_ms: number;
}

export function getModelStats(db: Database.Database, modelId: string, datasetName?: string): ModelStatsRow[] {
  const filter = datasetName ?? 'fretbench-official';
  return db.prepare(
    'SELECT * FROM run_summary WHERE model_id = ? AND dataset_name = ? ORDER BY run_id DESC'
  ).all(modelId, filter) as ModelStatsRow[];
}

export interface CompletedResultRow {
  run_id: number;
  model_id: string;
  test_case_id: string;
  tuning: string;
  correct: number;
  score_pct: number;
  total_cost: number;
  completed_at: string;
}

export function getAllCompletedResults(db: Database.Database, datasetName?: string): CompletedResultRow[] {
  const filter = datasetName ?? 'fretbench-official';
  return db.prepare(`
    SELECT rr.run_id, r.model_id, rr.test_case_id, rr.tuning, rr.correct,
           rs.score_pct, rs.total_cost, rs.completed_at
    FROM run_results rr
    JOIN runs r ON r.id = rr.run_id
    JOIN run_summary rs ON rs.run_id = rr.run_id
    WHERE r.status = 'completed' AND r.dataset_name = ?
    ORDER BY rr.run_id, rr.test_case_id
  `).all(filter) as CompletedResultRow[];
}
