/** ipc/index.ts - Orquestrador de handlers IPC */

import { registerConfigHandlers, ConfigIpcContext } from './config';
import { registerWindowHandlers, WindowIpcContext } from './window';
import { registerAudioHandlers, AudioIpcContext } from './audio';
import { registerTranscriptionHandlers, TranscriptionIpcContext } from './transcription';
import { registerTranslationHandlers, TranslationIpcContext } from './translation';
import { registerTtsHandlers, TtsIpcContext } from './tts';

export interface AllIpcContext extends
  ConfigIpcContext,
  WindowIpcContext,
  AudioIpcContext,
  TranscriptionIpcContext,
  TranslationIpcContext,
  TtsIpcContext {}

/**
 * Registra todos os handlers IPC do aplicativo.
 * Chamado uma vez na inicialização.
 *
 * @param ctx - Contexto com referências para todos os módulos
 */
export function registerAllIpcHandlers(ctx: AllIpcContext): void {
  registerConfigHandlers(ctx);
  registerWindowHandlers(ctx);
  registerAudioHandlers(ctx);
  registerTranscriptionHandlers(ctx);
  registerTranslationHandlers(ctx);
  registerTtsHandlers(ctx);
}

export default registerAllIpcHandlers;
