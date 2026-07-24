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
  cueBanner.hidden = (next !== STATES.YOUR_TURN);
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
      activeCue = line;
      cued.add(line.id);
      clearTimeout(reviewTimer);
      reviewStrip.hidden = true;
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

  // Show strip AFTER play() so the play→PLAYING transition doesn't hide it
  reviewStrip.hidden = false;

  // Auto-hide review strip after 4 seconds
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(() => {
    if (state === STATES.RESUMING || state === STATES.PLAYING) {
      reviewStrip.hidden = true;
    }
  }, 4000);
});
