/**
 * win32-overlay.ts - Utilitário Win32 API para configuração de janela overlay
 *
 * Fornece funções para modificar propriedades de janela no Windows via
 * chamadas PowerShell à user32.dll:
 * - makeClickThrough: Torna a janela transparente a cliques do mouse
 * - makeClickable: Restaura a capacidade de receber cliques
 * - hideFromTaskbar: Remove a janela da barra de tarefas
 * - getForegroundHwnd: Obtém o HWND da janela em primeiro plano
 */

import { execFile } from 'child_process';

/** Path do PowerShell no Windows */
const POWERSHELL_PATH = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

/**
 * Gera um script PowerShell que altera o estilo estendido de uma janela via
 * user32.dll. Usa Add-Type para importar as funções nativas.
 *
 * @param hwnd - Handle da janela (HWND, como número decimal)
 * @param exStyle - Valor do estilo estendido a aplicar (ex: 0x80020)
 * @returns String do script PowerShell completo
 */
function buildSetWindowLongScript(hwnd: number, exStyle: number): string {
  return `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        [DllImport("user32.dll")]
        public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, int uFlags);
      }
"@

    $hwnd = [IntPtr]${hwnd}
    $GWL_EXSTYLE = -20
    $currentStyle = [Win32]::GetWindowLong($hwnd, $GWL_EXSTYLE)
    $newStyle = ${exStyle}
    [Win32]::SetWindowLong($hwnd, $GWL_EXSTYLE, $newStyle)
    [Win32]::SetWindowPos($hwnd, [IntPtr]0, 0, 0, 0, 0, 0x0002 -bor 0x0004 -bor 0x0020)
  `.trim();
}

/**
 * Valores de estilo estendido do Windows (user32.dll)
 */
const enum WinExStyle {
  /** WS_EX_TRANSPARENT - Janela transparente a cliques */
  TRANSPARENT = 0x20,
  /** WS_EX_LAYERED - Janela com camadas (suporte a alpha) */
  LAYERED = 0x80000,
  /** WS_EX_TOOLWINDOW - Janela ferramenta (não aparece na barra de tarefas) */
  TOOLWINDOW = 0x80,
  /** WS_EX_APPWINDOW - Força janela a aparecer na barra de tarefas */
  APPWINDOW = 0x40000,
}

/**
 * Executa um script PowerShell e retorna uma promise.
 *
 * @param script - Código PowerShell a executar
 * @returns Promise que resolve com stdout ou rejeita com erro
 */
function runPowerShell(script: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      POWERSHELL_PATH,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ],
      {
        timeout: 10000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`PowerShell error: ${error.message}\nStderr: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      },
    );
  });
}

/**
 * Torna a janela especificada transparente a cliques do mouse (click-through).
 *
 * Aplica as flags:
 * - WS_EX_TRANSPARENT: Cliques passam através da janela
 * - WS_EX_LAYERED: Permite transparência alpha
 * - WS_EX_TOOLWINDOW: Remove da barra de tarefas
 *
 * @param hwnd - Handle da janela (HWND) como número inteiro
 * @throws Se o PowerShell falhar ao executar
 */
export async function makeClickThrough(hwnd: number): Promise<void> {
  const exStyle = WinExStyle.TRANSPARENT | WinExStyle.LAYERED | WinExStyle.TOOLWINDOW;
  await runPowerShell(buildSetWindowLongScript(hwnd, exStyle));
}

/**
 * Restaura a capacidade da janela de receber cliques do mouse.
 *
 * Remove WS_EX_TRANSPARENT, mantém WS_EX_LAYERED e WS_EX_TOOLWINDOW
 * para preservar a transparência visual e a ocultação da barra de tarefas.
 *
 * @param hwnd - Handle da janela (HWND) como número inteiro
 * @throws Se o PowerShell falhar ao executar
 */
export async function makeClickable(hwnd: number): Promise<void> {
  const exStyle = WinExStyle.LAYERED | WinExStyle.TOOLWINDOW;
  await runPowerShell(buildSetWindowLongScript(hwnd, exStyle));
}

/**
 * Remove a janela da barra de tarefas do Windows.
 *
 * Aplica WS_EX_TOOLWINDOW para que a janela não apareça na
 * barra de tarefas nem no alternador Alt+Tab.
 *
 * @param hwnd - Handle da janela (HWND) como número inteiro
 * @throws Se o PowerShell falhar ao executar
 */
export async function hideFromTaskbar(hwnd: number): Promise<void> {
  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")]
        public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
      }
"@

    $hwnd = [IntPtr]${hwnd}
    $GWL_EXSTYLE = -20
    $currentStyle = [Win32]::GetWindowLong($hwnd, $GWL_EXSTYLE)
    $newStyle = $currentStyle -bor 0x80  # WS_EX_TOOLWINDOW
    $newStyle = $newStyle -band -bnot 0x40000  # Remove WS_EX_APPWINDOW
    [Win32]::SetWindowLong($hwnd, $GWL_EXSTYLE, $newStyle)
  `.trim();

  await runPowerShell(script);
}

/**
 * Obtém o HWND da janela atualmente em primeiro plano.
 *
 * Útil para debugging ou para aplicar estilos a uma janela específica
 * encontrada pelo usuário.
 *
 * @returns Promise com o HWND como número, ou 0 se não encontrado
 */
export async function getForegroundHwnd(): Promise<number> {
  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
      }
"@
    $hwnd = [Win32]::GetForegroundWindow()
    Write-Host $hwnd
  `.trim();

  const stdout = await runPowerShell(script);
  const parsed = parseInt(stdout, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export default { makeClickThrough, makeClickable, hideFromTaskbar, getForegroundHwnd };
