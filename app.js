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
      // Interpolated lines have approximate timestamps — show yellow warning
      cueBanner.classList.toggle('interpolated', !!line.interpolated);
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
  if (line.end !== null) audio.currentTime = line.end;
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

// ── Edit mode ──────────────────────────────────────────────────────────────
// Active only when URL has ?edit=1 AND the page is served via scripts/serve.py
// (i.e. not on GitHub Pages where the /api/ endpoint doesn't exist).

const EDIT_MODE = new URLSearchParams(location.search).get('edit') === '1';

if (EDIT_MODE) {
  const editPanel    = document.getElementById('edit-panel');
  const editClock    = document.getElementById('edit-clock');
  const editId       = document.getElementById('edit-id');
  const editStart    = document.getElementById('edit-start');
  const editEnd      = document.getElementById('edit-end');
  const editStatus   = document.getElementById('edit-status');
  const editLineList = document.getElementById('edit-line-list');
  const btnMarkStart = document.getElementById('btn-mark-start');
  const btnMarkEnd   = document.getElementById('btn-mark-end');
  const btnSave      = document.getElementById('btn-save-line');

  editPanel.hidden = false;

  // Live clock
  audio.addEventListener('timeupdate', () => {
    editClock.textContent = audio.currentTime.toFixed(2);
  });

  // Mark buttons
  btnMarkStart.addEventListener('click', () => {
    editStart.value = audio.currentTime.toFixed(2);
  });
  btnMarkEnd.addEventListener('click', () => {
    editEnd.value = audio.currentTime.toFixed(2);
  });

  // Auto-fill line ID when a cue fires
  const _origTimeupdate = audio.ontimeupdate;
  audio.addEventListener('timeupdate', () => {
    if (activeCue) editId.value = activeCue.id;
  });

  // Rebuild line list when scene loads
  function rebuildLineList() {
    if (!sceneData) return;
    const scene = sceneSelect.value;
    editLineList.innerHTML = '';
    for (const line of sceneData.lines) {
      const row = document.createElement('div');
      row.className = 'edit-line-row' + (line.interpolated ? ' interpolated' : '');
      row.dataset.id = line.id;
      const t = line.start !== null ? `${line.start}–${line.end}` : 'null';
      row.innerHTML =
        `<span class="ell-id">#${line.id}</span>` +
        `<span class="ell-char">${line.character}</span>` +
        `<span class="ell-time">${t}</span>` +
        `<span class="ell-text">${line.text.slice(0, 40)}</span>`;
      // Click row → fill form
      row.addEventListener('click', () => {
        editId.value    = line.id;
        editStart.value = line.start ?? '';
        editEnd.value   = line.end ?? '';
        // Seek audio to start of line for quick preview
        if (line.start !== null) {
          audio.currentTime = Math.max(0, line.start - 0.5);
        }
      });
      editLineList.appendChild(row);
    }
  }

  // Hook into sceneSelect change (after the main handler fires)
  sceneSelect.addEventListener('change', () => {
    // sceneData is populated asynchronously; wait a tick
    setTimeout(rebuildLineList, 100);
  });

  // Save line
  btnSave.addEventListener('click', async () => {
    const scene  = sceneSelect.value;
    const id     = parseInt(editId.value, 10);
    const start  = parseFloat(editStart.value);
    const end    = parseFloat(editEnd.value);

    if (!scene)         { showStatus('בחר תמונה קודם', 'error'); return; }
    if (!id || id < 1)  { showStatus('הכנס מזהה שורה תקין', 'error'); return; }
    if (isNaN(start) || isNaN(end) || end <= start) {
      showStatus('ערכי זמן לא תקינים', 'error'); return;
    }

    try {
      const res = await fetch('/api/save-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene, id, start, end }),
      });
      if (!res.ok) {
        showStatus(`שגיאה: ${await res.text()}`, 'error');
        return;
      }
      // Update in-memory data so the player uses the new timestamps immediately
      const line = sceneData.lines.find(l => l.id === id);
      if (line) {
        line.start = start;
        line.end   = end;
        delete line.interpolated;
        // Reset cue tracking so the updated line can fire again this session
        cued.delete(id);
      }
      rebuildLineList();
      showStatus(`✓ שורה ${id} נשמרה`, 'ok');
    } catch (err) {
      showStatus(`שגיאת רשת — האם serve.py רץ?`, 'error');
    }
  });

  function showStatus(msg, type) {
    editStatus.textContent = msg;
    editStatus.className = 'edit-status ' + type;
    clearTimeout(editStatus._timer);
    editStatus._timer = setTimeout(() => { editStatus.textContent = ''; editStatus.className = 'edit-status'; }, 3000);
  }
}
