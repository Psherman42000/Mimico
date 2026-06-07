import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import { TrayManager } from './tray';
import { OverlayManager } from './overlay';
import { ConfigManager } from './config';
import { AudioCaptureManager } from './audio-capture';
import { WhisperManager } from './whisper-manager';
import { TranslatorService } from './translator';
import { IPC_CHANNELS, AppConfig } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let overlayManager: OverlayManager | null = null;
let configManager: ConfigManager;
let audioCapture: AudioCaptureManager;
let whisperManager: WhisperManager;
let translator: TranslatorService;

function initializeApp(): void {
  configManager = new ConfigManager();
  const config = configManager.load();
  setupOverlay(config);
  setupTranslator(config);
  setupWhisper();
  setupAudioCapture();
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
    // Send original transcription to overlay
    sendToWindow(IPC_CHANNELS.TRANSCRIPTION, result.text);
    sendToWindow(IPC_CHANNELS.LATENCY, {
      total: result.latencyMs,
      stt: result.latencyMs,
    });

    // Translate if we have an API key
    if (translator.isConfigured()) {
      const translation = await translator.translate(result.text);
      sendToWindow(IPC_CHANNELS.TRANSLATION, {
        original: result.text,
        translated: translation.translated,
      });
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

async function startPipelines(): Promise<void> {
  const whisperReady = await whisperManager.start();
  if (!whisperReady) {
    console.error('Whisper failed to start');
    return;
  }
  await audioCapture.start();
}

function registerGlobalHotkey(hotkey: string | undefined): void {
  if (!hotkey) {
    return;
  }
  globalShortcut.register(hotkey, toggleOverlay);
}

function toggleOverlay(): void {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
}

function sendToWindow(channel: string, data: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, data);
}

function setupIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_LOAD, () => configManager.load());

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_event, partial: Partial<AppConfig>) => {
    const current = configManager.load();
    const updated = { ...current, ...partial };
    configManager.save(updated);

    // Reconfigure translator if key changed
    if (partial.deepLKey && partial.deepLKey !== current.deepLKey) {
      translator.setApiKey(partial.deepLKey);
    }

    // Re-register hotkey if changed
    if (partial.hotkey && partial.hotkey !== current.hotkey) {
      globalShortcut.unregisterAll();
      registerGlobalHotkey(partial.hotkey);
    }
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.TOGGLE_TTS, (_event, active: boolean) => {
    sendToWindow(IPC_CHANNELS.TTS_STATUS, active);
    return active;
  });

  // Audio controls
  ipcMain.handle('audio-start', () => audioCapture.start());
  ipcMain.handle('audio-stop', () => {
    audioCapture.stop();
    return true;
  });
  ipcMain.handle('audio-list-devices', () => audioCapture.listDevices());
  ipcMain.handle('audio-status', () => audioCapture.isRunning());

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
  globalShortcut.unregisterAll();
});
