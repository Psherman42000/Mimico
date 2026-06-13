/** win32-notch.ts - Forma nativa Windows para o notch overlay */

import { BrowserWindow } from 'electron';

const COLLAPSED_WIDTH = 300;
const COLLAPSED_HEIGHT = 34;
const EXPANDED_WIDTH = 450;
const EXPANDED_HEIGHT = 320;

function getCollapsedNotchShape(win: BrowserWindow): Electron.Rectangle[] {
  const bounds = win.getBounds();
  const width = Math.min(COLLAPSED_WIDTH, bounds.width);
  const height = Math.min(COLLAPSED_HEIGHT, bounds.height);
  const x = Math.round((bounds.width - width) / 2);
  return [{ x, y: 0, width, height }];
}

function getExpandedNotchShape(win: BrowserWindow): Electron.Rectangle[] {
  const bounds = win.getBounds();
  const width = Math.min(EXPANDED_WIDTH, bounds.width);
  const height = Math.min(EXPANDED_HEIGHT, bounds.height);
  const x = Math.round((bounds.width - width) / 2);
  return [{ x, y: 0, width, height }];
}

/** Aplica click-through fora da área do notch */
export function applyNotchShape(win: BrowserWindow, expanded: boolean): void {
  try {
    if (win.isDestroyed()) return;
    const shape = expanded ? getExpandedNotchShape(win) : getCollapsedNotchShape(win);
    win.setShape(shape);
  } catch (error) {
    console.error('[NotchShape] Failed to set shape:', error);
  }
}
