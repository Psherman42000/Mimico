/**
 * tray.ts - Ícone e menu da bandeja do sistema
 *
 * Cria um ícone na bandeja do Windows com as seguintes opções:
 * - Toggle ON/OFF: Liga/desliga a captura e transcrição
 * - Separador
 * - Configurações: Abre a janela de configurações
 * - Separador
 * - Sair: Encerra o aplicativo completamente
 *
 * O ícone nativo é gerado via NativeImage do Electron.
 */

import { Tray, Menu, nativeImage, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { resolve } from 'path';

/**
 * Cria um ícone de bandeja programaticamente usando NativeImage.
 *
 * Gera um bitmap 32x32 verde representando o estado ativo do Mimico.
 * Em produção, substitua por um arquivo .ico ou .png.
 *
 * @param color - Cor hexadecimal do ícone (default: '#00cc66' - verde)
 * @returns NativeImage pronto para uso no Tray
 */
function createTrayIcon(color: string = '#00cc66'): Electron.NativeImage {
  // Canvas 32x32 com um círculo verde + "M" estilizado
  // Como NativeImage não tem API de desenho direto,
  // criamos via um PNG mínimo codificado em base64
  const size = 32;
  const canvas = Buffer.alloc(size * size * 4, 0); // RGBA

  // Desenha um círculo preenchido
  const cx = size / 2;
  const cy = size / 2;
  const radius = 13;

  // Parse da cor hex para RGB
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
        canvas[idx] = b;       // BGRA (little-endian)
        canvas[idx + 1] = g;
        canvas[idx + 2] = r;
        canvas[idx + 3] = 255; // Alpha
      }
    }
  }

  // Cria NativeImage a partir do buffer raw
  const image = nativeImage.createFromBuffer(canvas, {
    width: size,
    height: size,
  });

  // Redimensiona para o tamanho padrão da bandeja (16x16)
  return image.resize({ width: 16, height: 16 });
}

/**
 * Cria e retorna o menu da bandeja do sistema.
 *
 * @param window - Referência à BrowserWindow principal (para foco/config)
 * @param isEnabled - Estado atual do toggle (ligado/desligado)
 * @param handlers - Handlers para as ações do menu
 * @returns Menu construído
 */
function buildTrayMenu(
  window: BrowserWindow | null,
  isEnabled: boolean,
  handlers: {
    onToggle: () => void;
    onSettings: () => void;
    onQuit: () => void;
  },
): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: isEnabled ? '🔊 Desligar' : '🔇 Ligar',
      click: (): void => {
        handlers.onToggle();
      },
    },
    { type: 'separator' },
    {
      label: '⚙ Configurações',
      click: (): void => {
        if (window) {
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        }
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
 *
 * Responsável por criar, atualizar e destruir o Tray,
 * além de gerenciar o menu de contexto.
 */
export class TrayManager {
  /** Instância do Tray */
  private tray: Tray | null = null;

  /** Janela principal do Electron */
  private mainWindow: BrowserWindow | null = null;

  /** Estado atual do toggle */
  private enabled = false;

  /** Handlers para ações do menu */
  private handlers: {
    onToggle: () => void;
    onSettings: () => void;
    onQuit: () => void;
  };

  constructor() {
    this.handlers = {
      onToggle: () => {},
      onSettings: () => {},
      onQuit: () => {},
    };
  }

  /**
   * Inicializa o ícone de bandeja.
   *
   * @param window - Janela principal do Electron
   * @param handlers - Funções callback para ações do menu
   */
  init(
    window: BrowserWindow,
    handlers: {
      onToggle: () => void;
      onSettings: () => void;
      onQuit: () => void;
    },
  ): void {
    this.mainWindow = window;
    this.handlers = handlers;

    // Cria o ícone (verde = ativo, mas começamos com cinza)
    const icon = createTrayIcon('#888888');
    this.tray = new Tray(icon);
    this.tray.setToolTip('Mimico - Legendas em tempo real');

    // Define o menu inicial
    this.updateMenu();

    // Clique duplo abre a janela principal
    this.tray.on('double-click', () => {
      if (window) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
    });
  }

  /**
   * Atualiza o ícone da bandeja com base no estado.
   *
   * @param enabled - true para ícone verde (ativo), false para cinza (inativo)
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const color = enabled ? '#00cc66' : '#888888';
    const icon = createTrayIcon(color);
    this.tray?.setImage(icon);
    this.tray?.setToolTip(
      enabled ? 'Mimico - Ativo' : 'Mimico - Inativo',
    );
    this.updateMenu();
  }

  /**
   * Alterna o estado ligado/desligado.
   */
  toggle(): void {
    this.setEnabled(!this.enabled);
  }

  /**
   * Obtém o estado atual.
   */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Reconstrói o menu de contexto da bandeja.
   */
  private updateMenu(): void {
    if (!this.tray) return;

    const menu = buildTrayMenu(this.mainWindow, this.enabled, this.handlers);
    this.tray.setContextMenu(menu);
  }

  /**
   * Exibe uma notificação do sistema (balão).
   *
   * @param title - Título da notificação
   * @param body - Corpo da notificação
   */
  showNotification(title: string, body: string): void {
    if (this.tray) {
      this.tray.displayBalloon({
        title,
        content: body,
      });
    }
  }

  /**
   * Remove o ícone da bandeja e libera recursos.
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

export default TrayManager;
