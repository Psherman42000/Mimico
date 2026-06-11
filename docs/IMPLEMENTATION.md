# Mimico — Plano de Implementação Detalhado

> Atualizado em: Junho 2026
> Inspirado no Perssua (notch overlay, stealth mode, IPC modular, 2-window architecture)

---

## Sumário

| Fase | O que | Arquivos |
|------|-------|----------|
| 0 | Fundação (já existe) | — |
| 1 | Pipeline B (já existe) | — |
| **2** | **Tray 3 modos + Hotkeys + Mix** | `tray.ts`, `main.ts`, `config.ts`, `audio-output.ts`, `audio_output.py` |
| **3** | **Notch Overlay (pílula expansível + sidebar)** | `notch-overlay.ts`, `notch.html`, `win32-notch.ts`, `display-layout.ts` |
| **4** | **TTS Adapter (Edge + ElevenLabs)** | `tts-provider.ts`, `tts-edge.ts`, `tts-elevenlabs.ts`, `voice-manager.ts`, `main.ts` |
| **5** | **Stealth Mode + IPC Modular** | `visibility-controller.ts`, `src/main/ipc/` |
| **6** | **Settings Window + Build** | `settings-window.ts`, `settings.html`, `electron-builder.yml` |

---

## Fase 0 — Fundação ✅ (já existe)
... (mantido igual)

---

## Fase 1 — Pipeline B ✅ (já existe)
... (mantido igual)

---

## Fase 2 — Tray 3 Modos + Hotkeys
... (mantido igual ao texto atual)

---

## Fase 3 — Notch Overlay (Pílula Expansível)

### O que muda

**Hoje:** overlay fixo 800x200 no canto inferior direito.
**Novo:** notch expansível no topo-centro, estilo Perssua.

### 3.1 `notch-overlay.ts` — novo módulo (NOVO)

Inspirado no `notchBubble.js` do Perssua:

```ts
class NotchOverlay {
  private window: BrowserWindow | null;
  private isExpanded = false;
  private isPinned = true; // true = notch position, false = floating
  private lastNotchSettings = null;

  // Dimensões
  static readonly COLLAPSED_WIDTH = 300;
  static readonly COLLAPSED_HEIGHT = 34;
  static readonly EXPANDED_MIN_WIDTH = 360;
  static readonly EXPANDED_MAX_WIDTH = 900;
  static readonly EXPANDED_MIN_HEIGHT = 160;
  static readonly EXPANDED_MAX_HEIGHT = 640;
  static readonly DEFAULT_WIDTH = 450;
  static readonly DEFAULT_HEIGHT = 320;
}
```

**Comportamento:**
- **Colapsado:** pílula de 300x34px no topo-centro da tela
  - Mostra bolinha verde + "●" minúsculo
  - Cantos arredondados 24px (só embaixo)
  - Opacidade reduzida, quase invisível
- **Expandido:** painel de ~450px com traduções
  - Animação spring-style (cubic-bezier 0.34, 1.56, 0.64, 1)
  - Cantos 20px
  - Mostra status bar + feed de tradução
- **Auto-expand:** quando chega tradução nova, expande
- **Auto-collapse:** após 5s sem tradução, recolhe

### 3.2 `notch.html` — HTML do notch (NOVO)

```html
<div class="notch-shape" id="notch">
  <div class="notch-content">
    <!-- Colapsado: só um dot -->
    <div class="notch-collapsed">
      <span class="dot"></span>
    </div>
    <!-- Expandido: feed -->
    <div class="notch-expanded">
      <div class="notch-status">
        <span class="dot green"></span>
        <span class="mode">LEGENDAS</span>
        <span class="spacer"></span>
        <span class="tts">🎤 ON</span>
      </div>
      <div class="notch-feed">
        <div class="text-en">Original</div>
        <div class="text-pt">Tradução</div>
      </div>
    </div>
  </div>
</div>
```

CSS com transições:
```css
.notch-shape {
  width: 300px; height: 34px;
  border-radius: 0 0 24px 24px;
  transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
              height 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
              border-radius 0.4s ease;
}
.notch-shape.expanded {
  width: 450px; height: 320px;
  border-radius: 0 0 20px 20px;
}
```

### 3.3 `win32-notch.ts` — forma nativa Windows (NOVO)

Usar `win.setShape()` pra criar o formato notch (click-through fora da área do notch):
```ts
function getCollapsedNotchShape(win: BrowserWindow): Electron.Rectangle[] {
  const bounds = win.getBounds();
  const width = 300;
  const height = 34;
  return [{
    x: Math.round((bounds.width - width) / 2),
    y: 0, width, height,
  }];
}
```

### 3.4 Fade animations

- Ease-out quadratic ( `t * (2 - t)` )
- Fade in: 250ms, 15 steps
- Fade out: 200ms, 12 steps

---

## Fase 4 — IPC Modular + DisplayTopology

### O que muda

**Hoje:** IPC handlers soltos no `main.ts`.
**Novo:** cada domínio tem seu próprio arquivo em `src/main/ipc/`.

### 4.1 Estrutura nova

```
src/main/ipc/
  ├── index.ts         → registerAllIpcHandlers()
  ├── audio.ts         → handlers de áudio
  ├── transcription.ts → handlers whisper
  ├── translation.ts   → handlers deepl
  ├── tts.ts           → handlers TTS
  ├── window.ts        → handlers overlay/notch
  └── config.ts        → handlers config
```

### 4.2 `display-layout.ts` — gerenciamento de monitores (NOVO)

Inspirado no `displayLayout.js` + `displayTopologyCoordinator.js` do Perssua:

```ts
function getDisplayWorkArea(display: Display): Rect;
function fitBoundsToDisplay(bounds: Rect, display: Display): Rect;
function getResolutionAwareZoomFactor(display: Display): number;
function normalizeWindowZoom(win: BrowserWindow): void;

class DisplayTopologyCoordinator {
  registerWindow(id: string, window: BrowserWindow): void;
  unregisterWindow(id: string): void;
  onDisplayChanged(callback: () => void): void;
}
```

### 4.3 Benefícios

- IPC organizado por domínio (escalável)
- Display topology: overlay reposiciona automaticamente quando monitor muda
- DPI scaling awareness
- Mais fácil de debugar

---

## Fase 5 — Stealth Mode + Hold-to-Fade

### O que muda

**Hoje:** `Alt+Shift+H` toggle binário (mostra/esconde).
**Novo:** `Ctrl+B` com hold-to-fade (segurar reduz opacidade gradualmente, soltar restaura).

### 5.1 `visibility-controller.ts` (NOVO)

Inspirado no `VisibilityShortcutController` do Perssua:

```ts
class VisibilityController {
  private holdActive = false;
  private holdOpacity = 1;
  private tapTimer: NodeJS.Timeout | null = null;

  // Config
  static readonly TAP_DELAY = 650;      // ms — tempo máximo pra considerar "tap"
  static readonly HOLD_IDLE = 240;       // ms — idle após hold
  static readonly HOLD_MIN_OPACITY = 0.25;
  static readonly HOLD_INITIAL_OPACITY = 0.85;
  static readonly HOLD_STEP = 0.08;
}
```

**Comportamento:**
- **Tap rápido** (< 650ms): alterna notch visível/invisível
- **Segurar** (> 650ms): reduz opacidade gradualmente (0.85 → 0.25)
- **Soltar durante hold:** restaura opacidade
- **Soltar após tap:** mantém estado (toggle)
- Os modais reduzem opacidade junto (CSS custom property)

### 5.2 Integração no tray

Item no menu: "👁 Stealth Mode" com submenu:
- Tap to hide
- Hold to fade (mostra opacidade atual)

---

## Fase 6 — Mix Replace/Overlay
... (mantido igual)

---

## Fase 7 — TTS Adapter (Edge + ElevenLabs)
... (mantido igual)

---

## Fase 8 — Settings Window + Dashboard

### O que muda

**Hoje:** não existe (openSettings mostra o overlay).
**Novo:** BrowserWindow separada, independente do notch/overlay.

Inspirado no `settingsOnboardingWindow.js` do Perssua:
- Dimensões: 620-820w × 460-600h
- Centralizada no display atual
- Título nativo (frame: true) ou custom
- Persiste posição entre sessões
- SkipTaskbar: true (só abre via tray)

### 8.1 `settings-window.ts`

```ts
class SettingsWindow {
  private window: BrowserWindow | null;
  // ...
  create(): BrowserWindow;  // cria e retorna
  show(): void;             // mostra/foca
  close(): void;            // destrói
  getBounds(): Rect;        // pra persistir posição
}
```

### 8.2 Seções do settings (mantido igual):
⌂ Painel, ♪ Áudio, ◧ Legendas, ✎ Transcrição, ⇄ Tradução, ♫ Voz, ⓘ Sobre

### 8.3 Feed de tradução ao vivo (IPC push, opcional)

---

## Fase 9 — Build + Teste + Instalador
... (mantido igual)

---

## Checklist de Verificação

- [ ] Compila sem erros
- [ ] Inicia sem crash
- [ ] Tray menu mostra 3 modos + hotkeys funcionam
- [ ] `Alt+Shift+V` alterna Legendas / Voz
- [ ] **`Ctrl+B` hold-to-fade + tap toggle notch**
- [ ] **Notch expansível (300x34 → 450x320) no topo-centro**
- [ ] **Animação spring-style no expand/collapse**
- [ ] **Notch auto-expande com tradução, auto-recolhe após 5s**
- [ ] IPC modular (novos handlers em ipc/)
- [ ] Display topology (reposiciona em mudança de monitor)
- [ ] Status bar no notch mostra modo + TTS ON/OFF
- [ ] Áudio do sistema → legenda aparece no notch
- [ ] Microfone → voz traduzida no VB-Cable
- [ ] Mix replace/overlay funciona
- [ ] TTS Edge funciona
- [ ] TTS ElevenLabs funciona
- [ ] Settings modal abre/fecha, todas seções navegáveis
- [ ] Feed de tradução aparece no modal
- [ ] Instalador gera .exe funcional
