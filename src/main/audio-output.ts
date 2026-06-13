/**
 * audio-output.ts — Saída de áudio no VB-Cable via worker Python
 *
 * Gerencia o processo filho Python (workers/audio_output.py) que reproduz
 * áudio WAV no dispositivo VB-Cable.
 *
 * Comunicação via stdin/stdout JSON:
 * - Envio: { command: 'play', path } | { command: 'stop' } | { command: 'exit' }
 * - Recebimento: { type: 'ready' } | { type: 'status', status, file }
 *                | { type: 'error', message }
 *
 * Eventos emitidos:
 * - 'ready', 'status', 'playing', 'finished', 'error', 'exit'
 */
import { WorkerProcess } from './worker-process';
import { resolve, join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';

interface OutputMessage {
  type: 'ready' | 'status' | 'devices' | 'error';
  status?: string;
  file?: string;
  message?: string;
  devices?: Array<Record<string, unknown>>;
}

export class AudioOutput extends WorkerProcess {
  protected get workerName(): string { return 'audio-output'; }
  protected get scriptName(): string { return 'audio_output.py'; }

  async start(): Promise<void> {
    await super.start();
    this.sendJson({ command: 'list_devices' });
  }

  protected handleMessage(raw: Record<string, unknown>): void {
    const msg = raw as unknown as OutputMessage;

    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.log('Worker ready');
        this.emit('ready');
        break;

      case 'status':
        this.handleStatus(msg);
        break;

      case 'devices':
        this.log(`Device list: ${msg.devices?.length ?? 0} devices`);
        break;

      case 'error':
        this.log(`Worker error: ${msg.message}`);
        this.emit('error', new Error(msg.message ?? 'Unknown audio output error'));
        break;
    }
  }

  private handleStatus(msg: OutputMessage): void {
    const status = msg.status ?? 'unknown';
    this.log(`Status: ${status}${msg.file ? ` (${msg.file})` : ''}`);

    switch (status) {
      case 'playing':
        this.emit('playing', msg.file ?? '');
        break;
      case 'finished':
        this.emit('finished', msg.file ?? '');
        break;
      case 'stopped':
        break;
    }
    this.emit('status', status, { file: msg.file });
  }

  /** Reproduz um áudio WAV (caminho ou Buffer) no VB-Cable */
  async play(input: string | Buffer): Promise<void> {
    if (!this.running) {
      throw new Error('Audio output worker is not active');
    }
    if (!this.ready) {
      throw new Error('Audio output worker is not ready');
    }

    const wavPath = typeof input === 'string'
      ? input
      : await this.writeTempFile(input);

    this.log(`Play command: ${wavPath}`);
    this.sendJson({ command: 'play', path: wavPath });
  }

  private async writeTempFile(buffer: Buffer): Promise<string> {
    const tmpFile = join(tmpdir(), `mimico_out_${randomBytes(4).toString('hex')}.wav`);
    await writeFile(tmpFile, buffer);
    setTimeout(() => unlink(tmpFile).catch(() => {}), 5000);
    return tmpFile;
  }

  /** Define modo de mix (replace/overlay) */
  setMixMode(mode: 'replace' | 'overlay'): void {
    this.log(`Mix mode: ${mode}`);
    this.sendJson({ command: 'set_mix_mode', mode });
  }
}

export default AudioOutput;
