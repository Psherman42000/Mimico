import { BrowserWindow } from 'electron';
import * as path from 'path';
import { AppConfig } from '../shared/types';

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

    this.window.on('moved', () => {
      const [posX, posY] = this.window.getPosition();
      this.window.webContents.send('position-changed', { x: posX, y: posY });
    });

    this.applyCaptureExclusion();

    if (config.overlayOpacity !== undefined) {
      this.window.setOpacity(config.overlayOpacity);
    }

    if (process.argv.includes('--dev')) {
      this.window.webContents.openDevTools({ mode: 'detach' });
    }
  }

  private applyCaptureExclusion(): void {
    try {
    // Dynamic import to avoid crash if native module unavailable
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const win32 = require('./win32-overlay');
      win32.nativeWindow.setExcludeFromCapture(this.window);
    } catch {
      console.warn('Win32 overlay module unavailable - capture exclusion disabled');
    }
  }

  getWindow(): BrowserWindow {
    return this.window;
  }
}
