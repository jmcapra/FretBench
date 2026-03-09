/**
 * Re-grade all existing run results using the current grader logic and test cases.
 * Useful after fixing grading bugs or correcting test case answers.
 */

import chalk from 'chalk';
import type Database from 'better-sqlite3';
import { grade, normalizeResponse, type TestCase } from './grader.js';
import { loadTestCases } from './runner.js';
import { getDb } from './db.js';

interface ResultRow {
  id: number;
  run_id: number;
  test_case_id: string;
  raw_response: string | null;
  extracted: string | null;
  correct: number;
}

export function regrade(): void {
  const db = getDb();
  const testCases = loadTestCases();
  const tcMap = new Map<string, TestCase>();
  for (const tc of testCases) {
    tcMap.set(tc.id, tc);
  }

  // Get all results from completed runs
  const rows = db.prepare(`
    SELECT rr.id, rr.run_id, rr.test_case_id, rr.raw_response, rr.extracted, rr.correct
    FROM run_results rr
    JOIN runs r ON r.id = rr.run_id
    WHERE r.status = 'completed'
  `).all() as ResultRow[];

  const updateStmt = db.prepare(`
    UPDATE run_results SET extracted = ?, correct = ?, expected = ? WHERE id = ?
  `);

  let totalRows = 0;
  let flippedToCorrect = 0;
  let flippedToWrong = 0;
  let extractionChanged = 0;
  let skipped = 0;

  const updateAll = db.transaction(() => {
    for (const row of rows) {
      totalRows++;
      const tc = tcMap.get(row.test_case_id);
      if (!tc) {
        skipped++;
        continue;
      }

      if (!row.raw_response) {
        // No response to re-grade; ensure it's marked incorrect
        if (row.correct) {
          updateStmt.run(null, 0, tc.answers.join(', '), row.id);
          flippedToWrong++;
        }
        continue;
      }

      const result = grade(row.raw_response, tc);
      const newCorrect = result.correct ? 1 : 0;
      const oldCorrect = row.correct;

      if (result.extracted !== row.extracted || newCorrect !== oldCorrect) {
        updateStmt.run(result.extracted, newCorrect, tc.answers.join(', '), row.id);

        if (result.extracted !== row.extracted) extractionChanged++;
        if (oldCorrect === 0 && newCorrect === 1) flippedToCorrect++;
        if (oldCorrect === 1 && newCorrect === 0) flippedToWrong++;
      }
    }
  });

  updateAll();

  console.log(chalk.bold('\nRe-grade complete\n'));
  console.log(`  Total rows processed:   ${totalRows}`);
  console.log(`  Skipped (no test case): ${skipped}`);
  console.log(`  Extraction changed:     ${chalk.yellow(String(extractionChanged))}`);
  console.log(`  Flipped wrong → right:  ${chalk.green(String(flippedToCorrect))}`);
  console.log(`  Flipped right → wrong:  ${chalk.red(String(flippedToWrong))}`);
  console.log('');
}
