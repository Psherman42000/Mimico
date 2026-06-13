/**
 * whisper-manager.ts — Gerenciamento do worker Faster-Whisper
 *
 * Gerencia o processo filho Python (workers/whisper_worker.py) que executa
 * o Faster-Whisper para transcrição de áudio em tempo real.
 *
 * Comunicação via stdin/stdout JSON:
 * - Envio: { action: 'transcribe', audio: <base64>, id } | { action: 'load', model }
 * - Recebimento: { type: 'transcription', text, timestamp }
 *                | { type: 'model-loaded', model }
 *                | { type: 'error', message }
 *
 * Eventos emitidos:
 * - 'transcription': (text, timestamp)
 * - 'model-loaded': (modelSize)
 * - 'error'
 */
import { WorkerProcess } from './worker-process';
import { resolve } from 'path';

const MODEL_LOAD_TIMEOUT = 120_000;
const TRANSCRIPTION_TIMEOUT = 30_000;

export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large';

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface WhisperMessage {
  type: 'transcription' | 'error' | 'model-loaded' | 'ready';
  text?: string;
  message?: string;
  model?: string;
  timestamp?: number;
}

export class WhisperManager extends WorkerProcess {
  protected get workerName(): string { return 'whisper'; }
  protected get scriptName(): string { return 'whisper_worker.py'; }
  protected get scriptArgs(): string[] {
    return ['--model', this.currentModel];
  }
  protected readyTimeout = MODEL_LOAD_TIMEOUT;

  private currentModel: WhisperModelSize = 'tiny';
  private pendingRequests: PendingRequest[] = [];
  private requestId = 0;

  async start(modelSize: WhisperModelSize = 'tiny'): Promise<void> {
    this.currentModel = modelSize;
    await super.start();
  }

  protected handleMessage(raw: Record<string, unknown>): void {
    const msg = raw as unknown as WhisperMessage;

    switch (msg.type) {
      case 'ready':
      case 'model-loaded':
        this.ready = true;
        this.emit('model-loaded', msg.model ?? this.currentModel);
        break;

      case 'transcription':
        this.emit('transcription', msg.text ?? '', msg.timestamp ?? Date.now());
        this.resolveNext(msg.text ?? '');
        break;

      case 'error':
        this.emit('error', new Error(msg.message ?? 'Unknown whisper error'));
        this.rejectNext(new Error(msg.message ?? 'Unknown whisper error'));
        break;
    }
  }

  /** Envia chunk de áudio para transcrição */
  transcribe(audioChunk: Buffer, language?: string): Promise<string> {
    if (!this.ready || !this.process?.stdin) {
      return Promise.reject(new Error('Whisper worker is not ready'));
    }

    const id = ++this.requestId;
    const audioBase64 = audioChunk.toString('base64');

    const payload: Record<string, unknown> = {
      action: 'transcribe',
      audio: audioBase64,
      id,
    };
    if (language) payload.language = language;

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectNext(new Error(`Transcription timeout (${TRANSCRIPTION_TIMEOUT}ms)`));
      }, TRANSCRIPTION_TIMEOUT);

      this.pendingRequests.push({ resolve, reject, timer });
      this.process!.stdin!.write(JSON.stringify(payload) + '\n');
    });
  }

  private resolveNext(text: string): void {
    const req = this.pendingRequests.shift();
    if (req) { clearTimeout(req.timer); req.resolve(text); }
  }

  private rejectNext(error: Error): void {
    const req = this.pendingRequests.shift();
    if (req) { clearTimeout(req.timer); req.reject(error); }
  }

  stop(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process) this.process.kill('SIGKILL');
      }, 5000);
    }
    this.ready = false;
    this.readline?.close();
    this.readline = null;
    this.process = null;
    this.rejectAll(new Error('Whisper worker stopped'));
  }

  private rejectAll(error: Error): void {
    for (const req of this.pendingRequests) { clearTimeout(req.timer); req.reject(error); }
    this.pendingRequests = [];
  }

  get modelSize(): WhisperModelSize { return this.currentModel; }
}

export default WhisperManager;
