/** Types for the Mimico API exposed via preload */

export interface MimicoAPI {
  loadConfig: () => Promise<any>;
  saveConfig: (config: any) => Promise<any>;
  toggleTTS: (active: boolean) => Promise<boolean>;
  onTranscription: (cb: (text: string) => void) => void;
  onTranslation: (cb: (data: { original: string; translated: string }) => void) => void;
  onTTSStatus: (cb: (active: boolean) => void) => void;
  onLatency: (cb: (latency: any) => void) => void;
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
