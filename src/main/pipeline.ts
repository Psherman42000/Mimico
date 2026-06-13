/**
 * pipeline.ts — Orquestrador dos pipelines de áudio do Mimico
 *
 * Pipeline A (sempre ativo em subtitles/voice):
 *   WASAPI loopback → Whisper EN → DeepL EN→PT → Overlay
 *
 * Pipeline B (ativo apenas em voice):
 *   Mic PT → Whisper PT → DeepL PT→EN → TTS EN → VB-Cable
 */
import { AudioCapture } from './audio-capture';
import { WhisperManager } from './whisper-manager';
import { Translator } from './translator';
import { VoiceManager } from './voice-manager';
import { AudioOutput } from './audio-output';
import { NotchOverlay } from './notch-overlay';
import { TrayManager } from './tray';
import { Config } from './config';

type AppMode = 'off' | 'subtitles' | 'voice';

const LANG_MAP: Record<string, string> = {
  PT: 'pt-BR', EN: 'en-US', ES: 'es-ES', FR: 'fr-FR', DE: 'de-DE',
};

export interface PipelineCallbacks {
  broadcastTranslation: (en: string, pt: string) => void;
  showNotification: (title: string, body: string) => void;
  log: (msg: string) => void;
}

export class PipelineOrchestrator {
  private isActive = false;

  constructor(
    private audioCapture: AudioCapture,
    private micCapture: AudioCapture,
    private whisper: WhisperManager,
    private translator: Translator,
    private voiceManager: VoiceManager,
    private audioOutput: AudioOutput,
    private overlay: NotchOverlay,
    private trayManager: TrayManager,
    private config: () => Config,
    private cb: PipelineCallbacks,
  ) {}

  get active(): boolean { return this.isActive; }

  async start(): Promise<void> {
    if (this.isActive) return;
    const cfg = this.config();

    try {
      if (cfg.appMode === 'subtitles' || cfg.appMode === 'voice') {
        await this.audioCapture.start({ deviceName: 'default', sampleRate: 16000 });
        this.cb.log('Audio capture started');
        await this.whisper.start(cfg.whisperModelSize as 'tiny' | 'base' | 'small' | 'medium' | 'large');
        this.cb.log('Whisper model loaded');
      }

      if (cfg.appMode === 'voice' && cfg.toggleVoice) {
        this.safeStart(this.audioOutput);
        this.safeStart(this.micCapture);
      }

      this.isActive = true;
      this.trayManager.setEnabled(true);
      const label = cfg.appMode === 'voice' ? '🎤 Voz' : '💬 Legendas';
      this.cb.log(`Pipeline started (${label})`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.cb.log(`Failed to start pipeline: ${err.message}`);
      this.cb.showNotification('Mimico', `Erro ao iniciar: ${err.message}`);
    }
  }

  stop(): void {
    if (!this.isActive) return;
    this.audioCapture.stop();
    this.micCapture.stop();
    this.whisper.stop();
    this.audioOutput.stop();
    this.overlay.clearText();
    this.isActive = false;
    this.trayManager.setEnabled(false);
    this.cb.log('Pipeline stopped');
  }

  toggle(): void {
    this.isActive ? this.stop() : this.start();
  }

  restart(): void {
    this.stop();
    const cfg = this.config();
    if (cfg.appMode !== 'off') this.start();
  }

  /** Processa chunk do loopback (Pipeline A) */
  async processAudioChunk(chunk: Buffer): Promise<void> {
    if (!this.isActive) return;
    const cfg = this.config();

    try {
      const enText = await this.whisper.transcribe(chunk);
      if (!enText?.trim()) return;

      const ptText = await this.translator.translate(enText, 'EN', cfg.language);
      if (!ptText) return;

      this.overlay.updateText(enText, ptText);
      this.cb.broadcastTranslation(enText, ptText);

      if (cfg.toggleVoice && !ptText.startsWith('[')) {
        const ttsLang = LANG_MAP[cfg.language] ?? 'pt-BR';
        await this.voiceManager.speakText(ptText, ttsLang).catch((err: Error) => {
          this.cb.log(`TTS error: ${err.message}`);
        });
      }
    } catch (error) {
      this.cb.log(`Transcription skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Processa chunk do microfone (Pipeline B) */
  async processMicAudioChunk(chunk: Buffer): Promise<void> {
    if (!this.isActive) return;
    const cfg = this.config();
    if (!cfg.toggleVoice) return;

    try {
      const ptText = await this.whisper.transcribe(chunk, 'pt');
      if (!ptText?.trim()) return;

      const enText = await this.translator.translate(ptText, 'PT', 'EN');
      if (enText.startsWith('[')) return;

      this.cb.log(`[Mic] PT→EN: "${ptText.slice(0, 40)}…" → "${enText.slice(0, 40)}…"`);
      await this.voiceManager.speakText(enText, 'en-US')
        .catch((err: Error) => this.cb.log(`[Mic] TTS error: ${err.message}`));
    } catch (error) {
      this.cb.log(`[Mic] Transcription skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Atualiza toggleVoice sem restart */
  applyVoiceToggle(active: boolean): void {
    const cfg = this.config();
    if (!this.isActive || !cfg.toggleVoice) return;
    if (active) {
      this.safeStart(this.audioOutput);
      this.safeStart(this.micCapture);
    } else {
      this.audioOutput.stop();
      this.micCapture.stop();
    }
  }

  private safeStart(worker: { start(): Promise<void> }): void {
    worker.start().catch((err: Error) => this.cb.log(`Failed to start: ${err.message}`));
  }
}
