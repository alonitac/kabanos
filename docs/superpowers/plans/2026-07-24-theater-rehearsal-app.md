# Theater Rehearsal App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static GitHub Pages app where theater actors select their scene and role, then practise their lines with an audio cue system.

**Architecture:** Python scripts (offline, one-time) run Whisper on each MP3 and produce timestamped JSON files; a vanilla JS single-page app reads those JSON files and controls an HTML5 `<audio>` element to pause at each cue and skip past it when the actor clicks continue.

**Tech Stack:** Python 3.10+, openai, rapidfuzz (scripts) · Vanilla HTML/CSS/JS, no framework (app) · GitHub Pages (hosting)

## Global Constraints

- All app files served statically — no server-side code
- RTL layout (`dir="rtl"`, `lang="he"`) throughout
- Mobile-first: minimum tap target 48×48px
- No external CDN dependencies at runtime — app must work offline after initial load
- `כולם` character name triggers cue for all roles
- Timestamps in seconds (float, 2 decimal places)
- `scripts/` folder is build tooling only — not committed to GitHub Pages branch

---

## File Map

| File | Responsibility |
|------|---------------|
| `scripts/requirements.txt` | Python deps for the pipeline |
| `scripts/transcribe.py` | Calls OpenAI Whisper API for each MP3, saves raw JSON |
| `scripts/align.py` | Parses transcript.md + aligns to Whisper segments → scene JSON |
| `data/raw/scene-XX-whisper.json` | Raw Whisper output (keep for debugging) |
| `data/scene-12.json` … `data/scene-18.json` | Timestamped line data consumed by the app |
| `audio/תמונה 12.mp3` … | Scene recordings |
| `index.html` | App markup: dropdowns, audio element, cue banner, review strip |
| `styles.css` | RTL mobile-first styles, green cue state |
| `app.js` | State machine, cue detection, DOM wiring |

---

## Task 1: Project Scaffold

**Files:**
- Create: `audio/` directory (MP3s moved here)
- Create: `scripts/`
- Create: `data/raw/`
- Create: `.gitignore`

**Interfaces:**
- Produces: stable folder structure all other tasks depend on

- [ ] **Step 1: Move MP3s into `audio/`**

```bash
cd /home/alon/Documents/Kabanos
mkdir -p audio data/raw scripts
mv "תמונה 12.mp3" "תמונה 15.mp3" "תמונה 16.mp3" "תמונה 17.mp3" "תמונה 18.mp3" audio/
```

- [ ] **Step 2: Create `.gitignore`**

```
data/raw/
scripts/__pycache__/
*.pyc
.env
```

- [ ] **Step 3: Init git repo**

```bash
git init
git add .gitignore transcript.md audio/ docs/
git commit -m "chore: project scaffold"
```

- [ ] **Step 4: Verify**

```bash
ls audio/          # should list 5 MP3 files
ls data/raw/       # empty for now
```

---

## Task 2: Whisper Transcription Script

**Files:**
- Create: `scripts/requirements.txt`
- Create: `scripts/transcribe.py`

**Interfaces:**
- Consumes: `audio/תמונה XX.mp3` for scenes 12, 15, 16, 17, 18
- Produces: `data/raw/scene-XX-whisper.json` — Whisper verbose JSON with `segments` and `words` arrays

- [ ] **Step 1: Create `scripts/requirements.txt`**

```
openai>=1.0.0
rapidfuzz>=3.0.0
```

- [ ] **Step 2: Install deps**

```bash
pip3 install -r scripts/requirements.txt
```

Expected: no errors.

- [ ] **Step 3: Create `scripts/transcribe.py`**

```python
#!/usr/bin/env python3
"""Call OpenAI Whisper API on each scene MP3 and save raw timestamped output."""

import json
import os
from pathlib import Path
from openai import OpenAI

client = OpenAI()  # reads OPENAI_API_KEY from environment

REPO = Path(__file__).parent.parent
AUDIO_DIR = REPO / "audio"
RAW_DIR = REPO / "data" / "raw"
SCENES = ["12", "15", "16", "17", "18"]

# Prime Whisper with character names and context to improve Hebrew accuracy
PROMPT = (
    "מחזה תיאטרון בעברית. שחקנים: הרב, קלאופטרה, שימי, לילי, "
    "אינליאל, שיראל, דיצה, ברונו, כרמלה, מישה, שרה, בנבנישתי. "
    "דיאלוג רציף, עברית מדוברת."
)


def transcribe(scene: str) -> dict:
    audio_path = AUDIO_DIR / f"תמונה {scene}.mp3"
    print(f"[{scene}] Transcribing {audio_path.name} …")
    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            language="he",
            response_format="verbose_json",
            timestamp_granularities=["segment", "word"],
            prompt=PROMPT,
        )
    return response.model_dump()


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for scene in SCENES:
        out = RAW_DIR / f"scene-{scene}-whisper.json"
        if out.exists():
            print(f"[{scene}] Already done, skipping.")
            continue
        data = transcribe(scene)
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[{scene}] Saved → {out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Set your OpenAI API key and run**

```bash
export OPENAI_API_KEY="sk-..."      # replace with your key
python3 scripts/transcribe.py
```

Expected: 5 files created in `data/raw/`, one per scene. Each file is ~50–200 KB of JSON.

- [ ] **Step 5: Spot-check raw output**

```bash
python3 -c "
import json
d = json.load(open('data/raw/scene-12-whisper.json'))
print('segments:', len(d['segments']))
print('words:', len(d.get('words', [])))
print('first segment:', d['segments'][0])
"
```

Expected: segments count > 0, first segment has `start`, `end`, `text` keys.

---

## Task 3: Alignment Script

**Files:**
- Create: `scripts/align.py`

**Interfaces:**
- Consumes:
  - `transcript.md` (plain text, UTF-8)
  - `data/raw/scene-XX-whisper.json` — dict with `segments: [{start, end, text}]`
- Produces:
  - `data/scene-XX.json` — `{scene, characters, lines: [{id, character, text, start, end}]}`
  - Lines where alignment failed have `start: null, end: null` (fix manually)

- [ ] **Step 1: Create `scripts/align.py`**

```python
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
    continuation_buffer = ""  # for multi-part lines split across physical lines

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()

        # Scene header
        m = SCENE_HEADER_RE.match(line)
        if m:
            current_scene = m.group(1)
            scenes[current_scene] = []
            continuation_buffer = ""
            continue

        if current_scene is None:
            continue

        # Stage direction — skip
        if not line or line.startswith(("(", "[", ")")):
            continuation_buffer = ""
            continue

        m = CHAR_LINE_RE.match(line)
        if m:
            char = m.group(1).strip().rstrip(".:")
            char = normalize_char(char)
            text = m.group(2).strip()
            scenes[current_scene].append((char, text))
            continuation_buffer = char  # remember last speaker for continuation
        else:
            # Might be a continuation of previous speaker's text — skip for safety
            # (these are rare edge cases; user can fix timestamps manually)
            pass

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
            print(f"  ⚠ No match for [{char}]: "{text[:40]}" (score={best_score})")
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
```

- [ ] **Step 2: Run alignment**

```bash
python3 scripts/align.py
```

Expected: 5 JSON files in `data/`. Output shows ⚠ warnings for any lines that couldn't be matched — note those line IDs for manual correction.

- [ ] **Step 3: Inspect and manually fix timestamps**

```bash
# Check one scene — look for "start": null entries
grep -n '"start": null' data/scene-12.json
```

For each `null` line, play the MP3 in any audio player, find where that line starts, and edit the JSON:
```json
{ "id": 7, "character": "הרב", "text": "שלום עליכם!", "start": 23.40, "end": 25.10 }
```

- [ ] **Step 4: Commit data files**

```bash
git add data/
git commit -m "feat: add timestamped scene data"
```

---

## Task 4: App HTML + CSS

**Files:**
- Create: `index.html`
- Create: `styles.css`

**Interfaces:**
- Produces: DOM structure consumed by `app.js`
  - `#scene-select` — `<select>`
  - `#role-select` — `<select>`
  - `#audio` — `<audio>` element
  - `#cue-banner` — hidden div, shown in YOUR_TURN state
  - `#continue-btn` — button inside cue-banner
  - `#review-strip` — hidden div, shown in RESUMING state
  - `#review-text` — span inside review-strip

- [ ] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>קבנוס – חזרות</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div class="container">

    <!-- Selectors -->
    <div class="selectors">
      <label class="selector-label">
        <span>תמונה</span>
        <select id="scene-select">
          <option value="">— בחר —</option>
          <option value="12">12</option>
          <option value="15">15</option>
          <option value="16">16</option>
          <option value="17">17</option>
          <option value="18">18</option>
        </select>
      </label>

      <label class="selector-label">
        <span>תפקיד</span>
        <select id="role-select" disabled>
          <option value="">— בחר —</option>
        </select>
      </label>
    </div>

    <!-- Audio player -->
    <div id="player-wrap" hidden>
      <audio id="audio" controls preload="metadata"></audio>
    </div>

    <!-- Cue banner (YOUR_TURN state) -->
    <div id="cue-banner" class="cue-banner" hidden>
      <div class="cue-light">🟢</div>
      <div class="cue-label">תורך!</div>
      <button id="continue-btn" class="continue-btn">המשך ▶</button>
    </div>

    <!-- Review strip (RESUMING state) -->
    <div id="review-strip" class="review-strip" hidden>
      <span class="review-label">מה שאמרת:</span>
      <span id="review-text"></span>
    </div>

  </div>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `styles.css`**

```css
/* Reset & base */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Segoe UI', Arial, sans-serif;
  background: #1a1a2e;
  color: #eee;
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 1.5rem 1rem;
}

.container {
  width: 100%;
  max-width: 540px;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* Selectors */
.selectors {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.selector-label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
  min-width: 120px;
}

.selector-label span {
  font-size: 0.85rem;
  color: #aaa;
  font-weight: 600;
  letter-spacing: 0.05em;
}

select {
  width: 100%;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #444;
  background: #16213e;
  color: #eee;
  font-size: 1.1rem;
  min-height: 48px;
  cursor: pointer;
}
select:disabled { opacity: 0.45; cursor: not-allowed; }

/* Audio player */
#player-wrap { width: 100%; }
audio { width: 100%; border-radius: 8px; }

/* Cue banner */
.cue-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  background: #0f3d0f;
  border: 2px solid #2ecc71;
  border-radius: 16px;
  padding: 2rem 1.5rem;
  animation: pulse-border 1.2s ease-in-out infinite;
}

@keyframes pulse-border {
  0%, 100% { border-color: #2ecc71; box-shadow: 0 0 0 0 rgba(46,204,113,0.4); }
  50%       { border-color: #58d68d; box-shadow: 0 0 0 8px rgba(46,204,113,0); }
}

.cue-light { font-size: 3rem; }

.cue-label {
  font-size: 2.2rem;
  font-weight: 700;
  color: #2ecc71;
  letter-spacing: 0.04em;
}

.continue-btn {
  margin-top: 0.5rem;
  padding: 0.75rem 2.5rem;
  font-size: 1.15rem;
  font-weight: 600;
  background: #2ecc71;
  color: #0a0a0a;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  min-height: 48px;
  transition: background 0.15s;
}
.continue-btn:hover { background: #27ae60; }
.continue-btn:active { background: #1e8449; }

/* Review strip */
.review-strip {
  background: #1c1c3a;
  border-right: 4px solid #7f8ff4;
  border-radius: 8px;
  padding: 0.85rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  animation: fade-in 0.3s ease;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.review-label {
  font-size: 0.78rem;
  color: #888;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

#review-text {
  font-size: 1.15rem;
  line-height: 1.5;
  color: #c8d0ff;
}
```

- [ ] **Step 3: Open in browser and verify layout**

```bash
# Open from file system (no server needed for this step)
xdg-open index.html
```

Expected: dark background, RTL layout, two dropdowns visible. No console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat: add app HTML and CSS"
```

---

## Task 5: App JavaScript

**Files:**
- Create: `app.js`

**Interfaces:**
- Consumes:
  - DOM IDs: `#scene-select`, `#role-select`, `#player-wrap`, `#audio`, `#cue-banner`, `#continue-btn`, `#review-strip`, `#review-text`
  - `data/scene-XX.json` — `{scene, characters, lines: [{id, character, text, start, end}]}`
  - `audio/תמונה XX.mp3`
- Produces: working cue system in browser

- [ ] **Step 1: Create `app.js`**

```javascript
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const STATES = { IDLE: 'IDLE', PLAYING: 'PLAYING', YOUR_TURN: 'YOUR_TURN', RESUMING: 'RESUMING' };
let state = STATES.IDLE;
let sceneData = null;       // parsed scene JSON
let selectedRole = null;    // string character name
let cued = new Set();       // line IDs already triggered this session
let activeCue = null;       // current line being cued
let reviewTimer = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const sceneSelect  = document.getElementById('scene-select');
const roleSelect   = document.getElementById('role-select');
const playerWrap   = document.getElementById('player-wrap');
const audio        = document.getElementById('audio');
const cueBanner    = document.getElementById('cue-banner');
const continueBtn  = document.getElementById('continue-btn');
const reviewStrip  = document.getElementById('review-strip');
const reviewText   = document.getElementById('review-text');

// ── Helpers ────────────────────────────────────────────────────────────────
function setState(next) {
  state = next;
  cueBanner.hidden  = (next !== STATES.YOUR_TURN);
  reviewStrip.hidden = (next !== STATES.RESUMING);
}

function resetSession() {
  cued.clear();
  activeCue = null;
  clearTimeout(reviewTimer);
  setState(STATES.IDLE);
}

// ── Scene select ───────────────────────────────────────────────────────────
sceneSelect.addEventListener('change', async () => {
  const scene = sceneSelect.value;
  roleSelect.innerHTML = '<option value="">— בחר —</option>';
  roleSelect.disabled = true;
  playerWrap.hidden = true;
  audio.pause();
  resetSession();
  selectedRole = null;

  if (!scene) return;

  try {
    sceneData = await fetch(`data/scene-${scene}.json`).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  } catch (err) {
    alert(`שגיאה בטעינת תמונה ${scene}: ${err.message}`);
    return;
  }

  for (const char of sceneData.characters) {
    const opt = document.createElement('option');
    opt.value = char;
    opt.textContent = char;
    roleSelect.appendChild(opt);
  }
  roleSelect.disabled = false;
});

// ── Role select ────────────────────────────────────────────────────────────
roleSelect.addEventListener('change', () => {
  selectedRole = roleSelect.value || null;
  audio.pause();
  resetSession();

  if (!selectedRole || !sceneData) {
    playerWrap.hidden = true;
    return;
  }

  const scene = sceneSelect.value;
  audio.src = `audio/תמונה ${scene}.mp3`;
  audio.load();
  playerWrap.hidden = false;
});

// ── Audio events ───────────────────────────────────────────────────────────
audio.addEventListener('play', () => {
  // Prevent play while waiting for actor
  if (state === STATES.YOUR_TURN) {
    audio.pause();
    return;
  }
  if (state === STATES.IDLE || state === STATES.RESUMING) {
    setState(STATES.PLAYING);
  }
});

audio.addEventListener('pause', () => {
  // Only update state if we didn't pause ourselves for a cue
  if (state === STATES.PLAYING) {
    setState(STATES.IDLE);
  }
});

// ── Cue detection ──────────────────────────────────────────────────────────
const LOOKAHEAD = 0.15; // seconds — pause slightly before the line starts

audio.addEventListener('timeupdate', () => {
  if (state !== STATES.PLAYING || !sceneData || !selectedRole) return;

  const t = audio.currentTime;

  for (const line of sceneData.lines) {
    if (cued.has(line.id)) continue;
    if (line.start === null) continue;

    const isActorLine = (line.character === selectedRole || line.character === 'כולם');
    if (!isActorLine) continue;

    if (t >= line.start - LOOKAHEAD) {
      audio.pause();
      // Snap to exact cue start so skip lands right
      audio.currentTime = line.start;
      activeCue = line;
      cued.add(line.id);
      clearTimeout(reviewTimer);
      setState(STATES.YOUR_TURN);
      break;
    }
  }
});

// ── Continue button ────────────────────────────────────────────────────────
continueBtn.addEventListener('click', () => {
  if (state !== STATES.YOUR_TURN || !activeCue) return;

  const line = activeCue;
  activeCue = null;

  // Show the line text so actor can verify
  reviewText.textContent = line.text;
  setState(STATES.RESUMING);

  // Skip past the recorded line and resume
  audio.currentTime = line.end;
  audio.play().catch(() => {}); // ignore autoplay policy errors

  // Auto-hide review strip after 4 seconds
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(() => {
    if (state === STATES.RESUMING || state === STATES.PLAYING) {
      reviewStrip.hidden = true;
    }
  }, 4000);
});
```

- [ ] **Step 2: Start a local HTTP server**

The app fetches JSON files — it needs a server (file:// doesn't support fetch).

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a browser.

- [ ] **Step 3: Manual test — full flow**

1. Select תמונה 12
2. Select a role (e.g. הרב)
3. Click play on the audio player
4. Verify audio plays and stops at the first הרב line
5. Verify green banner appears, audio is paused
6. Click "המשך ▶"
7. Verify the actor's line text appears in the review strip
8. Verify audio resumes from after the recorded line
9. Verify next הרב cue triggers correctly
10. Verify review strip fades after ~4 seconds

- [ ] **Step 4: Test כולם lines**

Select any role, play until a `כולם` line — banner should appear for all roles.

- [ ] **Step 5: Test role/scene change resets properly**

Change the role dropdown mid-playback — verify audio stops and cue state clears.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: add cue player state machine"
```

---

## Task 6: GitHub Pages Deploy

**Files:**
- Create: `README.md` (minimal)

**Interfaces:**
- Consumes: all files in repo root
- Produces: public URL on GitHub Pages

- [ ] **Step 1: Create a GitHub repository**

Go to https://github.com/new, create a public repo named `kabanos` (or similar), copy the remote URL.

- [ ] **Step 2: Create minimal `README.md`**

```markdown
# קבנוס – חזרות

Theater rehearsal cue app for the Kabanos production.

**Live:** https://YOUR-USERNAME.github.io/kabanos/
```

- [ ] **Step 3: Push to GitHub**

```bash
git remote add origin https://github.com/YOUR-USERNAME/kabanos.git
git branch -M main
git add README.md
git commit -m "docs: add README"
git push -u origin main
```

Note: audio files are ~66 MB total. Git may be slow on first push. This is within GitHub's limits.

- [ ] **Step 4: Enable GitHub Pages**

In the repo Settings → Pages → Source: **Deploy from a branch** → Branch: `main` → Folder: `/` (root) → Save.

- [ ] **Step 5: Verify live URL**

Wait ~1 minute, then open `https://YOUR-USERNAME.github.io/kabanos/`.

Expected: app loads, dropdowns work, audio plays.

- [ ] **Step 6: If audio files are too slow to push via HTTPS, use SSH**

```bash
git remote set-url origin git@github.com:YOUR-USERNAME/kabanos.git
git push -u origin main
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Scene selector (12/15/16/17/18) — Task 4, `index.html`
- ✅ Role selector populated from scene JSON — Task 5, `sceneSelect` handler
- ✅ Audio plays, stops at actor's cue — `timeupdate` + `YOUR_TURN` state
- ✅ Green cue indicator — `.cue-banner` with pulsing border
- ✅ Click play → skip recorded line → review text appears — `continueBtn` handler
- ✅ כולם lines cue all roles — `line.character === 'כולם'` check in Task 5
- ✅ RTL mobile-first — `dir="rtl"`, flexbox, 48px min targets
- ✅ GitHub Pages static — no server-side code anywhere
- ✅ Manual JSON editing supported — simple format, null for missing timestamps

**Edge cases handled:**
- Autoplay policy: `audio.play()` wrapped in `.catch(() => {})` 
- User clicking native audio play during YOUR_TURN: blocked in the `play` event listener
- Role/scene change mid-playback: resets all state
- Lines with `null` timestamps: skipped in cue detection
