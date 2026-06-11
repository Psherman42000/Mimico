/** ipc/audio.ts - Handlers IPC de áudio */

import { ipcMain } from 'electron';

export interface AudioIpcContext {
  audioCapture: {
    start: (opts: { deviceName: string; sampleRate: number }) => Promise<void>;
    stop: () => void;
  };
  micCapture: {
    start: () => Promise<void>;
    stop: () => void;
  };
  audioOutput: {
    start: () => Promise<void>;
    stop: () => void;
    setMixMode: (mode: 'replace' | 'overlay') => void;
  };
  appLog: (msg: string) => void;
}

export function registerAudioHandlers(ctx: AudioIpcContext): void {
  const { audioCapture, micCapture, audioOutput, appLog } = ctx;

  // Inicia/para captura de áudio do sistema
  ipcMain.handle('audio:start-loopback', async (_event, opts?: { deviceName?: string; sampleRate?: number }) => {
    try {
      await audioCapture.start({
        deviceName: opts?.deviceName ?? 'default',
        sampleRate: opts?.sampleRate ?? 16000,
      });
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      appLog(`audio:start-loopback error: ${msg}`);
      return { success: false, error: msg };
    }
  });

  ipcMain.on('audio:stop-loopback', () => {
    audioCapture.stop();
  });

  // Inicia/para captura do microfone
  ipcMain.handle('audio:start-mic', async () => {
    try {
      await micCapture.start();
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      appLog(`audio:start-mic error: ${msg}`);
      return { success: false, error: msg };
    }
  });

  ipcMain.on('audio:stop-mic', () => {
    micCapture.stop();
  });

  // Controle de saída VB-Cable
  ipcMain.handle('audio:start-output', async () => {
    try {
      await audioOutput.start();
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  });

  ipcMain.on('audio:stop-output', () => {
    audioOutput.stop();
  });

  ipcMain.on('audio:set-mix-mode', (_event, mode: 'replace' | 'overlay') => {
    audioOutput.setMixMode(mode);
  });
}
