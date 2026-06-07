import { BrowserWindow, Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';

export class TrayManager {
  private tray: Tray;

  constructor(window: BrowserWindow) {
    // Create a simple 16x16 icon (will be replaced with proper icon later)
    const icon = nativeImage.createEmpty();
    this.tray = new Tray(icon);

    // Set a proper icon size
    const iconPath = path.join(__dirname, '../../resources/icon.png');
    try {
      this.tray.setImage(nativeImage.createFromPath(iconPath));
    } catch {
      // Use empty icon as fallback
      this.tray.setImage(icon);
    }

    this.tray.setToolTip('Mimico — Tradução em tempo real');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mostrar / Ocultar Overlay',
        click: () => {
          if (window.isVisible()) window.hide();
          else window.show();
        },
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
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);

    // Click on tray toggles overlay
    this.tray.on('click', () => {
      if (window.isVisible()) window.hide();
      else window.show();
    });
  }
}
