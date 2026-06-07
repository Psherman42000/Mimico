import { BrowserWindow, Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';

export class TrayManager {
  private tray: Tray;

  constructor(window: BrowserWindow) {
    const icon = this.loadIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip('Mimico — Tradução em tempo real');
    this.tray.setContextMenu(this.buildMenu(window));
    this.tray.on('click', () => this.toggleWindow(window));
  }

  private loadIcon(): Electron.NativeImage {
    const iconPath = path.join(__dirname, '../../resources/icon.png');
    try {
      return nativeImage.createFromPath(iconPath);
    } catch {
      return nativeImage.createEmpty();
    }
  }

  private toggleWindow(window: BrowserWindow): void {
    if (window.isVisible()) {
      window.hide();
    } else {
      window.show();
    }
  }

  private buildMenu(window: BrowserWindow): Electron.Menu {
    return Menu.buildFromTemplate([
      {
        label: 'Mostrar / Ocultar Overlay',
        click: () => this.toggleWindow(window),
      },
      { type: 'separator' },
      {
        label: 'Configurações',
        click: () => {
          window.webContents.send('open-settings');
          window.show();
        },
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => app.quit(),
      },
    ]);
  }
}
