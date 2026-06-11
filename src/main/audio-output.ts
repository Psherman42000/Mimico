/**
 * audio-output.ts - Saída de áudio no VB-Cable via worker Python
 *
 * Gerencia o processo filho Python (workers/audio_output.py) que recebe
 * comandos JSON pelo stdin e reproduz arquivos WAV no VB-Cable.
 *
 * Comunicação com o worker Python via stdin/stdout no formato JSON:
 * - Envio (stdin): { command: 'play', path: '/caminho/arquivo.wav' }
 *                 | { command: 'stop' }
 *                 | { command: 'exit' }
 * - Recebimento (stdout): { type: 'ready', worker: 'audio_output' }
 *                        | { type: 'status', status: 'playing', file: '...' }
 *                        | { type: 'status', status: 'finished', file: '...' }
 *                        | { type: 'status', status: 'stopped' }
 *                        | { type: 'error', message: '...' }
 *
 * Eventos emitidos:
 * - 'ready': Worker iniciado e pronto para receber comandos
 * - 'status': Mudança de estado do worker (playing, finished, stopped)
 * - 'playing': Reprodução de áudio iniciada
 * - 'error': Erro na reprodução
 * - 'exit': Processo filho encerrou
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { resolve, join } from 'path';
import { createInterface, Interface as ReadlineInterface } from 'readline';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';

/** Diretório base do projeto */
const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Timeout para o worker ficar pronto (ms) */
const READY_TIMEOUT = 10_000;

/** Timeout para encerramento gracioso (ms) */
const SHUTDOWN_TIMEOUT = 3_000;

/** Interface para eventos do AudioOutput */
export interface AudioOutputEvents {
  'ready': () => void;
  'status': (status: string, data?: Record<string, unknown>) => void;
  'playing': (filePath: string) => void;
  'finished': (filePath: string) => void;
  'error': (error: Error) => void;
  'exit': (code: number | null, signal: string | null) => void;
}

/** Mensagem recebida do worker Python via stdout JSON */
interface OutputMessage {
  type: 'ready' | 'status' | 'devices' | 'error';
  worker?: string;
  status?: string;
  file?: string;
  message?: string;
  devices?: Array<Record<string, unknown>>;
}

/**
 * Gerencia a reprodução de áudio no dispositivo VB-Cable.
 *
 * O worker Python (audio_output.py) utiliza sounddevice para reproduzir
 * áudio WAV no dispositivo VB-Cable detectado automaticamente.
 */
export class AudioOutput extends EventEmitter {
  /** Processo filho Python */
  private process: ChildProcess | null = null;

  /** Interface readline para ler stdout linha a linha */
  private readline: ReadlineInterface | null = null;

  /** Nome do dispositivo de saída VB-Cable (uso interno/documentação) */
  private deviceName: string;

  /** Indica se o worker está pronto para receber comandos */
  private ready = false;

  /** Indica se o output está ativo (processo em execução) */
  private active = false;

  constructor(deviceName: string = 'CABLE Input') {
    super();
    this.deviceName = deviceName;
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  /**
   * Log com timestamp ISO.
   */
  private log(msg: string): void {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [audio-output] ${msg}`);
  }

  // ---------------------------------------------------------------------------
  // Start / lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Inicia o worker Python de output de áudio.
   *
   * Faz spawn do processo workers/audio_output.py, configura readline
   * no stdout e aguarda o sinal 'ready' do worker.
   */
  async start(): Promise<void> {
    if (this.active) {
      throw new Error('Audio output worker is already running');
    }

    const scriptPath = resolve(PROJECT_ROOT, 'workers', 'audio_output.py');

    this.log(`Starting audio output worker: ${scriptPath}`);

    this.process = spawn('python', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.active = true;

    // Configura leitura linha a linha do stdout
    this.readline = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line: string) => {
      try {
        const msg: OutputMessage = JSON.parse(line.trim());

        switch (msg.type) {
          case 'ready':
            this.ready = true;
            this.log('Worker ready');
            this.emit('ready');
            break;

          case 'status':
            this.handleStatusMessage(msg);
            break;

          case 'devices':
            this.log(`Received device list (${msg.devices?.length ?? 0} devices)`);
            break;

          case 'error':
            this.log(`Worker error: ${msg.message}`);
            this.emit('error', new Error(msg.message ?? 'Unknown audio output error'));
            break;
        }
      } catch (parseError) {
        this.log(`Failed to parse worker output: ${line}`);
        this.emit('error', new Error(`Failed to parse audio output message: ${line}`));
      }
    });

    // Trata stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8').trim();
      if (text) {
        this.log(`stderr: ${text}`);
      }
    });

    // Trata encerramento do processo
    this.process.on('exit', (code, signal) => {
      this.log(`Worker exited (code: ${code}, signal: ${signal})`);
      this.active = false;
      this.ready = false;
      this.process = null;
      this.readline?.close();
      this.readline = null;
      this.emit('exit', code, signal);
    });

    this.process.on('error', (err) => {
      this.log(`Worker process error: ${err.message}`);
      this.active = false;
      this.ready = false;
      this.process = null;
      this.readline?.close();
      this.readline = null;
      this.emit('error', err);
    });

    // Aguarda o worker ficar pronto
    await this.waitForReady();

    // Opcional: envia list_devices para depuração
    this.sendCommand({ command: 'list_devices' });
  }

  /**
   * Trata mensagens de status recebidas do worker.
   */
  private handleStatusMessage(msg: OutputMessage): void {
    const status = msg.status ?? 'unknown';

    switch (status) {
      case 'playing':
        this.log(`Playing: ${msg.file}`);
        this.emit('playing', msg.file ?? '');
        this.emit('status', 'playing', { file: msg.file });
        break;

      case 'finished':
        this.log(`Finished: ${msg.file}`);
        this.emit('finished', msg.file ?? '');
        this.emit('status', 'finished', { file: msg.file });
        break;

      case 'stopped':
        this.log('Playback stopped');
        this.emit('status', 'stopped');
        break;

      case 'exiting':
        this.log('Worker exiting');
        this.emit('status', 'exiting');
        break;

      default:
        this.log(`Unknown status: ${status}`);
        this.emit('status', status, { file: msg.file });
        break;
    }
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
        reject(new Error(`Timeout waiting for audio output worker to be ready (${READY_TIMEOUT}ms)`));
      }, READY_TIMEOUT);

      this.once('ready', () => {
        clearTimeout(timer);
        resolvePromise();
      });

      this.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Command helpers
  // ---------------------------------------------------------------------------

  /**
   * Envia um comando JSON para o worker via stdin.
   */
  private sendCommand(msg: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      this.log('Cannot send command: stdin not available');
      return;
    }

    const json = JSON.stringify(msg);
    this.log(`Sending: ${json}`);
    this.process.stdin.write(json + '\n');
  }

  // ---------------------------------------------------------------------------
  // Play / control
  // ---------------------------------------------------------------------------

  /**
   * Reproduz um áudio WAV no VB-Cable.
   *
   * Aceita tanto um caminho de arquivo (string) quanto um Buffer WAV.
   * Se for Buffer, salva em arquivo temporário antes de enviar comando.
   *
   * @param input - Caminho absoluto do WAV ou Buffer com dados WAV
   * @throws Se o worker não estiver ativo
   */
  async play(input: string | Buffer): Promise<void> {
    if (!this.active || !this.process?.stdin) {
      throw new Error('Audio output worker is not active');
    }

    if (!this.ready) {
      throw new Error('Audio output worker is not ready');
    }

    let wavPath: string;

    if (typeof input === 'string') {
      wavPath = input;
    } else {
      // Buffer -> salva em temp file
      const tmpFile = join(tmpdir(), `mimico_out_${randomBytes(4).toString('hex')}.wav`);
      await writeFile(tmpFile, input);
      wavPath = tmpFile;
      // Limpa depois de 5s
      setTimeout(() => unlink(tmpFile).catch(() => {}), 5000);
    }

    this.log(`Play command: ${wavPath}`);
    this.sendCommand({
      command: 'play',
      path: wavPath,
    });
  }

  /**
   * Para a reprodução atual.
   *
   * Envia comando 'stop' para o worker, que interrompe o playback
   * em andamento de forma graciosa.
   */
  stop(): void {
    if (!this.active) {
      return;
    }

    this.log('Stop command');
    this.sendCommand({ command: 'stop' });
  }

  // ---------------------------------------------------------------------------
  // Info
  // ---------------------------------------------------------------------------

  /**
   * Verifica se o worker está ativo (processo em execução).
   */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Verifica se o worker está pronto para receber comandos.
   */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Obtém o nome do dispositivo VB-Cable configurado.
   */
  get device(): string {
    return this.deviceName;
  }

  /**
   * Define o dispositivo VB-Cable (uso interno/documentação apenas;
   * o worker Python detecta o dispositivo automaticamente).
   */
  setDevice(name: string): void {
    this.deviceName = name;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Reinicia o worker.
   */
  async restart(): Promise<void> {
    this.stop();
    // Pequena pausa para garantir encerramento
    await new Promise((r) => setTimeout(r, 300));
    await this.start();
  }

  /**
   * Encerra o worker graciosamente.
   *
   * Envia comando 'exit' para o worker Python, permitindo que ele
   * finalize o playback e libere recursos. Se o worker não responder
   * dentro do timeout, força o kill.
   */
  dispose(): void {
    if (!this.active || !this.process) {
      this.removeAllListeners();
      return;
    }

    this.log('Disposing audio output worker');

    // Envia comando de exit gracioso
    this.sendCommand({ command: 'exit' });

    // Timeout de segurança: força kill se o worker não sair
    const proc = this.process;
    const forceKillTimer = setTimeout(() => {
      if (proc.exitCode === null) {
        this.log('Worker did not exit gracefully, killing');
        proc.kill('SIGKILL');
      }
    }, SHUTDOWN_TIMEOUT);

    // Se o worker já saiu, limpa o timer
    this.once('exit', () => {
      clearTimeout(forceKillTimer);
    });

    // Fecha stdin para sinalizar EOF também
    this.process.stdin?.end();

    this.active = false;
    this.ready = false;
    this.process = null;
    this.readline?.close();
    this.readline = null;
    this.removeAllListeners();
  }

  /**
   * Define o modo de mix de áudio: replace ou overlay.
   * replace = muta microfone original, só áudio traduzido
   * overlay = microfone original + áudio traduzido juntos
   */
  setMixMode(mode: 'replace' | 'overlay'): void {
    this.log(`Mix mode set to: ${mode}`);
    // Por enquanto apenas log — implementação real requer
    // modificar o worker Python audio_output.py para aceitar
    // comando set_mix_mode e tratar os dois modos
    if (this.process && this.process.stdin?.writable) {
      const msg = JSON.stringify({ command: 'set_mix_mode', mode }) + '\n';
      this.process.stdin.write(msg);
    }
  }

  /**
   * Encerra o worker (alias para dispose).
   */
  shutdown(): void {
    this.dispose();
  }
}

export default AudioOutput;
