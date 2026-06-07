/**
 * AudioOutputManager — Gerencia reprodução de áudio no VB-Cable.
 * Recebe áudio sintetizado do VoiceManager e toca no dispositivo de saída.
 */

import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserWindow } from 'electron';

interface AudioOutputMessage {
  event: string;
  device?: string;
  devices?: Array<{ index: number; name: string; channels: number; sample_rate: number }>;
  recommended?: string;
  vb_cable_installed?: boolean;
  status?: string;
  latency_ms?: number;
  volume?: number;
  message?: string;
  [key: string]: unknown;
}

export class AudioOutputManager {
  private process: import('child_process').ChildProcess | null = null;
  private mainWindow: BrowserWindow | null = null;
  private vbCableInstalled = false;
  private currentDevice = 'default';

  setWindow(window: BrowserWindow): void { this.mainWindow = window; }

  isVBCableInstalled(): boolean { return this.vbCableInstalled; }

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
        console.error('Failed to start audio output:', error);
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
          this.handleMessage(JSON.parse(line) as AudioOutputMessage);
        } catch {
          console.warn('Invalid JSON from audio output worker:', line);
        }
      }
    });
  }

  private setupStderr(): void {
    this.process!.stderr!.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) { console.error('[audio-output]', text); }
    });
  }

  private setupExit(): void {
    this.process!.on('exit', (code) => {
      console.log(`Audio output worker exited (${code})`);
      this.process = null;
    });
  }

  private waitForReady(resolve: (v: boolean) => void): void {
    const timeout = setTimeout(() => resolve(false), 10000);
    const originalHandler = this.handleMessage.bind(this);
    this.handleMessage = (message: AudioOutputMessage) => {
      if (message.event === 'ready') {
        clearTimeout(timeout);
        this.vbCableInstalled = message.vb_cable_installed === true;
        this.currentDevice = (message.device as string) || 'default';
        this.sendToWindow('vb-cable-status', {
          installed: this.vbCableInstalled,
          device: this.currentDevice,
        });
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

  play(audioB64: string, format = 'mp3'): void {
    if (!this.process) {
      console.warn('Audio output not running');
      return;
    }
    this.sendCommand({
      cmd: 'play',
      audio: audioB64,
      format,
    });
  }

  stopPlayback(): void {
    this.sendCommand({ cmd: 'stop' });
  }

  listDevices(): void {
    this.sendCommand({ cmd: 'list_devices' });
  }

  setVolume(volume: number): void {
    this.sendCommand({ cmd: 'set_volume', volume });
  }

  setDevice(deviceIndex: number): void {
    this.sendCommand({ cmd: 'set_device', device: deviceIndex });
  }

  private handleMessage(message: AudioOutputMessage): void {
    switch (message.event) {
      case 'ready':
        break; // handled in waitForReady
      case 'playing':
        this.sendToWindow('audio-playback', {
          status: message.status,
          latencyMs: message.latency_ms,
        });
        break;
      case 'device_list':
        this.sendToWindow('audio-devices', {
          devices: message.devices,
          recommended: message.recommended,
        });
        break;
      case 'volume_set':
        this.sendToWindow('audio-volume', { volume: message.volume });
        break;
      case 'device_set':
        this.currentDevice = message.device as string;
        break;
      case 'error':
        console.error('[audio-output]', message.message);
        break;
      case 'warning':
        console.warn('[audio-output]', message.message);
        break;
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

  private resolvePython(): string {
    const found = ['python', 'python3', 'py'].find((cmd) => {
      try { return execSync(`${cmd} --version`, { encoding: 'utf-8' }).includes('Python'); }
      catch { return false; }
    });
    return found || 'python';
  }

  private resolveWorkerPath(): string {
    const found = [
      path.join(__dirname, '../../workers/audio_output.py'),
      path.join(process.cwd(), 'workers', 'audio_output.py'),
    ].find((filePath) => fs.existsSync(filePath));
    return found || path.join(__dirname, '../../workers/audio_output.py');
  }
}
