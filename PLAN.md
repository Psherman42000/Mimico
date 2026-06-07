# Mimico — Plano de Desenvolvimento

## Visão Geral
App Windows em segundo plano que captura áudio do sistema, transcreve/traduz em tempo real, e oferece tradução de fala com voz clonada injetada em microfone virtual.

## Stack Sugerida
| Componente | Tecnologia |
|---|---|
| Interface/Overlay | **Electron** (ou Tauri) — janela transparente, bandeja do sistema |
| Captura de áudio | **WASAPI Loopback** (Windows API) via `node-win-audio` ou `audio-capture` |
| Transcrição | **Whisper** (local via `whisper.cpp` ou `faster-whisper`) |
| Tradução | **LLM local** (via Ollama/hermes) ou **API** (Google Translate, DeepL, OpenAI) |
| Clonagem de voz | **ElevenLabs** (API) ou **OpenAI TTS** ou **Coqui.ai** (local) |
| Microfone virtual | **VB-Cable** ou **Virtual Audio Cable** (driver separado) |
| Overlay invisível | Win32 `WS_EX_LAYERED \| WS_EX_TRANSPARENT \| WS_EX_TOOLWINDOW` + `SetWindowDisplayAffinity` |

## Fases

### Fase 1 — Fundação
- [x] Criar repositório + configurar remote GitHub
- [ ] Setup do projeto (Electron + TypeScript)
- [ ] Bandeja do sistema com ícone funcional
- [ ] Janela overlay transparente (sempre no topo, invisível em captura)
- [ ] Estrutura de configuração (persistir preferências)

### Fase 2 — Captura + Transcrição
- [ ] Integrar WASAPI loopback para capturar áudio do sistema
- [ ] Buffer de áudio circular (últimos N segundos)
- [ ] Integrar Whisper (local) para transcrição contínua
- [ ] Exibir transcrição no overlay

### Fase 3 — Tradução
- [ ] Detecção automática de idioma (inglês → português)
- [ ] Integrar engine de tradução (local ou API)
- [ ] Exibir tradução lado a lado no overlay
- [ ] Ajustes de UI (fonte, tamanho, posição)

### Fase 4 — Voz Clonada (Toggle)
- [ ] Captura do microfone do usuário
- [ ] Clonagem de voz única (setup inicial - gravar amostra)
- [ ] Pipeline: PT falado → transcrição PT → tradução EN → TTS com voz clonada
- [ ] Injeção em microfone virtual (VB-Cable)

### Fase 5 — Polimento
- [ ] Performance (latência < 2s no pipeline completo)
- [ ] Instalador /打包
- [ ] Documentação de uso
- [ ] Testes com Meet, Squad, Discord

## Wireframe da Miniatura / Overlay

```
┌──────────────────────┐
│  🔊 [===] ⚙️ 🎤      │ <- barra minimalista
│  EN: "Hello world"   │ <- transcrição original
│  PT: "Olá mundo"     │ <- tradução
│                      │
│  [🎤 Voz Clonada: ON]│ <- toggle
└──────────────────────┘
```

A miniatura é uma janela sem borda, semi-transparente, que usa `WS_EX_TOOLWINDOW` + `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` para não aparecer em gravações/streams.

## Decisões Pendentes
1. **Engine de tradução**: API (Google/DeepL/OpenAI) vs local (Ollama)?
2. **Clonagem de voz**: ElevenLabs API vs Coqui.ai local vs OpenAI TTS?
3. **Setup da voz**: gravar amostra na primeira execução ou ter amostra pré-gravada?
4. **Instalação do driver de microfone virtual**: incluir VB-Cable no instalador ou instruir manual?
