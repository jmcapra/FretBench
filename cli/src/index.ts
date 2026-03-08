#!/usr/bin/env tsx

import 'dotenv/config';
import { Command } from 'commander';
import { runModel, runMultiple, resolveModels } from './runner.js';
import { getDb } from './db.js';
import { showLeaderboard, showModelStats, exportResults, showModels } from './stats.js';

const program = new Command();

program
  .name('fretbench')
  .description('FretBench — Guitar fretboard note-name reasoning benchmark for LLMs')
  .version('1.0.0');

program
  .command('run [model]')
  .description('Run benchmark for a model or all enabled models')
  .option('--all', 'Run all enabled models')
  .option('--tier <tier>', 'Run all models in a tier (flagship, mid, small)')
  .option('--dry-run', 'Show cost estimate without executing')
  .option('--concurrency <n>', 'Max concurrent model runs', '3')
  .action(async (model, options) => {
    const models = resolveModels(model, options);
    const concurrency = parseInt(options.concurrency, 10);
    const dryRun = options.dryRun ?? false;

    if (models.length === 1) {
      await runModel(models[0].id, { dryRun });
    } else {
      await runMultiple(models, concurrency, dryRun);
    }
  });

program
  .command('export')
  .description('Export results to static JSON for website build')
  .action(() => {
    const db = getDb();
    exportResults(db);
  });

program
  .command('stats [model]')
  .description('Show summary stats for a model')
  .action((model) => {
    if (!model) {
      console.error('Usage: fretbench stats <model-id>');
      process.exit(1);
    }
    const db = getDb();
    showModelStats(db, model);
  });

program
  .command('leaderboard')
  .description('Show full leaderboard')
  .action(() => {
    const db = getDb();
    showLeaderboard(db);
  });

program
  .command('models')
  .description('List registered models')
  .action(() => {
    showModels();
  });

program.parse();
