# Mimico — Plano de Desenvolvimento

> **Atualizado em:** Junho 2026
> **Stack principal:** Electron + TypeScript + Win32 API
> **Pipeline de áudio:** WASAPI Loopback → Faster-Whisper → DeepL → OpenVoice → VB-Cable

---

## Sumário

- [Fase 0 — Setup do Projeto](#fase-0--setup-do-projeto)
- [Fase 1 — Bandeja + Overlay](#fase-1--bandeja--overlay-invisível)
- [Fase 2 — Captura de Áudio](#fase-2--captura-de-áudio-wasapi-loopback)
- [Fase 3 — Transcrição (Whisper)](#fase-3--transcrição-faster-whisper)
- [Fase 4 — Tradução (DeepL)](#fase-4--tradução-deepl-api)
- [Fase 5 — Voz Clonada (OpenVoice)](#fase-5--voz-clonada-openvoice)
- [Fase 6 — Microfone Virtual (VB-Cable)](#fase-6--microfone-virtual-vb-cable)
- [Fase 7 — Fallback para API Paga](#fase-7--fallback-para-api-paga)
- [Fase 8 — Configuração + UX](#fase-8--configuração--experiência-do-usuário)
- [Fase 9 — Polimento + Instalador](#fase-9--polimento--instalador)

---

## Pré-requisitos de Hardware

| Componente | Mínimo | Recomendado |
|---|---|---|
| CPU | x64, 4+ cores | Xeon E5-2670 v3 (12c) ✅ |
| RAM | 8 GB | 32 GB ✅ |
| GPU (modo local) | NVIDIA GTX 1050 4GB | GTX 1050 4GB ✅ |
| GPU (modo API) | N/A (tudo em nuvem) | N/A |
| SO | Windows 10/11 | Windows 10/11 ✅ |
| Microfone Virtual | VB-Cable (grátis) | VB-Cable |

> **Estratégia:** Tudo local por padrão. Se a latência ultrapassar 3s, o usuário pode ativar fallback para API paga via configuração.

---

## Fase 0 — Setup do Projeto

### Objetivo
Iniciar o projeto Electron + TypeScript com estrutura de pastas, configurações de build, lint e CI.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 0.1 | Inicializar projeto | `npm init`, Electron + TypeScript, `tsconfig.json` | Build compila sem erros |
| 0.2 | Estrutura de pastas | `/src/main/`, `/src/renderer/`, `/src/shared/`, `/docs/` | Pastas criadas, exports organizados |
| 0.3 | ESLint + Prettier | Configurar lint e formatação | `npm run lint` passa limpo |
| 0.4 | Git ignore + editorconfig | `.gitignore`, `.editorconfig` | Arquivos de build/node_modules ignorados |
| 0.5 | Commit inicial | `git add -A && git commit` | Histórico limpo no GitHub |

### Arquivos a criar
- `package.json`
- `tsconfig.json`
- `.eslintrc.json`
- `.prettierrc`
- `.gitignore`
- `src/main/main.ts` (entrypoint Electron)
- `src/renderer/index.html`
- `src/renderer/renderer.ts`

---

## Fase 1 — Bandeja + Overlay Invisível

### Objetivo
App Electron com ícone na bandeja do sistema e janela overlay transparente que **não aparece em gravação/stream de tela**.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 1.1 | Tray icon | Ícone na system tray com menu (Sair, Mostrar/Ocultar, Config) | Ícone aparece ao iniciar, menu funcional |
| 1.2 | Janela overlay | `BrowserWindow` transparente, sem borda, redimensionável | Janela aparece sobre outros apps |
| 1.3 | Invisível em captura | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` + `WS_EX_TOOLWINDOW` | Janela some ao gravar tela (OBS/Meet/Discord) |
| 1.4 | Sempre no topo | `alwaysOnTop` com `skipTaskbar` | Janela sempre visível, sem aparecer na barra de tarefas |
| 1.5 | Arrastar / posicionar | Clique e arraste para mover a janela | Usuário pode reposicionar livremente |
| 1.6 | Minimizar para tray | Fechar minimize para tray ao invés de fechar | App continua rodando mesmo com overlay fechado |

### Detalhamento Técnico

```typescript
// main.ts — Configuração da janela overlay
const overlay = new BrowserWindow({
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: true,
  width: 400,
  height: 300,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
  },
});

// Win32: invisível em captura de tela
const HWND = overlay.getNativeWindowHandle();
const WDA_EXCLUDEFROMCAPTURE = 0x00000011;
SetWindowDisplayAffinity(HWND, WDA_EXCLUDEFROMCAPTURE);
```

---

## Fase 2 — Captura de Áudio (WASAPI Loopback)

### Objetivo
Capturar todo áudio que sai do sistema (Meet, Squad, Discord, YouTube, etc.) em tempo real.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 2.1 | WASAPI loopback bindings | Native addon ou Node.js bindings para WASAPI | Captura áudio do dispositivo padrão de saída |
| 2.2 | Buffer circular | Ring buffer de ~30s para processamento | Buffer não perde áudio, sobrescreve mais antigo |
| 2.3 | Stream contínuo | Thread separada capturando em chunks de ~5s | Não bloqueia UI, captura sem gaps |
| 2.4 | VAD (detecção de voz) | Detectar quando há fala vs silêncio | Só processa quando detecta voz ativa |
| 2.5 | Controle de volume | Ajustar ganho/volume da captura | Volume configurável |

### Detalhamento Técnico

**Opções de implementação (por ordem de preferência):**
1. `mic-stream` (Node.js, WASAPI loopback nativo) — mais simples
2. `node-win-audio` + `node-audio-capture` — bindings nativos
3. Python child process com `pyaudio` (WASAPI) — fallback

**Pipeline de áudio:**
```
WASAPI Loopback → Buffer de 16-bit PCM 16kHz mono → VAD → Chunk 30s → Whisper
```

---

## Fase 3 — Transcrição (Faster-Whisper)

### Objetivo
Transcrever o áudio capturado usando Faster-Whisper com aceleração GPU (CUDA na GTX 1050) ou CPU.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 3.1 | Integrar Faster-Whisper | Python child process ou ONNX runtime | Modelo carrega e transcreve em <2s |
| 3.2 | Model tiny/base/local | Usar modelo `tiny` ou `base` para baixa latência | Transcrição em ~0.5-1s na GPU |
| 3.3 | GPU detection | Detectar CUDA disponível, fallback CPU se não | Roda em GPU se GTX 1050 presente |
| 3.4 | Processamento contínuo | A cada chunk detectado, enviar para transcrição | Transcreve em tempo real, sem acumular |
| 3.5 | Result streaming | Enviar texto transcrito para o renderer via IPC | Overlay atualiza sem delay perceptível |

### Detalhamento Técnico

```typescript
// Comunicação com processo Python Whisper
const whisperProcess = spawn('python', ['whisper_worker.py'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Envia áudio via stdin (PCM)
whisperProcess.stdin.write(audioChunk);

// Recebe transcrição via stdout (JSON)
whisperProcess.stdout.on('data', (data) => {
  const { text, language, segments } = JSON.parse(data);
  overlay.webContents.send('transcription', text);
});
```

**Modelos e latência estimada (GTX 1050 4GB):**

| Modelo | Params | VRAM | Latência GPU | Latência CPU |
|---|---|---|---|---|
| `tiny` | 39M | ~1GB | **~0.5s** | ~1-2s |
| `base` | 74M | ~1.5GB | **~0.8s** | ~2-3s |
| `small` | 244M | ~2.5GB | ~2s | ~5-8s |

> **Recomendação:** Começar com `tiny` na GPU. Se qualidade for baixa, subir para `base`.

---

## Fase 4 — Tradução (DeepL API)

### Objetivo
Traduzir o texto transcrito (inglês → português) em tempo real usando DeepL API Free.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 4.1 | DeepL Free API key | Usuário cria conta grátis em deepl.com | Chave configurada no settings |
| 4.2 | Cliente HTTP | Chamada REST para `POST /v2/translate` | Tradução em ~0.5-1s |
| 4.3 | Cache de traduções | Evitar re-traduzir frases repetidas (LRU cache) | Menos chamadas de API, resposta instantânea para frases conhecidas |
| 4.4 | Detecção de idioma | Só traduzir se detectar inglês | Não traduz português para português |
| 4.5 | Fallback de tradução | Se DeepL falhar, tentar Google Translate Free | Nunca quebrar o fluxo |

### Detalhamento Técnico

```typescript
interface TranslationResult {
  text: string;
  detectedSource: string;
  confidence: number;
}

async function translate(text: string): Promise<TranslationResult> {
  // LRU cache check
  const cached = translationCache.get(text);
  if (cached) return cached;

  const response = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { 'Authorization': `DeepL-Auth-Key ${API_KEY}` },
    body: new URLSearchParams({
      text,
      target_lang: 'PT-BR',
      source_lang: 'EN',
    }),
  });

  const data = await response.json();
  const result = { text: data.translations[0].text, detectedSource: 'EN', confidence: 1 };
  translationCache.set(text, result);
  return result;
}
```

**Limites DeepL Free:** 500k caracteres/mês. Suficiente para uso moderado.

---

## Fase 5 — Voz Clonada (OpenVoice)

### Objetivo
Clonar a voz do usuário e sintetizar fala em inglês com a voz clonada, rodando localmente na GPU.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 5.1 | Instalar OpenVoice V2 | Setup Python + checkpoint | Modelo carrega sem erros |
| 5.2 | Gravação de amostra | Gravar 30s da voz do usuário para clonagem | Áudio limpo, sem ruído de fundo |
| 5.3 | Clonagem inicial | Processar amostra e gerar voice embedding | Voz reconhecível como a do usuário |
| 5.4 | Pipeline PT→EN→Voz | Texto PT → traduzir EN → sintetizar com voz clonada | Pipeline completo em <3s |
| 5.5 | Streaming de áudio | Gerar áudio em chunks e enviar para VB-Cable | Áudio começa em <1s após texto |
| 5.6 | Botão toggle | Ativar/desativar voz clonada na overlay | Ao desativar, app só traduz sem falar |

### Detalhamento Técnico

```python
# OpenVoice worker (whisper_worker.py + openvoice_worker.py)
from openvoice import OpenVoice

# Carrega modelo uma vez
model = OpenVoice.load('checkpoints/v2')

# Clonagem (uma vez)
voice_embedding = model.clone_voice('user_sample.wav')

# Síntese
audio = model.synthesize(
    text="Hello, how are you?",
    voice=voice_embedding,
    language="EN"
)
```

### Quando usar OpenVoice vs fallback API

| Situação | Ação |
|---|---|
| OpenVoice carrega + GPU disponível | ✅ Usa local ($0) |
| OpenVoice falha ou GPU insuficiente | ⚠️ Fallback para API |
| Latência local > 3s | ⚠️ Fallback para API |

---

## Fase 6 — Microfone Virtual (VB-Cable)

### Objetivo
Injetar o áudio sintetizado em um microfone virtual para que apps de chamada (Meet, Discord) o usem como entrada.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 6.1 | Detectar VB-Cable | Verificar se driver VB-Cable está instalado | Mostra aviso se não estiver |
| 6.2 | Playback no VB-Cable | Reproduzir áudio no dispositivo "CABLE Input" | Áudio sai no VB-Cable |
| 6.3 | Latência de injeção | Buffer pequeno para baixa latência | Áudio injetado em <100ms |
| 6.4 | Seleção de dispositivo | Configurar qual dispositivo de saída usar | Usuário pode escolher |

### Instalação do VB-Cable
- Download gratuito em: https://vb-audio.com/Cable/
- Instalação simples (next, next, finish)
- Aparece como "CABLE Output" (entrada) e "CABLE Input" (saída)

---

## Fase 7 — Fallback para API Paga

### Objetivo
Se o modo local não atingir latência <3s, permitir configurar API externa para TTS com voz clonada.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 7.1 | Cartesia API provider | Integrar API Cartesia ($4/mês) para TTS | Voz gerada via API em <1s |
| 7.2 | Fish.audio provider | Integrar API Fish.audio ($11/mês) | Alternativa mais barata que ElevenLabs |
| 7.3 | OpenAI TTS provider | Integrar OpenAI TTS (sem clonagem) | Fallback se clonagem não for necessária |
| 7.4 | Provider selector | Config que define qual API usar | Troca sem reiniciar app |
| 7.5 | Latency benchmark | App testa latência e sugere troca | Notificação se local > 3s |

### Configuração de Provider

```json
{
  "tts": {
    "mode": "local",               // "local" | "api"
    "provider": "cartesia",         // "cartesia" | "fish" | "openai"
    "api_key": "sk-...",
    "fallback_on_latency": true,     // auto fallback se > 3s
    "latency_threshold_ms": 3000
  }
}
```

---

## Fase 8 — Configuração + Experiência do Usuário

### Objetivo
Tela de configurações intuitiva, persistência de preferências, onboarding.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 8.1 | Tela de configuração | Janela de settings acessível pelo tray | Configurações persistem entre sessões |
| 8.2 | DeepL API key input | Campo para chave da API | Valida se chave é válida |
| 8.3 | Provider selector | Dropdown para escolher TTS provider | Troca de provider funcional |
| 8.4 | Gravação de voz | Botão "Gravar minha voz" na primeira execução | Guia o usuário a gravar 30s |
| 8.5 | Auto-start | Opção de iniciar com Windows | App inicia automaticamente |
| 8.6 | Hotkey global | Tecla de atalho para mostrar/ocultar overlay | Funciona mesmo com app em background |
| 8.7 | Teste de latência | Botão "Testar latência" | Executa pipeline e mostra tempo |

### Arquivo de Configuração

**Localização:** `%APPDATA%/Mimico/config.json`

```json
{
  "deepL_key": "",
  "tts_mode": "local",
  "tts_provider": "cartesia",
  "tts_api_key": "",
  "voice_sample_path": "",
  "overlay_position": { "x": 100, "y": 100 },
  "overlay_opacity": 0.8,
  "auto_start": false,
  "hotkey": "Ctrl+Shift+M",
  "language": {
    "source": "en",
    "target": "pt-BR"
  }
}
```

---

## Fase 9 — Polimento + Instalador

### Objetivo
Empacotar o app para distribuição, tratamento de erros, logs.

### Tasks

| # | Tarefa | Descrição | Critério de Aceite |
|---|---|---|---|
| 9.1 | Error handling | Try/catch em todo pipeline, alertas visuais | App nunca crasha silenciosamente |
| 9.2 | Logging | Logs rotativos em `%APPDATA%/Mimico/logs/` | Debug de problemas possível |
| 9.3 | Instalador | electron-builder para gerar `.exe` instalável | Instala em qualquer Windows 10+ |
| 9.4 | Auto-update | update-events ou Squirrel para updates automáticos | App atualiza sozinho |
| 9.5 | Performance monitor | Exibir FPS/latência no overlay (modo debug) | Métricas visíveis para tuning |

---

## Diagrama de Fluxo do Pipeline

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ WASAPI   │───▶│  VAD     │───▶│ Whisper  │───▶│  DeepL   │───▶│ Overlay  │
│ Loopback │    │ Detector │    │ (GPU)    │    │  (API)   │    │ Display  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                                    │
                                                    ┌──────────┐    │
                                                    │ TTS      │◀───┘ (se toggle ativo)
                                                    │ Generator│
                                                    └────┬─────┘
                                                         │
                                                    ┌────▼─────┐
                                                    │ VB-Cable │
                                                    │ (Mic     │
                                                    │ Virtual) │
                                                    └──────────┘
```

---

## Estrutura de Pastas do Projeto

```
Mimico/
├── src/
│   ├── main/              # Processo principal Electron
│   │   ├── main.ts        # Entrypoint
│   │   ├── tray.ts        # System tray
│   │   ├── overlay.ts     # Janela overlay
│   │   ├── wasapi.ts      # Captura de áudio
│   │   └── ipc-handlers.ts
│   ├── renderer/          # Interface do overlay
│   │   ├── index.html
│   │   ├── renderer.ts
│   │   ├── styles.css
│   │   └── components/
│   └── shared/            # Tipos e constantes compartilhadas
│       ├── types.ts
│       └── constants.ts
├── workers/               # Processos Python (Whisper, OpenVoice)
│   ├── whisper_worker.py
│   └── openvoice_worker.py
├── docs/                  # Documentação
│   ├── README.md
│   ├── PLAN.md
│   ├── ARCHITECTURE.md
│   └── GUIDE.md
├── scripts/               # Scripts auxiliares
├── test/
├── package.json
├── tsconfig.json
└── README.md
```

---

## Estimativa de Tempo

| Fase | Horas estimadas | Complexidade |
|---|---|---|
| 0 — Setup | 1h | Baixa |
| 1 — Bandeja + Overlay | 4h | Média |
| 2 — Captura WASAPI | 6h | Alta |
| 3 — Transcrição Whisper | 6h | Alta |
| 4 — Tradução DeepL | 3h | Média |
| 5 — Voz Clonada OpenVoice | 8h | Muito Alta |
| 6 — Microfone Virtual | 2h | Baixa |
| 7 — Fallback API | 4h | Média |
| 8 — Config + UX | 4h | Média |
| 9 — Polimento + Instalador | 4h | Média |
| **Total** | **~42h** | |

---

## Revisão do Plano

Este plano deve ser revisado por um desenvolvedor sênior antes do início da implementação. Pontos críticos para review:

1. **Escolha do Electron vs Tauri** — Electron é mais pesado mas tem ecossistema maior. Tauri seria mais leve (Rust) mas requer bindings WASAPI em Rust.
2. **Comunicação Python ↔ Electron** — child process via stdin/stdout vs socket vs IPC nativo.
3. **Modelo Whisper tiny vs base** — tradeoff entre latência e precisão.
4. **OpenVoice V2 funcionando na GTX 1050 4GB** — verificar VRAM suficiente.
5. **Tratamento de áudio em tempo real** — buffer strategy, thread safety.

### Para o Revisor

Ao revisar este plano, verificar:
- [ ] A arquitetura atende aos requisitos de latência < 3s?
- [ ] A escolha de componentes (Electron, Whisper, DeepL, OpenVoice) é adequada?
- [ ] O fallback API está bem desenhado?
- [ ] A invisibilidade em captura de tela está correta?
- [ ] A estratégia de microfone virtual cobre todos os cenários?
- [ ] O plano de testes está claro?
- [ ] A estimativa de horas é realista?
