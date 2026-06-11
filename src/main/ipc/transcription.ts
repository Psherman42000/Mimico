/**
 * ipc/transcription.ts - Handlers IPC de transcrição (Whisper)
 */

import { ipcMain } from 'electron';

export interface TranscriptionIpcContext {
  whisperManager: {
    start: (modelSize: string) => Promise<void>;
    stop: () => void;
    transcribe: (chunk: Buffer, lang?: string) => Promise<string>;
  };
  appLog: (msg: string) => void;
}

export function registerTranscriptionHandlers(ctx: TranscriptionIpcContext): void {
  const { whisperManager, appLog } = ctx;

  ipcMain.handle('whisper:start', async (_event, modelSize?: string) => {
    try {
      await whisperManager.start((modelSize as 'tiny' | 'base' | 'small' | 'medium' | 'large') ?? 'tiny');
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      appLog(`whisper:start error: ${msg}`);
      return { success: false, error: msg };
    }
  });

  ipcMain.on('whisper:stop', () => {
    whisperManager.stop();
  });

  ipcMain.handle('whisper:transcribe', async (_event, chunk: Buffer, lang?: string) => {
    try {
      const text = await whisperManager.transcribe(chunk, lang);
      return { success: true, text };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  });
}
