# Especificação de Correção — Mimico v1.0.1

## Resumo Executivo

O Mimico não está gerando legendas nem dublagem devido a **6 bugs críticos** identificados em análise de logs e código-fonte. Esta especificação detalha cada problema, sua causa raiz, e a correção exata a ser aplicada.

---

## 1. Erro Crítico: WASAPI Loopback (`audio_capture.py`)

### Problema
O worker de captura de áudio do sistema falha ao iniciar com erro:
```
WasapiSettings.__init__() got an unexpected keyword argument 'loopback'
```

### Causa Raiz
A API do `sounddevice` (PortAudio/WASAPI) mudou. `sd.WasapiSettings()` não aceita mais `loopback=True` como keyword argument. O parâmetro de loopback agora deve ser passado via `sd.InputStream(..., extra_settings=...)` de forma diferente, ou via configuração de device.

### Correção
**Arquivo:** `workers/audio_capture.py`  
**Linha:** 120

**Antes:**
```python
self.stream = sd.InputStream(
    device=self.device_index,
    samplerate=SAMPLE_RATE,
    channels=CHANNELS,
    dtype=DTYPE,
    blocksize=BLOCK_SIZE,
    extra_settings=sd.WasapiSettings(loopback=True),
    callback=self._audio_callback,
)
```

**Depois:**
```python
# WASAPI loopback: usar device do tipo output com loopback
# O device_index já é um dispositivo de saída WASAPI
# Não precisa de WasapiSettings extra, o loopback é implícito
# ao usar InputStream com device de saída no WASAPI
self.stream = sd.InputStream(
    device=self.device_index,
    samplerate=SAMPLE_RATE,
    channels=CHANNELS,
    dtype=DTYPE,
    blocksize=BLOCK_SIZE,
    callback=self._audio_callback,
)
```

**Nota:** No WASAPI, capturar um dispositivo de **saída** via `InputStream` já ativa o loopback automaticamente. O `WasapiSettings` é desnecessário e quebrado na versão atual do `sounddevice`.

---

## 2. Timeout Insuficiente no Whisper (`worker-process.ts`)

### Problema
O pipeline aborta com:
```
Timeout waiting for whisper (10000ms)
```

### Causa Raiz
O modelo Whisper `tiny` demora mais de 10 segundos para carregar na primeira execução (download + inicialização). O timeout padrão de 10s é insuficiente.

### Correção
**Arquivo:** `src/main/worker-process.ts`  
**Linha:** 19

**Antes:**
```typescript
const DEFAULT_READY_TIMEOUT = 10_000;
```

**Depois:**
```typescript
const DEFAULT_READY_TIMEOUT = 60_000;  // 60s para Whisper carregar modelo
```

**Arquivo:** `src/main/whisper-manager.ts`  
**Linha:** 21

**Antes:**
```typescript
const MODEL_LOAD_TIMEOUT = 120_000;
```

**Depois:**
```typescript
const MODEL_LOAD_TIMEOUT = 180_000;  // 3 minutos para download + load
```

---

## 3. Protocolo Inconsistente: `action` vs `command` (`whisper-manager.ts`)

### Problema
O worker Whisper recebe mensagens com campo `action` mas espera `command`. Resultado:
```
Whisper error: Unknown command:
```
(repetido a cada chunk de áudio)

### Causa Raiz
- `whisper-manager.ts` envia: `{ action: 'transcribe', audio: ..., id }`
- `whisper_worker.py` espera: `{ command: 'transcribe', data: ... }`

Os nomes dos campos não batem (`action` ≠ `command`, `audio` ≠ `data`).

### Correção
**Arquivo:** `src/main/whisper-manager.ts`  
**Linhas:** 86-93

**Antes:**
```typescript
const payload: Record<string, unknown> = {
  action: 'transcribe',
  audio: audioBase64,
  id,
};
if (language) payload.language = language;
```

**Depois:**
```typescript
const payload: Record<string, unknown> = {
  command: 'transcribe',
  data: audioBase64,
  id,
};
if (language) payload.language = language;
```

**Nota:** O campo `id` no payload é opcional no worker; pode ser removido se não for usado.

---

## 4. API Key DeepL Vazia (`config.ts` + `translator.ts`)

### Problema
Sem API key DeepL configurada, o tradutor retorna `null` silenciosamente. As legendas aparecem em inglês (ou não aparecem) sem tradução para português.

### Causa Raiz
- Default da config: `deepKey: ''`
- `translator.ts` retorna `null` quando `!this.configured`
- Nenhuma mensagem de erro é exibida ao usuário

### Correção
**Arquivo:** `src/main/translator.ts`  
**Linhas:** 170-174

**Antes:**
```typescript
// Se a API não está configurada, retorna null
if (!this.configured) {
  return null;
}
```

**Depois:**
```typescript
// Se a API não está configurada, retorna texto original com warning
if (!this.configured) {
  this.emit('error', new Error('DeepL API key not configured. Translation skipped.'));
  return text;  // retorna texto original em vez de null
}
```

**Arquivo:** `src/main/config.ts`  
**Linha:** 55 (comentário/documentação)

Adicionar comentário explicativo:
```typescript
// ⚠️ DeepL API key obrigatória para tradução.
// Obtenha em: https://www.deepl.com/pro-api
// Plano gratuito: 500.000 caracteres/mês
deepKey: '',
```

---

## 5. toggleVoice Desligado por Padrão (`config.ts`)

### Problema
A dublagem (TTS) não funciona porque `toggleVoice: false` no default. O usuário precisa saber que deve ligar nas settings.

### Correção
**Arquivo:** `src/main/config.ts`  
**Linha:** 65

**Antes:**
```typescript
toggleVoice: false,
```

**Depois:**
```typescript
toggleVoice: true,  // ligado por padrão no modo voice
```

**Nota:** O toggle só deve afetar o modo `voice`. No modo `subtitles`, o TTS deve permanecer desligado. Verificar `pipeline.ts` para garantir essa lógica.

---

## 6. Voz Edge Default Incorreta (`config.ts`)

### Problema
A voz padrão é `en-US-JennyNeural` (inglês). Para legendas EN→PT, o TTS deveria falar em português. Para dublagem PT→EN, a voz em inglês faz sentido, mas o nome da config é confuso.

### Correção
**Arquivo:** `src/main/config.ts`  
**Linha:** 70

**Antes:**
```typescript
edgeVoice: 'en-US-JennyNeural',
```

**Depois:**
```typescript
// Voz para legendas (PT) — traduz EN→PT e fala em português
edgeVoice: 'pt-BR-AntonioNeural',
```

**Nota:** Se o usuário quiser TTS em inglês para dublagem, pode mudar nas settings para `en-US-JennyNeural` ou `en-US-GuyNeural`.

---

## Checklist de Validação

Após aplicar as correções, testar na seguinte ordem:

1. [ ] `npm run build` compila sem erros TypeScript
2. [ ] Executar Mimico, verificar log: `Audio capture started` sem erro
3. [ ] Verificar log: `Whisper model 'tiny' loaded` (sem timeout)
4. [ ] Falar algo no microfone / tocar áudio no sistema
5. [ ] Verificar se overlay aparece com texto traduzido (legendas)
6. [ ] Verificar se TTS reproduz voz (dublagem)
7. [ ] Verificar se log não mostra `Unknown command:` repetido

---

## Arquivos Modificados

| Arquivo | Linhas Alteradas | Severidade |
|---------|-----------------|------------|
| `workers/audio_capture.py` | 120 | 🔴 Crítico |
| `src/main/worker-process.ts` | 19 | 🔴 Crítico |
| `src/main/whisper-manager.ts` | 86-93 | 🔴 Crítico |
| `src/main/translator.ts` | 170-174 | 🔴 Crítico |
| `src/main/config.ts` | 55, 65, 70 | 🔴 Crítico / 🟡 Médio |
| `src/main/whisper-manager.ts` | 21 | 🔴 Crítico |

---

## Notas Adicionais

- **Dependências Python:** Verificar se `faster-whisper`, `sounddevice`, `numpy` estão instalados no Python do sistema. Se não estiverem, o worker falha silenciosamente.
- **VB-Cable:** Para dublagem, o dispositivo `CABLE Input` deve estar instalado e visível no Windows.
- **GPU vs CPU:** O Whisper `tiny` em CPU é lento. Considerar `tiny.en` para inglês (mais rápido) ou habilitar GPU se disponível.

---

*Especificação criada em: 2026-06-17*  
*Versão: 1.0.1*
