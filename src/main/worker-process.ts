/**
 * worker-process.ts — Classe base para workers Python
 *
 * Consolida o boilerplate comum a todos os workers:
 * spawn, readline, stderr, exit/error handlers,
 * sendCommand, waitForReady, stop com kill timeout.
 *
 * Cada worker estende esta classe e implementa:
 * - workerName, scriptName, scriptArgs (opcional)
 * - handleMessage(msg) — processa JSON do stdout
 */
import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { createInterface, Interface as ReadlineInterface } from 'readline';

const PROJECT_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_READY_TIMEOUT = 10_000;
const DEFAULT_KILL_TIMEOUT = 5_000;

export abstract class WorkerProcess extends EventEmitter {
  protected process: ChildProcess | null = null;
  protected readline: ReadlineInterface | null = null;
  protected ready = false;

  /** Nome do worker (usado em logs, ex: 'audio-capture') */
  protected abstract get workerName(): string;
  /** Nome do script Python (ex: 'audio_capture.py') */
  protected abstract get scriptName(): string;
  /** Argumentos extras pro script Python */
  protected get scriptArgs(): string[] { return []; }

  // ── Lifecycle ──

  async start(): Promise<void> {
    if (this.process) {
      throw new Error(`${this.workerName} is already running`);
    }

    const scriptPath = resolve(PROJECT_ROOT, 'workers', this.scriptName);
    this.log(`Spawning worker: ${scriptPath}`);

    this.process = spawn('python', [scriptPath, ...this.scriptArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.setupStdout();
    this.setupStderr();
    this.setupExitHandlers();
    await this.waitForReady();
  }

  /** Processa uma mensagem JSON recebida do stdout do worker */
  protected abstract handleMessage(msg: Record<string, unknown>): void;

  // ── Stdio setup ──

  private setupStdout(): void {
    this.readline = createInterface({
      input: this.process!.stdout!,
      crlfDelay: Infinity,
    });
    this.readline.on('line', (line: string) => {
      try {
        this.handleMessage(JSON.parse(line.trim()));
      } catch (parseError) {
        this.log(`Failed to parse JSON: ${line}`);
        this.emit('error', new Error(`Failed to parse ${this.workerName} output: ${line}`));
      }
    });
  }

  private setupStderr(): void {
    this.process!.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString('utf-8').trim();
      if (msg) this.log(`stderr: ${msg}`);
    });
  }

  private setupExitHandlers(): void {
    this.process!.on('exit', (code, signal) => {
      this.log(`Process exited (code: ${code}, signal: ${signal})`);
      this.ready = false;
      this.process = null;
      this.readline?.close();
      this.readline = null;
      this.emit('exit', code, signal);
    });

    this.process!.on('error', (err) => {
      this.log(`Process error: ${err.message}`);
      this.ready = false;
      this.process = null;
      this.readline?.close();
      this.readline = null;
      this.emit('error', err);
    });
  }

  // ── Commands ──

  /** Envia comando simples (campos obrigatórios: { command }) */
  protected sendCommand(command: string): void {
    this.sendJson({ command });
  }

  /** Envia objeto JSON arbitrário pro worker */
  protected sendJson(msg: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      this.log(`Cannot send: stdin not available`);
      return;
    }
    const json = JSON.stringify(msg);
    this.log(`Sending: ${json}`);
    this.process.stdin.write(json + '\n');
  }

  // ── Ready wait ──

  protected waitForReady(timeoutMs = DEFAULT_READY_TIMEOUT): Promise<void> {
    return new Promise<void>((resolvePromise, reject) => {
      if (this.ready) {
        resolvePromise();
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for ${this.workerName} (${timeoutMs}ms)`));
      }, timeoutMs);
      this.once('ready', () => { clearTimeout(timer); resolvePromise(); });
      this.once('error', (err) => { clearTimeout(timer); reject(err); });
      this.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(`${this.workerName} exited before becoming ready`));
      });
    });
  }

  // ── Stop / Dispose ──

  stop(): void {
    if (!this.process) return;
    this.log('Stopping');
    if (this.running) this.sendCommand('stop');
    this.sendCommand('exit');
    const proc = this.process;
    const killTimer = setTimeout(() => {
      this.log('Force killing (SIGKILL)');
      proc.kill('SIGKILL');
    }, DEFAULT_KILL_TIMEOUT);
    proc.on('exit', () => clearTimeout(killTimer));
    proc.stdin?.end();
    this.ready = false;
  }

  /** true se o worker está ativo (processo em execução) */
  get running(): boolean {
    return this.process !== null;
  }

  /** true se o worker sinalizou ready */
  get isReady(): boolean {
    return this.ready;
  }

  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  // ── Logging ──

  protected log(msg: string): void {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${this.workerName}] ${msg}`);
  }
}
