/**
 * display-layout.ts - Gerenciamento de monitores e DPI scaling
 *
 * Inspirado no DisplayTopologyCoordinator + displayLayout.js do Perssua.
 * Garante que o notch overlay se posicione corretamente em múltiplos monitores.
 */

import { screen, BrowserWindow, Display } from 'electron';

/** Retângulo com posição e tamanho */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Retorna a área de trabalho útil de um display (excluindo taskbar).
 */
export function getDisplayWorkArea(display: Display): Rect {
  return display.workArea;
}

/**
 * Retorna o fator de zoom para DPI scaling.
 * Windows: 1.0 = 96dpi (100%), 1.25 = 120dpi (125%), etc.
 */
export function getResolutionAwareZoomFactor(display: Display): number {
  return display.scaleFactor || 1;
}

/**
 * Normaliza o zoom da janela para o DPI do display atual.
 */
export function normalizeWindowZoom(win: BrowserWindow): void {
  const display = screen.getDisplayMatching(win.getBounds());
  const zoom = getResolutionAwareZoomFactor(display);
  win.webContents.setZoomFactor(zoom);
}

/**
 * Encontra o display que contém o centro do retângulo dado.
 */
export function getDisplayMatchingBounds(bounds: Rect): Display {
  return screen.getDisplayMatching(bounds);
}

/**
 * Ajusta bounds para caber dentro da área de trabalho de um display.
 */
export function fitBoundsToDisplay(bounds: Rect, display: Display): Rect {
  const workArea = getDisplayWorkArea(display);
  return {
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - bounds.height)),
    width: Math.min(bounds.width, workArea.width),
    height: Math.min(bounds.height, workArea.height),
  };
}

/**
 * Coordenador de topologia de displays.
 * Notifica quando um monitor é adicionado/removido ou muda de resolução.
 */
export class DisplayTopologyCoordinator {
  private windows: Map<string, BrowserWindow> = new Map();
  private callbacks: Array<() => void> = [];
  private lastDisplayCount = 0;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.lastDisplayCount = screen.getAllDisplays().length;
  }

  /**
   * Registra uma janela para ser monitorada.
   */
  registerWindow(id: string, win: BrowserWindow): void {
    this.windows.set(id, win);
  }

  /**
   * Remove uma janela do monitoramento.
   */
  unregisterWindow(id: string): void {
    this.windows.delete(id);
  }

  /**
   * Registra callback para quando o display mudar.
   */
  onDisplayChanged(callback: () => void): void {
    this.callbacks.push(callback);
  }

  /**
   * Inicia o polling periódico de mudanças de display.
   * Alternativa ao 'display-metrics-changed' que nem sempre dispara.
   */
  start(): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => {
      const currentCount = screen.getAllDisplays().length;
      if (currentCount !== this.lastDisplayCount) {
        this.lastDisplayCount = currentCount;
        this.notify();
      }
    }, 2000);
  }

  /**
   * Para o polling.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Notifica todos os callbacks registrados.
   */
  notify(): void {
    for (const cb of this.callbacks) {
      try { cb(); } catch { /* ignore */ }
    }
  }

  /**
   * Libera recursos.
   */
  dispose(): void {
    this.stop();
    this.windows.clear();
    this.callbacks = [];
  }
}

export default { DisplayTopologyCoordinator, getDisplayWorkArea, getResolutionAwareZoomFactor, normalizeWindowZoom, getDisplayMatchingBounds, fitBoundsToDisplay };
