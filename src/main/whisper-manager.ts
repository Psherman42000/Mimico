/**
 * WhisperManager — Gerencia o processo Python Faster-Whisper.
 * Recebe chunks de áudio do AudioCapture, envia para transcrição,
 * e retorna texto transcrito para o renderer.
 */

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserWindow } from 'electron';

interface TranscriptionResult {
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  language: string;
  languageProbability: number;
  latencyMs: number;
}

interface WhisperMessage {
  event: string;
  text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  language?: string;
  language_probability?: number;
  latency_ms?: number;
  message?: string;
  size?: string;
  device?: string;
  compute_type?: string;
  load_time_ms?: number;
  capabilities?: { gpu: boolean; model: string };
  request_id?: string;
  name?: string;
  vram_gb?: number;
  [key: string]: unknown;
}

type MessageHandler = (msg: WhisperMessage) => void;
type StatusCallback = (status: string) => void;

export class WhisperManager {
  private process: import('child_process').ChildProcess | null = null;
  private mainWindow: BrowserWindow | null = null;
  private onTranscribe: ((result: TranscriptionResult) => void) | null = null;
  private onStatus: StatusCallback | null = null;
  private modelLoaded = false;
  private currentModel: string;
  private currentLanguage: string;
  private pendingTranscriptions: Map<string, (result: TranscriptionResult) => void> = new Map();
  private requestCounter = 0;

  constructor(modelSize = 'tiny', language = 'en') {
    this.currentModel = modelSize;
    this.currentLanguage = language;
  }

  setWindow(window: BrowserWindow): void { this.mainWindow = window; }
  onTranscription(callback: (result: TranscriptionResult) => void): void { this.onTranscribe = callback; }
  onStatusChange(callback: StatusCallback): void { this.onStatus = callback; }

  // --- Lifecycle ---

  async start(): Promise<boolean> {
    if (this.process) {
      return true;
    }
    return this.spawnWorker();
  }

  private spawnWorker(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.doStart(resolve);
      } catch (error) {
        console.error('Failed to start Whisper:', error);
        resolve(false);
      }
    });
  }

  private doStart(resolve: (v: boolean) => void): void {
    const workerPath = this.resolveWorkerPath();
    const pythonCmd = this.resolvePython();

    this.process = spawn(pythonCmd, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.setupStdoutParser();
    this.setupStderr();
    this.setupExitHandler();
    this.waitForReady(resolve);
  }

  private setupStdoutParser(): void {
    let buffer = '';
    this.process!.stdout!.on('data', (data: Buffer) => {
      buffer += data.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) { continue; }
        this.tryParseMessage(line);
      }
    });
  }

  private tryParseMessage(line: string): void {
    try {
      this.handleMessage(JSON.parse(line) as WhisperMessage);
    } catch {
      console.warn('Invalid JSON from whisper worker:', line);
    }
  }

  private setupStderr(): void {
    this.process!.stderr!.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) { console.error('[whisper]', text); }
    });
  }

  private setupExitHandler(): void {
    this.process!.on('exit', (code) => {
      console.log(`Whisper worker exited (${code})`);
      this.process = null;
      this.modelLoaded = false;
    });
  }

  private waitForReady(resolve: (v: boolean) => void): void {
    const timeout = setTimeout(() => resolve(false), 30000);
    const originalHandler = this.handleMessage.bind(this);
    this.handleMessage = (message: WhisperMessage) => {
      if (message.event === 'ready') {
        clearTimeout(timeout);
        this.sendCommand({ cmd: 'load_model', size: this.currentModel });
        resolve(true);
      } else if (message.event === 'model_loaded') {
        this.modelLoaded = true;
        if (this.onStatus) {
          this.onStatus(`model:${message.size}@${message.device}`);
        }
      }
      originalHandler(message);
    };
  }

  stop(): void {
    if (!this.process) { return; }
    this.sendCommand({ cmd: 'shutdown' });
    setTimeout(() => this.forceKill(), 2000);
  }

  private forceKill(): void {
    if (!this.process) { return; }
    this.process.kill();
    this.process = null;
    this.modelLoaded = false;
  }

  isReady(): boolean { return this.modelLoaded; }

  // --- Transcription ---

  transcribeChunk(dataB64: string, sampleRate = 16000): void {
    if (!this.process || !this.modelLoaded) {
      console.warn('Whisper not ready, dropping chunk');
      return;
    }

    const requestId = `tr_${++this.requestCounter}`;

    this.pendingTranscriptions.set(requestId, (result) => {
      if (this.onTranscribe) { this.onTranscribe(result); }
      this.sendToWindow('transcription', {
        text: result.text,
        language: result.language,
        latencyMs: result.latencyMs,
      });
    });

    this.sendCommand({
      cmd: 'transcribe',
      request_id: requestId,
      data: dataB64,
      sample_rate: sampleRate,
      language: this.currentLanguage,
    });

    setTimeout(() => { this.pendingTranscriptions.delete(requestId); }, 30000);
  }

  setLanguage(language: string): void {
    this.currentLanguage = language;
    this.sendCommand({ cmd: 'set_language', language });
  }

  setModel(size: string): void {
    this.currentModel = size;
    this.modelLoaded = false;
    this.sendCommand({ cmd: 'set_model', size });
  }

  // --- Message handling ---

  private handleMessage(message: WhisperMessage): void {
    const handler = this.routeMessage(message.event);
    if (handler) { handler(message); }
  }

  private routeMessage(event: string): MessageHandler | null {
    const routes: Record<string, MessageHandler> = {
      transcription: (msg) => this.handleTranscriptionResult(msg),
      gpu_info: (msg) => console.log('[whisper] GPU:', msg.name, `(${msg.vram_gb}GB)`),
      error: (msg) => console.error('[whisper]', msg.message),
    };
    return routes[event] ?? null;
  }

  private handleTranscriptionResult(message: WhisperMessage): void {
    const requestId = message.request_id || '';
    const callback = requestId ? this.pendingTranscriptions.get(requestId) : null;

    const result: TranscriptionResult = {
      text: (message.text || '').trim(),
      segments: message.segments || [],
      language: message.language || 'en',
      languageProbability: message.language_probability || 0,
      latencyMs: message.latency_ms || 0,
    };

    if (callback) {
      callback(result);
      this.pendingTranscriptions.delete(requestId);
    } else if (this.onTranscribe) {
      this.onTranscribe(result);
    }

    this.sendToWindow('transcription-result', result);
  }

  private sendCommand(command: object): void {
    if (this.process?.stdin) {
      this.process.stdin.write(`${JSON.stringify(command)}\n`);
    }
  }

  private sendToWindow(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  // --- Utilities ---

  private resolvePython(): string {
    const found = ['python', 'python3', 'py'].find((command) => {
      try {
        return execSync(`${command} --version`, { encoding: 'utf-8' }).includes('Python');
      } catch { return false; }
    });
    return found || 'python';
  }

  private resolveWorkerPath(): string {
    const found = [
      path.join(__dirname, '../../workers/whisper_worker.py'),
      path.join(process.cwd(), 'workers', 'whisper_worker.py'),
    ].find((filePath) => fs.existsSync(filePath));
    return found || path.join(__dirname, '../../workers/whisper_worker.py');
  }
}
