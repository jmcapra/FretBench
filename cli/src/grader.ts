/**
 * Grading logic for FretBench responses.
 * Pure functions, no I/O.
 */

export interface TestCase {
  id: string;
  tuning: string;
  tab: string;
  question: string;
  answers: string[];
  strict_spelling?: boolean;
}

export interface GradeResult {
  extracted: string | null;
  correct: boolean;
}

/** Bidirectional enharmonic equivalents. */
const ENHARMONIC_MAP: Record<string, string> = {
  'C#': 'Db',
  'Db': 'C#',
  'D#': 'Eb',
  'Eb': 'D#',
  'F#': 'Gb',
  'Gb': 'F#',
  'G#': 'Ab',
  'Ab': 'G#',
  'A#': 'Bb',
  'Bb': 'A#',
};

/**
 * Normalize a raw model response to extract a note name.
 * Trims whitespace, strips quotes/backticks/periods, then extracts
 * the first token matching a note name pattern.
 */
export function normalizeResponse(raw: string): string | null {
  let cleaned = raw.trim();

  // Strip surrounding quotes and backticks
  cleaned = cleaned.replace(/^[`'"]+|[`'"]+$/g, '');

  // Strip trailing periods
  cleaned = cleaned.replace(/\.+$/, '');

  cleaned = cleaned.trim();

  // Extract first token matching a note name: letter A-G optionally followed by # or b
  const match = cleaned.match(/\b([A-Ga-g][#b]?)\b/);
  if (!match) return null;

  const note = match[1];
  // Capitalize the letter, preserve accidental
  return note.charAt(0).toUpperCase() + note.slice(1);
}

/**
 * Grade a model response against a test case.
 */
export function grade(response: string, testCase: TestCase): GradeResult {
  const extracted = normalizeResponse(response);

  if (extracted === null) {
    return { extracted: null, correct: false };
  }

  // Case-insensitive comparison against accepted answers
  const answersLower = testCase.answers.map(a => a.toLowerCase());
  const extractedLower = extracted.toLowerCase();

  if (answersLower.includes(extractedLower)) {
    return { extracted, correct: true };
  }

  // If strict_spelling, no enharmonic fallback
  if (testCase.strict_spelling) {
    return { extracted, correct: false };
  }

  // Check enharmonic equivalent
  const enharmonic = ENHARMONIC_MAP[extracted];
  if (enharmonic && answersLower.includes(enharmonic.toLowerCase())) {
    return { extracted, correct: true };
  }

  return { extracted, correct: false };
}
