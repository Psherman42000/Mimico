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

function initializeApp(): void {
  configManager = new ConfigManager();
  const config = configManager.load();
  setupOverlay(config);
  setupAudioCapture();
  setupIpcHandlers();
  new TrayManager(mainWindow!);
  registerGlobalHotkey(config.hotkey);
  audioCapture.start();
}

function setupOverlay(config: AppConfig): void {
  overlayManager = new OverlayManager(config);
  mainWindow = overlayManager.getWindow();
}

function setupAudioCapture(): void {
  audioCapture = new AudioCaptureManager();
  audioCapture.setWindow(mainWindow!);
  audioCapture.onChunk((chunk) => {
    sendToWindow('audio-chunk', chunk);
  });
}

function registerGlobalHotkey(hotkey: string | undefined): void {
  if (!hotkey) {
    return;
  }
  globalShortcut.register(hotkey, toggleOverlay);
}

function toggleOverlay(): void {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
}

function sendToWindow(channel: string, data: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, data);
}

function setupIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_LOAD, () => configManager.load());

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_event, partial: Partial<AppConfig>) => {
    const current = configManager.load();
    const updated = { ...current, ...partial };
    configManager.save(updated);
    if (partial.hotkey && partial.hotkey !== current.hotkey) {
      globalShortcut.unregisterAll();
      registerGlobalHotkey(partial.hotkey);
    }
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.TOGGLE_TTS, (_event, active: boolean) => {
    sendToWindow(IPC_CHANNELS.TTS_STATUS, active);
    return active;
  });

  ipcMain.handle('audio-start', () => audioCapture.start());
  ipcMain.handle('audio-stop', () => {
    audioCapture.stop();
    return true;
  });
  ipcMain.handle('audio-list-devices', () => audioCapture.listDevices());
  ipcMain.handle('audio-status', () => audioCapture.isRunning());
}

app.whenReady().then(initializeApp);

app.on('window-all-closed', () => { /* stay in tray */ });

app.on('before-quit', () => {
  if (audioCapture) {
    audioCapture.stop();
  }
  globalShortcut.unregisterAll();
});
