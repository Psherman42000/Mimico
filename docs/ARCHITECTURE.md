# Mimico — Arquitetura Técnica

## Visão Geral

Mimico é um aplicativo desktop Windows que opera em segundo plano com **dois pipelines independentes**:

1. **Pipeline A — Legendas:** Captura áudio do sistema (o que os outros falam), transcreve, traduz e exibe overlay
2. **Pipeline B — Voz Traduzida:** Captura seu microfone, transcreve em PT, traduz pra EN, sintetiza voz e injeta no VB-Cable

---

## Stack

| Camada | Tecnologia | Justificativa |
|--------|-----------|---------------|
| Desktop App | Electron 33 | Runtime web + Win32 API via Node |
| Frontend | HTML + CSS + TypeScript | Overlay leve com IPC |
| Captura Áudio | WASAPI (sounddevice Python) | Único jeito de capturar áudio do sistema no Windows |
| Transcrição | Faster-Whisper tiny | Roda local (GPU/CPU), $0, multilíngue |
| Tradução | DeepL API Free | 500k chars/mês grátis, ~500ms |
| TTS | Edge TTS | Gratuito, vozes EN/PT nativas, $0 |
| Microfone Virtual | VB-Cable | Driver gratuito, injeta áudio em qualquer app |

---

## Diagrama de Componentes

```
┌──────────────────────────────────────────────────────────────┐
│                     ELECTRON MAIN PROCESS                     │
├──────────────────────────────────────────────────────────────┤
│  main.ts (orquestrador)                                       │
│  ├── config.ts         → JSON persistente                     │
│  ├── tray.ts           → Ícone bandeja + menu                │
│  ├── overlay.ts        → Janela transparente (click-through) │
│  ├── win32-overlay.ts  → Win32 API (invisível captura)       │
│  ├── audio-capture.ts  → Gerencia worker loopback            │
│  ├── mic-capture.ts    → Gerencia worker microfone       🔧  │
│  ├── whisper-manager.ts→ Gerencia worker transcrição         │
│  ├── translator.ts     → DeepL API + cache LRU               │
|  ├── voice-manager.ts  → Edge TTS / ElevenLabs              │
│  └── audio-output.ts   → VB-Cable playback                   │
├──────────────────────────────────────────────────────────────┤
│                    WORKERS (Python child processes)            │
├──────────────────────────────────────────────────────────────┤
│  audio_capture.py      → WASAPI loopback (sistema)           │
│  audio_mic_capture.py  → WASAPI input (microfone)        🔧  │
│  whisper_worker.py     → Faster-Whisper (EN + PT)            │
│  voice_worker.py       → Edge TTS síntese                    │
│  audio_output.py       → Reproduz no VB-Cable                │
└──────────────────────────────────────────────────────────────┘
```

---

## Fluxo de Dados (Pipeline A — Legendas)

```
Sistema (áudio) → [audio_capture.py] → PCM 16kHz mono
  → [whisper_worker.py] → texto EN
  → [translator.ts] → texto PT
  → [overlay.ts] → 🇧🇷 exibe na tela
```

**Sempre ativo.** Latência total: ~1-3s.

---

## Fluxo de Dados (Pipeline B — Voz Traduzida)

```
Microfone (sua voz PT) → [audio_mic_capture.py] → PCM 16kHz mono
  → [whisper_worker.py] → texto PT
  → [translator.ts] → texto EN
  → [voice-manager.ts] → Edge TTS → WAV
  → [audio_output.py] → VB-Cable "CABLE Input"
```

**Ativado por toggle.** Latência total: ~2-4s.

---

## IPC (Inter-Process Communication)

### Electron ↔ Renderer (Overlay)
- `contextBridge` via `preload.ts`
- Canais: `update-subtitles`, `clear-subtitles`, `toggle-state`, `get-config`, `save-config`

### Electron ↔ Python Workers
- stdin/stdout com JSON delimitado por linha
- Workers enviam `{"type":"ready"}` ao iniciar
- Comandos: `{"command":"start"}`, `{"command":"stop"}`, `{"command":"transcribe","data":"..."}`

---

## Config Schema

```json
{
  "deepKey": "",
  "language": "PT",
  "sourceLang": "EN",
  "toggleHotkey": "Alt+Shift+M",
  "overlayHotkey": "Alt+Shift+O",
  "toggleVoice": false,
  "overlayOpacity": 0.85,
  "vbcableDevice": "CABLE Input",
  "whisperModelSize": "tiny",
  "ttsProvider": "edge",
  "edgeVoice": "en-US-JennyNeural",
  "elevenLabsKey": "",
  "elevenLabsVoiceId": "",
  "elevenLabsModel": "eleven_flash_v2_5"
}
```

---

## ADRs

### ADR-1: Por que Electron e não Tauri?
- **Contexto:** Precisamos de A) Win32 API (click-through overlay), B) child process Python, C) window management
- **Decisão:** Electron — ecossistema maduro, node-win32-API funciona, Python child process trivial
- **Consequências:** App ~70MB (contra ~5MB do Tauri), mas funcionalidades críticas são triviais de implementar

### ADR-2: Por que DeepL e não Google Translate?
- **Contexto:** Precisamos de tradução rápida com API gratuita
- **Decisão:** DeepL Free — 500k chars/mês, ~500ms latência, melhor qualidade que Google Translate
- **Consequências:** Precisa de chave de API (cadastro gratuito)

### ADR-3: Por que Edge TTS como padrão e não ElevenLabs?
- **Contexto:** Precisamos de TTS rápido, gratuito e em português + inglês
- **Decisão:** Edge TTS como padrão — gratuito, sem API key, vozes EN/PT excelentes. ElevenLabs como alternativa premium com suporte a voice cloning
- **Consequências:** Edge TTS não clona sua voz (voz genérica da Microsoft), mas $0 e latência ~1s. ElevenLabs oferece clonagem mas requer assinatura ($5/mo+)

### ADR-4: Por que WASAPI via Python e não Node bindings?
- **Contexto:** Captura WASAPI loopback no Windows
- **Decisão:** Python (sounddevice) — mais fácil de debugar, fallback CPU, sem compilação nativa
- **Consequências:** Precisa de Python + pip install, mas workers isolam falhas do processo principal

---

## Latência Budget

| Estágio | Pipeline A | Pipeline B |
|---------|-----------|-----------|
| Captura áudio | ~300ms (buffer) | ~300ms (buffer) |
| Whisper (tiny GPU) | ~200ms | ~200ms |
| DeepL | ~500ms | ~500ms |
| TTS | n/a | ~1s |
| **Total** | **~1s** | **~2s** |
