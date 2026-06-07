#!/usr/bin/env python3
"""
Mimico Whisper Worker
Transcribes audio using Faster-Whisper.
Receives base64 audio via stdin JSON, returns transcription via stdout JSON.
VAD included to skip silence.
"""

import json
import sys
import base64
import io
import traceback
import os

import numpy as np

from faster_whisper import WhisperModel


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DEFAULT_MODEL_SIZE = "tiny"
SUPPORTED_MODELS = ["tiny", "tiny.en", "base", "base.en", "small", "small.en",
                     "medium", "medium.en", "large", "large-v2", "large-v3"]
VAD_THRESHOLD = 0.01  # RMS below this is considered silence


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    """Write log messages to stderr (never stdout)."""
    print(f"[whisper_worker] {msg}", file=sys.stderr, flush=True)


def send_json(obj: dict) -> None:
    """Print a JSON message to stdout, followed by a newline."""
    print(json.dumps(obj), flush=True)


def compute_rms(audio_data: np.ndarray) -> float:
    """Compute RMS energy of float32 audio array."""
    if audio_data.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(audio_data ** 2)))


def decode_base64_audio(b64_str: str, sample_rate: int = 16000) -> np.ndarray:
    """
    Decode base64 audio bytes into a float32 numpy array.
    Expects raw PCM float32 mono data.
    """
    audio_bytes = base64.b64decode(b64_str)
    audio_array = np.frombuffer(audio_bytes, dtype=np.float32)
    return audio_array


# ---------------------------------------------------------------------------
# Whisper model wrapper
# ---------------------------------------------------------------------------
class WhisperHandler:
    def __init__(self):
        self.model: WhisperModel | None = None
        self.model_size: str | None = None

    def load_model(self, size: str = DEFAULT_MODEL_SIZE) -> bool:
        """Load a Faster-Whisper model. Returns True on success."""
        if size not in SUPPORTED_MODELS:
            log(f"Unsupported model size: {size}")
            send_json({"type": "error", "message": f"Unsupported model size: {size}. "
                       f"Supported: {', '.join(SUPPORTED_MODELS)}"})
            return False

        try:
            log(f"Loading Faster-Whisper model '{size}'...")
            # Use CPU by default; add device="cuda" for GPU.
            # compute_type="int8" for CPU speed-up.
            self.model = WhisperModel(size, device="cpu", compute_type="int8")
            self.model_size = size
            log(f"Model '{size}' loaded successfully")
            send_json({"type": "status", "status": "model_loaded", "model": size})
            return True
        except Exception as exc:
            log(f"Failed to load model '{size}': {exc}")
            traceback.print_exc(file=sys.stderr)
            # Retry with default compute_type if int8 fails
            try:
                log("Retrying with default compute_type...")
                self.model = WhisperModel(size, device="cpu")
                self.model_size = size
                log(f"Model '{size}' loaded successfully (default compute_type)")
                send_json({"type": "status", "status": "model_loaded", "model": size})
                return True
            except Exception as exc2:
                log(f"Retry also failed: {exc2}")
                send_json({"type": "error", "message": f"Failed to load model '{size}': {exc2}"})
                return False

    def transcribe(self, b64_data: str, language: str | None = None) -> None:
        """Transcribe base64-encoded audio and send the result via stdout."""
        if self.model is None:
            send_json({"type": "error", "message": "No model loaded. Send load_model command first."})
            return

        try:
            # Decode audio
            audio = decode_base64_audio(b64_data)

            if audio.size == 0:
                send_json({"type": "error", "message": "Empty audio data"})
                return

            # VAD: skip silence
            rms = compute_rms(audio)
            if rms < VAD_THRESHOLD:
                log(f"Silence detected (RMS={rms:.6f}), skipping transcription")
                send_json({
                    "type": "transcription",
                    "text": "",
                    "language": "silence",
                    "duration": 0.0,
                    "rms": rms,
                })
                return

            log(f"Transcribing {audio.size} samples (RMS={rms:.6f})...")

            # Run inference
            segments, info = self.model.transcribe(
                audio,
                language=language,
                beam_size=5,
                vad_filter=True,  # faster-whisper built-in VAD
                vad_parameters=dict(
                    threshold=0.5,
                    min_speech_duration_ms=250,
                    min_silence_duration_ms=100,
                ),
            )

            # Collect text
            text_parts = []
            segment_list = list(segments)  # materialize generator
            for seg in segment_list:
                text_parts.append(seg.text.strip())

            full_text = " ".join(text_parts).strip()
            detected_language = info.language
            audio_duration = info.duration

            log(f"Transcribed: \"{full_text[:80]}{'...' if len(full_text) > 80 else ''}\" "
                f"(lang={detected_language}, dur={audio_duration:.2f}s)")

            send_json({
                "type": "transcription",
                "text": full_text,
                "language": detected_language,
                "duration": audio_duration,
                "rms": rms,
            })

        except Exception as exc:
            log(f"Transcription error: {exc}")
            traceback.print_exc(file=sys.stderr)
            send_json({"type": "error", "message": f"Transcription failed: {exc}"})


# ---------------------------------------------------------------------------
# Main loop — read commands from stdin
# ---------------------------------------------------------------------------
def main() -> None:
    log("Whisper Worker starting")
    handler = WhisperHandler()

    send_json({"type": "ready", "worker": "whisper_worker"})

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
            if command == "load_model":
                size = msg.get("size", DEFAULT_MODEL_SIZE)
                handler.load_model(size)

            elif command == "transcribe":
                b64_data = msg.get("data", "")
                if not b64_data:
                    send_json({"type": "error", "message": "No 'data' field with base64 audio"})
                    continue
                language = msg.get("language", None)
                handler.transcribe(b64_data, language=language)

            elif command == "exit":
                send_json({"type": "status", "status": "exiting"})
                break

            else:
                send_json({"type": "error", "message": f"Unknown command: {command}"})

        except Exception as exc:
            log(f"Error handling command '{command}': {exc}")
            traceback.print_exc(file=sys.stderr)
            send_json({"type": "error", "message": str(exc)})

    log("Whisper Worker shutting down")


if __name__ == "__main__":
    main()
