/**
 * main.ts — Ponto de entrada do Mimico
 *
 * Inicializa módulos, configura IPC, atalhos, bandeja e ciclo de vida.
 * Delega lógica de pipeline para PipelineOrchestrator.
 */
import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import { resolve } from 'path';
import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

import { loadConfig, saveConfig, Config } from './config';
import { AudioCapture } from './audio-capture';
import { MicCapture } from './mic-capture';
import { WhisperManager } from './whisper-manager';
import { Translator } from './translator';
import { VoiceManager } from './voice-manager';
import { AudioOutput } from './audio-output';
import { TrayManager } from './tray';
import { NotchOverlay } from './notch-overlay';
import { EdgeTtsProvider } from './tts-edge';
import { ElevenLabsTtsProvider } from './tts-elevenlabs';
import { registerAllIpcHandlers } from './ipc';
import { VisibilityController } from './visibility-controller';
import { SettingsWindow } from './settings-window';
import { PipelineOrchestrator, PipelineCallbacks } from './pipeline';

// ── Constants ──

const APP_NAME = 'Mimico';
const APP_VERSION = '1.0.0';
const PRELOAD_PATH = resolve(__dirname, 'preload.js');

let LOG_PATH = '';

async function initLogFile(): Promise<void> {
  const logDir = app.getPath('userData');
  LOG_PATH = resolve(logDir, 'mimico.log');
  if (!existsSync(LOG_PATH)) {
    await mkdir(resolve(logDir), { recursive: true });
  }
  await appendFile(LOG_PATH, `\n=== ${APP_NAME} v${APP_VERSION} started at ${new Date().toISOString()} ===\n`);
}

function appLog(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [Mimico] ${msg}`;
  console.log(line);
  if (LOG_PATH) appendFile(LOG_PATH, line + '\n').catch(() => {});
}

// ── State ──

let config: Config;
let audioCapture: AudioCapture;
let micCapture: MicCapture;
let whisperManager: WhisperManager;
let translator: Translator;
let voiceManager: VoiceManager;
let audioOutput: AudioOutput;
let trayManager: TrayManager;
let overlay: NotchOverlay;
let visibilityController: VisibilityController;
let settingsWindow: SettingsWindow;
let isQuitting = false;
let pipeline: PipelineOrchestrator;

// ── TTS Provider Management ──

let edgeProvider: EdgeTtsProvider | null = null;
let elevenLabsProvider: ElevenLabsTtsProvider | null = null;

async function initTtsProvider(): Promise<void> {
  try {
    if (config.ttsProvider === 'elevenlabs') {
      if (!elevenLabsProvider) {
        elevenLabsProvider = new ElevenLabsTtsProvider(
          config.elevenLabsKey, config.elevenLabsVoiceId, config.elevenLabsModel,
        );
      } else {
        elevenLabsProvider.setApiKey(config.elevenLabsKey);
        elevenLabsProvider.setVoiceId(config.elevenLabsVoiceId);
        elevenLabsProvider.setModelId(config.elevenLabsModel);
      }
      await voiceManager.setProvider(elevenLabsProvider);
      appLog(`TTS provider: ElevenLabs (${config.elevenLabsModel})`);
    } else {
      if (!edgeProvider) edgeProvider = new EdgeTtsProvider();
      await voiceManager.setProvider(edgeProvider);
      appLog('TTS provider: Edge');
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    appLog(`TTS init error: ${err.message}`);
    if (config.ttsProvider === 'elevenlabs') {
      try {
        if (!edgeProvider) edgeProvider = new EdgeTtsProvider();
        await voiceManager.setProvider(edgeProvider);
        appLog('Falling back to Edge TTS');
      } catch { /* silent */ }
    }
  }
}

// ── IPC ──

function setupIPC(): void {
  registerAllIpcHandlers({
    loadConfig: () => config,
    saveConfig: (partial) => {
      saveConfig(partial);
      config = loadConfig();
    },
    applyConfigChanges,
    appLog,
    overlay: {
      show: () => overlay.show(),
      hide: () => overlay.hide(),
      isVisible: () => overlay.isVisible(),
      setOpacity: (v) => overlay.setOpacity(v),
      toggleExpand: () => overlay.toggleExpand(),
    },
    audioCapture,
    micCapture,
    audioOutput: {
      start: () => audioOutput.start(),
      stop: () => audioOutput.stop(),
      setMixMode: (m) => audioOutput.setMixMode(m),
    },
    whisperManager: {
      start: (modelSize) => whisperManager.start(modelSize as 'tiny' | 'base' | 'small' | 'medium' | 'large'),
      stop: () => whisperManager.stop(),
      transcribe: (chunk, lang) => whisperManager.transcribe(chunk, lang),
    },
    translator: {
      translate: (text, from, to) => translator.translate(text, from, to),
      setApiKey: (key) => translator.setApiKey(key),
    },
    voiceManager: {
      speakText: (text, lang) => voiceManager.speakText(text, lang),
      stop: () => voiceManager.stop(),
      isSpeaking: voiceManager.isSpeaking,
      getProviderName: () => voiceManager.getProviderName(),
      getProvider: () => voiceManager.getProvider(),
    },
  });
}

function applyConfigChanges(): void {
  overlay.setOpacity(config.overlayOpacity);
  translator.setApiKey(config.deepKey);
  audioOutput.setMixMode(config.voiceMixMode);
  overlay.setMixMode(config.voiceMixMode);
  overlay.setMode(config.appMode);
  overlay.setTtsProvider(config.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'Edge');
  overlay.setVoiceActive(config.toggleVoice);

  const currentProviderName = voiceManager.getProviderName();
  const targetProviderName = config.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'Edge';
  if (currentProviderName !== targetProviderName) {
    initTtsProvider().catch((err) => appLog(`TTS provider swap failed: ${err.message}`));
  }

  if (pipeline.active) {
    if (config.toggleVoice) {
      audioOutput.start().catch((err) => appLog(`Failed to start audio output: ${err.message}`));
      micCapture.start().catch((err) => appLog(`Failed to start mic capture: ${err.message}`));
    } else {
      audioOutput.stop();
      micCapture.stop();
    }
  }
}

// ── Shortcuts ──

function registerGlobalShortcuts(): void {
  globalShortcut.register(config.toggleHotkey, () => {
    if (pipeline.active) {
      const next: 'subtitles' | 'voice' = config.appMode === 'subtitles' ? 'voice' : 'subtitles';
      config.appMode = next;
      saveConfig({ appMode: next });
      pipeline.restart();
      overlay.setMode(next);
      trayManager.setMode(next);
      const label = next === 'voice' ? '🎤 Dublagem ativa' : '💬 Só legendas';
      trayManager.showNotification(APP_NAME, label);
    } else {
      pipeline.start();
    }
  });

  globalShortcut.register(config.overlayHotkey, () => {
    if (overlay.isVisible()) overlay.hide();
    else overlay.show();
  });
}

function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}

// ── Broadcast ──

function broadcastTranslationToSettings(en: string, pt: string): void {
  try {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed() && win.webContents.getURL().includes('settings.html')) {
        win.webContents.send('translation-feed', { en, pt });
      }
    }
  } catch { /* settings window may not exist */ }
}

function openSettings(): void {
  settingsWindow?.show();
}

// ── Module Inits ──

function initializeModules(): void {
  config = loadConfig();
  audioCapture = new AudioCapture();
  micCapture = new MicCapture();
  whisperManager = new WhisperManager();
  translator = new Translator(config.deepKey);
  voiceManager = new VoiceManager();
  audioOutput = new AudioOutput();
  overlay = new NotchOverlay();
  trayManager = new TrayManager();

  const cb: PipelineCallbacks = {
    broadcastTranslation: broadcastTranslationToSettings,
    showNotification: (t, b) => trayManager.showNotification(t, b),
    log: appLog,
  };
  pipeline = new PipelineOrchestrator(
    audioCapture, micCapture, whisperManager, translator,
    voiceManager, audioOutput, overlay, trayManager,
    () => config, cb,
  );
}

function setupModuleListeners(): void {
  audioCapture.on('data', (chunk: Buffer) => pipeline.processAudioChunk(chunk));
  audioCapture.on('error', (error: Error) => {
    appLog(`Audio capture error: ${error.message}`);
    if (pipeline.active) {
      pipeline.stop();
      trayManager.showNotification(APP_NAME, `Erro na captura: ${error.message}`);
    }
  });
  audioCapture.on('exit', () => { if (pipeline.active) pipeline.stop(); });

  micCapture.on('data', (chunk: Buffer) => pipeline.processMicAudioChunk(chunk));
  micCapture.on('error', (error: Error) => appLog(`Mic capture error: ${error.message}`));
  micCapture.on('exit', () => appLog('Mic capture exited'));

  whisperManager.on('model-loaded', (modelSize: string) => {
    appLog(`Whisper model '${modelSize}' loaded`);
    trayManager.showNotification(APP_NAME, `Modelo Whisper '${modelSize}' carregado`);
  });
  whisperManager.on('error', (error: Error) => appLog(`Whisper error: ${error.message}`));

  translator.on('error', (error: Error) => appLog(`Translation error: ${error.message}`));

  voiceManager.on('started', (text: string) => appLog(`TTS started: "${text.slice(0, 40)}…"`));
  voiceManager.on('finished', () => appLog('TTS finished'));
  voiceManager.on('error', (error: Error) => appLog(`TTS error: ${error.message}`));
  voiceManager.on('audio', (buffer: Buffer) => {
    if (config.toggleVoice && audioOutput.running) {
      audioOutput.play(buffer).catch((err) => appLog(`Audio output play error: ${err.message}`));
    }
  });

  audioOutput.on('error', (error: Error) => appLog(`Audio output error: ${error.message}`));

  overlay.onToggleVoice = (active: boolean) => {
    config.toggleVoice = active;
    saveConfig({ toggleVoice: active });
    pipeline.applyVoiceToggle(active);
  };
}

// ── Lifecycle ──

async function main(): Promise<void> {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }

  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      const win = wins[0];
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  initializeModules();
  await app.whenReady();
  await initLogFile();
  appLog(`Starting ${APP_NAME} v${APP_VERSION}`);

  await overlay.create(config.overlayOpacity);
  await initTtsProvider();
  setupIPC();

  trayManager.init(BrowserWindow.getAllWindows()[0], config.appMode, {
    onSetMode: (mode) => {
      config.appMode = mode;
      saveConfig({ appMode: mode });
      overlay.setMode(mode);
      pipeline.restart();
    },
    onSettings: openSettings,
    onQuit: () => { isQuitting = true; app.quit(); },
  });

  registerGlobalShortcuts();

  visibilityController = new VisibilityController({
    getMainWindow: () => ({
      getOpacity: () => overlay.getOpacity(),
      setOpacity: (v) => overlay.setOpacity(v),
      show: () => overlay.show(),
      hide: () => overlay.hide(),
      isVisible: () => overlay.isVisible(),
    }),
  });
  visibilityController.register('CmdOrCtrl+B');

  settingsWindow = new SettingsWindow();
  setupModuleListeners();
  pipeline.start();

  appLog(`${APP_NAME} v${APP_VERSION} initialized successfully`);
  trayManager.showNotification(APP_NAME, 'Mimico iniciado. Use Alt+Shift+M para ligar/desligar.');
}

// ── Electron Events ──

app.on('window-all-closed', () => {
  BrowserWindow.getAllWindows().forEach((win) => win.hide());
});

app.on('activate', () => {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) overlay.create(config.overlayOpacity).catch(console.error);
  else wins[0].show();
});

app.on('before-quit', () => { if (isQuitting) cleanup(); });
app.on('will-quit', () => { unregisterGlobalShortcuts(); cleanup(); });

// ── Cleanup ──

function cleanup(): void {
  appLog('Cleaning up resources...');
  pipeline?.stop();
  visibilityController?.dispose();
  trayManager?.destroy();
  overlay?.dispose();
  settingsWindow?.dispose();
  audioCapture?.dispose();
  micCapture?.dispose();
  whisperManager?.dispose();
  translator?.dispose();
  voiceManager?.dispose();
  audioOutput?.dispose();
  appLog('Cleanup complete');
}

main().catch((error) => {
  appLog(`Fatal initialization error: ${error}`);
  app.quit();
});
