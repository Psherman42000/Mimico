/** display-layout.ts - Gerenciamento de monitores e DPI scaling */

import { screen, BrowserWindow, Display } from 'electron';

/** Retângulo com posição e tamanho */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

  registerWindow(id: string, win: BrowserWindow): void {
    this.windows.set(id, win);
  }

  unregisterWindow(id: string): void {
    this.windows.delete(id);
  }

  onDisplayChanged(callback: () => void): void {
    this.callbacks.push(callback);
  }

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

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  notify(): void {
    for (const cb of this.callbacks) {
      try { cb(); } catch { /* ignore */ }
    }
  }

  dispose(): void {
    this.stop();
    this.windows.clear();
    this.callbacks = [];
  }
}

export default { DisplayTopologyCoordinator, getDisplayWorkArea, getResolutionAwareZoomFactor, normalizeWindowZoom, getDisplayMatchingBounds, fitBoundsToDisplay };
