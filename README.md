# FloatFocus Timer

桌面端悬浮专注倒计时器。目标是始终显示在屏幕上方，但尽量不遮挡正在看的网页、文档、PPT 或代码。


## 使用方式

- 双击时间：开始 / 暂停
- 按住计时器的非按钮区域拖动：移动到任意位置
- `Ctrl+Alt+方向键`：用键盘微调位置
- 鼠标移入：显示开始、重置、点击穿透、更多按钮
- 鼠标移出：隐藏按钮，只保留倒计时
- 右键：选择时间、设置背景透明度、切换点击穿透、退出
- `Ctrl+Shift+T`：切换点击穿透

点击穿透开启后，鼠标点击会穿过计时器，直接操作后面的窗口。鼠标移到计时器上会临时显示控件并解锁拖动；也可以再按一次 `Ctrl+Shift+T` 关闭穿透。

## 打包

```powershell
npm run build:win
```

打包结果会生成在 `dist` 目录。

## 项目结构

```text
electron/
  main.js
  preload.js
  package.json
  renderer/
    index.html
    style.css
    script.js
```

## 关键实现

- `BrowserWindow` 使用 `transparent: true`、`frame: false`、`alwaysOnTop: true` 实现透明无边框置顶窗口。
- `win.setIgnoreMouseEvents(true, { forward: true })` 实现点击穿透。
- `globalShortcut` 注册 `Ctrl+Shift+T` 作为全局穿透开关。
- renderer 通过 IPC 手动拖动窗口，避免 Electron 拖拽区域吞掉双击事件。
- 背景透明度通过 CSS 变量调整，文字保持清晰。
