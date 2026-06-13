/** display-layout.ts — Tipos para layout de display */

import { Display } from 'electron';

/** Retângulo com posição e tamanho */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Obtém a área de trabalho de um display */
export function getDisplayWorkArea(display: Display): Rect {
  return display.workArea;
}
