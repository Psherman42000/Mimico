/**
 * AudioCaptureManager — Gerencia o processo Python de captura WASAPI.
 * Comunicação via stdin/stdout com o worker audio_capture.py
 */

import { ChildProcess, spawn } from 'child_process';
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

type MsgHandler = (msg: any) => void;

export class AudioCaptureManager {
  private process: ChildProcess | null = null;
  private onChunkCallback: ((chunk: AudioChunk) => void) | null = null;
  private mainWindow: BrowserWindow | null = null;
  private pendingRequests: Map<string, MsgHandler> = new Map();
  private requestIdCounter = 0;

  setWindow(win: BrowserWindow): void { this.mainWindow = win; }

  // --- Controle do processo ---

  async start(device?: number): Promise<boolean> {
    if (this.process) return false;
    return new Promise((resolve) => {
      this.doStart(device, resolve);
    });
  }

  private doStart(device: number | undefined, resolve: (v: boolean) => void): void {
    try {
      this.spawnAndListen(resolve, device);
    } catch (err) {
      console.error('Failed to start:', err);
      resolve(false);
    }
  }

  private spawnAndListen(resolve: (v: boolean) => void, device?: number): void {
    this.spawnWorker();
    this.setupStdoutParser();
    this.setupStderr();
    this.setupExitHandler();
    this.setupErrorHandler(resolve);
    this.waitForReady(resolve, device);
  }

  private spawnWorker(): void {
    this.process = spawn(this.findPython(), [this.getWorkerPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }

  private setupStdoutParser(): void {
    let buf = '';
    this.process!.stdout!.on('data', (data: Buffer) => {
      buf += data.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { this.handleMessage(JSON.parse(line)); }
        catch { console.warn('Invalid JSON:', line); }
      }
    });
  }

  private setupStderr(): void {
    this.process!.stderr!.on('data', (data: Buffer) => {
      console.error(`[capture] ${data.toString().trim()}`);
    });
  }

  private setupExitHandler(): void {
    this.process!.on('exit', (code) => {
      console.log(`Capture worker exited (${code})`);
      this.process = null;
    });
  }

  private setupErrorHandler(resolve: (v: boolean) => void): void {
    this.process!.on('error', (err) => {
      console.error('Worker error:', err);
      this.process = null;
      resolve(false);
    });
  }

  private waitForReady(resolve: (v: boolean) => void, device?: number): void {
    const timeout = setTimeout(() => resolve(false), 5000);
    const onMsg = (msg: any) => {
      if (msg.event !== 'ready') return;
      clearTimeout(timeout);
      this.sendCommand({ cmd: 'start', device });
      resolve(true);
    };
    // Wrap the main handleMessage to intercept the ready event
    const orig = this.handleMessage.bind(this);
    this.handleMessage = (msg: any) => { onMsg(msg); orig(msg); };
  }

  stop(): void {
    if (!this.process) return;
    this.sendCommand({ cmd: 'shutdown' });
    setTimeout(() => this.killProcess(), 2000);
  }

  private killProcess(): void {
    if (!this.process) return;
    this.process.kill();
    this.process = null;
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  // --- API requests ---

  listDevices(): Promise<AudioDevice[]> {
    return this.requestWithTimeout('list_devices_', { cmd: 'list_devices' })
      .then((data) => data?.devices || []);
  }

  getBuffer(duration = 5.0): Promise<AudioChunk | null> {
    return this.requestWithTimeout('get_buffer_', { cmd: 'get_buffer', duration })
      .then((data) => data ? {
        data: data.data,
        sampleRate: data.sample_rate,
        duration: data.duration,
      } : null);
  }

  private requestWithTimeout(prefix: string, cmd: object): Promise<any> {
    return new Promise((resolve) => {
      const id = `${prefix}${++this.requestIdCounter}`;
      this.pendingRequests.set(id, (data: any) => resolve(data));
      this.sendCommand({ ...cmd, request_id: id });
      setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(null);
      }, 3000);
    });
  }

  onChunk(callback: (chunk: AudioChunk) => void): void {
    this.onChunkCallback = callback;
  }

  private sendCommand(cmd: object): void {
    if (this.process?.stdin) {
      this.process.stdin.write(JSON.stringify(cmd) + '\n');
    }
  }

  // --- Message routing ---

  private handleMessage(msg: any): void {
    const handler = this.getMessageHandler(msg.event);
    if (handler) handler(msg);
  }

  private getMessageHandler(event: string): MsgHandler | null {
    const handlers: Record<string, MsgHandler> = {
      'audio_chunk': (m) => this.onAudioChunk(m),
      'device_list': (m) => this.resolvePending(m, 'list_devices_'),
      'buffer_data': (m) => this.resolvePending(m, 'get_buffer_'),
      'vad_active':  (m) => this.sendToWindow('vad-status', m.active),
      'status':      (m) => this.sendToWindow('capture-status', m.state),
      'error':       (m) => console.error('[capture]', m.message),
      'warning':     (m) => console.warn('[capture]', m.message),
    };
    return handlers[event] || null;
  }

  private onAudioChunk(msg: any): void {
    if (this.onChunkCallback) {
      this.onChunkCallback({
        data: msg.data,
        sampleRate: msg.sample_rate,
        duration: msg.duration,
      });
    }
    this.sendToWindow('audio-level', { level: 0.5 });
  }

  private resolvePending(msg: any, prefix: string): void {
    this.pendingRequests.forEach((resolve, id) => {
      if (id.startsWith(prefix)) {
        resolve(msg);
        this.pendingRequests.delete(id);
      }
    });
  }

  private sendToWindow(channel: string, data: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  // --- Helpers ---

  private findPython(): string {
    const found = ['python', 'python3', 'py'].find((cmd) => {
      try {
        return require('child_process')
          .execSync(`${cmd} --version`, { encoding: 'utf-8' })
          .includes('Python');
      } catch { return false; }
    });
    return found || 'python';
  }

  private getWorkerPath(): string {
    const found = [
      path.join(__dirname, '../../workers/audio_capture.py'),
      path.join(process.cwd(), 'workers', 'audio_capture.py'),
    ].find((p) => fs.existsSync(p));
    return found || path.join(__dirname, '../../workers/audio_capture.py');
  }
}
