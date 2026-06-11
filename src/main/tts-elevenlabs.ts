/**
 * tts-elevenlabs.ts - Provedor TTS ElevenLabs (REST API direta)
 *
 * Usa a REST API do ElevenLabs em vez do SDK (que tem conflitos de tipo).
 * POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 * Requer chave de API (Starter $5/mo ou superior).
 * Output: pcm_16000 para compatibilidade com VB-Cable.
 */

import { request } from 'https';
import { TtsProvider, TtsOptions } from './tts-provider';

/** Voz padrão em inglês (Rachel) */
const DEFAULT_VOICE_ID = 'Xb7hH8MSUJpSbSDYk0k2';

/** Mapa de idiomas para voz ElevenLabs */
const VOICE_MAP: Record<string, string> = {
  'en': DEFAULT_VOICE_ID,
  'en-US': DEFAULT_VOICE_ID,
  'pt-BR': 'OD4ZrFVg3kzWDx2v7tG6',
  'pt-PT': 'OD4ZrFVg3kzWDx2v7tG6',
  'es-ES': 'IKne3meq5aSn9XLyUdCD',
};

/**
 * Provedor TTS usando ElevenLabs REST API.
 * Requer chave de API (não funciona no Free tier).
 */
export class ElevenLabsTtsProvider extends TtsProvider {
  readonly name = 'ElevenLabs';
  private apiKey: string;
  private voiceId: string;
  private modelId: string;
  private speaking = false;
  private aborted = false;
  private currentReq: ReturnType<typeof makeTtsRequest> | null = null;

  constructor(
    apiKey: string,
    voiceId: string = DEFAULT_VOICE_ID,
    modelId: string = 'eleven_flash_v2_5',
  ) {
    super();
    this.apiKey = apiKey;
    this.voiceId = voiceId || DEFAULT_VOICE_ID;
    this.modelId = modelId || 'eleven_flash_v2_5';
  }

  async init(): Promise<void> {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new Error('ElevenLabs API key not configured');
    }
    // Valida a chave com uma requisição simples
    try {
      await validateApiKey(this.apiKey);
    } catch {
      // Não bloqueia em erro de rede — falha na primeira síntese
    }
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  setVoiceId(id: string): void {
    this.voiceId = id || DEFAULT_VOICE_ID;
  }

  setModelId(id: string): void {
    this.modelId = id || 'eleven_flash_v2_5';
  }

  async speak(options: TtsOptions): Promise<void> {
    const { text, lang } = options;

    if (!text || text.trim().length === 0) {
      throw new Error('Cannot speak empty text');
    }

    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new Error('ElevenLabs API key not configured');
    }

    this.speaking = true;
    this.aborted = false;
    this.emit('started', text);

    try {
      const voiceId = VOICE_MAP[lang] ?? this.voiceId;

      const buffer = await makeTtsRequest(
        this.apiKey,
        voiceId,
        this.modelId,
        text,
        () => this.aborted,
      );

      if (this.aborted) return;

      this.emit('audio', buffer, text);
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

  getInfo() {
    const hasKey = !!(this.apiKey && this.apiKey.trim().length > 0);
    return {
      name: this.name,
      needsApiKey: true,
      hasApiKey: hasKey,
    };
  }
}

/**
 * Faz requisição TTS para a ElevenLabs REST API.
 */
function makeTtsRequest(
  apiKey: string,
  voiceId: string,
  modelId: string,
  text: string,
  isAborted: () => boolean,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const body = JSON.stringify({
      text,
      model_id: modelId,
      output_format: 'pcm_16000',
    });

    const req = request(
      {
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${voiceId}`,
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Accept': 'audio/wav',
        },
        timeout: 30000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          if (isAborted()) {
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (isAborted()) {
            reject(new Error('Aborted'));
            return;
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks));
          } else {
            const errorBody = Buffer.concat(chunks).toString('utf-8');
            reject(
              new Error(
                `ElevenLabs API error ${res.statusCode}: ${errorBody.slice(0, 200)}`,
              ),
            );
          }
        });
        res.on('error', reject);
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ElevenLabs API timeout (30s)'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Valida a chave de API listando vozes.
 */
function validateApiKey(apiKey: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = request(
      {
        hostname: 'api.elevenlabs.io',
        path: '/v1/voices',
        method: 'GET',
        headers: { 'xi-api-key': apiKey },
        timeout: 10000,
      },
      (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`ElevenLabs API returned ${res.statusCode}`));
        }
        res.resume();
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ElevenLabs validation timeout'));
    });
    req.end();
  });
}

export default ElevenLabsTtsProvider;
