#!/usr/bin/env tsx

import 'dotenv/config';
import { Command } from 'commander';
import { runModel, runMultiple, resolveModels } from './runner.js';
import { getDb } from './db.js';
import { showLeaderboard, showModelStats, exportResults, showModels } from './stats.js';
import { regrade } from './regrade.js';

const program = new Command();

program
  .name('fretbench')
  .description('FretBench \u2014 Guitar fretboard note-name reasoning benchmark for LLMs')
  .version('1.0.0');

program
  .command('run [model]')
  .description('Run benchmark for a model or all enabled models')
  .option('--all', 'Run all enabled models')
  .option('--tier <tier>', 'Run all models in a tier (flagship, mid, small)')
  .option('--dry-run', 'Show cost estimate without executing')
  .option('--concurrency <n>', 'Max concurrent model runs', '3')
  .option('--dataset <path>', 'Path to test cases JSON file (default: ./test-cases.json)')
  .option('--dataset-name <name>', 'Suite identifier (default: fretbench-official)')
  .action(async (model, options) => {
    const models = resolveModels(model, options);
    const concurrency = parseInt(options.concurrency, 10);
    const dryRun = options.dryRun ?? false;
    const datasetPath = options.dataset as string | undefined;
    const datasetName = options.datasetName as string | undefined;

    if (models.length === 1) {
      await runModel(models[0].id, { dryRun, datasetPath, datasetName });
    } else {
      await runMultiple(models, concurrency, dryRun, datasetPath, datasetName);
    }
  });

program
  .command('export')
  .description('Export results to static JSON for website build')
  .option('--dataset-name <name>', 'Filter by dataset suite (default: fretbench-official)')
  .action((options) => {
    const db = getDb();
    exportResults(db, options.datasetName as string | undefined);
  });

program
  .command('stats [model]')
  .description('Show summary stats for a model')
  .option('--dataset-name <name>', 'Filter by dataset suite (default: fretbench-official)')
  .action((model, options) => {
    if (!model) {
      console.error('Usage: fretbench stats <model-id>');
      process.exit(1);
    }
    const db = getDb();
    showModelStats(db, model, options.datasetName as string | undefined);
  });

program
  .command('leaderboard')
  .description('Show full leaderboard')
  .option('--dataset-name <name>', 'Filter by dataset suite (default: fretbench-official)')
  .action((options) => {
    const db = getDb();
    showLeaderboard(db, options.datasetName as string | undefined);
  });

program
  .command('models')
  .description('List registered models')
  .action(() => {
    showModels();
  });

program
  .command('regrade')
  .description('Re-grade all completed run results using current grader logic and test cases')
  .action(() => {
    regrade();
  });

program.parse();
