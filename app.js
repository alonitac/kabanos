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
const reviewStrip  = document.getElementById('review-strip');
const reviewText   = document.getElementById('review-text');

// ── Helpers ────────────────────────────────────────────────────────────────
function setState(next) {
  state = next;
}

function resetSession() {
  cued.clear();
  activeCue = null;
  clearTimeout(reviewTimer);
  reviewStrip.hidden = true;
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
  if (state === STATES.YOUR_TURN) {
    // Skip past the recorded version of the actor's line
    if (activeCue && activeCue.end !== null) audio.currentTime = activeCue.end;
    reviewText.textContent = activeCue ? activeCue.text : '';
    activeCue = null;
    reviewStrip.hidden = false;
    clearTimeout(reviewTimer);
    reviewTimer = setTimeout(() => { reviewStrip.hidden = true; }, 4000);
    setState(STATES.PLAYING);
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
      activeCue = line;
      cued.add(line.id);
      clearTimeout(reviewTimer);
      reviewStrip.hidden = true;
      setState(STATES.YOUR_TURN);
      break;
    }
  }
});


