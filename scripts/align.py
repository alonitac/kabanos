#!/usr/bin/env python3
"""
Parse transcript.md and align each dialogue line to Whisper timestamps.
Outputs data/scene-XX.json for each scene.

Manual edits: open data/scene-XX.json and adjust "start"/"end" (seconds) as needed.
"""

import json
import re
from pathlib import Path
from rapidfuzz import fuzz

REPO = Path(__file__).parent.parent
TRANSCRIPT = REPO / "transcript.md"
RAW_DIR = REPO / "data" / "raw"
DATA_DIR = REPO / "data"
SCENES = ["12", "15", "16", "17", "18"]

# Map known name variants to canonical name
ALIASES: dict[str, str] = {
    "קלאו": "קלאופטרה",
    "קלאופטרה": "קלאופטרה",
    "אנליאל": "אינליאל",
    "אנלי": "אינליאל",
    "רב": "הרב",
    "שמעון": "שמעון",
    "שימי": "שמעון",   # שמעון's nickname used in some lines
}

# Regex: Hebrew name (optionally followed by parenthetical stage note),
# then separator (:, ., tab, multiple spaces), then dialogue text.
_SEP = r'[\s]*(?:\([^)]+\)\s*)?[:\.\t]+'
CHAR_LINE_RE = re.compile(
    r'^([א-ת][א-ת\s"\']{0,20}?)' + _SEP + r'\s*(.+)$',
    re.UNICODE,
)
SCENE_HEADER_RE = re.compile(r'^תמונה\s+(\d+)', re.UNICODE)


# ── Transcript parsing ────────────────────────────────────────────────────────

def parse_transcript(path: Path) -> dict[str, list[tuple[str, str]]]:
    """Returns {scene_id: [(character, text), ...]}  — dialogue lines only."""
    scenes: dict[str, list] = {}
    current_scene = None

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()

        # Scene header
        m = SCENE_HEADER_RE.match(line)
        if m:
            current_scene = m.group(1)
            scenes[current_scene] = []
            continue

        if current_scene is None:
            continue

        # Stage direction — skip
        if not line or line.startswith(("(", "[", ")")):
            continue

        m = CHAR_LINE_RE.match(line)
        if m:
            char = m.group(1).strip().rstrip(".:")
            char = normalize_char(char)
            text = m.group(2).strip()
            scenes[current_scene].append((char, text))

    return scenes


def normalize_char(name: str) -> str:
    name = name.strip().rstrip(".")
    return ALIASES.get(name, name)


# ── Whisper alignment ─────────────────────────────────────────────────────────

def normalize_hebrew(text: str) -> str:
    """Strip non-Hebrew characters for fuzzy comparison."""
    return re.sub(r'[^\u05d0-\u05ea]', '', text)


def align_scene(
    lines: list[tuple[str, str]],
    segments: list[dict],
) -> list[dict]:
    """
    Greedy sequential alignment: for each transcript line, search the next
    window of Whisper segments for the best fuzzy match.
    """
    results = []
    seg_ptr = 0

    for idx, (char, text) in enumerate(lines):
        norm_text = normalize_hebrew(text)
        best_score = 0
        best_seg_idx = -1
        window_end = min(seg_ptr + 20, len(segments))

        for i in range(seg_ptr, window_end):
            norm_seg = normalize_hebrew(segments[i]["text"])
            score = fuzz.partial_ratio(norm_text, norm_seg)
            if score > best_score:
                best_score = score
                best_seg_idx = i

        if best_score >= 60 and best_seg_idx >= 0:
            seg = segments[best_seg_idx]
            results.append({
                "id": idx + 1,
                "character": char,
                "text": text,
                "start": round(float(seg["start"]), 2),
                "end": round(float(seg["end"]), 2),
            })
            seg_ptr = best_seg_idx + 1
        else:
            # Alignment failed — needs manual fix
            print(f"  \u26a0 No match for [{char}]: '{text[:40]}' (score={best_score})")
            results.append({
                "id": idx + 1,
                "character": char,
                "text": text,
                "start": None,
                "end": None,
            })

    return results


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    transcript_scenes = parse_transcript(TRANSCRIPT)

    for scene in SCENES:
        raw_path = RAW_DIR / f"scene-{scene}-whisper.json"
        if not raw_path.exists():
            print(f"[{scene}] Raw Whisper JSON not found — run transcribe.py first.")
            continue

        whisper = json.loads(raw_path.read_text(encoding="utf-8"))
        segments = whisper.get("segments", [])
        lines = transcript_scenes.get(scene, [])

        if not lines:
            print(f"[{scene}] No transcript lines found.")
            continue

        print(f"[{scene}] Aligning {len(lines)} lines against {len(segments)} segments …")
        aligned = align_scene(lines, segments)

        characters = list(dict.fromkeys(
            ln["character"] for ln in aligned if ln["character"] != "כולם"
        ))

        out = {
            "scene": scene,
            "characters": characters,
            "lines": aligned,
        }

        out_path = DATA_DIR / f"scene-{scene}.json"
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        nulls = sum(1 for ln in aligned if ln["start"] is None)
        print(f"[{scene}] Saved → {out_path}  ({nulls} lines need manual timestamps)")


if __name__ == "__main__":
    main()
