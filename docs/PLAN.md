# Mimico — Plano de Desenvolvimento

> **Atualizado em:** Junho 2026
> **Stack principal:** Electron + TypeScript + Win32 API + Python workers
> **Correção crítica:** O toggle de voz agora processa SEU microfone (não o áudio do sistema)

---

## 🎯 Visão Geral — Dois Pipelines Independentes

### Pipeline A — Legendas (no overlay)
**O que os outros falam** → legendas em português na tela
```
Sistema (áudio dos outros, EN) 
  → WASAPI Loopback 
  → Faster-Whisper (EN) 
  → DeepL (EN→PT) 
  → Overlay (texto PT) ✅ Funcionando
```

### Pipeline B — Sua voz traduzida (no microfone virtual)
**O que VOCÊ fala** → sua voz em inglês no Meet/Discord
```
Microfone real (sua voz PT) 
  → WASAPI Capture 
  → Faster-Whisper (PT) 
  → DeepL (PT→EN) 
  → Edge TTS (voz EN) 
  → VB-Cable → Meet ouve inglês 🔧 Implementar
```

**Toggle Voice OFF:** só Pipeline A (legendas na tela)
**Toggle Voice ON:** Pipeline A + Pipeline B rodam em paralelo

---

## Fase 0 — Fundação ✅ (COMPLETA)

| Tarefa | Status |
|--------|--------|
| Estrutura Electron + TS | ✅ |
| Config persistente (JSON) | ✅ |
| Overlay invisível click-through | ✅ |
| Ícone bandeja + menu | ✅ |
| WASAPI loopback (áudio sistema) | ✅ |
| Faster-Whisper transcrição | ✅ |
| DeepL tradução + cache LRU | ✅ |
| Edge TTS síntese | ✅ |
| VB-Cable audio output | ✅ |
| Instalador NSIS | ✅ |
| README com visual + instruções | ✅ |

---

## Fase 1 — Pipeline B: Microfone → Voz Inglesa 🔧

### 1.1 Worker de captura do microfone
**Criar:** `workers/audio_mic_capture.py`
- Captura do microfone real (WASAPI input), não loopback
- 16kHz mono, float32, chunks de ~3s
- VAD (energy threshold) pra evitar enviar silêncio
- Comunicação JSON via stdin/stdout (mesmo padrão dos outros workers)
- Comandos: `start`, `stop`, `exit`

### 1.2 Whisper configurado para português
**Modificar:** `workers/whisper_worker.py`
- Aceitar parâmetro `language: "pt"` no comando `transcribe`
- Modelo multilíngue do Whisper já suporta PT nativamente
- Se language=PT, usa modelo `tiny` com detecção de idioma PT

### 1.3 DeepL tradução PT→EN
**Modificar:** `src/main/translator.ts`
- Aceitar direção da tradução: sourceLang + targetLang
- Para Pipeline A: EN→PT
- Para Pipeline B: PT→EN
- Cache LRU separado por direção

### 1.4 TTS em inglês
O Edge TTS já suporta EN nativamente. Só precisa:
- Selecionar voz EN-US ao invés de PT-BR
- `voice-manager.ts` já tem mapa de vozes por idioma

### 1.5 Gerenciador de microfone
**Modificar:** `src/main/audio-capture.ts`
- Duas instâncias: uma loopback (sistema), uma input (microfone)
- Ou criar novo módulo `src/main/mic-capture.ts` separado

### 1.6 Pipeline orquestrador atualizado
**Modificar:** `src/main/main.ts`
- Pipeline B paralelo ao Pipeline A
- Quando toggle voz ON: microfone → Whisper PT → DeepL PT→EN → TTS EN → VB-Cable
- Controle de volume: áudio original + áudio traduzido NÃO se misturam

---

## Fase 2 — Configuração + UX 🔧

### 2.1 Seletor de modo de voz
**Config:** `toggleVoice: "off" | "on"` (apenas liga/desliga o pipeline B)

### 2.2 Indicador visual no overlay
- Quando pipeline B ativo: mostrar `🎤 PT→EN` no overlay
- Quando inativo: mostrar só `🇧🇷 PT`

---

## Diagrama de Fluxo Correto

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MIMICO - DOIS PIPELINES                      │
└─────────────────────────────────────────────────────────────────────┘

PIPELINE A (Legendas) — sempre ativo
┌──────────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────┐
│ WASAPI       │   │ Faster-      │   │ DeepL    │   │ Overlay  │
│ Loopback     │──▶│ Whisper EN   │──▶│ EN→PT    │──▶│ Texto PT │
│ (áudio       │   │              │   │          │   │ (cyan)   │
│  sistema)    │   │              │   │          │   │          │
└──────────────┘   └──────────────┘   └──────────┘   └──────────┘

PIPELINE B (Voz) — ativado por toggle
┌──────────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ WASAPI       │   │ Faster-      │   │ DeepL    │   │ Edge TTS │   │ VB-Cable │
│ Mic Capture  │──▶│ Whisper PT   │──▶│ PT→EN    │──▶│ Voz EN   │──▶│ (Mic     │
│ (seu microf.)│   │              │   │          │   │          │   │ Virtual) │
└──────────────┘   └──────────────┘   └──────────┘   └──────────┘   └──────────┘
                                                                         │
                                                                         ▼
                                                              ┌──────────────────┐
                                                              │ Meet/Discord     │
                                                              │ ouve inglês      │
                                                              └──────────────────┘
```

## Cenários de Uso

| Cenário | Pipeline A | Pipeline B | Resultado |
|---------|-----------|-----------|-----------|
| Reunião: só quero ler legendas | ✅ ON | ❌ OFF | Vejo PT no overlay, falo PT normalmente |
| Reunião: quero falar inglês sem sotaque | ✅ ON | ✅ ON | Vejo legendas + Meet ouve ingles |
| Vídeo YouTube em inglês | ✅ ON | ❌ OFF | Legendas PT no overlay |

## Estimativa

| Tarefa | Tempo |
|--------|-------|
| Worker microfone | ~2h |
| Whisper multilíngue | ~1h |
| DeepL direção configurável | ~1h |
| Gerenciador microfone | ~2h |
| Pipeline B integração | ~2h |
| **Total** | **~8h** |
