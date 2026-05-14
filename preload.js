// FloatFocus Timer — preload bridge
// Exposes a tiny, locked-down API to the renderer.
// contextIsolation: true means renderer cannot touch Node directly; only what's
// whitelisted here is reachable as window.floatFocus.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatFocus', {
  setClickThrough: (enabled) => ipcRenderer.invoke('window:set-click-through', enabled),
  setPointerUnlocked: (enabled) => ipcRenderer.send('window:set-pointer-unlocked', enabled),
  startWindowDrag: (point) => ipcRenderer.send('window:drag-start', point),
  dragWindow:      () => ipcRenderer.send('window:drag-move'),
  endWindowDrag:   () => ipcRenderer.send('window:drag-end'),
  setOpacity:      (value)   => ipcRenderer.invoke('window:set-opacity', value),
  showContextMenu: ()        => ipcRenderer.invoke('menu:show'),
  quit:            ()        => ipcRenderer.invoke('window:quit'),

  // Subscriptions back from main
  onShortcutToggle: (cb) => ipcRenderer.on('shortcut:toggle-click-through', (_e, v) => cb(v)),
  onPreset:         (cb) => ipcRenderer.on('preset', (_e, minutes) => cb(minutes)),
  onCustomDuration: (cb) => ipcRenderer.on('custom-duration', () => cb()),
  onOpacity:        (cb) => ipcRenderer.on('opacity', (_e, value) => cb(value)),
});
