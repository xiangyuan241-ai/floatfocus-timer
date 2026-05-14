// FloatFocus Timer — Electron main process
// Creates a frameless, transparent, always-on-top floating window.

const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen } = require('electron');
const path = require('path');

let win = null;
const WINDOW_WIDTH = 260;
const WINDOW_HEIGHT = 167;
let isResettingSize = false;
let dragOffset = null;
let pointerUnlocked = false;
// State mirrored from renderer so the right-click menu and shortcuts can act on it.
let state = {
  clickThrough: false,
  opacity: 0.8,
  snapToEdge: true,
};

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
  // forward:true still lets the renderer receive mousemove while click-through is active,
  // so hover can temporarily unlock the widget for dragging and controls.
  const shouldIgnore = state.clickThrough && !pointerUnlocked && !dragOffset;
  win.setIgnoreMouseEvents(shouldIgnore, { forward: true });
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
  pointerUnlocked = true;
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
