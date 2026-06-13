/** ipc/translation.ts - Handlers IPC de tradução (DeepL) */

import { ipcMain } from 'electron';

export interface TranslationIpcContext {
  translator: {
    translate: (text: string, from: string, to: string) => Promise<string | null>;
    setApiKey: (key: string) => void;
  };
  appLog: (msg: string) => void;
}

export function registerTranslationHandlers(ctx: TranslationIpcContext): void {
  const { translator, appLog } = ctx;

  ipcMain.handle('translate:text', async (_event, text: string, from: string, to: string) => {
    try {
      const result = await translator.translate(text, from, to);
      return { success: true, text: result };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      appLog(`translate:text error: ${msg}`);
      return { success: false, error: msg };
    }
  });

  ipcMain.on('translate:set-api-key', (_event, key: string) => {
    translator.setApiKey(key);
  });
}
