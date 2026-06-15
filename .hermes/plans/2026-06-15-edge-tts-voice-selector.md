# Plano: Seletor de Voz Edge TTS no Mimico

> **Goal:** Adicionar seletor de voz no painel de configurações do Mimico para escolher qual voz do Edge TTS usar (ex: Antonio, Francisca, Aria, Jenny), com inglês como padrão, e atualizar docs.

**Architecture:** O Mimico já tem `EdgeTtsProvider` usando `edge-tts` CLI com Strategy/Adapter. A voz é hardcoded no `VOICE_MAP` por idioma. Precisamos tornar configurável via campo `edgeVoice` na config.

**Tech Stack:** TypeScript (Electron), edge-tts CLI (Python)

---

## Tasks

### Task 1: Add `edgeVoice` to Config schema

**Objective:** Add `edgeVoice: string` to `Config` interface and defaults

**Files:**
- Modify: `src/main/config.ts`

**Step 1: Add field to Config interface**

```typescript
export interface Config {
  // ... existing fields ...
  ttsProvider: 'edge' | 'elevenlabs';
  /** Voz do Edge TTS (nome completo, ex: 'pt-BR-AntonioNeural') */
  edgeVoice: string;
}
```

**Step 2: Set default value**

```typescript
const DEFAULTS: Config = {
  // ... existing ...
  ttsProvider: 'edge',
  edgeVoice: 'en-US-JennyNeural',
};
```

**Step 3: Check if builds**

Run: `npm run build`
Expected: TypeScript compiles without errors

### Task 2: Add optional `voice` to TtsOptions

**Objective:** Allow providers to receive an explicit voice parameter

**Files:**
- Modify: `src/main/tts-provider.ts`

**Step 1: Update TtsOptions**

```typescript
export interface TtsOptions {
  text: string;
  lang: string;
  /** Voz específica (opcional — sobrepoe o mapeamento padrão por lang) */
  voice?: string;
}
```

**Step 2: Check if builds**

Run: `npm run build`
Expected: TypeScript compiles without errors

### Task 3: Update EdgeTtsProvider to use voice from options

**Objective:** When `options.voice` is provided, use it directly instead of VOICE_MAP[lang]

**Files:**
- Modify: `src/main/tts-edge.ts`

**Step 1: Modify speak() to use options.voice**

In the `speak()` method, replace:
```typescript
const voice = VOICE_MAP[lang] ?? 'pt-BR-FranciscaNeural';
```
With:
```typescript
const voiceName = options.voice ?? VOICE_MAP[lang] ?? 'pt-BR-FranciscaNeural';
```

And update the execFile call to use `voiceName` instead of `voice`.

**Step 2: Check if builds**

Run: `npm run build`
Expected: TypeScript compiles without errors

### Task 4: Add voice parameter to VoiceManager.speakText

**Objective:** Pass voice from config through to the provider

**Files:**
- Modify: `src/main/voice-manager.ts`

**Step 1: Update method signature**

```typescript
async speakText(text: string, lang: string = 'pt-BR', voice?: string): Promise<void> {
  if (!this.provider) throw new Error('No TTS provider configured');
  await this.provider.speak({ text, lang, voice });
}
```

**Step 2: Check if builds**

Run: `npm run build`
Expected: TypeScript compiles without errors

### Task 5: Pass edgeVoice from config in pipeline calls

**Objective:** Both pipeline A (subtitles voice) and pipeline B (mic TTS) should pass `cfg.edgeVoice`

**Files:**
- Modify: `src/main/pipeline.ts`

**Step 1: Update speakText calls**

Line ~117 (subtitles voice):
```typescript
await this.voiceManager.speakText(ptText, ttsLang, cfg.edgeVoice)
  .catch((err: Error) => this.cb.log(`TTS error: ${err.message}`));
```

Line ~140 (mic TTS):
```typescript
await this.voiceManager.speakText(enText, 'en-US', cfg.edgeVoice)
  .catch((err: Error) => this.cb.log(`[Mic] TTS error: ${err.message}`));
```

**Step 2: Check if builds**

Run: `npm run build`
Expected: TypeScript compiles without errors

### Task 6: Add IPC handler to list Edge voices

**Objective:** Provide available Edge voices to the settings UI

**Files:**
- Modify: `src/main/ipc/tts.ts`

**Step 1: Add edge:list-voices handler**

```typescript
ipcMain.handle('edge:list-voices', async () => {
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('edge-tts', ['--list-voices'], {
      timeout: 10000, windowsHide: true,
    });
    const voices = stdout.split('\n')
      .filter(line => line.startsWith('Name:'))
      .map(line => line.replace('Name:', '').trim().split(/\s+/)[0])
      .filter(Boolean);
    return { success: true, voices };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
```

**Step 2: Check if builds**

Run: `npm run build`
Expected: TypeScript compiles without errors

### Task 7: Add voice selector dropdown to settings HTML

**Objective:** User can pick an Edge voice in the settings UI

**Files:**
- Modify: `src/main/settings.html`

**Step 1: Add select element after TTS provider picker**

In the "♫ Voz" section, after the ttsProvider select:
```html
<div id="edgeVoiceField">
  <div class="field">
    <label>Voz Edge TTS</label>
    <select id="edgeVoice"></select>
    <div class="hint">Selecione a voz para síntese local (Edge TTS). Gratuito.</div>
  </div>
</div>
```

**Step 2: Add loadEdgeVoices() function and wire up**

```javascript
async function loadEdgeVoices() {
  const result = await ipcRenderer.invoke('edge:list-voices');
  if (!result.success) return;
  const select = document.getElementById('edgeVoice');
  select.innerHTML = '';
  for (const voice of result.voices) {
    const opt = document.createElement('option');
    opt.value = voice;
    opt.textContent = voice;
    select.appendChild(opt);
  }
  if (config.edgeVoice) select.value = config.edgeVoice;
}

// Wire up change
document.getElementById('edgeVoice')?.addEventListener('change', function() {
  savePartial({ edgeVoice: this.value });
});
```

**Step 3: Add applyConfigToUI update**

```javascript
setVal('edgeVoice', config.edgeVoice || 'en-US-JennyNeural');
```

**Step 4: Toggle voiceField visibility with ttsProvider**

In the ttsProvider change handler:
```javascript
document.getElementById('edgeVoiceField').style.display = 
  this.value === 'elevenlabs' ? 'none' : 'block';
```

**Step 5: Call loadEdgeVoices() on init**

```javascript
loadConfig();
loadEdgeVoices();
updateStatusBar();
```

### Task 8: Update documentation

**Files:**
- Modify: `docs/GUIDE.md`
- Modify: `docs/README.md`
- Modify: `docs/ARCHITECTURE.md`

**Step 1: Update GUIDE.md**

- Replace outdated TTS table (OpenVoice/Cartesia/Fish) with current Edge/ElevenLabs
- Add Edge voices available table (pt-BR + EN)
- Note Edge is free, no API key needed
- Add edge-tts to pip install step

**Step 2: Update ARCHITECTURE.md**

- Replace any mentions of old TTS providers (OpenVoice, Cartesia)
- Update TTS data flow diagram if exists

**Step 3: Verify**

Read each file to ensure accuracy

### Task 9: Commit

```bash
git add -A
git commit -m "feat: add Edge TTS voice selector with configurable voice"
git push
```

---

## Edge voices for the reference

| Voice | Lang | Gender |
|-------|------|--------|
| `pt-BR-FranciscaNeural` | PT-BR | Female |
| `pt-BR-AntonioNeural` | PT-BR | Male |
| `en-US-JennyNeural` | EN-US | Female (default) |
| `en-US-AriaNeural` | EN-US | Female |
| `en-US-GuyNeural` | EN-US | Male |
| `en-US-AnaNeural` | EN-US | Female |
| `en-GB-SoniaNeural` | EN-GB | Female |
| `en-GB-RyanNeural` | EN-GB | Male |
| `es-ES-ElviraNeural` | ES-ES | Female |
| `es-ES-AlvaroNeural` | ES-ES | Male |
| `fr-FR-DeniseNeural` | FR-FR | Female |
| `fr-FR-HenriNeural` | FR-FR | Male |
| `de-DE-KatjaNeural` | DE-DE | Female |
| `de-DE-ConradNeural` | DE-DE | Male |
