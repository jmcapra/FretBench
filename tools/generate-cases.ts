#!/usr/bin/env tsx

/**
 * Generates diverse FretBench test cases with verified answers.
 *
 * Usage:
 *   npx tsx tools/generate-cases.ts                     # prints JSON to stdout
 *   npx tsx tools/generate-cases.ts --merge             # merges into test-cases.json
 *   npx tsx tools/generate-cases.ts --out new-cases.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Music Theory ───

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const ENHARMONIC: Record<string, string> = {
  'C#': 'Db', 'Db': 'C#',
  'D#': 'Eb', 'Eb': 'D#',
  'F#': 'Gb', 'Gb': 'F#',
  'G#': 'Ab', 'Ab': 'G#',
  'A#': 'Bb', 'Bb': 'A#',
};

function noteIndex(note: string): number {
  let idx = SHARP_NAMES.indexOf(note);
  if (idx < 0) idx = FLAT_NAMES.indexOf(note);
  if (idx < 0) throw new Error(`Unknown note: ${note}`);
  return idx;
}

function noteAtFret(openNote: string, fret: number): string {
  const idx = noteIndex(openNote);
  return SHARP_NAMES[(idx + fret) % 12];
}

function answers(note: string): string[] {
  const ans = [note];
  if (ENHARMONIC[note]) ans.push(ENHARMONIC[note]);
  return ans;
}

// ─── Tuning Definitions ───

interface TuningDef {
  name: string;
  strings: { label: string; openNote: string }[];
}

const TUNINGS: TuningDef[] = [
  {
    name: 'Standard',
    strings: [
      { label: 'e', openNote: 'E' },
      { label: 'B', openNote: 'B' },
      { label: 'G', openNote: 'G' },
      { label: 'D', openNote: 'D' },
      { label: 'A', openNote: 'A' },
      { label: 'E', openNote: 'E' },
    ],
  },
  {
    name: 'Half-Step Down',
    strings: [
      { label: 'eb', openNote: 'Eb' },
      { label: 'Bb', openNote: 'Bb' },
      { label: 'Gb', openNote: 'Gb' },
      { label: 'Db', openNote: 'Db' },
      { label: 'Ab', openNote: 'Ab' },
      { label: 'Eb', openNote: 'Eb' },
    ],
  },
  {
    name: 'Drop D',
    strings: [
      { label: 'e', openNote: 'E' },
      { label: 'B', openNote: 'B' },
      { label: 'G', openNote: 'G' },
      { label: 'D', openNote: 'D' },
      { label: 'A', openNote: 'A' },
      { label: 'D', openNote: 'D' },
    ],
  },
  {
    name: 'Drop Db',
    strings: [
      { label: 'eb', openNote: 'Eb' },
      { label: 'Bb', openNote: 'Bb' },
      { label: 'Gb', openNote: 'Gb' },
      { label: 'Db', openNote: 'Db' },
      { label: 'Ab', openNote: 'Ab' },
      { label: 'Db', openNote: 'Db' },
    ],
  },
];

// ─── Tab Builder ───

interface TabLine {
  label: string;
  content: string; // e.g. "---3-5-7---" (no label or pipe prefix)
}

interface FretEvent {
  stringIdx: number; // 0=thinnest (e), 5=thickest (E)
  position: number;  // character offset in the tab content
  fret: number;
}

function buildTab(tuning: TuningDef, lines: TabLine[]): string {
  return lines.map(l => `${l.label}|${l.content}|`).join('\n');
}

function extractEvents(lines: TabLine[]): FretEvent[] {
  const events: FretEvent[] = [];
  for (let si = 0; si < lines.length; si++) {
    const content = lines[si].content;
    let i = 0;
    while (i < content.length) {
      if (content[i] >= '0' && content[i] <= '9') {
        let numStr = content[i];
        const pos = i;
        while (i + 1 < content.length && content[i + 1] >= '0' && content[i + 1] <= '9') {
          numStr += content[++i];
        }
        events.push({ stringIdx: si, position: pos, fret: parseInt(numStr) });
      }
      i++;
    }
  }
  // Sort by position (left-to-right = temporal order), then by string (thickest first for ties)
  events.sort((a, b) => a.position - b.position || b.stringIdx - a.stringIdx);
  return events;
}

function resolveNote(tuning: TuningDef, stringIdx: number, fret: number): string {
  return noteAtFret(tuning.strings[stringIdx].openNote, fret);
}

// ─── Helpers ───

function pad(content: string, width: number): string {
  if (content.length >= width) return content;
  return content + '-'.repeat(width - content.length);
}

function emptyLine(width: number): string {
  return '-'.repeat(width);
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function stringDescriptor(tuning: TuningDef, stringIdx: number): string {
  const s = tuning.strings[stringIdx];
  // For tunings with duplicate labels (Drop D, Drop Db), disambiguate
  if (stringIdx === 5) {
    const hasThisLabelHigher = tuning.strings.slice(0, 5).some(o => o.label === s.label);
    if (hasThisLabelHigher) return `${s.label} (6th)`;
  }
  if (stringIdx === 3 && tuning.name.startsWith('Drop')) {
    const label4 = tuning.strings[3].label;
    const label6 = tuning.strings[5].label;
    if (label4 === label6) return `${s.label} (4th)`;
  }
  return s.label;
}

// ─── Test Case Generators ───

interface TestCase {
  id: string;
  tuning: string;
  tab: string;
  question: string;
  answers: string[];
  strict_spelling?: boolean;
}

let nextId = 101;
function makeId(): string {
  return `FB_${String(nextId++).padStart(3, '0')}`;
}

const generated: TestCase[] = [];

function add(tuning: TuningDef, lines: TabLine[], question: string, answer: string, strict?: boolean) {
  const tc: TestCase = {
    id: makeId(),
    tuning: tuning.name,
    tab: buildTab(tuning, lines),
    question,
    answers: answers(answer),
  };
  if (strict) tc.strict_spelling = true;
  generated.push(tc);
}

// ─── Category 1: Melodies — multiple notes on a single string ───

function melodyOnString(tuning: TuningDef, stringIdx: number, frets: number[], askNth: number) {
  const W = 4 + frets.length * 4;
  const lines: TabLine[] = tuning.strings.map((s, i) => {
    if (i === stringIdx) {
      const notes = frets.map(f => {
        const fs = String(f);
        return fs.length === 1 ? `-${fs}-` : `${fs}-`;
      }).join('-');
      return { label: s.label, content: pad(`-${notes}`, W) };
    }
    return { label: s.label, content: emptyLine(W) };
  });

  const note = resolveNote(tuning, stringIdx, frets[askNth - 1]);
  const desc = stringDescriptor(tuning, stringIdx);
  add(tuning, lines, `What is the ${ordinal(askNth)} note played on the ${desc} string?`, note);
}

function lastNoteOnString(tuning: TuningDef, stringIdx: number, frets: number[]) {
  const W = 4 + frets.length * 4;
  const lines: TabLine[] = tuning.strings.map((s, i) => {
    if (i === stringIdx) {
      const notes = frets.map(f => {
        const fs = String(f);
        return fs.length === 1 ? `-${fs}-` : `${fs}-`;
      }).join('-');
      return { label: s.label, content: pad(`-${notes}`, W) };
    }
    return { label: s.label, content: emptyLine(W) };
  });

  const note = resolveNote(tuning, stringIdx, frets[frets.length - 1]);
  const desc = stringDescriptor(tuning, stringIdx);
  add(tuning, lines, `What is the last note played on the ${desc} string?`, note);
}

// ─── Category 2: Arpeggios — notes across strings, ask Nth overall ───

function arpeggio(
  tuning: TuningDef,
  pattern: { stringIdx: number; fret: number; pos: number }[],
  askNth: number,
  width: number
) {
  const lines: TabLine[] = tuning.strings.map((s) => {
    return { label: s.label, content: emptyLine(width) };
  });

  for (const p of pattern) {
    const content = lines[p.stringIdx].content.split('');
    const fretStr = String(p.fret);
    for (let c = 0; c < fretStr.length; c++) {
      content[p.pos + c] = fretStr[c];
    }
    lines[p.stringIdx].content = content.join('');
  }

  // Sort by position to determine temporal order
  const sorted = [...pattern].sort((a, b) => a.pos - b.pos || b.stringIdx - a.stringIdx);
  const targetEvent = sorted[askNth - 1];
  const note = resolveNote(tuning, targetEvent.stringIdx, targetEvent.fret);

  add(tuning, lines, `What is the ${ordinal(askNth)} note played?`, note);
}

function firstNoteOverall(
  tuning: TuningDef,
  pattern: { stringIdx: number; fret: number; pos: number }[],
  width: number
) {
  const lines: TabLine[] = tuning.strings.map((s) => {
    return { label: s.label, content: emptyLine(width) };
  });

  for (const p of pattern) {
    const content = lines[p.stringIdx].content.split('');
    const fretStr = String(p.fret);
    for (let c = 0; c < fretStr.length; c++) {
      content[p.pos + c] = fretStr[c];
    }
    lines[p.stringIdx].content = content.join('');
  }

  const sorted = [...pattern].sort((a, b) => a.pos - b.pos || b.stringIdx - a.stringIdx);
  const first = sorted[0];
  const note = resolveNote(tuning, first.stringIdx, first.fret);
  add(tuning, lines, 'What is the first note played?', note);
}

function lastNoteOverall(
  tuning: TuningDef,
  pattern: { stringIdx: number; fret: number; pos: number }[],
  width: number
) {
  const lines: TabLine[] = tuning.strings.map((s) => {
    return { label: s.label, content: emptyLine(width) };
  });

  for (const p of pattern) {
    const content = lines[p.stringIdx].content.split('');
    const fretStr = String(p.fret);
    for (let c = 0; c < fretStr.length; c++) {
      content[p.pos + c] = fretStr[c];
    }
    lines[p.stringIdx].content = content.join('');
  }

  const sorted = [...pattern].sort((a, b) => a.pos - b.pos || b.stringIdx - a.stringIdx);
  const last = sorted[sorted.length - 1];
  const note = resolveNote(tuning, last.stringIdx, last.fret);
  add(tuning, lines, 'What is the last note played?', note);
}

// ─── Category 3: Riffs with articulations ───

function riffWithHammerOn(tuning: TuningDef, stringIdx: number, fretSeq: number[]) {
  // Build a line like: ---0-h-2---4---2---
  // "h" between first two notes = hammer-on
  const W = 4 + fretSeq.length * 4 + 2; // extra for "h"
  const parts: string[] = [];
  for (let i = 0; i < fretSeq.length; i++) {
    if (i === 1) parts.push('h');
    const fs = String(fretSeq[i]);
    parts.push(fs);
  }
  const notePart = parts.join('-');

  const lines: TabLine[] = tuning.strings.map((s, i) => {
    if (i === stringIdx) {
      return { label: s.label, content: pad(`--${notePart}--`, W + 4) };
    }
    return { label: s.label, content: emptyLine(W + 4) };
  });

  // Ask about a note that's NOT the hammer-on boundary (to test they read past it)
  const askIdx = fretSeq.length >= 3 ? 2 : fretSeq.length - 1;
  const note = resolveNote(tuning, stringIdx, fretSeq[askIdx]);
  const desc = stringDescriptor(tuning, stringIdx);
  add(tuning, lines,
    `What is the ${ordinal(askIdx + 1)} note played on the ${desc} string?`,
    note);
}

function riffWithSlide(tuning: TuningDef, stringIdx: number, fretSeq: number[]) {
  const W = 4 + fretSeq.length * 4 + 2;
  const parts: string[] = [];
  for (let i = 0; i < fretSeq.length; i++) {
    if (i === 1) parts.push('/');
    const fs = String(fretSeq[i]);
    parts.push(fs);
  }
  const notePart = parts.join('-');

  const lines: TabLine[] = tuning.strings.map((s, i) => {
    if (i === stringIdx) {
      return { label: s.label, content: pad(`--${notePart}--`, W + 4) };
    }
    return { label: s.label, content: emptyLine(W + 4) };
  });

  const lastFret = fretSeq[fretSeq.length - 1];
  const note = resolveNote(tuning, stringIdx, lastFret);
  const desc = stringDescriptor(tuning, stringIdx);
  add(tuning, lines,
    `What is the last note played on the ${desc} string?`,
    note);
}

// ─── Category 4: "What note comes after X?" ───

function noteAfterQuestion(
  tuning: TuningDef,
  stringIdx: number,
  frets: number[],
  afterNoteIdx: number
) {
  const W = 4 + frets.length * 4;
  const lines: TabLine[] = tuning.strings.map((s, i) => {
    if (i === stringIdx) {
      const notes = frets.map(f => {
        const fs = String(f);
        return fs.length === 1 ? `-${fs}-` : `${fs}-`;
      }).join('-');
      return { label: s.label, content: pad(`-${notes}`, W) };
    }
    return { label: s.label, content: emptyLine(W) };
  });

  const afterNote = resolveNote(tuning, stringIdx, frets[afterNoteIdx]);
  const targetNote = resolveNote(tuning, stringIdx, frets[afterNoteIdx + 1]);
  const desc = stringDescriptor(tuning, stringIdx);

  // Use the note name (pick sharp or flat based on tuning convention)
  const displayNote = tuning.name.includes('Half-Step') || tuning.name.includes('Db')
    ? (ENHARMONIC[afterNote] && FLAT_NAMES.includes(ENHARMONIC[afterNote]) ? ENHARMONIC[afterNote] : afterNote)
    : afterNote;

  add(tuning, lines,
    `On the ${desc} string, what note is played immediately after the ${displayNote}?`,
    targetNote);
}

// ─── Category 5: Multi-string melody (notes on 2-3 strings, ask Nth on one) ───

function multiStringMelody(
  tuning: TuningDef,
  stringData: { stringIdx: number; frets: number[]; startPos: number }[],
  askStringIdx: number,
  askNth: number,
  width: number
) {
  const lines: TabLine[] = tuning.strings.map((s) => {
    return { label: s.label, content: emptyLine(width) };
  });

  for (const sd of stringData) {
    const content = lines[sd.stringIdx].content.split('');
    let pos = sd.startPos;
    for (const f of sd.frets) {
      const fs = String(f);
      for (let c = 0; c < fs.length; c++) {
        if (pos + c < content.length) content[pos + c] = fs[c];
      }
      pos += fs.length < 2 ? 4 : 5;
    }
    lines[sd.stringIdx].content = content.join('');
  }

  const targetFrets = stringData.find(sd => sd.stringIdx === askStringIdx)!.frets;
  const note = resolveNote(tuning, askStringIdx, targetFrets[askNth - 1]);
  const desc = stringDescriptor(tuning, askStringIdx);
  add(tuning, lines,
    `What is the ${ordinal(askNth)} note played on the ${desc} string?`,
    note);
}

// ─── Category 6: "Nth note played" where the first note on a string ≠ first overall ───

function offsetArpeggio(
  tuning: TuningDef,
  events: { stringIdx: number; fret: number; pos: number }[],
  askNth: number,
  width: number,
  questionVariant: 'nth' | 'first-on-string' | 'last-overall'
) {
  const lines: TabLine[] = tuning.strings.map((s) => {
    return { label: s.label, content: emptyLine(width) };
  });

  for (const e of events) {
    const content = lines[e.stringIdx].content.split('');
    const fretStr = String(e.fret);
    for (let c = 0; c < fretStr.length; c++) {
      if (e.pos + c < content.length) content[e.pos + c] = fretStr[c];
    }
    lines[e.stringIdx].content = content.join('');
  }

  const sorted = [...events].sort((a, b) => a.pos - b.pos || b.stringIdx - a.stringIdx);

  if (questionVariant === 'nth') {
    const target = sorted[askNth - 1];
    const note = resolveNote(tuning, target.stringIdx, target.fret);
    add(tuning, lines, `What is the ${ordinal(askNth)} note played?`, note);
  } else if (questionVariant === 'first-on-string') {
    // Ask: "What is the first note played on string X?" where that string's first note
    // is NOT the first note overall
    const targetStringIdx = events.find(e => e.pos > sorted[0].pos)?.stringIdx;
    if (targetStringIdx !== undefined) {
      const stringEvents = sorted.filter(e => e.stringIdx === targetStringIdx);
      const first = stringEvents[0];
      const note = resolveNote(tuning, first.stringIdx, first.fret);
      const desc = stringDescriptor(tuning, targetStringIdx);
      add(tuning, lines, `What is the first note played on the ${desc} string?`, note);
    }
  } else {
    const last = sorted[sorted.length - 1];
    const note = resolveNote(tuning, last.stringIdx, last.fret);
    add(tuning, lines, 'What is the last note played?', note);
  }
}

// ════════════════════════════════════════════════
//  GENERATE ALL CASES
// ════════════════════════════════════════════════

const STD = TUNINGS[0];
const HSD = TUNINGS[1];
const DRD = TUNINGS[2];
const DRB = TUNINGS[3];

// ──── Melodies (Nth note on string) ────

// Standard: melody on e string (pentatonic run)
melodyOnString(STD, 0, [0, 3, 5, 7, 5, 3], 3);   // 3rd note = fret 5 on e = A
melodyOnString(STD, 0, [0, 3, 5, 7, 5, 3], 4);   // 4th note = fret 7 on e = B

// Standard: melody on A string
melodyOnString(STD, 4, [0, 2, 3, 5, 7], 4);       // 4th note = fret 5 on A = D
melodyOnString(STD, 4, [0, 2, 3, 5, 7], 2);       // 2nd note = fret 2 on A = B

// Half-Step Down: melody on Gb string
melodyOnString(HSD, 2, [0, 2, 4, 5, 7], 3);       // 3rd note = fret 4 on Gb = Bb → A#/Bb
melodyOnString(HSD, 2, [0, 2, 4, 5, 7], 5);       // 5th note = fret 7 on Gb = C#

// Half-Step Down: melody on eb string
melodyOnString(HSD, 0, [1, 3, 5, 6, 8], 2);       // 2nd note = fret 3 on eb (Eb) = F#

// Drop D: melody on D (6th) string
melodyOnString(DRD, 5, [0, 2, 3, 5, 7, 9], 3);   // 3rd note = fret 3 on D(6th) = F
melodyOnString(DRD, 5, [0, 2, 3, 5, 7, 9], 5);   // 5th note = fret 7 on D(6th) = A

// Drop D: melody on G string
melodyOnString(DRD, 2, [0, 2, 4, 5, 7, 9], 6);   // 6th note = fret 9 on G = E

// Drop Db: melody on Ab string
melodyOnString(DRB, 4, [0, 1, 3, 5, 6], 4);       // 4th note = fret 5 on Ab = C#

// Standard: melody on D string (blues lick)
melodyOnString(STD, 3, [0, 3, 5, 3, 0], 3);       // 3rd note = fret 5 on D = G
melodyOnString(STD, 3, [0, 3, 5, 3, 0], 5);       // 5th note = fret 0 on D = D

// Half-Step Down: melody on Db string
melodyOnString(HSD, 3, [1, 3, 5, 6, 8], 4);       // 4th note = fret 6 on Db = G

// ──── Last note on string ────

lastNoteOnString(STD, 1, [0, 1, 3, 5, 3, 1]);     // last on B = fret 1 = C
lastNoteOnString(HSD, 0, [2, 4, 6, 4, 2, 0]);     // last on eb = fret 0 = Eb → D#
lastNoteOnString(DRD, 5, [0, 3, 5, 7, 5, 3, 0]);  // last on D(6th) = fret 0 = D
lastNoteOnString(DRB, 2, [0, 2, 4, 7, 4, 2]);     // last on Gb = fret 2 = G#

// ──── Arpeggios — "What is the Nth note played?" ────

// Standard: ascending arpeggio (thickest to thinnest)
arpeggio(STD, [
  { stringIdx: 5, fret: 3, pos: 1 },   // E string fret 3 = G
  { stringIdx: 4, fret: 2, pos: 5 },   // A string fret 2 = B
  { stringIdx: 3, fret: 0, pos: 9 },   // D string fret 0 = D
  { stringIdx: 2, fret: 0, pos: 13 },  // G string fret 0 = G
  { stringIdx: 1, fret: 3, pos: 17 },  // B string fret 3 = D
  { stringIdx: 0, fret: 3, pos: 21 },  // e string fret 3 = G
], 4, 26);  // 4th note = G string fret 0 = G

// Standard: descending arpeggio
arpeggio(STD, [
  { stringIdx: 0, fret: 0, pos: 1 },   // e string fret 0 = E
  { stringIdx: 1, fret: 1, pos: 5 },   // B string fret 1 = C
  { stringIdx: 2, fret: 0, pos: 9 },   // G string fret 0 = G
  { stringIdx: 3, fret: 2, pos: 13 },  // D string fret 2 = E
  { stringIdx: 4, fret: 3, pos: 17 },  // A string fret 3 = C
], 3, 22);  // 3rd note = G

// Half-Step Down: arpeggio
arpeggio(HSD, [
  { stringIdx: 5, fret: 1, pos: 1 },   // Eb string fret 1 = E
  { stringIdx: 4, fret: 3, pos: 5 },   // Ab string fret 3 = B
  { stringIdx: 3, fret: 1, pos: 9 },   // Db string fret 1 = D
  { stringIdx: 2, fret: 0, pos: 13 },  // Gb string fret 0 = F#
  { stringIdx: 1, fret: 2, pos: 17 },  // Bb string fret 2 = C
  { stringIdx: 0, fret: 1, pos: 21 },  // eb string fret 1 = E
], 5, 26);  // 5th note = C

// Drop D: arpeggio
arpeggio(DRD, [
  { stringIdx: 5, fret: 0, pos: 1 },   // D(6th) fret 0 = D
  { stringIdx: 4, fret: 0, pos: 5 },   // A fret 0 = A
  { stringIdx: 3, fret: 2, pos: 9 },   // D(4th) fret 2 = E
  { stringIdx: 2, fret: 2, pos: 13 },  // G fret 2 = A
  { stringIdx: 1, fret: 3, pos: 17 },  // B fret 3 = D
  { stringIdx: 0, fret: 2, pos: 21 },  // e fret 2 = F#
], 6, 26);  // 6th note = e fret 2 = F#

// Drop Db: arpeggio
arpeggio(DRB, [
  { stringIdx: 5, fret: 2, pos: 1 },   // Db(6th) fret 2 = D#
  { stringIdx: 4, fret: 1, pos: 5 },   // Ab fret 1 = A
  { stringIdx: 3, fret: 3, pos: 9 },   // Db(4th) fret 3 = E
  { stringIdx: 2, fret: 2, pos: 13 },  // Gb fret 2 = G#
  { stringIdx: 1, fret: 4, pos: 17 },  // Bb fret 4 = D
], 2, 22);  // 2nd note = A

// ──── First / Last note overall ────

// Standard: staggered entry
firstNoteOverall(STD, [
  { stringIdx: 5, fret: 0, pos: 1 },
  { stringIdx: 4, fret: 2, pos: 5 },
  { stringIdx: 3, fret: 2, pos: 9 },
  { stringIdx: 2, fret: 1, pos: 13 },
  { stringIdx: 1, fret: 0, pos: 17 },
  { stringIdx: 0, fret: 0, pos: 21 },
], 26);  // first = E string fret 0 = E

// Half-Step Down: last note
lastNoteOverall(HSD, [
  { stringIdx: 5, fret: 3, pos: 1 },
  { stringIdx: 4, fret: 2, pos: 5 },
  { stringIdx: 3, fret: 0, pos: 9 },
  { stringIdx: 2, fret: 0, pos: 13 },
  { stringIdx: 1, fret: 3, pos: 17 },
  { stringIdx: 0, fret: 3, pos: 21 },
], 26);  // last = eb fret 3 = F#

// Drop D: first note (starts on high string)
firstNoteOverall(DRD, [
  { stringIdx: 0, fret: 7, pos: 1 },
  { stringIdx: 1, fret: 8, pos: 5 },
  { stringIdx: 2, fret: 9, pos: 9 },
  { stringIdx: 3, fret: 7, pos: 13 },
], 18);  // first = e fret 7 = B

// Drop Db: last note
lastNoteOverall(DRB, [
  { stringIdx: 4, fret: 0, pos: 1 },
  { stringIdx: 3, fret: 2, pos: 5 },
  { stringIdx: 2, fret: 1, pos: 9 },
  { stringIdx: 1, fret: 0, pos: 13 },
  { stringIdx: 0, fret: 2, pos: 17 },
], 22);  // last = eb fret 2 = F

// ──── Riffs with articulations ────

// Standard: hammer-on on A string
riffWithHammerOn(STD, 4, [0, 2, 3, 5, 7]);       // 3rd note = fret 3 on A = C
// Standard: hammer-on on e string
riffWithHammerOn(STD, 0, [0, 3, 5, 7, 5]);        // 3rd note = fret 5 on e = A
// Half-Step Down: hammer-on on Db string
riffWithHammerOn(HSD, 3, [0, 2, 4, 5]);           // 3rd note = fret 4 on Db = F
// Drop D: hammer-on on D (6th) string
riffWithHammerOn(DRD, 5, [0, 3, 5, 7, 5, 3]);    // 3rd note = fret 5 on D(6th) = G

// Standard: slide on G string
riffWithSlide(STD, 2, [5, 7, 9, 12]);             // last = fret 12 on G = G
// Half-Step Down: slide on Ab string
riffWithSlide(HSD, 4, [0, 3, 5, 7, 10]);          // last = fret 10 on Ab = F#
// Drop D: slide on B string
riffWithSlide(DRD, 1, [3, 5, 7, 10, 12]);         // last = fret 12 on B = B
// Drop Db: slide on Bb string
riffWithSlide(DRB, 1, [0, 3, 5, 8]);              // last = fret 8 on Bb = F#

// ──── "Note after X" questions ────

// Standard: on e string
noteAfterQuestion(STD, 0, [0, 1, 3, 5, 7], 1);   // after fret 1(F) → fret 3 = G
// Standard: on B string
noteAfterQuestion(STD, 1, [0, 1, 3, 5, 8], 2);   // after fret 3(D) → fret 5 = E
// Half-Step Down: on Gb string
noteAfterQuestion(HSD, 2, [0, 2, 4, 7, 9], 2);   // after fret 4(Bb/A#) → fret 7 = C#
// Drop D: on A string
noteAfterQuestion(DRD, 4, [0, 3, 5, 7, 10], 3);  // after fret 7(E) → fret 10 = G
// Drop Db: on Db (4th) string
noteAfterQuestion(DRB, 3, [0, 1, 3, 6, 8], 1);   // after fret 1(D) → fret 3 = E
// Standard: on D string
noteAfterQuestion(STD, 3, [0, 2, 3, 5, 7], 3);   // after fret 5(G) → fret 7 = A
// Half-Step Down: on eb string
noteAfterQuestion(HSD, 0, [0, 2, 4, 7, 9], 0);   // after fret 0(Eb/D#) → fret 2 = F

// ──── Multi-string melodies ────

// Standard: melody on E and A strings
multiStringMelody(STD, [
  { stringIdx: 5, frets: [0, 3, 5, 3], startPos: 1 },
  { stringIdx: 4, frets: [2, 3, 5, 7], startPos: 1 },
], 4, 2, 20);  // 2nd note on A = fret 3 = C

// Half-Step Down: melody on Bb and eb
multiStringMelody(HSD, [
  { stringIdx: 1, frets: [0, 1, 3, 5], startPos: 1 },
  { stringIdx: 0, frets: [0, 2, 3, 5], startPos: 1 },
], 0, 3, 20);  // 3rd note on eb = fret 3 = F#

// Drop D: melody on D(6th) and A
multiStringMelody(DRD, [
  { stringIdx: 5, frets: [0, 3, 5, 7], startPos: 1 },
  { stringIdx: 4, frets: [0, 2, 3, 5], startPos: 1 },
], 5, 4, 20);  // 4th note on D(6th) = fret 7 = A

// Standard: melody on G and D
multiStringMelody(STD, [
  { stringIdx: 2, frets: [0, 2, 4, 5], startPos: 1 },
  { stringIdx: 3, frets: [0, 2, 3, 5], startPos: 1 },
], 2, 4, 20);  // 4th note on G = fret 5 = C

// Drop Db: melody on Gb and Db(4th)
multiStringMelody(DRB, [
  { stringIdx: 2, frets: [0, 2, 4, 5], startPos: 1 },
  { stringIdx: 3, frets: [0, 1, 3, 5], startPos: 1 },
], 2, 3, 20);  // 3rd note on Gb = fret 4 = A#

// ──── Offset arpeggios — tricky temporal ordering ────

// Standard: bass note starts, melody enters later
offsetArpeggio(STD, [
  { stringIdx: 5, fret: 3, pos: 1 },   // G
  { stringIdx: 4, fret: 2, pos: 1 },   // B (simultaneous with above, thickest first)
  { stringIdx: 2, fret: 0, pos: 5 },   // G
  { stringIdx: 1, fret: 0, pos: 9 },   // B
  { stringIdx: 0, fret: 3, pos: 13 },  // G
], 3, 18, 'nth');  // 3rd note = G string fret 0 = G

// Half-Step Down: alternating strings
offsetArpeggio(HSD, [
  { stringIdx: 3, fret: 0, pos: 1 },   // Db = C#
  { stringIdx: 1, fret: 1, pos: 5 },   // Bb fret 1 = B
  { stringIdx: 3, fret: 2, pos: 9 },   // Db fret 2 = D#
  { stringIdx: 1, fret: 3, pos: 13 },  // Bb fret 3 = C#
  { stringIdx: 3, fret: 4, pos: 17 },  // Db fret 4 = F
], 4, 22, 'nth');  // 4th note = Bb fret 3 = C#

// Drop D: "first note on string X" where X isn't the first string to play
offsetArpeggio(DRD, [
  { stringIdx: 5, fret: 0, pos: 1 },   // D(6th) = D
  { stringIdx: 3, fret: 0, pos: 5 },   // D(4th) = D
  { stringIdx: 2, fret: 0, pos: 9 },   // G = G
  { stringIdx: 1, fret: 0, pos: 13 },  // B = B
  { stringIdx: 0, fret: 0, pos: 17 },  // e = E
], 0, 22, 'first-on-string');

// Standard: complex picking pattern — last note overall
offsetArpeggio(STD, [
  { stringIdx: 4, fret: 3, pos: 1 },
  { stringIdx: 3, fret: 2, pos: 5 },
  { stringIdx: 2, fret: 0, pos: 9 },
  { stringIdx: 1, fret: 1, pos: 13 },
  { stringIdx: 2, fret: 0, pos: 17 },
  { stringIdx: 3, fret: 2, pos: 21 },
], 0, 26, 'last-overall');  // last = D fret 2 = E

// Drop Db: "last note overall"
offsetArpeggio(DRB, [
  { stringIdx: 5, fret: 4, pos: 1 },   // Db(6th) fret 4 = F
  { stringIdx: 4, fret: 3, pos: 5 },   // Ab fret 3 = B
  { stringIdx: 3, fret: 1, pos: 9 },   // Db(4th) fret 1 = D
  { stringIdx: 2, fret: 0, pos: 13 },  // Gb fret 0 = F#
  { stringIdx: 1, fret: 2, pos: 17 },  // Bb fret 2 = C
  { stringIdx: 0, fret: 4, pos: 21 },  // eb fret 4 = G
], 0, 26, 'last-overall');

// ──── More diverse melody patterns ────

// Standard: chromatic run on G string
melodyOnString(STD, 2, [0, 1, 2, 3, 4, 5, 6, 7], 6);  // 6th note = fret 5 on G = C
melodyOnString(STD, 2, [0, 1, 2, 3, 4, 5, 6, 7], 8);  // 8th note = fret 7 on G = D

// Half-Step Down: descending on Bb string
melodyOnString(HSD, 1, [12, 10, 8, 7, 5, 3], 3);      // 3rd note = fret 8 on Bb = F#

// Drop D: pentatonic on A string
melodyOnString(DRD, 4, [0, 3, 5, 7, 10, 12], 5);      // 5th note = fret 10 on A = G

// Drop Db: blues on Db(4th) string
melodyOnString(DRB, 3, [0, 3, 5, 6, 5, 3], 4);        // 4th note = fret 6 on Db = G

// Standard: wide-interval on E string
melodyOnString(STD, 5, [0, 5, 7, 12, 7, 5], 4);       // 4th note = fret 12 on E = E
lastNoteOnString(STD, 5, [0, 5, 7, 12, 7, 5]);         // last = fret 5 on E = A

// Half-Step Down: melody on Ab string
melodyOnString(HSD, 4, [2, 4, 5, 7, 9, 11], 5);       // 5th note = fret 9 on Ab = F
lastNoteOnString(HSD, 4, [2, 4, 5, 7, 9, 11]);         // last = fret 11 on Ab = G

// ──── More arpeggios with Nth ────

// Standard: Am arpeggio fingerpicked
arpeggio(STD, [
  { stringIdx: 4, fret: 0, pos: 1 },   // A
  { stringIdx: 3, fret: 2, pos: 5 },   // E
  { stringIdx: 2, fret: 2, pos: 9 },   // A
  { stringIdx: 1, fret: 1, pos: 13 },  // C
  { stringIdx: 0, fret: 0, pos: 17 },  // E
], 2, 22);  // 2nd note = D fret 2 = E

// Half-Step Down: Em shape arpeggio
arpeggio(HSD, [
  { stringIdx: 5, fret: 0, pos: 1 },   // Eb → D#
  { stringIdx: 4, fret: 2, pos: 5 },   // Ab fret 2 = A#
  { stringIdx: 3, fret: 2, pos: 9 },   // Db fret 2 = D#
  { stringIdx: 2, fret: 0, pos: 13 },  // Gb → F#
  { stringIdx: 1, fret: 0, pos: 17 },  // Bb → A#
  { stringIdx: 0, fret: 0, pos: 21 },  // Eb → D#
], 3, 26);  // 3rd note = Db fret 2 = D#

// Drop D: power chord arpeggio
arpeggio(DRD, [
  { stringIdx: 5, fret: 5, pos: 1 },   // D(6th) fret 5 = G
  { stringIdx: 4, fret: 5, pos: 5 },   // A fret 5 = D
  { stringIdx: 3, fret: 5, pos: 9 },   // D(4th) fret 5 = G
  { stringIdx: 2, fret: 4, pos: 13 },  // G fret 4 = B
  { stringIdx: 1, fret: 3, pos: 17 },  // B fret 3 = D
], 5, 22);  // 5th note = B fret 3 = D

// ──── More "note after" questions ────

noteAfterQuestion(STD, 5, [0, 3, 5, 7, 8, 7], 3);   // E string: after fret 7(B) → fret 8 = C
noteAfterQuestion(DRD, 2, [0, 2, 4, 5, 7, 9], 4);   // G string: after fret 7(D) → fret 9 = E
noteAfterQuestion(HSD, 1, [0, 1, 3, 5, 8, 10], 4);  // Bb: after fret 8(F#) → fret 10 = G#
noteAfterQuestion(DRB, 4, [0, 2, 4, 5, 7, 9], 2);   // Ab: after fret 4(C) → fret 5 = C#

// ──── More multi-string with complex questions ────

// Standard: bass + treble simultaneous notes, ask about 3rd note overall
arpeggio(STD, [
  { stringIdx: 5, fret: 0, pos: 1 },   // E
  { stringIdx: 0, fret: 0, pos: 1 },   // E (simultaneous)
  { stringIdx: 5, fret: 3, pos: 7 },   // G
  { stringIdx: 0, fret: 3, pos: 7 },   // G (simultaneous)
  { stringIdx: 4, fret: 2, pos: 13 },  // B
  { stringIdx: 1, fret: 0, pos: 13 },  // B (simultaneous)
], 5, 18);  // 5th note = sorted by pos then thickest: pos13 → A fret 2 = B

// ──── Additional riffs ────

// Standard: pull-off on B string (p between notes)
{
  const frets = [5, 3, 1, 0];
  const W = 24;
  const lines: TabLine[] = STD.strings.map((s, i) => {
    if (i === 1) {
      return { label: s.label, content: pad(`--${frets[0]}-p-${frets[1]}---${frets[2]}---${frets[3]}--`, W) };
    }
    return { label: s.label, content: emptyLine(W) };
  });
  const note = resolveNote(STD, 1, frets[3]);
  add(STD, lines, 'What is the last note played on the B string?', note);
}

// Half-Step Down: pull-off on Gb string
{
  const frets = [7, 5, 4, 2];
  const W = 24;
  const lines: TabLine[] = HSD.strings.map((s, i) => {
    if (i === 2) {
      return { label: s.label, content: pad(`--${frets[0]}-p-${frets[1]}---${frets[2]}---${frets[3]}--`, W) };
    }
    return { label: s.label, content: emptyLine(W) };
  });
  const note = resolveNote(HSD, 2, frets[1]);
  add(HSD, lines, `What is the 2nd note played on the Gb string?`, note);
}

// Drop D: complex riff on multiple strings
{
  const W = 30;
  const lines: TabLine[] = DRD.strings.map((s) => {
    return { label: s.label, content: emptyLine(W) };
  });
  // D(6th): ---0---0---0---0---
  lines[5].content = pad('---0-------0-------', W);
  // A:      -------0-------0---
  lines[4].content = pad('-------0-------0---', W);
  // D(4th): ---2---2---2---2---
  lines[3].content = pad('---2---2---2---2---', W);
  // G:      -0---0---0---0-----
  lines[2].content = pad('-0---0---0---0-----', W);

  // Events by position: G:1, D6:3, G:5, A:7, D4:7(tie), G:9, D6:11, D4:11, G:13, A:15, D4:15
  // 5th note overall = G:9 = G fret 0 = G
  add(DRD, lines, 'What is the 5th note played?', 'G');
}

// Standard: walking bass line on E and A strings
{
  const W = 26;
  const lines: TabLine[] = STD.strings.map((s) => {
    return { label: s.label, content: emptyLine(W) };
  });
  lines[5].content = pad('---0---3---5---7---', W);
  lines[4].content = pad('-------0---2---3---', W);

  // sorted by pos: E:3=E, E:7=G, A:7=A (tie, thickest), E:11=A, A:11=B, E:15=B, A:15=C, E:19... no
  // Actually let me recalculate positions
  // E: frets at pos 3,7,11,15  →  E,G,A,B
  // A: frets at pos 7,11,15    →  A,B,C
  // sorted: (3,E), (7,A-thickest=A), (7,E-string=G), (11,A=B), (11,E=A), (15,A=C), (15,E=B)
  // 6th note = A fret 3 at pos 15 = C
  add(STD, lines, 'What is the 6th note played?', 'C');
}

// ──── Strict spelling cases ────

// Standard: fret 1 on G string = G# (must say G# not Ab)
{
  const frets = [0, 1, 3, 5];
  melodyOnString(STD, 2, frets, 2); // Already added normally
  // Let's add a strict version separately
  const W = 4 + frets.length * 4;
  const lines: TabLine[] = STD.strings.map((s, i) => {
    if (i === 2) {
      const notes = frets.map(f => `-${f}-`).join('-');
      return { label: s.label, content: pad(`-${notes}`, W) };
    }
    return { label: s.label, content: emptyLine(W) };
  });
  const tc: TestCase = {
    id: makeId(),
    tuning: 'Standard',
    tab: buildTab(STD, lines),
    question: 'What is the 2nd note played on the G string?',
    answers: ['G#'],
    strict_spelling: true,
  };
  generated.push(tc);
}

// Half-Step Down: strict — fret 0 on Gb = must say Gb not F#
{
  const frets = [0, 2, 4, 5];
  const W = 4 + frets.length * 4;
  const lines: TabLine[] = HSD.strings.map((s, i) => {
    if (i === 2) {
      const notes = frets.map(f => `-${f}-`).join('-');
      return { label: s.label, content: pad(`-${notes}`, W) };
    }
    return { label: s.label, content: emptyLine(W) };
  });
  const tc: TestCase = {
    id: makeId(),
    tuning: 'Half-Step Down',
    tab: buildTab(HSD, lines),
    question: 'What is the first note played on the Gb string?',
    answers: ['Gb'],
    strict_spelling: true,
  };
  generated.push(tc);
}

// ──── High fret cases (12+) ────

melodyOnString(STD, 0, [12, 14, 15, 17, 19], 3);      // e fret 15 = G
melodyOnString(HSD, 3, [12, 14, 15, 17], 2);           // Db fret 14 = D
melodyOnString(DRD, 5, [12, 14, 15, 17, 19], 4);       // D(6th) fret 17 = E (wait: D + 17 semitones = D + 5 = G... let me recalculate)
// D = index 2. 2+17 = 19. 19 % 12 = 7 = G. Hmm wait... D=2, 2+12=14→D, 2+14=16%12=4=E, 2+15=17%12=5=F, 2+17=19%12=7=G
// So fret 17 on D = G. Let me fix.
// Actually I already called melodyOnString which will compute correctly. The answer will be computed by the function.

// More high fret
melodyOnString(DRB, 5, [0, 5, 12, 7, 3], 3);          // Db(6th) fret 12 = C#... Db=C#=1, 1+12=13%12=1 = C#

// ──── Two-bar patterns ────

// Standard: two measures with repeat
{
  const W = 38;
  const lines: TabLine[] = STD.strings.map((s) => {
    return { label: s.label, content: emptyLine(W) };
  });
  lines[0].content = pad('---0-----------0-----------', W);
  lines[1].content = pad('-----1---1-------1---1-----', W);
  lines[2].content = pad('-------0---0-------0---0---', W);
  lines[3].content = pad('-2-----------2-------------', W);
  // D:1=E, e:3=E, B:5=C, G:7=G, B:9=C, G:11=G, D:13=E, e:15=E, B:17=C, G:19=G, B:21=C, G:23=G
  // 7th note = D:13 = D fret 2 = E
  add(STD, lines, 'What is the 7th note played?', 'E');
}

// Half-Step Down: two-bar fingerpicking
{
  const W = 32;
  const lines: TabLine[] = HSD.strings.map((s) => {
    return { label: s.label, content: emptyLine(W) };
  });
  lines[4].content = pad('---0-----------2-----------', W);
  lines[3].content = pad('-----2---2-------4---4-----', W);
  lines[2].content = pad('-------2---2-------4---4---', W);
  // Ab:3=Ab, Db:5=D#, Gb:7=G#, Db:9=D#, Gb:11=G#, Ab:15=A#, Db:17=F, Gb:19=A#, Db:21=F, Gb:23=A#
  // 6th note = Ab:15 fret 2 = A# (Bb)
  add(HSD, lines, 'What is the 6th note played?', 'A#');
}

// ════════════════════════════════════════════════
//  OUTPUT
// ════════════════════════════════════════════════

// Verify all answers are valid notes
for (const tc of generated) {
  for (const a of tc.answers) {
    if (!SHARP_NAMES.includes(a) && !FLAT_NAMES.includes(a)) {
      console.error(`INVALID ANSWER in ${tc.id}: "${a}"`);
      process.exit(1);
    }
  }
}

// Verify "Nth note played" (overall) questions don't have simultaneous-note counting issues.
// Simultaneous notes (same horizontal position) are ONE temporal event, not N separate notes.
for (const tc of generated) {
  const q = tc.question;
  const isOverall = /(?:first|last|\d+\w+) note played\??$/.test(q) && !q.includes(' on the ');
  if (!isOverall) continue;

  const lines = tc.tab.split('\n');
  const positions = new Map<number, number>(); // pos → count of notes there
  for (const line of lines) {
    const pipeIdx = line.indexOf('|');
    if (pipeIdx < 0) continue;
    const content = line.slice(pipeIdx + 1).replace(/\|$/, '');
    let i = 0;
    while (i < content.length) {
      if (content[i] >= '0' && content[i] <= '9') {
        const pos = i;
        while (i + 1 < content.length && content[i + 1] >= '0' && content[i + 1] <= '9') i++;
        positions.set(pos, (positions.get(pos) ?? 0) + 1);
      }
      i++;
    }
  }

  const hasSim = [...positions.values()].some(c => c > 1);
  const eventCount = positions.size;
  const mNum = q.match(/(\d+)\w+ note/);
  const asked = mNum ? parseInt(mNum[1]) : q.includes('first') ? 1 : eventCount;

  if (hasSim) {
    console.error(`SIMULTANEOUS NOTES in ${tc.id}: "${q}" — use staggered positions for overall questions`);
    process.exit(1);
  }
  if (asked > eventCount) {
    console.error(`COUNT MISMATCH in ${tc.id}: asks for #${asked} but only ${eventCount} events`);
    process.exit(1);
  }
}

const args2 = process.argv.slice(2);

if (args2.includes('--merge')) {
  const existingPath = resolve('test-cases.json');
  let existing: TestCase[] = [];
  if (existsSync(existingPath)) {
    existing = JSON.parse(readFileSync(existingPath, 'utf-8'));
  }
  const merged = [...existing, ...generated];
  writeFileSync(existingPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`Merged: ${existing.length} existing + ${generated.length} new = ${merged.length} total`);
  console.log(`Written to ${existingPath}`);
} else if (args2.includes('--out')) {
  const outIdx = args2.indexOf('--out');
  const outPath = resolve(args2[outIdx + 1] || 'new-cases.json');
  writeFileSync(outPath, JSON.stringify(generated, null, 2) + '\n');
  console.log(`Written ${generated.length} new cases to ${outPath}`);
} else {
  // Summary stats
  const tuningCounts: Record<string, number> = {};
  const questionTypes: Record<string, number> = {};
  for (const tc of generated) {
    tuningCounts[tc.tuning] = (tuningCounts[tc.tuning] ?? 0) + 1;
    const type = tc.question.match(/^What is the (first|last|\d+\w+) note played\b(?! on)/i)
      ? 'nth-overall'
      : tc.question.includes('immediately after')
        ? 'note-after'
        : tc.question.includes('first note played on')
          ? 'first-on-string'
          : tc.question.includes('last note played on')
            ? 'last-on-string'
            : tc.question.match(/\d+(st|nd|rd|th) note played on/)
              ? 'nth-on-string'
              : 'single-chord';
    questionTypes[type] = (questionTypes[type] ?? 0) + 1;
  }
  console.log(`Generated ${generated.length} new test cases\n`);
  console.log('By tuning:');
  for (const [t, c] of Object.entries(tuningCounts)) console.log(`  ${t}: ${c}`);
  console.log('\nBy question type:');
  for (const [t, c] of Object.entries(questionTypes)) console.log(`  ${t}: ${c}`);
  console.log('\nUse --merge to append to test-cases.json');
  console.log('Use --out <file> to write to a separate file');
}
