import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, AppConfig, AppState } from '../shared/types';

const api = {
  // Config
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_LOAD),
  saveConfig: (config: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, config),

  // TTS Toggle
  toggleTTS: (active: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_TTS, active),

  // Listeners
  onTranscription: (cb: (text: string) => void) =>
    ipcRenderer.on(IPC_CHANNELS.TRANSCRIPTION, (_e, data) => cb(data)),

  onTranslation: (cb: (data: { original: string; translated: string }) => void) =>
    ipcRenderer.on(IPC_CHANNELS.TRANSLATION, (_e, data) => cb(data)),

  onTTSStatus: (cb: (active: boolean) => void) =>
    ipcRenderer.on(IPC_CHANNELS.TTS_STATUS, (_e, data) => cb(data)),

  onLatency: (cb: (latency: any) => void) =>
    ipcRenderer.on(IPC_CHANNELS.LATENCY, (_e, data) => cb(data)),

  onOpenSettings: (cb: () => void) =>
    ipcRenderer.on('open-settings', () => cb()),

  onPositionChanged: (cb: (pos: { x: number; y: number }) => void) =>
    ipcRenderer.on('position-changed', (_e, pos) => cb(pos)),

  // Cleanup
  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
};

contextBridge.exposeInMainWorld('mimico', api);
