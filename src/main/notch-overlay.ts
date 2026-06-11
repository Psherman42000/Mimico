/** notch-overlay.ts - Notch Overlay (pílula expansível no topo-centro) */

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

/** Gerenciador do notch overlay (colapsado/expandido, auto-collapse, click-through). */
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

  private sendInitState(): void {
    this.sendToRenderer('notch-init', {
      mode: this.currentMode,
      ttsProvider: this.ttsProvider,
      voiceActive: this.voiceActive,
      mixMode: this.mixMode,
    });
  }

  // ── Estado colapsado/expandido ──

  private setCollapsed(): void {
    this.isExpanded = false;
    const bounds = this.getAlignedBounds(false);
    this.window?.setBounds(bounds, true);
    applyNotchShape(this.window!, false);
  }

  private setExpanded(): void {
    this.isExpanded = true;
    const bounds = this.getAlignedBounds(true);
    this.window?.setBounds(bounds, true);
    applyNotchShape(this.window!, true);
  }

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

  clearText(): void {
    this.lastText = { en: '', pt: '' };

    if (!this.window || this.window.isDestroyed()) return;

    this.sendToRenderer('notch-clear');
    this.scheduleCollapse();
  }

  // ── Atualizações de estado ──

  setMode(mode: AppMode): void {
    this.currentMode = mode;
    this.sendToRenderer('notch-mode', mode);
  }

  setTtsProvider(provider: string): void {
    this.ttsProvider = provider;
    this.sendToRenderer('notch-tts', provider);
  }

  setVoiceActive(active: boolean): void {
    this.voiceActive = active;
    this.sendToRenderer('notch-voice', active);
  }

  setMixMode(mode: 'replace' | 'overlay'): void {
    this.mixMode = mode;
    this.sendToRenderer('notch-mix', mode);
  }

  setConnecting(visible: boolean): void {
    this.sendToRenderer('notch-connecting', visible);
  }

  // ── Controles de janela ──

  setOpacity(value: number): void {
    this.opacity = Math.max(0, Math.min(1, value));
    this.window?.setOpacity(this.opacity);
  }

  getOpacity(): number {
    return this.opacity;
  }

  show(): void {
    this.isShown = true;
    this.window?.show();
    this.window?.setOpacity(this.opacity);
  }

  hide(): void {
    this.isShown = false;
    this.window?.hide();
  }

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

  private getAlignedBounds(expanded: boolean): Electron.Rectangle {
    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;

    const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
    const height = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
    const x = workArea.x + Math.round((workArea.width - width) / 2);
    const y = workArea.y + TOP_MARGIN;

    return { x, y, width, height };
  }

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

  dispose(): void {
    this.close();
  }
}

export default NotchOverlay;
