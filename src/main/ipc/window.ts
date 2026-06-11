/**
 * ipc/window.ts - Handlers IPC da janela overlay/notch
 *
 * Controle de visibilidade, minimizar, fechar para bandeja.
 */

import { ipcMain, BrowserWindow } from 'electron';

export interface WindowIpcContext {
  overlay: {
    show: () => void;
    hide: () => void;
    isVisible: () => boolean;
    setOpacity: (value: number) => void;
    toggleExpand: () => void;
  };
  appLog: (msg: string) => void;
}

export function registerWindowHandlers(ctx: WindowIpcContext): void {
  const { overlay, appLog } = ctx;

  // Minimiza a janela
  ipcMain.on('minimize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  // Fecha a janela (envia para bandeja)
  ipcMain.on('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.hide();
  });

  // Mostra/esconde overlay
  ipcMain.on('toggle-overlay', () => {
    if (overlay.isVisible()) {
      overlay.hide();
    } else {
      overlay.show();
    }
  });

  // Alterna expandido/colapsado
  ipcMain.on('toggle-notch-expand', () => {
    overlay.toggleExpand();
  });

  // Define opacidade
  ipcMain.on('set-overlay-opacity', (_event, opacity: number) => {
    const value = Math.max(0, Math.min(1, opacity));
    overlay.setOpacity(value);
  });
}
