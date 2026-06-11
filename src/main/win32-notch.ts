/** win32-notch.ts - Forma nativa Windows para o notch overlay */

import { BrowserWindow } from 'electron';

/** Dimensões do notch colapsado */
const COLLAPSED_WIDTH = 300;
const COLLAPSED_HEIGHT = 34;

/** Dimensões do notch expandido */
const EXPANDED_WIDTH = 450;
const EXPANDED_HEIGHT = 320;

/**
 * Gera o array de retângulos para win.setShape() no estado colapsado.
 * Apenas a área do notch (pílula no topo-centro) recebe cliques.
 *
 * @param win - BrowserWindow do notch
 * @returns Array de retângulos para setShape
 */
export function getCollapsedNotchShape(win: BrowserWindow): Electron.Rectangle[] {
  const bounds = win.getBounds();
  const width = Math.min(COLLAPSED_WIDTH, bounds.width);
  const height = Math.min(COLLAPSED_HEIGHT, bounds.height);
  const x = Math.round((bounds.width - width) / 2);
  return [{ x, y: 0, width, height }];
}

/**
 * Gera o array de retângulos para win.setShape() no estado expandido.
 * A área clicável é toda a largura do notch expandido.
 *
 * @param win - BrowserWindow do notch
 * @returns Array de retângulos para setShape
 */
export function getExpandedNotchShape(win: BrowserWindow): Electron.Rectangle[] {
  const bounds = win.getBounds();
  const width = Math.min(EXPANDED_WIDTH, bounds.width);
  const height = Math.min(EXPANDED_HEIGHT, bounds.height);
  const x = Math.round((bounds.width - width) / 2);
  return [{ x, y: 0, width, height }];
}

/**
 * Aplica a forma nativa ao notch conforme o estado (colapsado/expandido).
 * Click-through fora da área do notch.
 *
 * @param win - BrowserWindow do notch
 * @param expanded - Se true, usa forma expandida; senão, colapsada
 */
export function applyNotchShape(win: BrowserWindow, expanded: boolean): void {
  try {
    if (win.isDestroyed()) return;

    const shape = expanded
      ? getExpandedNotchShape(win)
      : getCollapsedNotchShape(win);

    win.setShape(shape);
  } catch (error) {
    console.error('[NotchShape] Failed to set shape:', error);
  }
}

/**
 * Redefine a forma para o retângulo completo (sem recorte).
 * Usado quando o notch está em modo flutuante (não pinado).
 *
 * @param win - BrowserWindow do notch
 */
export function resetNotchShape(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) return;
    win.setShape([]);
  } catch (error) {
    console.error('[NotchShape] Failed to reset shape:', error);
  }
}

export default { getCollapsedNotchShape, getExpandedNotchShape, applyNotchShape, resetNotchShape };
