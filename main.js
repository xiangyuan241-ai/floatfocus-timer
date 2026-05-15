// FloatFocus Timer — Electron main process
// Creates a frameless, transparent, always-on-top floating window.

const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let win = null;
let reportWin = null;
const WINDOW_WIDTH = 260;
const WINDOW_HEIGHT = 167;
const REPORT_WIDTH = 620;
const REPORT_HEIGHT = 720;
const STATS_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
let isResettingSize = false;
let dragOffset = null;
let pointerUnlocked = false;
let statsCache = null;
// State mirrored from renderer so the right-click menu and shortcuts can act on it.
let state = {
  clickThrough: false,
  opacity: 0.8,
  snapToEdge: true,
};

function getStatsPath() {
  return path.join(app.getPath('userData'), 'usage-stats.json');
}

function createEmptyStats() {
  return { version: STATS_VERSION, days: {} };
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateKeyFromTime(time) {
  return dateKeyFromDate(new Date(time));
}

function dayStartMs(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

function nextDayStartMs(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day + 1).getTime();
}

function addDaysToKey(dateKey, offset) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return dateKeyFromDate(new Date(year, month - 1, day + offset));
}

function dayTemplate(dateKey) {
  return {
    date: dateKey,
    focusSec: 0,
    breakSec: 0,
    totalSec: 0,
    sessions: 0,
    focusSessions: 0,
    breakSessions: 0,
    completedFocus: 0,
    completedBreak: 0,
    blocks: [],
  };
}

function normalizeBlock(block) {
  const start = asNumber(block && block.start);
  const end = asNumber(block && block.end);
  if (!start || !end || end <= start) return null;

  return {
    start,
    end,
    kind: block.kind === 'break' ? 'break' : 'focus',
    seconds: asNumber(block.seconds || Math.round((end - start) / 1000)),
    sessionId: String(block.sessionId || ''),
    plannedSec: asNumber(block.plannedSec),
  };
}

function normalizeDay(dateKey, raw = {}) {
  const day = dayTemplate(dateKey);
  day.focusSec = asNumber(raw.focusSec);
  day.breakSec = asNumber(raw.breakSec);
  day.totalSec = asNumber(raw.totalSec || day.focusSec + day.breakSec);
  day.sessions = asNumber(raw.sessions);
  day.focusSessions = asNumber(raw.focusSessions);
  day.breakSessions = asNumber(raw.breakSessions);
  day.completedFocus = asNumber(raw.completedFocus);
  day.completedBreak = asNumber(raw.completedBreak);
  day.blocks = Array.isArray(raw.blocks)
    ? raw.blocks.map(normalizeBlock).filter(Boolean).sort((a, b) => a.start - b.start)
    : [];
  return day;
}

function ensureStats() {
  if (statsCache) return statsCache;

  try {
    const raw = fs.readFileSync(getStatsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    statsCache = parsed && typeof parsed === 'object' && parsed.days ? parsed : createEmptyStats();
  } catch (error) {
    statsCache = createEmptyStats();
  }

  statsCache.version = STATS_VERSION;
  statsCache.days = statsCache.days && typeof statsCache.days === 'object' ? statsCache.days : {};
  return statsCache;
}

function saveStats() {
  const statsPath = getStatsPath();
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  fs.writeFileSync(statsPath, JSON.stringify(ensureStats(), null, 2), 'utf8');
}

function getDayStats(dateKey) {
  const stats = ensureStats();
  stats.days[dateKey] = normalizeDay(dateKey, stats.days[dateKey]);
  return stats.days[dateKey];
}

function mergeUsageBlock(day, block) {
  const last = day.blocks[day.blocks.length - 1];
  const sameSession = last && last.sessionId && last.sessionId === block.sessionId;
  const closeEnough = last && block.start - last.end <= 60 * 1000;

  if (sameSession && closeEnough && last.kind === block.kind) {
    last.end = Math.max(last.end, block.end);
    last.seconds += block.seconds;
    return;
  }

  day.blocks.push(block);
}

function recordUsageSegment(payload = {}) {
  const startedAt = Number(payload.startedAt);
  const endedAt = Number(payload.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return false;

  const kind = payload.kind === 'break' ? 'break' : 'focus';
  const sessionId = String(payload.sessionId || `${kind}-${startedAt}`);
  const plannedSec = asNumber(payload.plannedSec);
  let cursor = startedAt;

  while (cursor < endedAt) {
    const dateKey = dateKeyFromTime(cursor);
    const sliceEnd = Math.min(endedAt, nextDayStartMs(dateKey));
    const seconds = Math.max(0, Math.round((sliceEnd - cursor) / 1000));

    if (seconds > 0) {
      const day = getDayStats(dateKey);
      day.totalSec += seconds;
      if (kind === 'break') day.breakSec += seconds;
      else day.focusSec += seconds;

      mergeUsageBlock(day, {
        start: cursor,
        end: sliceEnd,
        kind,
        seconds,
        sessionId,
        plannedSec,
      });
    }

    cursor = sliceEnd;
  }

  if (payload.countAsSession) {
    const startDay = getDayStats(dateKeyFromTime(startedAt));
    startDay.sessions += 1;
    if (kind === 'break') startDay.breakSessions += 1;
    else startDay.focusSessions += 1;
  }

  if (payload.completed) {
    const endDay = getDayStats(dateKeyFromTime(endedAt));
    if (kind === 'break') endDay.completedBreak += 1;
    else endDay.completedFocus += 1;
  }

  saveStats();
  return true;
}

function summarizeDay(dateKey) {
  return normalizeDay(dateKey, ensureStats().days[dateKey]);
}

function getReportData(options = {}) {
  const dayCount = Math.max(1, Math.min(60, Math.round(Number(options.days) || 14)));
  const selectedDate = isDateKey(options.date) ? options.date : dateKeyFromTime(Date.now());
  const days = [];

  for (let index = dayCount - 1; index >= 0; index -= 1) {
    const dateKey = addDaysToKey(selectedDate, -index);
    days.push(summarizeDay(dateKey));
  }

  return {
    today: dateKeyFromTime(Date.now()),
    selectedDate,
    generatedAt: Date.now(),
    days,
    selected: summarizeDay(selectedDate),
    statsPath: getStatsPath(),
  };
}

function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatClock(time) {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function buildTimelineHtml(day) {
  const start = dayStartMs(day.date);
  const blocks = day.blocks.map((block) => {
    const left = Math.max(0, Math.min(100, ((block.start - start) / DAY_MS) * 100));
    const right = Math.max(0, Math.min(100, ((block.end - start) / DAY_MS) * 100));
    const width = Math.max(0.45, right - left);
    const label = `${block.kind === 'break' ? 'Break' : 'Focus'} ${formatClock(block.start)}-${formatClock(block.end)}`;
    return `<span class="${block.kind}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" title="${escapeHtml(label)}"></span>`;
  }).join('');

  const ticks = [0, 6, 12, 18, 24].map((hour) => {
    const left = Math.min(100, (hour / 24) * 100);
    return `<i style="left:${left}%">${hour}:00</i>`;
  }).join('');

  return `
    <div class="timeline-ticks">${ticks}</div>
    <div class="timeline-track">${blocks || '<em>No timer activity</em>'}</div>
  `;
}

function buildWeekHtml(days) {
  const maxFocus = Math.max(1, ...days.map((day) => day.focusSec));
  return days.map((day) => {
    const height = Math.max(3, Math.round((day.focusSec / maxFocus) * 100));
    return `
      <div class="week-bar">
        <span style="height:${height}%"></span>
        <b>${escapeHtml(day.date.slice(5))}</b>
      </div>
    `;
  }).join('');
}

function buildSessionHtml(day) {
  if (!day.blocks.length) return '<li class="empty">No sessions recorded for this day.</li>';

  return day.blocks.slice(-12).reverse().map((block) => `
    <li>
      <span>${escapeHtml(formatClock(block.start))}-${escapeHtml(formatClock(block.end))}</span>
      <b>${block.kind === 'break' ? 'Break' : 'Focus'}</b>
      <strong>${escapeHtml(formatDuration(block.seconds))}</strong>
    </li>
  `).join('');
}

function buildExportHtml(dateKey) {
  const report = getReportData({ date: dateKey, days: 14 });
  const day = report.selected;
  const focusRatio = day.totalSec ? Math.round((day.focusSec / day.totalSec) * 100) : 0;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FloatFocus Daily Report ${escapeHtml(day.date)}</title>
  <style>
    :root {
      --panel: rgba(246,248,251,0.88);
      --ink: #263039;
      --ink-soft: #75808a;
      --muted: #aeb6bf;
      --stroke: rgba(255,255,255,0.72);
      --accent: #4f6375;
      --focus: #4d6f7a;
      --break: #ba8c55;
      --shadow: rgba(28,39,50,0.18);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      padding: 32px;
      color: var(--ink);
      font-family: "Avenir Next", "Trebuchet MS", "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #eef3f7, #dfe6ec 42%, #f8fafc);
    }
    main {
      max-width: 760px;
      margin: 0 auto;
      padding: 28px;
      border: 1px solid var(--stroke);
      border-radius: 18px;
      background:
        radial-gradient(circle at 12% 8%, rgba(255,255,255,0.96), rgba(255,255,255,0) 28%),
        radial-gradient(circle at 84% 10%, rgba(255,255,255,0.68), rgba(255,255,255,0) 24%),
        linear-gradient(145deg, rgba(255,255,255,0.8), rgba(220,225,231,0.42)),
        var(--panel);
      box-shadow: inset 6px 7px 16px rgba(255,255,255,0.72), inset -8px -10px 18px rgba(91,103,116,0.11), 0 20px 42px var(--shadow);
    }
    header { display: flex; justify-content: space-between; gap: 18px; align-items: start; }
    h1 { margin: 0; font-size: 15px; line-height: 1; font-family: "Comic Sans MS", "Trebuchet MS", sans-serif; }
    .date { color: var(--ink-soft); font-size: 12px; font-weight: 700; margin-top: 7px; }
    .focus-number { margin-top: 34px; font-size: 76px; line-height: 0.9; font-weight: 900; letter-spacing: 0; font-variant-numeric: tabular-nums; }
    .label { color: var(--ink-soft); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 28px; }
    .stat { min-height: 78px; padding: 13px; border-radius: 13px; background: rgba(255,255,255,0.38); box-shadow: inset 3px 4px 8px rgba(255,255,255,0.68), inset -3px -4px 8px rgba(134,145,158,0.1); }
    .stat b { display: block; margin-top: 9px; font-size: 20px; font-variant-numeric: tabular-nums; }
    section { margin-top: 30px; }
    h2 { margin: 0 0 12px; font-size: 13px; font-family: "Comic Sans MS", "Trebuchet MS", sans-serif; }
    .timeline-ticks { position: relative; height: 18px; color: var(--muted); font-size: 11px; }
    .timeline-ticks i { position: absolute; transform: translateX(-50%); font-style: normal; }
    .timeline-track { position: relative; height: 38px; border-radius: 12px; overflow: hidden; background: rgba(112,125,137,0.12); box-shadow: inset 3px 4px 8px rgba(255,255,255,0.6); }
    .timeline-track span { position: absolute; top: 7px; bottom: 7px; border-radius: 8px; }
    .timeline-track span.focus { background: linear-gradient(90deg, rgba(77,111,122,0.92), rgba(77,111,122,0.54)); }
    .timeline-track span.break { background: linear-gradient(90deg, rgba(186,140,85,0.88), rgba(186,140,85,0.42)); }
    .timeline-track em { display: grid; place-items: center; height: 100%; color: var(--muted); font-size: 12px; font-style: normal; }
    .week { height: 140px; display: grid; grid-template-columns: repeat(14, 1fr); align-items: end; gap: 8px; }
    .week-bar { height: 100%; display: grid; grid-template-rows: 1fr auto; gap: 8px; text-align: center; }
    .week-bar span { align-self: end; justify-self: center; width: 100%; max-width: 22px; min-height: 3px; border-radius: 8px 8px 3px 3px; background: linear-gradient(180deg, rgba(77,111,122,0.9), rgba(77,111,122,0.28)); }
    .week-bar b { color: var(--ink-soft); font-size: 10px; font-weight: 700; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 7px; }
    li { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 9px 11px; border-radius: 10px; background: rgba(255,255,255,0.34); color: var(--ink-soft); font-size: 12px; }
    li b, li strong { color: var(--ink); }
    .empty { display: block; text-align: center; }
    footer { margin-top: 28px; color: var(--muted); font-size: 11px; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>FloatFocus Daily Report</h1>
        <div class="date">${escapeHtml(day.date)}</div>
      </div>
      <div class="label">Generated ${escapeHtml(formatClock(report.generatedAt))}</div>
    </header>
    <div class="focus-number">${escapeHtml(formatDuration(day.focusSec))}</div>
    <div class="label">Focus time</div>
    <div class="stats">
      <div class="stat"><span class="label">Total</span><b>${escapeHtml(formatDuration(day.totalSec))}</b></div>
      <div class="stat"><span class="label">Focus ratio</span><b>${focusRatio}%</b></div>
      <div class="stat"><span class="label">Started</span><b>${day.focusSessions}</b></div>
      <div class="stat"><span class="label">Completed</span><b>${day.completedFocus}</b></div>
    </div>
    <section>
      <h2>Day Timeline</h2>
      ${buildTimelineHtml(day)}
    </section>
    <section>
      <h2>Focus Trend</h2>
      <div class="week">${buildWeekHtml(report.days)}</div>
    </section>
    <section>
      <h2>Sessions</h2>
      <ul>${buildSessionHtml(day)}</ul>
    </section>
    <footer>Data source: ${escapeHtml(report.statsPath)}</footer>
  </main>
</body>
</html>`;
}

async function exportDayReport(dateKey) {
  const selectedDate = isDateKey(dateKey) ? dateKey : dateKeyFromTime(Date.now());
  const targetWindow = reportWin && !reportWin.isDestroyed() ? reportWin : win;
  const result = await dialog.showSaveDialog(targetWindow, {
    title: '导出 FloatFocus 日报表',
    defaultPath: `FloatFocus-${selectedDate}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  fs.writeFileSync(result.filePath, buildExportHtml(selectedDate), 'utf8');
  shell.showItemInFolder(result.filePath);
  return { canceled: false, filePath: result.filePath };
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_WIDTH,
    minHeight: WINDOW_HEIGHT,
    maxWidth: WINDOW_WIDTH,
    maxHeight: WINDOW_HEIGHT,
    x: workArea.x + workArea.width - WINDOW_WIDTH - 24,
    y: workArea.y + 40,
    // --- The four flags that make this a floating widget, not an app window ---
    frame: false,            // no titlebar / chrome
    transparent: true,       // honor RGBA from CSS
    alwaysOnTop: true,       // sits above every other window
    resizable: false,        // fixed size; renderer moves the window through IPC
    maximizable: false,
    skipTaskbar: true,       // hide from Dock / taskbar (macOS still shows in App Switcher)
    hasShadow: false,        // shadow would betray the transparent edges
    fullscreenable: false,
    movable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Float above fullscreen apps on macOS too (e.g. fullscreen Chrome / Keynote).
  win.setResizable(false);
  win.setMinimumSize(WINDOW_WIDTH, WINDOW_HEIGHT);
  win.setMaximumSize(WINDOW_WIDTH, WINDOW_HEIGHT);
  if (typeof win.setMaximizable === 'function') win.setMaximizable(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setZoomFactor(1);

  win.on('resize', enforceWindowSize);
  win.on('maximize', resetWindowSize);
  win.on('enter-full-screen', resetWindowSize);
  win.webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    win.webContents.setZoomFactor(1);
  });
  win.webContents.on('did-finish-load', () => {
    setClickThrough(false);
    win.webContents.send('shortcut:toggle-click-through', false);
  });

  win.loadFile(path.join(__dirname, 'renderer/index.html'));

  // --- Global shortcut: Ctrl/Cmd + Shift + T toggles click-through ---
  const accelerator = process.platform === 'darwin' ? 'Command+Shift+T' : 'Control+Shift+T';
  globalShortcut.register(accelerator, () => {
    setClickThrough(!state.clickThrough);
    win.webContents.send('shortcut:toggle-click-through', state.clickThrough);
  });

  globalShortcut.register('Control+Alt+0', resetWindowSize);
  globalShortcut.register('Control+Alt+Left', () => nudgeWindow(-24, 0));
  globalShortcut.register('Control+Alt+Right', () => nudgeWindow(24, 0));
  globalShortcut.register('Control+Alt+Up', () => nudgeWindow(0, -24));
  globalShortcut.register('Control+Alt+Down', () => nudgeWindow(0, 24));
}

function createReportWindow() {
  if (reportWin && !reportWin.isDestroyed()) {
    reportWin.show();
    reportWin.focus();
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  reportWin = new BrowserWindow({
    width: REPORT_WIDTH,
    height: REPORT_HEIGHT,
    minWidth: REPORT_WIDTH,
    minHeight: REPORT_HEIGHT,
    maxWidth: REPORT_WIDTH,
    maxHeight: REPORT_HEIGHT,
    x: workArea.x + Math.round((workArea.width - REPORT_WIDTH) / 2),
    y: workArea.y + Math.max(24, Math.round((workArea.height - REPORT_HEIGHT) / 2)),
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  reportWin.setResizable(false);
  reportWin.setMinimumSize(REPORT_WIDTH, REPORT_HEIGHT);
  reportWin.setMaximumSize(REPORT_WIDTH, REPORT_HEIGHT);
  if (typeof reportWin.setMaximizable === 'function') reportWin.setMaximizable(false);
  reportWin.webContents.setZoomFactor(1);
  reportWin.webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    reportWin.webContents.setZoomFactor(1);
  });
  reportWin.once('ready-to-show', () => {
    if (reportWin && !reportWin.isDestroyed()) reportWin.show();
  });
  reportWin.on('closed', () => {
    reportWin = null;
  });

  reportWin.loadFile(path.join(__dirname, 'renderer/report.html'));
}

function nudgeWindow(dx, dy) {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy, false);
}

function clampWindowPosition(x, y, point = screen.getCursorScreenPoint()) {
  const { workArea } = screen.getDisplayNearestPoint(point);
  const maxX = workArea.x + Math.max(0, workArea.width - WINDOW_WIDTH);
  const maxY = workArea.y + Math.max(0, workArea.height - WINDOW_HEIGHT);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  return [
    clamp(Math.round(x), workArea.x, maxX),
    clamp(Math.round(y), workArea.y, maxY),
  ];
}

function moveWindowToCursor() {
  if (!win) return;
  const point = screen.getCursorScreenPoint();
  const [x, y] = clampWindowPosition(
    point.x - Math.round(WINDOW_WIDTH / 2),
    point.y - Math.round(WINDOW_HEIGHT / 2),
    point
  );
  win.setPosition(x, y, false);
}

function dragWindowToCursor() {
  if (!win || !dragOffset) return;
  const point = screen.getCursorScreenPoint();
  const [x, y] = clampWindowPosition(point.x - dragOffset.x, point.y - dragOffset.y, point);
  win.setPosition(x, y, false);
}

function resetWindowSize() {
  if (!win) return;

  isResettingSize = true;
  const currentBounds = win.getBounds();
  const { workArea } = screen.getDisplayMatching(currentBounds);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const bounds = {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: clamp(currentBounds.x, workArea.x, workArea.x + workArea.width - WINDOW_WIDTH),
    y: clamp(currentBounds.y, workArea.y, workArea.y + workArea.height - WINDOW_HEIGHT),
  };

  if (win.isFullScreen()) win.setFullScreen(false);
  if (win.isMaximized()) win.unmaximize();
  if (typeof win.restore === 'function') win.restore();

  const applyBounds = () => {
    if (!win || win.isDestroyed()) return;

    win.setResizable(true);
    win.setMinimumSize(1, 1);
    win.setMaximumSize(10000, 10000);
    win.webContents.setZoomFactor(1);
    win.setBounds(bounds, false);
    win.setContentSize(WINDOW_WIDTH, WINDOW_HEIGHT, false);
    win.setMinimumSize(WINDOW_WIDTH, WINDOW_HEIGHT);
    win.setMaximumSize(WINDOW_WIDTH, WINDOW_HEIGHT);
    win.setResizable(false);
    if (typeof win.setMaximizable === 'function') win.setMaximizable(false);
  };

  applyBounds();
  setTimeout(applyBounds, 80);
  setTimeout(() => {
    applyBounds();
    isResettingSize = false;
  }, 250);
}

function enforceWindowSize() {
  if (!win) return;
  if (isResettingSize) return;
  const [width, height] = win.getSize();
  if (width !== WINDOW_WIDTH || height !== WINDOW_HEIGHT) resetWindowSize();
}

function setClickThrough(enabled) {
  if (!win) return;
  state.clickThrough = enabled;
  if (!state.clickThrough) pointerUnlocked = false;
  applyMouseEventsPolicy();
}

function setPointerUnlocked(enabled) {
  pointerUnlocked = !!enabled;
  applyMouseEventsPolicy();
}

function applyMouseEventsPolicy() {
  if (!win) return;
  // While click-through is active, forward mousemove so the renderer can unlock
  // only the small top-right control hotspot.
  const shouldIgnore = state.clickThrough && !pointerUnlocked && !dragOffset;
  if (shouldIgnore) {
    win.setIgnoreMouseEvents(true, { forward: true });
  } else {
    win.setIgnoreMouseEvents(false);
  }
}

// --- IPC bridge from renderer ---
ipcMain.handle('window:set-click-through', (_e, enabled) => setClickThrough(!!enabled));
ipcMain.on('window:set-pointer-unlocked', (_e, enabled) => setPointerUnlocked(!!enabled));
ipcMain.on('window:drag-start', (_e, offset) => {
  if (!win) return;
  const x = Number(offset && offset.x);
  const y = Number(offset && offset.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  dragOffset = {
    x: Math.max(0, Math.min(WINDOW_WIDTH, x)),
    y: Math.max(0, Math.min(WINDOW_HEIGHT, y)),
  };
  applyMouseEventsPolicy();
  dragWindowToCursor();
});
ipcMain.on('window:drag-move', () => dragWindowToCursor());
ipcMain.on('window:drag-end', () => {
  dragOffset = null;
  applyMouseEventsPolicy();
});

ipcMain.handle('window:set-opacity', (_e, value) => {
  state.opacity = value;
  if (win) win.webContents.send('opacity', state.opacity);
});

ipcMain.handle('window:reset-size', () => resetWindowSize());

ipcMain.handle('window:quit', () => app.quit());

ipcMain.handle('window:close-current', (event) => {
  const currentWindow = BrowserWindow.fromWebContents(event.sender);
  if (currentWindow && !currentWindow.isDestroyed()) currentWindow.close();
});

ipcMain.handle('stats:record-usage', (_event, payload) => recordUsageSegment(payload));

ipcMain.handle('report:open', (event) => {
  event.sender.send('usage:flush');
  createReportWindow();
});

ipcMain.handle('report:get-data', (_event, options) => getReportData(options));

ipcMain.handle('report:export-day', (_event, dateKey) => exportDayReport(dateKey));

ipcMain.handle('menu:show', (event) => {
  const template = [
    { label: '5 分钟',  click: () => event.sender.send('preset', 5) },
    { label: '10 分钟', click: () => event.sender.send('preset', 10) },
    { label: '25 分钟', click: () => event.sender.send('preset', 25) },
    { label: '30 分钟', click: () => event.sender.send('preset', 30) },
    { label: '45 分钟', click: () => event.sender.send('preset', 45) },
    { label: '60 分钟', click: () => event.sender.send('preset', 60) },
    { label: '自定义时间...', click: () => event.sender.send('custom-duration') },
    { label: '移动到鼠标位置', click: () => moveWindowToCursor() },
    { label: '恢复小尺寸', accelerator: 'Ctrl+Alt+0', click: () => resetWindowSize() },
    { label: '使用报表...', click: () => {
      event.sender.send('usage:flush');
      setTimeout(createReportWindow, 80);
    } },
    { type: 'separator' },
    {
      label: '背景透明度',
      submenu: [20, 40, 60, 80, 100].map(v => ({
        label: `${v}%`,
        type: 'radio',
        checked: Math.round(state.opacity * 100) === v,
        click: () => {
          state.opacity = v / 100;
          event.sender.send('opacity', state.opacity);
        },
      })),
    },
    {
      label: '点击穿透',
      type: 'checkbox',
      checked: state.clickThrough,
      accelerator: process.platform === 'darwin' ? 'Cmd+Shift+T' : 'Ctrl+Shift+T',
      click: () => {
        setClickThrough(!state.clickThrough);
        event.sender.send('shortcut:toggle-click-through', state.clickThrough);
      },
    },
    { type: 'separator' },
    { label: '退出 FloatFocus', role: 'quit' },
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
});

app.whenReady().then(createWindow);

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
