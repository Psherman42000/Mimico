/**
 * overlay.ts - Janela overlay transparente para legendas
 *
 * Cria uma BrowserWindow transparente, sempre no topo, sem moldura,
 * que ignora cliques do mouse (click-through). Exibe legendas:
 * - Texto original (EN) em ciano (#00ffff)
 * - Tradução (PT) em verde (#00ff00)
 * - Fundo preto semi-transparente
 *
 * Comportamento:
 * - Auto-fade quando silêncio > 3 segundos
 * - Atualização de texto via IPC
 * - Posicionamento: canto inferior direito (configurável)
 */

import { BrowserWindow, ipcMain, screen } from 'electron';
import { resolve } from 'path';

/** Tempo de auto-fade em milissegundos (3s de silêncio) */
const FADE_TIMEOUT_MS = 3000;

/** Largura padrão da janela overlay */
const OVERLAY_WIDTH = 800;

/** Altura padrão da janela overlay */
const OVERLAY_HEIGHT = 200;

/** Margem inferior em pixels */
const MARGIN_BOTTOM = 80;

/** Margem direita em pixels */
const MARGIN_RIGHT = 20;

/**
 * HTML inline para o overlay de legendas.
 *
 * Inclui CSS com:
 * - Fundo preto semi-transparente (rgba(0,0,0,0.7))
 * - Texto EN em ciano (#00ffff)
 * - Texto PT em verde (#00ff00)
 * - Transições suaves para fade in/out
 * - Fonte sans-serif grande e legível
 */
const OVERLAY_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    background-color: rgba(0, 0, 0, 0.7);
    color: white;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 16px 24px;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
    transition: opacity 0.5s ease;
    opacity: 1;
  }

  body.faded {
    opacity: 0;
  }

  .text-en {
    color: #00ffff;
    font-size: 22px;
    font-weight: 500;
    text-align: center;
    width: 100%;
    margin-bottom: 8px;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
    line-height: 1.3;
    word-wrap: break-word;
  }

  .text-pt {
    color: #00ff00;
    font-size: 28px;
    font-weight: 600;
    text-align: center;
    width: 100%;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
    line-height: 1.3;
    word-wrap: break-word;
  }

  .placeholder {
    color: rgba(255, 255, 255, 0.3);
    font-size: 18px;
    font-style: italic;
  }
</style>
</head>
<body>
  <div id="text-en" class="text-en placeholder">🎤 Aguardando áudio...</div>
  <div id="text-pt" class="text-pt placeholder">Tradução aparecerá aqui</div>

<script>
  const { ipcRenderer } = require('electron');

  const textEnEl = document.getElementById('text-en');
  const textPtEl = document.getElementById('text-pt');
  let fadeTimer = null;

  /**
   * Atualiza o texto das legendas via IPC.
   * Reseta o timer de auto-fade.
   */
  ipcRenderer.on('update-subtitles', (_event, data) => {
    if (data.en) {
      textEnEl.textContent = data.en;
      textEnEl.classList.remove('placeholder');
    }
    if (data.pt) {
      textPtEl.textContent = data.pt;
      textPtEl.classList.remove('placeholder');
    }

    // Mostra o overlay
    document.body.classList.remove('faded');

    // Reinicia o timer de fade
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      document.body.classList.add('faded');
    }, ${FADE_TIMEOUT_MS});
  });

  /**
   * Limpa as legendas e mostra placeholder.
   */
  ipcRenderer.on('clear-subtitles', () => {
    textEnEl.textContent = '🎤 Aguardando áudio...';
    textPtEl.textContent = 'Tradução aparecerá aqui';
    textEnEl.classList.add('placeholder');
    textPtEl.classList.add('placeholder');
  });
</script>
</body>
</html>`;

/**
 * Gerenciador da janela overlay de legendas.
 *
 * Cria e gerencia o ciclo de vida da janela transparente que exibe
 * as legendas em tempo real com auto-fade.
 */
export class Overlay {
  /** Instância da BrowserWindow */
  private window: BrowserWindow | null = null;

  /** Timer para auto-fade */
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Último texto exibido */
  private lastText: { en: string; pt: string } = { en: '', pt: '' };

  /** Opacidade configurada */
  private opacity: number = 0.85;

  /**
   * Cria e exibe a janela overlay.
   *
   * A janela é:
   * - Transparente (background: rgba(0,0,0,0.7))
   * - Sem moldura (frame: false)
   * - Sempre no topo (alwaysOnTop: true)
   * - Sem foco (skipTaskbar: true, focusable: false)
   * - Click-through (via win32-overlay.ts)
   *
   * @param opacity - Opacidade inicial (0.0 - 1.0)
   */
  async create(opacity: number = 0.85): Promise<void> {
    this.opacity = opacity;

    // Obtém o display primário para posicionamento
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // Posiciona no canto inferior direito
    const x = screenWidth - OVERLAY_WIDTH - MARGIN_RIGHT;
    const y = screenHeight - OVERLAY_HEIGHT - MARGIN_BOTTOM;

    this.window = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      x,
      y,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      hasShadow: false,
      type: 'toolbar',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        preload: resolve(__dirname, 'preload.js'),
      },
    });

    // Carrega o HTML inline
    this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);

    // Configura opacidade
    this.window.setOpacity(this.opacity);

    // Previne que a janela receba foco
    this.window.on('blur', () => {
      // Mantém sempre no topo mesmo quando outras janelas são focadas
    });

    // Aplica click-through via win32-overlay (após a janela ser criada)
    this.window.once('ready-to-show', () => {
      const hwnd = this.getHWND();
      if (hwnd) {
        this.applyClickThrough(hwnd);
      }
    });

    // Configura IPC para receber atualizações de legenda
    this.setupIPC();
  }

  /**
   * Configura os listeners IPC para atualização das legendas.
   */
  private setupIPC(): void {
    // Permitir que o main.ts envie atualizações via webContents
  }

  /**
   * Obtém o HWND da janela overlay.
   *
   * @returns HWND como número, ou null se a janela não existir
   */
  private getHWND(): number | null {
    if (!this.window) return null;
    try {
      const win: any = this.window;
      const nativeWindow = win.getNativeWindowHandle?.() as Buffer | undefined;
      if (nativeWindow) {
        return nativeWindow.readUInt32LE(0);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Aplica click-through usando win32-overlay.
   */
  private async applyClickThrough(hwnd: number): Promise<void> {
    try {
      const { makeClickThrough } = await import('./win32-overlay');
      await makeClickThrough(hwnd);
    } catch (error) {
      console.error('[Overlay] Failed to apply click-through:', error);
    }
  }

  /**
   * Atualiza o texto exibido no overlay.
   *
   @param en - Texto original em inglês
   * @param pt - Texto traduzido em português
   */
  updateText(en: string, pt: string): void {
    this.lastText = { en, pt };

    if (!this.window || this.window.isDestroyed()) return;

    // Envia para o renderer via IPC
    this.window.webContents.send('update-subtitles', { en, pt });

    // Reseta o timer de auto-fade
    this.resetFadeTimer();
  }

  /**
   * Limpa as legendas exibidas e mostra placeholder.
   */
  clearText(): void {
    this.lastText = { en: '', pt: '' };

    if (!this.window || this.window.isDestroyed()) return;

    this.window.webContents.send('clear-subtitles');
  }

  /**
   * Reseta o timer de auto-fade.
   *
   * O overlay desaparece gradualmente após FADE_TIMEOUT_MS
   * sem novas atualizações de texto.
   */
  private resetFadeTimer(): void {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
    }

    this.fadeTimer = setTimeout(() => {
      this.clearText();
    }, FADE_TIMEOUT_MS);
  }

  /**
   * Define a opacidade da janela overlay.
   *
   * @param value - Opacidade entre 0.0 (invisível) e 1.0 (opaco)
   */
  setOpacity(value: number): void {
    this.opacity = Math.max(0, Math.min(1, value));
    this.window?.setOpacity(this.opacity);
  }

  /**
   * Obtém a opacidade atual.
   */
  getOpacity(): number {
    return this.opacity;
  }

  /**
   * Mostra o overlay (se estiver oculto).
   */
  show(): void {
    this.window?.show();
    this.window?.setOpacity(this.opacity);
  }

  /**
   * Oculta o overlay.
   */
  hide(): void {
    this.window?.hide();
  }

  /**
   * Verifica se o overlay está visível.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /**
   * Reposiciona o overlay no canto inferior direito.
   * Útil quando a resolução da tela muda.
   */
  reposition(): void {
    if (!this.window || this.window.isDestroyed()) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const x = screenWidth - OVERLAY_WIDTH - MARGIN_RIGHT;
    const y = screenHeight - OVERLAY_HEIGHT - MARGIN_BOTTOM;

    this.window.setPosition(x, y);
  }

  /**
   * Fecha a janela overlay e libera recursos.
   */
  close(): void {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
  }

  /**
   * Libera recursos.
   */
  dispose(): void {
    this.close();
  }
}

export default Overlay;
