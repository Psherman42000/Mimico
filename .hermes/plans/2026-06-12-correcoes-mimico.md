# Mimico — Plano de Correção

> **Para Hermes:** Executar tarefa por tarefa. Commitar após cada fase. Não re-perguntar entre fases.

**Objetivo:** Corrigir bugs, remover dead code e conectar funcionalidades quebradas identificadas na auditoria.

**Arquitetura:** Electron + TypeScript + Python workers. As correções são no TypeScript (main process + renderer) e no HTML do overlay/settings.

**Tech Stack:** Electron 33, TypeScript strict, Node.js built-ins (fetch, fs), HTML/CSS vanilla.

---

## Fase 1 — Stealth Mode: consertar tap toggle

### Task 1.1: Fazer tap do Ctrl+B alternar visibilidade

**Objetivo:** `toggleVisibility()` existe mas nunca é chamada. Tap curto (<650ms) deve alternar visibilidade do overlay.

**Arquivo:**
- Modificar: `src/main/visibility-controller.ts`

**Análise do fluxo atual (quebrado):**
```
handleKey() → idle → 'tapping', inicia tapTimer (650ms)
  → tapTimer expira → muda pra 'holding', inicia fade  ← ERRO: deveria chamar toggleVisibility()
  → segundo key press em 'holding' → releaseHold()    ← restaura opacidade
```

**Fluxo correto:**
```
handleKey() → idle → 'tapping', inicia tapTimer (650ms)
  → key press ANTES do tapTimer expirar → 'tap completed', chama toggleVisibility()
  → tapTimer EXPIRA sem segundo key press → 'holding', inicia fade
  → key press durante 'holding' → releaseHold()
```

**Step 1: Modificar `handleKey()`**

Substituir o case `'tapping'` para tratar segundo pressionamento como confirmação de tap:

```typescript
case 'tapping':
  // Segundo pressionamento rápido = confirma TAP (toggle visibility)
  if (this.tapTimer) clearTimeout(this.tapTimer);
  this.tapTimer = null;
  this.state = 'idle';
  this.toggleVisibility();
  break;
```

**Step 2: Remover transição automática de tapping → holding**

O timer atual faz transição `tapping → holding` automaticamente. Mas o hold só deve começar se o usuário CONTINUAR SEGURANDO após 650ms. Como `globalShortcut` não diferencia keydown/keyup, a lógica correta é:

- Primeiro keydown → `tapping`, timer 650ms
- Se timer expirar sem segundo keydown → `holding`, inicia fade
- Segundo keydown durante `tapping` → é TAP (toggleVisibility)
- Segundo keydown durante `holding` → releaseHold

Ou seja, o timer precisa **não** fazer a transição automática, e sim esperar que o usuário solte. Como não podemos detectar "soltar", o melhor approach com `globalShortcut` é:

- Primeiro keydown → inicia `tapping` + timer 650ms
- Segundo keydown ANTES do timer → `tapping` cancelado → toggleVisibility
- Timer expira → `holding` → inicia fade
- Terceiro keydown durante `holding` → releaseHold

Código:

```typescript
private handleKey(): void {
  this.target = this.getMainWindow();
  if (!this.target) return;

  const now = Date.now();

  switch (this.state) {
    case 'idle':
      // Primeiro pressionamento
      this.state = 'tapping';
      this.holdStartTime = now;
      this.wasHidden = !this.target.isVisible();

      // Se estava oculto, mostra imediatamente
      if (this.wasHidden) {
        this.target.show();
        this.target.setOpacity(this.target.getOpacity() || HOLD_INITIAL_OPACITY);
      }

      // Timer: se ninguém pressionar de novo, vira hold
      this.tapTimer = setTimeout(() => {
        if (this.state === 'tapping') {
          this.state = 'holding';
          this.startHoldFade();
        }
      }, TAP_DELAY);
      break;

    case 'tapping':
      // Segundo pressionamento rápido = TAP (toggle visibility)
      if (this.tapTimer) clearTimeout(this.tapTimer);
      this.tapTimer = null;
      this.state = 'idle';
      this.toggleVisibility();
      break;

    case 'holding':
      // Soltou durante hold → restaura opacidade
      this.releaseHold();
      break;
  }
}
```

**Step 3: Compilar e verificar**

```bash
cd /c/Users/user/Desktop/Mimico
npm run build
```

Esperado: `tsc` compila sem erros.

---

## Fase 2 — Remover dead code: mic-capture.ts

### Task 2.1: Deletar arquivo não utilizado

**Objetivo:** `src/main/mic-capture.ts` não é importado por nada. Foi substituído por `AudioCapture` unificado (fase 8 do Clean Code).

**Arquivo:**
- Remover: `src/main/mic-capture.ts`

**Step 1: Verificar que não há imports**

```bash
cd /c/Users/user/Desktop/Mimico
grep -r "mic-capture" src/ --include="*.ts"
```

Esperado: Nenhuma referência (só aparece no `AGENTS.md` e no `mimico-build` skill).

**Step 2: Deletar**

```bash
rm src/main/mic-capture.ts
```

**Step 3: Compilar**

```bash
npm run build
```

Esperado: `tsc` compila sem erros.

---

## Fase 3 — Adicionar sourceLang ao Config e ao pipeline

### Task 3.1: Adicionar campo sourceLang na interface Config

**Objetivo:** O settings.html salva `sourceLang` mas o Config não tem esse campo. O pipeline assume EN fixo.

**Arquivos:**
- Modificar: `src/main/config.ts`
- Modificar: `src/main/pipeline.ts`

**Step 1: Adicionar `sourceLang` ao Config**

Em `src/main/config.ts`, adicionar à interface:

```typescript
/** Idioma de origem (sistema) */
sourceLang: string;
```

E ao DEFAULT:

```typescript
sourceLang: 'EN',
```

**Step 2: Usar `sourceLang` no pipeline**

Em `src/main/pipeline.ts`, linha ~105 (`processAudioChunk`), usar `cfg.sourceLang` no lugar de EN hardcoded:

```typescript
const sourceLang = cfg.sourceLang || 'EN';
const enText = await this.whisper.transcribe(chunk, sourceLang !== 'EN' ? sourceLang.toLowerCase() : undefined);
```

**Step 3: Compilar**

```bash
npm run build
```

---

## Fase 4 — Tray focar Settings Window

### Task 4.1: Tray ao clicar abre settings em vez de tentar focar overlay

**Objetivo:** O tray recebe `BrowserWindow.getAllWindows()[0]` que é o overlay (non-focusable). Ao clicar no ícone da bandeja, deve abrir a settings window.

**Arquivo:**
- Modificar: `src/main/main.ts`

**Step 1: Modificar a referência de mainWindow do tray**

Atualmente:

```typescript
trayManager.init(BrowserWindow.getAllWindows()[0], config.appMode, { ... });
```

O primeiro problema: `BrowserWindow.getAllWindows()[0]` no momento da chamada retorna o overlay (única janela existente). O segundo: o overlay é `focusable: false`.

Solução: passar a settings window como "main window" para o tray. Mas a settings window só é criada depois (linha 352). Solução: passar um placeholder que é atualizado depois, ou usar a settings window diretamente.

**Abordagem:** Modificar `main()` para criar a settings window ANTES do tray, ou modificar `tray.ts` para não depender de mainWindow (já que o click no tray deve abrir settings).

Na verdade, o `mainWindow` no `tray.ts` não é usado para nada além de ser passado para `buildTrayMenu` que também não usa. No Windows, o comportamento padrão de um tray é que o clique abre o menu de contexto (já temos). Não há handler de clique simples no tray.

Solução mais simples: adicionar um event listener de clique no tray que abre a settings window.

Em `src/main/tray.ts`, no método `init()`, adicionar:

```typescript
this.tray.on('click', () => {
  this.handlers.onSettings();
});
```

Isso faz o clique no ícone da bandeja abrir a settings window.

**Step 2: Compilar**

```bash
npm run build
```

---

## Fase 5 — Copiar HTMLs atualizados para dist/

### Task 5.1: Sincronizar notch.html e settings.html

**Objetivo:** O `npm run build` (tsc) não copia arquivos .html. O script `build` no package.json copia, mas só os do `src/main/`. Garantir que as alterações no notch.html estejam no dist/.

**Arquivos:**
- `src/main/notch.html` → `dist/main/notch.html`
- `src/main/settings.html` → `dist/main/settings.html`

**Step 1: Copiar**

```bash
cd /c/Users/user/Desktop/Mimico
cp src/main/notch.html dist/main/notch.html
cp src/main/settings.html dist/main/settings.html
```

**Step 2: Verificar**

```bash
diff src/main/notch.html dist/main/notch.html && echo "notch.html sincronizado"
diff src/main/settings.html dist/main/settings.html && echo "settings.html sincronizado"
```

---

## Resumo das fases

| Fase | Descrição | Arquivos | Prioridade |
|------|-----------|----------|------------|
| 1 | Stealth Mode tap toggle | `visibility-controller.ts` | 🔴 Alta |
| 2 | Remover mic-capture.ts morto | `mic-capture.ts` | 🟢 Baixa |
| 3 | sourceLang no Config + pipeline | `config.ts`, `pipeline.ts` | 🟡 Média |
| 4 | Tray click → settings | `tray.ts` | 🟡 Média |
| 5 | Sincronizar HTMLs | `notch.html`, `settings.html` | 🔴 Alta |

Após todas as fases, executar:

```bash
cd /c/Users/user/Desktop/Mimico
npm run build
echo "Build: OK"
```
