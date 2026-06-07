import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { AppConfig, IPC_CHANNELS } from '../shared/types';

export class OverlayManager {
  private window: BrowserWindow;

  constructor(config: AppConfig) {
    this.window = new BrowserWindow({
      width: 420,
      height: 280,
      x: config.overlayPosition?.x ?? 100,
      y: config.overlayPosition?.y ?? 100,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.window.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Save position on move
    this.window.on('moved', () => {
      const [x, y] = this.window.getPosition();
      this.window.webContents.send('position-changed', { x, y });
    });

    // Apply Win32 overlay flags to make it invisible in screen capture
    this.applyCaptureExclusion();

    // Set opacity
    if (config.overlayOpacity !== undefined) {
      this.window.setOpacity(config.overlayOpacity);
    }

    // Open DevTools in dev mode
    if (process.argv.includes('--dev')) {
      this.window.webContents.openDevTools({ mode: 'detach' });
    }
  }

  private applyCaptureExclusion(): void {
    try {
      const { nativeWindow } = require('./win32-overlay');
      nativeWindow.setExcludeFromCapture(this.window);
    } catch {
      console.warn('Win32 overlay module not available, capture exclusion disabled');
    }
  }

  getWindow(): BrowserWindow {
    return this.window;
  }
}
