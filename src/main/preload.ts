import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, AppConfig, LatencyReport } from '../shared/types';
import { MimicoAPI } from '../shared/window-api';

const api: MimicoAPI = {
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_LOAD),

  saveConfig: (config: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, config),

  toggleTTS: (active: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_TTS, active),

  onTranscription: (cb: (text: string) => void) =>
    ipcRenderer.on(IPC_CHANNELS.TRANSCRIPTION, (_e, data: string) => cb(data)),

  onTranslation: (cb: (data: { original: string; translated: string }) => void) =>
    ipcRenderer.on(IPC_CHANNELS.TRANSLATION, (_e, data) => cb(data as { original: string; translated: string })),

  onTTSStatus: (cb: (active: boolean) => void) =>
    ipcRenderer.on(IPC_CHANNELS.TTS_STATUS, (_e, data: boolean) => cb(data)),

  onLatency: (cb: (latency: LatencyReport) => void) =>
    ipcRenderer.on(IPC_CHANNELS.LATENCY, (_e, data: LatencyReport) => cb(data)),

  onOpenSettings: (cb: () => void) =>
    ipcRenderer.on('open-settings', () => cb()),

  onPositionChanged: (cb: (pos: { x: number; y: number }) => void) =>
    ipcRenderer.on('position-changed', (_e, pos) => cb(pos as { x: number; y: number })),

  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
};

contextBridge.exposeInMainWorld('mimico', api);
