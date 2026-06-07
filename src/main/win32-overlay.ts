/**
 * Win32 native bindings for overlay window flags.
 * Uses ffi-napi or raw Windows API calls to set:
 * - WDA_EXCLUDEFROMCAPTURE (invisible in screen recordings)
 * - WS_EX_TOOLWINDOW (hidden from taskbar/alt-tab)
 * - WS_EX_TRANSPARENT (click-through)
 * - WS_EX_LAYERED (transparency)
 *
 * This module tries to use ffi-napi if available, otherwise returns noop.
 */

interface Win32Overlay {
  setExcludeFromCapture: (hwnd: Buffer) => boolean;
  setTransparent: (hwnd: Buffer) => boolean;
  setClickThrough: (hwnd: Buffer) => boolean;
}

function createNoop(): Win32Overlay {
  console.warn('Win32 native module not available — overlay may appear in screen captures');
  return {
    setExcludeFromCapture: () => false,
    setTransparent: () => false,
    setClickThrough: () => false,
  };
}

let nativeWindow: Win32Overlay;

try {
  // Try to use ffi-napi for Win32 calls
  const ffi = require('ffi-napi');
  const ref = require('ref-napi');
  const user32 = ffi.Library('user32', {
    SetWindowDisplayAffinity: ['bool', ['int32', 'uint32']],
    SetWindowLongA: ['int32', ['int32', 'int32', 'int32']],
    GetWindowLongA: ['int32', ['int32', 'int32']],
  });

  const HWND_NOTOPMOST = -1;
  const HWND_TOPMOST = -1;
  const GWL_EXSTYLE = -20;
  const WS_EX_LAYERED = 0x00080000;
  const WS_EX_TRANSPARENT = 0x00000020;
  const WS_EX_TOOLWINDOW = 0x00000080;
  const WDA_EXCLUDEFROMCAPTURE = 0x00000011;

  nativeWindow = {
    setExcludeFromCapture: (hwndBuffer: Buffer) => {
      try {
        const hwnd = hwndBuffer.readInt32LE(0);
        // Set window to not appear in screen capture
        user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);

        // Add WS_EX_TOOLWINDOW to hide from taskbar/alt-tab
        const currentStyle = user32.GetWindowLongA(hwnd, GWL_EXSTYLE);
        user32.SetWindowLongA(hwnd, GWL_EXSTYLE, currentStyle | WS_EX_TOOLWINDOW);

        return true;
      } catch {
        return false;
      }
    },

    setTransparent: (hwndBuffer: Buffer) => {
      try {
        const hwnd = hwndBuffer.readInt32LE(0);
        const currentStyle = user32.GetWindowLongA(hwnd, GWL_EXSTYLE);
        user32.SetWindowLongA(hwnd, GWL_EXSTYLE, currentStyle | WS_EX_LAYERED);
        return true;
      } catch {
        return false;
      }
    },

    setClickThrough: (hwndBuffer: Buffer) => {
      try {
        const hwnd = hwndBuffer.readInt32LE(0);
        const currentStyle = user32.GetWindowLongA(hwnd, GWL_EXSTYLE);
        user32.SetWindowLongA(hwnd, GWL_EXSTYLE, currentStyle | WS_EX_TRANSPARENT | WS_EX_LAYERED);
        return true;
      } catch {
        return false;
      }
    },
  };
} catch {
  nativeWindow = createNoop();
}

export { nativeWindow };
