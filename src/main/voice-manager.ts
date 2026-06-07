/**
 * voice-manager.ts - Gerenciamento de síntese de voz Edge TTS
 *
 * Duas opções de síntese:
 * 1. Sistema local: usa o CLI edge-tts (pip install edge-tts)
 * 2. Worker Python: usa workers/tts_worker.py para maior controle
 *
 * Inclui pausa entre chamadas para evitar buffer overflow no VB-Cable.
 * Edge TTS suporta vozes naturais da Microsoft (Windows).
 *
 * Eventos emitidos:
 * - 'started': Início da síntese de voz
 * - 'finished': Síntese concluída
 * - 'error': Erro na síntese
 * - 'audio': Buffer WAV com o áudio sintetizado (quando usando worker)
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess, execFile } from 'child_process';
import { resolve } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

/** Diretório base do projeto */
const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Pausa mínima entre chamadas de TTS para evitar buffer overflow (ms) */
const TTS_COOLDOWN_MS = 500;

/** Voz padrão para português do Brasil */
const DEFAULT_VOICE_PT_BR = 'pt-BR-FranciscaNeural';

/** Voz padrão para inglês */
const DEFAULT_VOICE_EN = 'en-US-JennyNeural';

/** Mapa de idiomas para vozes padrão */
const VOICE_MAP: Record<string, string> = {
  'pt-BR': 'pt-BR-FranciscaNeural',
  'pt-PT': 'pt-PT-RaquelNeural',
  'en-US': 'en-US-JennyNeural',
  'en-GB': 'en-GB-SoniaNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'de-DE': 'de-DE-KatjaNeural',
};

/** Interface para eventos do VoiceManager */
export interface VoiceManagerEvents {
  'started': (text: string, lang: string) => void;
  'finished': (text: string) => void;
  'error': (error: Error) => void;
  'audio': (buffer: Buffer, text: string) => void;
}

/**
 * Gerenciador de síntese de voz usando Edge TTS.
 *
 * Converte texto em fala usando o mecanismo Edge TTS da Microsoft,
 * que oferece vozes naturais baseadas em rede neural.
 */
export class VoiceManager extends EventEmitter {
  /** Indica se está falando no momento */
  private speaking = false;

  /** Timestamp da última chamada de TTS */
  private lastCallTimestamp = 0;

  /** Modo de operação: 'cli' (edge-tts CLI) ou 'worker' (Python) */
  private mode: 'cli' | 'worker';

  /** Processo worker Python (se no modo worker) */
  private worker: ChildProcess | null = null;

  /** Buffer de áudio acumulado do worker */
  private audioBuffer: Buffer | null = null;

  constructor(mode: 'cli' | 'worker' = 'cli') {
    super();
    this.mode = mode;
  }

  /**
   Define o modo de operação.
   */
  setMode(mode: 'cli' | 'worker'): void {
    this.mode = mode;
  }

  /**
   * Sintetiza texto em áudio e reproduz (ou emite evento 'audio').
   *
   * No modo 'cli', usa edge-tts CLI para gerar arquivo WAV temporário.
   * No modo 'worker', envia para processo Python que retorna áudio WAV.
   *
   * Inclui pausa forçada entre chamadas (TTS_COOLDOWN_MS) para evitar
   * buffer overflow no dispositivo VB-Cable.
   *
   * @param text - Texto a ser sintetizado
   * @param lang - Código do idioma (ex: 'pt-BR', 'en-US')
   * @returns Promise que resolve quando a síntese termina
   * @throws Se o texto estiver vazio
   */
  async speakText(text: string, lang: string = 'pt-BR'): Promise<void> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot speak empty text');
    }

    // Aguarda o cooldown desde a última chamada
    const now = Date.now();
    const elapsed = now - this.lastCallTimestamp;
    if (elapsed < TTS_COOLDOWN_MS) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, TTS_COOLDOWN_MS - elapsed),
      );
    }

    this.speaking = true;
    this.lastCallTimestamp = Date.now();
    this.emit('started', text, lang);

    try {
      if (this.mode === 'worker') {
        await this.speakWithWorker(text, lang);
      } else {
        await this.speakWithCLI(text, lang);
      }

      this.emit('finished', text);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      throw err;
    } finally {
      this.speaking = false;
    }
  }

  /**
   * Sintetiza usando o CLI edge-tts.
   *
   * Gera um arquivo WAV temporário usando edge-tts,
   * depois emite o buffer de áudio.
   */
  private async speakWithCLI(text: string, lang: string): Promise<void> {
    const voice = VOICE_MAP[lang] ?? DEFAULT_VOICE_PT_BR;
    const tmpFile = join(tmpdir(), `mimico_tts_${randomBytes(4).toString('hex')}.wav`);

    try {
      // Gera o arquivo WAV com edge-tts
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          'edge-tts',
          [
            '--voice', voice,
            '--text', text,
            '--write-media', tmpFile,
          ],
          {
            timeout: 30000,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            if (error) {
              reject(new Error(`edge-tts failed: ${error.message}\n${stderr}`));
            } else {
              resolve();
            }
          },
        );
      });

      // Lê o arquivo e emite como buffer
      const { readFile } = await import('fs/promises');
      const audioBuffer = await readFile(tmpFile);
      this.emit('audio', audioBuffer, text);

      // Remove arquivo temporário
      await unlink(tmpFile).catch(() => {
        // Ignora erro ao deletar temp file
      });
    } catch (error) {
      // Tenta limpar o arquivo temporário em caso de erro
      await unlink(tmpFile).catch(() => {});
      throw error;
    }
  }

  /**
   * Sintetiza usando o worker Python.
   *
   * Envia o texto para workers/tts_worker.py via stdin JSON
   * e recebe o áudio WAV de volta via stdout.
   */
  private async speakWithWorker(text: string, lang: string): Promise<void> {
    const scriptPath = resolve(PROJECT_ROOT, 'workers', 'tts_worker.py');

    if (!this.worker) {
      this.worker = spawn('python', [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.worker.on('exit', () => {
        this.worker = null;
      });
    }

    const message = JSON.stringify({
      action: 'speak',
      text,
      lang,
      voice: VOICE_MAP[lang] ?? DEFAULT_VOICE_PT_BR,
    });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('TTS worker timeout (30s)'));
      }, 30000);

      const chunks: Buffer[] = [];
      const onData = (data: Buffer): void => {
        chunks.push(data);
      };

      this.worker!.stdout?.on('data', onData);

      this.worker!.stdout?.once('end', () => {
        clearTimeout(timeout);
        this.worker!.stdout?.removeListener('data', onData);
        const audioBuffer = Buffer.concat(chunks);
        this.emit('audio', audioBuffer, text);
        resolve();
      });

      this.worker!.stdin?.write(message + '\n');
    });
  }

  /**
   * Verifica se está sintetizando no momento.
   */
  get isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Interrompe a síntese de voz em andamento.
   */
  stop(): void {
    if (this.worker) {
      this.worker.stdin?.end();
      this.worker.kill('SIGTERM');
      this.worker = null;
    }
    this.speaking = false;
  }

  /**
   * Libera recursos.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }
}

export default VoiceManager;
