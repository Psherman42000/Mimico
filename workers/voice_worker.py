#!/usr/bin/env python3
"""
Mimico Voice Worker
Text-to-speech synthesis using edge-tts (async).
Receives text via stdin JSON, synthesizes to temp WAV file,
sends file path via stdout JSON.
"""

import json
import sys
import os
import tempfile
import asyncio
import traceback
import time
import uuid

import edge_tts


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# Default voice for Brazilian Portuguese
DEFAULT_VOICE = "pt-BR-FranciscaNeural"
DEFAULT_LANG = "pt-BR"
# Temp directory for generated audio files
TEMP_DIR = os.path.join(tempfile.gettempdir(), "mimico_voice")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    """Write log messages to stderr (never stdout)."""
    print(f"[voice_worker] {msg}", file=sys.stderr, flush=True)


def send_json(obj: dict) -> None:
    """Print a JSON message to stdout, followed by a newline."""
    print(json.dumps(obj), flush=True)


# ---------------------------------------------------------------------------
# TTS Engine (async wrapper)
# ---------------------------------------------------------------------------
class VoiceEngine:
    def __init__(self):
        os.makedirs(TEMP_DIR, exist_ok=True)

    async def _synthesize_async(self, text: str, voice: str, lang: str) -> dict:
        """
        Perform async TTS synthesis using edge-tts.
        Returns dict with path and duration.
        """
        # Build output path
        filename = f"mimico_{uuid.uuid4().hex[:12]}.wav"
        output_path = os.path.join(TEMP_DIR, filename)

        log(f"Synthesizing text ({len(text)} chars) with voice '{voice}' -> {output_path}")

        # Run edge-tts
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(output_path)

        # Get approximate duration from file size / bitrate
        # edge-tts outputs 16-bit PCM at 16kHz or 24kHz depending on voice.
        # We estimate duration by reading the WAV header.
        duration = self._get_wav_duration(output_path)

        log(f"Synthesis complete: {output_path} ({duration:.2f}s)")

        return {
            "path": output_path,
            "duration": duration,
        }

    @staticmethod
    def _get_wav_duration(filepath: str) -> float:
        """Parse WAV header to get duration in seconds."""
        try:
            import struct
            with open(filepath, "rb") as f:
                # Read RIFF header
                riff_id = f.read(4)
                if riff_id != b"RIFF":
                    return 0.0
                f.read(4)  # file size
                wave_id = f.read(4)
                if wave_id != b"WAVE":
                    return 0.0

                # Find fmt chunk
                while True:
                    chunk_id = f.read(4)
                    if not chunk_id:
                        return 0.0
                    chunk_size = struct.unpack("<I", f.read(4))[0]
                    if chunk_id == b"fmt ":
                        fmt_data = f.read(chunk_size)
                        channels = struct.unpack("<H", fmt_data[2:4])[0]
                        sample_rate = struct.unpack("<I", fmt_data[4:8])[0]
                        # bits per sample
                        bits_per_sample = struct.unpack("<H", fmt_data[14:16])[0]
                        break
                    else:
                        # Skip chunk
                        f.seek(chunk_size, os.SEEK_CUR)

                # Find data chunk
                while True:
                    chunk_id = f.read(4)
                    if not chunk_id:
                        return 0.0
                    chunk_size = struct.unpack("<I", f.read(4))[0]
                    if chunk_id == b"data":
                        data_size = chunk_size
                        break
                    f.seek(chunk_size, os.SEEK_CUR)

                bytes_per_sample = (bits_per_sample // 8) * channels
                if bytes_per_sample == 0 or sample_rate == 0:
                    return 0.0
                total_samples = data_size / bytes_per_sample
                return total_samples / sample_rate
        except Exception as exc:
            log(f"Could not parse WAV duration: {exc}")
            return 0.0

    def synthesize(self, text: str, voice: str | None = None, lang: str | None = None) -> None:
        """
        Synthesize text to speech. Handles async edge-tts call via asyncio.run().
        """
        if not text or not text.strip():
            send_json({"type": "error", "message": "Empty text provided"})
            return

        voice = voice or DEFAULT_VOICE
        lang = lang or DEFAULT_LANG

        # Map language to a default voice if no specific voice given
        if voice is None or voice == DEFAULT_VOICE:
            voice_map = {
                "pt-BR": "pt-BR-FranciscaNeural",
                "pt-PT": "pt-PT-RaquelNeural",
                "en-US": "en-US-JennyNeural",
                "en-GB": "en-GB-SoniaNeural",
                "es-ES": "es-ES-ElviraNeural",
                "fr-FR": "fr-FR-DeniseNeural",
                "de-DE": "de-DE-KatjaNeural",
                "ja-JP": "ja-JP-NanamiNeural",
                "zh-CN": "zh-CN-XiaoxiaoNeural",
            }
            voice = voice_map.get(lang, DEFAULT_VOICE)

        try:
            result = asyncio.run(self._synthesize_async(text.strip(), voice, lang))
            send_json({
                "type": "audio",
                "path": result["path"],
                "duration": result["duration"],
                "voice": voice,
                "lang": lang,
            })
        except Exception as exc:
            log(f"Synthesis failed: {exc}")
            traceback.print_exc(file=sys.stderr)
            send_json({"type": "error", "message": f"Synthesis failed: {exc}"})

    def cleanup_old_files(self, max_age_hours: int = 24) -> None:
        """Remove synthesized audio files older than max_age_hours."""
        try:
            now = time.time()
            count = 0
            for fname in os.listdir(TEMP_DIR):
                fpath = os.path.join(TEMP_DIR, fname)
                if os.path.isfile(fpath) and fname.endswith(".wav"):
                    age = now - os.path.getmtime(fpath)
                    if age > max_age_hours * 3600:
                        os.remove(fpath)
                        count += 1
            if count:
                log(f"Cleaned up {count} old audio files")
        except Exception as exc:
            log(f"Cleanup error: {exc}")


# ---------------------------------------------------------------------------
# Main loop — read commands from stdin
# ---------------------------------------------------------------------------
def main() -> None:
    log("Voice Worker starting")
    engine = VoiceEngine()
    engine.cleanup_old_files()

    send_json({"type": "ready", "worker": "voice_worker"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            log(f"Invalid JSON received: {exc}")
            send_json({"type": "error", "message": f"Invalid JSON: {exc}"})
            continue

        command = msg.get("command", "")

        try:
            if command == "speak":
                text = msg.get("text", "")
                lang = msg.get("lang", DEFAULT_LANG)
                voice = msg.get("voice", None)
                engine.synthesize(text, voice=voice, lang=lang)

            elif command == "cleanup":
                max_age = msg.get("max_age_hours", 24)
                engine.cleanup_old_files(max_age_hours=max_age)

            elif command == "exit":
                send_json({"type": "status", "status": "exiting"})
                break

            else:
                send_json({"type": "error", "message": f"Unknown command: {command}"})

        except Exception as exc:
            log(f"Error handling command '{command}': {exc}")
            traceback.print_exc(file=sys.stderr)
            send_json({"type": "error", "message": str(exc)})

    log("Voice Worker shutting down")


if __name__ == "__main__":
    main()
