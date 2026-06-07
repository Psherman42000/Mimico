import { AppConfig, LatencyReport } from './types';

export interface MimicoAPI {
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (config: Partial<AppConfig>) => Promise<AppConfig>;
  toggleTTS: (active: boolean) => Promise<boolean>;
  onTranscription: (cb: (text: string) => void) => void;
  onTranslation: (cb: (data: { original: string; translated: string }) => void) => void;
  onTTSStatus: (cb: (active: boolean) => void) => void;
  onLatency: (cb: (latency: LatencyReport) => void) => void;
  onOpenSettings: (cb: () => void) => void;
  onPositionChanged: (cb: (pos: { x: number; y: number }) => void) => void;
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    mimico: MimicoAPI;
  }
}

export {};
