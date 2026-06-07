/**
 * whisper-manager.ts - Gerenciamento do worker Faster-Whisper
 *
 * Gerencia o ciclo de vida do processo filho Python (workers/whisper_worker.py)
 * que executa o Faster-Whisper para transcrição de áudio em tempo real.
 *
 * A comunicação com o worker Python é feita via stdin/stdout no formato JSON:
 * - Envio (stdin): { action: 'transcribe', audio: <base64> } | { action: 'load', model: <size> }
 * - Recebimento (stdout): { type: 'transcription', text: string, timestamp: number }
 *                        | { type: 'model-loaded', model: string }
 *                        | { type: 'error', message: string }
 *
 * Eventos emitidos:
 * - 'transcription': Texto transcrito (texto, timestamp)
 * - 'error': Erro na transcrição
 * - 'model-loaded': Modelo carregado com sucesso
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { createInterface, Interface as ReadlineInterface } from 'readline';

/** Diretório base do projeto (dois níveis acima de src/main) */
const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Timeout para carregamento do modelo (em ms) */
const MODEL_LOAD_TIMEOUT = 120_000;

/** Timeout para resposta de transcrição (em ms) */
const TRANSCRIPTION_TIMEOUT = 30_000;

/** Interface para eventos do WhisperManager */
export interface WhisperManagerEvents {
  'transcription': (text: string, timestamp: number) => void;
  'error': (error: Error) => void;
  'model-loaded': (modelSize: string) => void;
}

/** Tamanhos de modelo suportados pelo Faster-Whisper */
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large';

/**
 * Mensagem recebida do worker Python via stdout JSON.
 */
interface WhisperMessage {
  type: 'transcription' | 'error' | 'model-loaded' | 'ready';
  text?: string;
  message?: string;
  model?: string;
  timestamp?: number;
}

/**
 * Gerencia o worker Python Faster-Whisper.
 *
 * Responsável por:
 * - Iniciar o processo Python com o modelo especificado
 * - Enviar chunks de áudio para transcrição
 * - Receber transcrições via JSON sobre stdout
 * - Gerenciar fila de requisições com timeout
 */
export class WhisperManager extends EventEmitter {
  /** Processo filho Python */
  private process: ChildProcess | null = null;

  /** Interface readline para ler stdout linha a linha */
  private readline: ReadlineInterface | null = null;

  /** Indica se o worker está pronto para receber áudio */
  private ready = false;

  /** Tamanho do modelo atualmente carregado */
  private currentModel: WhisperModelSize = 'tiny';

  /** Buffer de requisições pendentes */
  private pendingRequests: Array<{
    resolve: (text: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  /** Contador para IDs de requisição */
  private requestId = 0;

  constructor() {
    super();
  }

  /**
   * Inicia o worker Python com o modelo Faster-Whisper especificado.
   *
   * Faz spawn do processo workers/whisper_worker.py e configura a
   * comunicação via stdin/stdout com JSON. O worker sinaliza 'ready'
   * quando o modelo terminou de carregar.
   *
   * @param modelSize - Tamanho do modelo (default: 'tiny')
   * @throws Se o worker já estiver em execução
   */
  async start(modelSize: WhisperModelSize = 'tiny'): Promise<void> {
    if (this.process) {
      throw new Error('Whisper worker is already running');
    }

    this.currentModel = modelSize;
    const scriptPath = resolve(PROJECT_ROOT, 'workers', 'whisper_worker.py');

    this.process = spawn('python', [
      scriptPath,
      '--model', modelSize,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Configura leitura linha a linha do stdout
    this.readline = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line: string) => {
      try {
        const msg: WhisperMessage = JSON.parse(line.trim());

        switch (msg.type) {
          case 'ready':
            this.ready = true;
            this.emit('model-loaded', this.currentModel);
            break;

          case 'model-loaded':
            this.ready = true;
            this.emit('model-loaded', msg.model ?? this.currentModel);
            break;

          case 'transcription':
            this.emit('transcription', msg.text ?? '', msg.timestamp ?? Date.now());
            // Resolve a requisição pendente mais antiga
            this.resolveNextRequest(msg.text ?? '');
            break;

          case 'error':
            this.emit('error', new Error(msg.message ?? 'Unknown whisper error'));
            this.rejectNextRequest(new Error(msg.message ?? 'Unknown whisper error'));
            break;
        }
      } catch (parseError) {
        this.emit('error', new Error(`Failed to parse whisper output: ${line}`));
      }
    });

    // Trata stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString('utf-8').trim();
      if (msg) {
        this.emit('error', new Error(`Whisper stderr: ${msg}`));
      }
    });

    // Trata encerramento do processo
    this.process.on('exit', (code, signal) => {
      this.ready = false;
      this.process = null;
      this.readline = null;
      // Rejeita todas as requisições pendentes
      this.rejectAllRequests(new Error(`Whisper process exited (code: ${code}, signal: ${signal})`));
    });

    this.process.on('error', (err) => {
      this.ready = false;
      this.process = null;
      this.rejectAllRequests(err);
    });

    // Aguarda o worker ficar pronto
    await this.waitForReady();
  }

  /**
   * Aguarda até que o worker sinalize que está pronto.
   */
  private waitForReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.ready) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for whisper model to load (${MODEL_LOAD_TIMEOUT}ms)`));
      }, MODEL_LOAD_TIMEOUT);

      this.once('model-loaded', () => {
        clearTimeout(timer);
        resolve();
      });

      this.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Envia um chunk de áudio para transcrição.
   *
  /**
   * Envia um chunk de áudio para transcrição pelo worker Python.
   *
   * @param audioChunk - Buffer com áudio PCM 16-bit mono 16000Hz
   * @param language - Idioma opcional (ex: 'pt', 'en'). Auto-detect se omitido.
   * @returns Promise com o texto transcrito
   * @throws Se o worker não estiver pronto
   */
  transcribe(audioChunk: Buffer, language?: string): Promise<string> {
    if (!this.ready || !this.process?.stdin) {
      return Promise.reject(new Error('Whisper worker is not ready'));
    }

    const id = ++this.requestId;
    const audioBase64 = audioChunk.toString('base64');

    const messageObj: Record<string, unknown> = {
      action: 'transcribe',
      audio: audioBase64,
      id,
    };
    if (language) {
      messageObj.language = language;
    }
    const message = JSON.stringify(messageObj);

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectNextRequest(new Error(`Transcription timeout (${TRANSCRIPTION_TIMEOUT}ms)`));
      }, TRANSCRIPTION_TIMEOUT);

      this.pendingRequests.push({ resolve, reject, timer });
      this.process!.stdin!.write(message + '\n');
    });
  }

  /**
   * Resolve a próxima requisição pendente na fila.
   */
  private resolveNextRequest(text: string): void {
    const request = this.pendingRequests.shift();
    if (request) {
      clearTimeout(request.timer);
      request.resolve(text);
    }
  }

  /**
   * Rejeita a próxima requisição pendente na fila.
   */
  private rejectNextRequest(error: Error): void {
    const request = this.pendingRequests.shift();
    if (request) {
      clearTimeout(request.timer);
      request.reject(error);
    }
  }

  /**
   * Rejeita todas as requisições pendentes na fila.
   */
  private rejectAllRequests(error: Error): void {
    for (const request of this.pendingRequests) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pendingRequests = [];
  }

  /**
   * Para o worker Whisper.
   *
   * Encerra o processo Python e limpa os recursos.
   */
  stop(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');

      // Timeout de segurança
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }

    this.ready = false;
    this.readline?.close();
    this.readline = null;
    this.process = null;
    this.rejectAllRequests(new Error('Whisper worker stopped'));
  }

  /**
   * Verifica se o worker está pronto para receber áudio.
   */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Obtém o tamanho do modelo atualmente carregado.
   */
  get modelSize(): WhisperModelSize {
    return this.currentModel;
  }

  /**
   * Libera recursos e remove listeners.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }
}

export default WhisperManager;
