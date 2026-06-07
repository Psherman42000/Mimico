# Mimico — Agent Guide

## Overview
Real-time audio transcription + translation overlay for Windows meetings.
Electron app with Python worker processes. Two independent pipelines.

## Two Pipelines (CRITICAL — don't confuse)

### Pipeline A — Subtitles (always ON)
System audio (what others say in EN) → WASAPI Loopback → Whisper (EN) → DeepL (EN→PT) → Overlay (PT text)
Files: `audio-capture.ts` + `audio_capture.py` (loopback) + `whisper-manager.ts` + `translator.ts` + `overlay.ts`

### Pipeline B — Voice Translation (toggle ON)
Your mic (your voice in PT) → WASAPI Mic Capture → Whisper (PT) → DeepL (PT→EN) → Edge TTS (EN voice) → VB-Cable → Meeting hears English
Files: `mic-capture.ts` + `audio_mic_capture.py` (input) + `whisper-manager.ts` + `translator.ts` + `voice-manager.ts` + `audio-output.ts`

## Tech Stack
- **Desktop:** Electron 33 + TypeScript (strict mode)
- **Workers:** Python 3.10+ (child processes, JSON stdin/stdout)
- **Audio:** sounddevice (WASAPI), Faster-Whisper, Edge TTS
- **Translation:** DeepL API Free (500k chars/mo)
- **Virtual Mic:** VB-Cable (CABLE Input device)
- **Config:** Local JSON file in app.getPath('userData')
- **Installer:** electron-builder NSIS (71MB)

## Project Structure
```
Mimico/
├── src/main/          # Electron main process
│   ├── main.ts        # Pipeline orchestrator
│   ├── overlay.ts     # Transparent subtitle window
│   ├── tray.ts        # System tray icon + menu
│   ├── config.ts      # JSON config persistence
│   ├── preload.ts     # Secure contextBridge IPC
│   ├── win32-overlay.ts   # Win32 click-through API
│   ├── audio-capture.ts   # System audio capture manager
│   ├── mic-capture.ts     # Mic capture manager (Pipeline B)
│   ├── whisper-manager.ts # Whisper transcription manager
│   ├── translator.ts      # DeepL + LRU cache
│   ├── voice-manager.ts   # Edge TTS synthesis
│   └── audio-output.ts    # VB-Cable playback
├── workers/           # Python child processes
│   ├── audio_capture.py   # WASAPI loopback (system audio)
│   ├── audio_mic_capture.py # WASAPI input (mic)
│   ├── whisper_worker.py  # Faster-Whisper transcription
│   ├── voice_worker.py    # Edge TTS synthesis
│   └── audio_output.py    # VB-Cable audio playback
├── docs/
│   ├── README.md      # Full documentation
│   ├── PLAN.md        # Implementation plan
│   └── ARCHITECTURE.md # Technical architecture
└── scripts/
    └── build.js       # Electron builder script
```

## Build & Run
```bash
cd C:\Users\user\Desktop\Mimico
npm install
npm run build          # Compile TypeScript
npm start              # Build + launch
# Installer:
npx electron-builder --prepackaged=release/win-unpacked --win --x64 --publish=never
```

## Key Conventions
- `noImplicitAny: true` — no `any` types, use concrete interfaces
- Python workers communicate via JSON lines on stdin/stdout
- Workers send `{"type":"ready"}` on startup
- Config stored at `%APPDATA%/Mimico/mimico-config.json`
- All workers use `#!/usr/bin/env python3` shebang
- Windows-only app (WASAPI, Win32 API, VB-Cable)

## Critical Rules for AI Agents

### DO NOT
- Use electron-store (removed, using raw JSON instead)
- Mix up the two pipelines (A = system→subtitles, B = mic→translated voice)
- Use OpenVoice or voice cloning (decided against it, using Edge TTS)
- Add cloud dependencies for STT (Whisper runs locally)
- Use `any` types in TypeScript

### DO
- Check PLAN.md before implementing new features
- Run `npm run build` to verify TypeScript compiles
- Use same JSON protocol for all Python workers
- Keep workers stateless (state managed by Electron main process)
- Handle VAD (voice activity detection) in all audio workers
- Use `as any` only for electron-store → removed, now using native fs
