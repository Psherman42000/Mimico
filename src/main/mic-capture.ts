/**
 * mic-capture.ts — Captura de áudio do microfone via worker Python
 *
 * Gerencia o processo filho Python (workers/audio_mic_capture.py) que captura
 * o áudio do microfone usando WASAPI input, com VAD por threshold.
 *
 * Comunicação via stdin/stdout JSON:
 * - Envio: { command: 'start' } | { command: 'stop' } | { command: 'exit' }
 * - Recebimento: { type: 'ready' } | { type: 'audio', data: <base64>, sample_rate, channels, dtype, rms }
 *                | { type: 'status', status } | { type: 'error', message }
 *
 * Eventos emitidos:
 * - 'data': Buffer PCM chunk (float32 mono 16000Hz)
 * - 'error', 'exit'
 */
import { WorkerProcess } from './worker-process';

interface MicMessage {
  type: 'ready' | 'audio' | 'status' | 'error';
  data?: string;
  status?: string;
  message?: string;
}

export class MicCapture extends WorkerProcess {
  protected get workerName(): string { return 'mic-capture'; }
  protected get scriptName(): string { return 'audio_mic_capture.py'; }

  async start(config: Record<string, unknown> = {}): Promise<void> {
    await super.start();
    this.log('Worker ready, sending start command');
    this.sendCommand('start');
  }

  protected handleMessage(raw: Record<string, unknown>): void {
    const msg = raw as unknown as MicMessage;
    this.log(`Received: type=${msg.type}${msg.status ? ` status=${msg.status}` : ''}`);

    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.log(`Worker ready`);
        this.emit('ready');
        break;

      case 'audio':
        if (msg.data) {
          this.emit('data', Buffer.from(msg.data, 'base64'));
        } else {
          this.log('Audio message missing data field');
        }
        break;

      case 'status':
        if (msg.status === 'started') this.emit('started');
        else if (msg.status === 'stopped') this.emit('stopped');
        break;

      case 'error':
        this.log(`Worker error: ${msg.message ?? 'unknown'}`);
        this.emit('error', new Error(`Mic capture worker: ${msg.message ?? 'unknown error'}`));
        break;
    }
  }

  async restart(config?: Record<string, unknown>): Promise<void> {
    this.stop();
    await this.start(config);
  }
}

export default MicCapture;
