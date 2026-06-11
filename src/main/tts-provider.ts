/**
 * tts-provider.ts - Interface de provedor TTS
 *
 * Define o contrato que todos os provedores TTS (Edge, ElevenLabs, etc.)
 * devem implementar. Permite hot-swap em tempo de execução.
 */

import { EventEmitter } from 'events';

/** Opções para síntese de voz */
export interface TtsOptions {
  /** Texto a ser sintetizado */
  text: string;
  /** Código do idioma (ex: 'pt-BR', 'en-US', 'en') */
  lang: string;
}

/** Metadados sobre um provedor TTS */
export interface TtsProviderInfo {
  /** Nome legível do provedor */
  name: string;
  /** Se requer chave de API */
  needsApiKey: boolean;
  /** Se tem chave configurada */
  hasApiKey: boolean;
}

/**
 * Interface base para provedores TTS.
 *
 * Cada provedor deve:
 * - Estender EventEmitter
 * - Emitir 'audio' com (buffer: Buffer, text: string) quando áudio gerado
 * - Emitir 'started' com (text: string) quando começar
 * - Emitir 'finished' com (text: string) quando terminar
 * - Emitir 'error' com (error: Error) em caso de falha
 */
export abstract class TtsProvider extends EventEmitter {
  /** Nome do provedor (ex: 'Edge', 'ElevenLabs') */
  abstract readonly name: string;

  /**
   * Inicializa o provedor (abre conexões, carrega worker, etc.).
   * Chamado uma vez na inicialização ou no hot-swap.
   */
  abstract init(): Promise<void>;

  /**
   * Sintetiza texto em áudio.
   * Deve emitir 'audio' com o buffer resultante.
   *
   * @param options - Opções de síntese
   */
  abstract speak(options: TtsOptions): Promise<void>;

  /**
   * Interrompe a síntese em andamento.
   */
  abstract stop(): void;

  /**
   * Libera recursos do provedor.
   */
  abstract dispose(): void;

  /**
   * Retorna metadados do provedor.
   */
  getInfo(): TtsProviderInfo {
    return {
      name: this.name,
      needsApiKey: false,
      hasApiKey: true,
    };
  }
}

export default TtsProvider;
