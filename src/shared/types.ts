/** Tipos e interfaces compartilhados entre main e renderer */

export interface TranscriptionResult {
  text: string;
  language: string;
  segments: Array<{ start: number; end: number; text: string }>;
  latency: number;
}

export interface TranslationResult {
  original: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
  latency: number;
}

export interface TTSResult {
  audioPath?: string;
  latency: number;
  provider: 'local' | 'cartesia' | 'fish' | 'openai';
}

export interface LatencyReport {
  capture: number;
  stt: number;
  translation: number;
  tts: number;
  total: number;
}

export interface AppConfig {
  deepLKey: string;
  ttsMode: 'local' | 'api';
  ttsProvider: 'cartesia' | 'fish' | 'openai';
  ttsApiKey: string;
  voiceSamplePath: string;
  overlayPosition: { x: number; y: number };
  overlayOpacity: number;
  autoStart: boolean;
  hotkey: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export type AppStatus =
  | 'idle'
  | 'listening'
  | 'capturing'
  | 'transcribing'
  | 'translating'
  | 'speaking';

export interface AppState {
  status: AppStatus;
  transcription: string;
  translation: string;
  ttsActive: boolean;
  latency: LatencyReport;
  config: AppConfig;
}

/** IPC Channels */
export const IPC_CHANNELS = {
  TRANSCRIPTION: 'transcription',
  TRANSLATION: 'translation',
  TTS_STATUS: 'tts-status',
  LATENCY: 'latency',
  CONFIG_LOAD: 'config-load',
  CONFIG_SAVE: 'config-save',
  CONFIG_CHANGED: 'config-changed',
  TOGGLE_TTS: 'toggle-tts',
  RECORD_VOICE: 'record-voice',
  START_CAPTURE: 'start-capture',
  STOP_CAPTURE: 'stop-capture',
  TEST_LATENCY: 'test-latency',
} as const;
