# FretBench

Benchmark for guitar fretboard / note-name reasoning.

## Test case schema

Each item in `test-cases.json` has:

- **id**: unique identifier (e.g. `FB_001`)
- **tuning**: e.g. `Standard`, `Half-Step Down`, `Drop D`, `Drop Db`
- **tab**: ASCII tab for the excerpt (newlines as `\n`)
- **question**: natural-language question (e.g. which note on which string)
- **answers**: **list** of acceptable note names. Enharmonic equivalents are included so that e.g. both `"Ab"` and `"G#"` are accepted when the pitch is the same.
- **strict_spelling** (optional): when `true`, only the exact spelling(s) in `answers` count as correct (e.g. for scale-degree or scale-sequence questions where the correct spelling matters). When omitted or `false`, any answer in the list is accepted.

### Evaluation

- **Normal (pitch) questions**: treat the model response as correct if it matches any string in `answers` (after normalising case/whitespace as needed).
- **Strict-spelling questions**: same, but only accept the spellings listed in `answers` (no extra enharmonics). Use a single canonical spelling in `answers` for those items.

## Migrating from `answer` to `answers`

If you have an old file with a single `"answer"` string, run:

```bash
python3 scripts/migrate_answer_to_answers.py
```

This adds an `answers` list and removes `answer`. The script adds common guitar enharmonic pairs (C#/Db, D#/Eb, F#/Gb, G#/Ab, A#/Bb) only; natural notes stay as a single-element list.
