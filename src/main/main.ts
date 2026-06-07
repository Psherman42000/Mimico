import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut } from 'electron';
import * as path from 'path';
import { TrayManager } from './tray';
import { OverlayManager } from './overlay';
import { ConfigManager } from './config';
import { IPC_CHANNELS, AppConfig } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let overlayManager: OverlayManager | null = null;
let configManager: ConfigManager;

function createOverlay(config: AppConfig): void {
  overlayManager = new OverlayManager(config);
  mainWindow = overlayManager.getWindow();

  // Setup IPC handlers
  setupIPC();

  // Setup tray
  trayManager = new TrayManager(mainWindow!);

  // Register global hotkey
  if (config.hotkey) {
    globalShortcut.register(config.hotkey, () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
        }
      }
    });
  }
}

function setupIPC(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_LOAD, () => {
    return configManager.load();
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_event, config: Partial<AppConfig>) => {
    const current = configManager.load();
    const updated = { ...current, ...config };
    configManager.save(updated);

    // Re-register hotkey if changed
    if (config.hotkey && config.hotkey !== current.hotkey) {
      globalShortcut.unregisterAll();
      globalShortcut.register(config.hotkey, () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) mainWindow.hide();
          else mainWindow.show();
        }
      });
    }

    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.TOGGLE_TTS, (_event, active: boolean) => {
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.TTS_STATUS, active);
    }
    return active;
  });
}

app.whenReady().then(() => {
  configManager = new ConfigManager();
  const config = configManager.load();
  createOverlay(config);
});

app.on('window-all-closed', () => {
  // Don't quit - app runs in tray
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
});
