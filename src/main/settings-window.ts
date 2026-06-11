/** settings-window.ts - Janela de configurações do Mimico */

import { BrowserWindow, screen } from 'electron';
import { resolve } from 'path';
import type { Rect } from './display-layout';

/** Largura padrão da janela */
const DEFAULT_WIDTH = 780;

/** Altura padrão da janela */
const DEFAULT_HEIGHT = 540;

/** Largura mínima */
const MIN_WIDTH = 620;

/** Altura mínima */
const MIN_HEIGHT = 460;

/** Largura máxima (percentual do workArea) */
const MAX_WIDTH_RATIO = 0.85;

/** Altura máxima (percentual do workArea) */
const MAX_HEIGHT_RATIO = 0.85;

/**
 * Gerenciador da janela de configurações.
 *
 * Abre como janela independente (não modal), persistindo posição.
 * Feed de tradução ao vivo via IPC push do main.ts.
 */
export class SettingsWindow {
  private window: BrowserWindow | null = null;
  private lastBounds: Rect | null = null;

  /**
   * Cria e retorna a janela de configurações.
   * Se já existir, apenas mostra e foca.
   *
   * @returns Instância da BrowserWindow
   */
  create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return this.window;
    }

    // Calcula dimensões ideais
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    const width = Math.min(
      DEFAULT_WIDTH,
      Math.round(workArea.width * MAX_WIDTH_RATIO),
      Math.max(MIN_WIDTH, workArea.width - 80),
    );

    const height = Math.min(
      DEFAULT_HEIGHT,
      Math.round(workArea.height * MAX_HEIGHT_RATIO),
      Math.max(MIN_HEIGHT, workArea.height - 140),
    );

    // Centraliza no display
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + (workArea.height - height) / 2);

    this.window = new BrowserWindow({
      width,
      height,
      x,
      y,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: 'Mimico — Configurações',
      frame: true,
      autoHideMenuBar: true,
      skipTaskbar: true,
      resizable: true,
      show: false,
      backgroundColor: '#0a0a0b',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        preload: resolve(__dirname, 'preload.js'),
      },
    });

    // Carrega HTML
    const htmlPath = resolve(__dirname, 'settings.html');
    this.window.loadFile(htmlPath);

    // Mostra quando pronto
    this.window.once('ready-to-show', () => {
      this.window?.show();
    });

    // Persiste posição ao mover
    this.window.on('move', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.lastBounds = this.window.getBounds();
      }
    });

    // Persiste posição ao redimensionar
    this.window.on('resize', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.lastBounds = this.window.getBounds();
      }
    });

    // Fecha sem destruir (apenas esconde)
    this.window.on('close', (event) => {
      if (!this.window?.isDestroyed()) {
        event.preventDefault();
        this.window?.hide();
      }
    });

    return this.window;
  }

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
    } else {
      this.create();
    }
  }

  hide(): void {
    this.window?.hide();
  }

  toggle(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /**
   * Retorna os bounds atuais (para persistir posição).
   */
  getBounds(): Rect | null {
    if (this.window && !this.window.isDestroyed()) {
      return this.window.getBounds();
    }
    return this.lastBounds;
  }

  /**
   * Fecha e destrói a janela.
   */
  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.removeAllListeners('close');
      this.window.close();
    }
    this.window = null;
  }

  dispose(): void {
    this.close();
  }
}

export default SettingsWindow;
