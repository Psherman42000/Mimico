/**
 * main.ts - Pipeline orquestrador principal do Mimico
 *
 * Gerencia o ciclo de vida completo do aplicativo Electron:
 * 1. Inicializa configuração (electron-store)
 * 2. Cria ícone na bandeja do sistema
 * 3. Cria janela overlay transparente
 * 4. Inicializa captura de áudio (WASAPI loopback)
 * 5. Inicializa transcrição (Faster-Whisper)
 * 6. Inicializa tradução (DeepL com cache LRU)
 * 7. Inicializa síntese de voz (Edge TTS)
 * 8. Pipeline: áudio -> whisper -> EN -> DeepL -> PT -> overlay + voz
 *
 * O app roda na bandeja: 'window-all-closed' não fecha o app.
 */

import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import { resolve } from 'path';
import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// Importações dos módulos do Mimico
import { loadConfig, saveConfig, Config } from './config';
import { AudioCapture } from './audio-capture';
import { MicCapture } from './mic-capture';
import { WhisperManager } from './whisper-manager';
import { Translator } from './translator';
import { VoiceManager } from './voice-manager';
import { AudioOutput } from './audio-output';
import { TrayManager } from './tray';
import { Overlay } from './overlay';

// ============================================================
// Constantes do aplicativo
// ============================================================

/** Nome do aplicativo */
const APP_NAME = 'Mimico';

/** Versão do aplicativo */
const APP_VERSION = '1.0.0';

/** Diretório base do projeto */
const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Caminho do preload script */
const PRELOAD_PATH = resolve(__dirname, 'preload.js');

/** Caminho do arquivo de log */
let LOG_PATH = '';

/**
 * Inicializa o arquivo de log no diretório userData.
 */
async function initLogFile(): Promise<void> {
  const logDir = app.getPath('userData');
  LOG_PATH = resolve(logDir, 'mimico.log');
  if (!existsSync(LOG_PATH)) {
    await mkdir(resolve(logDir), { recursive: true });
  }
  await appendFile(LOG_PATH, `\n=== ${APP_NAME} v${APP_VERSION} started at ${new Date().toISOString()} ===\n`);
}

/**
 * Log com timestamp, console + arquivo.
 */
function appLog(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [Mimico] ${msg}`;
  console.log(line);
  if (LOG_PATH) {
    appendFile(LOG_PATH, line + '\n').catch(() => {});
  }
}

// ============================================================
// Estado global do aplicativo
// ============================================================

/** Configuração atual carregada do disco */
let config: Config;

/** Gerenciador de captura de áudio WASAPI */
let audioCapture: AudioCapture;

/** Gerenciador de captura do microfone (Pipeline B) */
let micCapture: MicCapture;

/** Gerenciador de transcrição Faster-Whisper */
let whisperManager: WhisperManager;

/** Tradutor DeepL */
let translator: Translator;

/** Gerenciador de síntese de voz Edge TTS */
let voiceManager: VoiceManager;

/** Gerenciador de saída de áudio VB-Cable */
let audioOutput: AudioOutput;

/** Gerenciador do ícone de bandeja */
let trayManager: TrayManager;

/** Janela overlay de legendas */
let overlay: Overlay;

/** Indica se o pipeline está ativo (capturando + transcrevendo) */
let isPipelineActive = false;

/** Indica se o aplicativo está em processo de encerramento */
let isQuitting = false;

// ============================================================
// Pipeline de áudio -> transcrição -> tradução -> overlay
// ============================================================

/**
 * Inicia o pipeline de processamento de áudio conforme o modo atual.
 *
 * Modos:
 * - 'off' → não inicia nada
 * - 'subtitles' → só Pipeline A (loopback → whisper → deepl → overlay)
 * - 'voice' → Pipeline A + Pipeline B (mic → tts → vb-cable)
 */
async function startPipeline(): Promise<void> {
  if (isPipelineActive) return;

  try {
    // Pipeline A — sempre ativo em subtitles e voice
    if (config.appMode === 'subtitles' || config.appMode === 'voice') {
      await audioCapture.start({
        deviceName: 'default',
        sampleRate: 16000,
      });
      appLog('Audio capture started');

      await whisperManager.start(config.whisperModelSize as 'tiny' | 'base' | 'small' | 'medium' | 'large');
      appLog('Whisper model loaded successfully');
    }

    // Pipeline B — apenas no modo voice
    if (config.appMode === 'voice') {
      if (config.toggleVoice) {
        audioOutput.start().catch((err: Error) => {
          appLog(`Failed to start audio output: ${err.message}`);
        });
        micCapture.start().catch((err: Error) => {
          appLog(`Failed to start mic capture: ${err.message}`);
        });
      }
    }

    isPipelineActive = true;
    trayManager.setEnabled(true);

    const modeLabel = config.appMode === 'voice' ? '🎤 Voz' : '💬 Legendas';
    appLog(`Pipeline started (${modeLabel})`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    appLog(`Failed to start pipeline: ${err.message}`);
    trayManager.showNotification(APP_NAME, `Erro ao iniciar: ${err.message}`);
  }
}

/**
 * Para o pipeline de processamento de áudio.
 */
function stopPipeline(): void {
  if (!isPipelineActive) return;

  audioCapture.stop();
  micCapture.stop();
  whisperManager.stop();
  audioOutput.stop();
  overlay.clearText();

  isPipelineActive = false;
  trayManager.setEnabled(false);

  appLog('Pipeline stopped');
}

/**
 * Alterna o estado do pipeline (liga/desliga).
 */
function togglePipeline(): void {
  if (isPipelineActive) {
    stopPipeline();
  } else {
    startPipeline();
  }
}

/**
 * Reinicia o pipeline conforme o modo atual.
 */
function restartPipeline(): void {
  stopPipeline();
  if (config.appMode !== 'off') {
    startPipeline();
  }
}

/**
 * Processa um chunk de áudio: transcreve, traduz e exibe.
 *
 * @param chunk - Buffer PCM 16-bit mono 16000Hz
 */
function processAudioChunk(chunk: Buffer): void {
  if (!isPipelineActive) return;

  whisperManager.transcribe(chunk)
    .then((enText: string) => {
      if (!enText || enText.trim().length === 0) return;

      // Traduz EN -> PT
      return translator.translate(enText, 'EN', config.language)
        .then((ptText: string) => {
          // Remove prefixo de erro/aviso antes de exibir no overlay
          const displayPT = ptText.startsWith('[') && ptText.includes(']')
            ? ptText
            : ptText;

          // Atualiza overlay
          overlay.updateText(enText, displayPT);

          // Se toggle voz ativo, sintetiza PT
          if (config.toggleVoice && !ptText.startsWith('[')) {
            const langMap: Record<string, string> = {
              'PT': 'pt-BR',
              'EN': 'en-US',
              'ES': 'es-ES',
              'FR': 'fr-FR',
              'DE': 'de-DE',
            };
            const ttsLang = langMap[config.language] ?? 'pt-BR';

            voiceManager.speakText(displayPT, ttsLang)
              .then(() => {
                // Áudio sintetizado, envia para VB-Cable
                // O voiceManager emite 'audio' com o buffer WAV
              })
              .catch((err: Error) => {
                appLog(`TTS error: ${err.message}`);
              });
          }
        });
    })
    .catch((error: Error) => {
      // Erros de transcrição são esperados (silêncio, áudio baixo, etc.)
      // Apenas loga em modo debug
      appLog(`Transcription skipped: ${error.message}`);
    });
}

/**
 * Processa um chunk de áudio do microfone: transcreve PT, traduz EN, sintetiza voz.
 *
 * Pipeline B: sua voz PT → Whisper PT → DeepL PT→EN → Edge TTS EN → VB-Cable
 *
 * @param chunk - Buffer PCM 16-bit mono 16000Hz do microfone
 */
function processMicAudioChunk(chunk: Buffer): void {
  if (!isPipelineActive || !config.toggleVoice) return;

  whisperManager.transcribe(chunk, 'pt')
    .then((ptText: string) => {
      if (!ptText || ptText.trim().length === 0) return;

      const cleanText = ptText.startsWith('[') ? ptText : ptText;

      // Traduz PT -> EN
      return translator.translate(cleanText, 'PT', 'EN')
        .then((enText: string) => {
          if (enText.startsWith('[')) return;

          appLog(`[Mic] PT→EN: "${cleanText.slice(0, 40)}..." → "${enText.slice(0, 40)}..."`);

          // Sintetiza voz em inglês
          voiceManager.speakText(enText, 'en-US')
            .catch((err: Error) => {
              appLog(`[Mic] TTS error: ${err.message}`);
            });
        });
    })
    .catch((error: Error) => {
      appLog(`[Mic] Transcription skipped: ${error.message}`);
    });
}

// ============================================================
// Handlers IPC
// ============================================================

/**
 * Configura todos os handlers IPC para comunicação com o renderer.
 */
function setupIPC(): void {
  // Retorna a configuração atual (síncrono)
  ipcMain.on('get-config', (event) => {
    event.returnValue = config;
  });

  // Salva alterações na configuração
  ipcMain.on('save-config', (_event, partial: Record<string, unknown>) => {
    try {
      saveConfig(partial);

      // Atualiza configuração local
      config = loadConfig();

      // Aplica alterações em tempo real
      applyConfigChanges();

      // Notifica renderer
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('config-changed', config);
      });
    } catch (error) {
      appLog(`Failed to save config: ${error}`);
    }
  });

  // Minimiza a janela
  ipcMain.on('minimize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  // Fecha a janela (envia para bandeja)
  ipcMain.on('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.hide();
  });
}

/**
 * Aplica alterações de configuração nos módulos em tempo real.
 */
function applyConfigChanges(): void {
  // Atualiza opacidade do overlay
  overlay.setOpacity(config.overlayOpacity);

  // Atualiza chave da API DeepL
  translator.setApiKey(config.deepKey);

  // Atualiza mix mode (replace/overlay)
  audioOutput.setMixMode(config.voiceMixMode);

  // Se toggle voz mudou, inicia/para audio output + mic capture
  if (isPipelineActive) {
    if (config.toggleVoice) {
      audioOutput.start().catch((err: Error) => {
        appLog(`Failed to start audio output: ${err.message}`);
      });
      micCapture.start().catch((err: Error) => {
        appLog(`Failed to start mic capture: ${err.message}`);
      });
    } else {
      audioOutput.stop();
      micCapture.stop();
    }
  }
}

// ============================================================
// Atalhos globais
// ============================================================

/**
 * Registra atalhos globais de teclado.
 */
function registerGlobalShortcuts(): void {
  // Atalho para toggle liga/desliga
  globalShortcut.register(config.toggleHotkey, () => {
    if (isPipelineActive) {
      const next = config.appMode === 'subtitles' ? 'voice' : 'subtitles';
      config.appMode = next;
      saveConfig({ appMode: next });
      restartPipeline();
      trayManager.setMode(next);
      const label = next === 'voice' ? '🎤 Dublagem ativa' : '💬 Só legendas';
      trayManager.showNotification(APP_NAME, label);
    } else {
      startPipeline();
    }
  });

  // Atalho para mostrar/esconder overlay
  globalShortcut.register(config.overlayHotkey, () => {
    if (overlay.isVisible()) {
      overlay.hide();
    } else {
      overlay.show();
    }
  });
}

/**
 * Remove todos os atalhos globais registrados.
 */
function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}

// ============================================================
// Handlers do menu da bandeja
// ============================================================

/**
 * Abre a janela de configurações.
 */
function openSettings(): void {
  // Por enquanto, apenas mostra a janela principal
  // Em versões futuras, abrirá uma janela de configurações dedicada
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    const mainWin = windows[0];
    mainWin.show();
    mainWin.focus();
  }
}

// ============================================================
// Handlers de eventos do Electron
// ============================================================

/**
 * Inicializa todos os módulos do aplicativo.
 */
function initializeModules(): void {
  // Carrega configuração
  config = loadConfig();

  // Cria módulos
  audioCapture = new AudioCapture();
  micCapture = new MicCapture();
  whisperManager = new WhisperManager();
  translator = new Translator(config.deepKey);
  voiceManager = new VoiceManager('cli');
  audioOutput = new AudioOutput(config.vbcableDevice);

  // Cria overlay
  overlay = new Overlay();

  // Cria gerenciador de bandeja
  trayManager = new TrayManager();
}

/**
 * Configura os event listeners para os módulos.
 */
function setupModuleListeners(): void {
  // AudioCapture -> Whisper
  audioCapture.on('data', (chunk: Buffer) => {
    processAudioChunk(chunk);
  });

  audioCapture.on('error', (error: Error) => {
    appLog(`Audio capture error: ${error.message}`);
    if (isPipelineActive) {
      stopPipeline();
      trayManager.showNotification(APP_NAME, `Erro na captura: ${error.message}`);
    }
  });

  audioCapture.on('exit', (code, signal) => {
    appLog(`Audio capture exited (code: ${code}, signal: ${signal})`);
    if (isPipelineActive) {
      stopPipeline();
    }
  });

  // MicCapture -> Pipeline B
  micCapture.on('data', (chunk: Buffer) => {
    processMicAudioChunk(chunk);
  });

  micCapture.on('error', (error: Error) => {
    appLog(`Mic capture error: ${error.message}`);
  });

  micCapture.on('exit', (code, signal) => {
    appLog(`Mic capture exited (code: ${code}, signal: ${signal})`);
  });

  // WhisperManager eventos
  whisperManager.on('model-loaded', (modelSize: string) => {
    appLog(`Whisper model '${modelSize}' loaded`);
    trayManager.showNotification(APP_NAME, `Modelo Whisper '${modelSize}' carregado`);
  });

  whisperManager.on('error', (error: Error) => {
    appLog(`Whisper error: ${error.message}`);
  });

  // Translator eventos
  translator.on('error', (error: Error) => {
    appLog(`Translation error: ${error.message}`);
  });

  // VoiceManager eventos
  voiceManager.on('started', (text: string) => {
    appLog(`TTS started: "${text.slice(0, 40)}..."`);
  });

  voiceManager.on('finished', () => {
    appLog('TTS finished');
  });

  voiceManager.on('error', (error: Error) => {
    appLog(`TTS error: ${error.message}`);
  });

  // VoiceManager -> AudioOutput (pipe de áudio WAV para VB-Cable)
  voiceManager.on('audio', (buffer: Buffer) => {
    if (config.toggleVoice && audioOutput.isActive) {
      audioOutput.play(buffer).catch((err: Error) => {
        appLog(`Audio output play error: ${err.message}`);
      });
    }
  });

  // AudioOutput eventos
  audioOutput.on('error', (error: Error) => {
    appLog(`Audio output error: ${error.message}`);
  });
}

// ============================================================
// Inicialização do Electron
// ============================================================

/**
 * Inicializa o aplicativo Electron.
 */
async function main(): Promise<void> {
  // Previne múltiplas instâncias
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  // Segunda instância tenta ativar a primeira
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const win = windows[0];
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // Inicializa módulos antes do app estar pronto
  initializeModules();

  // Aguarda o app ficar pronto
  await app.whenReady();

  // Inicializa arquivo de log (precisa do app ready)
  await initLogFile();

  appLog(`Starting ${APP_NAME} v${APP_VERSION}`);

  // Cria overlay
  await overlay.create(config.overlayOpacity);

  // Configura IPC
  setupIPC();

  // Inicializa bandeja
  trayManager.init(
    BrowserWindow.getAllWindows()[0],
    config.appMode,
    {
      onSetMode: (mode) => {
        config.appMode = mode;
        saveConfig({ appMode: mode });
        restartPipeline();
      },
      onSettings: openSettings,
      onQuit: () => {
        isQuitting = true;
        app.quit();
      },
    },
  );

  // Registra atalhos globais
  registerGlobalShortcuts();

  // Configura listeners dos módulos
  setupModuleListeners();

  // Inicia o pipeline automaticamente
  startPipeline();

  appLog(`${APP_NAME} v${APP_VERSION} initialized successfully`);
  trayManager.showNotification(APP_NAME, 'Mimico iniciado. Use Alt+Shift+M para ligar/desligar.');
}

// ============================================================
// Eventos do ciclo de vida do Electron
// ============================================================

// app.whenReady já tratado no main()

/**
 * Quando todas as janelas são fechadas, não encerra o app
 * (ele continua rodando na bandeja).
 */
app.on('window-all-closed', () => {
  // No Windows, não encerra - continua na bandeja
  // Apenas esconde todas as janelas
  BrowserWindow.getAllWindows().forEach((win) => win.hide());
});

/**
 * Ativa o app (macOS specific, mas tratado genericamente).
 */
app.on('activate', () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    overlay.create(config.overlayOpacity).catch(console.error);
  } else {
    windows[0].show();
  }
});

/**
 * Antes de encerrar, limpa recursos.
 */
app.on('before-quit', () => {
  if (isQuitting) {
    cleanup();
  }
});

/**
 * Encerramento do app.
 */
app.on('will-quit', () => {
  unregisterGlobalShortcuts();
  cleanup();
});

// ============================================================
// Cleanup
// ============================================================

/**
 * Libera todos os recursos do aplicativo de forma ordenada.
 */
function cleanup(): void {
  appLog('Cleaning up resources...');

  stopPipeline();

  trayManager?.destroy();
  overlay?.dispose();
  audioCapture?.dispose();
  micCapture?.dispose();
  whisperManager?.dispose();
  translator?.dispose();
  voiceManager?.dispose();
  audioOutput?.dispose();

  appLog('Cleanup complete');
}

// ============================================================
// Ponto de entrada
// ============================================================

main().catch((error) => {
  appLog(`Fatal initialization error: ${error}`);
  app.quit();
});
