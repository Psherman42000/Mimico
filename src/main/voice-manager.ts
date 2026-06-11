/**
 * voice-manager.ts - Facade de gerenciamento de síntese de voz
 *
 * Delega para o TtsProvider ativo (Edge ou ElevenLabs).
 * Permite hot-swap entre provedores em tempo de execução.
 *
 * Eventos emitidos:
 * - 'started': Início da síntese
 * - 'finished': Síntese concluída
 * - 'error': Erro na síntese
 * - 'audio': Buffer WAV/PCM com o áudio
 */

import { EventEmitter } from 'events';
import { TtsProvider } from './tts-provider';

/**
 * Facade que gerencia o provedor TTS ativo.
 * Delega speak/stop/dispose para o provider atual.
 */
export class VoiceManager extends EventEmitter {
  private provider: TtsProvider | null = null;
  private speaking = false;

  /**
   * Define o provedor TTS ativo.
   * Para o anterior se existir, inicializa o novo.
   *
   * @param provider - Nova instância de TtsProvider
   */
  async setProvider(provider: TtsProvider): Promise<void> {
    // Para o provider anterior
    if (this.provider) {
      this.provider.stop();
      this.provider.removeAllListeners();
    }

    this.provider = provider;

    // Encaminha eventos do provider como eventos do VoiceManager
    this.provider.on('started', (text: string) => {
      this.speaking = true;
      this.emit('started', text);
    });

    this.provider.on('finished', (text: string) => {
      this.speaking = false;
      this.emit('finished', text);
    });

    this.provider.on('error', (error: Error) => {
      this.speaking = false;
      this.emit('error', error);
    });

    this.provider.on('audio', (buffer: Buffer, text: string) => {
      this.emit('audio', buffer, text);
    });

    // Inicializa
    try {
      await this.provider.init();
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Retorna o provider ativo.
   */
  getProvider(): TtsProvider | null {
    return this.provider;
  }

  /**
   * Retorna o nome do provider ativo.
   */
  getProviderName(): string {
    return this.provider?.name ?? 'Nenhum';
  }

  /**
   * Sintetiza texto em áudio usando o provider ativo.
   *
   * @param text - Texto a ser sintetizado
   * @param lang - Código do idioma (ex: 'pt-BR', 'en-US')
   * @throws Se não houver provider configurado
   */
  async speakText(text: string, lang: string = 'pt-BR'): Promise<void> {
    if (!this.provider) {
      throw new Error('No TTS provider configured');
    }
    await this.provider.speak({ text, lang });
  }

  /**
   * Interrompe a síntese em andamento.
   */
  stop(): void {
    this.provider?.stop();
    this.speaking = false;
  }

  /**
   * Verifica se está sintetizando no momento.
   */
  get isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Libera recursos.
   */
  dispose(): void {
    if (this.provider) {
      this.provider.dispose();
      this.provider = null;
    }
    this.removeAllListeners();
    this.speaking = false;
  }
}

export default VoiceManager;
