# FretBench Build Tasks

## Reference
- PRD: `PRD.md`
- Plan: `~/.claude/plans/sleepy-wiggling-sprout.md`

---

## Tasks

### 1. CLI Scaffolding
- **Status:** done
- **Files:** `cli/package.json`, `cli/tsconfig.json`, `cli/models.yaml`, `cli/src/index.ts`, `cli/.env.example`, `.gitignore`
- **Details:**
  - `package.json`: `"bin": { "fretbench": "./src/index.ts" }`, `"type": "module"`, deps: `better-sqlite3`, `commander`, `yaml`, `openai`, `dotenv`, `chalk`; devDeps: `tsx`, `@types/better-sqlite3`, `@types/node`, `typescript`
  - `tsconfig.json`: ES2022, NodeNext, strict
  - `models.yaml`: full 17-model registry from PRD §4.1
  - `src/index.ts`: `#!/usr/bin/env tsx` shebang, commander program with subcommand stubs: `run`, `export`, `stats`, `leaderboard`, `models`
  - `.env.example`: `OPENROUTER_API_KEY=sk-or-your-key-here`
  - `.gitignore`: add `data/fretbench.db`, `cli/.env`, `cli/node_modules/`, `cli/dist/`, `/test-cases.json`
  - Run `cd cli && pnpm install` to verify

### 2. Database Layer
- **Status:** done
- **Depends on:** 1
- **Files:** `cli/src/db.ts`
- **Details:**
  - `getDb()`: opens/creates `data/fretbench.db`, auto-creates `data/` dir via `mkdirSync`
  - `migrate()`: runs full DDL from PRD §6.2 (3 tables: `eval_versions`, `runs`, `run_results`; indexes; 2 views: `run_summary`, `run_tuning_breakdown`) using `pragma user_version` for idempotency
  - Query helpers: `insertEvalVersion`, `getLatestEvalVersion`, `insertRun`, `updateRunStatus`, `insertRunResult`, `getRunSummary`, `getRunTuningBreakdown`, `getLeaderboard`, `getModelStats`, `getAllCompletedResults`

### 3. Models Loader + Eval Version
- **Status:** done
- **Depends on:** 1
- **Files:** `cli/src/models.ts`, `cli/src/eval-version.ts`
- **Details:**
  - `models.ts`: `ModelEntry` interface, `loadModels()` reads `cli/models.yaml`, `getModel(id)`, `getEnabledModels()`, `getModelsByTier(tier)`
  - `eval-version.ts`: `CURRENT_SYSTEM_PROMPT` constant (full prompt from PRD §5.3), `CURRENT_EVAL_CONFIG` object, `computePromptHash()` (SHA-256), `resolveEvalVersion(db)` (compare hash → insert new version if changed)

### 4. Grader
- **Status:** done
- **Depends on:** 1
- **Files:** `cli/src/grader.ts`
- **Details:**
  - Pure functions, no I/O
  - `ENHARMONIC_MAP`: bidirectional (C#↔Db, D#↔Eb, F#↔Gb, G#↔Ab, A#↔Bb)
  - `normalizeResponse(raw)`: trim, strip quotes/backticks/periods, extract first token matching `/^[A-Ga-g][#b]?$/`, capitalize letter
  - `grade(response, testCase)`: returns `{ extracted: string | null, correct: boolean }` — case-insensitive match against answers, check enharmonic if !strict_spelling

### 5. OpenRouter Client
- **Status:** done
- **Depends on:** 1
- **Files:** `cli/src/openrouter.ts`
- **Details:**
  - OpenAI SDK with `baseURL: 'https://openrouter.ai/api/v1'`, key from `OPENROUTER_API_KEY`
  - `sendPrompt(modelId, systemPrompt, userPrompt, config)` → `{ content, promptTokens, completionTokens, cost, latencyMs }`
  - Cost from OpenRouter extended response fields or computed from tokens × pricing
  - Retry wrapper: exponential backoff + jitter for 429s (base 2s, max 60s)
  - `fetchModelPricing(modelId)` via `GET /api/v1/models`

### 6. Cost Estimation
- **Status:** open
- **Depends on:** 5
- **Files:** `cli/src/cost.ts`
- **Details:**
  - `estimateRunCost(modelId, testCases, systemPrompt)`: chars/4 heuristic for input tokens, 10 for output, fetch pricing
  - `formatCostEstimate()`: chalk-formatted terminal output

### 7. Test Runner
- **Status:** open
- **Depends on:** 2, 3, 4, 5, 6
- **Files:** `cli/src/runner.ts`
- **Details:**
  - `loadTestCases()`: reads `test-cases/test-cases.json` from repo root
  - `getDatasetVersion()`: `git -C test-cases rev-parse HEAD` + `git describe --tags --exact-match` (catch if no tag)
  - `runModel(modelId, { dryRun })`: if dry-run show estimate; otherwise load test cases, resolve eval version, get dataset version, insert run, iterate cases sequentially (assemble prompt, call API, grade, insert result, print progress `[42/100] FB_042 ✓ F# (320ms)`), update run status, print summary
  - `runMultiple(models, concurrency, dryRun)`: concurrency pool across models (default 3)
  - Error handling: failed individual test case → record with error field + `correct: false`, continue

### 8. Stats + Export + Wire Commands
- **Status:** open
- **Depends on:** 7
- **Files:** `cli/src/stats.ts`, update `cli/src/index.ts`
- **Details:**
  - `showLeaderboard(db)`: chalk table — Rank, Model, Provider, Score %, Cost, Last Run
  - `showModelStats(db, modelId)`: all runs, per-tuning breakdown, natural vs accidental
  - `exportResults(db)`: build `ResultsExport` JSON, write to `website/src/data/results.json` (create dir if needed)
  - `ResultsExport` shape: `{ generated_at, eval_version, dataset_version, leaderboard[], hardest_questions[], tuning_difficulty[], dataset_stats }`
  - Wire all commands in `index.ts`: `run`, `export`, `stats`, `leaderboard`, `models`

### 9. Website Data Layer
- **Status:** open
- **Depends on:** 8 (schema only)
- **Files:** `website/src/data/results.json`, `website/src/data/loadResults.ts`
- **Details:**
  - `results.json`: empty-state seed `{ "generated_at": null, "leaderboard": [], "hardest_questions": [], "tuning_difficulty": [], "dataset_stats": { "total_cases": 100, "tuning_counts": {} } }`
  - `loadResults.ts`: typed accessors — `getLeaderboard()`, `getTopModels(n)`, `getHardestQuestions()`, `getTuningDifficulty()`, `hasResults()`, `getGeneratedAt()`

### 10. Website Nav + Page Cleanup
- **Status:** open
- **Files:** `website/src/pages/index.astro`, `website/src/pages/blog/index.astro`, `website/src/layouts/BlogPost.astro`
- **Delete:** `website/src/pages/about.astro`
- **Details:**
  - Add "Results" nav link (to `/results`) before Blog in all navs
  - Remove about.astro

### 11. Homepage Leaderboard Section
- **Status:** open
- **Depends on:** 9, 10
- **Files:** `website/src/pages/index.astro`
- **Details:**
  - Insert `<section id="leaderboard">` between hero and footer
  - Import `getTopModels`, `hasResults` from data loader
  - Empty state: "No benchmark results yet" message
  - With data: styled table — Rank (amber), Model + Provider, Score %, Tuning Breakdown (4 inline stats: Std/DropD/HSD/DropDb), Cost, Last Tested
  - Top 3 rows get amber left-border accent
  - "View all results →" link to `/results`
  - Responsive: hide tuning + cost columns on mobile (<820px)
  - Design: Cormorant headings, Courier Prime data, amber highlights, fade-up animation

### 12. Results Page
- **Status:** open
- **Depends on:** 9, 10
- **Files:** `website/src/pages/results.astro`
- **Details:**
  - Full standalone page matching existing design system (same nav/footer as blog pages)
  - Sections: (1) Header with title + dataset version + generation date, (2) Full leaderboard table with tier badges, (3) Tuning difficulty — 4 stat cards, (4) Hardest questions — table of 10 lowest success-rate questions, (5) Dataset info
  - Empty state: centered "No benchmark results available yet"
  - Tier badges: small uppercase mono pill labels
  - Score percentages in amber, 1.3rem
  - Verify build: `cd website && pnpm build`
