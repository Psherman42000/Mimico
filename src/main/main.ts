import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import { TrayManager } from './tray';
import { OverlayManager } from './overlay';
import { ConfigManager } from './config';
import { AudioCaptureManager } from './audio-capture';
import { IPC_CHANNELS, AppConfig } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let overlayManager: OverlayManager | null = null;
let configManager: ConfigManager;
let audioCapture: AudioCaptureManager;

function createOverlay(config: AppConfig): void {
  overlayManager = new OverlayManager(config);
  mainWindow = overlayManager.getWindow();
  initAudioCapture();
  setupIPC();
  new TrayManager(mainWindow);
  registerHotkey(config.hotkey);
  audioCapture.start();
}

function initAudioCapture(): void {
  audioCapture = new AudioCaptureManager();
  audioCapture.setWindow(mainWindow!);
  audioCapture.onChunk((chunk) => {
    sendToWindow('audio-chunk', chunk);
  });
}

function sendToWindow(channel: string, data: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function registerHotkey(hotkey: string | undefined): void {
  if (!hotkey) return;
  globalShortcut.register(hotkey, toggleOverlay);
}

function toggleOverlay(): void {
  if (!mainWindow) return;
  mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
}

function reregisterHotkey(oldKey: string, newKey: string): void {
  globalShortcut.unregisterAll();
  registerHotkey(newKey);
}

// --- IPC Handlers ---

function setupIPC(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_LOAD, () => configManager.load());

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_e, partial: Partial<AppConfig>) => {
    const current = configManager.load();
    const updated = { ...current, ...partial };
    configManager.save(updated);
    if (partial.hotkey && partial.hotkey !== current.hotkey) {
      reregisterHotkey(current.hotkey, partial.hotkey);
    }
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.TOGGLE_TTS, (_e, active: boolean) => {
    sendToWindow(IPC_CHANNELS.TTS_STATUS, active);
    return active;
  });

  ipcMain.handle('audio-start', () => audioCapture.start());
  ipcMain.handle('audio-stop', () => { audioCapture.stop(); return true; });
  ipcMain.handle('audio-list-devices', () => audioCapture.listDevices());
  ipcMain.handle('audio-status', () => audioCapture.isRunning());
}

app.whenReady().then(() => {
  configManager = new ConfigManager();
  createOverlay(configManager.load());
});

app.on('window-all-closed', () => { /* stay in tray */ });
app.on('before-quit', () => {
  audioCapture?.stop();
  globalShortcut.unregisterAll();
});
