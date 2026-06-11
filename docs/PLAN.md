# Mimico — Plano de Desenvolvimento

> **Atualizado em:** Junho 2026
> **Stack principal:** Electron + TypeScript + Win32 API + Python workers
> **Correção crítica:** O toggle de voz agora processa SEU microfone (não o áudio do sistema)

---

## 🎯 Visão Geral — Notch Único (interface principal)

O Mimico tem **uma única interface na tela**: o **Notch** (pílula expansível no topo-centro).

O notch é **tudo** que vc vê durante a call:
- **Colapsado:** bolinha de status `[●]` — 300×34px, discretíssimo
- **Expandido:** painel completo com abas internas

Dentro do notch expandido:
| Aba | Conteúdo |
|-----|----------|
| **💬 Legendas** | Traduções ao vivo EN→PT (feed rolável) |
| **🎮 Controles** | Modo (off/subtitles/voice), mix (replace/overlay), TTS status |
| **📋 Histórico** | Últimas N falas da sessão |

Fora da call: **Settings Window** separada (tray → Configurações) pra setup de API keys, escolha de voz, etc.

```
┌── NOTCH COLAPSADO ──────────────────────────────────┐
│ [●]                                                  │
└──────────────────────────────────────────────────────┘

┌── NOTCH EXPANDIDO ──────────────────────────────────┐
│ ● LEGENDAS         🎤 Edge TTS              🎮 ⚙    │ ← status bar
├──────────────────────────────────────────────────────┤
│ [💬 Legendas] [🎮 Controles] [📋 Histórico]         │ ← abas internas
├──────────────────────────────────────────────────────┤
│                                                      │
│ 💻 What time is the meeting tomorrow?                │
│ 🇧🇷 Que horas é a reunião amanhã?                    │
│                                                      │
│ 📍 Microfone → The proposal needs approval...        │
│ 🇧🇷 A proposta precisa de aprovação...               │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Dois Pipelines Independentes

**Pipeline A — Legendas (sempre ON quando ativo)**
Sistema (áudio dos outros, EN) → WASAPI Loopback → Faster-Whisper (EN) → DeepL (EN→PT) → Notch (texto PT)

**Pipeline B — Voz Traduzida (toggle via notch)**
Microfone real (sua voz PT) → WASAPI Capture → Faster-Whisper (PT) → DeepL (PT→EN) → TTS (EN) → VB-Cable → Meet ouve inglês

---

## Fase 0 — Fundação ✅ (COMPLETA)

| Tarefa | Status |
|--------|--------|
| Estrutura Electron + TS | ✅ |
| Config persistente (JSON) | ✅ |
| **Notch Overlay** (pílula expansível no topo) | ✅ |
| Ícone bandeja + menu | ✅ |
| WASAPI loopback (áudio sistema) | ✅ |
| Faster-Whisper transcrição | ✅ |
| DeepL tradução + cache LRU | ✅ |
| Edge TTS síntese | ✅ |
| VB-Cable audio output | ✅ |
| Instalador NSIS | ✅ |
| README com visual + instruções | ✅ |
| Worker captura microfone | ✅ |
| Worker whisper multilíngue | ✅ |
| Gerenciador microfone (`mic-capture.ts`) | ✅ |

---

## Fase 1 — Tray + Hotkeys + Mix Replace/Overlay 🔧

### 1.1 Tray menu com 3 modos diretos

Trocar toggle ON/OFF por:
```
🔇 Off
💬 Legendas ✓
🎤 Voz (Edge TTS)
═══════════════
⚙ Configurações
❌ Sair
```

- `onSetMode(mode)` substitui `onToggle`
- Item ativo marcado com ✓
- Mostra provider TTS no label "Voz"

### 1.2 Hotkeys

| Atalho | Ação |
|--------|------|
| `Alt+Shift+M` | Liga/Desliga captura |
| **`Alt+Shift+V`** | **Alterna entre Legendas / Voz** |
| `Alt+Shift+O` | Mostra/Esconde notch |

### 1.3 Lógica dos 3 modos

- `'off'` → não inicia nada, notch colapsado
- `'subtitles'` → só Pipeline A (loopback → whisper → deepl → notch)
- `'voice'` → Pipeline A + Pipeline B (mic → whisper PT → deepl PT→EN → TTS → VB-Cable)

### 1.4 Mix Replace/Overlay

Config: `voiceMixMode: 'replace' | 'overlay'`

- **replace**: muta microfone real na call, só áudio traduzido vai pro VB-Cable
- **overlay**: microfone real + áudio traduzido mixados

### 1.5 Config — novos campos

```ts
appMode: 'off' | 'subtitles' | 'voice';       // DEFAULT: 'subtitles'
voiceMixMode: 'replace' | 'overlay';           // DEFAULT: 'replace'
```

---

## Fase 2 — Notch: Interface única 🔧

### 2.1 Filosofia

O **Notch** é TUDO que vc vê durante a call:
- **Colapsado:** bolinha `[●]` 300×34px no topo-centro
- **Expandido:** painel com sidebar + conteúdo

Settings Window separada (tray → Configurações) existe só pra setup de API keys e preferências.

### 2.2 Estrutura do Notch Expandido

```
┌── NOTCH ─────────────────────────────────────┐
│ ● LEGENDAS         🎤 Edge TTS              │ ← status bar
├──────┬───────────────────────────────────────┤
│      │                                       │
│  💬  │  Feed de legendas/traduções ao vivo    │
│  🎮  │  (conteúdo muda conforme sidebar)      │
│  📋  │                                       │
│      │                                       │
│  ⚙   │                                       │
└──────┴───────────────────────────────────────┘
```

Sidebar (48px, ícones apenas):
- 💬 **Legendas** → feed EN→PT ao vivo
- 🎮 **Controles** → modo (off/subtitles/voice), mix (replace/overlay), TTS provider, atalhos
- 📋 **Histórico** → últimas N falas da sessão
- ⚙ → abre Settings Window externa

### 2.3 Notch colapsado vs expandido

| Estado | Largura | Altura | Cantos |
|--------|---------|--------|--------|
| Colapsado | 300px | 34px | 0 0 24px 24px |
| Expandido | 450px | ~320px | 0 0 20px 20px |

Animação: `cubic-bezier(0.34, 1.56, 0.64, 1)` — spring effect

### 2.4 Auto-expand / Auto-collapse

- **Auto-expand:** quando chega tradução nova, se estiver colapsado, expande
- **Auto-collapse:** após 5s sem tradução, recolhe (a menos que tenha interação)
- **Interação do usuário** na aba Controles ou Histórico → mantém expandido

### 2.5 Stealth Mode — Ctrl+B

| Ação | Comportamento |
|------|--------------|
| **Tap rápido** (<650ms) | Alterna notch visível/invisível |
| **Segurar** (>650ms) | Reduz opacidade gradualmente (0.85 → 0.25) |
| **Soltar durante hold** | Restaura opacidade |

Implementação via `VisibilityController`.

### 2.6 Win32 native shape

Usar `win.setShape()` pra delimitar área clicável do notch.
Fora da área: click-through (cliques passam direto).

---

## Fase 3 — TTS Adapter: Edge + ElevenLabs 🔧

**Problema:** VoiceManager só faz Edge TTS. Precisa suportar ElevenLabs como alternativa.

**Solução — interface `TTSProvider`:**

```
TTSProvider (interface)
  ├── EdgeTTSProvider    → edge-tts CLI + voice_worker.py (local, grátis)
  └── ElevenLabsProvider → @elevenlabs/elevenlabs-js SDK (API key, vozes diversas)
```

VoiceManager vira fachada que recebe o provider por constructor e permite troca em runtime.

| Tarefa | Descrição | Arquivos |
|--------|-----------|----------|
| 3.6.1 | Criar interface TTSProvider + tipos | `src/main/tts-provider.ts` |
| 3.6.2 | Migrar Edge TTS para EdgeTTSProvider | `src/main/tts-edge.ts`, refatorar `voice-manager.ts` |
| 3.6.3 | Implementar ElevenLabsProvider | `src/main/tts-elevenlabs.ts`, npm install @elevenlabs/elevenlabs-js |
| 3.6.4 | Integrar no main.ts com factory + hot-swap | `src/main/main.ts` |

### 3.4 Settings Window (modal de configuração)

**Uso:** apenas para setup inicial (API keys, escolha de voz, preferências).
**Durante a call:** não abrir — usar notch + hotkeys + tray.

| Tarefa | Descrição | Arquivos |
|--------|-----------|----------|
| 3.4.1 | Criar settings-window.ts + HTML completo | `src/main/settings-window.ts`, `src/main/settings.html` |
| 3.4.2 | Conectar ao tray menu (handler openSettings) | `src/main/tray.ts`, `src/main/main.ts` |
| 3.4.3 | Navegação sidebar (ícones, 48px) | settings.html |
| 3.4.4 | Minimizar / Fechar / Sair | preload.ts + IPC handlers |

### 3.5 UI do Settings — Seções

| Seção | Conteúdo |
|-------|----------|
| **⌂ Painel** | Status workers, versão |
| **♪ Áudio** | VB-Cable, status dispositivos |
| **⇄ Tradução** | DeepL API Key, uso mensal |
| **♫ Voz (TTS)** | Provider Edge/ElevenLabs, API Key, voz, modelo |
| **ⓘ Sobre** | Versão, logs, encerrar |

(Nota: **Controles de modo + mix** ficam no **notch** — não no settings. O settings é só pra configuração pesada.)

### 3.6 Config — Nova interface

```ts
interface Config {
  // Modos
  appMode: 'off' | 'subtitles' | 'voice';
  voiceMixMode: 'replace' | 'overlay';

  // API Keys
  deepKey: string;
  elevenLabsKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;

  // Preferências
  language: string;
  toggleHotkey: string;
  overlayHotkey: string;
  overlayOpacity: number;
  vbcableDevice: string;
  whisperModelSize: string;
  ttsProvider: 'edge' | 'elevenlabs';
}
```

**DEFAULTS:**
```ts
appMode: 'subtitles',
voiceMixMode: 'replace',
ttsProvider: 'edge',
elevenLabsKey: '', elevenLabsVoiceId: '', elevenLabsModel: 'eleven_flash_v2_5',
deepKey: '',
language: 'PT',
vbcableDevice: 'CABLE Input',
whisperModelSize: 'tiny',
overlayOpacity: 0.85,
toggleHotkey: 'Alt+Shift+M',
overlayHotkey: 'Alt+Shift+O',
```

### 3.7 Arquitetura — Diagrama Final

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MIMICO — ARQUITETURA FINAL                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐  3 modos (off/subtitles/voice)                         │
│  │   Tray   │  Hotkeys: M, V, O                                      │
│  │   Menu   │  Stealth: Ctrl+B (tap/hold)                            │
│  └────┬─────┘                                                        │
│       │                                                              │
│  ┌────▼────────────────────────────────────────────────────────┐     │
│  │                    ELECTRON MAIN PROCESS                     │     │
│  ├─────────────────────────────────────────────────────────────┤     │
│  │  main.ts — orquestrador (modos + mix + hotkeys)              │     │
│  │  ├── config.ts                                               │     │
│  │  ├── tray.ts           → menu 3 modos + config + sair        │     │
│  │  ├── notch-overlay.ts  → pílula expansível + sidebar         │     │
│  │  ├── notch.html        → HTML/React com abas                 │     │
│  │  ├── win32-notch.ts    → win.setShape() p/ formato notch     │     │
│  │  ├── visibility-controller.ts → Ctrl+B hold-to-fade          │     │
│  │  ├── display-layout.ts → DisplayTopologyCoordinator          │     │
│  │  ├── settings-window.ts → config (uso fora da call)          │     │
│  │  ├── audio-capture.ts  → WASAPI loopback                     │     │
│  │  ├── mic-capture.ts    → WASAPI microfone                    │     │
│  │  ├── whisper-manager.ts → Faster-Whisper EN+PT               │     │
│  │  ├── translator.ts     → DeepL + cache LRU                   │     │
│  │  ├── voice-manager.ts  → fachada TTSProvider                 │     │
│  │  │    ├── tts-provider.ts   → interface                      │     │
│  │  │    ├── tts-edge.ts       → Edge TTS (local)               │     │
│  │  │    └── tts-elevenlabs.ts → ElevenLabs (API)               │     │
│  │  ├── audio-output.ts   → VB-Cable + mix replace/overlay      │     │
│  │  └── ipc/              → handlers modulares                  │     │
│  │       ├── audio.ts, tts.ts, config.ts, window.ts             │     │
│  ├─────────────────────────────────────────────────────────────┤     │
│  │                    WORKERS (Python)                          │     │
│  ├─────────────────────────────────────────────────────────────┤     │
│  │  audio_capture.py     → WASAPI loopback                     │     │
│  │  audio_mic_capture.py → WASAPI input (microfone)            │     │
│  │  whisper_worker.py    → Faster-Whisper (EN + PT)            │     │
│  │  voice_worker.py      → Edge TTS (legado)                   │     │
│  │  audio_output.py      → VB-Cable + mix replace/overlay      │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.8 Dependência nova

```
npm install @elevenlabs/elevenlabs-js
```

## Estimativa Final

| Tarefa | Tempo |
|--------|-------|
| **Fase 1 — Tray + Hotkeys + Mix** | **~4h** |
| Tray menu 3 modos | ~1h |
| Hotkeys (Alt+Shift+V) | ~1h |
| Lógica 3 modos (off/subtitles/voice) | ~1h |
| Mix replace/overlay | ~1h |
| **Fase 2 — Notch Overlay** | **~6h** |
| Notch-overlay.ts (criar/gerenciar) | ~2h |
| Notch.html (HTML + CSS + sidebar + abas) | ~2h |
| Win32 notch shape (setShape) | ~1h |
| DisplayTopologyCoordinator | ~1h |
| **Fase 3 — TTS Adapter** | **~3h** |
| Interface + EdgeTTSProvider | ~1h |
| ElevenLabsProvider | ~2h |
| **Fase 4 — Stealth Mode** | **~2h** |
| VisibilityController (Ctrl+B) | ~2h |
| **Fase 5 — IPC Modular** | **~2h** |
| src/main/ipc/ estrutura | ~2h |
| **Fase 6 — Settings Window** | **~3h** |
| Settings HTML + sidebar | ~2h |
| Integração tray + IPC | ~1h |
| **Total** | **~20h** |
