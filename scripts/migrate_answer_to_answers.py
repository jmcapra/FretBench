#!/usr/bin/env python3
"""
Migrate test-cases.json from "answer" (string) to "answers" (list) with
enharmonic equivalents. Run from repo root.
"""
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TEST_CASES_PATH = REPO_ROOT / "test-cases.json"

# Common guitar enharmonic equivalents (sharp/flat pairs only).
# Natural notes (C, D, E, F, G, A, B) have no second spelling here so answers stay single.
ENHARMONIC_MAP = {
    "C#": "Db", "Db": "C#",
    "D#": "Eb", "Eb": "D#",
    "F#": "Gb", "Gb": "F#",
    "G#": "Ab", "Ab": "G#",
    "A#": "Bb", "Bb": "A#",
}


def answers_for_note(note: str) -> list[str]:
    """Return [note] plus enharmonic equivalent if any (dedupe, stable order)."""
    equiv = ENHARMONIC_MAP.get(note)
    if equiv is None:
        return [note]
    # Prefer [sharp, flat] order for consistency when both exist
    sharp_first = note.endswith("#") or note in ("B", "E", "F", "C")
    if sharp_first:
        return [note, equiv]
    return [equiv, note]


def main() -> None:
    with open(TEST_CASES_PATH, encoding="utf-8") as f:
        cases = json.load(f)

    for case in cases:
        if "answer" in case:
            note = case.pop("answer")
            case["answers"] = answers_for_note(note)
        # Optional: add strict_spelling only when we have scale-degree questions
        # if case.get("strict_spelling") is None:
        #     case["strict_spelling"] = False

    with open(TEST_CASES_PATH, "w", encoding="utf-8") as f:
        json.dump(cases, f, indent=2, ensure_ascii=False)

    print(f"Migrated {len(cases)} cases to 'answers' with enharmonics.")


if __name__ == "__main__":
    main()
