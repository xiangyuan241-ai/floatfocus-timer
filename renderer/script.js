// FloatFocus Timer — renderer logic
// Pure DOM. Talks to the main process only through window.floatFocus (set in preload.js).

const card        = document.getElementById('card');
const timeEl      = document.getElementById('time');
const progressEl  = document.getElementById('progress');
const toastEl     = document.getElementById('toast');
const btnPlay     = document.getElementById('btn-play');
const btnPause    = document.getElementById('btn-pause');
const btnReset   = document.getElementById('btn-reset');
const btnThrough  = document.getElementById('btn-through');
const btnPin      = document.getElementById('btn-pin');
const btnMenu     = document.getElementById('btn-menu');
const presetButtons = [...document.querySelectorAll('[data-preset]')];
const durationEditor = document.getElementById('duration-editor');
const durationInput  = document.getElementById('duration-input');
const durationOk     = document.getElementById('duration-ok');
const durationCancel = document.getElementById('duration-cancel');

const api = window.floatFocus || {};   // gracefully degrade if opened in plain browser

// ---- State ----
const POMODORO_SEQUENCE_MINUTES = [25, 5, 25, 5, 25, 5, 25, 30];

let durationSec = 25 * 60;
let remaining   = durationSec;
let running     = false;
let tickHandle  = null;
let pomodoroIndex = 0;
let clickThrough = false;
let suppressNextDoubleClick = false;
let pointerUnlocked = false;
let lastPointerPoint = null;
let dragState = null;

// ---- Render ----
function fmt(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function render() {
  timeEl.textContent = fmt(remaining);
  const pct = durationSec ? ((durationSec - remaining) / durationSec) * 100 : 0;
  progressEl.style.width = pct + '%';
  card.dataset.state = remaining === 0 ? 'done' : running ? 'running' : (remaining < durationSec ? 'paused' : 'idle');
  const activeMinutes = Math.round(durationSec / 60);
  presetButtons.forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.preset) === activeMinutes);
  });
}

function applyOpacity(value) {
  const opacity = Math.max(0.2, Math.min(1, Number(value) || 0.8));
  const hoverOpacity = Math.min(1, opacity + 0.12);
  document.documentElement.style.setProperty('--bg-alpha', opacity.toString());
  document.documentElement.style.setProperty('--bg-hover-alpha', hoverOpacity.toString());
  document.documentElement.style.setProperty('--shine-strong-alpha', (0.95 * opacity).toString());
  document.documentElement.style.setProperty('--shine-soft-alpha', (0.72 * opacity).toString());
  document.documentElement.style.setProperty('--wash-start-alpha', (0.78 * opacity).toString());
  document.documentElement.style.setProperty('--wash-end-alpha', (0.44 * opacity).toString());
  document.documentElement.style.setProperty('--shine-hover-strong-alpha', hoverOpacity.toString());
  document.documentElement.style.setProperty('--shine-hover-soft-alpha', (0.82 * hoverOpacity).toString());
  document.documentElement.style.setProperty('--wash-hover-start-alpha', (0.86 * hoverOpacity).toString());
  document.documentElement.style.setProperty('--wash-hover-end-alpha', (0.52 * hoverOpacity).toString());
  document.documentElement.style.setProperty('--control-bg-alpha', (0.42 * opacity).toString());
  document.documentElement.style.setProperty('--control-hover-alpha', (0.58 * hoverOpacity).toString());
}

// ---- Timer ----
function start() {
  if (running || remaining <= 0) return;
  running = true;
  const endAt = Date.now() + remaining * 1000;
  tickHandle = setInterval(() => {
    remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    render();
    if (remaining === 0) finish();
  }, 250);
  render();
}

function pause() {
  if (!running) return;
  running = false;
  clearInterval(tickHandle);
  render();
}

function reset() {
  pause();
  remaining = durationSec;
  toastEl.classList.remove('is-on');
  render();
}

function getPomodoroIndex(minutes) {
  const wholeMinutes = Math.round(minutes);
  if (Math.abs(minutes - wholeMinutes) > 0.0001) return null;

  const index = POMODORO_SEQUENCE_MINUTES.indexOf(wholeMinutes);
  return index === -1 ? null : index;
}

function setDuration(minutes, options = {}) {
  const normalizedMinutes = Math.max(1, Number(minutes) || 1);
  durationSec = Math.max(1, Math.round(normalizedMinutes * 60));
  remaining = durationSec;
  if (options.syncPomodoro !== false) {
    pomodoroIndex = getPomodoroIndex(normalizedMinutes);
  }
  pause();
  render();
}

function advancePomodoroDuration() {
  if (pomodoroIndex === null) return false;

  pomodoroIndex = (pomodoroIndex + 1) % POMODORO_SEQUENCE_MINUTES.length;
  setDuration(POMODORO_SEQUENCE_MINUTES[pomodoroIndex], { syncPomodoro: false });
  return true;
}

function askCustomDuration() {
  const currentMinutes = Math.round(durationSec / 60);
  durationInput.value = String(currentMinutes);
  durationEditor.classList.add('is-on');
  durationEditor.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    durationInput.focus();
    durationInput.select();
  }, 0);
}

function closeCustomDuration() {
  durationEditor.classList.remove('is-on');
  durationEditor.setAttribute('aria-hidden', 'true');
}

function applyCustomDuration() {
  const minutes = Number(durationInput.value.trim());
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 999) return;
  setDuration(minutes);
  closeCustomDuration();
}

function finish() {
  pause();
  // Soft "ding". WebAudio so we don't ship an asset.
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.95);
  } catch (e) {}
  advancePomodoroDuration();
  toastEl.classList.add('is-on');
  setTimeout(() => toastEl.classList.remove('is-on'), 2500);
}

// ---- Click-through ----
function pointInRect(point, rect, padding = 0) {
  return point &&
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding;
}

function isUnlockHotspot(point) {
  const topActions = document.querySelector('.top-actions');
  return topActions && pointInRect(point, topActions.getBoundingClientRect(), 8);
}

function setPointerUnlocked(on) {
  const next = !!on;
  if (pointerUnlocked === next) return;

  pointerUnlocked = next;
  card.classList.toggle('is-hovering', clickThrough && pointerUnlocked);
  api.setPointerUnlocked && api.setPointerUnlocked(clickThrough && pointerUnlocked);
}

function updatePointerUnlock(point = lastPointerPoint) {
  if (!clickThrough) {
    setPointerUnlocked(false);
    return;
  }

  setPointerUnlocked(isUnlockHotspot(point));
}

function setClickThrough(on, options = {}) {
  clickThrough = !!on;
  card.classList.toggle('is-through', clickThrough);
  btnThrough.classList.toggle('is-on', clickThrough);
  btnPin.classList.toggle('is-on', clickThrough);
  if (options.sync !== false) api.setClickThrough && api.setClickThrough(clickThrough);
  updatePointerUnlock(options.point || lastPointerPoint);
}

function isInteractiveTarget(target) {
  return !!target.closest('button, input, .controls, .duration-editor, .no-drag');
}

function canDragFromEvent(event) {
  return event.button === 0 &&
    !durationEditor.classList.contains('is-on') &&
    !isInteractiveTarget(event.target);
}

function beginDrag(event) {
  if (!canDragFromEvent(event)) return;

  dragState = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    moved: false,
  };
  suppressNextDoubleClick = false;
  card.classList.add('is-dragging');
  card.setPointerCapture && card.setPointerCapture(event.pointerId);
  api.startWindowDrag && api.startWindowDrag({ x: event.clientX, y: event.clientY });
  event.preventDefault();
}

function dragWindow(event) {
  if (!dragState) return;

  const movedX = Math.abs(event.screenX - dragState.startX);
  const movedY = Math.abs(event.screenY - dragState.startY);
  if (movedX + movedY > 3) {
    dragState.moved = true;
    suppressNextDoubleClick = true;
  }

  api.dragWindow && api.dragWindow();
  event.preventDefault();
}

function endDrag(event) {
  if (!dragState) return;

  const moved = dragState.moved;
  if (card.releasePointerCapture && event && event.pointerId === dragState.pointerId) {
    try { card.releasePointerCapture(event.pointerId); } catch (e) {}
  }

  dragState = null;
  card.classList.remove('is-dragging');
  api.endWindowDrag && api.endWindowDrag();

  if (moved) {
    setTimeout(() => { suppressNextDoubleClick = false; }, 250);
  }
}

// ---- Wire up ----
btnPlay.addEventListener('click',   () => start());
btnPause.addEventListener('click',  () => pause());
btnReset.addEventListener('click',  () => reset());
btnThrough.addEventListener('click', (event) => setClickThrough(!clickThrough, {
  point: { x: event.clientX, y: event.clientY },
}));
btnPin.addEventListener('click', (event) => setClickThrough(!clickThrough, {
  point: { x: event.clientX, y: event.clientY },
}));
btnMenu.addEventListener('click',   () => api.showContextMenu && api.showContextMenu());
presetButtons.forEach((button) => {
  button.addEventListener('click', () => setDuration(Number(button.dataset.preset)));
});
durationOk.addEventListener('click', () => applyCustomDuration());
durationCancel.addEventListener('click', () => closeCustomDuration());
durationInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') applyCustomDuration();
  if (event.key === 'Escape') closeCustomDuration();
});

window.addEventListener('mousemove', (event) => {
  lastPointerPoint = { x: event.clientX, y: event.clientY };
  updatePointerUnlock(lastPointerPoint);
}, { passive: true });
window.addEventListener('mouseleave', () => {
  lastPointerPoint = null;
  updatePointerUnlock(null);
}, { passive: true });

card.addEventListener('pointerdown', beginDrag);
window.addEventListener('pointermove', dragWindow);
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// Double-click the timer body: toggle play/pause.
card.addEventListener('dblclick', (event) => {
  if (isInteractiveTarget(event.target)) return;
  if (suppressNextDoubleClick) {
    suppressNextDoubleClick = false;
    return;
  }
  running ? pause() : start();
});

// Right-click anywhere: native context menu
window.addEventListener('contextmenu', (e) => { e.preventDefault(); api.showContextMenu && api.showContextMenu(); });

// Listen for main-process events
api.onShortcutToggle && api.onShortcutToggle((on) => setClickThrough(on, { sync: false }));
api.onPreset         && api.onPreset((mins) => setDuration(mins));
api.onCustomDuration && api.onCustomDuration(() => askCustomDuration());
api.onOpacity        && api.onOpacity((value) => applyOpacity(value));

applyOpacity(0.8);
render();
