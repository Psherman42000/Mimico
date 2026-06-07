/**
 * AudioCaptureManager — Gerencia o processo Python de captura WASAPI.
 * Comunicação via stdin/stdout com o worker audio_capture.py
 */

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserWindow } from 'electron';

interface AudioChunk {
  data: string;
  sampleRate: number;
  duration: number;
}

interface AudioDevice {
  index: number;
  name: string;
  channels: number;
  sampleRate: number;
  isLoopback: boolean;
}

interface WorkerMessage {
  event: string;
  data?: string;
  sample_rate?: number;
  duration?: number;
  devices?: AudioDevice[];
  message?: string;
  active?: boolean;
  state?: string;
  [key: string]: unknown;
}

type MessageHandler = (msg: WorkerMessage) => void;

export class AudioCaptureManager {
  private process: import('child_process').ChildProcess | null = null;
  private onChunkCallback: ((chunk: AudioChunk) => void) | null = null;
  private mainWindow: BrowserWindow | null = null;
  private pendingRequests: Map<string, MessageHandler> = new Map();
  private requestIdCounter = 0;

  setWindow(window: BrowserWindow): void { this.mainWindow = window; }

  // --- Process lifecycle ---

  async start(device?: number): Promise<boolean> {
    if (this.process) { return false; }
    return new Promise((resolve) => {
      try {
        this.doStart(resolve, device);
      } catch (error) {
        console.error('Failed to start capture:', error);
        resolve(false);
      }
    });
  }

  private doStart(resolve: (v: boolean) => void, device?: number): void {
    this.spawnWorker();
    this.setupStdoutParser();
    this.setupStderr();
    this.setupExitHandler();
    this.setupErrorHandler(resolve);
    this.waitForReady(resolve, device);
  }

  private spawnWorker(): void {
    this.process = spawn(this.resolvePython(), [this.resolveWorkerPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }

  private setupStdoutParser(): void {
    let buffer = '';
    this.process!.stdout!.on('data', (data: Buffer) => {
      buffer += data.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) { continue; }
        this.tryParseJson(line);
      }
    });
  }

  private tryParseJson(line: string): void {
    try {
      this.handleMessage(JSON.parse(line) as WorkerMessage);
    } catch {
      console.warn('Invalid JSON from worker:', line);
    }
  }

  private setupStderr(): void {
    this.process!.stderr!.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) { console.error('[capture]', text); }
    });
  }

  private setupExitHandler(): void {
    this.process!.on('exit', (code) => {
      console.log(`Capture worker exited (${code})`);
      this.process = null;
    });
  }

  private setupErrorHandler(resolve: (v: boolean) => void): void {
    this.process!.on('error', (error) => {
      console.error('Worker error:', error);
      this.process = null;
      resolve(false);
    });
  }

  private waitForReady(resolve: (v: boolean) => void, device?: number): void {
    const timeout = setTimeout(() => resolve(false), 5000);
    const originalHandler = this.handleMessage.bind(this);
    this.handleMessage = (message: WorkerMessage) => {
      if (message.event === 'ready') {
        clearTimeout(timeout);
        this.sendCommand({ cmd: 'start', device });
        resolve(true);
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
  }

  isRunning(): boolean { return this.process !== null; }

  // --- API ---

  listDevices(): Promise<AudioDevice[]> {
    return this.sendRequest('list_devices_', { cmd: 'list_devices' }).then(
      (data) => (data?.devices as AudioDevice[]) || [],
    );
  }

  getBuffer(duration = 5.0): Promise<AudioChunk | null> {
    return this.sendRequest('get_buffer_', { cmd: 'get_buffer', duration }).then(
      (data) => {
        if (!data) { return null; }
        return { data: data.data as string, sampleRate: data.sample_rate as number, duration: data.duration as number };
      },
    );
  }

  private sendRequest(prefix: string, command: object): Promise<WorkerMessage | null> {
    return new Promise((resolve) => {
      const requestId = `${prefix}${++this.requestIdCounter}`;
      this.pendingRequests.set(requestId, resolve);
      this.sendCommand({ ...command, request_id: requestId });
      setTimeout(() => { this.pendingRequests.delete(requestId); resolve(null); }, 3000);
    });
  }

  onChunk(callback: (chunk: AudioChunk) => void): void { this.onChunkCallback = callback; }

  private sendCommand(command: object): void {
    if (this.process?.stdin) {
      this.process.stdin.write(`${JSON.stringify(command)}\n`);
    }
  }

  // --- Message routing ---

  private handleMessage(message: WorkerMessage): void {
    const handler = this.routeMessage(message.event);
    if (handler) { handler(message); }
  }

  private routeMessage(event: string): MessageHandler | null {
    const routes: Record<string, MessageHandler> = {
      audio_chunk:  (msg) => this.handleAudioChunk(msg),
      device_list:  (msg) => this.resolveRequest(msg, 'list_devices_'),
      buffer_data:  (msg) => this.resolveRequest(msg, 'get_buffer_'),
      vad_active:   (msg) => this.sendToWindow('vad-status', msg.active),
      status:       (msg) => this.sendToWindow('capture-status', msg.state),
      error:        (msg) => console.error('[capture]', msg.message),
      warning:      (msg) => console.warn('[capture]', msg.message),
    };
    return routes[event] ?? null;
  }

  private handleAudioChunk(message: WorkerMessage): void {
    if (this.onChunkCallback) {
      this.onChunkCallback({
        data: message.data as string,
        sampleRate: message.sample_rate as number,
        duration: message.duration as number,
      });
    }
    this.sendToWindow('audio-level', { level: 0.5 });
  }

  private resolveRequest(message: WorkerMessage, prefix: string): void {
    this.pendingRequests.forEach((resolver, key) => {
      if (key.startsWith(prefix)) {
        resolver(message);
        this.pendingRequests.delete(key);
      }
    });
  }

  private sendToWindow(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  // --- Utilities ---

  private resolvePython(): string {
    const found = ['python', 'python3', 'py'].find((command) => {
      try { return execSync(`${command} --version`, { encoding: 'utf-8' }).includes('Python'); }
      catch { return false; }
    });
    return found || 'python';
  }

  private resolveWorkerPath(): string {
    const found = [
      path.join(__dirname, '../../workers/audio_capture.py'),
      path.join(process.cwd(), 'workers', 'audio_capture.py'),
    ].find((filePath) => fs.existsSync(filePath));
    return found || path.join(__dirname, '../../workers/audio_capture.py');
  }
}
