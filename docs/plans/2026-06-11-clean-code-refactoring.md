# Plano de Refatoração Clean Code — Mimico

> **Objetivo:** Aplicar os princípios do Clean Code (Robert C. Martin) no código TypeScript do Mimico, reduzindo duplicação, complexidade ciclomática e melhorando legibilidade.
>
> **Escopo:** `src/main/*.ts` (27 arquivos). Python workers fora do escopo.
>
> **Skill de referência:** `clean-code` + `electron-windows-apps` (Code Quality Standards)

---

## Diagnóstico: Violações Encontradas

### 🔴 ALTA PRIORIDADE

| # | Violação | Princípio | Arquivos Afetados |
|---|----------|-----------|-------------------|
| 1 | **DRY: Duplicação quase total** entre audio-capture e mic-capture | Ch12: Emergência — "No duplication" | `audio-capture.ts`, `mic-capture.ts` |
| 2 | **DRY: waitForReady duplicado** em 4+ arquivos | Ch12 | `audio-capture.ts`, `mic-capture.ts`, `audio-output.ts`, `whisper-manager.ts` |
| 3 | **DRY: sendCommand duplicado** em 3 arquivos | Ch12 | `audio-capture.ts`, `mic-capture.ts`, `audio-output.ts` |
| 4 | **DRY: setup de processo Python repetido** spawn + readline + stderr + exit + error em 4 arquivos | Ch12 | `audio-capture.ts`, `mic-capture.ts`, `audio-output.ts`, `whisper-manager.ts` |
| 5 | **main.ts com 828 linhas** — faz TUDO (orquestração, IPC, shortcuts, cleanup, etc.) | Ch10: SRP — classes pequenas | `main.ts` |
| 6 | **Funções muito longas** — várias com 40-80 linhas | Ch3: Funções pequenas | `main.ts`, `audio-capture.ts`, `whisper-manager.ts`, `overlay.ts` |
| 7 | **applyConfigChanges()** — 43 linhas, 7+ responsabilidades | Ch3: Uma coisa só | `main.ts:368-410` |
| 8 | **setupModuleListeners()** — 94 linhas, 10+ listeners registrados | Ch3 | `main.ts:561-655` |

### 🟡 MÉDIA PRIORIDADE

| # | Violação | Princípio | Arquivos Afetados |
|---|----------|-----------|-------------------|
| 9 | **JSDoc inflado** — comentários óbvios que repetem o código (`/** Libera recursos. */` em `dispose()`) | Ch4: Comentários mentem | Quase todos os arquivos |
| 10 | **overlay.ts obsoleto** — substituído por notch-overlay.ts mas ainda existe com 402 linhas | Ch12: YAGNI | `overlay.ts` |
| 11 | **`as any` casts** — `const win: any = this.window` em overlay.ts | Ch2: Nomes significativos / strict TS | `overlay.ts:256` |
| 12 | **Empty handlers** — `setupIPC()` vazio, blur handler vazio | Ch3: Funções / Ch4: Comentários | `overlay.ts:244-246`, `overlay.ts:225-227` |
| 13 | **Promise chains frágeis** — `processAudioChunk()` com .then().then().catch() | Ch7: Error Handling | `main.ts:220-268`, `main.ts:277-303` |
| 14 | **Variável shadowing** — `isVisible` nome de campo privado vs método público | Ch2: Evitar desinformação | NotchOverlay / Overlay |
| 15 | **Código comentado ou semi-implementado** — `setMixMode()` só faz log | Ch4 / Ch12 | `audio-output.ts:431-439` |

### 🟢 BAIXA PRIORIDADE

| # | Violação | Princípio | Arquivos Afetados |
|---|----------|-----------|-------------------|
| 16 | **Timestamp helper duplicado** — `timestamp()` idêntico em 2 arquivos | Ch12 | `audio-capture.ts`, `mic-capture.ts` |
| 17 | **Nomes inconsistentes** — `isRunning` vs `running` vs `active` | Ch2 | `audio-capture.ts`, `mic-capture.ts`, `audio-output.ts` |
| 18 | **Missing TTS interface métodos** — `getVoices()` declarado na interface mas não usado | Ch12: YAGNI | `tts-provider.ts` |
| 19 | **`Record<string, unknown>` genérico** — usado como tipo de parâmetro | Ch6: Objetos vs Data Structures | `audio-capture.ts:93`, `mic-capture.ts:105` |

---

## Plano de Refatoração por Fase

### ⚙️ Fase 1: WorkerProcess Base Class (DRY)

**Objetivo:** Eliminar a maior violação — duplicação de gerenciamento de workers Python.

**Criar:** `src/main/worker-process.ts`

Extrair classe base abstrata que consolida:
- `spawn()` + readline setup
- `handleLine()` + JSON parse
- `sendCommand()` 
- `waitForReady()` com timeout
- stderr handler
- process exit/error handlers
- `stop()` com kill timeout
- `dispose()` com cleanup
- `running` getter

```typescript
// worker-process.ts — Classe base para todos os workers Python
export abstract class WorkerProcess extends EventEmitter {
  protected process: ChildProcess | null = null;
  protected readline: ReadlineInterface | null = null;
  protected isRunning = false;
  protected ready = false;
  protected abstract readonly workerName: string;
  protected abstract readonly scriptName: string;

  async start(args: string[] = []): Promise<void> { ... }
  protected abstract handleMessage(msg: Record<string, unknown>): void;
  protected sendCommand(command: string): void { ... }
  protected waitForReady(timeoutMs = 10_000): Promise<void> { ... }
  stop(): void { ... }
  dispose(): void { ... }
  get running(): boolean { return this.isRunning; }
  get isReady(): boolean { return this.ready; }
}
```

**Refatorar:**

| Arquivo | Ação |
|---------|------|
| `audio-capture.ts` | Estender `WorkerProcess`, implementar `handleMessage()` |
| `mic-capture.ts` | Estender `WorkerProcess`, implementar `handleMessage()` |
| `audio-output.ts` | Estender `WorkerProcess`, implementar `handleMessage()` |
| `whisper-manager.ts` | Estender `WorkerProcess`, implementar `handleMessage()` + request/response |

**Remover** destes 4 arquivos (agora na base):
- `PROJECT_ROOT`, `WORKER_READY_TIMEOUT`
- `timestamp()`, `sendCommand()`, `waitForReady()`
- Todo o boilerplate de spawn + readline + stderr + exit + error

---

### ⚙️ Fase 2: main.ts Decomposition (SRP)

**Objetivo:** Reduzir main.ts de 828 → ~200 linhas, extraindo responsabilidades.

**Criar:** `src/main/pipeline.ts`

Extrair toda lógica de pipeline:
- `startPipeline()` 
- `stopPipeline()`
- `togglePipeline()`
- `restartPipeline()`
- `processAudioChunk()`
- `processMicAudioChunk()`
- Estado: `isPipelineActive`, referências aos managers

```typescript
export class PipelineOrchestrator {
  constructor(
    private audioCapture: AudioCapture,
    private micCapture: MicCapture,
    private whisper: WhisperManager,
    private translator: Translator,
    private voiceManager: VoiceManager,
    private audioOutput: AudioOutput,
    private overlay: NotchOverlay,
    private config: () => Config,
  ) {}

  async start(mode: AppMode): Promise<void> { ... }
  stop(): void { ... }
  toggle(): void { ... }
  restart(): void { ... }
  get isActive(): boolean { return this._isActive; }
}
```

**Criar:** `src/main/app-lifecycle.ts`

Extrair ciclo de vida do Electron:
- `initLogFile()`, `appLog()` 
- Single instance lock
- `app.on('window-all-closed')`, `app.on('activate')`, `app.on('before-quit')`, `app.on('will-quit')`
- `cleanup()`
- `main()` fica como orchestrator fino

**Manter em main.ts apenas:**
- `main()` function (~40 linhas)
- `initializeModules()` (~15 linhas)  
- `registerGlobalShortcuts()` (~30 linhas)
- `setupIPC()` (~20 linhas)

---

### ⚙️ Fase 3: Error Handling Unificado (Ch7)

**Objetivo:** Substituir try/catch espalhado por wrapper centralizado.

**Criar:** `src/main/error-handler.ts`

```typescript
export function safeAsync<T>(fn: () => Promise<T>, onError: (err: Error) => void): Promise<T | undefined> {
  return fn().catch((err) => {
    onError(err instanceof Error ? err : new Error(String(err)));
    return undefined;
  });
}
```

**Aplicar em:** `main.ts`, `voice-manager.ts`, `translator.ts` — onde há `.catch()` repetitivos.

---

### ⚙️ Fase 4: Remover overlay.ts obsoleto (YAGNI)

**Objetivo:** Eliminar código morto.

- Deletar: `src/main/overlay.ts`
- Verificar imports — main.ts já usa `NotchOverlay`, não `Overlay`
- Verificar `preload.ts` se referencia algo do overlay antigo

---

### ⚙️ Fase 5: JSDoc Stripping (Ch4)

**Objetivo:** Remover comentários que não agregam valor. Código deve explicar a si mesmo.

**Regras:**
- Remover JSDoc de métodos óbvios (`dispose()`, `getOpacity()`, `show()`, `hide()`)
- Remover blocos de comentário no topo de arquivo que apenas repetem o que o código faz
- Manter JSDoc apenas em interfaces públicas e métodos com lógica não-trivial
- Remover seções de "separadores" visuais (`// ── Estado ──`) — se o método precisa de separador, está grande demais (Fase 2 já resolve)

---

### ⚙️ Fase 6: Promise Chains → Async/Await (Ch3, Ch7)

**Objetivo:** Substituir encadeamentos profundos de `.then().then().catch()` por async/await plano.

**Arquivos:** `main.ts:processAudioChunk()`, `main.ts:processMicAudioChunk()`

```typescript
// Antes (48 linhas, 3 níveis de callback):
function processAudioChunk(chunk: Buffer): void {
  whisperManager.transcribe(chunk)
    .then((enText) => translator.translate(enText, 'EN', config.language))
    .then((ptText) => { ... })
    .catch((error) => { ... });
}

// Depois (função async limpa):
async function processAudioChunk(chunk: Buffer): Promise<void> {
  if (!isPipelineActive) return;
  try {
    const enText = await whisperManager.transcribe(chunk);
    if (!enText?.trim()) return;
    const ptText = await translator.translate(enText, 'EN', config.language);
    overlay.updateText(enText, ptText);
    broadcastTranslationToSettings(enText, ptText);
    if (config.toggleVoice && !ptText.startsWith('[')) {
      await voiceManager.speakText(ptText, langMap[config.language] ?? 'pt-BR');
    }
  } catch (error) {
    appLog(`Transcription skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

---

### ⚙️ Fase 7: Tipos Fortes e Eliminar `as any` (Ch2, Ch6)

**Objetivo:** Zero `as any` no código TypeScript.

- `overlay.ts:getHWND()` — substituir `const win: any = this.window` por tipagem correta:
  ```typescript
  const hwndBuffer = this.window.getNativeWindowHandle();
  if (!hwndBuffer) return null;
  return hwndBuffer.readUInt32LE(0);
  ```
- `ipc/index.ts` — revisar interfaces de contexto para tipos concretos
- Criar `src/shared/types.ts` com tipos compartilhados entre main e renderer

---

### ⚙️ Fase 8: Refactor applyConfigChanges (Ch3)

**Objetivo:** Função de 43 linhas → 5 chamadas de método.

```typescript
// Antes: uma função que faz 7 coisas
function applyConfigChanges(): void {
  overlay.setOpacity(config.overlayOpacity);
  translator.setApiKey(config.deepKey);
  audioOutput.setMixMode(config.voiceMixMode);
  overlay.setMixMode(config.voiceMixMode);
  overlay.setMode(config.appMode);
  overlay.setTtsProvider(config.ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'Edge');
  overlay.setVoiceActive(config.toggleVoice);
  // ... hot-swap TTS ... (extrair para método próprio)
  // ... toggle voice ... (extrair para método próprio)
}
```

Extrair:
- `syncOverlayWithConfig()` — todas as 5 chamadas de overlay
- `syncAudioWithConfig()` — audio output + mic conforme toggleVoice
- `syncTtsProvider()` — TTS hot-swap (já existe como initTtsProvider)

---

## Verificação

Após cada fase, rodar:

```bash
npm run build           # Zero erros de TypeScript
npx eslint src/ --rule '{"complexity": ["warn", 10]}'   # CC ≤ 10 por função
```

### Metas Finais

| Métrica | Antes | Depois |
|---------|-------|--------|
| main.ts | 828 linhas | ~200 linhas |
| audio-capture.ts + mic-capture.ts | 317 + 342 = 659 linhas | ~80 + ~80 + WorkerProcess (~120) = ~280 linhas |
| overlay.ts | 402 linhas (obsoleto) | 0 (removido) |
| Funções > 40 linhas | 8+ | 0 |
| `as any` casts | 1+ | 0 |
| `Record<string, unknown>` params | 2+ | 0 |
| Complexidade ciclomática (por função) | Até ~17 | ≤ 10 |

---

## Ordem de Execução

```
Fase 1 (Worker Base) → npm run build → Commit "refactor: extract WorkerProcess base class"
Fase 2 (main.ts)     → npm run build → Commit "refactor: extract PipelineOrchestrator and AppLifecycle"
Fase 3 (Error)       → npm run build → Commit "refactor: centralized error handler"
Fase 4 (Dead code)   → npm run build → Commit "refactor: remove deprecated overlay.ts"
Fase 5 (Comments)    → npm run build → Commit "refactor: strip noisy JSDoc comments"
Fase 6 (Async/await) → npm run build → Commit "refactor: flatten promise chains to async/await"
Fase 7 (Types)       → npm run build → Commit "refactor: strong types, zero any casts"
Fase 8 (Config)      → npm run build → Commit "refactor: decompose applyConfigChanges"
```

Cada fase é independente e pode ser executada separadamente sem quebrar o build.
