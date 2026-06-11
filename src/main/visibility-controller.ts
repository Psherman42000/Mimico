/**
 * visibility-controller.ts - Stealth Mode (Ctrl+B hold-to-fade)
 *
 * Inspirado no VisibilityShortcutController do Perssua.
 *
 * Comportamento:
 * - Tap (< 650ms): alterna notch visível/invisível (toggle)
 * - Hold (> 650ms): reduz opacidade gradualmente (0.85 → 0.25)
 * - Soltar durante hold: restaura opacidade imediatamente
 * - Soltar após tap: mantém estado (toggle)
 *
 * Integração com tray menu:
 * - Item "👁 Stealth" com submenu (Tap/Hold)
 * - CSS custom property para modais acompanharem o fade
 */

import { globalShortcut } from 'electron';

/** Delay máximo pra considerar "tap" (ms) */
const TAP_DELAY = 650;

/** Idle após soltar hold (ms) */
const HOLD_IDLE = 240;

/** Opacidade mínima durante hold */
const HOLD_MIN_OPACITY = 0.25;

/** Opacidade inicial do hold */
const HOLD_INITIAL_OPACITY = 0.85;

/** Redução de opacidade por passo */
const HOLD_STEP = 0.08;

/** Intervalo entre passos do hold (ms) */
const HOLD_INTERVAL = 80;

/** Estado interno */
type ControllerState = 'idle' | 'tapping' | 'holding';

export interface VisibilityControllerTarget {
  /** Retorna a opacidade atual */
  getOpacity: () => number;
  /** Define opacidade (0.0 - 1.0) */
  setOpacity: (value: number) => void;
  /** Mostra a janela */
  show: () => void;
  /** Oculta a janela */
  hide: () => void;
  /** Verifica se está visível */
  isVisible: () => boolean;
  /** Delegate: mostra com opacidade restaurada */
  showInactive?: () => void;
}

/**
 * Controlador de visibilidade com hold-to-fade.
 *
 * Uso:
 * ```ts
 * const ctrl = new VisibilityController({ getMainWindow: () => notchWindow });
 * ctrl.register('Ctrl+B');
 * ```
 */
export class VisibilityController {
  private state: ControllerState = 'idle';
  private holdOpacity = 1;
  private holdTimer: ReturnType<typeof setInterval> | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private holdStartTime = 0;
  private wasHidden = false;
  private target: VisibilityControllerTarget | null = null;
  private getMainWindow: () => VisibilityControllerTarget | null;

  constructor(opts: { getMainWindow: () => VisibilityControllerTarget | null }) {
    this.getMainWindow = opts.getMainWindow;
  }

  /**
   * Registra o atalho global para o stealth mode.
   *
   * @param accelerator - Atalho de teclado (padrão: 'CmdOrCtrl+B')
   */
  register(accelerator: string = 'CmdOrCtrl+B'): void {
    globalShortcut.register(accelerator, () => {
      this.handleKey();
    });
  }

  /**
   * Remove o atalho global.
   */
  unregister(): void {
    globalShortcut.unregisterAll();
  }

  /** Indica se está no estado "holding" */
  get isHolding(): boolean {
    return this.state === 'holding';
  }

  /** Retorna a opacidade atual do hold */
  get currentHoldOpacity(): number {
    return this.holdOpacity;
  }

  /**
   * Handler principal — chamado em cada pressionamento do atalho.
   * O Electron globalShortcut não diferencia keydown/keyup,
   * então usamos timers para detectar tap vs hold.
   */
  private handleKey(): void {
    this.target = this.getMainWindow();
    if (!this.target) return;

    const now = Date.now();

    switch (this.state) {
      case 'idle':
        // Primeiro pressionamento
        this.state = 'tapping';
        this.holdStartTime = now;
        this.wasHidden = !this.target.isVisible();

        // Se estava oculto, mostra imediatamente
        if (this.wasHidden) {
          this.target.show();
          this.target.setOpacity(this.target.getOpacity() || HOLD_INITIAL_OPACITY);
        }

        // Timer de tap: se soltar antes de TAP_DELAY, faz toggle
        this.tapTimer = setTimeout(() => {
          if (this.state === 'tapping') {
            // Passou do tempo de tap → muda pra hold
            this.state = 'holding';
            this.startHoldFade();
          }
        }, TAP_DELAY);
        break;

      case 'tapping':
        // Segundo pressionamento rápido dentro do tap → ignora (debounce)
        break;

      case 'holding':
        // Soltou durante hold → restaura opacidade
        this.releaseHold();
        break;
    }
  }

  /**
   * Inicia o fade gradual durante o hold.
   */
  private startHoldFade(): void {
    this.holdOpacity = HOLD_INITIAL_OPACITY;
    this.target?.setOpacity(this.holdOpacity);

    this.holdTimer = setInterval(() => {
      if (!this.target) {
        this.releaseHold();
        return;
      }

      this.holdOpacity = Math.max(
        HOLD_MIN_OPACITY,
        this.holdOpacity - HOLD_STEP,
      );
      this.target.setOpacity(this.holdOpacity);
    }, HOLD_INTERVAL);
  }

  /**
   * Restaura opacidade quando solta o hold.
   */
  private releaseHold(): void {
    if (this.holdTimer) {
      clearInterval(this.holdTimer);
      this.holdTimer = null;
    }

    // Restaura opacidade
    this.holdOpacity = 1;
    this.target?.setOpacity(this.target.getOpacity() || 1);

    this.state = 'idle';

    // Timer de idle para evitar re-trigger rápido
    setTimeout(() => {
      // Reset completo
    }, HOLD_IDLE);
  }

  /**
   * Alterna visibilidade (tap handler).
   * Chamado quando o timer de tap expira sem hold.
   */
  private toggleVisibility(): void {
    if (!this.target) return;

    if (this.target.isVisible()) {
      // Em vez de esconder, fade out rápido
      this.target.setOpacity(0);
      setTimeout(() => {
        this.target?.hide();
      }, 100);
    } else {
      this.target.show();
      this.target.setOpacity(this.target.getOpacity() || HOLD_INITIAL_OPACITY);
    }
  }

  /**
   * Força visível (restaura opacidade e mostra).
   */
  show(): void {
    this.target = this.getMainWindow();
    if (!this.target) return;

    this.releaseHold();
    this.target.setOpacity(1);
    this.target.show();
    this.state = 'idle';
  }

  /**
   * Força oculto.
   */
  hide(): void {
    this.target = this.getMainWindow();
    if (!this.target) return;

    this.releaseHold();
    this.target.hide();
    this.state = 'idle';
  }

  /**
   * Libera recursos.
   */
  dispose(): void {
    this.releaseHold();
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.target = null;
    this.state = 'idle';
  }
}

export default VisibilityController;
