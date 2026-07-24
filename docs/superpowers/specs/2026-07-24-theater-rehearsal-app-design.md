# Theater Rehearsal App — Design Spec
**Date:** 2026-07-24  
**Project:** Kabanos — group text-learning tool  
**Deployment:** GitHub Pages (fully static, no backend)

---

## Overview

A single-page web app that plays a theater scene recording and stops playback at every line belonging to the selected role, cueing the actor to say their line from memory. After clicking play, the app skips past the recorded line and shows it as a text confirmation before resuming.

---

## Architecture

```
Kabanos/
├── index.html             # single-page app (all screens in one HTML)
├── app.js                 # vanilla JS, no framework
├── styles.css             # RTL, mobile-first
├── data/
│   ├── scene-12.json      # timestamped lines for scene 12
│   ├── scene-15.json
│   ├── scene-16.json
│   ├── scene-17.json
│   └── scene-18.json
├── audio/
│   ├── תמונה 12.mp3
│   ├── תמונה 15.mp3
│   ├── תמונה 16.mp3
│   ├── תמונה 17.mp3
│   └── תמונה 18.mp3
└── scripts/               # build tooling only, not served
    ├── transcribe.py      # calls OpenAI Whisper API, saves raw JSON
    └── align.py           # aligns transcript.md lines to timestamps
```

---

## Data Format

Each `data/scene-XX.json`:

```json
{
  "scene": "12",
  "characters": ["אינליאל", "דיצה", "הרב", "קלאופטרה", "מישה", "כרמלה", "שיראל", "שמעון"],
  "lines": [
    { "id": 1, "character": "אינליאל", "text": "מר בנבנישתי!", "start": 0.5, "end": 1.8 },
    { "id": 2, "character": "דיצה", "text": "מה? דפק נפקדות?", "start": 2.1, "end": 4.0 }
  ]
}
```

- Stage directions (parenthetical text) are excluded
- `start`/`end` are in seconds
- Manual edits to the JSON are expected and supported — the format is intentionally simple

---

## UX Design

### Single Screen Layout (top → bottom)

```
┌─────────────────────────────────────┐
│  תמונה: [12 ▼]   תפקיד: [הרב ▼]   │  ← dropdowns always at top
├─────────────────────────────────────┤
│                                     │
│        [  ▶ / ⏸  ]  ━━━━━━━━━━     │  ← audio player + scrubber
│                                     │
│  ┌─────────────────────────────┐    │
│  │       תורך! 🟢              │    │  ← CUE STATE: shown when paused
│  └─────────────────────────────┘    │
│                                     │
│  ─── מה שאמרת: ───────────────     │  ← REVIEW STRIP: shown briefly after
│  "אני מסכים. נו, יהודים?"          │    clicking play, then fades out
│                                     │
└─────────────────────────────────────┘
```

### State Machine

| State | Visible | Audio |
|-------|---------|-------|
| `PLAYING` | Scrubber advancing | Plays normally |
| `YOUR_TURN` | Big green "תורך!" banner | Paused at cue start |
| `RESUMING` | Review strip with line text | Playing (seeked past cue) |

**Transitions:**
- `PLAYING → YOUR_TURN`: `audio.currentTime` crosses a cue's `start` for the selected role
- `YOUR_TURN → RESUMING`: user taps Play → seek to cue's `end`, resume audio, show review strip
- `RESUMING → PLAYING`: review strip fades after 4 seconds (or at next cue)
- `PLAYING → YOUR_TURN` again: next cue of selected role reached

### Behavior Details
- Each cue triggers once (tracked by line `id` to prevent re-triggering on scrub)
- Changing the Scene or Role dropdown reloads data and resets playback
- RTL layout throughout (Hebrew-first)
- Mobile-first: large tap targets (min 48px), works without hover

---

## Whisper Pipeline

### Step 1 — Transcription (`scripts/transcribe.py`)

Uses the OpenAI Whisper API (`whisper-1`) with word-level timestamps.

**Best API prompt for Hebrew theater:**
```
מחזה תיאטרון בעברית. שחקנים: הרב, קלאופטרה, שימי, לילי, אינליאל, שיראל, דיצה, ברונו, כרמלה, מישה, שרה. דיאלוג רציף, עברית מדוברת.
```

API call parameters:
- `model="whisper-1"`
- `language="he"`
- `response_format="verbose_json"`
- `timestamp_granularities=["segment", "word"]`

Output: `data/raw/scene-XX-whisper.json` (raw Whisper output, kept for debugging)

### Step 2 — Alignment (`scripts/align.py`)

1. Parse `transcript.md` → extract scenes and character lines (skip stage directions)
2. Load Whisper JSON for the scene → flatten all words with timestamps
3. For each transcript line: fuzzy-match the line text against the Whisper word stream using `rapidfuzz` string similarity
4. Assign matched span's first-word `start` and last-word `end` to the transcript line
5. Write `data/scene-XX.json`

**Manual correction:** Edit `data/scene-XX.json` directly. Timestamps are in seconds, decimal precision. The format is intentionally simple for easy hand-tuning.

---

## Implementation Notes

- No build step, no bundler — plain HTML/CSS/JS
- `<audio>` element with `timeupdate` event for cue detection (fires ~4x/sec)
- Cue detection uses a small lookahead (0.1s) to avoid missing cues due to `timeupdate` granularity
- All character name comparisons are exact string matches (from the JSON)
- `transcript.md` uses inconsistent name formats (`הרב.` vs `הרב`, periods/colons/tabs vary per line); `align.py` must normalize these before parsing
- Lines attributed to `כולם` (everyone) are treated as a cue for every role — any selected actor will be prompted to say the line
- The `scripts/` folder requires Python 3.10+, `openai`, `rapidfuzz` packages

---

## Out of Scope

- Multi-user / sync features
- Backend of any kind
- Audio recording of the actor
- Speaker diarization (not needed — transcript already has character labels)
