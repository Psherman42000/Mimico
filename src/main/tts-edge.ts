/**
 * tts-edge.ts - Provedor TTS Edge (Microsoft Edge TTS)
 *
 * Usa o CLI edge-tts (pip install edge-tts) para síntese local e gratuita.
 * Suporta vozes neurais da Microsoft (Windows).
 * Não requer chave de API.
 */

import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TtsProvider, TtsOptions } from './tts-provider';

/** Pausa entre chamadas para evitar buffer overflow no VB-Cable (ms) */
const TTS_COOLDOWN_MS = 500;

/** Voz padrão por idioma */
const VOICE_MAP: Record<string, string> = {
  'pt-BR': 'pt-BR-FranciscaNeural',
  'pt-PT': 'pt-PT-RaquelNeural',
  'en-US': 'en-US-JennyNeural',
  'en-GB': 'en-GB-SoniaNeural',
  'en': 'en-US-JennyNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'de-DE': 'de-DE-KatjaNeural',
};

/**
 * Provedor TTS usando Edge TTS (Microsoft).
 * Gratuito, local, sem dependência de API key.
 */
export class EdgeTtsProvider extends TtsProvider {
  readonly name = 'Edge';
  private speaking = false;
  private lastCallTimestamp = 0;
  private aborted = false;

  async init(): Promise<void> {
    // Edge TTS não requer inicialização
    // Verifica se edge-tts está instalado
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('edge-tts', ['--list-voices'], {
          timeout: 10000,
          windowsHide: true,
        }, (error) => {
          if (error) {
            reject(new Error('edge-tts not found. Install: pip install edge-tts'));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      throw new Error(`Edge TTS check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async speak(options: TtsOptions): Promise<void> {
    const { text, lang } = options;

    if (!text || text.trim().length === 0) {
      throw new Error('Cannot speak empty text');
    }

    // Aguarda cooldown
    const now = Date.now();
    const elapsed = now - this.lastCallTimestamp;
    if (elapsed < TTS_COOLDOWN_MS) {
      await new Promise<void>((r) => setTimeout(r, TTS_COOLDOWN_MS - elapsed));
    }

    this.speaking = true;
    this.aborted = false;
    this.lastCallTimestamp = Date.now();
    this.emit('started', text);

    try {
      const voiceName = options.voice ?? VOICE_MAP[lang] ?? 'pt-BR-FranciscaNeural';
      const tmpFile = join(tmpdir(), `mimico_edge_${randomBytes(4).toString('hex')}.wav`);

      try {
        // Gera WAV com edge-tts
        await new Promise<void>((resolve, reject) => {
          const child = execFile(
            'edge-tts',
            ['--voice', voiceName, '--text', text, '--write-media', tmpFile],
            { timeout: 30000, windowsHide: true },
            (error) => {
              if (error) reject(new Error(`edge-tts: ${error.message}`));
              else resolve();
            },
          );
          // Suporta abort via stop()
          const abortCheck = setInterval(() => {
            if (this.aborted) {
              clearInterval(abortCheck);
              child.kill('SIGTERM');
              reject(new Error('Aborted'));
            }
          }, 100);
        });

        if (this.aborted) return;

        // Lê e emite áudio
        const audioBuffer = await readFile(tmpFile);
        this.emit('audio', audioBuffer, text);
        await unlink(tmpFile).catch(() => {});
      } catch (error) {
        await unlink(tmpFile).catch(() => {});
        throw error;
      }

      this.emit('finished', text);
    } catch (error) {
      if (!this.aborted) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('error', err);
        throw err;
      }
    } finally {
      this.speaking = false;
    }
  }

  stop(): void {
    this.aborted = true;
    this.speaking = false;
  }

  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }
}

export default EdgeTtsProvider;
