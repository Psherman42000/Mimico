# 🎤 Mimico — Transcrição & Tradução em Tempo Real

**Mimico** é um aplicativo de desktop para Windows que captura áudio do sistema (Google Meet, Discord, Squad, YouTube, etc.), transcreve em tempo real com inteligência local, traduz automaticamente e exibe legendas sobrepostas na tela — tudo **sem depender de nuvem** para transcrição.

## ✨ Funcionalidades

- **Captura de áudio do sistema** — WASAPI loopback captura qualquer áudio saindo do PC
- **Transcrição local** — Faster-Whisper roda na sua GPU/CPU, sem enviar áudio pra ninguém
- **Tradução automática** — DeepL API (plano Free: 500k caracteres/mês)
- **Overlay invisível** — Legendas EN 🇺🇸 + PT 🇧🇷 em janela transparente que ignora cliques
- **Modo voz (opcional)** — Edge TTS sintetiza a tradução e injeta no microfone virtual via VB-Cable
- **Funciona em segundo plano** — Ícone na bandeja do Windows, não atrapalha o trabalho
- **Invisível em compartilhamento de tela** — A janela de legendas NÃO aparece quando você compartilha a tela
- **Custo mensal: $0** — Todas as ferramentas usadas têm planos gratuitos

## 🖥️ Visual do Overlay

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│                                                      │
│                                                      │
│                                                      │
│                    ┌──────────────────────┐          │
│                    │ 🇺🇸 Let's review the │          │
│                    │    Q3 projections    │          │
│                    │                      │          │
│                    │ 🇧🇷 Vamos revisar as │          │
│                    │   projeções do Q3    │          │
│                    └──────────────────────┘          │
└──────────────────────────────────────────────────────┘
```

### Detalhes do visual

| Característica | Descrição |
|---|---|
| **Posição** | Canto inferior direito da tela |
| **Tamanho** | ~400×120px, bordas arredondadas (12px) |
| **Fundo** | Preto com opacidade 70% (`rgba(0,0,0,0.7)`) |
| **Texto EN** | Ciano brilhante (`#00ffff`), fonte monospace |
| **Texto PT** | Verde brilhante (`#00ff00`), fonte monospace |
| **Ícone bandeja** | 🎤 Verde = ativo / 🔴 Vermelho = pausado |
| **Fade automático** | Some suavemente após 3s de silêncio |
| **Ao clique** | A janela **ignora cliques** — você clica "através" dela |

### Interação

- **Clique direito no ícone da bandeja**: menu com Toggle ON/OFF, Configurações, Sair
- **Atalhos de teclado**: `Alt+Shift+M` (liga/desliga), `Alt+Shift+O` (mostra overlay)
- **Toggle 🎤 ON**: ativa o retorno por voz (TTS → VB-Cable → Meet ouve sua voz traduzindo)

## 🔧 Pipeline Completo

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────────┐
│ Áudio do    │────▶│ WASAPI       │────▶│ Faster-    │────▶│ DeepL API    │
│ Sistema     │     │ Loopback     │     │ Whisper    │     │ (tradução)   │
│ (Meet,      │     │ (16kHz mono) │     │ (tiny/base)│     │ EN → PT      │
│ Discord...) │     │              │     │ ~100ms GPU │     │ ~500ms       │
└─────────────┘     └──────────────┘     └───────────┘     └──────┬───────┘
                                                                  │
                                                                  ▼
                                    ┌──────────────────────────────────────┐
                                    │         Overlay de Legendas          │
                                    │  🇺🇸 EN (cyan) + 🇧🇷 PT (verde)       │
                                    └──────────┬───────────────────────────┘
                                               │
                              ┌────────────────┴────────────────┐
                              │                                 │
                              ▼                                 ▼
                        (Toggle 🎤 OFF)                  (Toggle 🎤 ON)
                    Apenas exibe legenda         Edge TTS sintetiza voz
                                                  ──────────┼──────────
                                                            ▼
                                                     VB-Cable (microfone
                                                     virtual) → Meet ouve
```

## 📥 Instalação

### Pré-requisitos (instalação manual obrigatória)

> ⚠️ O instalador do Mimico NÃO consegue automatizar estes itens:

| Item | Por que é manual | Onde baixar |
|---|---|---|
| **VB-Cable** | Driver de áudio virtual proprietário (VB-Audio). Não pode ser redistribuído. | [vb-audio.com/Cable/](https://vb-audio.com/Cable/) (versão FREE funciona) |
| **DeepL API Key** | Precisa criar conta gratuita para obter a chave. | [deepl.com/pro-api](https://www.deepl.com/pro-api) (Free: 500k chars/mês) |
| **CUDA Toolkit** *(opcional)* | Só necessário se quiser aceleração GPU. Funciona sem (CPU apenas). | NVIDIA CUDA Toolkit 11.x+ |

**Tempo total para configurar manualmente:** ~5 minutos.

### O que o instalador faz automaticamente ✅

| O quê | Como |
|---|---|
| Aplicativo Electron + dependências JS | Bundado no .exe (Electron Builder NSIS) |
| Python 3 embutido + pacotes pip | `pip install faster-whisper edge-tts sounddevice numpy soundfile` |
| Modelo Faster-Whisper (tiny) | Download automático na primeira execução (~1.5GB uma vez) |
| Arquivo de configuração | Criado vazio — você só cola a chave DeepL |
| Atalho no Desktop / Iniciar com Windows | Configurável pelo instalador NSIS |

### Instalação passo a passo

1. **Baixe e instale o VB-Cable FREE** — next-next-finish, 10 segundos
2. **Crie sua conta DeepL API Free** — gere sua chave de API
3. **Baixe o instalador Mimico** (link disponível após build)
4. **Execute o instalador** — next-next-finish
5. **Abra o Mimico** pela primeira vez — ele baixa o modelo Whisper (~1.5GB)
6. **Cole sua chave DeepL** nas configurações (clique direito na bandeja → Configurações)
7. **Pronto!** ✅ Teste abrindo um vídeo no YouTube com legenda em inglês

### Dependências Python (instaladas automaticamente)

```
faster-whisper    → Transcrição local (GPU/CPU)
edge-tts          → Síntese de voz gratuita (Microsoft Edge TTS)
sounddevice       → Captura e reprodução de áudio (WASAPI)
numpy             → Processamento de áudio
soundfile         → Leitura/escrita WAV
```

## 🎮 Como Usar

1. **Abra o Mimico** — aparece o ícone 🎤 verde na bandeja
2. **Entre em uma reunião** (Meet, Discord, Squad) ou abra um vídeo
3. **As legendas aparecem automaticamente** no canto inferior direito
4. **Se quiser que sua voz traduza em tempo real**:
   - Vá nas configurações e ative "Toggle Voice Output"
   - No Meet/Discord, selecione "CABLE Input" como microfone
   - Agora quando você fala em português, a tradução em inglês é injetada no microfone virtual
5. **Para pausar**: clique direito na bandeja → Toggle OFF (ou `Alt+Shift+M`)

## 🔒 Privacidade

- A transcrição (Faster-Whisper) roda **100% local** — nenhum áudio sai do seu PC
- A tradução usa DeepL API — apenas o texto transcrito é enviado (não o áudio)
- Nenhum dado é armazenado em servidores externos
- Código aberto — você pode auditar cada linha

## ⚙️ Configurações

| Opção | Default | Descrição |
|---|---|---|
| `deepKey` | `""` | Chave da API DeepL Free |
| `targetLang` | `"PT"` | Idioma de tradução (PT, EN, ES, FR, DE, IT) |
| `toggleVoice` | `false` | Ativar retorno por voz (TTS → VB-Cable) |
| `overlayOpacity` | `0.7` | Opacidade do fundo do overlay (0.0 — 1.0) |
| `whisperModelSize` | `"tiny"` | Modelo Whisper: tiny, base, small, medium |
| `vbcableDevice` | `"CABLE Input"` | Nome do dispositivo VB-Cable |
| `hotkeyToggle` | `"Alt+Shift+M"` | Atalho para ligar/desligar |
| `hotkeyOverlay` | `"Alt+Shift+O"` | Atalho para mostrar overlay |

## 🏗️ Estrutura do Projeto

```
Mimico/
├── src/main/
│   ├── main.ts              ← Pipeline orquestrador principal
│   ├── overlay.ts           ← Janela transparente de legendas
│   ├── tray.ts              ← Ícone na bandeja do sistema
│   ├── config.ts            ← Configuração persistente (electron-store)
│   ├── preload.ts           ← Ponte IPC segura (contextBridge)
│   ├── win32-overlay.ts     ← Win32 API (click-through, invisível)
│   ├── audio-capture.ts     ← Gerencia worker WASAPI loopback
│   ├── whisper-manager.ts   ← Gerencia worker Faster-Whisper
│   ├── translator.ts        ← DeepL API + cache LRU
│   ├── voice-manager.ts     ← Edge TTS
│   └── audio-output.ts      ← VB-Cable playback
├── workers/
│   ├── audio_capture.py     ← WASAPI loopback capture
│   ├── whisper_worker.py    ← Faster-Whisper transcription
│   ├── voice_worker.py      ← Edge TTS synthesis
│   └── audio_output.py      ← VB-Cable audio output
├── package.json             ← Dependências e scripts
├── tsconfig.json            ← Config TypeScript
├── electron-builder.yml     ← Config do instalador Windows
└── README.md                ← Este arquivo
```

## 🧪 Requisitos de Hardware

| Componente | Mínimo | Recomendado |
|---|---|---|
| **CPU** | Qualquer x64 | Intel i5 / AMD Ryzen 5 |
| **RAM** | 4 GB | 8 GB+ |
| **GPU** | Qualquer (CPU mode) | NVIDIA GTX 1050+ (CUDA) |
| **Armazenamento** | 2 GB livres | 5 GB (para modelos) |
| **SO** | Windows 10/11 x64 | Windows 11 |
| **Áudio** | Qualquer placa de som | — |

## ⚡ Performance Estimada

| Configuração | Latência (transcrição) | VRAM | Observação |
|---|---|---|---|
| CPU + tiny | ~2-3s por frase | 0 GB | Funciona em qualquer PC |
| GPU (GTX 1050) + tiny | ~100-200ms | ~1 GB | ✅ Recomendado |
| GPU (GTX 1050) + base | ~300-500ms | ~1.5 GB | Mais preciso |
| GPU (RTX 3060+) + small | ~200-300ms | ~2.5 GB | Melhor qualidade |

## 🔄 Estado do Projeto

| Fase | Status | Componente |
|---|---|---|
| 0-1 | ✅ | Electron + overlay invisível + bandeja |
| 2 | ✅ | WASAPI loopback + VAD |
| 3 | ✅ | Faster-Whisper tiny GPU/CPU |
| 4 | ✅ | DeepL Free API + cache LRU |
| 5 | ✅ | Edge TTS + VoiceManager |
| 6 | ✅ | VB-Cable + AudioOutput |
| 7 | ✅ | Empacotamento Electron |
| 8 | 🔜 | Instalador Windows (NSIS) |
| 9 | 🔜 | Testes e ajustes finos |

---

**Desenvolvido por Pedro** — Automatizando o que dá pra automatizar, com honestidade sobre o que não dá. 🚀
