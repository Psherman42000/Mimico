---
name: electron-windows
description: "Electron patterns for Windows: click-through overlay, tray, Win32 API, IPC"
---

# Electron Windows Patterns

## Click-Through Overlay (Window ignores mouse clicks)
```typescript
import { BrowserWindow } from 'electron';

const overlay = new BrowserWindow({
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  width: 400,
  height: 150,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
  },
});

// After window is ready, apply WS_EX_TRANSPARENT via PowerShell/User32
overlay.on('ready-to-show', () => {
  const hwnd = overlay.getNativeWindowHandle();
  // Use PowerShell to call SetWindowLong with WS_EX_TRANSPARENT
  applyClickThrough(hwnd);
});
```

## Win32 Click-Through (PowerShell)
```typescript
// win32-overlay.ts
const WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_TOOLWINDOW = 0x00000080;
const GWL_EXSTYLE = -20;

// PowerShell: Get handle via process ID, then modify window style
const script = `
$hwnd = ${hwnd};
Add-Type @"
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
"@ -Name Win32 -Namespace Native;
$current = [Native.Win32]::GetWindowLong($hwnd, ${GWL_EXSTYLE});
[Native.Win32]::SetWindowLong($hwnd, ${GWL_EXSTYLE}, $current -bor ${WS_EX_TRANSPARENT} -bor ${WS_EX_TOOLWINDOW});
`;
```

## System Tray Icon
```typescript
const tray = new Tray(nativeImage.createFromBuffer(iconBuffer));
const contextMenu = Menu.buildFromTemplate([
  { label: 'Toggle ON/OFF', click: togglePipeline },
  { type: 'separator' },
  { label: 'Configurações', click: openConfig },
  { type: 'separator' },
  { label: 'Sair', click: () => { cleanup(); app.quit(); } },
]);
tray.setToolTip('Mimico');
tray.setContextMenu(contextMenu);
```

## Secure IPC (contextBridge)
```typescript
// preload.ts
contextBridge.exposeInMainWorld('mimicoAPI', {
  onTranscription: (cb) => ipcRenderer.on('update-subtitles', (_, data) => cb(data)),
  onToggle: (cb) => ipcRenderer.on('toggle-state', (_, enabled) => cb(enabled)),
  getConfig: () => ipcRenderer.sendSync('get-config'),
  saveConfig: (cfg) => ipcRenderer.send('save-config', cfg),
});
```

## Python Child Process Workers
```typescript
const worker = spawn('python', ['workers/whisper_worker.py'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

worker.stdout.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  for (const line of lines) {
    const msg = JSON.parse(line);
    if (msg.type === 'transcription') {
      // Forward to translator
    }
  }
});

// Send commands
worker.stdin.write(JSON.stringify({ command: 'transcribe', data: audioBase64 }) + '\n');
```

## Always On Top + Invisible in Screen Capture
```typescript
// Prevent overlay from appearing in screen recordings/streams
// Via Win32 SetWindowDisplayAffinity
const WDA_EXCLUDEFROMCAPTURE = 0x00000011;
// Call via PowerShell or native Node addon
```

## Global Shortcuts
```typescript
globalShortcut.register('Alt+Shift+M', () => togglePipeline());
globalShortcut.register('Alt+Shift+O', () => toggleOverlay());
```
