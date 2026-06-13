/**
 * audio-capture.ts — Captura de áudio via worker Python (loopback ou microfone)
 *
 * Classe única para ambos os pipelines:
 * - Loopback (sistema): workers/audio_capture.py
 * - Microfone: workers/audio_mic_capture.py
 *
 * Comunicação: JSON via stdin/stdout.
 * Eventos emitidos: 'data' (Buffer PCM), 'error', 'exit', 'started', 'stopped'
 */
import { WorkerProcess } from './worker-process';

interface AudioMessage {
  type: 'ready' | 'audio' | 'status' | 'error';
  data?: string;
  status?: string;
  message?: string;
}

interface AudioCaptureOptions {
  /** Rótulo para logs (ex: 'audio-capture', 'mic-capture') */
  workerName: string;
  /** Nome do script Python (ex: 'audio_capture.py') */
  scriptName: string;
  /** Prefixo nas mensagens de erro */
  errorLabel: string;
}

export class AudioCapture extends WorkerProcess {
  private errorLabel: string;

  constructor(private options: AudioCaptureOptions) {
    super();
    this.errorLabel = options.errorLabel;
  }

  protected get workerName(): string { return this.options.workerName; }
  protected get scriptName(): string { return this.options.scriptName; }

  async start(config: Record<string, unknown> = {}): Promise<void> {
    await super.start();
    this.log('Worker ready, sending start command');
    this.sendCommand('start');
  }

  protected handleMessage(raw: Record<string, unknown>): void {
    const msg = raw as unknown as AudioMessage;
    this.log(`Received: type=${msg.type}${msg.status ? ` status=${msg.status}` : ''}`);

    switch (msg.type) {
      case 'ready':
        this.ready = true;
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
        this.emit('error', new Error(`${this.errorLabel}: ${msg.message ?? 'unknown error'}`));
        break;
    }
  }
}

export default AudioCapture;
