/**
 * VoiceManager — Gerencia síntese de voz (Edge TTS, OpenVoice, API).
 * Produz áudio para ser injetado no VB-Cable quando toggle ativo.
 */

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { BrowserWindow } from 'electron';

interface SynthesizedAudio {
  audio: string; // base64
  sampleRate: number;
  format: string;
  latencyMs: number;
  backend: string;
}

interface VoiceMessage {
  event: string;
  audio?: string;
  sample_rate?: number;
  format?: string;
  latency_ms?: number;
  backend?: string;
  voice?: string;
  voices?: Array<{ name: string; locale: string; gender: string }>;
  message?: string;
  [key: string]: unknown;
}

type SynthesizeCallback = (audio: SynthesizedAudio) => void;

export class VoiceManager {
  private process: import('child_process').ChildProcess | null = null;
  private mainWindow: BrowserWindow | null = null;
  private onSynthesized: SynthesizeCallback | null = null;
  private pendingRequests: Map<string, (msg: VoiceMessage) => void> = new Map();
  private requestCounter = 0;
  private currentBackend = 'edge-tts';
  private currentVoice = 'en-US-JennyNeural';

  setWindow(window: BrowserWindow): void { this.mainWindow = window; }
  onSynthesis(callback: SynthesizeCallback): void { this.onSynthesized = callback; }

  getBackend(): string { return this.currentBackend; }
  getVoice(): string { return this.currentVoice; }

  async start(): Promise<boolean> {
    if (this.process) { return true; }
    return this.spawnWorker();
  }

  private spawnWorker(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const workerPath = this.resolveWorkerPath();
        const pythonCmd = this.resolvePython();

        this.process = spawn(pythonCmd, [workerPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        this.setupStdout();
        this.setupStderr();
        this.setupExit();
        this.waitForReady(resolve);
      } catch (error) {
        console.error('Failed to start voice worker:', error);
        resolve(false);
      }
    });
  }

  private setupStdout(): void {
    let buffer = '';
    this.process!.stdout!.on('data', (data: Buffer) => {
      buffer += data.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) { continue; }
        try {
          this.handleMessage(JSON.parse(line) as VoiceMessage);
        } catch {
          console.warn('Invalid JSON from voice worker:', line);
        }
      }
    });
  }

  private setupStderr(): void {
    this.process!.stderr!.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) { console.error('[voice]', text); }
    });
  }

  private setupExit(): void {
    this.process!.on('exit', (code) => {
      console.log(`Voice worker exited (${code})`);
      this.process = null;
    });
  }

  private waitForReady(resolve: (v: boolean) => void): void {
    const timeout = setTimeout(() => resolve(false), 10000);
    const originalHandler = this.handleMessage.bind(this);
    this.handleMessage = (message: VoiceMessage) => {
      if (message.event === 'ready') {
        clearTimeout(timeout);
        resolve(true);
      }
      originalHandler(message);
    };
  }

  stop(): void {
    if (!this.process) { return; }
    this.sendCommand({ cmd: 'shutdown' });
    setTimeout(() => {
      if (this.process) { this.process.kill(); this.process = null; }
    }, 2000);
  }

  // --- API ---

  synthesize(text: string, language = 'EN'): void {
    if (!this.process) {
      console.warn('Voice worker not running');
      return;
    }
    if (!text.trim()) { return; }

    const requestId = `synth_${++this.requestCounter}`;

    this.pendingRequests.set(requestId, (message) => {
      if (message.event === 'synthesized' && message.audio) {
        const result: SynthesizedAudio = {
          audio: message.audio,
          sampleRate: message.sample_rate || 24000,
          format: message.format || 'mp3',
          latencyMs: message.latency_ms || 0,
          backend: message.backend || this.currentBackend,
        };
        if (this.onSynthesized) { this.onSynthesized(result); }
        this.sendToWindow('voice-audio', result);
      }
    });

    this.sendCommand({
      cmd: 'synthesize',
      request_id: requestId,
      text,
      voice: this.currentVoice,
      language,
    });
  }

  setVoice(voice: string): void {
    this.currentVoice = voice;
    this.sendCommand({ cmd: 'set_voice', voice });
    this.config.save({ ttsVoice: voice });
  }

  listVoices(): void {
    this.sendCommand({ cmd: 'list_voices' });
  }

  private handleMessage(message: VoiceMessage): void {
    if (message.event === 'synthesized') {
      this.resolvePending(message);
    } else if (message.event === 'voice_list' && message.voices) {
      this.sendToWindow('voice-list', {
        voices: message.voices,
        backend: message.backend,
      });
    } else if (message.event === 'error') {
      console.error('[voice]', message.message);
    } else if (message.event === 'backend_set') {
      this.currentBackend = message.backend as string;
    }
  }

  private resolvePending(message: VoiceMessage): void {
    const requestId = message.request_id as string;
    if (requestId) {
      const resolver = this.pendingRequests.get(requestId);
      if (resolver) {
        resolver(message);
        this.pendingRequests.delete(requestId);
      }
    }
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

  private config = {
    save: (_config: Record<string, unknown>) => {
      try {
        const configPath = path.join(
          process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
          'Mimico', 'config.json'
        );
        if (fs.existsSync(configPath)) {
          const current = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          fs.writeFileSync(configPath, JSON.stringify({ ...current, ..._config }, null, 2));
        }
      } catch {
        // Silently ignore config save errors (non-critical)
      }
    },
  };

  private resolvePython(): string {
    const found = ['python', 'python3', 'py'].find((cmd) => {
      try { return execSync(`${cmd} --version`, { encoding: 'utf-8' }).includes('Python'); }
      catch { return false; }
    });
    return found || 'python';
  }

  private resolveWorkerPath(): string {
    const found = [
      path.join(__dirname, '../../workers/voice_worker.py'),
      path.join(process.cwd(), 'workers', 'voice_worker.py'),
    ].find((filePath) => fs.existsSync(filePath));
    return found || path.join(__dirname, '../../workers/voice_worker.py');
  }
}
