/**
 * config.ts - Gerenciamento de configuração do Mimico
 *
 * Usa JSON simples em app.getPath('userData') para persistir configurações.
 * Sem dependências externas, evitando problemas de tipo com electron-store.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** Interface que define o schema de configuração do Mimico */
export interface Config {
  /** Chave de autenticação da API DeepL */
  deepKey: string;
  /** Idioma alvo para tradução (código ISO, ex: 'PT', 'EN', 'ES', 'FR', 'DE') */
  language: string;
  /** Atalho global para ligar/desligar a captura */
  toggleHotkey: string;
  /** Atalho global para mostrar/esconder o overlay */
  overlayHotkey: string;
  /** Habilitar síntese de voz via Edge TTS */
  toggleVoice: boolean;
  /** Opacidade da janela overlay (0.0 = invisível, 1.0 = opaco) */
  overlayOpacity: number;
  /** Nome do dispositivo de áudio VB-Cable para saída */
  vbcableDevice: string;
  /** Tamanho do modelo Whisper (tiny, base, small, medium, large) */
  whisperModelSize: string;
}

/** Valores padrão para a configuração */
const DEFAULTS: Config = {
  deepKey: '',
  language: 'PT',
  toggleHotkey: 'Alt+Shift+M',
  overlayHotkey: 'Alt+Shift+O',
  toggleVoice: false,
  overlayOpacity: 0.85,
  vbcableDevice: 'CABLE Input',
  whisperModelSize: 'tiny',
};

/** Caminho do arquivo de configuração */
function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'mimico-config.json');
}

/** Cache em memória para evitar leitura repetida do disco */
let cachedConfig: Config | null = null;

/**
 * Carrega a configuração do disco.
 * Retorna um objeto Config com todos os valores atuais (mesclado com defaults).
 */
export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const saved = JSON.parse(data) as Partial<Config>;
      cachedConfig = { ...DEFAULTS, ...saved };
      return cachedConfig!;
    }
  } catch {
    // Arquivo corrompido ou inexistente — usa defaults
  }

  cachedConfig = { ...DEFAULTS };
  return cachedConfig;
}

/**
 * Salva um conjunto parcial de configurações no disco.
 * Apenas as chaves fornecidas em `partial` serão atualizadas.
 */
export function saveConfig(partial: Partial<Config>): void {
  const current = loadConfig();
  Object.assign(current, partial);
  cachedConfig = current;

  const configPath = getConfigPath();
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(current, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Config] Failed to save config:', err);
  }
}

/**
 * Reseta todas as configurações para os valores padrão.
 */
export function resetConfig(): void {
  cachedConfig = { ...DEFAULTS };
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  } catch {
    // Ignore
  }
}

export default { loadConfig, saveConfig, resetConfig };
