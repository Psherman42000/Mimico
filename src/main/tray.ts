/**
 * tray.ts - Ícone e menu da bandeja do sistema
 *
 * Cria um ícone na bandeja do Windows com as seguintes opções:
 * - 3 modos: Off / Legendas / Voz (radio-style)
 * - Configurações: Abre a janela de configurações
 * - Sair: Encerra o aplicativo completamente
 *
 * O menu é reconstruído a cada clique (sempre atualizado).
 */

import { Tray, Menu, nativeImage, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { resolve } from 'path';

/** Label do provider TTS para exibir no menu */
let currentTtsLabel = 'Edge';
/** Modo atual */
let currentMode: 'off' | 'subtitles' | 'voice' = 'subtitles';

/**
 * Cria um ícone de bandeja programaticamente usando NativeImage.
 */
function createTrayIcon(color: string = '#00cc66'): Electron.NativeImage {
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4, 0);

  const cx = size / 2;
  const cy = size / 2;
  const radius = 13;

  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        const idx = (y * size + x) * 4;
        canvas[idx] = b;
        canvas[idx + 1] = g;
        canvas[idx + 2] = r;
        canvas[idx + 3] = 255;
      }
    }
  }

  const image = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  return image.resize({ width: 16, height: 16 });
}

/**
 * Constrói o menu da bandeja com 3 modos (radio-style).
 */
function buildTrayMenu(
  window: BrowserWindow | null,
  handlers: {
    onSetMode: (mode: 'off' | 'subtitles' | 'voice') => void;
    onSettings: () => void;
    onQuit: () => void;
  },
): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '🔇 Off',
      type: 'radio',
      checked: currentMode === 'off',
      click: (): void => { handlers.onSetMode('off'); },
    },
    {
      label: '💬 Legendas',
      type: 'radio',
      checked: currentMode === 'subtitles',
      click: (): void => { handlers.onSetMode('subtitles'); },
    },
    {
      label: `🎤 Voz (${currentTtsLabel})`,
      type: 'radio',
      checked: currentMode === 'voice',
      click: (): void => { handlers.onSetMode('voice'); },
    },
    { type: 'separator' },
    {
      label: '⚙ Configurações',
      click: (): void => {
        handlers.onSettings();
      },
    },
    { type: 'separator' },
    {
      label: '❌ Sair',
      click: (): void => {
        handlers.onQuit();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}

/**
 * Gerenciador do ícone de bandeja do sistema.
 */
export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private handlers: {
    onSetMode: (mode: 'off' | 'subtitles' | 'voice') => void;
    onSettings: () => void;
    onQuit: () => void;
  };

  constructor() {
    this.handlers = {
      onSetMode: () => {},
      onSettings: () => {},
      onQuit: () => {},
    };
  }

  /**
   * Inicializa o ícone de bandeja.
   */
  init(
    window: BrowserWindow,
    mode: 'off' | 'subtitles' | 'voice' = 'subtitles',
    handlers: {
      onSetMode: (mode: 'off' | 'subtitles' | 'voice') => void;
      onSettings: () => void;
      onQuit: () => void;
    },
  ): void {
    this.mainWindow = window;
    this.handlers = handlers;
    currentMode = mode;

    const icon = createTrayIcon('#888888');
    this.tray = new Tray(icon);
    this.tray.setToolTip('Mimico - Legendas em tempo real');
    this.updateMenu();
  }

  /**
   * Define o modo atual e atualiza o menu.
   */
  setMode(mode: 'off' | 'subtitles' | 'voice'): void {
    currentMode = mode;
    this.updateMenu();

    const label = mode === 'off' ? '🔇 Off' :
      mode === 'subtitles' ? '💬 Legendas' : '🎤 Voz';
    this.tray?.setToolTip(`Mimico - ${label}`);
  }

  /**
   * Define o label do provider TTS (Edge / ElevenLabs).
   */
  setTtsLabel(label: string): void {
    currentTtsLabel = label;
    this.updateMenu();
  }

  /**
   * Atualiza o ícone conforme o modo.
   * off = cinza, subtitles/voice = verde.
   */
  setEnabled(enabled: boolean): void {
    const color = enabled ? '#00cc66' : '#888888';
    const icon = createTrayIcon(color);
    this.tray?.setImage(icon);
  }

  /**
   * Reconstrói o menu de contexto.
   */
  private updateMenu(): void {
    if (!this.tray) return;
    const menu = buildTrayMenu(this.mainWindow, this.handlers);
    this.tray.setContextMenu(menu);
  }

  /**
   * Exibe uma notificação do sistema.
   */
  showNotification(title: string, body: string): void {
    if (this.tray) {
      this.tray.displayBalloon({ title, content: body });
    }
  }

  /**
   * Remove o ícone da bandeja.
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

export default TrayManager;
