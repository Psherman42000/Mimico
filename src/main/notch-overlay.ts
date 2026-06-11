/**
 * notch-overlay.ts - Notch Overlay (pílula expansível no topo-centro)
 *
 * Substitui o overlay.ts tradicional por um notch estilo Perssua:
 * - Colapsado: pílula 300x34px no topo-centro da tela
 * - Expandido: painel ~450x320px com feed de tradução + sidebar
 * - Auto-expand ao receber tradução, auto-collapse após 5s silêncio
 * - Animação spring-style via CSS transitions
 * - Win32 click-through via win.setShape()
 */

import { BrowserWindow, ipcMain, screen } from 'electron';
import { resolve } from 'path';
import { applyNotchShape } from './win32-notch';
import { DisplayTopologyCoordinator, normalizeWindowZoom } from './display-layout';

/** Dimensões do notch */
const COLLAPSED_WIDTH = 300;
const COLLAPSED_HEIGHT = 34;
const EXPANDED_WIDTH = 450;
const EXPANDED_HEIGHT = 320;

/** Distância do topo */
const TOP_MARGIN = 0;

/** Tempo de auto-collapse (ms) */
const AUTO_COLLAPSE_MS = 5000;

/** Estado de modo */
type AppMode = 'off' | 'subtitles' | 'voice';

/**
 * Gerenciador do notch overlay.
 *
 * Comportamento:
 * - Colapsado: pílula 300x34 no topo, bolinha verde
 * - Expandido: painel com status bar + feed de tradução + 3 abas
 * - Auto-expand na chegada de tradução
 * - Auto-collapse após AUTO_COLLAPSE_MS sem tradução
 * - Click-through via win.setShape()
 * - Multi-monitor via DisplayTopologyCoordinator
 */
export class NotchOverlay {
  private window: BrowserWindow | null = null;
  private isExpanded = false;
  private isShown = true;
  private opacity = 0.85;
  private currentMode: AppMode = 'subtitles';
  private ttsProvider = 'Edge';
  private voiceActive = false;
  private mixMode: 'replace' | 'overlay' = 'replace';
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;
  private lastText: { en: string; pt: string } = { en: '', pt: '' };
  private displayCoordinator: DisplayTopologyCoordinator | null = null;

  /**
   * Cria e exibe a janela do notch overlay.
   *
   * @param opacity - Opacidade inicial (0.0 - 1.0)
   */
  async create(opacity: number = 0.85): Promise<void> {
    this.opacity = opacity;

    // Obtém o display primário
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    // Posiciona no topo-centro
    const x = workArea.x + Math.round((workArea.width - COLLAPSED_WIDTH) / 2);
    const y = workArea.y + TOP_MARGIN;

    this.window = new BrowserWindow({
      width: EXPANDED_WIDTH,
      height: EXPANDED_HEIGHT,
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

    // Carrega o HTML do notch
    const htmlPath = resolve(__dirname, 'notch.html');
    await this.window.loadFile(htmlPath);

    // Configura opacidade
    this.window.setOpacity(this.opacity);

    // Inicia colapsado
    this.window.once('ready-to-show', () => {
      this.setCollapsed();
    });

    // Configura IPC
    this.setupIPC();

    // Inicia coordenador de display
    this.displayCoordinator = new DisplayTopologyCoordinator();
    this.displayCoordinator.registerWindow('notch', this.window);
    this.displayCoordinator.onDisplayChanged(() => {
      this.reposition();
    });
    this.displayCoordinator.start();

    // Envia estado inicial
    this.sendInitState();
  }

  /**
   * Configura os listeners IPC.
   */
  private setupIPC(): void {
    ipcMain.on('notch-toggle-voice', (_event, active: boolean) => {
      this.voiceActive = active;
      this.sendToRenderer('notch-voice', active);
      // O main.ts escuta esse canal externamente via método público
      if (this.onToggleVoice) {
        this.onToggleVoice(active);
      }
    });
  }

  /** Callback externo para toggle de voz */
  onToggleVoice: ((active: boolean) => void) | null = null;

  /**
   * Envia estado inicial para o renderer.
   */
  private sendInitState(): void {
    this.sendToRenderer('notch-init', {
      mode: this.currentMode,
      ttsProvider: this.ttsProvider,
      voiceActive: this.voiceActive,
      mixMode: this.mixMode,
    });
  }

  // ── Estado colapsado/expandido ──

  /**
   * Colapsa o notch (pílula pequena).
   */
  private setCollapsed(): void {
    this.isExpanded = false;
    const bounds = this.getAlignedBounds(false);
    this.window?.setBounds(bounds, true);
    applyNotchShape(this.window!, false);
  }

  /**
   * Expande o notch (painel completo).
   */
  private setExpanded(): void {
    this.isExpanded = true;
    const bounds = this.getAlignedBounds(true);
    this.window?.setBounds(bounds, true);
    applyNotchShape(this.window!, true);
  }

  /**
   * Alterna entre expandido e colapsado.
   */
  toggleExpand(): void {
    if (this.isExpanded) {
      this.setCollapsed();
    } else {
      this.setExpanded();
    }
  }

  /**
   * Agenda o auto-collapse após AUTO_COLLAPSE_MS.
   */
  private scheduleCollapse(): void {
    if (this.collapseTimer) clearTimeout(this.collapseTimer);
    this.collapseTimer = setTimeout(() => {
      if (this.isExpanded) {
        // Só colapsa se não houver toggle de voz ativo (modo voice mantém expandido)
        if (this.currentMode !== 'voice' || !this.voiceActive) {
          this.setCollapsed();
          this.sendToRenderer('notch-collapsed');
        }
      }
    }, AUTO_COLLAPSE_MS);
  }

  // ── Atualizações de tradução ──

  /**
   * Atualiza o texto exibido no feed de tradução.
   * Auto-expande o notch se estiver colapsado.
   */
  updateText(en: string, pt: string): void {
    this.lastText = { en, pt };

    if (!this.window || this.window.isDestroyed()) return;

    // Se colapsado, expande
    if (!this.isExpanded) {
      this.setExpanded();
    }

    // Envia para o renderer
    this.sendToRenderer('notch-translation', { en, pt });

    // Reseta timer de auto-collapse
    this.scheduleCollapse();
  }

  /**
   * Limpa o feed de tradução.
   */
  clearText(): void {
    this.lastText = { en: '', pt: '' };

    if (!this.window || this.window.isDestroyed()) return;

    this.sendToRenderer('notch-clear');
    this.scheduleCollapse();
  }

  // ── Atualizações de estado ──

  /**
   * Atualiza o modo de operação (off/subtitles/voice).
   */
  setMode(mode: AppMode): void {
    this.currentMode = mode;
    this.sendToRenderer('notch-mode', mode);
  }

  /**
   * Atualiza o provider TTS (Edge / ElevenLabs).
   */
  setTtsProvider(provider: string): void {
    this.ttsProvider = provider;
    this.sendToRenderer('notch-tts', provider);
  }

  /**
   * Atualiza o estado do toggle de voz.
   */
  setVoiceActive(active: boolean): void {
    this.voiceActive = active;
    this.sendToRenderer('notch-voice', active);
  }

  /**
   * Atualiza o modo de mix (replace/overlay).
   */
  setMixMode(mode: 'replace' | 'overlay'): void {
    this.mixMode = mode;
    this.sendToRenderer('notch-mix', mode);
  }

  /**
   * Mostra/esconde o overlay de "conectando...".
   */
  setConnecting(visible: boolean): void {
    this.sendToRenderer('notch-connecting', visible);
  }

  // ── Controles de janela ──

  /**
   * Define a opacidade da janela.
   */
  setOpacity(value: number): void {
    this.opacity = Math.max(0, Math.min(1, value));
    this.window?.setOpacity(this.opacity);
  }

  /**
   * Retorna a opacidade atual.
   */
  getOpacity(): number {
    return this.opacity;
  }

  /**
   * Mostra o notch.
   */
  show(): void {
    this.isShown = true;
    this.window?.show();
    this.window?.setOpacity(this.opacity);
  }

  /**
   * Oculta o notch.
   */
  hide(): void {
    this.isShown = false;
    this.window?.hide();
  }

  /**
   * Verifica se o notch está visível.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /**
   * Reposiciona o notch no topo-centro do display primário.
   * Útil quando a resolução ou configuração de monitores muda.
   */
  reposition(): void {
    if (!this.window || this.window.isDestroyed()) return;

    const bounds = this.getAlignedBounds(this.isExpanded);
    this.window.setBounds(bounds, true);
    applyNotchShape(this.window!, this.isExpanded);
    normalizeWindowZoom(this.window);
  }

  /**
   * Calcula bounds alinhados ao topo-centro do display primário.
   */
  private getAlignedBounds(expanded: boolean): Electron.Rectangle {
    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;

    const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
    const height = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
    const x = workArea.x + Math.round((workArea.width - width) / 2);
    const y = workArea.y + TOP_MARGIN;

    return { x, y, width, height };
  }

  /**
   * Envia uma mensagem IPC para o renderer do notch.
   */
  private sendToRenderer(channel: string, data?: unknown): void {
    if (!this.window || this.window.isDestroyed()) return;
    try {
      this.window.webContents.send(channel, data);
    } catch {
      // Janela pode ter sido destruída
    }
  }

  /**
   * Fecha a janela e libera recursos.
   */
  close(): void {
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }

    if (this.displayCoordinator) {
      this.displayCoordinator.dispose();
      this.displayCoordinator = null;
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
  }

  /**
   * Libera recursos (alias para close).
   */
  dispose(): void {
    this.close();
  }
}

export default NotchOverlay;
