/**
 * mic-capture.ts - Captura de áudio do microfone via worker Python
 *
 * Gerencia o ciclo de vida do processo filho Python (workers/audio_mic_capture.py)
 * que captura o áudio do microfone usando WASAPI input.
 *
 * A comunicação com o worker Python é feita via stdin/stdout no formato JSON:
 * - Envio (stdin): { command: 'start' } | { command: 'stop' } | { command: 'exit' }
 * - Recebimento (stdout): { type: 'ready', worker: 'audio_mic_capture' }
 *                        | { type: 'audio', data: <base64>, sample_rate, channels, dtype, rms }
 *                        | { type: 'status', status: 'started' | 'stopped' | 'exiting' }
 *                        | { type: 'error', message: string }
 *
 * Eventos emitidos:
 * - 'data': Buffer contendo chunk de áudio PCM (float32 mono 16000Hz)
 * - 'error': Erro durante a captura
 * - 'exit': Processo filho encerrou
 * - 'ready': Worker está pronto para receber comandos
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { createInterface, Interface as ReadlineInterface } from 'readline';

/** Diretório base do projeto (dois níveis acima de src/main) */
const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Timeout (ms) para aguardar o worker ficar pronto */
const WORKER_READY_TIMEOUT = 10_000;

/** Eventos emitidos pelo MicCapture */
export interface MicCaptureEvents {
  /** Chunk de áudio PCM float32 mono 16kHz */
  'data': (chunk: Buffer) => void;
  /** Erro durante captura ou comunicação */
  'error': (error: Error) => void;
  /** Processo filho encerrou */
  'exit': (code: number | null, signal: string | null) => void;
  /** Worker está pronto para receber comandos */
  'ready': () => void;
}

/**
 * Mensagem recebida do worker Python via stdout JSON.
 */
interface MicCaptureMessage {
  type: 'ready' | 'audio' | 'status' | 'error';
  worker?: string;
  /** Dados de áudio codificados em base64 (presente quando type === 'audio') */
  data?: string;
  sample_rate?: number;
  channels?: number;
  dtype?: string;
  /** RMS energy do chunk (presente quando type === 'audio') */
  rms?: number;
  /** Status operation (presente quando type === 'status') */
  status?: string;
  /** Mensagem de erro (presente quando type === 'error') */
  message?: string;
}

/** Timestamp helper for logging */
function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

/**
 * Gerencia o worker Python de captura de áudio do microfone.
 *
 * O worker Python lê áudio do dispositivo de entrada WASAPI (microfone)
 * e envia chunks PCM via stdout codificados em base64 dentro de mensagens JSON.
 * Inclui VAD (voice activity detection) por threshold de energia para
 * evitar enviar silêncio.
 */
export class MicCapture extends EventEmitter {
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
   * Inicia a captura de áudio do microfone.
   *
   * Faz spawn do processo Python workers/audio_mic_capture.py e aguarda
   * o worker sinalizar 'ready'. Em seguida envia o comando 'start'
   * para iniciar a captura. A saída stdout é parseada como JSON
   * linha a linha.
   *
   * @param config - Configuração de captura (ex: deviceName, deviceIndex)
   * @throws Se a captura já estiver em execução
   * @throws Se o timeout de ready for atingido
   */
  async start(config: Record<string, unknown> = {}): Promise<void> {
    if (this.isRunning) {
      throw new Error('Mic capture is already running');
    }

    const scriptPath = resolve(PROJECT_ROOT, 'workers', 'audio_mic_capture.py');

    console.log(`${timestamp()} [mic-capture] Spawning worker: ${scriptPath}`);

    // O worker Python NÃO aceita argumentos CLI — os comandos vão via stdin JSON
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
        console.log(`${timestamp()} [mic-capture:stderr] ${msg}`);
      }
    });

    // Trata encerramento do processo
    this.process.on('exit', (code, signal) => {
      console.log(`${timestamp()} [mic-capture] Process exited (code: ${code}, signal: ${signal})`);
      this.isRunning = false;
      this.ready = false;
      this.process = null;
      this.readline?.close();
      this.readline = null;
      this.emit('exit', code, signal);
    });

    this.process.on('error', (err) => {
      console.error(`${timestamp()} [mic-capture] Process error: ${err.message}`);
      this.isRunning = false;
      this.ready = false;
      this.process = null;
      this.readline?.close();
      this.readline = null;
      this.emit('error', err);
    });

    // Aguarda o worker ficar pronto, então envia o comando 'start'
    await this.waitForReady();

    console.log(`${timestamp()} [mic-capture] Worker ready, sending start command`);
    this.sendCommand('start');
  }

  /**
   * Processa uma linha JSON recebida do stdout do worker.
   *
   * @param line - Linha JSON recebida do stdout
   */
  private handleLine(line: string): void {
    let msg: MicCaptureMessage;
    try {
      msg = JSON.parse(line.trim());
    } catch (parseError) {
      console.error(`${timestamp()} [mic-capture] Failed to parse JSON: ${line}`);
      this.emit('error', new Error(`Failed to parse mic worker output: ${line}`));
      return;
    }

    console.log(`${timestamp()} [mic-capture] Received: type=${msg.type}${msg.status ? ` status=${msg.status}` : ''}`);

    switch (msg.type) {
      case 'ready':
        this.ready = true;
        console.log(`${timestamp()} [mic-capture] Worker ready: ${msg.worker ?? 'unknown'}`);
        this.emit('ready');
        break;

      case 'audio':
        if (msg.data) {
          const audioBuffer = Buffer.from(msg.data, 'base64');
          this.emit('data', audioBuffer);
        } else {
          console.warn(`${timestamp()} [mic-capture] Audio message missing data field`);
        }
        break;

      case 'status':
        if (msg.status === 'started') {
          this.isRunning = true;
          console.log(`${timestamp()} [mic-capture] Capture started`);
        } else if (msg.status === 'stopped') {
          this.isRunning = false;
          console.log(`${timestamp()} [mic-capture] Capture stopped`);
        } else if (msg.status === 'already_running') {
          console.warn(`${timestamp()} [mic-capture] Worker reported already running`);
        } else if (msg.status === 'not_running') {
          console.warn(`${timestamp()} [mic-capture] Worker reported not running`);
        } else if (msg.status === 'exiting') {
          console.log(`${timestamp()} [mic-capture] Worker is exiting`);
        }
        break;

      case 'error':
        console.error(`${timestamp()} [mic-capture] Worker error: ${msg.message ?? 'unknown'}`);
        this.emit('error', new Error(`Mic capture worker: ${msg.message ?? 'unknown error'}`));
        break;
    }
  }

  /**
   * Envia um comando JSON para o worker via stdin.
   *
   * @param command - Nome do comando (start, stop, exit)
   */
  private sendCommand(command: string): void {
    if (!this.process?.stdin) {
      console.error(`${timestamp()} [mic-capture] Cannot send command '${command}': no stdin`);
      return;
    }
    const message = JSON.stringify({ command });
    console.log(`${timestamp()} [mic-capture] Sending: ${message}`);
    this.process.stdin.write(message + '\n');
  }

  /**
   * Aguarda até que o worker sinalize 'ready'.
   *
   * Cria uma Promise que resolve quando o evento 'ready' é emitido,
   * ou rejeita com timeout ou se o worker encerrar antes de ficar pronto.
   *
   * @returns Promise que resolve quando o worker está pronto
   * @throws Se o timeout for atingido ou se o worker encerrar antes de ficar pronto
   */
  private waitForReady(): Promise<void> {
    return new Promise<void>((resolvePromise, reject) => {
      if (this.ready) {
        resolvePromise();
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for mic capture worker to be ready (${WORKER_READY_TIMEOUT}ms)`));
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
        reject(new Error('Mic capture worker exited before becoming ready'));
      });
    });
  }

  /**
   * Interrompe a captura de áudio do microfone.
   *
   * Envia o comando 'stop' para o worker, seguido de 'exit'
   * para encerramento ordenado. Se o processo não encerrar em
   * 5 segundos, força SIGKILL.
   */
  stop(): void {
    if (!this.process) {
      return;
    }

    console.log(`${timestamp()} [mic-capture] Stopping capture`);

    // Envia stop se estiver capturando
    if (this.isRunning) {
      this.sendCommand('stop');
    }

    // Envia exit para encerramento ordenado
    this.sendCommand('exit');

    const proc = this.process;
    const killTimeout = setTimeout(() => {
      console.warn(`${timestamp()} [mic-capture] Force killing worker (SIGKILL)`);
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
   * Verifica se a captura está ativa no momento.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Reinicia a captura (stop + start).
   *
   * @param config - Nova configuração para o restart (opcional)
   */
  async restart(config?: Record<string, unknown>): Promise<void> {
    this.stop();
    await this.start(config);
  }

  /**
   * Libera recursos e encerra o processo.
   *
   * Para a captura, encerra o worker e remove todos os listeners.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }
}

export default MicCapture;
