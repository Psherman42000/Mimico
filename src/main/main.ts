import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import { TrayManager } from './tray';
import { OverlayManager } from './overlay';
import { ConfigManager } from './config';
import { AudioCaptureManager } from './audio-capture';
import { WhisperManager } from './whisper-manager';
import { TranslatorService } from './translator';
import { VoiceManager } from './voice-manager';
import { IPC_CHANNELS, AppConfig } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let overlayManager: OverlayManager | null = null;
let configManager: ConfigManager;
let audioCapture: AudioCaptureManager;
let whisperManager: WhisperManager;
let translator: TranslatorService;
let voiceManager: VoiceManager;
let ttsActive = false;

function initializeApp(): void {
  configManager = new ConfigManager();
  const config = configManager.load();
  setupOverlay(config);
  setupTranslator(config);
  setupWhisper();
  setupAudioCapture();
  setupVoice();
  setupIpcHandlers();
  new TrayManager(mainWindow!);
  registerGlobalHotkey(config.hotkey);
}

function setupOverlay(config: AppConfig): void {
  overlayManager = new OverlayManager(config);
  mainWindow = overlayManager.getWindow();
}

function setupTranslator(config: AppConfig): void {
  translator = new TranslatorService();
  translator.setWindow(mainWindow!);
  if (config.deepLKey) {
    translator.setApiKey(config.deepLKey);
  }
}

function setupWhisper(): void {
  whisperManager = new WhisperManager('tiny', 'en');
  whisperManager.setWindow(mainWindow!);
  whisperManager.onTranscription(async (result) => {
    sendToWindow(IPC_CHANNELS.TRANSCRIPTION, result.text);
    sendToWindow(IPC_CHANNELS.LATENCY, { total: result.latencyMs, stt: result.latencyMs });

    // Translate and optionally synthesize
    if (translator.isConfigured()) {
      const translation = await translator.translate(result.text);
      sendToWindow(IPC_CHANNELS.TRANSLATION, {
        original: result.text,
        translated: translation.translated,
      });

      // If voice toggle active, synthesize the translation
      if (ttsActive && translation.translated.trim()) {
        voiceManager.synthesize(translation.translated);
      }
    }
  });
}

function setupAudioCapture(): void {
  audioCapture = new AudioCaptureManager();
  audioCapture.setWindow(mainWindow!);
  audioCapture.onChunk((chunk) => {
    whisperManager.transcribeChunk(chunk.data, chunk.sampleRate);
  });
}

function setupVoice(): void {
  voiceManager = new VoiceManager();
  voiceManager.setWindow(mainWindow!);
  voiceManager.onSynthesis((audio) => {
    console.log(`Voice synthesized: ${audio.latencyMs}ms (${audio.backend})`);
    sendToWindow('voice-status', { active: ttsActive, latencyMs: audio.latencyMs });
  });
}

async function startPipelines(): Promise<void> {
  const whisperReady = await whisperManager.start();
  if (!whisperReady) {
    console.error('Whisper failed to start');
    return;
  }
  await voiceManager.start();
  await audioCapture.start();
}

function registerGlobalHotkey(hotkey: string | undefined): void {
  if (!hotkey) { return; }
  globalShortcut.register(hotkey, toggleOverlay);
}

function toggleOverlay(): void {
  if (!mainWindow) { return; }
  if (mainWindow.isVisible()) { mainWindow.hide(); } else { mainWindow.show(); }
}

function sendToWindow(channel: string, data: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) { return; }
  mainWindow.webContents.send(channel, data);
}

function setupIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_LOAD, () => configManager.load());

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_event, partial: Partial<AppConfig>) => {
    const current = configManager.load();
    const updated = { ...current, ...partial };
    configManager.save(updated);
    if (partial.deepLKey && partial.deepLKey !== current.deepLKey) {
      translator.setApiKey(partial.deepLKey);
    }
    if (partial.hotkey && partial.hotkey !== current.hotkey) {
      globalShortcut.unregisterAll();
      registerGlobalHotkey(partial.hotkey);
    }
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.TOGGLE_TTS, (_event, active: boolean) => {
    ttsActive = active;
    sendToWindow(IPC_CHANNELS.TTS_STATUS, active);
    sendToWindow('voice-status', { active });
    return active;
  });

  // Audio controls
  ipcMain.handle('audio-start', () => audioCapture.start());
  ipcMain.handle('audio-stop', () => { audioCapture.stop(); return true; });
  ipcMain.handle('audio-list-devices', () => audioCapture.listDevices());
  ipcMain.handle('audio-status', () => audioCapture.isRunning());

  // Voice controls
  ipcMain.handle('voice-set', (_event, voice: string) => voiceManager.setVoice(voice));
  ipcMain.handle('voice-list', () => voiceManager.listVoices());
  ipcMain.handle('voice-status', () => ({ active: ttsActive, backend: voiceManager.getBackend(), voice: voiceManager.getVoice() }));

  // Translator info
  ipcMain.handle('translator-status', () => ({
    configured: translator.isConfigured(),
    usage: translator.getMonthlyUsage(),
    limit: translator.getMonthlyLimit(),
  }));
}

app.whenReady().then(() => {
  initializeApp();
  startPipelines();
});

app.on('window-all-closed', () => { /* stay in tray */ });

app.on('before-quit', () => {
  audioCapture?.stop();
  whisperManager?.stop();
  voiceManager?.stop();
  globalShortcut.unregisterAll();
});
