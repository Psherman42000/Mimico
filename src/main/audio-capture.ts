/**
 * audio-capture.ts - Captura de áudio WASAPI loopback via worker Python
 *
 * Gerencia o ciclo de vida do processo filho Python (workers/audio_capture.py)
 * que captura o áudio do sistema usando WASAPI loopback.
 *
 * A comunicação com o worker Python é feita via stdin/stdout no formato JSON:
 * - Envio (stdin): { command: 'start' } | { command: 'stop' } | { command: 'exit' }
 * - Recebimento (stdout): { type: 'ready', worker: 'audio_capture' }
 *                        | { type: 'audio', data: <base64>, sample_rate, channels, dtype, rms }
 *                        | { type: 'status', status: 'started' | 'stopped' | 'exiting' }
 *                        | { type: 'error', message: string }
 *
 * Eventos emitidos:
 * - 'data': Buffer contendo chunk de áudio PCM (float32 mono 16000Hz)
 * - 'error': Erro durante a captura
 * - 'exit': Processo filho encerrou
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { createInterface, Interface as ReadlineInterface } from 'readline';

/** Diretório base do projeto (dois níveis acima de src/main) */
const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Timeout (ms) para aguardar o worker ficar pronto */
const WORKER_READY_TIMEOUT = 10_000;

/** Eventos emitidos pelo AudioCapture */
export interface AudioCaptureEvents {
  'data': (chunk: Buffer) => void;
  'error': (error: Error) => void;
  'exit': (code: number | null, signal: string | null) => void;
}

/**
 * Mensagem recebida do worker Python via stdout JSON.
 */
interface AudioCaptureMessage {
  type: 'ready' | 'audio' | 'status' | 'error';
  worker?: string;
  data?: string;          // base64-encoded audio (present when type === 'audio')
  sample_rate?: number;
  channels?: number;
  dtype?: string;
  rms?: number;
  status?: string;        // present when type === 'status'
  message?: string;       // present when type === 'error'
}

/** Timestamp helper for logging */
function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

/**
 * Gerencia o worker Python de captura WASAPI loopback.
 *
 * O worker Python lê áudio do dispositivo de loopback do Windows
 * (WASAPI) e envia chunks PCM via stdout codificados em base64
 * dentro de mensagens JSON.
 */
export class AudioCapture extends EventEmitter {
  /** Processo filho Python */
  private process: ChildProcess | null = null;

  /** Interface readline para ler stdout linha a linha */
  private readline: ReadlineInterface | null = null;

  /** Indica se a captura está ativa */
  private isRunning = false;

  /** Indica se o worker está pronto para receber comandos */
  private ready = false;

  constructor() {
    super();
  }

  /**
   * Inicia a captura de áudio WASAPI loopback.
   *
   * Faz spawn do processo Python workers/audio_capture.py e aguarda
   * o worker sinalizar 'ready'. Em seguida envia o comando 'start'
   * para iniciar a captura. A saída stdout é parseada como JSON
   * linha a linha.
   *
   * @param config - Configuração de captura (deviceName reservado para futuro)
   * @throws Se a captura já estiver em execução
   */
  async start(config: Record<string, unknown> = {}): Promise<void> {
    if (this.isRunning) {
      throw new Error('Audio capture is already running');
    }

    const scriptPath = resolve(PROJECT_ROOT, 'workers', 'audio_capture.py');

    console.log(`${timestamp()} [audio-capture] Spawning worker: ${scriptPath}`);

    // O worker Python NÃO aceita argumentos CLI -- os comandos vão via stdin JSON
    this.process = spawn('python', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Configura leitura linha a linha do stdout
    this.readline = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line: string) => {
      this.handleLine(line);
    });

    // Trata stderr (logs do worker)
    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString('utf-8').trim();
      if (msg) {
        console.log(`${timestamp()} [audio-capture:stderr] ${msg}`);
      }
    });

    // Trata encerramento do processo
    this.process.on('exit', (code, signal) => {
      console.log(`${timestamp()} [audio-capture] Process exited (code: ${code}, signal: ${signal})`);
      this.isRunning = false;
      this.ready = false;
      this.process = null;
      this.readline?.close();
      this.readline = null;
      this.emit('exit', code, signal);
    });

    this.process.on('error', (err) => {
      console.error(`${timestamp()} [audio-capture] Process error: ${err.message}`);
      this.isRunning = false;
      this.ready = false;
      this.process = null;
      this.readline?.close();
      this.readline = null;
      this.emit('error', err);
    });

    // Aguarda o worker ficar pronto, então envia o comando 'start'
    await this.waitForReady();

    console.log(`${timestamp()} [audio-capture] Worker ready, sending start command`);
    this.sendCommand('start');
  }

  /**
   * Processa uma linha JSON recebida do stdout do worker.
   */
  private handleLine(line: string): void {
    let msg: AudioCaptureMessage;
    try {
      msg = JSON.parse(line.trim());
    } catch (parseError) {
      console.error(`${timestamp()} [audio-capture] Failed to parse JSON: ${line}`);
      this.emit('error', new Error(`Failed to parse audio worker output: ${line}`));
      return;
    }

    console.log(`${timestamp()} [audio-capture] Received: type=${msg.type}${msg.status ? ` status=${msg.status}` : ''}`);

    switch (msg.type) {
      case 'ready':
        this.ready = true;
        console.log(`${timestamp()} [audio-capture] Worker ready: ${msg.worker ?? 'unknown'}`);
        break;

      case 'audio':
        if (msg.data) {
          const audioBuffer = Buffer.from(msg.data, 'base64');
          this.emit('data', audioBuffer);
        } else {
          console.warn(`${timestamp()} [audio-capture] Audio message missing data field`);
        }
        break;

      case 'status':
        if (msg.status === 'started') {
          this.isRunning = true;
          console.log(`${timestamp()} [audio-capture] Capture started`);
        } else if (msg.status === 'stopped') {
          this.isRunning = false;
          console.log(`${timestamp()} [audio-capture] Capture stopped`);
        } else if (msg.status === 'already_running') {
          console.warn(`${timestamp()} [audio-capture] Worker reported already running`);
        } else if (msg.status === 'not_running') {
          console.warn(`${timestamp()} [audio-capture] Worker reported not running`);
        } else if (msg.status === 'exiting') {
          console.log(`${timestamp()} [audio-capture] Worker is exiting`);
        }
        break;

      case 'error':
        console.error(`${timestamp()} [audio-capture] Worker error: ${msg.message ?? 'unknown'}`);
        this.emit('error', new Error(`Audio capture worker: ${msg.message ?? 'unknown error'}`));
        break;
    }
  }

  /**
   * Envia um comando JSON para o worker via stdin.
   */
  private sendCommand(command: string): void {
    if (!this.process?.stdin) {
      console.error(`${timestamp()} [audio-capture] Cannot send command '${command}': no stdin`);
      return;
    }
    const message = JSON.stringify({ command });
    console.log(`${timestamp()} [audio-capture] Sending: ${message}`);
    this.process.stdin.write(message + '\n');
  }

  /**
   * Aguarda até que o worker sinalize 'ready'.
   */
  private waitForReady(): Promise<void> {
    return new Promise<void>((resolvePromise, reject) => {
      if (this.ready) {
        resolvePromise();
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for audio capture worker to be ready (${WORKER_READY_TIMEOUT}ms)`));
      }, WORKER_READY_TIMEOUT);

      this.once('ready', () => {
        clearTimeout(timer);
        resolvePromise();
      });

      this.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      // Também trata exit sem nunca ter ficado ready
      this.once('exit', (_code, _signal) => {
        clearTimeout(timer);
        reject(new Error('Audio capture worker exited before becoming ready'));
      });
    });
  }

  /**
   * Interrompe a captura de áudio.
   *
   * Envia o comando 'stop' para o worker, seguido de 'exit'
   * para encerramento ordenado. Se o processo não encerrar em
   * 5 segundos, força SIGKILL.
   */
  stop(): void {
    if (!this.process) {
      return;
    }

    console.log(`${timestamp()} [audio-capture] Stopping capture`);

    // Envia stop se estiver capturando
    if (this.isRunning) {
      this.sendCommand('stop');
    }

    // Envia exit para encerramento ordenado
    this.sendCommand('exit');

    const proc = this.process;
    const killTimeout = setTimeout(() => {
      console.warn(`${timestamp()} [audio-capture] Force killing worker (SIGKILL)`);
      proc.kill('SIGKILL');
    }, 5000);

    proc.on('exit', () => {
      clearTimeout(killTimeout);
    });

    // Fecha stdin para o worker sentir EOF
    proc.stdin?.end();

    this.isRunning = false;
    this.ready = false;
  }

  /**
   * Verifica se a captura está ativa.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Reinicia a captura (stop + start).
   *
   * @param config - Nova configuração (opcional)
   */
  async restart(config?: Record<string, unknown>): Promise<void> {
    this.stop();
    await this.start(config);
  }

  /**
   * Libera recursos e encerra o processo.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }
}

export default AudioCapture;
