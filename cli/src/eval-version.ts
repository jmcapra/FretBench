import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { insertEvalVersion, getLatestEvalVersion } from './db.js';

export const CURRENT_SYSTEM_PROMPT = `You are a guitar theory expert. You will be shown a snippet of ASCII guitar tablature and asked to identify a specific note.

## How to read guitar tablature

- Each line represents a guitar string, labeled on the left (e.g., \`e\`, \`B\`, \`G\`, \`D\`, \`A\`, \`E\`).
- Numbers on a string indicate the fret to be played. \`0\` means the open string.
- The note sounded is determined by the string's tuning pitch plus the fret number (each fret = one semitone up).
- Notes are read left to right in chronological order.
- Dashes (\`-\`) are spacing and produce no sound. Pipes (\`|\`) are bar lines.
- Letters between fret numbers (e.g., \`h\`, \`p\`, \`/\`, \`\\\`) are articulation marks (hammer-on, pull-off, slide) — they do not change which notes are played.

## Tuning reference

The tab's string labels tell you the tuning. Common tunings and their open-string pitches (thinnest → thickest):

- **Standard:** e B G D A E → E4 B3 G3 D3 A2 E2
- **Half-Step Down:** eb Bb Gb Db Ab Eb → Eb4 Bb3 Gb3 Db3 Ab2 Eb2
- **Drop D:** e B G D A D → E4 B3 G3 D3 A2 D2
- **Drop Db:** eb Bb Gb Db Ab Db → Eb4 Bb3 Gb3 Db3 Ab2 Db2

## The chromatic scale (ascending from C)

C → C#/Db → D → D#/Eb → E → F → F#/Gb → G → G#/Ab → A → A#/Bb → B → C

## Instructions

1. Identify the correct string from the question.
2. Find the fret number(s) played on that string in the tab.
3. Starting from the string's open pitch, count up by the fret number in semitones using the chromatic scale.
4. Respond with ONLY the note name (e.g., \`F#\`). No explanation, no other text.`;

export const CURRENT_EVAL_CONFIG = {
  version: '1.0.0',
  grading_logic: 'v1: normalize → extract /^[A-Ga-g][#b]?$/ → case-insensitive match + enharmonic (unless strict_spelling)',
  temperature: 0,
  max_tokens: 64,
} as const;

export function computePromptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

export function resolveEvalVersion(db: Database.Database): number {
  const currentHash = computePromptHash(CURRENT_SYSTEM_PROMPT);
  const latest = getLatestEvalVersion(db);

  if (latest && latest.system_prompt_hash === currentHash) {
    return latest.id;
  }

  const id = insertEvalVersion(db, {
    version: CURRENT_EVAL_CONFIG.version,
    system_prompt: CURRENT_SYSTEM_PROMPT,
    system_prompt_hash: currentHash,
    grading_logic: CURRENT_EVAL_CONFIG.grading_logic,
    temperature: CURRENT_EVAL_CONFIG.temperature,
    max_tokens: CURRENT_EVAL_CONFIG.max_tokens,
    notes: latest ? 'Auto-created: system prompt hash changed' : 'Initial eval version',
    created_at: new Date().toISOString(),
  });

  return id;
}
