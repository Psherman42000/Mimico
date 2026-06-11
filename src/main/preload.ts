/** preload.ts - Ponte de segurança entre main e renderer */

import { contextBridge, ipcRenderer } from 'electron';

/** Nome do canal IPC para eventos de transcrição */
const IPC_TRANSCRIPTION = 'transcription';
/** Nome do canal IPC para toggle liga/desliga */
const IPC_TOGGLE = 'toggle';
/** Nome do canal IPC para notificação de mudança de config */
const IPC_CONFIG_CHANGED = 'config-changed';

/**
 * Interface da API exposta ao renderer via window.mimicoAPI.
 */
export interface MimicoAPI {
  /** Registra callback para receber transcrições EN + PT */
  onTranscription: (callback: (data: { en: string; pt: string }) => void) => void;
  /** Registra callback para mudanças de estado ligado/desligado */
  onToggle: (callback: (enabled: boolean) => void) => void;
  /** Registra callback para alterações na configuração */
  onConfigChanged: (callback: (config: Record<string, unknown>) => void) => void;
  /** Obtém a configuração atual via IPC síncrono */
  getConfig: () => Record<string, unknown>;
  /** Salva alterações parciais na configuração */
  saveConfig: (partial: Record<string, unknown>) => void;
  /** Minimiza a janela principal */
  minimize: () => void;
  /** Fecha a janela principal (envia para bandeja) */
  close: () => void;
  /** Retorna a plataforma atual ('win32') */
  getPlatform: () => string;
}

/**
 * Expõe a API segura para o renderer.
 * Nenhum objeto Node.js/Electron cru é vazado.
 */
contextBridge.exposeInMainWorld('mimicoAPI', {
  /**
   * Escuta eventos de transcrição vindos do processo main.
   * O callback recebe um objeto { en: string, pt: string }.
   */
  onTranscription: (callback: (data: { en: string; pt: string }) => void): void => {
    ipcRenderer.on(IPC_TRANSCRIPTION, (_event, data: { en: string; pt: string }) => {
      callback(data);
    });
  },

  /**
   * Escuta eventos de toggle liga/desliga.
   * O callback recebe um booleano indicando o novo estado.
   */
  onToggle: (callback: (enabled: boolean) => void): void => {
    ipcRenderer.on(IPC_TOGGLE, (_event, enabled: boolean) => {
      callback(enabled);
    });
  },

  /**
   * Escuta eventos de alteração na configuração.
   * O callback recebe o objeto de configuração atualizado.
   */
  onConfigChanged: (callback: (config: Record<string, unknown>) => void): void => {
    ipcRenderer.on(IPC_CONFIG_CHANGED, (_event, config: Record<string, unknown>) => {
      callback(config);
    });
  },

  /**
   * Solicita a configuração atual ao processo main (síncrono).
   * Usa ipcRenderer.sendSync para retorno imediato.
   */
  getConfig: (): Record<string, unknown> => {
    return ipcRenderer.sendSync('get-config');
  },

  saveConfig: (partial: Record<string, unknown>): void => {
    ipcRenderer.send('save-config', partial);
  },

  minimize: (): void => {
    ipcRenderer.send('minimize-window');
  },

  close: (): void => {
    ipcRenderer.send('close-window');
  },

  getPlatform: (): string => {
    return process.platform;
  },
} satisfies MimicoAPI);
