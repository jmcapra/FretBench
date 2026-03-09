---
title: 'Corrected results: open-weight models sweep FretBench'
description: 'A grading bug was silently dropping every sharp note. After fixing it, the leaderboard flipped — open-weight models now hold all eight top spots.'
pubDate: 'Mar 10 2026'
---

My [first post](/blog/i-asked-14-ai-models-to-read-guitar-tabs/) had a bug. Not in the models — in my grader.

The regex that extracted note names from model responses used `\b([A-Ga-g][#b]?)\b` — a word boundary on both sides of the match. The problem: `#` is not a word character. So the trailing `\b` broke the match on every sharp note. `F#` was extracted as `F`. `C#` became `C`. Every model was being silently penalized on every question with a sharp in the answer.

On top of that, two test cases (FB_008 and FB_058) had flat-out wrong answers in the answer key. Ab at fret 5 is Db, not D or Eb.

The fix was one character — remove the trailing `\b` — plus two test case corrections. But since every raw response is stored in the database, I didn't need to re-run anything. Just re-grade in place with the fixed logic.

The results are dramatically different.

## The new leaderboard

18 models. Four tied for first place at **94.51%**. All four are open weight.

| Rank | Model | Score | Cost | Open Weight |
|------|-------|-------|------|-------------|
| 1 | Qwen 3.5 Flash | 94.51% | $0.17 | Yes |
| 2 | DeepSeek V3.2 Speciale | 94.51% | $0.29 | Yes |
| 3 | Qwen 3.5 Plus | 94.51% | $0.38 | Yes |
| 4 | Kimi K2.5 (Reasoning) | 94.51% | $0.60 | Yes |
| 5 | DeepSeek V3.2 Speciale (Reasoning) | 93.41% | $0.30 | Yes |
| 6 | Kimi K2.5 | 92.86% | $0.61 | Yes |
| 7 | MiniMax M2.5 | 82.97% | $0.11 | Yes |
| 8 | MiniMax M2.5 (Reasoning) | 80.22% | $0.11 | Yes |
| 9 | GPT-5.4 | 74.18% | $0.24 | No |
| 10 | Claude Opus 4.6 | 68.68% | $0.57 | No |

The first closed-source model is GPT-5.4 at 9th place. Claude Opus is 10th. Every model above them is open weight.

## The most dramatic swings

DeepSeek V3.2 Speciale scored **0%** in the original post. I called it out by name. Turns out it was getting nearly every answer right — but with sharps the grader couldn't parse. After the fix: **94.51%**, tied for first. I owe DeepSeek an apology.

MiniMax M2.5 went from 5.5% to **82.97%**. Same story — the model was performing well, but its correct sharp-note answers were being silently discarded.

Meanwhile, models at the bottom barely moved. Llama 4 Scout went from ~14% to 13.74%. Claude Sonnet from 22.5% to 22.53%. The grading bug only affected models that were actually getting sharp notes right. Models that couldn't read tabs still can't.

## Qwen 3.5 Flash: the value play

The four-way tie at the top breaks on cost. Qwen 3.5 Flash ran the entire 182-question benchmark for **$0.17** — less than half the cost of the next cheapest competitor at the same score. It's a mid-tier model beating every flagship on both accuracy and price.

For comparison, Kimi K2.5 with reasoning costs $0.60 for the same score. Claude Opus costs $0.57 for a score 26 points lower.

## Reasoning modes: a wash

I tested several models with and without explicit reasoning modes. The results are mixed at best:

- **DeepSeek V3.2 Speciale**: 94.51% without reasoning, 93.41% with — reasoning made it *worse*
- **MiniMax M2.5**: 82.97% without, 80.22% with — same pattern
- **Kimi K2.5**: 92.86% without, 94.51% with — small improvement

For a task that's fundamentally about parsing and counting, chain-of-thought reasoning doesn't help and can even introduce errors. The models that are good at this are good at it natively.

## Tuning difficulty

The difficulty ordering changed significantly with corrected grading:

| Tuning | Avg Score |
|--------|-----------|
| Standard | 68.4% |
| Drop D | 63.2% |
| Half-Step Down | 55.4% |
| Drop Db | 50.2% |

Standard is still easiest, but the averages are much higher across the board. Drop Db remains the hardest — models struggle most when all six string labels are flats and the tuning deviates from standard in two different ways.

The interesting shift: in the old results, I noted that top models scored higher on Drop D than Standard. That pattern holds — the top four all score 96.88% on Drop D versus 96.97–98.48% on Standard. Drop D's single-string change from standard really does make it easier for models that can already read tabs.

## The open-weight gap

This is the headline finding that the buggy grader was hiding. There's a clear tier structure:

- **Tier 1 (90%+):** Qwen 3.5 Flash, DeepSeek V3.2 Speciale, Qwen 3.5 Plus, Kimi K2.5 — all open weight
- **Tier 2 (80–90%):** MiniMax M2.5 — open weight
- **Tier 3 (65–75%):** GPT-5.4, Claude Opus 4.6 — closed source
- **Tier 4 (<50%):** Everything else — mixed

The gap between tier 1 and tier 3 is 20+ points. Open-weight models from Alibaba, DeepSeek, and Moonshot are categorically better at structured ASCII parsing than the best models from OpenAI and Anthropic.

I still think tokenization is the most likely explanation. These models are trained on different data mixes with different tokenizers. If a tokenizer handles ASCII grid structures — pipes, dashes, aligned numbers — as coherent units rather than fragmenting them, the model has a massive head start on any downstream reasoning. I haven't confirmed this yet, but the results are consistent with that hypothesis, especially given how cleanly the open/closed divide maps onto the performance tiers.

## What I got wrong, and what it means

The original post's conclusions were mostly wrong. Not because the analysis was bad, but because the data was bad. A one-character regex bug silently corrupted every grading decision involving sharp notes — and sharps are common enough in guitar music that it affected a significant fraction of the test suite. Two test cases with wrong answers didn't help either.

The meta-lesson: **eval pipelines are code, and code has bugs.** When 10 out of 182 questions show 0% success across all 18 models, the most likely explanation isn't that the question is impossibly hard — it's that your grader is broken. I should have caught that pattern sooner.

The corrected results tell a clearer and more interesting story. Open-weight models aren't just competitive on this task — they dominate it. And the cheapest model on the leaderboard is tied for first place.

Full results are live at [fretbench.tymo.ai/results](https://fretbench.tymo.ai/results). Everything is open source on [GitHub](https://github.com/jmcapra/FretBench).
