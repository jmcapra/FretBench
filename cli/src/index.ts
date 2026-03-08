#!/usr/bin/env tsx

import 'dotenv/config';
import { Command } from 'commander';

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
  .action(async (_model, _options) => {
    console.log('run command — not yet implemented');
  });

program
  .command('export')
  .description('Export results to static JSON for website build')
  .action(async () => {
    console.log('export command — not yet implemented');
  });

program
  .command('stats [model]')
  .description('Show summary stats for a model')
  .action(async (_model) => {
    console.log('stats command — not yet implemented');
  });

program
  .command('leaderboard')
  .description('Show full leaderboard')
  .action(async () => {
    console.log('leaderboard command — not yet implemented');
  });

program
  .command('models')
  .description('List registered models')
  .action(async () => {
    console.log('models command — not yet implemented');
  });

program.parse();
