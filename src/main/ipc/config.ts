/**
 * ipc/config.ts - Handlers IPC de configuração
 *
 * CRUD da configuração com broadcast para todas as janelas.
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { Config } from '../config';

export interface ConfigIpcContext {
  loadConfig: () => Config;
  saveConfig: (partial: Partial<Config>) => void;
  applyConfigChanges: () => void;
  appLog: (msg: string) => void;
}

export function registerConfigHandlers(ctx: ConfigIpcContext): void {
  const { loadConfig, saveConfig, applyConfigChanges, appLog } = ctx;

  // Retorna a configuração atual (síncrono)
  ipcMain.on('get-config', (event) => {
    event.returnValue = loadConfig();
  });

  // Salva alterações na configuração
  ipcMain.on('save-config', (_event, partial: Record<string, unknown>) => {
    try {
      saveConfig(partial as Partial<Config>);

      // Aplica alterações em tempo real
      applyConfigChanges();

      // Notifica renderer
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('config-changed', loadConfig());
      });
    } catch (error) {
      appLog(`Failed to save config: ${error}`);
    }
  });
}
