# Mimico — Arquitetura Técnica

## Visão Geral

Mimico é um aplicativo desktop Windows que opera em segundo plano, capturando áudio do sistema e fornecendo:
1. **Transcrição + tradução em tempo real** exibida em overlay invisível
2. **Voz clonada** (toggle) que traduz fala PT→EN com a voz do usuário via microfone virtual

---

## Stack Tecnológica

| Camada | Tecnologia | Justificativa |
|---|---|---|
| **Runtime** | Electron 30+ | Janela overlay + bandeja + IPC |
| **Linguagem** | TypeScript + Python | TS para UI, Python para ML |
| **Overlay** | HTML/CSS/TS + Win32 API | Janela transparente, `WDA_EXCLUDEFROMCAPTURE` |
| **Áudio** | WASAPI Loopback (C++ addon) | Captura áudio do sistema |
| **STT** | Faster-Whisper (Python, GPU) | Rápido, acurado, local |
| **Tradução** | DeepL API Free | 500k chars/mês grátis, qualidade excelente |
| **TTS** | OpenVoice V2 (Python, GPU) | Clonagem local gratuita |
| **Mic Virtual** | VB-Cable | Driver gratuito de áudio virtual |
| **Config** | JSON em `%APPDATA%/Mimico/` | Persistência simples |

---

## Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ELECTRON MAIN PROCESS                        │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │  Tray    │  │  WASAPI  │  │  Config  │  │  IPC Bridge        │  │
│  │  Manager │  │ Capture  │  │  Store   │  │  ─────────────     │  │
│  └──────────┘  └────┬─────┘  └──────────┘  │  Main ↔ Renderer   │  │
│                      │                      └────────────────────┘  │
│                      ▼                                              │
│           ┌─────────────────────┐                                   │
│           │  Audio Buffer (PCM) │                                   │
│           └─────────┬───────────┘                                   │
│                     │                                               │
│                     ▼                                               │
│           ┌─────────────────────┐                                   │
│           │  Child Process      │                                   │
│           │  whisper_worker.py   │── stdout JSON ──▶ Transcrição    │
│           │  openvoice_worker.py │── stdout PCM  ──▶ VB-Cable      │
│           └─────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        RENDERER PROCESS                             │
│                                                                     │
│  ┌────────────────────┐  ┌────────────────────┐                     │
│  │  Overlay Window     │  │  Settings Window    │                    │
│  │  ──────────────     │  │  ──────────────    │                     │
│  │  [Transcrição EN]   │  │  DeepL Key: [___]  │                     │
│  │  [Tradução PT]      │  │  TTS: [local▼]     │                     │
│  │  [ 🎤 Voz: ON/OFF ] │  │  API Key: [___]    │                     │
│  └────────────────────┘  └────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Fluxo de Dados Detalhado

### Modo Escuta (transcrição + tradução)

```
1. WASAPI Loopback captura áudio da saída padrão do Windows
2. VAD (Voice Activity Detection) filtra silêncio
3. Chunks de áudio (5s) são enviados para whisper_worker.py via stdin
4. Faster-Whisper transcreve (EN) e envia JSON para stdout
5. Main process recebe texto e envia para DeepL API
6. DeepL retorna tradução (PT-BR)
7. Main envia {original, tradução} para overlay via IPC
8. Overlay exibe na janela transparente
```

### Modo Voz (toggle ativado)

```
1. Usuário fala em português no microfone padrão
2. Áudio do microfone é capturado (WASAPI capture do mic)
3. Whisper transcreve o PT falado
4. Traduz PT→EN via DeepL
5. Texto EN enviado para openvoice_worker.py
6. OpenVoice sintetiza áudio com a voz clonada do usuário
7. Áudio PCM é reproduzido no dispositivo "CABLE Input"
8. App de chamada (Meet/Discord) captura "CABLE Output" como mic
```

---

## Estratégia de Latência

### Ordem de Grandeza Alvo

| Etapa | Modo Local (GPU) | Modo API |
|---|---|---|
| Captura áudio | ~50ms | ~50ms |
| VAD + buffer | ~50ms | ~50ms |
| Whisper transcrição | ~500-1000ms | ~300-500ms |
| DeepL tradução | ~300-500ms | ~300-500ms |
| OpenVoice síntese | ~1000-2000ms | — |
| API TTS | — | ~500-1000ms |
| Injeção VB-Cable | ~50ms | ~50ms |
| **Total** | **~2-3.5s** | **~1.2-2s** |

### Técnicas de Otimização

1. **Pipeline paralelo**: enquanto Whisper transcreve o chunk atual, o chunk anterior já está sendo traduzido
2. **Cache de tradução**: frases repetidas não chamam API
3. **Modelo tiny**: menor latência, qualidade aceitável
4. **Processo Python persistente**: modelo carregado uma vez, não recarregado
5. **Chunks sobrepostos**: overlapping de 50% para não perder início de fala

---

## Comunicação Inter-Processos

```
┌─────────────────────┐         IPC           ┌─────────────────────┐
│   Main Process      │◄──────────────────────►│   Renderer Process  │
│   (Node.js)         │   'transcription'      │   (Overlay UI)      │
│                     │   'translation'        │                     │
│                     │   'tts-status'         │                     │
│                     │   'config-changed'     │                     │
└────────┬────────────┘                       └─────────────────────┘
         │
    stdin/stdout (JSON)
         │
┌────────▼────────────┐
│  Python Workers     │
│                     │
│  whisper_worker.py  │
│  openvoice_worker.py│
│                     │
│  stdin:  PCM áudio  │
│  stdout: JSON/PCM   │
└─────────────────────┘
```

---

## Gerenciamento de Estado

```typescript
interface AppState {
  status: 'idle' | 'listening' | 'transcribing' | 'translating' | 'speaking';
  transcription: string;
  translation: string;
  ttsActive: boolean;
  latency: {
    capture: number;
    stt: number;
    translation: number;
    tts: number;
    total: number;
  };
  config: Config;
}
```

---

## Segurança

- **DeepL API key**: armazenada em config.json (não versionada)
- **API keys de TTS**: armazenadas em config.json
- **Áudio**: processado localmente, não enviado para servidores externos (exceto DeepL)
- **Voz clonada**: embedding salvo localmente, não compartilhado

---

## Decisões de Arquitetura (ADRs)

### ADR-1: Electron vs Tauri
**Decisão:** Electron
**Motivo:** Ecossistema maduro, IPC simples, fácil integração com Python child process. Tauri (Rust) adicionaria complexidade desnecessária.

### ADR-2: Whisper local via Python vs ONNX Runtime
**Decisão:** Python child process com Faster-Whisper
**Motivo:** Faster-Whisper é 4x mais rápido que Whisper original, suporta CUDA na GTX 1050, e a comunicação via stdin/stdout é simples e confiável.

### ADR-3: DeepL API vs LLM local
**Decisão:** DeepL API Free
**Motivo:** Qualidade de tradução superior, 500k chars/mês grátis, latência <500ms. LLM local exigiria GPU adicional.

### ADR-4: OpenVoice vs Coqui XTTS
**Decisão:** OpenVoice V2
**Motivo:** MIT License, leve o suficiente para GTX 1050 4GB, clonagem instantânea com poucos segundos de áudio.
