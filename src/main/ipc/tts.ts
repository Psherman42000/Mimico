/** ipc/tts.ts - Handlers IPC de síntese de voz (TTS) */

import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TtsProvider } from '../tts-provider';

const execFileAsync = promisify(execFile);

export interface TtsIpcContext {
  voiceManager: {
    speakText: (text: string, lang: string) => Promise<void>;
    stop: () => void;
    isSpeaking: boolean;
    getProviderName: () => string;
    getProvider: () => TtsProvider | null;
  };
  appLog: (msg: string) => void;
}

export function registerTtsHandlers(ctx: TtsIpcContext): void {
  const { voiceManager, appLog } = ctx;

  ipcMain.handle('tts:speak', async (_event, text: string, lang: string) => {
    try {
      await voiceManager.speakText(text, lang);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      appLog(`tts:speak error: ${msg}`);
      return { success: false, error: msg };
    }
  });

  ipcMain.on('tts:stop', () => {
    voiceManager.stop();
  });

  ipcMain.handle('tts:status', () => {
    return {
      speaking: voiceManager.isSpeaking,
      provider: voiceManager.getProviderName(),
    };
  });

  ipcMain.handle('tts:provider-info', () => {
    const provider = voiceManager.getProvider();
    if (provider) {
      return provider.getInfo();
    }
    return { name: 'Nenhum', needsApiKey: false, hasApiKey: false };
  });

  ipcMain.handle('edge:list-voices', async () => {
    try {
      const { stdout } = await execFileAsync('edge-tts', ['--list-voices'], {
        timeout: 10000, windowsHide: true,
      });
      const voices = stdout.split('\n')
        .filter(line => line.startsWith('Name:'))
        .map(line => line.replace('Name:', '').trim().split(/\s+/)[0])
        .filter(Boolean);
      return { success: true, voices };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
